import { LOD_COARSEN_MARGIN, selectLodLevel } from '../../../sdk/utils/lod';

// caps drawn, caps dropped: the error of dropping them is the radius on screen
const CAP_ERRORS = [0, 1];

/**
 * Pick a trajectory's curve level, radial level and whether to drop its end caps for an
 * eye at `distance` metres, into `state` = `[curve, radial, caps, from, to]`: the
 * levels (read as the ones drawn now, for the hysteresis of {@link selectLodLevel};
 * `caps` 1 = dropped) and the distance range `[from, to)` over which picking again
 * would give the same. Between picks a moving camera then costs two comparisons.
 *
 * A missing cap changes the tube's end by about its radius, so caps are dropped only
 * once the radius on screen, before the `floor`, is within `pixelError`.
 *
 * @param perMetre pixels one metre spans at a distance of 1 m; at `d` it spans
 *   `perMetre / d`, or `perMetre` at any distance when `constant` (orthographic)
 * @param tolerances per curve level, how far it strays from the full one, ascending
 * @param sideErrors per radial level, the silhouette error as a fraction of the radius
 * @param radius the tube radius in metres
 * @param floor the smallest on-screen radius the tube is drawn with, in pixels
 */
export function selectTrajectoryLod(
  state: Float64Array,
  distance: number,
  perMetre: number,
  constant: boolean,
  tolerances: ArrayLike<number>,
  sideErrors: ArrayLike<number>,
  radius: number,
  floor: number,
  pixelError: number,
): void {
  const scale = constant ? perMetre : perMetre / Math.max(distance, 1e-6);
  const curve = selectLodLevel(tolerances, scale, pixelError, state[0]);
  const radial = selectLodLevel(
    sideErrors,
    Math.max(radius * scale, floor),
    pixelError,
    state[1],
  );
  const caps = selectLodLevel(CAP_ERRORS, radius * scale, pixelError, state[2]);
  state[0] = curve;
  state[1] = radial;
  state[2] = caps;
  if (constant) {
    state[3] = 0;
    state[4] = Infinity;
    return;
  }
  // The rule of `selectLodLevel` solved for the distance: stay unless the level's own
  // error grows past `pixelError`, or the next one's falls under it by the margin.
  const coarser = pixelError * LOD_COARSEN_MARGIN;
  const curveFrom = (tolerances[curve] * perMetre) / pixelError;
  const curveTo =
    curve < tolerances.length - 1
      ? (tolerances[curve + 1] * perMetre) / coarser
      : Infinity;
  const radialFrom =
    radial > 0 ? (sideErrors[radial] * radius * perMetre) / pixelError : 0;
  const radialTo =
    radial < sideErrors.length - 1 && sideErrors[radial + 1] * floor <= coarser
      ? (sideErrors[radial + 1] * radius * perMetre) / coarser
      : Infinity;
  const capsFrom = caps ? (radius * perMetre) / pixelError : 0;
  const capsTo = caps ? Infinity : (radius * perMetre) / coarser;
  state[3] = Math.max(curveFrom, radialFrom, capsFrom);
  state[4] = Math.min(curveTo, radialTo, capsTo);
}
