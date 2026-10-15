import { sampleValidGrid } from './grid-sampling';
import type { StackReference, StackTessellation } from './surface-stack';
import { STACK_NO_DATA } from './surface-stack-candidates';
import { surfaceGridToWorld } from './surface-grid';
import { createTinSampler, TinLocation } from './tin-sampler';

/**
 * Every layer's OWN surface: the TIN its refinement built for it alone (see
 * `collectStackCandidateLevels`), before the layers were merged into one shared
 * tessellation.
 *
 * @group Geometries
 */
export type StackOwnSurfaces = {
  /** per layer, its TIN's vertices as grid nodes (`row * nx + col`) */
  nodes: Uint32Array[];
  /** per layer, its TIN's triangles, indexing `nodes`; empty to sample the layer from its grid */
  triangles: (Uint16Array | Uint32Array)[];
  /**
   * Per layer, grid nodes added along ITS lines — the pinch-outs of the pairs it
   * belongs to, its data edge — which keep its grid height.
   */
  lineNodes?: Uint32Array[][];
};

/**
 * What {@link sampleStackOwnSurfaces} returns.
 *
 * @group Geometries
 */
export type StackOwnSamples = {
  /** one per layer, indexed by shared vertex */
  heights: Float32Array[];
  /**
   * Per layer, unit normals as snorm16 (3 per shared vertex, facing up); `null`
   * for a layer with no TIN of its own, or whose normals were not asked for.
   */
  normals: (Int16Array | null)[];
};

const isNoData = (v: number) => v === STACK_NO_DATA;

/** How far past the threshold a pair the grid has thick is kept, when its own surfaces would make it thin. */
const THICK_MARGIN = 0.01;

/**
 * Options for {@link sampleStackOwnSurfaces}, {@link prepareStackOwnSurfaces}
 * and {@link createStackOwnCombiner}.
 *
 * @group Geometries
 */
export type StackOwnSampleOptions = {
  /** per layer, whether to compute its normals (default: all) */
  normals?: boolean[];
  /** the collapse threshold the pairs are judged by. Default 0.5. */
  threshold?: number;
  /** per layer, true where it does not truncate the layer below it — a fluid, the sea */
  nonTruncating?: boolean[];
};

/**
 * One layer's share of {@link sampleStackOwnSurfaces}: everything that needs no
 * other layer, for {@link sampleStackOwnLayer}. Free of three.js, so the stack
 * worker pool can run it.
 *
 * @group Geometries
 */
export type StackOwnLayerJob = {
  /** the shared vertices, `(column, row)` interleaved */
  coords: Float32Array;
  /** the layer's heights over the common grid */
  channel: Float32Array;
  nx: number;
  ny: number;
  /** its TIN's vertices as grid nodes, or `null` to sample it from its grid */
  nodes: Uint32Array | null;
  /** its TIN's triangles, indexing `nodes` */
  triangles: Uint16Array | Uint32Array | null;
  /** per shared vertex, 1 where it keeps its grid height */
  exact: Uint8Array | null;
  /**
   * Grid to scene XZ, `x = a·col + b·row + c` and `z = d·col + e·row + f`, to
   * compute the normals in; `null` for no normals.
   */
  toScene: [number, number, number, number, number, number] | null;
};

/**
 * One layer sampled by {@link sampleStackOwnLayer}.
 *
 * @group Geometries
 */
export type StackOwnLayer = {
  /** its grid height at each shared vertex */
  grid: Float32Array;
  /** its own surface's height there — the grid's where kept */
  y: Float32Array;
  /** its own surface's normals there (snorm16, 3 each), when asked for */
  normals: Int16Array | null;
};

