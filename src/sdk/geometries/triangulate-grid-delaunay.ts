import { Delatin } from './delatin';
import { sampleValidGrid } from './grid-sampling';

/**
 * Triangulate an elevation grid using Delaunay triangulation
 */
export function triangulateGridDelaunay(
  grid: Float32Array,
  columns: number,
  scaleX = 1,
  scaleY = 1,
  nullValue: number = -1,
  maxError: number = 5,
) {
  const width = columns;
  const height = grid.length / width;
  console.time('delatin');
  const d = new Delatin(grid, width, nullValue);
  d.run(maxError);
  d.removeInvalidTriangles();
  console.timeEnd('delatin');

  const positions = new Float32Array(d.coords.length * 1.5);
  const uvs = new Float32Array(d.coords.length);

  for (let i = 0, j = 0; i < d.coords.length; i += 2) {
    uvs[i] = d.coords[i] / (width - 1);
    uvs[i + 1] = 1 - d.coords[i + 1] / (height - 1);
    j = i * 1.5;
    positions[j] = d.coords[i] * scaleX;
    positions[j + 1] = d.heightAt(d.coords[i], d.coords[i + 1]);
    positions[j + 2] = d.coords[i + 1] * scaleY;
  }

  const indices = new Uint32Array(d.triangles);

  console.log(d.triangles.length / 3);
  return { positions, uvs, indices };
}

/** A ring of `[column, row]` grid coordinates (fractional allowed). */
export type GridRing = number[][];
/** A polygon in grid coordinates: `[outerRing, ...holeRings]`. */
export type GridPolygon = GridRing[];

// Row-bucketed even-odd crossing test for a set of rings in grid coordinates.
// Ring edges are bucketed by the integer rows they span, so a query only tests
// the few edges that can cross its scanline rather than every ring vertex — the
// trim pass runs one query per triangle, so a linear scan over the (potentially
// very long) traced data boundary would dominate.
function buildCrossingIndex(
  rings: GridRing[],
): (x: number, y: number) => boolean {
  const exi: number[] = [];
  const eyi: number[] = [];
  const exj: number[] = [];
  const eyj: number[] = [];
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yA = ring[i][1];
      const yB = ring[j][1];
      if (yA === yB) continue; // horizontal edges never produce a crossing
      exi.push(ring[i][0]);
      eyi.push(yA);
      exj.push(ring[j][0]);
      eyj.push(yB);
      const r0 = Math.floor(Math.min(yA, yB));
      const r1 = Math.floor(Math.max(yA, yB));
      if (r0 < minRow) minRow = r0;
      if (r1 > maxRow) maxRow = r1;
    }
  }
  const n = exi.length;
  if (n === 0) return () => false;

  const xi = Float64Array.from(exi);
  const yi = Float64Array.from(eyi);
  const xj = Float64Array.from(exj);
  const yj = Float64Array.from(eyj);

  // CSR buckets: offsets[r] .. offsets[r + 1] index into items
  const rowCount = maxRow - minRow + 1;
  const offsets = new Uint32Array(rowCount + 1);
  for (let e = 0; e < n; e++) {
    const r0 = Math.floor(Math.min(yi[e], yj[e])) - minRow;
    const r1 = Math.floor(Math.max(yi[e], yj[e])) - minRow;
    for (let r = r0; r <= r1; r++) offsets[r + 1]++;
  }
  for (let r = 0; r < rowCount; r++) offsets[r + 1] += offsets[r];
  const items = new Uint32Array(offsets[rowCount]);
  const cursor = offsets.slice(0, rowCount);
  for (let e = 0; e < n; e++) {
    const r0 = Math.floor(Math.min(yi[e], yj[e])) - minRow;
    const r1 = Math.floor(Math.max(yi[e], yj[e])) - minRow;
    for (let r = r0; r <= r1; r++) items[cursor[r]++] = e;
  }

  return (x: number, y: number) => {
    const r = Math.floor(y) - minRow;
    if (r < 0 || r >= rowCount) return false;
    let inside = false;
    for (let k = offsets[r]; k < offsets[r + 1]; k++) {
      const e = items[k];
      const yA = yi[e];
      const yB = yj[e];
      if (
        yA > y !== yB > y &&
        x < ((xj[e] - xi[e]) * (y - yA)) / (yB - yA) + xi[e]
      ) {
        inside = !inside;
      }
    }
    return inside;
  };
}

