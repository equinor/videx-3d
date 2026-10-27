import { Matrix4, Object3D } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import {
  releaseObjectMatrix,
  setObjectMatrix,
} from '../../sdk/projection/place-frame';

const placing = new Matrix4();

/**
 * Place `object` on `globe` about world X/Z (`x`, `z`) as the globe places the ground there,
 * to first order (`Globe.tangent`): what lies at that point of the sea's level goes where
 * the globe has it, turned so the scene's up is the globe's up there, and squeezed as the
 * ground around it is. Nothing over the globe's disc, or with it off — no transform — so a
 * field on the disc is never moved. No camera in it: the same from anywhere.
 *
 * ⚠️ Sets the object's matrix, and stops three.js composing it from its position, rotation
 * and scale until {@link releaseFromGlobe}: give it a group of its own.
 */
export function placeOnGlobe(
  object: Object3D,
  globe: Globe,
  x: number,
  z: number,
) {
  setObjectMatrix(object, globe.tangent(x, z, placing));
}

/** Put an object {@link placeOnGlobe} placed back where it was: no transform. */
export const releaseFromGlobe = releaseObjectMatrix;
