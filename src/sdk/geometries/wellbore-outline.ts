import { Vec2, Vec3 } from '../types/common';
import { sampleValidGrid } from './grid-sampling';
import { marchingSquares } from './marching-squares';
import {
  ringSignedArea,
  ringsToPolygonCoordinates,
  simplifyPolyline,
} from './polygon-outline';
import { PlanarPolygonGeometry } from './planar-geometry';
import { SurfaceClipHeader, surfaceWorldToGrid } from './surface-clip';
import { smoothRings } from './triangulate-grid-delaunay';

/**
 * A surface layer of a chunk, as consumed by {@link createSurfaceDepthSampler}
 * (the same fields the chunk builder / `Surface` component use).
 *
 * @group Geometries
 */
export type ChunkSurfaceLayer = {
  /** row-major elevation grid of length `header.nx * header.ny` */
  values: Float32Array;
  header: SurfaceClipHeader;
  /** scene XZ of the surface origin (see {@link surfaceWorldToGrid}) */
  worldPosition?: Vec2;
  /** depth-normalization reference (`SurfaceMeta.max`) */
  referenceDepth: number;
  /** value marking a missing/hole sample (default -1) */
  nullValue?: number;
};

/**
 * A surface's scene-space depth (Y) at a scene XZ point, or `null` where it has
 * no data. See {@link createSurfaceDepthSampler}.
 *
 * @group Geometries
 */
export type SurfaceDepthSampler = (sx: number, sz: number) => number | null;

/**
 * Build a sampler returning a surface's scene-space depth (Y, downward-negative:
 * `value - referenceDepth`) at a scene XZ point, or `null` where the surface has
 * no valid data. Used to test whether a trajectory sample sits within a chunk's
 * vertical window.
 *
 * @group Geometries
 */
export function createSurfaceDepthSampler(
  layer: ChunkSurfaceLayer,
): SurfaceDepthSampler {
  const { values, header, referenceDepth } = layer;
  const nullValue = layer.nullValue ?? -1;
  const isInvalid = (v: number) => v === nullValue || v < 0;
  const { nx, ny } = header;
  const toGrid = surfaceWorldToGrid(header, layer.worldPosition);
  return (sx: number, sz: number) => {
    const [col, row] = toGrid(sx, sz);
    if (col < 0 || row < 0 || col > nx - 1 || row > ny - 1) return null;
    const v = sampleValidGrid(values, nx, ny, col, row, isInvalid, NaN);
    if (Number.isNaN(v)) return null;
    return v - referenceDepth;
  };
}

/**
 * Options for {@link collectTrajectoryRuns}.
 *
 * @group Geometries
 */
export type TrajectoryWindowOptions = {
  /** widen the window by this much, scene units, so grazing wells count. Default 0. */
  tolerance?: number;
  /**
   * What to do where a bounding surface has NO DATA at a sample's XZ.
   *
   * - `'exclude'` (default) drops the sample. The footprint is then gated by the
   *   data extent of BOTH bounding surfaces, so an unmapped patch in a deep base
   *   surface removes that area from the outline even when everything above it is
   *   mapped.
   * - `'ignore'` treats that side as unbounded there, keeping whatever the OTHER
   *   bound allows. Closer to what gets drawn — the column seal gives an unmapped
   *   surface a height anyway, so the block spans the gap even though the raw
   *   grid has a hole in it.
   *
   * ⚠️ `'ignore'` cannot tell a hole INSIDE a survey from being off the grid
   * entirely, so a well far outside every surface is let in as well.
   */
  unmapped?: 'exclude' | 'ignore';
};

