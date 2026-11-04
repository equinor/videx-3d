import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  isOverlayDock,
  OverlayItemContext,
  useOverlay,
  type OverlayAnchor,
} from './overlay-context';

/**
 * OverlayItem props
 * @expand
 */
export type OverlayItemProps = {
  /**
   * where it sits: a dock the full height of the view (`'left'`, `'right'`), a corner or the
   * middle of an edge of the space between the docks, or `'fill'`, all of that space.
   * Default `'top-left'`
   */
  anchor?: OverlayAnchor;
  /** among the items of its anchor: lower is nearer the edge (in a dock, the top). Default 0 */
  order?: number;
  /** names it in the overlay's `layout`, which may place it elsewhere */
  id?: string;
  /**
   * in a dock, take the height its other items leave — a sidebar (a `Panel` in a dock does
   * it of itself). Default false
   */
  stretch?: boolean;
  children?: ReactNode;
};

/**
 * Places its children in the enclosing {@link Overlay}: in a dock down a side of the view, at
 * an anchor of the space between the docks — stacked with the items there by `order`, the
 * lowest nearest the edge — or filling that space (`'fill'`), the later ones over the
 * earlier. It takes pointer events; the overlay around it lets them through to the scene.
 * Outside an overlay, the children are rendered where they are.
 *
 * @group Components
 */
export const OverlayItem = ({
  anchor = 'top-left',
  order = 0,
  id,
  stretch = false,
  children,
}: OverlayItemProps) => {
  const overlay = useOverlay();
  const place = overlay?.placement(id, { anchor, order }) ?? { anchor, order };
  const docked = isOverlayDock(place.anchor);
  const stretched = docked && stretch;
  const item = useMemo(
    () => ({ anchor: place.anchor, stretch: stretched }),
    [place.anchor, stretched],
  );
  if (!overlay) return <>{children}</>;
  const element = overlay.anchors[place.anchor];
  if (!element) return null;
  let style: CSSProperties;
  if (place.anchor === 'fill')
    style = {
      gridArea: '1 / 1',
      position: 'relative',
      minWidth: 0,
      minHeight: 0,
      order: place.order,
      pointerEvents: 'auto',
      display: 'flex',
      flexDirection: 'column',
    };
  else if (docked)
    style = {
      order: place.order,
      pointerEvents: 'auto',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      flex: stretched ? '1 1 0' : '0 0 auto',
      // Kept `gap` from the space between the docks.
      [place.anchor === 'left' ? 'marginRight' : 'marginLeft']: overlay.gap,
    };
  else style = { order: place.order, pointerEvents: 'auto', display: 'flex' };
  return createPortal(
    <OverlayItemContext.Provider value={item}>
      <div data-overlay-item={id} style={style}>
        {children}
      </div>
    </OverlayItemContext.Provider>,
    element,
  );
};