/**
 * Sample every layer's height and shading normal at the shared vertices FROM ITS
 * OWN SURFACE.
 *
 * The shared tessellation is the union of every layer's refinement, so each cap
 * also carries the vertices the OTHER layers needed: their nodes, their pinch-out
 * lines, the tile seams. Taken from the grid, such a vertex sits up to `maxError`
 * off the layer's own TIN, and the slivers it makes with the layer's own vertices
 * tilt — so a surface looks different depending on which others share the stack.
 * Here those vertices are interpolated on the layer's own TIN, and every vertex is
 * shaded with that TIN's normal there, which the shared triangles cannot give: they
 * do not contain the TIN's edges.
 *
 * Kept at the grid height: the layer's own nodes (on its TIN anyway), its own lines
 * — the termination lines of the two pairs it belongs to and its data edge — and
 * the rim and cuts, which other chunks' walls and caps meet.
 *
 * ⭐ WHICH units exist is still the grid's call. Two TINs are off their grids
 * independently, by up to `maxError` each, so a unit the grid has pinched out
 * would otherwise reopen as a sliver. Per vertex, against the layer above:
 * - thin on the grid: the layer lies that grid thickness under the layer above,
 *   and takes its normal — the pair stays exactly as thin;
 * - thick on the grid: its own surface, but never within the threshold of the
 *   layer above — the pair stays thick.
 *
 * Runs serially; {@link prepareStackOwnSurfaces}, {@link sampleStackOwnLayer} and
 * {@link createStackOwnCombiner} are its three steps, the middle one per layer and
 * independent, so a worker pool can run it.
 *
 * @param reference the common grid the TINs were refined on
 * @param tessellation the shared tessellation
 * @param own every layer's own TIN, aligned with `reference.channels`
 *
 * @group Geometries
 */
export function sampleStackOwnSurfaces(
  reference: StackReference,
  tessellation: StackTessellation,
  own: StackOwnSurfaces,
  options: StackOwnSampleOptions = {},
): StackOwnSamples {
  const jobs = prepareStackOwnSurfaces(reference, tessellation, own, options);
  const combine = createStackOwnCombiner(jobs.length, options);
  jobs.forEach((job, i) => combine.add(i, sampleStackOwnLayer(job)));
  return combine.result();
}

/**
 * The per-layer jobs of {@link sampleStackOwnSurfaces}, with the vertices each
 * layer keeps at its grid height decided. The jobs share `coords` and the
 * channels by reference.
 *
 * @group Geometries
 */
export function prepareStackOwnSurfaces(
  reference: StackReference,
  tessellation: StackTessellation,
  own: StackOwnSurfaces,
  options: StackOwnSampleOptions = {},
): StackOwnLayerJob[] {
  const { nx, ny } = reference.header;
  const { coords } = tessellation;
  const vertices = coords.length >> 1;
  const pinched = pinchTest(options);
  const gridHeight = (layer: number, v: number) =>
    sampleGrid(
      reference.channels[layer],
      nx,
      ny,
      coords[2 * v],
      coords[2 * v + 1],
    );

  const exact = exactVertices(tessellation, own, nx);
  // ⭐ A vertex kept on the grid for a layer is kept there for the layer it is
  // pinched against above too, or the pair would no longer be exactly as thin.
  for (let layer = exact.length - 1; layer > 0; layer--) {
    const lower = exact[layer];
    const upper = exact[layer - 1];
    for (let v = 0; v < vertices; v++) {
      if (!lower[v] || upper[v]) continue;
      if (pinched(layer, gridHeight(layer - 1, v) - gridHeight(layer, v))) {
        upper[v] = 1;
      }
    }
  }

  // The grid is placed by an affine map, so three points of it are all of it.
  const toWorld = surfaceGridToWorld(reference.header, reference.worldPosition);
  const [ox, oz] = toWorld(0, 0);
  const [cx, cz] = toWorld(1, 0);
  const [rx, rz] = toWorld(0, 1);
  const toScene: StackOwnLayerJob['toScene'] = [
    cx - ox,
    rx - ox,
    ox,
    cz - oz,
    rz - oz,
    oz,
  ];

  return reference.channels.map((channel, layer) => {
    const triangles = own.triangles[layer];
    const hasTin = !!own.nodes[layer] && !!triangles && triangles.length > 0;
    return {
      coords,
      channel,
      nx,
      ny,
      nodes: hasTin ? own.nodes[layer] : null,
      triangles: hasTin ? triangles : null,
      exact: hasTin ? exact[layer] : null,
      toScene: hasTin && options.normals?.[layer] !== false ? toScene : null,
    };
  });
}

/**
 * One layer of {@link sampleStackOwnSurfaces}: its grid height, its own surface's
 * height and its normals at every shared vertex.
 *
 * @group Geometries
 */
