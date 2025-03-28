import { PositionLog } from "../data/types/PositionLog"
import { Curve3D, getSplineCurve } from '../geometries/curve/curve-3d'
import { Vec3 } from '../types/common'
import { clamp } from './numbers'

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
  id: string | number
  // the known measured length of the trajectory
  measuredLength: number
  // the known measured depth (msl) at the top of the trajectory
  measuredTop: number
  // the known measured depth (msl) at the termination point of the trajectory
  measuredBottom: number
  // curve defining the trajectory for interpolation purposes
  curve: Curve3D
  // get the point along the trajectory according to a MD msl value. Returns null if out of range.
  getPointAtDepth: (md: number, clamped?: boolean) => Vec3 | null
  getPositionAtDepth: (md: number, clamped?: boolean) => number | null
}

/**
 * Creates an instance conforming to the `Trajectory` interface, given an id and a position log normalized to MSL depths.
 * 
 * @see {@link Trajectory}
 */
export function getTrajectory(id: string, poslogMsl: PositionLog | null) : Trajectory | null {
  if (!poslogMsl || poslogMsl.length < 2 * 4) return null;
  const [origEast, , origNorth] = poslogMsl;

  const points: Vec3[] = new Array(poslogMsl.length / 4)

  for (let i = 0, j = 0; i < points.length; i ++, j += 4) {
    points[i] = [
      poslogMsl[j] - origEast,
      -poslogMsl[j + 1],
      origNorth - poslogMsl[j + 2],
    ]
  }

  const curve = getSplineCurve(points, false)

  if (!curve) return null;
  
  const top = poslogMsl[3]
  const bottom = poslogMsl[poslogMsl.length - 1]
  const length = bottom - top

  const getPositionAtDepth = (md: number, clamped = false) => {
    let pos = (md - top) / length
    if (clamped) {
      pos = clamp(pos, 0, 1)
    }
    if (pos < 0 || pos > 1) return null
    
    return pos
  }

  const trajectory: Trajectory = {
    id,
    curve,
    get measuredLength() { return length },
    get measuredTop() { return top },
    get measuredBottom() { return bottom },
    getPositionAtDepth,
    getPointAtDepth: (md, clamped = false) => {
      // let pos = (md - top) / length
      // if (clamped) {
      //   pos = clamp(pos, 0, 1)
      // }
      // if (pos < 0 || pos > 1) return null
      const pos = getPositionAtDepth(md, clamped)
      return pos !== null ? curve.getPointAt(pos) : null
    }
  }

  return trajectory;
}