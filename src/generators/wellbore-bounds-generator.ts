import { transfer } from 'comlink'
import {
  WellboreBoundingSphere,
  WellboreBoundsType,
} from '../components/Wellbores/WellboreBounds'
import {
  clamp,
  getTrajectory,
  lengthVec3,
  limit,
  PositionLog,
  ReadonlyStore,
  Vec3,
} from '../sdk'

export async function calculateWellboreBounds(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  sampleSize: number = 250
) {
  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', id)
  )

  const bounds: WellboreBoundsType = {
    main: {
      center: [0, 0, 0],
      radius: 10,
    },
    sampled: [],
  }

  if (poslogMsl) {
    const trajectory = getTrajectory(id, poslogMsl)
    if (trajectory) {
      const from =
        fromMsl !== undefined
          ? clamp(
              (fromMsl - trajectory.measuredTop) / trajectory.measuredLength,
              0,
              1
            )
          : 0

      // calculate main bounding sphere

      const boundingBox = trajectory.curve.getBoundingBox(from)

      const hWidth = (boundingBox.max[0] - boundingBox.min[0]) / 2
      const hHeight = (boundingBox.max[1] - boundingBox.min[1]) / 2
      const hDepth = (boundingBox.max[2]! - boundingBox.min[2]!) / 2

      const radius = lengthVec3([hWidth, hHeight, hDepth!]) + sampleSize * 2 // add a little padding
      const center: Vec3 = [
        boundingBox.min[0] + hWidth,
        boundingBox.min[1] + hHeight,
        boundingBox.min[2]! + hDepth,
      ]

      bounds.main.center = center
      bounds.main.radius = radius

      if (sampleSize > 0) {
        // create samples along trajectory
        const nSamples = Math.ceil(
          ((1 - from) * trajectory.curve.length) / sampleSize
        )
        const sampledPoints = trajectory.curve.getPoints(nSamples, from, 1)
        const samples: WellboreBoundingSphere[] = []

        sampledPoints.forEach((point) => {
          samples.push({
            center: point,
            radius: sampleSize,
          })
        })

        bounds.sampled = samples
      }
    }
  }

  const data = new Float32Array(4 + bounds.sampled.length * 4)

  // convert to typed array for faster transfer
  let i = 0
  data[i] = bounds.main.center[0]
  data[i + 1] = bounds.main.center[1]
  data[i + 2] = bounds.main.center[2]
  data[i + 3] = bounds.main.radius

  i = 4
  for (let s = 0; s < bounds.sampled.length; s++, i += 4) {
    data[i] = bounds.sampled[s].center[0]
    data[i + 1] = bounds.sampled[s].center[1]
    data[i + 2] = bounds.sampled[s].center[2]
    data[i + 3] = bounds.sampled[s].radius
  }

  return transfer(data, [data.buffer])
}
