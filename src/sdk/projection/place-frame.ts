import { Matrix4, Object3D } from 'three';
import type { GeoFramePlacement } from './geo-frame';
import type { Globe } from './globe';

const onGlobe = new Matrix4();

/**
 * The matrix that places a frame's content in the scene: flat by `placement` (see
 * `placeGeoFrame`: turned about +Y, scaled along X and Z, moved to where its origin lands),
 * then, with a `globe`, onto it about that point as the globe places the ground there
 * (`Globe.tangent`). What the frame draws at its X/Z then lies where the scene's map, and
 * its globe, have that point of the Earth. In 64-bit floats, as three.js composes a draw's
 * transform: a field placed 300 km out is drawn as precisely as at home.
 *
 * @group Utils
 */
export function geoFrameMatrix(
  placement: GeoFramePlacement,
  globe: Globe | null,
  target: Matrix4,
): Matrix4 {
  const { x, z, rotation, scale } = placement;
  const c = Math.cos(rotation) * scale;
  const s = Math.sin(rotation) * scale;
  // T(x, 0, z) · Ry(rotation) · S(scale, 1, scale).
  target.set(c, 0, s, x, 0, 1, 0, 0, -s, 0, c, z, 0, 0, 0, 1);
  if (globe) target.premultiply(globe.tangent(x, z, onGlobe));
  return target;
}

/**
 * Set `object`'s matrix, which three.js then leaves as it is (`matrixAutoUpdate` off) until
 * {@link releaseObjectMatrix}. Its world matrices are composed again only when it changes,
 * so setting the same one each frame costs a comparison.
 *
 * @group Utils
 */
export function setObjectMatrix(object: Object3D, matrix: Matrix4) {
  if (object.matrixAutoUpdate) {
    object.matrixAutoUpdate = false;
  } else if (object.matrix.equals(matrix)) {
    return;
  }
  object.matrix.copy(matrix);
  object.matrixWorldNeedsUpdate = true;
}

/**
 * Hand an object {@link setObjectMatrix} set back to three.js, with no transform: its
 * matrix composed from its position, rotation and scale again, all reset.
 *
 * @group Utils
 */
export function releaseObjectMatrix(object: Object3D) {
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.scale.set(1, 1, 1);
  object.matrixAutoUpdate = true;
  object.updateMatrix();
}
