import { transfer } from 'comlink'
import {
  BufferAttributeLike,
  clamp,
  getCurvePositions,
  getTrajectory,
  packBufferGeometryLike,
  PositionLog,
  ReadonlyStore
} from '../sdk'

export async function generateBasicTrajectory(
  this: ReadonlyStore,
  id: string,
  segmentsPerMeter: number,
  simplificationThreshold: number = 0,
  fromMsl?: number,
  includeLengths: boolean = false
) {
  const poslogMsl = await this.get<PositionLog>('position-logs', id)

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

  const curvePositions = getCurvePositions(
    trajectory.curve,
    from,
    1,
    segmentsPerMeter,
    simplificationThreshold
  )
  const positions = new Float32Array(curvePositions.length * 3)
  const lengths = includeLengths ? new Float32Array(curvePositions.length) : null

  curvePositions.forEach((u, i) => {
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
