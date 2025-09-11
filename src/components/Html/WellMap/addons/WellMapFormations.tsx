import { scaleLinear } from 'd3-scale'
import { nanoid } from 'nanoid'
import { useEffect, useMemo, useState } from 'react'
import { useData } from '../../../../hooks/useData'
import { MergedFormationInterval } from '../../../../sdk'
import { getWellboreFormations, mergeFormationIntervals } from '../../../../sdk/data/helpers/formations-helpers'
import { useWellMapState } from '../well-map-context'

type Interval = {
  id: string,
  formation: string,
  color: string,
  level: number,
  x: number,
  y1: number,
  y2: number,
}

/**
 * WellMapFormations props
 * @expand
 */
export type WellMapFormationsProps = {
  stratColumnId: string
}

/**
 * Formations addon for `WellMap`
 * @group Components
 * 
 * @see {@link WellMap}
 */
export const WellMapFormations = ({ stratColumnId }: WellMapFormationsProps) => {

  const store = useData()

  const [formationsData, setFormationsData] = useState<Record<string, MergedFormationInterval[]> | null>(null)

  const wellMapState = useWellMapState()
  const wellboreIds = wellMapState(state => state.wellboreIds)
  const domain = wellMapState(state => state.domain)
  const range = wellMapState(state => state.measures.range)
  const ratio = wellMapState(state => state.measures.ratio)
  const slotsById = wellMapState(state => state.slotsById)
  const styles = wellMapState(state => state.styles)
  const getSlotPosition = wellMapState(state => state.measures.getSlotPosition)

  const depthScale = useMemo(() => scaleLinear().domain(domain).range(range), [domain, range])

  useEffect(() => {
    if (store) {
      const formationsDataPromises = wellboreIds.map(id => getWellboreFormations(id, stratColumnId, store))

      Promise.all(formationsDataPromises).then(response => {
        if (response) {
          const data = response.reduce((acc, d, i) => {
            let intervals: MergedFormationInterval[] = []
            if (d) {
              intervals = mergeFormationIntervals(d)
            }
            return {
              ...acc,
              [wellboreIds[i]]: intervals,
            }
          }, {})
          setFormationsData(data)
        }
      })
    }
  }, [wellboreIds, stratColumnId, store])

  const intervals = useMemo(() => {
    const output: Interval[] = []

    if (formationsData) {
      wellboreIds.forEach((id) => {
        if (formationsData[id]) {
          const slot = slotsById[id]
          const position = getSlotPosition(slot)
          formationsData[id].forEach(fi => {
            const interval: Interval = {
              id: nanoid(),
              formation: fi.name,
              color: fi.color,
              level: fi.level,
              x: position,
              y1: depthScale(fi.mdMslFrom),
              y2: depthScale(fi.mdMslTo),
            }

            output.push(interval)
          })
        }
      })
    }
    return output
  }, [formationsData, depthScale, getSlotPosition, slotsById, wellboreIds])

  const filterColor = useMemo(() => {
    const v = styles.darkMode ? 0 : 240
    return `rgba(${v}, ${v}, ${v}, .9)`
  }, [styles.darkMode])

  if (!intervals) return null

  return <g>
    {intervals.map(interval => {
      const width = (ratio * 30)
      return (
        <g
          key={interval.id}
          style={{
            cursor: 'help',
            filter: `drop-shadow( 1px 1px 2px ${filterColor})`,
            // @ts-expect-error bounding-box is valid on svg elements
            pointerEvents: 'bounding-box',
          }}>
          <title>{interval.formation}</title>
          <rect
            x={interval.x - (width / 2)}
            y={interval.y1}
            width={width}
            rx={width * 0.05}
            ry={width * 0.05}
            height={Math.max(1, interval.y2 - interval.y1)}
            fill={interval.color}
            fillOpacity={0.1}
            stroke={interval.color}
            strokeWidth={0.5}
            strokeOpacity={0.75}
            style={{ filter: `drop-shadow( 1px 1px 2px ${filterColor})` }}
          />
          <line
            x1={interval.x - (width * 1.5 / 2)}
            x2={interval.x + (width * 1.5 / 2)}
            y1={interval.y1}
            y2={interval.y1}
            stroke={interval.color}
            strokeWidth={1.5}
            strokeOpacity={1}
            style={{ filter: `drop-shadow( 1px 1px 2px ${filterColor})` }}
          />
        </g>
      )
    })}
  </g>
}