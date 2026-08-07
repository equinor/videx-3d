import type { Vec2 } from '../types/common';
import type { SurfaceClipHeader, SurfaceGridBounds } from './surface-clip';
import { gridToGridTransform } from './surface-clip';

/**
 * A layer participating in the depth-order pass: its grid, the grid geometry and
 * the depth-normalization reference used to place it (see
 * {@link SurfaceClipHeader} / `createClippedSurface`).
 *
 * @group Geometries
 */
export type DepthOrderLayer = {
  /** row-major elevation grid of length `header.nx * header.ny` (mutated in place) */
  values: Float32Array;
  /** grid geometry */
  header: SurfaceClipHeader;
  /**
   * Depth-normalization reference (`SurfaceMeta.max`). Samples are stored as
   * `value = referenceDepth - trueDepth`, so scene `y = value - referenceDepth`.
   */
  referenceDepth: number;
  /** scene XZ of the surface's grid origin (default `[0, 0]`) */
  worldPosition?: Vec2;
};

/** Options for {@link clampSurfaceUnder}. */
export type DepthOrderOptions = {
  /**
   * Minimum vertical separation to keep between the two surfaces, in world units.
   * `0` (default) only removes crossings — surfaces may still touch. A small
   * positive gap additionally separates co-planar surfaces, which removes
   * z-fighting, at the cost of giving genuinely pinched-out units an artificial
   * thickness.
   */
  minGap?: number;
  /** value marking a missing sample (default -1) */
  nullValue?: number;
  /**
   * Restrict the pass to this `(column, row)` window of the layer's grid — use
   * {@link surfaceGridBounds} to get the window a clip mask covers.
   *
   * ⚠️ Strongly recommended whenever the result is clipped to a mask. Clamping is
   * a hard `min` against a partially defined ceiling, so wherever the ceiling ends
   * (its data extent or a hole) the constraint stops abruptly and leaves a step in
   * the grid. Steps far outside the mask cost a lot of triangulation effort for
   * geometry that is discarded, and steps of hundreds of metres are common when a
   * ceiling covers a smaller area than the layer below it.
   */
  region?: SurfaceGridBounds;
  /**
   * Taper the correction to zero over this many cells as it approaches the edge of
   * the ceiling's coverage (its data extent or a hole). Default
   * {@link DEPTH_ORDER_FEATHER_DEFAULT}; `0` disables the taper.
   *
   * Without it the clamp stops dead where the ceiling ends, leaving a vertical
   * step in the grid — hundreds of metres tall when a ceiling covers a smaller
   * area than the layer below it. That is both a visible wall of geometry inside
   * the chunk and a dense cluster of sliver triangles for the triangulator.
   *
   * ⚠️ The taper needs room OUTSIDE the clipped area, so when a `region` is given
   * it should be grown by `feather` cells (see {@link depthOrderMargin}).
   */
  feather?: number;
};

/** Default {@link DepthOrderOptions.feather}, in grid cells. */
export const DEPTH_ORDER_FEATHER_DEFAULT = 8;

/**
 * Grid margin a depth-order pass needs around the clipped area: the clip's own
 * crop margin plus room for the feather taper to complete outside it. Pass this
 * as the `margin` of `surfaceGridBounds` when building {@link DepthOrderOptions.region}.
 *
 * @group Geometries
 */
export function depthOrderMargin(options: DepthOrderOptions = {}): number {
  return 2 + Math.max(0, options.feather ?? DEPTH_ORDER_FEATHER_DEFAULT);
}

// Bilinear sample using only the valid corners, WITHOUT clamping into the grid:
// a node outside the ceiling's extent (or over one of its holes) has no ceiling
// and must be left alone, so this returns NaN rather than an edge value.
function sampleStrict(
  values: Float32Array,
  nx: number,
  ny: number,
  fx: number,
  fz: number,
  nullValue: number,
): number {
  if (!(fx >= 0 && fx <= nx - 1 && fz >= 0 && fz <= ny - 1)) return NaN;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, nx - 1);
  const z1 = Math.min(z0 + 1, ny - 1);
  const tx = fx - x0;
  const tz = fz - z0;
  let sum = 0;
  let wsum = 0;
  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;
  let v = values[z0 * nx + x0];
  if (v !== nullValue && v >= 0) {
    sum += v * w00;
    wsum += w00;
  }
  v = values[z0 * nx + x1];
  if (v !== nullValue && v >= 0) {
    sum += v * w10;
    wsum += w10;
  }
  v = values[z1 * nx + x0];
  if (v !== nullValue && v >= 0) {
    sum += v * w01;
    wsum += w01;
  }
  v = values[z1 * nx + x1];
  if (v !== nullValue && v >= 0) {
    sum += v * w11;
    wsum += w11;
  }
  return wsum > 0 ? sum / wsum : NaN;
}