/**
 * Cut a trajectory polyline down to the parts lying within a chunk's vertical
 * window, as ordered scene-XZ runs ready for {@link createWellboreOutline}.
 *
 * Each sample is `[x, y, z]` in the scene frame (`y` = depth, downward-negative)
 * and is tested at its OWN XZ, so a deviated well is handled correctly against
 * non-flat surfaces. A well that leaves and re-enters the window yields several
 * runs — the gap is real, the trajectory is not inside between them.
 *
 * Either bound may be `null`, which makes that side UNBOUNDED:
 * - `top` only → everything at or below the top surface,
 * - `base` only → everything at or above the base surface (up to the wellhead),
 * - both → the window between them.
 *
 * Where consecutive samples straddle a bound, the crossing point is interpolated
 * and added to the run, so a run's ends do not depend on the sampling spacing.
 *
 * @group Geometries
 */
export function collectTrajectoryRuns(
  sceneSamples: Vec3[],
  top: SurfaceDepthSampler | null,
  base: SurfaceDepthSampler | null,
  options: TrajectoryWindowOptions = {},
): Vec2[][] {
  const tolerance = options.tolerance ?? 0;
  const ignoreUnmapped = options.unmapped === 'ignore';

  // Signed "insideness" at a sample: >= 0 inside, null where a bound in play has
  // no data (which breaks a run without a crossing — there is nothing to solve).
  const insideness = ([x, y, z]: Vec3): number | null => {
    const dt = top ? top(x, z) : null;
    const db = base ? base(x, z) : null;
    if (!ignoreUnmapped) {
      if (top && dt === null) return null;
      if (base && db === null) return null;
    }
    if (dt !== null && db !== null)
      return Math.min(
        Math.max(dt, db) + tolerance - y,
        y - (Math.min(dt, db) - tolerance),
      );
    if (dt !== null) return dt + tolerance - y;
    if (db !== null) return y - (db - tolerance);
    // Nothing constrains this sample: unbounded under `'ignore'`, and under
    // `'exclude'` only reachable when the caller passed no bounds at all.
    return Infinity;
  };

  const runs: Vec2[][] = [];
  let run: Vec2[] | null = null;
  let prev: Vec3 | null = null;
  let prevF: number | null = null;

  for (const sample of sceneSamples) {
    const f = insideness(sample);
    if (f !== null && f >= 0) {
      if (!run) {
        run = [];
        // Entering: prevF < 0 and f >= 0, so the crossing lies on this segment.
        if (prev && prevF !== null && Number.isFinite(prevF - f))
          run.push(lerpXZ(prev, sample, prevF / (prevF - f)));
      }
      run.push([sample[0], sample[2]]);
    } else if (run) {
      if (prev && prevF !== null && f !== null && Number.isFinite(prevF - f))
        run.push(lerpXZ(prev, sample, prevF / (prevF - f)));
      runs.push(run);
      run = null;
    }
    prev = sample;
    prevF = f;
  }
  if (run) runs.push(run);
  return runs;
}

