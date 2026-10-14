import { Delatin } from './delatin';
import { makeGridInside } from './grid-inside';
import { nodeGridRings } from './grid-noding';
import { STACK_NO_DATA } from './surface-stack-candidates';
import { sortTrianglesSpatially } from './triangle-order';
import type { GridPolygon, GridRing } from './triangulate-grid-delaunay';

// ⚠️ Kept free of three.js: the stack worker pool runs `tessellateStackTile`.

/**
 * A polyline a tile inserts, as `[x0, y0, x1, y1, …]` in grid coordinates.
 *
 * @group Geometries
 */
export type StackTileChain = {
  points: Float64Array;
  // the last point connects back to the first
  closed: boolean;
  /**
   * Per point, every layer's height (`point × layers + layer`), on a line a
   * coarser level may thin — a pinch-out line. Its two ends are never thinned.
   */
  heights?: Float32Array;
};

/**
 * Coarser levels to triangulate a tile at as well (see `StackTileInput.lod`).
 *
 * @group Geometries
 */
export type StackTileLod = {
  /** per refinement node (aligned with `nodes`), how many coarser levels keep it */
  nodeLevels: Uint8Array;
  /** per coarser level: `[height error, plan tolerance in cells]` */
  levels: [number, number][];
  /** layers per point in `StackTileChain.heights` */
  layers: number;
};

/**
 * One tile of a tiled stack tessellation: everything it inserts, in grid
 * coordinates. Plain data, so it can be posted to a worker.
 *
 * @group Geometries
 */
export type StackTileInput = {
  /** `[x0, y0, x1, y1]`; inner sides lie on half-cell seam lines */
  bounds: [number, number, number, number];
  /** which sides are seams shared with a neighbour: `[x0, y0, x1, y1]` */
  shared: [boolean, boolean, boolean, boolean];
  /** the points on its seams, which the neighbour inserts as well */
  seams: Float64Array;
  /** refinement nodes */
  nodes: Float64Array;
  /** the outline's pieces in this tile, all inserted before any is locked */
  rim: StackTileChain[];
  /** cut, coverage and pinch-out pieces, locked in this order */
  chains: StackTileChain[];
  /** the outline, to trim the exterior */
  polygons: GridPolygon[];
  /** coarser levels to triangulate it at too */
  lod?: StackTileLod;
};

/**
 * A tile at one coarser level: the same seams and outline, fewer refinement
 * nodes, and its pinch-out lines thinned.
 *
 * @group Geometries
 */
export type StackTileLevel = {
  coords: Float64Array;
  /** the kept triangles, in spatial order */
  triangles: Uint32Array;
  /** per point of each chain as given, its vertex (-1 if thinned out or outside) */
  chains: Int32Array[];
  constraintFailures: number;
};

/**
 * @group Geometries
 */
export type StackTileOutput = {
  coords: Float64Array;
  /** the kept triangles, in spatial order */
  triangles: Uint32Array;
  /** per point of each rim piece, its vertex (-1 if it fell outside) */
  rim: Int32Array[];
  /** per point of each chain, its vertex (-1 if it fell outside) */
  chains: Int32Array[];
  constraintFailures: number;
  /** per coarser level (see `StackTileInput.lod`) */
  levels?: StackTileLevel[];
  /** its own time, wherever it ran (ms) */
  tileMs: number;
};

const EMPTY = new Float32Array(0);

/**
 * Triangulate one tile by insertion: its seam points first, so the boundary it
 * shares with each neighbour is the same chain on both sides, then the
 * refinement nodes, then the constraints. Trimmed to the outline and returned in
 * spatial order.
 *
 * @group Geometries
 */
