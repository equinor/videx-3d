import type { Object3D } from 'three';

/** Which side of the ground a group's content lies on (see `SceneryBelowGround`). */
export type SceneryGroundSide = 'below' | 'above';

const SIDES = new WeakMap<object, Map<Object3D, SceneryGroundSide>>();

/**
 * @internal
 * The groups of a scene whose content lies wholly on one side of the ground a `Scenery` draws
 * (`SceneryBelowGround`, `SceneryAboveGround`), wherever they lie in the tree: shown or hidden
 * each frame by the `Scenery` in that scene, as that side can show from the camera or not.
 */
export function sceneryGroundSides(
  scene: object,
): Map<Object3D, SceneryGroundSide> {
  let sides = SIDES.get(scene);
  if (!sides) {
    sides = new Map();
    SIDES.set(scene, sides);
  }
  return sides;
}