function lerpXZ(a: Vec3, b: Vec3, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Cluster XZ points into connected groups using a uniform grid with cell size
 * `distance`: points in the same or an 8-adjacent occupied cell join the same
 * cluster (grid connected-components).
 *
 * This is O(points) (independent of how densely points pile up — e.g. every well
 * starting at one platform), unlike pairwise single-link clustering. The
 * trade-off is that the effective merge distance is approximate (a cell's width,
 * merging via adjacency rather than exact Euclidean distance), which is fine for
 * grouping footprints.
 *
 * ⚠️ This does NOT decide how many components an outline has — see
 * {@link createWellboreOutline}, where component count emerges from where the
 * buffers touch.
 *
 * @group Geometries
 */
export function clusterPoints2D(points: Vec2[], distance: number): Vec2[][] {
  if (points.length === 0) return [];
  return groupByOccupiedCells(
    points.map(p => [p]),
    distance,
  ).map(group => group.map(i => points[i]));
}

/**
 * Grid connected-components over items that each occupy one or more XZ points:
 * items sharing a cell, or sitting in 8-adjacent occupied cells, join the same
 * group, and an item is ATOMIC (everything it touches is unioned together, so a
 * long path spanning sparse cells is never split). Returns groups of item
 * indices; items with no points are omitted.
 *
 * O(total points), unlike pairwise single-link clustering. The effective merge
 * distance is approximate (a cell's width, via adjacency rather than exact
 * Euclidean distance) — callers that need a guarantee must leave headroom.
 */
function groupByOccupiedCells(
  itemPoints: Vec2[][],
  distance: number,
): number[][] {
  const n = itemPoints.length;
  if (n === 0) return [];
  const cell = distance > 0 ? distance : 1;
  const keyOf = (cx: number, cz: number) => cx + ':' + cz;

  // Bucket every item's points into occupied cells.
  const cellIndex = new Map<string, number>();
  const cellCoord: [number, number][] = [];
  const itemCells: number[][] = [];
  for (let i = 0; i < n; i++) {
    const cells: number[] = [];
    for (const [x, z] of itemPoints[i]) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const k = keyOf(cx, cz);
      let idx = cellIndex.get(k);
      if (idx === undefined) {
        idx = cellCoord.length;
        cellIndex.set(k, idx);
        cellCoord.push([cx, cz]);
      }
      cells.push(idx);
    }
    itemCells.push(cells);
  }

  // Union-find over occupied CELLS.
  const parent = new Int32Array(cellCoord.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let idx = 0; idx < cellCoord.length; idx++) {
    const [cx, cz] = cellCoord[idx];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nidx = cellIndex.get(keyOf(cx + dx, cz + dz));
        if (nidx !== undefined) union(idx, nidx);
      }
    }
  }
  for (const cells of itemCells)
    for (let i = 1; i < cells.length; i++) union(cells[0], cells[i]);

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (itemCells[i].length === 0) continue;
    const root = find(itemCells[i][0]);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

/** Default raster cell size, scene units, before the radius clamp. */
export const DEFAULT_OUTLINE_CELL_SIZE = 100;

/**
 * Raster cells across the narrowest buffer. Below ~3 the contour walks between
 * nodes and the outline breaks into blobs or vanishes — which is why a small
 * `radius` needs a small cell, not the other way round.
 */
export const OUTLINE_CELLS_PER_RADIUS = 3;

/**
 * What {@link createWellboreOutline} actually did, for callers that need to see
 * an under-resolved result rather than guess at one.
 *
 * @group Geometries
 */
export type WellboreOutlineMetrics = {
  /** spatially separated groups, each rasterized over its own bounding box */
  groups: number;
  /** input paths kept (after simplification) */
  paths: number;
  /** total segments rasterized */
  segments: number;
  /** total raster nodes across all groups */
  nodes: number;
  /** buckets in the segment lookup grids */
  indexCells: number;
  /** segment references held by those buckets (occupancy = entries / cells) */
  indexEntries: number;
  /** coarsest cell size actually used, scene units */
  cellSize: number;
  /** cell size the radius asked for, scene units */
  requestedCellSize: number;
  /** ⚠️ true when `maxCells` forced a coarser cell than the radius wanted */
  coarsened: boolean;
};

/**
 * Options for {@link createWellboreOutline}.
 *
 * @group Geometries
 */
