import { Vec2 } from '../types/common';

export const PI = Math.PI;
export const TAU = 2 * Math.PI; // two PI
export const PI2 = Math.PI / 2; // half PI
export const PI4 = Math.PI / 4; // quarter PI
export const PI8 = Math.PI / 8; // eight PI

/**
 * Given a 2D rectangle and an angle off the center, find the point
 * of the closest corner. Used for anchoring connector lines
 * to annotation labels.
 */
export function edgeOfRectangle(rect: Vec2, theta: number): Vec2 {
  while (theta < -Math.PI) {
    theta += TAU;
  }

  while (theta > Math.PI) {
    theta -= TAU;
  }

  const rectAtan = Math.atan2(rect[1], rect[0]);
  const tanTheta = Math.tan(theta);
  let region;

  if (theta > -rectAtan && theta <= rectAtan) {
    region = 1;
  } else if (theta > rectAtan && theta <= Math.PI - rectAtan) {
    region = 2;
  } else if (theta > Math.PI - rectAtan || theta <= -(Math.PI - rectAtan)) {
    region = 3;
  } else {
    region = 4;
  }

  const edgePoint: Vec2 = [0, 0];
  let xFactor = 1;
  let yFactor = 1;

  switch (region) {
    case 1:
      yFactor = -1;
      break;
    case 2:
      yFactor = -1;
      break;
    case 3:
      xFactor = -1;
      break;
    case 4:
      xFactor = -1;
      break;
  }

  if (region === 1 || region === 3) {
    edgePoint[0] += xFactor * (rect[0] / 2); // "Z0"
    edgePoint[1] += yFactor * (rect[0] / 2) * tanTheta;
  } else {
    edgePoint[0] += xFactor * (rect[1] / (2 * tanTheta)); // "Z1"
    edgePoint[1] += yFactor * (rect[1] / 2);
  }

  return edgePoint;
}
