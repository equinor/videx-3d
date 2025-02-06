import { useEffect, useMemo, useState } from 'react'
import { useData } from '../../../../hooks/useData'
import { scaleLinear } from 'd3-scale'
import { nanoid } from 'nanoid'
import { Pick } from '../../../../sdk/data/types/Pick'
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
  formations: string[]
}

/**
 * Formations addon for `WellMap`
 * @group Components
 * 
 * @see {@link WellMap}
 */
export const WellMapFormations = ({ formations }: WellMapFormationsProps) => {

  const store = useData()

  const [picksData, setPicksData] = useState<Record<string, Pick[]> | null>(null)

  const wellMapState = useWellMapState()
  const wellboreIds = wellMapState(state => state.wellboreIds)
  const wellboresById = wellMapState(state => state.wellboresById)
  const domain = wellMapState(state => state.domain)
  const range = wellMapState(state => state.measures.range)
  const ratio = wellMapState(state => state.measures.ratio)
  const slotsById = wellMapState(state => state.slotsById)
  const styles = wellMapState(state => state.styles)
  const getSlotPosition = wellMapState(state => state.measures.getSlotPosition)

  const depthScale = useMemo(() => scaleLinear().domain(domain).range(range), [domain, range])

  useEffect(() => {
    if (store) {
      const pickDataPromises = wellboreIds.map(id => store.get<Pick[]>('picks', id))

      Promise.all(pickDataPromises).then(response => {
        if (response) {
          const data = response.reduce((acc, d, i) => ({
            ...acc,
            [wellboreIds[i]]: d !== null ? d.sort((a, b) => a.mdMsl - b.mdMsl) : [],
          }), {})
          setPicksData(data)
        }
      })
    }
  }, [wellboreIds, store])

  const intervals = useMemo(() => {
    const output: Interval[] = []

    if (picksData) {
      wellboreIds.forEach((id) => {
        if (picksData[id]) {
          const wellbore = wellboresById[id]

          const fromMsl = wellbore.kickoffDepthMsl !== null ? wellbore.kickoffDepthMsl : wellbore.depthReferenceElevation
          const slot = slotsById[id]
          const position = getSlotPosition(slot)
          formations.forEach(formation => {
            //console.log(picksData[id].filter(d => d.name.endsWith('Top') && d.level === 1).map(d => d.name.replace(' Top', '')))
            const tops = picksData[id].filter(d => d.mdMsl <= wellbore.depthMdMsl && d.name === `${formation} Top`)
            tops.forEach(top => {
              let base = picksData[id].find(d => d.mdMsl > top.mdMsl && d.name === `${formation} Base`) 
              if (!base) {
                base = picksData[id].find(d => d.level <= top.level && d.mdMsl > top.mdMsl)
              }
              const baseDepth = Math.min(wellbore.depthMdMsl, base ? base.mdMsl : wellbore.depthMdMsl)
              if (baseDepth > fromMsl) {
                const topDepth = Math.max(fromMsl, top.mdMsl)
                const interval: Interval = {
                  id: nanoid(),
                  formation,
                  color: top.color,
                  level: top.level,
                  x: position,
                  y1: depthScale(topDepth),
                  y2: depthScale(baseDepth),
                }

                output.push(interval)
              }
            })
          })
        }
      })
    }
    output.sort((a, b) => a.x - b.x || a.y1 - b.y1 || a.level - b.level)
    return output
  }, [picksData, formations, depthScale, getSlotPosition, slotsById, wellboreIds, wellboresById])

  const filterColor = useMemo(() => {
    const v = styles.darkMode ? 0 : 240
    return `rgba(${v}, ${v}, ${v}, .9)`
  }, [styles.darkMode])

  if (!intervals) return null

  return <g>
    {intervals.map(interval => {
      const width = (ratio * (35 - interval.level * 4))
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
            style={{ filter: `drop-shadow( 1px 1px 2px ${filterColor})`}}
          />
          <line
            x1={interval.x - (width * 1.5 / 2)}
            x2={interval.x + (width * 1.5 / 2)}
            y1={interval.y1}
            y2={interval.y1}
            stroke={interval.color}
            strokeWidth={1.5}
            strokeOpacity={1}
            style={{ filter: `drop-shadow( 1px 1px 2px ${filterColor})`}}
          />
        </g>
      )
    })}
  </g>
}