export type WellboreOutlineOptions = {
  /** default buffer margin, scene units (default 500). A path may override it. */
  radius?: number;
  /**
   * Lower clamp for the {@link WellboreOutlineOptions.shapeFn}-modulated margin,
   * scene units. Unset means no clamp.
   */
  minRadius?: number;
  /** upper clamp for the modulated margin, scene units. Unset means no clamp. */
  maxRadius?: number;
  /**
   * Upper bound for the raster cell size, scene units (default
   * {@link DEFAULT_OUTLINE_CELL_SIZE}). The effective cell is also clamped to
   * `minRadius / `{@link OUTLINE_CELLS_PER_RADIUS}, so a small radius always gets
   * a fine enough raster.
   */
  cellSize?: number;
  /**
   * Cap the raster node count PER GROUP; the cell is grown to stay under it
   * (default 1e6). ⚠️ Growing it past what the radius needs under-resolves the
   * buffer — {@link WellboreOutlineMetrics.coarsened} reports when that happens.
   */
  maxCells?: number;
  /**
   * Ramer–Douglas–Peucker tolerance applied to each path before rasterizing,
   * scene units. Bounds the segment count without changing the buffer by more
   * than the tolerance. Defaults to `minRadius / 8`; `0` disables.
   */
  simplify?: number;
  /**
   * Per-group angular radius multiplier `angle -> factor` for organic edges
   * (angle measured about the group centroid, radians). Default `() => 1`.
   */
  shapeFn?: (angle: number) => number;
  /** box-blur the distance field this many passes to round corners (default 0). */
  feather?: number;
  /** smooth the output rings by this strength (windowed average, default 1). */
  smoothing?: number;
  /** drop output rings whose absolute area (scene units²) is below this. */
  minRingArea?: number;
  /** receives {@link WellboreOutlineMetrics} once the outline is built. */
  onMetrics?: (metrics: WellboreOutlineMetrics) => void;
};

/**
 * A trajectory path with its OWN buffer margin, for building an outline whose
 * margin varies with depth (see {@link createWellboreOutline}).
 *
 * @group Geometries
 */
export type WellborePath = {
  /** ordered scene-XZ polyline */
  points: Vec2[];
  /** margin for THIS path, scene units. Defaults to the shared `radius`. */
  radius?: number;
};

/**
 * Turn trajectory paths (ordered scene-XZ polylines, e.g. from
 * {@link collectTrajectoryRuns}) into a chunk cut outline.
 *
 * The paths are split into spatially separated GROUPS, and each group is
 * rasterized over its own bounding box as a signed distance field, the minimum
 * over its segments of `distanceToSegment - margin`, negative inside the buffer.
 * Each field is contoured at zero with {@link marchingSquares} and smoothed; the
 * rings from every group are then grouped into outer/hole components
 * ({@link ringsToPolygonCoordinates}).
 *
 * ⭐ The margin is PER PATH, not per call. That is what makes an accumulated
 * outline nest: buffering each path with the margin of the depth interval it came
 * from means a deeper chunk's field is the shallower one's `min` with more terms,
 * so its outline CONTAINS the shallower one whether or not the margin grows with
 * depth. Buffering the whole accumulated set with one radius instead would let a
 * wide deep margin bloat the shallow neck, and a narrow one break the nesting.
 *
 * Rasterizing per group rather than over one bounding box is what keeps a small
 * margin affordable: the node count follows the corridors, not the extent of the
 * field. The result is the same, because groups are separated by more than any
 * buffer can reach.
 *
 * ⭐ Component count is EMERGENT: marching squares emits one ring per connected
 * component of the buffered set, so paths yield separate outlines exactly while
 * their buffers stay apart, and merge into one as they grow into each other.
 *
 * @param paths ordered polylines, optionally each with its own margin; a
 *   single-point path is a disc
 * @param options see {@link WellboreOutlineOptions}
 * @returns the outline polygon, or `null` when there is nothing to buffer
 *
 * @group Geometries
 */
