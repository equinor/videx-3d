import { Vec2, Vec3 } from '../types/common';
import { sampleValidGrid } from './grid-sampling';
import { marchingSquares } from './marching-squares';
import { ringSignedArea, ringsToPolygonCoordinates } from './polygon-outline';
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
 * Build a sampler returning a surface's scene-space depth (Y, downward-negative:
 * `value - referenceDepth`) at a scene XZ point, or `null` where the surface has
 * no valid data. Used to test whether a trajectory sample sits within a chunk's
 * vertical window.
 *
 * @group Geometries
 */
export function createSurfaceDepthSampler(
  layer: ChunkSurfaceLayer,
): (sx: number, sz: number) => number | null {
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
 * Keep the scene-XZ footprint of a trajectory polyline where it lies within a
 * chunk's vertical window — i.e. between its top and base surfaces. Each sample
 * is `[x, y, z]` in the scene frame (`y` = depth, downward-negative), and a point
 * is kept when its `y` is between the two samplers' depths at that XZ (both must
 * return data). Pass the same sampler for `top` and `base` with a `tolerance` to
 * capture wells near a single surface.
 *
 * @group Geometries
 */
export function collectTrajectoryPoints(
  sceneSamples: Vec3[],
  top: (sx: number, sz: number) => number | null,
  base: (sx: number, sz: number) => number | null,
  tolerance = 0,
): Vec2[] {
  const out: Vec2[] = [];
  for (const [x, y, z] of sceneSamples) {
    const dt = top(x, z);
    const db = base(x, z);
    if (dt === null || db === null) continue;
    const hi = Math.max(dt, db) + tolerance;
    const lo = Math.min(dt, db) - tolerance;
    if (y <= hi && y >= lo) out.push([x, z]);
  }
  return out;
}

/**
 * Grid-snap points to `spacing`, keeping one representative per occupied cell.
 * Dense/duplicate points collapse, which is safe for a distance field sampled at
 * a comparable resolution and cuts the point count that the outline builder must
 * scan. `spacing <= 0` returns the points unchanged.
 *
 * @group Geometries
 */
export function decimatePoints2D(points: Vec2[], spacing: number): Vec2[] {
  if (spacing <= 0 || points.length === 0) return points;
  const seen = new Set<string>();
  const out: Vec2[] = [];
  for (const p of points) {
    const k = Math.floor(p[0] / spacing) + ':' + Math.floor(p[1] / spacing);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Cluster XZ points into connected groups using a uniform grid with cell size
 * `distance`: points in the same or an 8-adjacent occupied cell join the same
 * cluster (grid connected-components). Wells sharing a template collapse to one
 * cluster; wells diverging in different directions form several — driving
 * multi-component outlines downstream.
 *
 * This is O(points) (independent of how densely points pile up — e.g. every well
 * starting at one platform), unlike pairwise single-link clustering. The
 * trade-off is that the effective merge distance is approximate (a cell's width,
 * merging via adjacency rather than exact Euclidean distance), which is fine for
 * grouping footprints.
 *
 * @group Geometries
 */
export function clusterPoints2D(points: Vec2[], distance: number): Vec2[][] {
  const n = points.length;
  if (n === 0) return [];
  const cell = distance > 0 ? distance : 1;
  const keyOf = (cx: number, cz: number) => cx + ':' + cz;

  // Bucket points into occupied cells.
  const cellPoints = new Map<string, number[]>();
  const cellCoord = new Map<string, [number, number]>();
  const pointCell = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(points[i][0] / cell);
    const cz = Math.floor(points[i][1] / cell);
    const k = keyOf(cx, cz);
    pointCell[i] = k;
    let arr = cellPoints.get(k);
    if (!arr) {
      arr = [];
      cellPoints.set(k, arr);
      cellCoord.set(k, [cx, cz]);
    }
    arr.push(i);
  }

  // Union-find over occupied CELLS (8-connectivity) — O(occupied cells).
  const cellKeys = [...cellPoints.keys()];
  const cellIndex = new Map<string, number>();
  cellKeys.forEach((k, idx) => cellIndex.set(k, idx));
  const parent = cellKeys.map((_, i) => i);
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
  for (let idx = 0; idx < cellKeys.length; idx++) {
    const [cx, cz] = cellCoord.get(cellKeys[idx])!;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nidx = cellIndex.get(keyOf(cx + dx, cz + dz));
        if (nidx !== undefined) union(idx, nidx);
      }
    }
  }

  // Group points by their cell's root component.
  const groups = new Map<number, Vec2[]>();
  for (let i = 0; i < n; i++) {
    const root = find(cellIndex.get(pointCell[i])!);
    const g = groups.get(root);
    if (g) g.push(points[i]);
    else groups.set(root, [points[i]]);
  }
  return [...groups.values()];
}

