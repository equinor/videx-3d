import {
  CasingItem,
  clamp,
  getTrajectory,
  PositionLog,
  ReadonlyStore
} from '../sdk'

export async function generateCasingAnnotations(
  this: ReadonlyStore,
  id: string
) {
  const data = await this.get<CasingItem[]>('casings', id)

  if (!data) return null

  const poslogMsl = await this.get<PositionLog>('position-logs', id)

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const casingAnnotations = data
    .filter((d) => d.mdBottomMsl > trajectory.measuredTop)
    .map((d) => {
      const pos = clamp(
        (d.mdTopMsl +
          (d.mdBottomMsl - d.mdTopMsl) / 2 -
          trajectory.measuredTop) /
          trajectory.measuredLength,
        0,
        1
      )
      return {
        name: `${d.properties['Diameter']} ${d.properties['Type']}`,
        data: d.properties,
        position: trajectory.curve.getPointAt(pos),
        direction: trajectory.curve.getTangentAt(pos),
        priority: d.type === 'Shoe' ? 50 : d.innerDiameter,
      }
    })

  return casingAnnotations
}
