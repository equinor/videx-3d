import { useEffect, useMemo, useState } from 'react'
import { useData } from '../../../../hooks/useData'
import { PositionLog } from '../../../../sdk/data/types/PositionLog'
import { useWellMapState } from '../well-map-context'
import { getTrajectory, Trajectory } from '../../../../sdk/utils/trajectory'

/**
 * WellMapTvd props
 * @expand
 */
export type WellMapTvdProps = {
  color?: string
}

/**
 * TVD depth display addon for `WellMap`
 * @group Components
 * 
 * @see {@link WellMap}
 */
export const WellMapTvd = ({ color = 'rgb(113, 216, 253)' }: WellMapTvdProps) => {

  const store = useData()

  const [trajectories, setTrajectories] = useState<Record<string, Trajectory | null> | null>(null)
  const wellMapState = useWellMapState()
  const wellboreIds = wellMapState(state => state.tracksOrder)
  const depth = wellMapState(state => state.depth)
  const ratio = wellMapState(state => state.measures.ratio)
  const trackWidth = wellMapState(state => state.measures.trackWidth)
  const svgHeight = wellMapState(state => state.measures.svgHeight)
  const getSlotPosition = wellMapState(state => state.measures.getSlotPosition)
  
  useEffect(() => {
    if (store) {
      const dataPromises = wellboreIds.map(id => store.get<PositionLog>('position-logs', id))
      Promise.all(dataPromises).then(response => {
        const data = response.reduce((acc, d, i) => ({
          ...acc,
          [wellboreIds[i]]: getTrajectory(wellboreIds[i], d),
        }), {})
        setTrajectories(data)
      })
    }
  }, [wellboreIds, store])

  const tvds = useMemo(() => {
    const tvds: [number, number|null][] = []
    if (trajectories) {
      wellboreIds.forEach((id, slot) => {
        const position = getSlotPosition(slot)
        const tvd: [number, number|null] = [position, null]
        if (depth !== undefined && trajectories[id]) {
          const p = trajectories[id].getPointAtDepth(depth, false)
          if (p) {
            const tvdMsl = -p[1]
            tvd[1] = tvdMsl
          }
        }
        tvds.push(tvd)
      })
    }
    return tvds
  }, [depth, getSlotPosition, wellboreIds, trajectories])

  const y = useMemo(() => svgHeight - ratio * 15, [ratio, svgHeight])

  if (!tvds || trackWidth < 50) return null

  return <g>
    <text
      style={{ fontSize: '12px' }}
      fill={color}
      fillOpacity={0.75}
      x={-30}
      y={y}
      textAnchor='left'
      alignmentBaseline={'after-edge'}
    >
      TVD:
    </text>
    <text
      style={{ fontSize: '10px' }}
      fill={color}
      fillOpacity={0.5}
      x={-30}
      y={y + 10}
      textAnchor='left'
      alignmentBaseline={'after-edge'}
    >
      (Msl)
    </text>
    {tvds.map(tvd => (
        <text
          key={tvd.toString()}
          style={{ fontSize: '12px' }}
          fill={color}
          fillOpacity={tvd[1] === null ? 0.5 : 1}
          alignmentBaseline={'after-edge'}
          textAnchor='middle'
          x={tvd[0]}
          y={y}
        >
          {tvd[1] !== null && tvd[1].toFixed(1) + 'm' || '---'}
        </text>
      )
    )}
  </g>
}