export function tessellateStackTile(input: StackTileInput): StackTileOutput {
  const start = performance.now();
  const mesh = new Delatin(EMPTY, 1, STACK_NO_DATA, input.bounds);
  const { seams, nodes } = input;
  for (let i = 0; i < seams.length; i += 2) {
    mesh.insertPoint(seams[i], seams[i + 1], 0);
  }
  for (let i = 0; i < nodes.length; i += 2) {
    mesh.insertPoint(nodes[i], nodes[i + 1], 0);
  }

  const insert = (chain: StackTileChain) => {
    const out = new Int32Array(chain.points.length >> 1);
    for (let k = 0; k < out.length; k++) {
      out[k] = mesh.insertPoint(
        chain.points[2 * k],
        chain.points[2 * k + 1],
        0,
      );
    }
    return out;
  };

  // A piece running along a seam is already the shared boundary there.
  const onSeam = makeSeamTest(input);
  const alongSeam = (points: Float64Array, a: number, b: number) =>
    onSeam(points[2 * a], points[2 * a + 1], points[2 * b], points[2 * b + 1]);

  const rim = input.rim.map(chain => {
    const inserted = insert(chain);
    const verts: number[] = [];
    const at: number[] = [];
    inserted.forEach((vi, k) => {
      if (vi >= 0 && vi !== verts[verts.length - 1]) {
        verts.push(vi);
        at.push(k);
      }
    });
    if (chain.closed && verts.length < 3) return inserted;
    const edges = chain.closed ? verts.length : verts.length - 1;
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % verts.length;
      if (alongSeam(chain.points, at[i], at[j])) continue;
      mesh.constrainEdge(verts[i], verts[j]);
    }
    return inserted;
  });

  const chains = input.chains.map(chain => {
    const out = new Int32Array(chain.points.length >> 1);
    for (let k = 0; k < out.length; k++) {
      out[k] = mesh.insertPoint(
        chain.points[2 * k],
        chain.points[2 * k + 1],
        0,
      );
      const a = out[k - 1];
      const b = out[k];
      if (k > 0 && a >= 0 && b >= 0 && a !== b) {
        if (!alongSeam(chain.points, k - 1, k)) mesh.constrainEdge(a, b);
      }
    }
    return out;
  });

  mesh.removeExteriorTriangles(makeGridInside(input.polygons));
  const outline = input.lod ? outlinePoints(mesh, onSeam) : undefined;
  return {
    coords: Float64Array.from(mesh.coords),
    triangles: sortTrianglesSpatially(mesh.triangles, mesh.coords),
    rim,
    chains,
    constraintFailures: mesh.constraintFailures,
    levels: input.lod?.levels.map((_, k) =>
      tessellateTileLevel(input, k + 1, outline!),
    ),
    tileMs: performance.now() - start,
  };
}

/**
 * The points on a tile's outline — its boundary, but for the seams it shares —
 * as `[x0, y0, x1, y1, …]`. The walls are built along the full level's, so every
 * coarser level keeps all of them: a grid node lying ON the rim included.
 */
function outlinePoints(
  mesh: Delatin,
  onSeam: (ax: number, ay: number, bx: number, by: number) => boolean,
): Float64Array {
  const { triangles: t, coords: c } = mesh;
  const V = c.length >> 1;
  const uses = new Map<number, number>();
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const u = t[i + k];
      const v = t[i + ((k + 1) % 3)];
      const key = u < v ? u * V + v : v * V + u;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const points = new Set<number>();
  for (const [key, n] of uses) {
    if (n !== 1) continue;
    const u = Math.floor(key / V);
    const v = key - u * V;
    if (onSeam(c[2 * u], c[2 * u + 1], c[2 * v], c[2 * v + 1])) continue;
    points.add(u);
    points.add(v);
  }
  const out = new Float64Array(points.size * 2);
  let at = 0;
  for (const v of points) {
    out[at++] = c[2 * v];
    out[at++] = c[2 * v + 1];
  }
  return out;
}

/**
 * One tile at coarser `level`: the full seams and outline, the nodes that level
 * keeps, and each pinch-out line thinned between its fixed ends. Thinned lines
 * cross where the full ones did not, so the pieces are noded again here.
 *
 * @param outline the full level's outline points (see `outlinePoints`)
 */