export function sampleStackOwnLayer(job: StackOwnLayerJob): StackOwnLayer {
  const { coords, channel, nx, ny, nodes, triangles, exact } = job;
  const vertices = coords.length >> 1;
  const grid = new Float32Array(vertices);
  for (let v = 0; v < vertices; v++) {
    grid[v] = sampleGrid(channel, nx, ny, coords[2 * v], coords[2 * v + 1]);
  }
  if (!nodes || !triangles || triangles.length === 0) {
    return { grid, y: grid.slice(), normals: null };
  }

  // In grid space, so the shared vertices are located by their own coords.
  const positions = new Float64Array(nodes.length * 3);
  for (let j = 0; j < nodes.length; j++) {
    const col = nodes[j] % nx;
    positions[3 * j] = col;
    positions[3 * j + 1] = channel[nodes[j]];
    positions[3 * j + 2] = (nodes[j] - col) / nx;
  }
  const locate = createTinWalker(positions, triangles);
  const tin = job.toScene
    ? tinNormals(positions, triangles, job.toScene)
    : null;
  const normals = tin ? new Int16Array(vertices * 3) : null;
  const y = new Float32Array(vertices);
  const at: TinLocation = { a: 0, b: 0, c: 0, wa: 0, wb: 0, wc: 0 };

  for (let v = 0; v < vertices; v++) {
    const hit = locate(coords[2 * v], coords[2 * v + 1], at);
    let h = grid[v];
    if (hit && !exact?.[v]) {
      const ya = positions[3 * at.a + 1];
      const yb = positions[3 * at.b + 1];
      const yc = positions[3 * at.c + 1];
      if (!isNoData(ya) && !isNoData(yb) && !isNoData(yc)) {
        h = at.wa * ya + at.wb * yb + at.wc * yc;
      }
    }
    y[v] = h;
    if (!normals || !tin) continue;
    let sx = 0;
    let sy = 1;
    let sz = 0;
    if (hit) {
      sx =
        at.wa * tin[3 * at.a] + at.wb * tin[3 * at.b] + at.wc * tin[3 * at.c];
      sy =
        at.wa * tin[3 * at.a + 1] +
        at.wb * tin[3 * at.b + 1] +
        at.wc * tin[3 * at.c + 1];
      sz =
        at.wa * tin[3 * at.a + 2] +
        at.wb * tin[3 * at.b + 2] +
        at.wc * tin[3 * at.c + 2];
    }
    const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const s = length > 0 ? 32767 / length : 0;
    normals[3 * v] = Math.round(sx * s);
    normals[3 * v + 1] = length > 0 ? Math.round(sy * s) : 32767;
    normals[3 * v + 2] = Math.round(sz * s);
  }
  return { grid, y, normals };
}

/**
 * The last step of {@link sampleStackOwnSurfaces}: takes the layers' samples in
 * ANY order and judges each pair against the layer above as soon as both are in,
 * so only the layers still waiting for one above them are held.
 *
 * @group Geometries
 */
export type StackOwnCombiner = {
  /** one layer's {@link sampleStackOwnLayer} output */
  add(layer: number, sampled: StackOwnLayer): void;
  /** the stack, once every layer is in */
  result(): StackOwnSamples;
};

/**
 * See {@link StackOwnCombiner}.
 *
 * @param count the number of layers
 *
 * @group Geometries
 */
export function createStackOwnCombiner(
  count: number,
  options: StackOwnSampleOptions = {},
): StackOwnCombiner {
  const threshold = options.threshold ?? 0.5;
  const pinched = pinchTest(options);
  const waiting: (StackOwnLayer | undefined)[] = new Array(count);
  const heights: Float32Array[] = [];
  const normals: (Int16Array | null)[] = [];
  let aboveGrid: Float32Array | null = null;

  const apply = (
    layer: number,
    { grid, y, normals: packed }: StackOwnLayer,
  ) => {
    const above = heights[layer - 1];
    const aboveNormal = normals[layer - 1];
    if (above && aboveGrid) {
      for (let v = 0; v < y.length; v++) {
        const thickness = aboveGrid[v] - grid[v];
        if (pinched(layer, thickness)) {
          y[v] = above[v] - thickness;
          if (packed && aboveNormal) {
            packed[3 * v] = aboveNormal[3 * v];
            packed[3 * v + 1] = aboveNormal[3 * v + 1];
            packed[3 * v + 2] = aboveNormal[3 * v + 2];
          }
        } else if (thickness > threshold) {
          const gap = Math.min(thickness, threshold + THICK_MARGIN);
          if (above[v] - y[v] < gap) y[v] = above[v] - gap;
        }
      }
    }
    heights.push(y);
    normals.push(packed);
    aboveGrid = grid;
  };

  return {
    add(layer, sampled) {
      waiting[layer] = sampled;
      for (let next = heights.length; next < count; next = heights.length) {
        const ready = waiting[next];
        if (!ready) break;
        waiting[next] = undefined;
        apply(next, ready);
      }
    },
    result() {
      if (heights.length < count) {
        throw new Error(
          `own-surface samples missing: ${heights.length} of ${count} layers in`,
        );
      }
      return { heights, normals };
    },
  };
}

