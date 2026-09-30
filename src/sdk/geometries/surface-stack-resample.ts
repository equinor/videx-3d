import type { Vec2 } from '../types/common';
import { chamferFill } from './chamfer';
import { gridToGridTransform, SurfaceClipHeader } from './surface-grid';
import { STACK_NO_DATA } from './surface-stack-candidates';

// ⚠️ THIS MODULE MUST STAY FREE OF three.js. It is imported by the inlined stack
// worker (`?worker&inline`), which is shipped base64-encoded inside the library
// bundle — pulling three in here would embed a second copy of it.

/** `StackReference.masks`: the layer has no extent at this node. */
export const STACK_MASK_NONE = 0;
/** `StackReference.masks`: the layer has data of its own at this node. */
export const STACK_MASK_DATA = 1;
/**
 * `StackReference.masks`: no data of the layer's own, but close enough to some
 * that `StackReferenceOptions.maxFill` counts the node as covered.
 */
export const STACK_MASK_FILLED = 2;

/**
 * The common grid a stack is resampled onto, before any layer has been read.
 *
 * ⭐ It depends only on the layers' HEADERS and the outline, never on their
 * samples, which is what lets each layer be resampled as its grid arrives (or in
 * a worker) instead of waiting for the whole column.
 *
 * @group Geometries
 */
export type StackReferencePlan = {
  header: SurfaceClipHeader;
  worldPosition: Vec2;
  /** how many source grid cells one reference cell spans (1 = full resolution) */
  step: number;
  /**
   * How far a layer's coverage may extend past its own data, in CELLS of this
   * grid. `Infinity` = unbounded, so every filled node counts as covered.
   */
  fillLimit: number;
};

/** One layer's placement on its own grid — everything but the samples. */
export type StackGridPlacement = {
  header: SurfaceClipHeader;
  worldPosition?: Vec2;
};

/** One layer resampled onto the common grid by {@link resampleStackLayer}. */
export type StackLayerResample = {
  /** scene Y at every node of the common grid */
  channel: Float32Array;
  /** the layer's effective extent (`STACK_MASK_*`) at every node */
  mask: Uint8Array;
  /** the layer has no data anywhere on this grid */
  empty: boolean;
};

// Fill every node from the nearest valid sample, so the channel is continuous
// everywhere: a cliff at a data edge would otherwise cost the triangulator a
// cluster of slivers for geometry that is either outside the mask or about to be
// truncated. `limit` (in CELLS) bounds how far the fill counts as COVERAGE —
// values are filled regardless; what is bounded is the mask.
function fillNearest(
  values: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  limit: number,
) {
  const dist = chamferFill(values, mask, w, h);
  if (limit < Infinity) {
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] && dist[i] <= limit) mask[i] = STACK_MASK_FILLED;
    }
  }
}

// Bilinear sample over the VALID corners only, without clamping into the grid:
// returns NaN outside the grid or where all four corners are missing.
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
  // The four corner weights, inlined: this runs once per node of the common grid
  // (millions), and a closure call per corner was measurable.
  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;
  const r0 = z0 * nx;
  const r1 = z1 * nx;
  const v00 = values[r0 + x0];
  const v10 = values[r0 + x1];
  const v01 = values[r1 + x0];
  const v11 = values[r1 + x1];
  let sum = 0;
  let wsum = 0;
  if (v00 !== nullValue && v00 >= 0) {
    sum += v00 * w00;
    wsum += w00;
  }
  if (v10 !== nullValue && v10 >= 0) {
    sum += v10 * w10;
    wsum += w10;
  }
  if (v01 !== nullValue && v01 >= 0) {
    sum += v01 * w01;
    wsum += w01;
  }
  if (v11 !== nullValue && v11 >= 0) {
    sum += v11 * w11;
    wsum += w11;
  }
  return wsum > 0 ? sum / wsum : NaN;
}

/**
 * Resample ONE layer's grid onto a stack's common grid, in scene Y.
 *
 * Independent of every other layer — which is the point: `buildStackReference`
 * runs this in a loop, while the chunk generator runs it per layer as the grid
 * arrives, on a worker.
 *
 * @param plan the common grid, from `planStackReference`
 * @param layer the layer's samples and its own placement
 * @param referenceDepth depth-normalization reference (`SurfaceMeta.max`): samples
 *   encode `value = referenceDepth - trueDepth`, so scene `y = value - referenceDepth`
 * @param nullValue the value marking a missing sample (default -1)
 *
 * @group Geometries
 */
export function resampleStackLayer(
  plan: StackReferencePlan,
  layer: StackGridPlacement & { values: Float32Array },
  referenceDepth: number,
  nullValue = -1,
): StackLayerResample {
  const { nx, ny } = plan.header;
  const count = nx * ny;
  const channel = new Float32Array(count);
  const mask = new Uint8Array(count);
  const { a, b, c, d, e, f } = gridToGridTransform(
    plan.header,
    plan.worldPosition,
    layer.header,
    layer.worldPosition,
  );
  const lnx = layer.header.nx;
  const lny = layer.header.ny;
  let any = false;
  for (let row = 0; row < ny; row++) {
    let col2 = b * row + c;
    let row2 = e * row + f;
    const out = row * nx;
    for (let col = 0; col < nx; col++, col2 += a, row2 += d) {
      const v = sampleStrict(layer.values, lnx, lny, col2, row2, nullValue);
      if (Number.isNaN(v)) {
        channel[out + col] = STACK_NO_DATA;
      } else {
        // scene Y (upwards-positive, sea level at 0)
        channel[out + col] = v - referenceDepth;
        mask[out + col] = STACK_MASK_DATA;
        any = true;
      }
    }
  }
  if (any) fillNearest(channel, mask, nx, ny, plan.fillLimit);
  return { channel, mask, empty: !any };
}

/**
 * Lay any layer with NO data anywhere onto its nearest mapped neighbour.
 *
 * ⚠️ A horizon eroded away across the whole area, or a survey that misses this
 * footprint entirely, has nothing to fill from — its channel would keep the
 * `STACK_NO_DATA` sentinel (-1e30) and draw a surface reaching to infinity. Laid
 * on a neighbour it has zero thickness instead, so it claims no volume and the
 * collapse drops it. The MASK is left empty, so absence and the diagnostics stay
 * truthful.
 *
 * Mutates `channels` in place.
 *
 * @group Geometries
 */
export function layEmptyStackLayers(
  channels: Float32Array[],
  empty: boolean[],
): void {
  for (let i = 0; i < channels.length; i++) {
    if (!empty[i]) continue;
    let donor = -1;
    for (let j = i - 1; j >= 0 && donor < 0; j--) if (!empty[j]) donor = j;
    for (let j = i + 1; j < channels.length && donor < 0; j++) {
      if (!empty[j]) donor = j;
    }
    if (donor >= 0) channels[i].set(channels[donor]);
  }
}