// Inside any component polygon (outer ring minus its holes).
function makeGridInside(polygons: GridPolygon[]) {
  const indexed = polygons
    .filter(poly => poly.length > 0)
    .map(poly => ({
      outer: buildCrossingIndex([poly[0]]),
      holes: poly.slice(1).map(hole => buildCrossingIndex([hole])),
    }));
  return (x: number, y: number) => {
    for (const poly of indexed) {
      if (!poly.outer(x, y)) continue;
      let inHole = false;
      for (const hole of poly.holes) {
        if (hole(x, y)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  };
}

// Even-odd membership across a flat list of rings. For a region traced with
// consistent winding this handles nested holes and multiple components without
// needing to classify outer vs hole (inside a hole => 2 crossings => outside).
function makeEvenOddInside(rings: GridRing[]) {
  return buildCrossingIndex(rings);
}

/**
 * Trace the boundary of the valid-data region of a grid — cells whose four
 * corners are all valid — into closed rings of integer grid coordinates. The
 * outer data extent and each internal no-data hole become separate rings, and
 * multiple disconnected regions yield multiple rings. Boundaries follow cell
 * edges (data is inherently cell-quantized), so the rings are rectilinear and
 * unit-stepped (every constraint sub-edge is one cell long).
 *
 * @param grid row-major grid of length `columns * rows`
 * @param columns number of columns (nx)
 * @param isInvalid predicate marking a sample as missing/hole
 *
 * @group Geometries
 */
export function traceValidBoundary(
  grid: Float32Array,
  columns: number,
  isInvalid: (v: number) => boolean,
): GridRing[] {
  const width = columns;
  const height = grid.length / width;
  const cw = width - 1;
  const ch = height - 1;
  if (cw <= 0 || ch <= 0) return [];

  // Precompute cell presence (all four corners valid) once as a flat mask, so the
  // edge scan below is a single array lookup per cell instead of four predicate
  // calls — this pass touches every cell of grids with millions of nodes.
  const validMask = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    if (!isInvalid(grid[i])) validMask[i] = 1;
  }
  const cells = new Uint8Array(cw * ch);
  for (let r = 0; r < ch; r++) {
    const row = r * width;
    const next = row + width;
    const out = r * cw;
    for (let c = 0; c < cw; c++) {
      cells[out + c] =
        validMask[row + c] &
        validMask[row + c + 1] &
        validMask[next + c] &
        validMask[next + c + 1];
    }
  }
  const present = (c: number, r: number) =>
    c >= 0 && c < cw && r >= 0 && r < ch && cells[r * cw + c] === 1;

  // Directed boundary edges, present region kept on the left (CCW around it), so
  // they stitch into closed loops.
  const ex0: number[] = [];
  const ey0: number[] = [];
  const ex1: number[] = [];
  const ey1: number[] = [];
  const startMap = new Map<number, number[]>();
  const key = (x: number, y: number) => x * (height + 1) + y;
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const e = ex0.length;
    ex0.push(x0);
    ey0.push(y0);
    ex1.push(x1);
    ey1.push(y1);
    const k = key(x0, y0);
    const arr = startMap.get(k);
    if (arr) arr.push(e);
    else startMap.set(k, [e]);
  };

  for (let r = 0; r < ch; r++) {
    for (let c = 0; c < cw; c++) {
      if (!present(c, r)) continue;
      if (!present(c, r - 1)) addEdge(c, r, c + 1, r);
      if (!present(c + 1, r)) addEdge(c + 1, r, c + 1, r + 1);
      if (!present(c, r + 1)) addEdge(c + 1, r + 1, c, r + 1);
      if (!present(c - 1, r)) addEdge(c, r + 1, c, r);
    }
  }

  const used = new Uint8Array(ex0.length);
  const rings: GridRing[] = [];
  for (let e0 = 0; e0 < ex0.length; e0++) {
    if (used[e0]) continue;
    const ring: number[][] = [];
    let cur = e0;
    while (cur !== -1 && !used[cur]) {
      used[cur] = 1;
      ring.push([ex0[cur], ey0[cur]]);
      const cand = startMap.get(key(ex1[cur], ey1[cur]));
      let next = -1;
      if (cand) {
        for (const ci of cand) {
          if (!used[ci]) {
            next = ci;
            break;
          }
        }
      }
      cur = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * Smooth closed rings (e.g. from {@link traceValidBoundary}) in place-agnostic
 * fashion with an iterated windowed moving average, so a grid-aligned staircase
 * collapses onto a continuous centre-line curve rather than reading as a chain
 * of steps. Points are treated as a closed loop (wrap-around) and `strength`
 * scales the averaging window; `strength <= 0` returns the rings unchanged.
 *
 * Intended for smoothing a traced data boundary before it is fed to
 * {@link triangulateGridConstrained} as a constraint, so the smooth rim is
 * honored exactly by the triangulation (and shared by any derived walls/surface).
 * Note this trades boundary fidelity for smoothness — the rim no longer follows
 * the data cell-for-cell.
 *
 * @group Geometries
 */
export function smoothRings(rings: GridRing[], strength: number): GridRing[] {
  if (strength <= 0) return rings;
  const passes = 2;
  return rings.map(ring => {
    const m = ring.length;
    if (m < 4) return ring;
    // Half-window grows with strength; capped so small loops/holes stay intact.
    const radius = Math.max(
      1,
      Math.min(Math.floor(strength * 2), Math.floor((m - 1) / 3)),
    );
    let xs = ring.map(p => p[0]);
    let zs = ring.map(p => p[1]);
    // Two box-filter passes approximate a Gaussian (a smooth, continuous curve).
    for (let p = 0; p < passes; p++) {
      const nx = new Array<number>(m);
      const nz = new Array<number>(m);
      for (let k = 0; k < m; k++) {
        let sx = 0;
        let sz = 0;
        for (let d = -radius; d <= radius; d++) {
          const j = (((k + d) % m) + m) % m;
          sx += xs[j];
          sz += zs[j];
        }
        const cnt = radius * 2 + 1;
        nx[k] = sx / cnt;
        nz[k] = sz / cnt;
      }
      xs = nx;
      zs = nz;
    }
    return xs.map((x, k) => [x, zs[k]]);
  });
}

/**
 * Triangulate an elevation grid, then slice it to the exact outline of one or
 * more polygons defined in grid coordinates (constrained Delaunay). The polygon
 * rim is honored precisely — no staircase from the grid resolution.
 *
 * When `drape` is enabled (default), each polygon edge is subdivided at every
 * grid-line crossing and those points are draped onto the surface (elevation
 * sampled from the grid), so the rim follows the relief rather than interpolating
 * linearly between the polygon's own vertices.
 *
 * When `cutHoles` is enabled, the valid-data boundary (outer extent + no-data
 * holes) is traced and added as constraints, so holes are cut with a clean rim
 * (kept region = inside the polygon(s) AND inside valid data). When disabled,
 * no-data samples are filled from valid neighbours instead.
 *
 * @param grid row-major elevation grid of length `columns * rows`
 * @param columns number of columns (nx)
 * @param scaleX column spacing in world units
 * @param scaleY row spacing in world units
 * @param nullValue value marking a missing sample
 * @param maxError greedy simplification error (grid units of height)
 * @param polygons one or more polygons (each `[outer, ...holes]`) in grid coords
 * @param drape subdivide + drape rim edges at grid-line crossings (default true)
 * @param cutHoles cut no-data holes with a traced clean rim instead of filling
 *   them (default false)
 * @param edgeSmoothing when cutting holes, smooth the traced data boundary by
 *   this strength (windowed moving average) so the rim reads as a continuous
 *   curve instead of a grid staircase; `0` keeps the exact cell-edge rim
 *   (default 0). Trades boundary fidelity for smoothness.
 */
export function triangulateGridConstrained(
  grid: Float32Array,
  columns: number,
  scaleX = 1,
  scaleY = 1,
  nullValue = -1,
  maxError = 5,
  polygons: GridPolygon[] = [],
  drape = true,
  cutHoles = false,
  edgeSmoothing = 0,
) {
  const width = columns;
  const height = grid.length / width;
  const isInvalid = (v: number) => v === nullValue || v < 0;

  // fallback fill value for no-data samples along the rim
  let sum = 0;
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (!isInvalid(v)) {
      sum += v;
      count++;
    }
  }
  const fill = count > 0 ? sum / count : 0;
  const hasNulls = count < grid.length;

  const sampleH = (cx: number, cy: number) =>
    sampleValidGrid(grid, width, height, cx, cy, isInvalid, fill);

  const d = new Delatin(grid, width, nullValue);
  d.run(maxError);
  d.beginConstraints();

  const clampX = (x: number) => Math.min(Math.max(x, 0), width - 1);
  const clampY = (y: number) => Math.min(Math.max(y, 0), height - 1);

  // Insert a ring's vertices (draped at grid-line crossings) and return the
  // ordered vertex indices so its edges can be enforced.
  const insertRing = (ring: GridRing): number[] => {
    const n = ring.length;
    if (n < 3) return [];
    const closed =
      ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
    const m = closed ? n - 1 : n;
    const verts: number[] = [];
    for (let i = 0; i < m; i++) {
      const x0 = ring[i][0];
      const y0 = ring[i][1];
      const x1 = ring[(i + 1) % m][0];
      const y1 = ring[(i + 1) % m][1];

      const gx0 = clampX(x0);
      const gy0 = clampY(y0);
      const vi = d.insertPoint(gx0, gy0, sampleH(gx0, gy0));
      if (vi >= 0 && vi !== verts[verts.length - 1]) verts.push(vi);

      if (drape) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const ts = new Set<number>();
        if (dx !== 0) {
          const lo = Math.min(x0, x1);
          const hi = Math.max(x0, x1);
          for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
            const t = (k - x0) / dx;
            if (t > 1e-9 && t < 1 - 1e-9) ts.add(t);
          }
        }
        if (dy !== 0) {
          const lo = Math.min(y0, y1);
          const hi = Math.max(y0, y1);
          for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
            const t = (k - y0) / dy;
            if (t > 1e-9 && t < 1 - 1e-9) ts.add(t);
          }
        }
        const sorted = Array.from(ts).sort((a, b) => a - b);
        for (const t of sorted) {
          const cx = clampX(x0 + dx * t);
          const cy = clampY(y0 + dy * t);
          const ci = d.insertPoint(cx, cy, sampleH(cx, cy));
          if (ci >= 0 && ci !== verts[verts.length - 1]) verts.push(ci);
        }
      }
    }
    return verts;
  };

  // Gather all constraint rings: user polygon rings plus (optionally) the traced
  // valid-data boundary so no-data holes get a clean cut rim.
  const rings: GridRing[] = [];
  for (const poly of polygons) for (const ring of poly) rings.push(ring);
  let dataRings =
    cutHoles && hasNulls ? traceValidBoundary(grid, width, isInvalid) : [];
  if (edgeSmoothing > 0 && dataRings.length) {
    dataRings = smoothRings(dataRings, edgeSmoothing);
  }
  for (const ring of dataRings) rings.push(ring);

  const ringVerts = rings.map(insertRing).filter(v => v.length >= 3);

  // Enforce the constraint edges between consecutive vertices.
  for (const verts of ringVerts) {
    for (let i = 0; i < verts.length; i++) {
      d.constrainEdge(verts[i], verts[(i + 1) % verts.length]);
    }
  }

  // Trim to the kept region: inside the polygon(s) AND inside valid data.
  const insidePoly = polygons.length ? makeGridInside(polygons) : null;
  const insideData = dataRings.length ? makeEvenOddInside(dataRings) : null;
  if (insidePoly || insideData) {
    d.removeExteriorTriangles(
      (x, y) =>
        (insidePoly ? insidePoly(x, y) : true) &&
        (insideData ? insideData(x, y) : true),
    );
  }

  const positions = new Float32Array(d.coords.length * 1.5);
  const uvs = new Float32Array(d.coords.length);

  for (let i = 0, j = 0; i < d.coords.length; i += 2) {
    const x = d.coords[i];
    const y = d.coords[i + 1];
    const vertex = i >> 1;
    uvs[i] = x / (width - 1);
    uvs[i + 1] = 1 - y / (height - 1);
    j = i * 1.5;
    positions[j] = x * scaleX;
    if (d.isExplicit(vertex)) {
      positions[j + 1] = d.vertexHeight(vertex);
    } else {
      const v = grid[width * y + x];
      positions[j + 1] = isInvalid(v) ? sampleH(x, y) : v;
    }
    positions[j + 2] = y * scaleY;
  }

  const indices = new Uint32Array(d.triangles);
  return { positions, uvs, indices };
}
