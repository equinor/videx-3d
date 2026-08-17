import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';
import { StackSectionSource } from './surface-section';

/**
 * A point located in a stack's shared tessellation: which triangle, and the
 * barycentric weights within it.
 *
 * ⭐ Every layer of a stack shares one set of triangles and one set of XZ
 * positions — only the heights differ. So a point is located ONCE and every
 * layer's height at that point is the same weighted sum over different height
 * arrays, which is what makes sampling a whole column along a curve cheap.
 *
 * @group Geometries
 */
export type StackLocation = {
  triangle: number;
  wa: number;
  wb: number;
  wc: number;
};

/** Point location against a stack's shared tessellation. @group Geometries */
export type StackLocator = {
  locate(x: number, z: number, out?: StackLocation): StackLocation | null;
  /** interpolate one per-vertex channel at a located point */
  valueAt(location: StackLocation, channel: ArrayLike<number>): number;
};

/** Barycentric slack, enough to catch a shared edge rather than fall between two. */
const EPS = 1e-9;

/** Target triangles per bucket of the lookup grid. */
const CELL_TRIANGLES = 32;

/**
 * Build a point locator over a stack's shared triangles.
 *
 * Triangles are bucketed into a uniform XZ grid by the cells their bounding box
 * OVERLAPS — not by their centroid — so a query reads exactly one bucket.
 *
 * @group Geometries
 */
export function createStackLocator(
  positionsXZ: Float32Array,
  indices: Uint32Array,
): StackLocator {
  const triangles = (indices.length / 3) | 0;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positionsXZ.length; i += 2) {
    const x = positionsXZ[i];
    const z = positionsXZ[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const width = maxX - minX || 1;
  const depth = maxZ - minZ || 1;
  const cell = Math.sqrt(
    (width * depth * CELL_TRIANGLES) / Math.max(triangles, 1),
  );
  const columns = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(depth / cell));
  const columnOf = (x: number) =>
    Math.min(
      columns - 1,
      Math.max(0, Math.floor(((x - minX) / width) * columns)),
    );
  const rowOf = (z: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor(((z - minZ) / depth) * rows)));

  const counts = new Uint32Array(columns * rows + 1);
  const span = (t: number) => {
    const a = indices[3 * t];
    const b = indices[3 * t + 1];
    const c = indices[3 * t + 2];
    const x0 = Math.min(
      positionsXZ[2 * a],
      positionsXZ[2 * b],
      positionsXZ[2 * c],
    );
    const x1 = Math.max(
      positionsXZ[2 * a],
      positionsXZ[2 * b],
      positionsXZ[2 * c],
    );
    const z0 = Math.min(
      positionsXZ[2 * a + 1],
      positionsXZ[2 * b + 1],
      positionsXZ[2 * c + 1],
    );
    const z1 = Math.max(
      positionsXZ[2 * a + 1],
      positionsXZ[2 * b + 1],
      positionsXZ[2 * c + 1],
    );
    return [columnOf(x0), rowOf(z0), columnOf(x1), rowOf(z1)];
  };
  for (let t = 0; t < triangles; t++) {
    const [c0, r0, c1, r1] = span(t);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) counts[r * columns + c + 1]++;
  }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const starts = counts;
  const cursor = starts.slice();
  const items = new Uint32Array(starts[starts.length - 1]);
  for (let t = 0; t < triangles; t++) {
    const [c0, r0, c1, r1] = span(t);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) items[cursor[r * columns + c]++] = t;
  }

  const locate = (x: number, z: number, out?: StackLocation) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    const bucket = rowOf(z) * columns + columnOf(x);
    for (let i = starts[bucket]; i < starts[bucket + 1]; i++) {
      const t = items[i];
      const a = indices[3 * t];
      const b = indices[3 * t + 1];
      const c = indices[3 * t + 2];
      const ax = positionsXZ[2 * a];
      const az = positionsXZ[2 * a + 1];
      const ux = positionsXZ[2 * b] - ax;
      const uz = positionsXZ[2 * b + 1] - az;
      const vx = positionsXZ[2 * c] - ax;
      const vz = positionsXZ[2 * c + 1] - az;
      const det = ux * vz - vx * uz;
      if (det === 0) continue;
      const px = x - ax;
      const pz = z - az;
      const wb = (px * vz - vx * pz) / det;
      const wc = (ux * pz - px * uz) / det;
      if (wb < -EPS || wc < -EPS || wb + wc > 1 + EPS) continue;
      const result = out ?? { triangle: 0, wa: 0, wb: 0, wc: 0 };
      result.triangle = t;
      result.wa = 1 - wb - wc;
      result.wb = wb;
      result.wc = wc;
      return result;
    }
    return null;
  };

  return {
    locate,
    valueAt: (location, channel) => {
      const t = location.triangle;
      return (
        location.wa * channel[indices[3 * t]] +
        location.wb * channel[indices[3 * t + 1]] +
        location.wc * channel[indices[3 * t + 2]]
      );
    },
  };
}

