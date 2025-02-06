import { transfer } from 'comlink'
import { Color, Matrix4, Vector3 } from 'three'
import {
  clamp,
  getTrajectory,
  limit,
  PI2,
  Pick,
  PositionLog,
  ReadonlyStore,
  SymbolData,
  SymbolsType,
  Vec3,
} from '../sdk'

const positionVector = new Vector3()
const targetVector = new Vector3()
const scaleVector = new Vector3()
const upVector = new Vector3(0, 1, 0)
const transformationMatrix = new Matrix4()
const rotationMatrix = new Matrix4().makeRotationX(PI2)
const color = new Color()

export async function generatePicks(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  baseRadius: number = 10
): Promise<SymbolsType | null> {
  const data = await limit(() => this.get<Pick[]>('picks', id))

  if (!data) return null

  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', id)
  )

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const filteredPicks = data.filter(
    (d) =>
      d.name.endsWith('Top') &&
      (fromMsl === undefined || d.mdMsl >= fromMsl) &&
      d.mdMsl <= trajectory.measuredBottom
  )

  if (!filteredPicks.length) return null

  const mappedPicks = filteredPicks.map((d) => {
    const pos = clamp(
      (d.mdMsl - trajectory.measuredTop) / trajectory.measuredLength,
      0,
      1
    )
    return {
      ...d,
      position: trajectory.curve.getPointAt(pos) as Vec3,
      direction: trajectory.curve.getTangentAt(pos) as Vec3,
    }
  })
  mappedPicks.sort((a, b) => a.mdMsl - b.mdMsl || b.level - a.level)

  const cleanedPicks: typeof mappedPicks = []

  let currentDepth = -Infinity
  mappedPicks.forEach((p) => {
    if (p.mdMsl > currentDepth) {
      cleanedPicks.push(p)
      currentDepth = p.mdMsl
    }
  })

  const transformations = new Float32Array(cleanedPicks.length * 16 * 3)
  const colors = new Float32Array(cleanedPicks.length * 3 * 3)
  const symbolData: SymbolData[] = []

  cleanedPicks.forEach((pick, i) => {
    positionVector.set(...pick.position)
    transformationMatrix.identity()
    const radius = baseRadius
    scaleVector.set(radius, radius, radius)

    targetVector.set(
      positionVector.x + pick.direction[0],
      positionVector.y + pick.direction[1],
      positionVector.z + pick.direction[2]
    )

    transformationMatrix.lookAt(positionVector, targetVector, upVector)
    transformationMatrix.multiply(rotationMatrix)
    transformationMatrix.setPosition(positionVector)

    transformationMatrix.scale(scaleVector)
    transformationMatrix.toArray(transformations, i * 16)

    color.set(pick.color)
    color.toArray(colors, i * 3)

    symbolData[i] = {
      id: `${id}_${i}`,
      name: pick.name,
      depth: pick.mdMsl,
      tvd: pick.tvdMsl,
      level: pick.level,
      direction: pick.direction,
    }
  })

  return transfer(
    {
      data: symbolData,
      transformations,
      colors,
    },
    [transformations.buffer]
  )
}