// Whether both layers sample the exact same grid nodes, so the ceiling can be
// read by index without any resampling.
function sameGrid(a: DepthOrderLayer, b: DepthOrderLayer) {
  const [ax, az] = a.worldPosition ?? [0, 0];
  const [bx, bz] = b.worldPosition ?? [0, 0];
  return (
    a.header.nx === b.header.nx &&
    a.header.ny === b.header.ny &&
    a.header.xinc === b.header.xinc &&
    a.header.yinc === b.header.yinc &&
    a.header.rot === b.header.rot &&
    ax === bx &&
    az === bz
  );
}

// Distance, in cells, from every node to the nearest node with NO ceiling, via a
// two-sweep chamfer transform (1 orthogonal / √2 diagonal). Nodes outside the
// window are treated as covered, so the window's own edge is not a boundary — the
// window is grown by the feather width instead (see depthOrderMargin).
function coverageDistance(
  ceil: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const D = 1;
  const D2 = Math.SQRT2;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) {
    dist[i] = Number.isNaN(ceil[i]) ? 0 : Infinity;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = row - w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, dist[i - 1] + D);
      if (y > 0) {
        d = Math.min(d, dist[up + x] + D);
        if (x > 0) d = Math.min(d, dist[up + x - 1] + D2);
        if (x < w - 1) d = Math.min(d, dist[up + x + 1] + D2);
      }
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    const down = row + w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x < w - 1) d = Math.min(d, dist[i + 1] + D);
      if (y < h - 1) {
        d = Math.min(d, dist[down + x] + D);
        if (x < w - 1) d = Math.min(d, dist[down + x + 1] + D2);
        if (x > 0) d = Math.min(d, dist[down + x - 1] + D2);
      }
      dist[i] = d;
    }
  }
  return dist;
}

/** The result of {@link clampSurfaceUnder}. */
export type DepthOrderResult = {
  /** number of nodes that were clamped */
  clamped: number;
  /**
   * The reference depth the layer must now be placed with. Samples are encoded as
   * a non-negative depth below the reference, and a negative sample would be read
   * as no-data downstream — so when the clamp needs to push nodes below the
   * layer's own reference floor, the whole layer is rebased (its samples and this
   * reference shift together, leaving the scene position unchanged). Usually
   * identical to the input `referenceDepth`.
   */
  referenceDepth: number;
};

/**
 * Push `layer` down wherever it rises above `ceiling`, so a stack of surfaces
 * stays in depth order. The layer's grid is modified **in place**.
 *
 * Crossing surfaces are the norm in modelled data (a deeper horizon poking through
 * a shallower one), which shows up as interpenetrating blocks and — where two
 * surfaces are near-coincident — as z-fighting. Applying this pairwise down a
 * stack, each layer against the already-clamped one above it, makes the whole
 * stack monotonic. Unlike the rim-only pinch-out clamp in `assembleChunk`, this
 * fixes the surface **interiors** as well, because it operates on the grid before
 * triangulation.
 *
 * The two layers may have different grid geometries — the ceiling is resampled at
 * this layer's nodes (bilinear, valid corners only). Nodes outside the ceiling's
 * extent, or over one of its holes, have no ceiling and are left untouched, as are
 * this layer's own no-data nodes.
 *
 * @param layer the deeper layer, clamped in place
 * @param ceiling the layer above (not modified). Pass the ALREADY-clamped layer
 *   above when cascading down a stack, with its updated `referenceDepth`.
 * @param options see {@link DepthOrderOptions}
 * @returns see {@link DepthOrderResult} — the caller must place the layer with the
 *   returned `referenceDepth`
 *
 * @group Geometries
 */