function tessellateTileLevel(
  input: StackTileInput,
  level: number,
  outline: Float64Array,
): StackTileLevel {
  const lod = input.lod!;
  const [error, tolerance] = lod.levels[level - 1];
  const mesh = new Delatin(EMPTY, 1, STACK_NO_DATA, input.bounds);
  const { seams, nodes } = input;
  for (let i = 0; i < seams.length; i += 2) {
    mesh.insertPoint(seams[i], seams[i + 1], 0);
  }
  for (let i = 0; i < nodes.length; i += 2) {
    if (lod.nodeLevels[i >> 1] >= level) {
      mesh.insertPoint(nodes[i], nodes[i + 1], 0);
    }
  }
  // Before the rim is locked: a rim edge through one of them splits there.
  for (let i = 0; i < outline.length; i += 2) {
    mesh.insertPoint(outline[i], outline[i + 1], 0);
  }

  const toRing = (points: Float64Array, keep?: Uint8Array) => {
    const ring: GridRing = [];
    for (let k = 0; k < points.length >> 1; k++) {
      if (!keep || keep[k]) ring.push([points[2 * k], points[2 * k + 1]]);
    }
    return ring;
  };
  const kept = input.chains.map(chain => {
    if (!chain.heights) return undefined;
    const keep = thinChain(
      chain.points,
      chain.heights,
      lod.layers,
      error,
      tolerance,
    );
    // Nothing nodes a line against itself, so a hairpin thinned into a crossing
    // could not be enforced: it stays as it is.
    return chainCrossesItself(toRing(chain.points, keep)) ? undefined : keep;
  });
  const pieces = [
    ...input.rim.map(chain => toRing(chain.points)),
    ...input.chains.map((chain, c) => toRing(chain.points, kept[c])),
  ];
  const open = [
    ...input.rim.map(chain => !chain.closed),
    ...input.chains.map(() => true),
  ];
  const noded = nodeGridRings(pieces, open);

  const onSeam = makeSeamTest(input);
  // Points keep their identity through the noding, so a given one is found again.
  const vertexAt = new Map<number[], number>();
  const lock = (ring: GridRing, closed: boolean) => {
    const verts: number[] = [];
    const at: number[][] = [];
    for (const p of ring) {
      const v = mesh.insertPoint(p[0], p[1], 0);
      vertexAt.set(p, v);
      if (v >= 0 && v !== verts[verts.length - 1]) {
        verts.push(v);
        at.push(p);
      }
    }
    if (closed && verts.length < 3) return;
    const edges = closed ? verts.length : verts.length - 1;
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % verts.length;
      if (verts[i] === verts[j]) continue;
      if (onSeam(at[i][0], at[i][1], at[j][0], at[j][1])) continue;
      mesh.constrainEdge(verts[i], verts[j]);
    }
  };
  noded.forEach((ring, r) => lock(ring, !open[r]));

  const rims = input.rim.length;
  const chains = input.chains.map((chain, c) => {
    const out = new Int32Array(chain.points.length >> 1).fill(-1);
    const given = pieces[rims + c];
    let j = 0;
    for (let k = 0; k < out.length; k++) {
      if (kept[c] && !kept[c]![k]) continue;
      out[k] = vertexAt.get(given[j++]) ?? -1;
    }
    return out;
  });

  mesh.removeExteriorTriangles(makeGridInside(input.polygons));
  return {
    coords: Float64Array.from(mesh.coords),
    triangles: sortTrianglesSpatially(mesh.triangles, mesh.coords),
    chains,
    constraintFailures: mesh.constraintFailures,
  };
}

/** Whether a segment runs along one of the tile's shared sides. */
function makeSeamTest(input: StackTileInput) {
  const [x0, y0, x1, y1] = input.bounds;
  const [sx0, sy0, sx1, sy1] = input.shared;
  return (ax: number, ay: number, bx: number, by: number) =>
    (sx0 && ax === x0 && bx === x0) ||
    (sx1 && ax === x1 && bx === x1) ||
    (sy0 && ay === y0 && by === y0) ||
    (sy1 && ay === y1 && by === y1);
}

/**
 * Whether two non-adjacent segments of an open polyline cross or touch. Ends that
 * coincide (a closed loop cut open) count as adjacent.
 */
