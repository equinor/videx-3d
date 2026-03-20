import { PositionLog } from '../data/types/PositionLog';
import { Curve3D, getSplineCurve } from '../geometries/curve/curve-3d';
import { Vec2, Vec3 } from '../types/common';
import { clamp } from './numbers';
import {
  addVec2,
  directionVec2,
  distanceVec2,
  dotVec2,
  normalizeVec2,
  subVec2,
} from './vector-operations';

/**
 * Interface for defining a trajectory. This can be used to work with wellbore trajectories,
 * where the measured top, termination point and length are known. The measured length should
 * be used when calculating positions of data given in MD, so that the position on the curve is
 * given by:
 *
 * @example
 * const pos = (md - trajectory.measuredTop) / trajectory.measuredLength
 *
 * @remarks
 * Avoid using the calculated length of the curve for this purpose, as this may potentially be less precise/consistant.
 * The `getPointAtDepth` function in this interface is calculated as in the above example when created using the `getTrajectory` function.
 *
 * @see {@link getTrajectory}
 * @see {@link Curve3D}
 */
export interface Trajectory {
  // a unique id, typically wellbore id
  id: string | number;
  // the known measured length of the trajectory
  measuredLength: number;
  // the known measured depth (msl) at the top of the trajectory
  measuredTop: number;
  // the known measured depth (msl) at the termination point of the trajectory
  measuredBottom: number;
  // curve defining the trajectory for interpolation purposes
  curve: Curve3D;
  // get the point along the trajectory according to a MD msl value. Returns null if out of range.
  getPointAtDepth: (md: number, clamped?: boolean) => Vec3 | null;
  getPositionAtDepth: (md: number, clamped?: boolean) => number | null;
}

export type ProjectedTrajectory = {
  positions: Vec2[];
  length: number;
  top: number;
  bottom: number;
} | null;

/**
 * Creates an instance conforming to the `Trajectory` interface, given an id and a position log normalized to MSL depths.
 *
 * @see {@link Trajectory}
 */
export function getTrajectory(
  id: string,
  poslogMsl: PositionLog | null,
): Trajectory | null {
  if (!poslogMsl || poslogMsl.length < 2 * 4) return null;
  const [origEast, , origNorth] = poslogMsl;

  const points: Vec3[] = new Array(poslogMsl.length / 4);

  for (let i = 0, j = 0; i < points.length; i++, j += 4) {
    points[i] = [
      poslogMsl[j] - origEast,
      -poslogMsl[j + 1],
      origNorth - poslogMsl[j + 2],
    ];
  }

  const curve = getSplineCurve(points, false);

  if (!curve) return null;

  const top = poslogMsl[3];
  const bottom = poslogMsl[poslogMsl.length - 1];
  const length = bottom - top;

  const getPositionAtDepth = (md: number, clamped = false) => {
    let pos = (md - top) / length;
    if (clamped) {
      pos = clamp(pos, 0, 1);
    }
    if (pos < 0 || pos > 1) return null;

    return pos;
  };

  const trajectory: Trajectory = {
    id,
    curve,
    get measuredLength() {
      return length;
    },
    get measuredTop() {
      return top;
    },
    get measuredBottom() {
      return bottom;
    },
    getPositionAtDepth,
    getPointAtDepth: (md, clamped = false) => {
      // let pos = (md - top) / length
      // if (clamped) {
      //   pos = clamp(pos, 0, 1)
      // }
      // if (pos < 0 || pos > 1) return null
      const pos = getPositionAtDepth(md, clamped);
      return pos !== null ? curve.getPointAt(pos) : null;
    },
  };

  return trajectory;
}

/**
 * Simplifies a linear 2d curve by comparing direction changes to a threshold value.
 * @param array input array
 * @param accessor accessor to array coordinate element
 * @param threshold threshold value (default 1e-7)
 * @returns T[] array of same type as input array
 */
export function simplifyCurve2D<T>(
  array: Array<T>,
  accessor: (e: T) => Vec2 = (d: T) => d as Vec2,
  threshold: number = 1e-7,
) {
  if (array.length <= 2) return array;

  let prev = accessor(array[0]);

  let tangent: Vec2 = [0, 0];

  const simplifiedArray: Array<T> = [array[0]];

  for (let i = 1; i < array.length - 1; i++) {
    const curr = accessor(array[i]);
    const v = normalizeVec2(subVec2(curr, prev));

    if (Math.abs(dotVec2(tangent, v)) < 1 - threshold) {
      // keep
      simplifiedArray.push(array[i]);
      tangent = v;
      prev = curr;
    }
  }

  simplifiedArray.push(array[array.length - 1]);

  return simplifiedArray;
}

