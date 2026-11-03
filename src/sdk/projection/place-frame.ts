import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Vec2 } from '../types/common';
import { GeoFrame, GeoFramePlacement, placeGeoFrame } from './geo-frame';
import type { Globe } from './globe';

const onGlobe = new Matrix4();
const shifted = new Matrix4();
// globeUprightMatrix's.
const upThere = new Vector3();
const foot = new Vector3();
const tilt = new Quaternion();

/**
 * The matrix that places a frame's content in the scene: flat by `placement` (see
 * `placeGeoFrame`: turned about +Y, scaled along X and Z, moved to where its origin — or its
 * `pivot` — lands), then, with a `globe`, onto it about that point as the globe places the
 * ground there (`Globe.tangent`). What the frame draws at its X/Z then lies where the scene's
 * map, and its globe, have that point of the Earth: exactly at the pivot, and off by the
 * curve's `d² / 2R` at `d` from it. In 64-bit floats, as three.js composes a draw's
 * transform: a field placed 300 km out is drawn as precisely as at home.
 *
 * @group Utils
 */
export function geoFrameMatrix(
  placement: GeoFramePlacement,
  globe: Globe | null,
  target: Matrix4,
): Matrix4 {
  const { x, z, rotation, scale, pivot } = placement;
  const c = Math.cos(rotation) * scale;
  const s = Math.sin(rotation) * scale;
  const [px, pz] = pivot ?? [0, 0];
  const tx = x - (c * px + s * pz);
  const tz = z - (c * pz - s * px);
  // T(x, 0, z) · Ry(rotation) · S(scale, 1, scale) · T(−pivot).
  target.set(c, 0, s, tx, 0, 1, 0, 0, -s, 0, c, tz, 0, 0, 0, 1);
  if (globe) target.premultiply(globe.tangent(x, z, onGlobe));
  return target;
}

/**
 * The matrix that stands what is drawn flat about a point upright on `globe` there: what
 * lies at the point's foot on the level plane (straight down along the scene's up, at the
 * globe's `level`) goes to `point`, turned from the scene's up to the globe's up at `point`
 * by the least rotation (`Globe.upAt`), so it keeps the X/Z and the heading it is drawn
 * with, tilted with the Earth there. `point` is where the globe places something on its
 * sea's level: `Globe.geodetic` at height 0.
 *
 * The identity over the disc, where such a point lies on the level plane, and with the
 * globe off: content drawn flat there is not moved. Through no map, unlike
 * `Globe.tangent`, so it holds anywhere on the Earth, the far side included, but at the
 * disc's antipode, where the turn has no one axis. Nothing is squeezed: for an object of a
 * ship's size, not a field's.
 *
 * @group Utils
 */
export function globeUprightMatrix(
  globe: Globe,
  point: Vector3,
  target: Matrix4,
): Matrix4 {
  const up = globe.up;
  tilt.setFromUnitVectors(up, globe.upAt(point, upThere));
  foot.copy(point).addScaledVector(up, globe.level - point.dot(up));
  // T(point) · R(tilt) · T(−foot).
  target.makeRotationFromQuaternion(tilt);
  foot.applyMatrix4(target);
  return target.setPosition(foot.subVectors(point, foot));
}

/**
 * The matrix from a scene's coordinates while its `World`'s frame is `from` to its
 * coordinates once it is `to`: the inverse of where `to`'s content lay while the frame was
 * `from` — flat (`placeGeoFrame`), then on `globe` as it lay then (`Globe.tangent`), about
 * `pivot` (`to`'s own X/Z, east and south of its origin; default its origin) — and `to`'s
 * `offset`. So it is exact for what the new field draws, and an affine fit elsewhere: its
 * scale and squeeze are the new field's, so far from it what lies on the globe is carried a
 * little off (a camera 500 m over a field 123 km away lands 37 m low, 0.6 m aside). Carry what
 * lies far from the new field by its latitude, longitude and height instead
 * ({@link globeCarry}).
 *
 * @param globe the globe as it lay while the frame was `from`; null for flat
 * @group Utils
 */
export function geoFrameChangeMatrix(
  from: GeoFrame,
  to: GeoFrame,
  globe: Globe | null,
  target: Matrix4,
  pivot?: Vec2,
): Matrix4 {
  geoFrameMatrix(placeGeoFrame(to, from, pivot), globe, target).invert();
  const [ox, oz] = to.offset ?? [0, 0];
  if (ox !== 0 || oz !== 0)
    target.premultiply(shifted.makeTranslation(ox, 0, oz));
  return target;
}

/**
 * Carries points and directions from one globe to another: from a scene's coordinates while
 * its `World`'s frame was one to its coordinates once it is another (see
 * {@link globeCarry}).
 *
 * @group Utils
 */
export type GlobeCarry = {
  /** `point`, carried by its latitude, longitude and height over the sea; `target` may be `point` */
  point: (point: Vector3, target: Vector3) => Vector3;
  /**
   * `direction` at `at` (a camera's up, say): where it leads a short way on, carried as
   * points are, normalised
   */
  direction: (direction: Vector3, at: Vector3, target: Vector3) => Vector3;
};

// How far along a direction globeCarry carries a second point, in scene units.
const CARRY_STEP = 100;

/**
 * Carries what lay on `from` onto `to`, by latitude, longitude and height over the sea
 * (`Globe.geographic`, `Globe.altitude`, then `Globe.geodetic`): exact for whatever the globes
 * place by where it is on the Earth — the relief, the geographic layers, a camera over the
 * ground — at any distance. A field's own content, flat in its frame, is placed about its
 * pivot and stands off the curve toward its edges by `d² / 2R`: carry it by
 * {@link geoFrameChangeMatrix} instead, exact for the new field. Both globes need a frame.
 *
 * @param from the globe as it lay before (`Globe.clone`, taken before the change)
 * @param to the globe as it lies now
 * @group Utils
 */
export function globeCarry(from: Globe, to: Globe): GlobeCarry {
  const where = { latitude: 0, longitude: 0 };
  const base = new Vector3();
  const ahead = new Vector3();
  const point = (p: Vector3, target: Vector3) => {
    from.geographic(p, where);
    return to.geodetic(
      where.latitude,
      where.longitude,
      from.altitude(p),
      target,
    );
  };
  return {
    point,
    direction: (direction, at, target) => {
      ahead.copy(at).addScaledVector(direction, CARRY_STEP);
      point(at, base);
      return point(ahead, target).sub(base).normalize();
    },
  };
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