export function createWellboreOutline(
  paths: Vec2[][] | WellborePath[],
  options: WellboreOutlineOptions = {},
): PlanarPolygonGeometry | null {
  const radius = options.radius ?? 500;
  const minRadius = options.minRadius;
  const maxRadius = options.maxRadius;
  const shapeFn = options.shapeFn;
  const feather = options.feather ?? 0;
  const smoothing = options.smoothing ?? 1;
  const maxCells = options.maxCells ?? 1000000;

  // Normalise to paths carrying their OWN margin. Buffering each path with the
  // margin of the depth interval it came from is what lets an accumulated outline
  // stay nested without the radius having to grow with depth: a later interval
  // only ever ADDS a term to the field's `min`, so it cannot pull the boundary in.
  const kept: { points: Vec2[]; radius: number }[] = [];
  let narrowest = Infinity;
  let widest = 0;
  for (const entry of paths) {
    const points = Array.isArray(entry) ? entry : entry.points;
    if (points.length === 0) continue;
    const r = Math.max(
      (Array.isArray(entry) ? undefined : entry.radius) ?? radius,
      0,
    );
    if (r < narrowest) narrowest = r;
    if (r > widest) widest = r;
    kept.push({ points, radius: r });
  }
  if (kept.length === 0) return null;

  // The clamps bound what `shapeFn` may do, so they widen the range the raster has
  // to resolve and pad for. Erring wide costs a finer raster and more padding,
  // never correctness.
  if (minRadius !== undefined) narrowest = Math.min(narrowest, minRadius);
  if (maxRadius !== undefined) widest = Math.max(widest, maxRadius);

  const requestedCellSize = Math.min(
    options.cellSize ?? DEFAULT_OUTLINE_CELL_SIZE,
    Math.max(narrowest, 1) / OUTLINE_CELLS_PER_RADIUS,
  );
  const simplify = options.simplify ?? Math.max(narrowest, 1) / 8;
  if (simplify > 0)
    for (const path of kept)
      if (path.points.length > 2)
        path.points = simplifyPolyline(path.points, simplify);

  // Two groups this far apart cannot affect each other's contour: a distance
  // field is 1-Lipschitz, so a node more than one cell from the buffer can never
  // sit on a zero crossing, and 3 * widest leaves every foreign contribution far
  // above that even after the raster padding.
  const groups = groupByOccupiedCells(
    kept.map(p => p.points),
    3 * widest + 3 * requestedCellSize,
  );

  const rings: Vec2[][] = [];
  let nodes = 0;
  let segments = 0;
  let indexCells = 0;
  let indexEntries = 0;
  let effectiveCellSize = requestedCellSize;
  let coarsened = false;

  for (const group of groups) {
    // Flatten the group's paths to a segment soup, each segment carrying its
    // path's margin (stride 5). A single-point path becomes a degenerate segment,
    // which the point-to-segment formula handles as a disc.
    const flat: number[] = [];
    let gMinX = Infinity;
    let gMinZ = Infinity;
    let gMaxX = -Infinity;
    let gMaxZ = -Infinity;
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (const index of group) {
      const { points: path, radius: r } = kept[index];
      if (path.length === 1)
        flat.push(path[0][0], path[0][1], path[0][0], path[0][1], r);
      for (let i = 1; i < path.length; i++)
        flat.push(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1], r);
      for (const [x, z] of path) {
        if (x < gMinX) gMinX = x;
        if (x > gMaxX) gMaxX = x;
        if (z < gMinZ) gMinZ = z;
        if (z > gMaxZ) gMaxZ = z;
        sumX += x;
        sumZ += z;
        count++;
      }
    }
    const segs = new Float32Array(flat);
    const segCount = segs.length / 5;
    segments += segCount;
    const centroidX = sumX / count;
    const centroidZ = sumZ / count;

    // Pad by the largest possible radius so the whole buffer fits, plus a cell.
    let cellSize = requestedCellSize;
    let pad = widest + cellSize;
    let width = gMaxX - gMinX + 2 * pad;
    let height = gMaxZ - gMinZ + 2 * pad;
    if ((width / cellSize + 1) * (height / cellSize + 1) > maxCells) {
      cellSize = Math.sqrt((width * height) / maxCells);
      coarsened = true;
      pad = widest + cellSize;
      width = gMaxX - gMinX + 2 * pad;
      height = gMaxZ - gMinZ + 2 * pad;
    }
    if (cellSize > effectiveCellSize) effectiveCellSize = cellSize;

    const originX = gMinX - pad;
    const originZ = gMinZ - pad;
    // ⚠️ CEIL, not floor: the padding leaves a cell of slack beyond the widest
    // buffer so the contour never reaches the raster border (marching squares
    // emits an OPEN contour there, which downstream code closes into a bogus
    // ring). Truncating the node count gives that whole cell back, and a buffer
    // that lands within it gets torn into fragments.
    const cols = Math.max(2, Math.ceil(width / cellSize) + 1);
    const rows = Math.max(2, Math.ceil(height / cellSize) + 1);
    nodes += cols * rows;

    // A node further than this from every segment is provably outside the buffer
    // by more than a cell, so the fallback below cannot sit on a zero crossing.
    const pruneMargin = widest + 2 * cellSize;
    const index = buildSegmentIndex(
      segs,
      originX,
      originZ,
      width,
      height,
      2 * pruneMargin,
    );
    indexCells += index.cols * index.rows;
    indexEntries += index.items.length;

    const field = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const nz = originZ + r * cellSize;
      const gz = Math.floor((nz - originZ) / index.cell);
      for (let c = 0; c < cols; c++) {
        const nx = originX + c * cellSize;
        const gx = Math.floor((nx - originX) / index.cell);
        // The margin is per SEGMENT, so the min is taken over the signed value
        // rather than over the distance — that is the whole per-interval model.
        const modulate = shapeFn
          ? shapeFn(Math.atan2(nz - centroidZ, nx - centroidX))
          : 1;
        let best = Infinity;
        for (let dz = -1; dz <= 1; dz++) {
          const bz = gz + dz;
          if (bz < 0 || bz >= index.rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const bx = gx + dx;
            if (bx < 0 || bx >= index.cols) continue;
            const bucket = bz * index.cols + bx;
            for (
              let k = index.start[bucket];
              k < index.start[bucket + 1];
              k++
            ) {
              const s = index.items[k] * 5;
              let rad = segs[s + 4] * modulate;
              if (minRadius !== undefined && rad < minRadius) rad = minRadius;
              if (maxRadius !== undefined && rad > maxRadius) rad = maxRadius;
              const signed =
                distanceToSegment(
                  nx,
                  nz,
                  segs[s],
                  segs[s + 1],
                  segs[s + 2],
                  segs[s + 3],
                ) - rad;
              if (signed < best) best = signed;
            }
          }
        }
        // Nothing near: provably more than a cell outside (see `pruneMargin`).
        field[r * cols + c] = best === Infinity ? pruneMargin - widest : best;
      }
    }

    if (feather > 0)
      boxBlur(field, cols, rows, Math.max(1, Math.round(feather)));

    // Contour at zero. `marchingSquares` treats >= iso as inside and the field is
    // negative inside, so negate IN PLACE — a second full raster is pure churn.
    for (let i = 0; i < field.length; i++) field[i] = -field[i];
    let groupRings: Vec2[][] = marchingSquares(field, cols, rows, 0).map(ring =>
      ring.map(
        ([col, row]): Vec2 => [
          originX + col * cellSize,
          originZ + row * cellSize,
        ],
      ),
    );
    if (smoothing > 0)
      groupRings = smoothRings(groupRings, smoothing) as Vec2[][];
    for (const ring of groupRings) rings.push(ring);
  }

  options.onMetrics?.({
    groups: groups.length,
    paths: kept.length,
    segments,
    nodes,
    indexCells,
    indexEntries,
    cellSize: effectiveCellSize,
    requestedCellSize,
    coarsened,
  });

  let out = rings;
  if (options.minRingArea && options.minRingArea > 0) {
    const min = options.minRingArea;
    out = out.filter(r => Math.abs(ringSignedArea(r)) >= min);
  }
  if (out.length === 0) return null;

  const coordinates = ringsToPolygonCoordinates(out);
  if (coordinates.length === 0) return null;
  return new PlanarPolygonGeometry(coordinates);
}

