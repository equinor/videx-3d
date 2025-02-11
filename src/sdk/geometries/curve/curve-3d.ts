import { CurveInterpolator, EPS } from 'curve-interpolator'
import { Vec3 } from '../../types/common'
import { clamp } from '../../utils/numbers'
import { copyVec3, crossVec3, dotVec3, lengthVec3, normalizeVec3, rotateVec3 } from '../../utils/vector-operations'

/**
 * Interface for interpolating points on a 3d curve
 */
export interface Curve3D {
  getPointAt: (pos: number) => Vec3
  getPoints: (nSamples: number, from?: number, to?: number) => Vec3[]
  getTangentAt: (pos: number) => Vec3
  getNormalAt: (pos: number) => Vec3
  getBoundingBox: (from?: number, to?: number) => {
    min: Vec3,
    max: Vec3,
  }
  nearest: (point: Vec3) => {
    position: number,
    point: Vec3,
    distance: number,
  }
  length: number,
  closed: boolean,
}

/**
 * Returns an implementation of `SplineCurve` using `CurveInterpolator`
 **/  
export function getSplineCurve(points: Vec3[], closed = false) : Curve3D | null {
  const interpolationOptions = {
    alpha: 1,
    tension: 0,
    closed,
  }  

  const interpolator = new CurveInterpolator(points, interpolationOptions)
  
  const splineCurve: Curve3D = {
    getPointAt: pos => interpolator.getPointAt(pos) as Vec3,
    getPoints: (nSamples, from = 0, to = 1) => {
      return interpolator.getPoints(nSamples, null, from, to) as Vec3[]
    },
    getTangentAt: pos => interpolator.getTangentAt(pos) as Vec3,
    getNormalAt: pos => interpolator.getNormalAt(pos) as Vec3,
    getBoundingBox: (from = 0, to = 1) => {
      const bbox = interpolator.getBoundingBox(from, to)
      return {
        min: bbox.min as Vec3,
        max: bbox.max as Vec3,
      }
    },
    nearest: point => {
      const result = interpolator.getNearestPosition(point)
      return {
        position: result.u,
        point: result.point as Vec3,
        distance: result.distance,
      }
    },
    get length() { return interpolator.length },
    closed,
  }

  return splineCurve
}

// Caclulated values of Frenet frames 
export type FrenetFrame = {
  curvePosition: number,
  position: Vec3,
  tangent: Vec3,
  normal: Vec3,
  binormal: Vec3,
}

/**
 * Calculate a stable and balanced set of Frenet Frames for a curve at the
 * specified positions.
 */
export function calculateFrenetFrames(curve: Curve3D, curvePositions: number[]) {
  const count = curvePositions.length
  const frames = new Array<FrenetFrame>(count)
  if (!frames.length) return [] 
  curvePositions.forEach((u, i) => {
    frames[i] = {
      curvePosition: u,
      position: curve.getPointAt(u) as Vec3,
      tangent: curve.getTangentAt(u) as Vec3,
      normal: [0, 0, 0],
      binormal: [0, 0, 0]
    }
  })

  let normal: Vec3 = [0, 1, 0]
  let min = Math.abs(frames[0].tangent[1])

  const tx = Math.abs(frames[0].tangent[0])
  const tz = Math.abs(frames[0].tangent[2])

  if (tx <= min) {
    min = tx
    normal = [1, 0, 0]
  }

  if (tz <= min) {
    normal = [0, 0, 1]
  }
  
  let vec = normalizeVec3(crossVec3(frames[0].tangent, normal))
  
  frames[0].normal = crossVec3(frames[0].tangent, vec) as Vec3
  frames[0].binormal = crossVec3(frames[0].tangent, frames[0].normal) as Vec3

  for (let i = 1; i < curvePositions.length; i++) {
    vec = crossVec3(frames[i - 1].tangent, frames[i].tangent)
    frames[i].normal = copyVec3(frames[i - 1].normal)
    if (lengthVec3(vec) > EPS) {
      normalizeVec3(vec)
      const theta = Math.acos(clamp(dotVec3(frames[i - 1].tangent, frames[i].tangent), -1, 1)) // clamp for floating pt errors
      frames[i].normal = rotateVec3(frames[i - 1].normal, vec, theta)
    }
    frames[i].binormal = crossVec3(frames[i].tangent, frames[i].normal) as Vec3
  }

  return frames
}