function chainCrossesItself(ring: GridRing): boolean {
  const n = ring.length - 1;
  if (n < 3) return false;
  const looped =
    ring[0][0] === ring[n][0] && ring[0][1] === ring[n][1];
  const orient = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    for (let j = i + 2; j < n; j++) {
      if (looped && i === 0 && j === n - 1) continue;
      const c = ring[j];
      const d = ring[j + 1];
      if (
        Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
        Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
        Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
        Math.max(c[1], d[1]) < Math.min(a[1], b[1])
      ) {
        continue;
      }
      if (
        orient(a, b, c) * orient(a, b, d) <= 0 &&
        orient(c, d, a) * orient(c, d, b) <= 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Which points of a line to keep at a coarser level: Douglas–Peucker between its
 * fixed ends, splitting where a point lies more than `tolerance` off the chord in
 * plan or, failing that, where any layer's height is more than `error` off it.
 *
 * @param heights per point, every layer's height (`point × layers + layer`)
 *
 * @group Geometries
 */
export function thinChain(
  points: Float64Array,
  heights: Float32Array,
  layers: number,
  error: number,
  tolerance: number,
): Uint8Array {
  const n = points.length >> 1;
  const keep = new Uint8Array(n);
  if (n === 0) return keep;
  keep[0] = 1;
  keep[n - 1] = 1;
  const tolSq = tolerance * tolerance;
  const stack = [0, n - 1];
  while (stack.length > 0) {
    const j = stack.pop()!;
    const i = stack.pop()!;
    if (j <= i + 1) continue;
    const ax = points[2 * i];
    const ay = points[2 * i + 1];
    const dx = points[2 * j] - ax;
    const dy = points[2 * j + 1] - ay;
    const len = dx * dx + dy * dy;
    const along = (k: number) =>
      len > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((points[2 * k] - ax) * dx + (points[2 * k + 1] - ay) * dy) / len,
            ),
          )
        : 0;
    let worst = -1;
    let worstAt = -1;
    for (let k = i + 1; k < j; k++) {
      const s = along(k);
      const ex = ax + s * dx - points[2 * k];
      const ey = ay + s * dy - points[2 * k + 1];
      const d = ex * ex + ey * ey;
      if (d > worst) {
        worst = d;
        worstAt = k;
      }
    }
    if (worst <= tolSq) {
      worst = -1;
      worstAt = -1;
      for (let k = i + 1; k < j; k++) {
        const s = along(k);
        for (let c = 0; c < layers; c++) {
          const hA = heights[i * layers + c];
          const e = Math.abs(
            hA + s * (heights[j * layers + c] - hA) - heights[k * layers + c],
          );
          if (e > worst) {
            worst = e;
            worstAt = k;
          }
        }
      }
      if (worst <= error) continue;
    }
    keep[worstAt] = 1;
    stack.push(i, worstAt, worstAt, j);
  }
  return keep;
}

/**
 * The buffers a tile input can be transferred by (`polygons` is the whole
 * outline, shared between tiles, so it is copied instead).
 *
 * @group Geometries
 */
export function stackTileInputBuffers(tile: StackTileInput): ArrayBuffer[] {
  return transferable([
    tile.seams,
    tile.nodes,
    ...tile.rim.map(c => c.points),
    ...tile.chains.flatMap(c => (c.heights ? [c.points, c.heights] : [c.points])),
    ...(tile.lod ? [tile.lod.nodeLevels] : []),
  ]);
}

/**
 * The buffers a tile output can be transferred by.
 *
 * @group Geometries
 */
export function stackTileOutputBuffers(output: StackTileOutput): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [
    output.coords,
    output.triangles,
    ...output.rim,
    ...output.chains,
  ];
  for (const level of output.levels ?? []) {
    arrays.push(level.coords, level.triangles, ...level.chains);
  }
  return transferable(arrays);
}

// A buffer listed twice makes `postMessage` throw.
function transferable(arrays: ArrayBufferView[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const a of arrays) {
    if (a.byteLength > 0) buffers.add(a.buffer as ArrayBuffer);
  }
  return [...buffers];
}