/**
 * Options for {@link createWellboreOutline}.
 *
 * @group Geometries
 */
export type WellboreOutlineOptions = {
  /** buffer radius around the trajectory footprint, scene units (default 500). */
  radius?: number;
  /** lower clamp for the (shape-modulated) radius. Defaults to `radius`. */
  minRadius?: number;
  /** upper clamp for the (shape-modulated) radius. Defaults to `radius`. */
  maxRadius?: number;
  /** distance-field raster cell size, scene units (default 100). */
  cellSize?: number;
  /** cap the raster node count; cellSize is grown to stay under it (default 250k). */
  maxCells?: number;
  /**
   * Grid-snap each cluster's points to this spacing before building the field, to
   * bound the per-node distance scan when many wells overlap. Defaults to the
   * (possibly grown) `cellSize`, i.e. no finer than the field resolution — set to
   * `0` to disable.
   */
  decimation?: number;
  /**
   * Per-cluster angular radius multiplier `angle -> factor` for organic edges
   * (angle measured about the cluster centroid, radians). Default `() => 1`.
   */
  shapeFn?: (angle: number) => number;
  /** box-blur the distance field this many passes to round corners (default 0). */
  feather?: number;
  /** smooth the output rings by this strength (windowed average, default 1). */
  smoothing?: number;
  /** drop output rings whose absolute area (scene units²) is below this. */
  minRingArea?: number;
};

type Cluster = {
  points: Vec2[];
  cx: number;
  cz: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};

/**
 * Turn one or more clusters of trajectory footprint points (scene XZ) into a
 * chunk cut outline. A signed distance field is rasterized over the points'
 * bounding box: each cluster contributes `distanceToNearestPoint - radius`, with
 * the radius clamped and optionally modulated per angle about the cluster
 * centroid ({@link WellboreOutlineOptions.shapeFn}); the field is contoured at
 * zero with {@link marchingSquares}, smoothed, and grouped into
 * outer/hole components ({@link ringsToPolygonCoordinates}). Divergent clusters
 * therefore yield multiple outline components; a shared, dense cluster yields one.
 *
 * @param clusters point clusters (e.g. from {@link clusterPoints2D})
 * @param options see {@link WellboreOutlineOptions}
 * @returns the outline polygon, or `null` when there are no points
 *
 * @group Geometries
 */