/** One interval's cut face along a fence. @group Geometries */
export type FenceRibbon = {
  /** the interval, i.e. the index of the layer above it */
  interval: number;
  geometry: BufferGeometry;
};

/** {@link buildFenceRibbons} options. */
export type FenceRibbonOptions = {
  /** distance along the fence at a point, for the face's `u` */
  along?: (x: number, z: number) => number;
  /** metres to move the face toward the kept side, along -normal. Default 0. */
  offset?: number;
  /** flip which way the face looks */
  flip?: boolean;
};

/**
 * Add the point where the path crosses the edge of the tessellation.
 *
 * ⚠️ Without this the quad straddling the boundary is dropped whole, so the face
 * stops at the last sample that happened to land inside — up to one resample step
 * short of the wall, while the cut it closes runs all the way to it. That leftover
 * is a full-height slit at the end of the fence, and its width is whatever
 * fraction of a step remains, so it comes and goes with the data.
 */
function refineAtBoundary(path: Vec2[], locator: StackLocator): Vec2[] {
  const inside = path.map(p => !!locator.locate(p[0], p[1]));
  const refined: Vec2[] = [];
  for (let k = 0; k < path.length; k++) {
    refined.push(path[k]);
    if (k + 1 >= path.length || inside[k] === inside[k + 1]) continue;
    // Bisect toward the outside end, keeping the last point that still locates.
    const from = inside[k] ? path[k] : path[k + 1];
    const to = inside[k] ? path[k + 1] : path[k];
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) * 0.5;
      const x = from[0] + (to[0] - from[0]) * mid;
      const z = from[1] + (to[1] - from[1]) * mid;
      if (locator.locate(x, z)) lo = mid;
      else hi = mid;
    }
    // Either way round the crossing belongs between path[k] and path[k + 1].
    if (lo > 0)
      refined.push([
        from[0] + (to[0] - from[0]) * lo,
        from[1] + (to[1] - from[1]) * lo,
      ] as Vec2);
  }
  return refined;
}

/**
 * Build the cut face of every filled interval as a ribbon along a curve.
 *
 * ⭐⭐ The face is INDEPENDENT of the tessellation. Where cutting cells makes the
 * face inherit the TIN's own resolution — which on a field-sized stack is tens of
 * metres, and which systematically pulls the face toward the well at every bend
 * (a distance field is convex there, so interpolating it linearly overestimates)
 * — a ribbon follows the curve at whatever spacing it was sampled with, and takes
 * only its HEIGHTS from the tessellation. Those come from the triangles, so the
 * ribbon's top edge lies exactly on the drawn surface it has to meet.
 *
 * ⭐ Normals come from the path's own tangent, so the face is smooth along its
 * length by construction rather than faceted per cell.
 *
 * @param source the stack's channels
 * @param path the curve in scene XZ, already sampled at the wanted spacing
 * @param options see {@link FenceRibbonOptions}
 *
 * @group Geometries
 */
