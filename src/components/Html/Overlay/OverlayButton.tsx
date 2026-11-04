import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { HUD_ACTIVE, HUD_BUTTON, HUD_IDLE } from '../hud';

/**
 * OverlayButton props
 * @expand
 */
export type OverlayButtonProps = {
  /** what it says on hover, and to a screen reader */
  title: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** a toggle that is on: drawn highlighted, and `aria-pressed`. Default none: not a toggle */
  active?: boolean;
  /** its width and height in pixels. Default 24 */
  size?: number;
  disabled?: boolean;
  /** styles over its own */
  style?: CSSProperties;
  /** its face: a glyph, or an icon (an SVG, say) */
  children?: ReactNode;
};

/**
 * A small square button in the look of the gadgets over the 3D view (a map's buttons, a
 * closed panel's): for toolbars of your own, in an {@link Overlay} or in a layout of your own
 * (it needs neither).
 *
 * @group Components
 */
export const OverlayButton = ({
  title,
  onClick,
  onDoubleClick,
  active,
  size = 24,
  disabled,
  style,
  children,
}: OverlayButtonProps) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    onDoubleClick={onDoubleClick}
    style={{
      ...HUD_BUTTON,
      width: size,
      height: size,
      // Clickable on a layer that lets the pointer through (a `CanvasHtml`'s, an overlay's).
      pointerEvents: 'auto',
      ...(active !== undefined && {
        borderColor: active ? HUD_ACTIVE : HUD_IDLE,
        color: active ? HUD_ACTIVE : '#fff',
      }),
      ...(disabled && { opacity: 0.4, cursor: 'default' }),
      ...style,
    }}
  >
    {children}
  </button>
);