export function createWellboreOutline(
  clusters: Vec2[][],
  options: WellboreOutlineOptions = {},
): PlanarPolygonGeometry | null {
  const radius = options.radius ?? 500;
  const minRadius = options.minRadius ?? radius;
  const maxRadius = options.maxRadius ?? radius;
  const shapeFn = options.shapeFn;
  const feather = options.feather ?? 0;
  const smoothing = options.smoothing ?? 1;
  const maxCells = options.maxCells ?? 250000;

  // Prepare clusters (centroid + bbox) and the overall bounds.
  const prepared: Cluster[] = [];
  let gMinX = Infinity;
  let gMinZ = Infinity;
  let gMaxX = -Infinity;
  let gMaxZ = -Infinity;
  for (const pts of clusters) {
    if (pts.length === 0) continue;
    let sx = 0;
    let sz = 0;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of pts) {
      sx += x;
      sz += z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    prepared.push({
      points: pts,
      cx: sx / pts.length,
      cz: sz / pts.length,
      minX,
      minZ,
      maxX,
      maxZ,
    });
    if (minX < gMinX) gMinX = minX;
    if (minZ < gMinZ) gMinZ = minZ;
    if (maxX > gMaxX) gMaxX = maxX;
    if (maxZ > gMaxZ) gMaxZ = maxZ;
  }
  if (prepared.length === 0) return null;

  // Pad the field by the largest possible radius so the whole buffer fits, plus
  // one cell of breathing room.
  const pad = maxRadius + (options.cellSize ?? 100);
  gMinX -= pad;
  gMinZ -= pad;
  gMaxX += pad;
  gMaxZ += pad;

  const width = gMaxX - gMinX;
  const height = gMaxZ - gMinZ;
  let cellSize = options.cellSize ?? 100;
  // Keep the raster bounded.
  if ((width / cellSize + 1) * (height / cellSize + 1) > maxCells) {
    cellSize = Math.sqrt((width * height) / maxCells);
  }
  const cols = Math.max(2, Math.floor(width / cellSize) + 1);
  const rows = Math.max(2, Math.floor(height / cellSize) + 1);

  // Decimate each cluster's points to the field resolution (default) so the
  // per-node distance scan does not blow up when many wells overlap. The bbox /
  // centroid computed above still use the full cloud, so pruning stays correct.
  const decimation = options.decimation ?? cellSize;
  if (decimation > 0) {
    for (const cl of prepared)
      cl.points = decimatePoints2D(cl.points, decimation);
  }

  // Signed distance field sampled at raster nodes. For each node, the nearest
  // cluster's (distanceToPoints - modulatedRadius) — negative inside the buffer.
  const field = new Float32Array(cols * rows);
  const maxR2Prune = maxRadius; // bbox expansion for early-out
  for (let r = 0; r < rows; r++) {
    const nz = gMinZ + r * cellSize;
    for (let c = 0; c < cols; c++) {
      const nx = gMinX + c * cellSize;
      let best = Infinity;
      for (const cl of prepared) {
        if (
          nx < cl.minX - maxR2Prune ||
          nx > cl.maxX + maxR2Prune ||
          nz < cl.minZ - maxR2Prune ||
          nz > cl.maxZ + maxR2Prune
        )
          continue;
        let dmin = Infinity;
        for (const [px, pz] of cl.points) {
          const dx = nx - px;
          const dz = nz - pz;
          const d = dx * dx + dz * dz;
          if (d < dmin) dmin = d;
        }
        dmin = Math.sqrt(dmin);
        let rad = radius;
        if (shapeFn) {
          const ang = Math.atan2(nz - cl.cz, nx - cl.cx);
          rad = radius * shapeFn(ang);
        }
        if (rad < minRadius) rad = minRadius;
        if (rad > maxRadius) rad = maxRadius;
        const signed = dmin - rad;
        if (signed < best) best = signed;
      }
      // Nodes beyond every cluster's prune range have no contribution; give them a
      // finite "clearly outside" value so the marching-squares edge interpolation
      // never sees Infinity (which produces NaN coordinates). Contour nodes are
      // always within maxRadius of a cluster, so they keep their true distance.
      field[r * cols + c] = best === Infinity ? maxRadius : best;
    }
  }

  // Optional box-blur to round the field (and hence the contour) corners.
  if (feather > 0) boxBlur(field, cols, rows, Math.max(1, Math.round(feather)));

  // Contour at zero (inside = negative), so flip sign for the >= convention.
  const flipped = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) flipped[i] = -field[i];
  const rings = marchingSquares(flipped, cols, rows, 0);
  if (rings.length === 0) return null;

  // Field (col,row) -> scene XZ.
  let sceneRings: Vec2[][] = rings.map(ring =>
    ring.map(([col, row]) => [gMinX + col * cellSize, gMinZ + row * cellSize]),
  );
  if (smoothing > 0)
    sceneRings = smoothRings(sceneRings, smoothing) as Vec2[][];
  if (options.minRingArea && options.minRingArea > 0) {
    const min = options.minRingArea;
    sceneRings = sceneRings.filter(r => Math.abs(ringSignedArea(r)) >= min);
  }

  const coordinates = ringsToPolygonCoordinates(sceneRings);
  if (coordinates.length === 0) return null;
  return new PlanarPolygonGeometry(coordinates);
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