// A fluid or the sea above does not truncate, so a crossing of it is no pinch-out.
function pinchTest(options: StackOwnSampleOptions) {
  const threshold = options.threshold ?? 0.5;
  return (layer: number, thickness: number) =>
    thickness <= threshold &&
    (!options.nonTruncating?.[layer - 1] || thickness >= 0);
}

function sampleGrid(
  channel: Float32Array,
  nx: number,
  ny: number,
  col: number,
  row: number,
): number {
  return Number.isInteger(col) && Number.isInteger(row)
    ? channel[row * nx + col]
    : sampleValidGrid(channel, nx, ny, col, row, isNoData, 0);
}

/**
 * Per layer, the shared vertices kept at its grid height: the rim and cuts, which
 * other chunks meet, and its own lines — the termination lines of both pairs it
 * belongs to, its data edge, and any node added along them.
 */
function exactVertices(
  tessellation: StackTessellation,
  own: StackOwnSurfaces,
  nx: number,
): Uint8Array[] {
  const { coords, indices } = tessellation;
  const vertices = coords.length >> 1;
  const common = new Uint8Array(vertices);
  for (const ring of tessellation.rimVertices) {
    for (const v of ring) common[v] = 1;
  }
  tessellation.cuts?.forEach(flags => markBoundary(indices, flags, common));

  let vertexOfNode: Map<number, number> | null = null;
  if (own.lineNodes?.some(lists => lists.length > 0)) {
    vertexOfNode = new Map();
    for (let v = 0; v < vertices; v++) {
      const col = coords[2 * v];
      const row = coords[2 * v + 1];
      if (Number.isInteger(col) && Number.isInteger(row)) {
        vertexOfNode.set(row * nx + col, v);
      }
    }
  }
  const pairLines = (p: number) => [
    tessellation.terminationVertices?.[p],
    ...(tessellation.levels?.map(level => level.terminationVertices?.[p]) ??
      []),
  ];

  return own.triangles.map((_, layer) => {
    const exact = common.slice();
    for (const p of [layer - 1, layer]) {
      for (const line of pairLines(p)) {
        if (line) for (let i = 0; i < line.length; i++) exact[line[i]] = 1;
      }
    }
    const coverage = tessellation.coverage?.[layer];
    if (coverage) markBoundary(indices, coverage, exact);
    if (vertexOfNode) {
      for (const list of own.lineNodes?.[layer] ?? []) {
        for (let i = 0; i < list.length; i++) {
          const v = vertexOfNode.get(list[i]);
          if (v !== undefined) exact[v] = 1;
        }
      }
    }
    return exact;
  });
}

/** Marks the vertices with flagged triangles on one side and unflagged on the other. */
function markBoundary(
  indices: Uint32Array,
  flags: Uint8Array,
  out: Uint8Array,
): void {
  const sides = new Uint8Array(out.length);
  for (let t = 0; t < flags.length; t++) {
    const side = flags[t] ? 1 : 2;
    sides[indices[3 * t]] |= side;
    sides[indices[3 * t + 1]] |= side;
    sides[indices[3 * t + 2]] |= side;
  }
  for (let v = 0; v < out.length; v++) if (sides[v] === 3) out[v] = 1;
}

/**
 * Area-weighted vertex normals of a TIN given in grid space, in SCENE space and
 * facing up; zero at a vertex with no data.
 */
