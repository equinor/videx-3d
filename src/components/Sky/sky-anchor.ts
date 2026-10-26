import { Object3D, Quaternion, Vector3 } from 'three';
import type { Globe } from '../../sdk/projection/globe';

const pivot = new Vector3();
const placed = new Vector3();
const normal = new Vector3();
const turn = new Quaternion();

/**
 * Place `object` rigidly on `globe` about world X/Z (`x`, `z`): what lies at that point of
 * the sea's level goes where the globe has it (`Globe.place`), turned so the scene's up is
 * the globe's up there. Nothing over the globe's disc, or with it off — no transform — so a
 * field on the disc is never moved. No camera in it: the same from anywhere.
 *
 * ⚠️ Sets the object's position and rotation: give it a group of its own.
 */
export function placeOnGlobe(
  object: Object3D,
  globe: Globe,
  x: number,
  z: number,
) {
  const up = globe.up;
  globe.place(x, z, 0, placed);
  globe.upAt(placed, normal);
  turn.setFromUnitVectors(up, normal);
  pivot.set(x, 0, z).addScaledVector(up, globe.level - (x * up.x + z * up.z));
  object.quaternion.copy(turn);
  object.position.copy(placed).sub(pivot.applyQuaternion(turn));
}
