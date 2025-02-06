import { Fragment, useEffect, useMemo, useState } from 'react'
import { useData } from '../../../../hooks/useData'
import { CasingItem } from '../../../../sdk/data/types/Casing'
import { path } from 'd3-path'
import { nanoid } from 'nanoid'
import { scaleLinear } from 'd3-scale'
import { useWellMapState } from '../well-map-context'

type Shoe = {
  id: string,
  name: string,
  x: number,
  y: number,
}

/**
 * WellMapCasingShoes props
 * @expand
 */
export type WellMapCasingShoesProps = {
  color?: string
}

/**
 * Casing shoes display addon for `WellMap`
 * @group Components
 * 
 * @see {@link WellMap}
 */
export const WellMapCasingShoes = ({ color = '#ccc' }: WellMapCasingShoesProps) => {

  const store = useData()

  const [data, setData] = useState<Record<string, CasingItem[]> | null>(null)

  const wellMapState = useWellMapState()
  const wellboreIds = wellMapState(state => state.wellboreIds)
  const wellboresById = wellMapState(state => state.wellboresById)
  const domain = wellMapState(state => state.domain)
  const range = wellMapState(state => state.measures.range)
  const ratio = wellMapState(state => state.measures.ratio)
  const tracksWidth = wellMapState(state => state.measures.tracksWidth)
  const slotsById = wellMapState(state => state.slotsById)
  const styles = wellMapState(state => state.styles)
  const getSlotPosition = wellMapState(state => state.measures.getSlotPosition)
  
  const depthScale = useMemo(() => scaleLinear().domain(domain).range(range), [domain, range])

  useEffect(() => {
    if (store) {
      const dataPromises = wellboreIds.map(id => store.get<CasingItem[]>('casings', id))
      Promise.all(dataPromises).then(response => {
        const data = response.reduce((acc, d, i) => ({
          ...acc,
          [wellboreIds[i]]: d,
        }), {})
        setData(data)
      })
    }
  }, [wellboreIds, store])

  const shoes = useMemo(() => {
    const output: Shoe[] = []
    if (data) {
      wellboreIds.forEach((id) => {
        const wellbore = wellboresById[id]

        const fromMsl = wellbore.kickoffDepthMsl !== null ? wellbore.kickoffDepthMsl : wellbore.depthReferenceElevation
        const slot = slotsById[id]
        const position = getSlotPosition(slot)

        if (data[id]) {
          data[id]
            .filter((d) => d.type === 'Shoe' && (fromMsl === null || d.mdBottomMsl > fromMsl))
            .forEach((d) => {
              const y = depthScale(d.mdBottomMsl)
              output.push({
                id: nanoid(),
                name: `${d.properties['Diameter']} ${d.properties['Type']}`,
                x: position,
                y,
              })
            })
        }
      })
    }
    return output
  }, [data, depthScale, getSlotPosition, slotsById, wellboreIds, wellboresById])

  const pathString = useMemo(() => {
    if (ratio) {
      const innerHalfWidth = 7 * ratio
      const outerHalfWidth = 16 * ratio
      const height = outerHalfWidth - innerHalfWidth

      const pathFunc = path()
      pathFunc.moveTo(-innerHalfWidth, -height * 2)
      pathFunc.lineTo(-innerHalfWidth, 0)
      pathFunc.lineTo(-outerHalfWidth, 0)
      pathFunc.lineTo(-innerHalfWidth - 2, -height)
      pathFunc.lineTo(-innerHalfWidth - 2, -height * 2)
      pathFunc.lineTo(-innerHalfWidth, -height * 2)
      pathFunc.closePath()
      pathFunc.moveTo(innerHalfWidth, -height * 2)
      pathFunc.lineTo(innerHalfWidth, 0)
      pathFunc.lineTo(outerHalfWidth, 0)
      pathFunc.lineTo(innerHalfWidth + 2, -height)
      pathFunc.lineTo(innerHalfWidth + 2, -height * 2)
      pathFunc.lineTo(innerHalfWidth, -height * 2)
      pathFunc.closePath()

      return pathFunc.toString()
    }
    return ''
  }, [ratio])

  const filterColor = useMemo(() => {
    const v = styles.darkMode ? 0 : 240
    return `rgba(${v}, ${v}, ${v}, .9)`
  }, [styles.darkMode])

  if (!shoes) return null

  return <g>
    {shoes.map(shoe => (
      <Fragment key={shoe.id}>
        <line x1={0} y1={shoe.y} x2={tracksWidth} y2={shoe.y} stroke={color} strokeOpacity={0.25} strokeDasharray={'2,2'} />
        <path
          key={shoe.id}
          d={pathString}
          stroke='black'
          strokeWidth={0.25}
          fill={color}
          transform={`translate(${shoe.x},${shoe.y})`}
          style={{
            filter: `drop-shadow( 1px 1px 2px ${filterColor})`,
            pointerEvents: 'painted',
            cursor: 'help'
          }}
        >
          <title>{shoe.name}</title>
        </path>
      </Fragment>
    ))}
  </g>
}