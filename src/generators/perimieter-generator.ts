import { transfer } from 'comlink'
import {
  PositionLog,
  ReadonlyStore,
  TubeGeometryOptions,
  createTubeGeometry,
  getTrajectory,
  packBufferGeometry
} from '../sdk'

export async function generatePerimeterGeometry(
  this: ReadonlyStore,
  id: string,
  radius: number,
  segmentsPerMeter: number = 0.1,
  simplificationThreshold: number = 0
) {
  const poslogMsl = await this.get<PositionLog>('position-logs', id)

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const tubeOptions: TubeGeometryOptions = {
    from: 0,
    to: 1,
    startCap: false,
    endCap: false,
    radialSegments: 32,
    computeLengths: true,
    computeUvs: true,
    segmentsPerMeter,
    simplificationThreshold,
    radius,
  }

  const geometry = createTubeGeometry(trajectory.curve, tubeOptions)
  const [packed, buffers] = packBufferGeometry(geometry)

  return transfer(packed, buffers)
}