export function buildFenceRibbons(
  source: StackSectionSource,
  path: Vec2[],
  options: FenceRibbonOptions = {},
): FenceRibbon[] {
  if (path.length < 2) return [];
  const { positionsXZ, indices, heights, intervals } = source;
  const locator = createStackLocator(positionsXZ, indices);
  const offset = options.offset ?? 0;
  const layers = heights.length;

  path = refineAtBoundary(path, locator);

  // Locate every sample once; each layer's height is then the same weighted sum
  // over a different height array.
  const located: (StackLocation | null)[] = path.map(p =>
    locator.locate(p[0], p[1], { triangle: 0, wa: 0, wb: 0, wc: 0 }),
  );
  const y: Float64Array[] = [];
  for (let l = 0; l < layers; l++) {
    const column = new Float64Array(path.length);
    for (let k = 0; k < path.length; k++) {
      const at = located[k];
      column[k] = at ? locator.valueAt(at, heights[l]) : 0;
    }
    y.push(column);
  }
  const marks: (Float64Array | null)[] = [];
  for (let l = 0; l < layers; l++) {
    const channel = source.inferred?.[l];
    if (!channel) {
      marks.push(null);
      continue;
    }
    const column = new Float64Array(path.length);
    for (let k = 0; k < path.length; k++) {
      const at = located[k];
      column[k] = at ? locator.valueAt(at, channel) : 0;
    }
    marks.push(column);
  }

  // A central difference gives each sample the tangent of the curve rather than
  // of one segment, so adjacent quads share a normal and the face reads smooth.
  const sign = options.flip ? -1 : 1;
  const normals: Vec2[] = path.map((_, k) => {
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(path.length - 1, k + 1)];
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const len = Math.hypot(tx, tz) || 1;
    return [(-tz / len) * sign, (tx / len) * sign];
  });

  const ribbons: FenceRibbon[] = [];
  for (let interval = 0; interval + 1 < layers; interval++) {
    const members = intervals[interval];
    if (!members) continue;
    const top = y[interval];
    const bottom = y[interval + 1];
    const markTop = marks[interval];
    const markBottom = marks[interval + 1];

    const position: number[] = [];
    const normal: number[] = [];
    const uv: number[] = [];
    const wallV: number[] = [];
    const inferred: number[] = [];

    for (let k = 0; k + 1 < path.length; k++) {
      const a = located[k];
      const b = located[k + 1];
      // Outside the tessellation, or where this interval holds no volume — the
      // membership flags are per triangle, so a hole in the unit opens a gap in
      // the face rather than a wall standing over nothing.
      if (!a || !b || !members[a.triangle] || !members[b.triangle]) continue;
      const t0 = top[k];
      const b0 = bottom[k];
      const t1 = top[k + 1];
      const b1 = bottom[k + 1];
      if (t0 - b0 <= 0 && t1 - b1 <= 0) continue;

      const p0 = path[k];
      const p1 = path[k + 1];
      const n0 = normals[k];
      const n1 = normals[k + 1];
      const x0 = p0[0] - n0[0] * offset;
      const z0 = p0[1] - n0[1] * offset;
      const x1 = p1[0] - n1[0] * offset;
      const z1 = p1[1] - n1[1] * offset;
      const u0 = options.along ? options.along(p0[0], p0[1]) : 0;
      const u1 = options.along ? options.along(p1[0], p1[1]) : 0;
      const m0 = Math.max(markTop?.[k] ?? 0, markBottom?.[k] ?? 0);
      const m1 = Math.max(markTop?.[k + 1] ?? 0, markBottom?.[k + 1] ?? 0);

      // Two triangles wound so the face looks along +normal.
      const push = (
        x: number,
        h: number,
        z: number,
        nx: number,
        nz: number,
        u: number,
        v: number,
        mark: number,
      ) => {
        position.push(x, h, z);
        normal.push(nx, 0, nz);
        uv.push(u, h);
        wallV.push(v);
        inferred.push(mark);
      };
      push(x0, t0, z0, n0[0], n0[1], u0, 1, m0);
      push(x0, b0, z0, n0[0], n0[1], u0, 0, m0);
      push(x1, b1, z1, n1[0], n1[1], u1, 0, m1);
      push(x0, t0, z0, n0[0], n0[1], u0, 1, m0);
      push(x1, b1, z1, n1[0], n1[1], u1, 0, m1);
      push(x1, t1, z1, n1[0], n1[1], u1, 1, m1);
    }

    if (position.length === 0) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(position), 3),
    );
    geometry.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normal), 3),
    );
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geometry.setAttribute(
      'wallV',
      new BufferAttribute(new Float32Array(wallV), 1),
    );
    if (inferred.some(v => v > 0)) {
      geometry.setAttribute(
        'inferred',
        new BufferAttribute(new Float32Array(inferred), 1),
      );
    }
    ribbons.push({ interval, geometry });
  }
  return ribbons;
}