/** Distance from a point to a segment, scene units. A degenerate segment is a point. */
function distanceToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = ax + t * dx - x;
  const ez = az + t * dz - z;
  return Math.sqrt(ex * ex + ez * ez);
}

type SegmentIndex = {
  cols: number;
  rows: number;
  cell: number;
  /** CSR offsets, length cols*rows + 1 */
  start: Int32Array;
  /** segment ids, grouped by bucket */
  items: Int32Array;
};

/**
 * Bucket segments into a uniform grid so a raster node only tests the segments
 * near it, instead of every segment in the group.
 *
 * ⭐ The two constants are load-bearing and must move together. Segments are
 * inserted at the cells of points sampled every `cell / 2` along them, and a node
 * queries the 3x3 neighbourhood of its own cell. Callers pass `cell = 2 * margin`,
 * so for a node `n` and the nearest point `p` on some segment with `|p - n| <=
 * margin = cell / 2`: `p` is within `cell / 4` of an inserted sample `s`, hence
 * `|s - n| <= 0.75 * cell`, hence `s`'s cell index differs from `n`'s by at most
 * one on each axis. Nothing within `margin` can therefore be missed.
 *
 * CSR (counting sort) rather than a map of arrays: no hashing, no per-cell
 * allocation — the same layout `buildCrossingIndex` uses.
 */
