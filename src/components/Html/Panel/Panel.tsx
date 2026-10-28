import { forwardRef, PropsWithChildren, useMemo } from 'react';
import { Corner, cornerStyle } from '../../../common/corner-style';

/**
 * Panel props
 * @expand
 */
export type PanelProps = {
  width?: number;
  /**
   * Max height in px. Omit to let the panel size to its content, which is also
   * the only way to keep it click-through: a clamped panel may need to scroll, and
   * a scrollbar is unusable without pointer events.
   */
  height?: number;
  offset?: [number, number];
  opacity?: number;
  padding?: number;
  /** Root font size in px. Everything inside is sized in `em`, so this scales it all. */
  fontSize?: number;
  origin?: Corner;
};

/**
 * A simple HTML panel that can be used as an overlay on the 3d canvas.
 * @see {@link OutputPanel}
 * @group Components
 */
export const Panel = forwardRef<HTMLDivElement, PropsWithChildren<PanelProps>>(
  (
    {
      origin = 'bottom-left',
      width = 400,
      height,
      offset = [10, 10],
      opacity = 0.8,
      padding = 0,
      fontSize = 16,
      children = null,
    },
    fref,
  ) => {
    const { left, bottom, right, top } = useMemo(
      () => cornerStyle(origin, offset),
      [origin, offset],
    );

    return (
      <div
        ref={fref}
        style={{
          borderRadius: 8,
          position: 'absolute',
          // Column flex + owning the overflow so `maxHeight` actually bounds the
          // content: without it a child paints past the dimmed background.
          display: 'flex',
          flexDirection: 'column',
          overflow: height ? 'auto' : 'hidden',
          boxSizing: 'border-box',
          left,
          bottom,
          right,
          top,
          padding,
          color: 'white',
          fontFamily: 'verdana',
          fontSize: `${fontSize}px`,
          lineHeight: 1.3,
          width: `${width}px`,
          maxHeight: height ? `${height}px` : undefined,
          zIndex: 10,
          pointerEvents: height ? 'auto' : 'none',
          background: `#000000${Math.round(opacity * 256)
            .toString(16)
            .padStart(2, '0')}`,
        }}
      >
        {children}
      </div>
    );
  },
);