/**
 * Join tiles into one mesh: vertices numbered in triangle order (tile by tile),
 * a vertex on a seam shared by every tile that holds it.
 *
 * @param seamX the vertical seams' x
 * @param seamY the horizontal seams' y
 * @returns the mesh, and `vertexOf(tile, local)` — the joined vertex, or -1 when
 *   no kept triangle uses it
 *
 * @group Geometries
 */
export function stitchStackTiles(
  outputs: Pick<StackTileOutput, 'coords' | 'triangles'>[],
  seamX: number[],
  seamY: number[],
) {
  const xs = new Set(seamX);
  const ys = new Set(seamY);
  const shared = new Map<string, number>();
  const keyOf = (x: number, y: number) =>
    xs.has(x) || ys.has(y) ? `${x},${y}` : null;
  const coords: number[] = [];
  const remaps = outputs.map(o =>
    new Int32Array(o.coords.length >> 1).fill(-1),
  );
  const indices = new Uint32Array(
    outputs.reduce((sum, o) => sum + o.triangles.length, 0),
  );
  let at = 0;
  outputs.forEach((o, tile) => {
    const remap = remaps[tile];
    for (let i = 0; i < o.triangles.length; i++) {
      const v = o.triangles[i];
      let g = remap[v];
      if (g < 0) {
        const x = o.coords[2 * v];
        const y = o.coords[2 * v + 1];
        const key = keyOf(x, y);
        g = key === null ? -1 : (shared.get(key) ?? -1);
        if (g < 0) {
          g = coords.length >> 1;
          coords.push(x, y);
          if (key !== null) shared.set(key, g);
        }
        remap[v] = g;
      }
      indices[at++] = g;
    }
  });
  const vertexOf = (tile: number, local: number) => {
    if (local < 0) return -1;
    const g = remaps[tile][local];
    if (g >= 0) return g;
    const o = outputs[tile];
    const key = keyOf(o.coords[2 * local], o.coords[2 * local + 1]);
    return key === null ? -1 : (shared.get(key) ?? -1);
  };
  return { coords, indices, vertexOf };
}

/**
 * Where a seam's height profile needs a vertex so that every layer stays within
 * `maxError` along it — a seam is a shared boundary, so nothing else refines it.
 *
 * The seam runs on a half-cell line between two grid lines, where bilinear
 * sampling is the mean of the two; that profile is greedily simplified per layer
 * and the kept positions are unioned, as the 2D refinement does.
 *
 * @param channels the layers' heights on the common grid
 * @param nx the grid's column count
 * @param axis `'x'` for a vertical seam at `x = line`, `'y'` for a horizontal one
 * @param line the seam's position, half-way between two grid lines
 * @param from first grid position along the seam (inclusive)
 * @param to last grid position along the seam (inclusive)
 * @returns the kept grid positions along the seam, ascending
 *
 * @group Geometries
 */
export function refineStackSeam(
  channels: Float32Array[],
  nx: number,
  axis: 'x' | 'y',
  line: number,
  from: number,
  to: number,
  maxError: number,
): number[] {
  const count = to - from + 1;
  if (count <= 0) return [];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const lo = Math.floor(line);
  const profile = new Float64Array(count);
  const stack: number[] = [];
  for (const channel of channels) {
    for (let i = 0; i < count; i++) {
      const p = from + i;
      const a = axis === 'x' ? channel[p * nx + lo] : channel[lo * nx + p];
      const b =
        axis === 'x' ? channel[p * nx + lo + 1] : channel[(lo + 1) * nx + p];
      profile[i] =
        a === STACK_NO_DATA ? b : b === STACK_NO_DATA ? a : (a + b) / 2;
    }
    stack.push(0, count - 1);
    while (stack.length > 0) {
      const b = stack.pop()!;
      const a = stack.pop()!;
      let worst = -1;
      let error = maxError;
      for (let i = a + 1; i < b; i++) {
        const expected =
          profile[a] + ((profile[b] - profile[a]) * (i - a)) / (b - a);
        const e = Math.abs(profile[i] - expected);
        if (e > error) {
          error = e;
          worst = i;
        }
      }
      if (worst < 0) continue;
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(from + i);
  return out;
}
