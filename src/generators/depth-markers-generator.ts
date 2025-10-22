import { AnnotationProps } from '../components/Annotations'
import {
  clamp,
  DepthReferencePoint,
  getTrajectory,
  PositionLog,
  ReadonlyStore,
  Vec3,
  WellboreHeader
} from '../sdk'

export async function generateDepthMarkers(
  this: ReadonlyStore,
  id: string,
  interval: number,
  depthReferencePoint: DepthReferencePoint = 'MSL',
  fromMsl?: number
): Promise<AnnotationProps[] | null> {
  const poslogMsl = await this.get<PositionLog>('position-logs', id
  )

  if (!poslogMsl || poslogMsl.length < 8) return null

  let offset = 0
  if (depthReferencePoint === 'RT') {
    const header = await this.get<WellboreHeader>('wellbore-headers', id)
    if (header) {
      offset = header.depthReferenceElevation
    }
  }
  const trajectory = getTrajectory(id, poslogMsl)

  if (!trajectory) return null

  const lastTick = poslogMsl[poslogMsl.length - 1] + offset
  const start = Math.max(
    trajectory.measuredTop,
    fromMsl && Number.isFinite(fromMsl) ? fromMsl : trajectory.measuredTop
  )
  const firstTick = start + offset
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

  const annotations: AnnotationProps[] = ticks.map((tick) => {
    const pos = clamp(
      (tick - offset - trajectory.measuredTop) / trajectory.measuredLength,
      0,
      1
    )
    const position = trajectory.curve.getPointAt(pos) as Vec3
    const direction = trajectory.curve.getTangentAt(pos) as Vec3

    return {
      id: `${id}_${tick}`,
      name: (Math.round(tick * 10) / 10).toString(),
      direction,
      position,
    }
  })

  return annotations
}
