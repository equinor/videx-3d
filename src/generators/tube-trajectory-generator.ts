import { transfer } from 'comlink'
import {
  clamp,
  createTubeGeometry,
  getTrajectory,
  packBufferGeometry,
  PositionLog,
  ReadonlyStore,
  TubeGeometryOptions
} from '../sdk'

export async function generateTubeTrajectory(
  this: ReadonlyStore,
  id: string,
  segmentsPerMeter: number,
  simplificationThreshold: number = 0,
  fromMsl?: number,
  radius: number = 0.5,
  radialSegments: number = 16,
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

  const options: TubeGeometryOptions = {
    from,
    radius,
    startCap: true,
    endCap: true,
    segmentsPerMeter,
    simplificationThreshold,
    computeNormals: true,
    computeUvs: true,
    computeLengths: !!includeLengths,
    radialSegments,
  }
  const geometery = createTubeGeometry(trajectory.curve, options)

  const [geometry, transferrables] = packBufferGeometry(geometery)

  return transfer(geometry, transferrables)
}