/**
 * Generate a equaly spaced trajectory along XZ plane from a linear 3d curve
 * where the distance between coordinates corresponds to stepSize.
 * @param path 3d curve
 * @param stepSize distance between corrdinates in output trajectory
 * @param extension optional extension of original path (extrapolation)
 * @param minSize a minimum size of the output. If less, points will be extrapolated in both ends
 * @param defaultExtensionAngle if there is not enough deviation in the input path to determine an extrapolation angle, this angle will be used (default: 0 radians)
 * @returns 2d curve along the XZ plane
 */
export function getProjectedTrajectory(
  path: Vec3[],
  stepSize: number,
  extension: number = 1000,
  minSize: number = 2000,
  defaultExtensionAngle: number = 0,
): ProjectedTrajectory {
  if (!path || path.length < 1) return null;

  const positions: Vec2[] = [];

  let length = 0;

  const first: Vec2 = [path[0][0], path[0][2]];

  let top = path[0][1];
  let bottom = top;

  let i = 1;

  positions.push(first);

  let previous: Vec2 = positions[positions.length - 1];

  while (i < path.length) {
    const current: Vec2 = [path[i][0], path[i][2]];

    if (path[i][1] > top) {
      top = path[i][1];
    }
    if (path[i][1] < bottom) {
      bottom = path[i][1];
    }

    const dist = distanceVec2(previous, current);

    if (dist < stepSize) {
      if (i === path.length - 1 && positions.length > 1) {
        length += dist;
        positions.push(current);
      }
      i++;
    } else {
      length += stepSize;
      if (dist > stepSize) {
        const direction = directionVec2(previous, current);
        const position: Vec2 = [
          previous[0] + direction[0] * stepSize,
          previous[1] + direction[1] * stepSize,
        ];
        positions.push(position);
        previous = position;
      } else {
        positions.push(current);
        previous = current;
        i++;
      }
    }
  }

  const positionsCount = positions.length;
  if (extension || length < minSize) {
    let extensionStart = 0;
    let extensionEnd = extension;

    if (length + extension / 2 < minSize) {
      // equally extend in both ends
      extensionStart = (minSize - length) / 2;
      extensionEnd = extensionStart;
    }

    let extensionDirection: Vec2 = [
      Math.cos(defaultExtensionAngle),
      Math.sin(defaultExtensionAngle),
    ];

    if (extensionEnd) {
      if (positionsCount > 1) {
        extensionDirection = directionVec2(
          positions[positions.length - 2],
          positions[positions.length - 1],
        );
      }
      const last: Vec2 = positions[positions.length - 1];
      const steps = Math.floor(extensionEnd / stepSize);
      const stepVector: Vec2 = [
        extensionDirection[0] * stepSize,
        extensionDirection[1] * stepSize,
      ];
      const extensionEndPoint: Vec2 = [
        last[0] + extensionDirection[0] * extensionEnd,
        last[1] + extensionDirection[1] * extensionEnd,
      ];

      let extensionPoint: Vec2 = last;
      for (let i = 0; i < steps; i++) {
        extensionPoint = addVec2(extensionPoint, stepVector);
        positions.push(extensionPoint);
      }

      const distanceRemaining = distanceVec2(extensionPoint, extensionEndPoint);
      if (distanceRemaining) {
        positions.push(extensionEndPoint);
      }
    }

    if (extensionStart) {
      let extensionDirectionStart: Vec2;
      if (positionsCount > 1) {
        extensionDirectionStart = directionVec2(positions[1], positions[0]);
      } else {
        extensionDirectionStart = [
          -Math.cos(defaultExtensionAngle),
          -Math.sin(defaultExtensionAngle),
        ];
      }

      // avoid having extensions pointing in similar directions
      if (
        length < 100 ||
        Math.abs(dotVec2(extensionDirection, extensionDirectionStart)) > 0.95
      ) {
        extensionDirectionStart = [
          -extensionDirection[0],
          -extensionDirection[1],
        ];
      }
      const steps = Math.floor(extensionStart / stepSize);
      const stepVector: Vec2 = [
        extensionDirectionStart[0] * stepSize,
        extensionDirectionStart[1] * stepSize,
      ];
      const extensionStartPoint: Vec2 = [
        first[0] + extensionDirectionStart[0] * extensionStart,
        first[1] + extensionDirectionStart[1] * extensionStart,
      ];

      let extensionPoint: Vec2 = first;
      for (let i = 0; i < steps; i++) {
        extensionPoint = addVec2(extensionPoint, stepVector);
        positions.unshift(extensionPoint);
      }

      const distanceRemaining = distanceVec2(
        extensionPoint,
        extensionStartPoint,
      );
      if (distanceRemaining) {
        positions.unshift(extensionStartPoint);
      }
    }
  }

  return {
    positions,
    top,
    bottom,
    length,
  };
}
