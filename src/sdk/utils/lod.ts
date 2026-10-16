import { Camera, OrthographicCamera, PerspectiveCamera } from 'three';

/**
 * A coarser level is taken only once its error is this far under the limit, so a
 * thing on the boundary does not flip between two levels every frame.
 *
 * @group Utils
 */
export const LOD_COARSEN_MARGIN = 0.8;

/**
 * How many pixels one unit spans at a distance from `camera`, for a viewport
 * `height` pixels tall. An orthographic camera's is the same at any distance.
 *
 * @group Utils
 */
export function pixelsPerUnit(
  camera: Camera,
  height: number,
): (distance: number) => number {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as OrthographicCamera;
    const scale = (height * ortho.zoom) / (ortho.top - ortho.bottom);
    return () => scale;
  }
  const perspective = camera as PerspectiveCamera;
  const scale =
    (height * (perspective.zoom ?? 1)) /
    (2 * Math.tan(((perspective.fov ?? 50) * Math.PI) / 360));
  return distance => scale / Math.max(distance, 1e-6);
}

/**
 * The coarsest level of detail whose error, times `scale` (e.g. pixels per unit),
 * stays within `pixelError`. Goes finer as soon as `current` is over the limit, and
 * coarser only once the next level is under it by {@link LOD_COARSEN_MARGIN}.
 *
 * @param errors per level, the full one first, ascending
 * @param current the level drawn now
 *
 * @group Utils
 */
export function selectLodLevel(
  errors: ArrayLike<number>,
  scale: number,
  pixelError: number,
  current: number,
): number {
  const last = errors.length - 1;
  let k = Math.min(current, last);
  while (k > 0 && errors[k] * scale > pixelError) k--;
  while (k < last && errors[k + 1] * scale <= pixelError * LOD_COARSEN_MARGIN)
    k++;
  return k;
}