function buildSegmentIndex(
  segments: Float32Array,
  originX: number,
  originZ: number,
  width: number,
  height: number,
  cell: number,
): SegmentIndex {
  const cols = Math.max(1, Math.ceil(width / cell) + 1);
  const rows = Math.max(1, Math.ceil(height / cell) + 1);
  const count = segments.length / 5;
  const start = new Int32Array(cols * rows + 1);

  // Same traversal twice: count per bucket, then fill.
  const walk = (visit: (bucket: number, segment: number) => void) => {
    for (let i = 0; i < count; i++) {
      const s = i * 5;
      const ax = segments[s];
      const az = segments[s + 1];
      const dx = segments[s + 2] - ax;
      const dz = segments[s + 3] - az;
      const steps = Math.max(1, Math.ceil((Math.hypot(dx, dz) * 2) / cell));
      let last = -1;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const gx = Math.floor((ax + dx * t - originX) / cell);
        const gz = Math.floor((az + dz * t - originZ) / cell);
        if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) continue;
        const bucket = gz * cols + gx;
        if (bucket === last) continue;
        last = bucket;
        visit(bucket, i);
      }
    }
  };

  walk(bucket => start[bucket + 1]++);
  for (let i = 1; i <= cols * rows; i++) start[i] += start[i - 1];

  const items = new Int32Array(start[cols * rows]);
  const cursor = Int32Array.from(start.subarray(0, cols * rows));
  walk((bucket, segment) => {
    items[cursor[bucket]++] = segment;
  });

  return { cols, rows, cell, start, items };
}

// Separable box blur over a row-major field, `passes` iterations, radius 1.
function boxBlur(
  field: Float32Array,
  cols: number,
  rows: number,
  passes: number,
) {
  const tmp = new Float32Array(field.length);
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const c0 = c > 0 ? c - 1 : c;
        const c1 = c < cols - 1 ? c + 1 : c;
        tmp[r * cols + c] =
          (field[r * cols + c0] + field[r * cols + c] + field[r * cols + c1]) /
          3;
      }
    }
    // vertical
    for (let r = 0; r < rows; r++) {
      const r0 = r > 0 ? r - 1 : r;
      const r1 = r < rows - 1 ? r + 1 : r;
      for (let c = 0; c < cols; c++) {
        field[r * cols + c] =
          (tmp[r0 * cols + c] + tmp[r * cols + c] + tmp[r1 * cols + c]) / 3;
      }
    }
  }
}
