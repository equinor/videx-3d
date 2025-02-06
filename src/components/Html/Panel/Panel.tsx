import { forwardRef, PropsWithChildren, useMemo } from 'react'

/**
 * Panel props
 * @expand
 */
export type PanelProps = {
  width?: number,
  height?: number,
  offset?: [number, number],
  opacity?: number,
  padding?: number,
  origin?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

type PanelPositionStyles = [string | undefined, string | undefined, string | undefined, string | undefined]

/**
 * A simple HTML panel that can be used as an overlay on the 3d canvas.
 * @see {@link OutputPanel}
 * @group Components
 */
export const Panel = forwardRef<HTMLDivElement, PropsWithChildren<PanelProps>>(({
  origin = 'bottom-left',
  width = 400,
  height = 600,
  offset = [10, 10],
  opacity = 0.8,
  padding = 0,
  children = null
}, fref) => {

  const [left, bottom, right, top] = useMemo<PanelPositionStyles>(() => {
    if (origin === 'top-left') {
      return [
        `${offset[0]}px`,
        undefined,
        undefined,
        `${offset[1]}px`,
      ]
    }

    if (origin === 'top-right') {
      return [
        undefined,
        undefined,
        `${offset[0]}px`,
        `${offset[1]}px`,
      ]
    }

    if (origin === 'bottom-right') {
      return [
        undefined,
        `${offset[1]}px`,
        `${offset[0]}px`,
        undefined
      ]
    }

    return [
      `${offset[0]}px`,
      `${offset[1]}px`,
      undefined,
      undefined,
    ]
  }, [origin, offset])

  return (
    <div
      ref={fref}
      style={{
        borderRadius: 8,
        position: 'absolute',
        display: 'inline-block',
        left,
        bottom,
        right,
        top,
        padding,
        color: 'white',
        fontFamily: 'verdana',
        width: `${width}px`,
        maxHeight: `${height}px`,
        zIndex: 10,
        pointerEvents: 'none',
        background: `#000000${Math.round(opacity * 256).toString(16).padStart(2, '0')}`,
      }}>
      {children}
    </div>
  )
})