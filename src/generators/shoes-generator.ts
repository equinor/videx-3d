import { transfer } from 'comlink'
import { Matrix4, Vector3 } from 'three'
import {
  CasingItem,
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

export async function generateShoes(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  sizeMultiplier?: number
): Promise<SymbolsType | null> {
  const data = await limit(() => this.get<CasingItem[]>('casings', id))

  if (!data) return null

  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', id)
  )

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const shoes = data
    .filter(
      (d) =>
        d.type === 'Shoe' &&
        d.mdBottomMsl > trajectory.measuredTop &&
        (fromMsl === undefined || d.mdBottomMsl > fromMsl)
    )
    .map((d) => {
      const pos = clamp(
        (d.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength,
        0,
        1
      )
      return {
        name: `${d.properties['Diameter']} ${d.properties['Type']}`,
        data: d.properties,
        position: trajectory.curve.getPointAt(pos),
        direction: trajectory.curve.getTangentAt(pos),
        radius: d.outerDiameter / 2,
      }
    })

  const transformations = new Float32Array(shoes.length * 16 * 3)
  const symbolData: SymbolData[] = []

  shoes.forEach((shoe, i) => {
    positionVector.set(...shoe.position)
    transformationMatrix.identity()
    const radius = shoe.radius * (sizeMultiplier || 1)
    scaleVector.set(radius, radius, radius)

    targetVector.set(
      positionVector.x + shoe.direction[0],
      positionVector.y + shoe.direction[1],
      positionVector.z + shoe.direction[2]
    )

    transformationMatrix.lookAt(positionVector, targetVector, upVector)
    transformationMatrix.multiply(rotationMatrix)
    transformationMatrix.setPosition(positionVector)

    transformationMatrix.scale(scaleVector)
    transformationMatrix.toArray(transformations, i * 16)

    symbolData[i] = {
      id: `${id}_${i}`,
      name: shoe.name,
      direction: shoe.direction,
    }
  })

  return transfer(
    {
      data: symbolData,
      transformations,
    },
    [transformations.buffer]
  )
}
