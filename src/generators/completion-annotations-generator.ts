import { clamp, getTrajectory, limit, PositionLog, ReadonlyStore } from '../sdk'

export async function generateCompletionToolAnnotations(
  this: ReadonlyStore,
  id: string
) {
  const data = await this.get<any[]>('completion-tools', id)

  if (!data) return null

  const poslogMsl = await limit(() =>
    this.get<PositionLog>('position-logs', id)
  )

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const completionToolAnnotations = data
    .filter((d) => d.mdBottomMsl > trajectory.measuredTop)
    .map((d) => {
      const pos = clamp(
        (d.mdTopMsl + d.length / 2 - trajectory.measuredTop) /
          trajectory.measuredLength,
        0,
        1
      )
      return {
        name: d.name,
        //data: d,
        position: trajectory.curve.getPointAt(pos),
        direction: trajectory.curve.getTangentAt(pos),
        priority: d.diameterMax,
      }
    })

  return completionToolAnnotations
}
