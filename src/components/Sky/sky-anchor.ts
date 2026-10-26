import { Object3D, Quaternion, Vector3 } from 'three';
import type { SkyMaterial } from './sky-material';

// How far either side of the anchor the curve's slope is measured, in world units.
const SLOPE_STEP = 100;
const UP = new Vector3(0, 1, 0);
const point = new Vector3();
const pivot = new Vector3();
const normal = new Vector3();
const turn = new Quaternion();

/**
 * Place `object` rigidly on the curve of `sky`'s sea as `eye` sees it this frame: lowered
 * by as much as the sea is at world X/Z (`x`, `z`), and tilted to its slope there, turned
 * about that point at the sea's level (see `SkyMaterial.curveDrop`). Only while the ground
 * curves with the sea (`SkyMaterial.followAway`: a stage's relief drawn from tiles); else,
 * and without `curvedHorizon`, back where it was — no transform — as the stage's own flat
 * seabed is.
 *
 * ⚠️ Sets the object's position and rotation: give it a group of its own. Assumes the
 * default `up` (+Y).
 */
export function placeOnSkyCurve(
  object: Object3D,
  sky: SkyMaterial,
  eye: Vector3,
  x: number,
  z: number,
) {
  if (!sky.curvedHorizon || !sky.followAway) {
    object.position.set(0, 0, 0);
    object.quaternion.identity();
    return;
  }
  // This frame's disc, whether the sky's own frame has run yet or not.
  sky.followFlatSea(eye);
  const level = sky.oceanLevel;
  const drop = (px: number, pz: number) =>
    sky.curveDrop(point.set(px, level, pz), eye);
  const down = drop(x, z);
  const slopeX =
    (drop(x + SLOPE_STEP, z) - drop(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP);
  const slopeZ =
    (drop(x, z + SLOPE_STEP) - drop(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP);
  // The sea falls as the drop grows: its surface faces up and away from the rise.
  normal.set(slopeX, 1, slopeZ).normalize();
  turn.setFromUnitVectors(UP, normal);
  pivot.set(x, level, z);
  object.quaternion.copy(turn);
  object.position.copy(pivot).sub(point.copy(pivot).applyQuaternion(turn));
  object.position.y -= down;
}
