import { PerspectiveCamera, Vector3 } from 'three';
import {
  normalizeVec2,
  PI,
  PI2,
  PI4,
  PI8,
  subVec2,
  Vec2,
  Vec3,
} from '../../sdk';

const position = new Vector3();

export const labelAngles = [
  /* 0 */ 0,
  /* 1 */ PI4,
  /* 2 */ PI2,
  /* 3 */ PI - PI4,
  /* 4 */ PI,
  /* 5 */ -PI + PI4,
  /* 6 */ -PI2,
  /* 7 */ -PI4,
];
/**
 * 0 = [-] annotation is pointing approx. horizontally
 * 1 = [/] annotation is pointing approx. diagonally (from lower left to upper right)
 * 2 = [|] annotation is pointing approx. vertically
 * 3 = [\] annotation is pointing approx. diagonally (from upper left to lower right)
 */
export const labelAnglesMap = [
  [2, 6],
  [7, 3],
  [0, 4],
  [1, 5],
];

export const getLabelQuadrant = (
  originScreen: Vec2,
  origin3d: Vec3,
  direction3d: Vec3,
  camera: PerspectiveCamera,
) => {
  if (camera) {
    position.set(
      origin3d[0] + direction3d[0] * 100,
      origin3d[1] + direction3d[1] * 100,
      origin3d[2] + direction3d[2] * 100,
    );

    position.project(camera);

    const directionScreen = normalizeVec2(
      subVec2([position.x, position.y], [originScreen[0], originScreen[1]]),
    );

    let angle = Math.atan2(directionScreen[1], directionScreen[0]);
    if (isNaN(angle)) return 0;

    if (angle < 0) angle = PI + angle; // normalize to 0-PI

    const quadrant = Math.floor((angle + PI8) / PI4) % 4;

    return quadrant;
  }
  return 0;
};
