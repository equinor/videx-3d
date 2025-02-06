import { transfer } from 'comlink'
import { Matrix4, Vector3 } from 'three'
import {
  clamp,
  getTrajectory,
  limit,
  PI2,
  PositionLog,
  ReadonlyStore,
  SymbolData,
  SymbolsType,
} from '../sdk'

const positionVector = new Vector3()
const targetVector = new Vector3()
const scaleVector = new Vector3()
const upVector = new Vector3(0, 1, 0)
const transformationMatrix = new Matrix4()
const rotationMatrix = new Matrix4().makeRotationX(PI2)

export async function generatePositionMarkers(
  this: ReadonlyStore,
  id: string,
  radius: number,
  interval: number,
  fromMsl?: number
): Promise<SymbolsType | null> {
  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', id)
  )

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const lastTick = trajectory.measuredBottom
  const wellboreLength = trajectory.measuredLength
  const start = Math.max(
    trajectory.measuredTop,
    fromMsl && Number.isFinite(fromMsl) ? fromMsl : trajectory.measuredTop
  )
  const firstTick = start
  const ticks: number[] = [firstTick]

  let next = Math.floor(firstTick / interval) * interval

  if (next <= firstTick) {
    next += interval
  }

  while (next < lastTick) {
    ticks.push(next)
    next += interval
  }

  ticks.push(lastTick)

  const transformations = new Float32Array(ticks.length * 16 * 3)
  const markerData: SymbolData[] = []

  ticks.forEach((tick, i) => {
    const pos = clamp((tick - trajectory.measuredTop) / wellboreLength, 0, 1)
    const position = trajectory.curve.getPointAt(pos)
    const direction = trajectory.curve.getTangentAt(pos)

    positionVector.set(...position)
    transformationMatrix.identity()
    const scale = radius + 2 / radius
    scaleVector.set(scale, scale, scale)

    targetVector.set(
      positionVector.x + direction[0],
      positionVector.y + direction[1],
      positionVector.z + direction[2]
    )

    transformationMatrix.lookAt(positionVector, targetVector, upVector)
    transformationMatrix.multiply(rotationMatrix)
    transformationMatrix.setPosition(positionVector)

    transformationMatrix.scale(scaleVector)
    transformationMatrix.toArray(transformations, i * 16)

    markerData[i] = {
      id: `${id}_${i}`,
      depth: tick,
      position,
    }
  })

  return transfer(
    {
      data: markerData,
      transformations,
    },
    [transformations.buffer]
  )
}
