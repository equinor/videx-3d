import { path } from 'd3-path'
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp } from '../../../sdk/utils/numbers'
import { select } from 'd3-selection'
import { drag } from 'd3-drag'
import { scaleLinear } from 'd3-scale'
import { useWellMapState } from './well-map-context'

type Props = {
  depth: number,
  setDepth?: (depth: number) => void
  ruler?: boolean
  rulerWidth?: number
}

export const DepthCursor = ({
  depth,
  setDepth,
  ruler = true,
  rulerWidth = 4.5,
}: Props) => {
  const depthCursorRef = useRef<SVGGElement>(null)

  const wellMapState = useWellMapState()
  const domain = wellMapState(state => state.domain)
  const range = wellMapState(state => state.measures.range)
  const tracksWidth = wellMapState(state => state.measures.tracksWidth)
  const styles = wellMapState(state => state.styles)

  const [dragging, setDragging] = useState(false)

  const depthScale = useMemo(() => scaleLinear().domain(domain).range(range), [domain, range])

  const cursorPath = useMemo(() => {
    const cursorHeight = styles.depthAxisWidth * 0.65
    const cursorPath = path()
    cursorPath.moveTo(0, -cursorHeight / 2)
    cursorPath.lineTo(styles.depthAxisWidth / 2, -cursorHeight / 2)
    cursorPath.lineTo(styles.depthAxisWidth, 0)
    cursorPath.lineTo(styles.depthAxisWidth / 2, cursorHeight / 2)
    cursorPath.lineTo(0, cursorHeight / 2)
    cursorPath.lineTo(0, -cursorHeight / 2)

    return cursorPath.toString()
  }, [styles.depthAxisWidth])

  const y = useMemo(() => depthScale(depth), [depth, depthScale])

  const filterColor = useMemo(() => {
    const v = styles.darkMode ? 0 : 240
    return `rgba(${v}, ${v}, ${v}, .7)`
  }, [styles.darkMode])

  useEffect(() => {
    function dragged(event: DragEvent) {
      if (!depthCursorRef.current) return
      const range = depthScale.range()
      const pos = clamp(event.y, range[0], range[1])
      const depth = depthScale.invert(pos)

      if (setDepth) setDepth(depth)
    }

    function dragStart() {
      setDragging(true)
      document.body.style.cursor = 'grab'
    }

    function dragEnd() {
      setDragging(false)
      document.body.style.cursor = ''
    }

    if (depthCursorRef.current && setDepth) {
      const dragFunc = drag<SVGGElement, unknown>()
      dragFunc.on("drag", dragged)
      dragFunc.on('start', dragStart)
      dragFunc.on('end', dragEnd)
      select(depthCursorRef.current).call(dragFunc)
    }
  }, [setDepth, depthScale])

  const onKeyPressed = useCallback((event: KeyboardEvent) => {
    if (setDepth) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const d = depth !== undefined ? depth : domain[0]
        let modifier = 1
        if (event.shiftKey) {
          modifier *= 25
        }
        else if (event.ctrlKey) {
          modifier *= 0.1
        }
        const v = event.key === 'ArrowDown' ? d + modifier : d - modifier
        setDepth(clamp(v, domain[0], domain[1]))
      } 
      else if (event.key === 'End') {
        setDepth(domain[1])
      }
      else if (event.key === 'Home') {
        setDepth(domain[0])
      }
    }
  }, [depth, setDepth, domain])

  return (
    <g
      ref={depthCursorRef}
      tabIndex={0}
      onKeyDown={onKeyPressed}
      style={{
        pointerEvents: 'painted',
        cursor: 'grab',
        transform: `translate(0,${y}px)`,
        outline: 'none'
      }}
    >
      <path d={cursorPath}
        stroke={styles.cursorColor}
        strokeWidth={2}
        fill={'rgba(256,256,256,0.25)'}
        filter={`drop-shadow( 1px 1px 2px ${filterColor})`}
        opacity={0.9}
      />
      {ruler && (
        <>
          <line
            x1={styles.depthAxisWidth}
            y1={0}
            x2={styles.depthAxisWidth + tracksWidth}
            y2={0}
            stroke={styles.rulerColor}
            strokeWidth={rulerWidth}
            strokeOpacity={0.25}
          />
          {dragging && (
            <text
              x={styles.depthAxisWidth + tracksWidth}
              textAnchor='end'
              fontFamily='monospace'
              fill={styles.cursorColor}
            >
              {depth.toFixed(1)}
            </text>
          )}
        </>
      )}

    </g>
  )
}