function tinNormals(
  positions: Float64Array,
  triangles: Uint16Array | Uint32Array,
  toScene: [number, number, number, number, number, number],
): Float32Array {
  const [ta, tb, tc, td, te, tf] = toScene;
  const count = positions.length / 3;
  const xz = new Float64Array(count * 2);
  for (let j = 0; j < count; j++) {
    const col = positions[3 * j];
    const row = positions[3 * j + 2];
    xz[2 * j] = ta * col + tb * row + tc;
    xz[2 * j + 1] = td * col + te * row + tf;
  }
  const out = new Float32Array(count * 3);
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    const ay = positions[3 * a + 1];
    const by = positions[3 * b + 1];
    const cy = positions[3 * c + 1];
    if (isNoData(ay) || isNoData(by) || isNoData(cy)) continue;
    const bx = xz[2 * b];
    const bz = xz[2 * b + 1];
    const cbx = xz[2 * c] - bx;
    const cby = cy - by;
    const cbz = xz[2 * c + 1] - bz;
    const abx = xz[2 * a] - bx;
    const aby = ay - by;
    const abz = xz[2 * a + 1] - bz;
    const flip = cbz * abx - cbx * abz < 0 ? -1 : 1;
    const nx = flip * (cby * abz - cbz * aby);
    const ny = flip * (cbz * abx - cbx * abz);
    const nz = flip * (cbx * aby - cby * abx);
    out[3 * a] += nx;
    out[3 * a + 1] += ny;
    out[3 * a + 2] += nz;
    out[3 * b] += nx;
    out[3 * b + 1] += ny;
    out[3 * b + 2] += nz;
    out[3 * c] += nx;
    out[3 * c + 1] += ny;
    out[3 * c + 2] += nz;
  }
  for (let v = 0; v < out.length; v += 3) {
    const length = Math.sqrt(
      out[v] * out[v] + out[v + 1] * out[v + 1] + out[v + 2] * out[v + 2],
    );
    if (length === 0) continue;
    out[v] /= length;
    out[v + 1] /= length;
    out[v + 2] /= length;
  }
  return out;
}

/** Walk steps before giving up on a walk and asking the bucket sampler instead. */
const MAX_WALK = 4096;

/**
 * Point location in a TIN given in grid space, by walking from the last triangle
 * found across the edge the point lies beyond. The shared vertices come in tile
 * and row order, so a walk is a few steps — a bucket search tests every triangle
 * in the bucket. Falls back to {@link createTinSampler} for a walk that leaves
 * the TIN or runs long.
 */
function createTinWalker(
  positions: Float64Array,
  triangles: Uint16Array | Uint32Array,
): (x: number, z: number, out: TinLocation) => boolean {
  const count = positions.length / 3;
  // Per halfedge `3t + k` (corner k to k + 1): the triangle across it, or -1.
  const across = new Int32Array(triangles.length).fill(-1);
  const open = new Map<number, number>();
  for (let e = 0; e < triangles.length; e++) {
    const a = triangles[e];
    const b = triangles[e - (e % 3) + (((e % 3) + 1) % 3)];
    const key = a < b ? a * count + b : b * count + a;
    const other = open.get(key);
    if (other === undefined) {
      open.set(key, e);
    } else {
      across[e] = (other / 3) | 0;
      across[other] = (e / 3) | 0;
      open.delete(key);
    }
  }
  let fallback: ReturnType<typeof createTinSampler> | null = null;
  let current = 0;

  return (x, z, out) => {
    let t = current;
    for (let step = 0; step < MAX_WALK; step++) {
      const i = 3 * t;
      const a = triangles[i];
      const b = triangles[i + 1];
      const c = triangles[i + 2];
      const ax = positions[3 * a];
      const az = positions[3 * a + 2];
      const bx = positions[3 * b];
      const bz = positions[3 * b + 2];
      const cx = positions[3 * c];
      const cz = positions[3 * c + 2];
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (area === 0) break;
      const s = area > 0 ? 1 : -1;
      // Twice the signed area of the point with each edge — its weight opposite.
      const dab = s * ((bx - ax) * (z - az) - (x - ax) * (bz - az));
      const dbc = s * ((cx - bx) * (z - bz) - (x - bx) * (cz - bz));
      const dca = s * ((ax - cx) * (z - cz) - (x - cx) * (az - cz));
      const next =
        dab < 0
          ? across[i]
          : dbc < 0
            ? across[i + 1]
            : dca < 0
              ? across[i + 2]
              : t;
      if (next === t) {
        current = t;
        const total = dab + dbc + dca;
        out.a = a;
        out.b = b;
        out.c = c;
        out.wa = dbc / total;
        out.wb = dca / total;
        out.wc = dab / total;
        return true;
      }
      if (next < 0) break;
      t = next;
    }
    fallback ??= createTinSampler(positions, triangles);
    return fallback.locate(x, z, out) !== null;
  };
}