export function clampSurfaceUnder(
  layer: DepthOrderLayer,
  ceiling: DepthOrderLayer,
  options: DepthOrderOptions = {},
): DepthOrderResult {
  const minGap = options.minGap ?? 0;
  const nullValue = options.nullValue ?? -1;
  const { values, header } = layer;
  const { nx, ny } = header;
  const cNx = ceiling.header.nx;
  const cNy = ceiling.header.ny;
  const cValues = ceiling.values;

  // Scene y = value - referenceDepth, so a ceiling sample maps to this layer's
  // encoding as `value <= ceilingValue + offset`.
  let offset = layer.referenceDepth - ceiling.referenceDepth - minGap;

  // The lowest limit this pass can produce comes from the ceiling's own minimum.
  // If that is negative it would be read as no-data, so rebase the whole layer
  // (samples + reference shift together, so nothing moves in the scene).
  let minCeiling = Infinity;
  for (let i = 0; i < cValues.length; i++) {
    const cv = cValues[i];
    if (cv === nullValue || cv < 0) continue;
    if (cv < minCeiling) minCeiling = cv;
  }
  let referenceDepth = layer.referenceDepth;
  if (minCeiling !== Infinity && minCeiling + offset < 0) {
    const shift = -(minCeiling + offset);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === nullValue || v < 0) continue;
      values[i] = v + shift;
    }
    offset += shift;
    referenceDepth += shift;
  }

  let clamped = 0;
  const col0 = options.region ? Math.max(0, options.region.col0) : 0;
  const row0 = options.region ? Math.max(0, options.region.row0) : 0;
  const col1 = options.region ? Math.min(nx - 1, options.region.col1) : nx - 1;
  const row1 = options.region ? Math.min(ny - 1, options.region.row1) : ny - 1;
  const rw = col1 - col0 + 1;
  const rh = row1 - row0 + 1;
  if (rw <= 0 || rh <= 0) return { clamped, referenceDepth };

  const feather = Math.max(0, options.feather ?? DEPTH_ORDER_FEATHER_DEFAULT);
  const same = sameGrid(layer, ceiling);

  // Pass 1: gather the ceiling over the region (NaN = no ceiling here). Holding it
  // lets the feather pass measure the distance to the ceiling's coverage boundary
  // without sampling twice.
  const ceil = new Float32Array(rw * rh);
  if (same) {
    for (let row = row0; row <= row1; row++) {
      const base = row * nx;
      const out = (row - row0) * rw;
      for (let col = col0; col <= col1; col++) {
        const cv = cValues[base + col];
        ceil[out + col - col0] = cv === nullValue || cv < 0 ? NaN : cv;
      }
    }
  } else {
    const { a, b, c, d, e, f } = gridToGridTransform(
      layer.header,
      layer.worldPosition,
      ceiling.header,
      ceiling.worldPosition,
    );
    for (let row = row0; row <= row1; row++) {
      let cCol = a * col0 + b * row + c;
      let cRow = d * col0 + e * row + f;
      const out = (row - row0) * rw;
      for (let col = col0; col <= col1; col++, cCol += a, cRow += d) {
        ceil[out + col - col0] = sampleStrict(
          cValues,
          cNx,
          cNy,
          cCol,
          cRow,
          nullValue,
        );
      }
    }
  }

  // Pass 2: distance (in cells) from each node to the nearest node WITHOUT a
  // ceiling, so the clamp can taper off there instead of stopping dead.
  const dist = feather > 0 ? coverageDistance(ceil, rw, rh) : null;

  // Pass 3: apply, tapering the correction in over `feather` cells.
  for (let row = row0; row <= row1; row++) {
    const base = row * nx;
    const out = (row - row0) * rw;
    for (let col = col0; col <= col1; col++) {
      const v = values[base + col];
      if (v === nullValue || v < 0) continue;
      const j = out + col - col0;
      const cv = ceil[j];
      if (Number.isNaN(cv)) continue;
      let limit = cv + offset;
      if (v <= limit) continue;
      if (dist) {
        const t = Math.min(1, dist[j] / feather);
        if (t <= 0) continue;
        limit = v + (limit - v) * t;
      }
      values[base + col] = limit;
      clamped++;
    }
  }
  return { clamped, referenceDepth };
}
