import { createContext, useContext } from 'react';
import type { Anchor } from '../../../common/anchor';

/**
 * A dock of an {@link Overlay}: a column the full height of the view along its left or right
 * edge. The other anchors are laid out in the space between the docks.
 *
 * @group Components
 */
export type OverlayDock = 'left' | 'right';

/**
 * Where an item sits in an {@link Overlay}: a dock (`'left'`, `'right'`), the full height of
 * the view along its edge; one of the eight anchors between the docks (a corner, or the
 * middle of an edge), where items stack and no two anchors overlap; or `'fill'`, the whole
 * of the space between the docks.
 *
 * @group Components
 */
export type OverlayAnchor = Anchor | OverlayDock | 'fill';

/** Whether `anchor` is one of an overlay's docks. */
export function isOverlayDock(
  anchor: OverlayAnchor | undefined | null,
): anchor is OverlayDock {
  return anchor === 'left' || anchor === 'right';
}

/**
 * Where an overlay item goes: its anchor and its order among the items there.
 *
 * @group Components
 */
export type OverlayPlacement = {
  anchor?: OverlayAnchor;
  /** among the items of its anchor: lower is nearer the edge. Default 0 */
  order?: number;
};

/** What an {@link Overlay} offers its items. */
export type OverlayState = {
  /** the element each anchor's items are placed in, once mounted: `fill`'s is the space between the docks */
  anchors: Partial<Record<OverlayAnchor, HTMLElement>>;
  /** pixels between the view's edges and the items */
  inset: number;
  /** pixels between the items, and between the docks and what lies between them */
  gap: number;
  /** the overlay's own element: the whole view */
  element: HTMLElement | null;
  /** where an item with this `id` goes: the overlay's `layout` over what the item asks for */
  placement: (
    id: string | undefined,
    asked: Required<OverlayPlacement>,
  ) => Required<OverlayPlacement>;
};

export const OverlayContext = createContext<OverlayState | null>(null);

/** The enclosing {@link Overlay}, or `null` outside one. */
export function useOverlay() {
  return useContext(OverlayContext);
}

/** What an item placed by an {@link OverlayItem} knows of where it is. */
export type OverlayItemState = {
  anchor: OverlayAnchor;
  /** in a dock, it takes the height the dock's other items leave */
  stretch: boolean;
};

export const OverlayItemContext = createContext<OverlayItemState | null>(null);

/**
 * The {@link OverlayItem} this is placed by, or `null`: a panel inside one sizes itself from
 * the anchor it is placed at (its resize handles face away from it; in a dock, a sidebar).
 */
export function useOverlayItem() {
  return useContext(OverlayItemContext);
}
