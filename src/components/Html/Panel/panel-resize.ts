import { anchorGrowth, type Anchor } from '../../../common/anchor';

/**
 * The sizes a resizable `Panel` keeps to, in CSS pixels.
 *
 * @group Components
 */
export type PanelResizeLimits = {
  /** Default 120 */
  minWidth?: number;
  /** Default 80 */
  minHeight?: number;
  /** Default no more than the view leaves it */
  maxWidth?: number;
  /** Default no more than the view leaves it */
  maxHeight?: number;
};

/**
 * One of a panel's resize handles: the edge it moves across (`x`: -1 the left edge, 1 the
 * right, 0 neither) and up and down (`y`: -1 the top, 1 the bottom, 0 neither). A corner moves
 * both.
 *
 * @group Components
 */
export type PanelHandle = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/**
 * Where a panel sits, for its resize handles: one of the eight anchors, or an `Overlay`'s
 * dock (`'left'`, `'right'`), where it is a sidebar resized by its inner edge only.
 *
 * @group Components
 */
export type PanelAnchor = Anchor | 'left' | 'right';

/**
 * The resize handles of a panel anchored at `anchor`, on the edges away from it (both
 * edges about a middle anchor), and at the corners they meet: the anchored side stays put.
 * A sidebar in a dock, its inner edge alone. Public, with {@link resizePanel} and
 * {@link panelHandleCursor}, for a resizable box of the host's own.
 *
 * @group Utils
 */
export function panelHandles(anchor: PanelAnchor): PanelHandle[] {
  if (anchor === 'left') return [{ x: 1, y: 0 }];
  if (anchor === 'right') return [{ x: -1, y: 0 }];
  const growth = anchorGrowth(anchor);
  const xs: (-1 | 1)[] =
    growth.x === 'both' ? [-1, 1] : growth.x === 'start' ? [-1] : [1];
  const ys: (-1 | 1)[] =
    growth.y === 'both' ? [-1, 1] : growth.y === 'start' ? [-1] : [1];
  const handles: PanelHandle[] = [];
  for (const x of xs) handles.push({ x, y: 0 });
  for (const y of ys) handles.push({ x: 0, y });
  for (const x of xs) for (const y of ys) handles.push({ x, y });
  return handles;
}

/**
 * A panel's size after its handle `handle` was dragged `drag` pixels (right and down) from
 * where it started at `start`, kept within `limits`: an edge dragged outward grows it, and a
 * panel about a middle anchor (`symmetric` on that axis) grows on both sides at once.
 *
 * @group Utils
 */
export function resizePanel(
  start: readonly [number, number],
  drag: readonly [number, number],
  handle: PanelHandle,
  symmetric: readonly [boolean, boolean],
  limits: PanelResizeLimits = {},
): [number, number] {
  const grow = (
    size: number,
    delta: number,
    side: number,
    both: boolean,
    min: number,
    max: number,
  ) => {
    if (side === 0) return size;
    const next = size + delta * side * (both ? 2 : 1);
    return Math.round(Math.min(Math.max(next, min), Math.max(max, min)));
  };
  return [
    grow(
      start[0],
      drag[0],
      handle.x,
      symmetric[0],
      limits.minWidth ?? 120,
      limits.maxWidth ?? Infinity,
    ),
    grow(
      start[1],
      drag[1],
      handle.y,
      symmetric[1],
      limits.minHeight ?? 80,
      limits.maxHeight ?? Infinity,
    ),
  ];
}

/**
 * The CSS cursor over a handle.
 *
 * @group Utils
 */
export function panelHandleCursor({ x, y }: PanelHandle) {
  if (x === 0) return 'ns-resize';
  if (y === 0) return 'ew-resize';
  return x === y ? 'nwse-resize' : 'nesw-resize';
}
