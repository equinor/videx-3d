import { transfer } from 'comlink'
import {
  BufferAttributeLike,
  clamp,
  Curve3D,
  dotVec3,
  getTrajectory,
  limit,
  packBufferGeometryLike,
  PositionLog,
  ReadonlyStore,
} from '../sdk'

function calculateSegments(
  curve: Curve3D,
  startPos: number,
  endPos: number,
  segmentsPerMeter: number,
  simplificationThreshold: number
) {
  const segments: number[] = []
  const curveLength = curve.length

  const deltaPos = endPos - startPos
  const segmentLength = deltaPos * curveLength

  const nSegments = Math.ceil(segmentsPerMeter * segmentLength)
  const stepSize = deltaPos / nSegments

  const MIN_SEGMENT_LENGTH = 1 / (curveLength * 0.01)

  if (simplificationThreshold) {
    simplificationThreshold *= 0.1
  }

  // add first segment of step
  segments.push(startPos)
  let guideTangent = simplificationThreshold
    ? curve.getTangentAt(startPos)
    : null
  let lastPosition = startPos
  // interpolate in-between segments
  for (let j = 1; j < nSegments; j++) {
    const curvePosition = startPos + j * stepSize
    const currentSegmentLength = curvePosition - lastPosition
    const candidateTangent = simplificationThreshold
      ? curve.getTangentAt(curvePosition)
      : null
    if (
      currentSegmentLength >= MIN_SEGMENT_LENGTH ||
      !simplificationThreshold ||
      Math.abs(dotVec3(guideTangent!, candidateTangent!)) <
        1 - simplificationThreshold
    ) {
      segments.push(curvePosition)
      guideTangent = candidateTangent
      lastPosition = curvePosition
    }
  }

  segments.push(endPos)

  return segments
}

export async function generateBasicTrajectory(
  this: ReadonlyStore,
  id: string,
  segmentsPerMeter: number,
  simplificationThreshold: number = 0,
  fromMsl?: number,
  includeLengths: boolean = false
) {
  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', id)
  )

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const from =
    fromMsl !== undefined
      ? clamp(
          (fromMsl - trajectory.measuredTop) / trajectory.measuredLength,
          0,
          1
        )
      : 0

  const segments = calculateSegments(
    trajectory.curve,
    from,
    1,
    segmentsPerMeter,
    simplificationThreshold
  )
  const positions = new Float32Array(segments.length * 3)
  const lengths = includeLengths ? new Float32Array(segments.length) : null

  segments.forEach((u, i) => {
    const pos = trajectory.curve.getPointAt(u)
    positions[i * 3] = pos[0]
    positions[i * 3 + 1] = pos[1]
    positions[i * 3 + 2] = pos[2]
    if (lengths) {
      lengths[i] = u
    }
  })

  const attributes: Record<string, BufferAttributeLike> = {
    position: {
      array: positions,
      itemSize: 3,
    },
  }

  if (lengths) {
    attributes.lengths = {
      array: lengths,
      itemSize: 1,
    }
  }

  const [geometry, transferrables] = packBufferGeometryLike({ attributes })

  return transfer(geometry, transferrables)
}
