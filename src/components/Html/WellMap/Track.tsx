import { MouseEvent, useCallback, useMemo } from 'react'

import { path } from 'd3-path'
import { scaleLinear } from 'd3-scale'
import { pointer } from 'd3-selection'
import { WellboreHeader } from '../../../sdk'
import { clamp } from '../../../sdk/utils/numbers'
import { useWellMapState } from './well-map-context'

type Props = {
  wellboreId: string
  slot: number
  isSelected: boolean
  setSelected?: (wellbore: string, depth: number) => void
  setDepth?: (depth: number) => void
  onWellboreOver?: (wellbore: WellboreHeader | null, depth: number | undefined) => void
  interactive: boolean
  color?: string
}

export const Track = ({
  wellboreId,
  slot,
  isSelected,
  setSelected,
  setDepth,
  onWellboreOver,
  interactive,
  color = 'white'
}: Props) => {
  const wellMapState = useWellMapState()
  const wellboresById = wellMapState(state => state.wellboresById)
  const wellboresByName = wellMapState(state => state.wellboresByName)
  const ratio = wellMapState(state => state.measures.ratio)
  const domain = wellMapState(state => state.domain)
  const range = wellMapState(state => state.measures.range)
  const activeDepths = wellMapState(state => state.activeDepths)
  const slotsById = wellMapState(state => state.slotsById)
  const styles = wellMapState(state => state.styles)
  const getSlotPosition = wellMapState(state => state.measures.getSlotPosition)

  const wellbore = useMemo(() => wellboresById[wellboreId] || null, [wellboreId, wellboresById])

  const parentSlot = useMemo(() => {
    if (wellbore && wellbore.parent) {
      const parentId = wellboresByName[wellbore.parent]?.id
      if (!parentId) return 0
      return slotsById[parentId]
    }
    return null
  }, [wellbore, wellboresByName, slotsById])

  const depthScale = useMemo(() => scaleLinear().domain(domain).range(range), [domain, range])


  const [x1, x2] = useMemo(() => {
    return [
      getSlotPosition(parentSlot !== null ? parentSlot : slot),
      getSlotPosition(slot)
    ]
  }, [slot, parentSlot, getSlotPosition])

  const lineHeight = useMemo(() => {
    return ratio ? Math.min(15, ratio * 24) : 0
  }, [ratio])

  const strokeWidth = useMemo(() => ratio > 0 ? ratio * 10 : 0, [ratio])

  const pathStr = useCallback((x1: number, x2: number, y1: number, y2: number) => {
    const pathFunc = path()

    pathFunc.moveTo(x1, y1)
    if (x1 !== x2) {
      if (y2 - y1 > strokeWidth) {
        const y3 = y1 + strokeWidth
        pathFunc.arcTo(x2, y1, x2, y3, strokeWidth)
      } else {
        pathFunc.lineTo(x2, y1)
      }
    }
    pathFunc.lineTo(x2, y2)
    return pathFunc.toString()
  }, [strokeWidth])

  const { active, inactive, kickoff, termination } = useMemo(() => {
    let active: [number, number, number, number] | null = null
    let inactive: [number, number, number, number] | null = null
    let termination = 0
    let top = 0
    let kickoff: number | null = null
    if (wellbore) {
      const activeToDepth = activeDepths[wellbore.id]
      let fromMsl = -wellbore.depthReferenceElevation
      if (wellbore.kickoffDepthMsl !== null) {
        fromMsl = wellbore.kickoffDepthMsl
        kickoff = depthScale(wellbore.kickoffDepthMsl)
      }

      top = depthScale(fromMsl)
      termination = depthScale(wellbore.depthMdMsl)

      if (activeToDepth !== undefined) {
        const activeTo = depthScale(activeToDepth)
        active = [x1, x2, top, activeTo]
        if (activeTo > top) {
          inactive = [x2, x2, activeTo, termination]
        }
      } else {
        inactive = [x1, x2, top, termination]
      }
    }
    return { active, inactive, kickoff, termination }

  }, [depthScale, wellbore, activeDepths, x1, x2])

  const filterColor = useMemo(() => {
    const v = styles.darkMode ? 0 : 240
    return `rgba(${v}, ${v}, ${v}, .9)`
  }, [styles.darkMode])

  if (!wellbore) return null

  const dash = strokeWidth / 2
  const dashArr = `${dash},${dash / 2}`


  return (
    <g
      className={`track ${isSelected ? 'selected' : ''} ${interactive ? 'interactive' : ''}`}
      style={{ pointerEvents: 'painted', opacity: !interactive || isSelected ? 1 : 0.75 }}
      onClick={interactive ? (event: MouseEvent<SVGGElement>) => {
        let depth = 0
        if (setDepth && event && event.clientY) {
          const [, y] = pointer(event)
          const pos = clamp(y, range[0], range[1])
          depth = depthScale.invert(pos)

          setDepth(depth)
        }
        if (setSelected && !isSelected) {
          setSelected(wellboreId, depth)
        }
      } : undefined}
      onPointerMove={interactive && onWellboreOver ? (event: MouseEvent<SVGGElement>) => {
        let depth = 0
        if (event && event.clientY && event.target instanceof SVGPathElement) {
          const [, y] = pointer(event)
          const pos = clamp(y, range[0], range[1])
          depth = depthScale.invert(pos)
          onWellboreOver(wellbore, depth)
        }
      } : undefined}
      onPointerLeave={interactive && onWellboreOver ? (event: MouseEvent<SVGGElement>) => {
        if (event && event.target instanceof SVGPathElement) {
          onWellboreOver(null, undefined)
        }
      } : undefined}
    >
      <title>{wellbore.name}</title>

      {active && (
        <>
          <path
            d={pathStr(...active)}
            stroke={color}
            strokeWidth={strokeWidth}
            fill={'none'}
            style={{ filter: `drop-shadow( 1px 1px 2px ${filterColor})` }}
          />
        </>
      )}

      {inactive && (
        <>
          <path
            d={pathStr(...inactive)}
            stroke={color}
            strokeWidth={strokeWidth}
            fill={'none'}
            strokeDasharray={dashArr}
            style={{ filter: `drop-shadow( 1px 1px 2px ${filterColor})`, pointerEvents: 'none' }}
          />
          <path
            d={pathStr(...inactive)}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeOpacity={0}
            fill={'none'}
          />
        </>
      )}

      {/* {isSelected && (
        <circle
          cx={x1}
          cy={top}
          r={strokeWidth * 1.5}
          fill={color}
          fillOpacity={0.3}
          stroke={color}
          strokeWidth={1.5}
          style={{ filter: `drop-shadow( 1px 1px 1px ${filterColor})` }}
        />
      )} */}
      {kickoff && (
        <circle
          cx={x1}
          cy={kickoff}
          r={strokeWidth * 0.8}
          fill={color}
          stroke={'#00000080'}
          strokeWidth={0.5}
          style={{ filter: `drop-shadow( 1px 1px 1px ${filterColor})` }}
        />
      )}

      {lineHeight >= 8 && (
        <text
          x={x2}
          y={termination + lineHeight}
          fontSize={`${lineHeight - 2}px`}
          fill={styles.textColor}
          fillOpacity={isSelected ? 1 : 0.75}
          textAnchor='middle'
          dominantBaseline='middle'
          fontFamily='monospace'
          fontWeight='bold'
          style={{
            textDecoration: isSelected ? 'underline' : ''
          }}
        >
          {wellbore.name.replace(wellbore.well, '') || 'Main'}
        </text>
      )}
      {ratio >= 0.5 && (
        <text
          x={x2}
          y={termination + lineHeight * 2}
          fontSize={`${(lineHeight * 0.75) - 2}px`}
          fill={styles.textColor}
          fillOpacity={isSelected ? 1 : 0.75}
          textAnchor='middle'
          dominantBaseline='auto'
          fontFamily='monospace'
        >
          {wellbore.depthMdMsl}m
        </text>
      )}
    </g>
  )
}