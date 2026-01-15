import { transfer } from 'comlink'
import { Matrix4, Vector3 } from 'three'
import {
  calculateFrenetFrames,
  clamp,
  crossVec3,
  degreesToRadians,
  feetToMeters,
  getTrajectory,
  PerforationInterval,
  PI2,
  PositionLog,
  ReadonlyStore,
  rotateVec3,
  SymbolData,
  SymbolsType,
  Vec3,
} from '../sdk'

//const perforationsPerMeter = 0.5
//const perforationDirections = 9
//const rotationAngle = TAU / perforationDirections

const positionVector = new Vector3()
const targetVector = new Vector3()
const scaleVector = new Vector3()
const upVector = new Vector3(0, 1, 0)
const transformationMatrix = new Matrix4()
const rotationMatrix = new Matrix4().makeRotationX(PI2)

export async function generatePerforations(
  this: ReadonlyStore,
  id: string,
  fromMsl?: number,
  sizeMultiplier: number = 1
): Promise<SymbolsType | null> {
  const perforationData = await this.get<PerforationInterval[]>(
    'perforations',
    id
  )

  if (!perforationData) return null

  const poslogMsl = await this.get<PositionLog>('position-logs', id)

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  scaleVector.set(
    Math.max(1, sizeMultiplier / 2),
    sizeMultiplier,
    Math.max(1, sizeMultiplier / 2)
  )

  const perforationSections: {
    type: string
    top: number
    bottom: number
    density: number
    phase: number
    innerDiameter: number
    outerDiameter: number
  }[] = []
  const filteredData = perforationData
    .filter(
      (d) =>
        d.status === 'Open' &&
        d.mdBottomMsl > trajectory.measuredTop &&
        (fromMsl === undefined || d.mdBottomMsl > fromMsl)
    )
    .sort((a, b) => a.mdTopMsl - b.mdTopMsl)

  for (let i = 0; i < filteredData.length; i++) {
    const current = filteredData[i]
    if (current.mdBottomMsl <= trajectory.measuredTop) continue

    if (
      !perforationSections.length ||
      perforationSections[perforationSections.length - 1].bottom !==
        current.mdTopMsl
    ) {
      perforationSections.push({
        type: current.type,
        top: Math.max(trajectory.measuredTop, current.mdTopMsl),
        bottom: current.mdBottomMsl,
        density: feetToMeters(current.density || 0),
        phase: current.phase || 0,
        innerDiameter: 0,
        outerDiameter: 0,
      })
    } else if (perforationSections.length) {
      perforationSections[perforationSections.length - 1].bottom =
        current.mdBottomMsl
    }
  }

  const perforations: {
    name: string
    position: Vec3
    normal: Vec3
    tangent: Vec3
  }[] = []
  for (let i = 0; i < perforationSections.length; i++) {
    const current = perforationSections[i]

    const segmentLength = current.bottom - current.top
    const positionCount = Math.max(
      1,
      Math.floor(segmentLength * current.density)
    )
    const u1 = clamp(
      (current.top - trajectory.measuredTop) / trajectory.measuredLength,
      0,
      1
    )
    const u2 = clamp(
      (current.bottom - trajectory.measuredTop) / trajectory.measuredLength,
      0,
      1
    )
    const step = (u2 - u1) / positionCount
    const positions = []
    for (let k = 0; k < positionCount; k++) {
      positions.push(u1 + step * k)
    }
    const frames = calculateFrenetFrames(trajectory.curve, positions)
    let angle = PI2
    for (let f = 0; f < frames.length; f++) {
      const frame = frames[f]
      const normal = rotateVec3(
        crossVec3(frame.tangent, [0, -1, 0]),
        frame.tangent,
        angle
      ) as Vec3

      perforations.push({
        name: current.type,
        position: frame.position,
        normal,
        tangent: frame.tangent,
      })
      angle += degreesToRadians(current.phase)
    }
  }
  const transformations = new Float32Array(perforations.length * 16)
  const symbolData: SymbolData[] = []

  for (let i = 0; i < perforations.length; i++) {
    const perf = perforations[i]
    positionVector.set(...perf.position)
    targetVector.set(
      positionVector.x + perf.normal[0],
      positionVector.y + perf.normal[1],
      positionVector.z + perf.normal[2]
    )

    scaleVector.setY(
      sizeMultiplier + sizeMultiplier * (Math.random() - 0.5) * 0.25
    )

    transformationMatrix.identity()
    transformationMatrix.lookAt(positionVector, targetVector, upVector)
    transformationMatrix.multiply(rotationMatrix)
    transformationMatrix.setPosition(positionVector)
    transformationMatrix.scale(scaleVector)
    transformationMatrix.toArray(transformations, i * 16)
    symbolData[i] = {
      id: `${id}_${i}`,
      name: perf.name,
      direction: perf.tangent,
    }
  }

  return transfer(
    {
      data: symbolData,
      transformations,
    },
    [transformations.buffer]
  )
}
