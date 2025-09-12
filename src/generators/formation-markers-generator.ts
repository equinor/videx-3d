import { transfer } from 'comlink'
import { clamp } from 'curve-interpolator'
import { Color, Matrix4, Vector3 } from 'three'
import {
  getTrajectory,
  limit,
  PI2,
  PositionLog,
  ReadonlyStore,
  SymbolData,
  SymbolsType,
  titleCase,
  Vec3
} from '../sdk'
import { getFormationMarkers, getWellboreFormations } from '../sdk/data/helpers/formations-helpers'

const positionVector = new Vector3()
const targetVector = new Vector3()
const scaleVector = new Vector3()
const upVector = new Vector3(0, 1, 0)
const transformationMatrix = new Matrix4()
const rotationMatrix = new Matrix4().makeRotationX(PI2)
const color = new Color()

export async function generateFormationMarkers(
  this: ReadonlyStore,
  wellboreId: string,
  stratColumnId: string,
  fromMsl?: number,
  baseRadius: number = 10
): Promise<SymbolsType | null> {
 
  const surfaceIntervals = await getWellboreFormations(wellboreId, stratColumnId, this, fromMsl)

  if (!surfaceIntervals) return null

  const formationMarkers = getFormationMarkers(surfaceIntervals)

  if (!formationMarkers.length) return null

  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', wellboreId)
  )
 
  
  const trajectory = getTrajectory(wellboreId, poslogMsl)

  if (!trajectory) return null

  const mappedFormationMarkers = formationMarkers.map((d) => {
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

  const transformations = new Float32Array(mappedFormationMarkers.length * 16 * 3)
  const colors = new Float32Array(mappedFormationMarkers.length * 3 * 3)
  const symbolData: SymbolData[] = []

  mappedFormationMarkers.forEach((pick, i) => {
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
      id: `${wellboreId}_${i}`,
      name: `${pick.name} ${titleCase(pick.type)}`,
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
