import {
  clamp,
  getTrajectory,
  PositionLog,
  ReadonlyStore,
  WellboreHeader
} from '../sdk'

export async function generateWellboreLabel(
  this: ReadonlyStore,
  id: string,
  position: 'top' | 'center' | 'bottom',
  fromMsl?: number
) {
  const header = await this.get<WellboreHeader>('wellbore-headers', id)

  if (!header) return null

  const poslogMsl = await this.get<PositionLog>('position-logs', id)

  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  let pos = 1

  const { measuredTop, measuredLength, curve } = trajectory

  if (position === 'top') {
    pos = clamp(((fromMsl || measuredTop) - measuredTop) / measuredLength, 0, 1)
  } else if (position === 'center') {
    const centerMsl =
      (fromMsl || measuredTop) + (measuredLength - (fromMsl || measuredTop)) / 2
    pos = clamp((centerMsl - measuredTop) / measuredLength, 0, 1)
  }
  const wellboreAnnotation = {
    id: id,
    name: `${header.name.replace('NO ', '')}`,
    position: curve.getPointAt(pos),
    direction: curve.getTangentAt(pos),
  }

  return [wellboreAnnotation]
}
