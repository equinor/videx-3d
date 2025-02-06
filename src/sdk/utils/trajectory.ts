import { PositionLog } from "../data/types/PositionLog";
import { Vec3 } from '../types/common'
import { getSplineCurve } from '../geometries/curve/curve-3d'
import { clamp } from './numbers'
import { Curve3D } from '../geometries/curve/curve-3d'

export interface Trajectory {
  id: string | number
  measuredLength: number
  measuredTop: number
  measuredBottom: number
  curve: Curve3D
  getPointAtDepth: (md: number, clamped?: boolean) => Vec3 | null
}

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

  const trajectory: Trajectory = {
    id,
    curve,
    get measuredLength() { return length },
    get measuredTop() { return top },
    get measuredBottom() { return bottom },
    getPointAtDepth: (md, clamped = false) => {
      let pos = (md - top) / length
      if (clamped) {
        pos = clamp(pos, 0, 1)
      }
      if (pos < 0 || pos > 1) return null
      
      return curve.getPointAt(pos)
    }
  }

  return trajectory;
}