import { range as d3range } from 'd3-array'
import { axisLeft } from 'd3-axis'
import { format } from 'd3-format'
import { scaleLinear } from 'd3-scale'
import { select } from 'd3-selection'
import { PropsWithChildren, useEffect, useMemo, useRef } from 'react'
import useMeasure from 'react-use-measure'
import { WellboreHeader } from '../../../sdk'
import { ActiveTrack } from './ActiveTrack'
import { DepthCursor } from './DepthCursor'
import { Track } from './Track'
import { useWellMapState } from './well-map-context'

type Props = {
  selected?: string
  color?: string
  setSelected?: (wellbore: string, depth: number) => void
  depth?: number,
  setDepth?: (depth: number) => void
  onWellboreOver?: (wellbore: WellboreHeader | null, depth: number | undefined) => void
  colorMap?: Record<string, string>
  interactive?: boolean
  depthCursor?: boolean
}

export const Schematic = ({
  selected,
  setSelected,
  depth,
  setDepth,
  onWellboreOver,
  color,
  colorMap,
  interactive,
  depthCursor,
  children,
}: PropsWithChildren<Props>) => {

  const [svgRef, measure] = useMeasure()

  const wellMapState = useWellMapState()
  const wellboreIds = wellMapState(state => state.wellboreIds)
  const wellboresById = wellMapState(state => state.wellboresById)
  const setMeasure = wellMapState(state => state.setMeasure)
  const domain = wellMapState(state => state.domain)
  const range = wellMapState(state => state.measures.range)
  const trackWidth = wellMapState(state => state.measures.trackWidth)
  const slotsById = wellMapState(state => state.slotsById)
  const styles = wellMapState(state => state.styles)

  const tracksGroupRef = useRef<SVGGElement>(null)
  const depthAxisRef = useRef<SVGGElement>(null)
  const kickoffAxisRef = useRef<SVGGElement>(null)

  useEffect(() => {
    setMeasure(measure.width, measure.height)
  }, [measure, setMeasure, wellboreIds])

  const depthScale = useMemo(() => scaleLinear().domain(domain).range(range), [domain, range])

  const depthAxis = useMemo(() => {
    const start = Math.floor(depthScale.domain()[0] / 100) * 100
    const hundreds = Math.ceil((depthScale.domain()[1] - start) / 100)

    const axis = axisLeft(depthScale)
      .tickValues(d3range(0, hundreds).map(v => v * 100 + start))
      .tickSizeInner(styles.depthAxisWidth)

    return axis
  }, [depthScale, styles])


  const kickoffAxis = useMemo(() => {
    //const selectedWellbore = selected ? wellboresById[selected] : undefined
    //const selectedTick = selectedWellbore ? selectedWellbore.kickoffDepthMsl : null

    const tickValues = new Set<number>()
    wellboreIds.forEach((id) => {
      const wellbore = wellboresById[id]
      if (wellbore && wellbore.kickoffDepthMsl) {
        tickValues.add(wellbore.kickoffDepthMsl)
      }
    })

    // // remove overlaps
    const labelThreshold = 5.5 // fontSize 10
    const sortedTicks = Array.from(tickValues).sort((a, b) => a - b)
    const noTickLabel = new Set<number>()
    sortedTicks.forEach((tick, i) => {
      const prev = i > 0 ? sortedTicks[i - 1] : null
      if (prev) {
        const y1 = depthScale(prev)
        const y2 = depthScale(tick)
        if (Math.abs(y2 - y1) < labelThreshold) {
          noTickLabel.add(tick)
        }
      }
    })
    const axis = axisLeft(depthScale)
      .tickValues(sortedTicks)
      .tickSizeInner(-measure.width)
      .tickSizeOuter(2)
      .offset(0)
      .tickPadding(4)
      .tickFormat(tick => noTickLabel.has(tick.valueOf()) ? '' : format(',.0f')(tick))

    return axis
  }, [depthScale, wellboreIds, measure.width, wellboresById])


  const tracks = useMemo(
    () => wellboreIds.map(id => ({
      wellboreId: id,
      slot: slotsById[id],
    }))
      .sort((a, b) => (
        (a.wellboreId === selected ? Infinity : 0) - (b.wellboreId === selected ? Infinity : 0)
      ) || a.slot - b.slot),
    [wellboreIds, slotsById, selected]
  )

  // const selectedSlot = useMemo(() => {
  //   if (selected) {
  //     return slotsById[selected] !== undefined ? slotsById[selected] : null
  //   }
  //   return null
  // }, [selected, slotsById])

  useEffect(() => {
    if (depthAxisRef.current) {
      const depthAxisGroup = select(depthAxisRef.current)
      depthAxisGroup.call(depthAxis)
      depthAxisGroup.selectAll('.tick>text').remove()
      depthAxisGroup.selectAll('path.domain').remove()
      depthAxisGroup.selectAll('.tick>line').attr('stroke', styles.depthAxisColor)
    }
  }, [depthAxis, styles])

  useEffect(() => {
    if (kickoffAxisRef.current) {
      const kickoffAxisGroup = select(kickoffAxisRef.current)
      kickoffAxisGroup.call(kickoffAxis)
      kickoffAxisGroup.selectAll('.tick').attr('stroke-width', 0.5)
      kickoffAxisGroup.selectAll('path.domain').attr('stroke', styles.kickoffAxisColor)
    }
  }, [kickoffAxis, styles])

  return (
    <svg
      ref={svgRef}
      style={{
        flex: '1 1 auto',
        width: '100%',
        height: '100%',
      }}
      className='well-map'
    >
      {(trackWidth > 0 && measure.height > 0) && (
        <>
          <g className="data-layer" transform={`translate(${styles.depthAxisWidth}, 0)`}>
            {children}
          </g>

          <g ref={depthAxisRef} transform={`translate(${styles.depthAxisWidth}, 0)`} />
          <g ref={kickoffAxisRef} transform={`translate(${styles.depthAxisWidth}, 0)`} />

          <g ref={tracksGroupRef} className='tracks' transform={`translate(${styles.depthAxisWidth}, 0)`}>
            {tracks.map(track => (
              <Track
                key={track.wellboreId}
                wellboreId={track.wellboreId}
                slot={track.slot}
                color={(colorMap && colorMap[track.wellboreId]) || color || 'silver'}
                isSelected={!!(selected && selected === track.wellboreId)}
                setSelected={setSelected}
                interactive={!!interactive}
                setDepth={setDepth}
                onWellboreOver={onWellboreOver}
              />
            ))}
          </g>
          <g className="active-track" transform={`translate(${styles.depthAxisWidth}, 0)`}>
            {selected && <ActiveTrack wellboreId={selected} opacity={0.8} />}
          </g>
          {(interactive && depthCursor && depth !== undefined) && (
            <DepthCursor
              depth={depth}
              setDepth={setDepth}
            />
          )}
        </>
      )}
    </svg>

  )
}