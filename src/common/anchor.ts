import type { Corner } from './corner-style';

/**
 * Where an item sits on a panel or over the 3D view: a corner, or the middle of an edge.
 *
 * @group Utils
 */
export type Anchor =
  | Corner
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center';

/**
 * Every {@link Anchor}, corners first.
 *
 * @group Utils
 */
export const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'top-center',
  'bottom-center',
  'left-center',
  'right-center',
];

/**
 * Where one item goes among others anchored on the same box, and how its own content flows.
 *
 * @group Utils
 */
export type AnchorPlacement = {
  /** where it sits. Items at one anchor stack, the first by `order` nearest the edge */
  anchor?: Anchor;
  /** how its own content lays itself out: in a row or a column. Default `'column'` */
  direction?: 'row' | 'column';
  /** among the items of its anchor: lower is nearer the edge */
  order?: number;
};

/**
 * The CSS that places an absolutely positioned box at `anchor`, `inset` pixels in from the
 * edges.
 *
 * @group Utils
 */
export type AnchorStyle = {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  transform?: string;
};

/**
 * The CSS that places an absolutely positioned box at `anchor` of its container: a corner
 * `inset` pixels in from both edges, or the middle of an edge `inset` pixels in from it.
 *
 * @group Utils
 */
export function anchorStyle(anchor: Anchor, inset: number): AnchorStyle {
  const d = `${inset}px`;
  switch (anchor) {
    case 'top-left':
      return { left: d, top: d };
    case 'top-right':
      return { right: d, top: d };
    case 'bottom-left':
      return { left: d, bottom: d };
    case 'bottom-right':
      return { right: d, bottom: d };
    case 'top-center':
      return { top: d, left: '50%', transform: 'translateX(-50%)' };
    case 'bottom-center':
      return { bottom: d, left: '50%', transform: 'translateX(-50%)' };
    case 'left-center':
      return { left: d, top: '50%', transform: 'translateY(-50%)' };
    default:
      return { right: d, top: '50%', transform: 'translateY(-50%)' };
  }
}

/**
 * How the items at `anchor` stack: along `direction`, the first (lowest `order`) nearest the
 * edge — reversed at the bottom and the right, where the edge is at the end — and lined up
 * with the edge they sit against.
 *
 * @group Utils
 */
export function anchorStack(
  anchor: Anchor,
  direction: 'row' | 'column',
): {
  flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  alignItems: 'flex-start' | 'flex-end' | 'center';
} {
  const bottom = anchor.startsWith('bottom');
  const right = anchor.endsWith('right') || anchor === 'right-center';
  const flexDirection =
    direction === 'column'
      ? bottom
        ? 'column-reverse'
        : 'column'
      : right
        ? 'row-reverse'
        : 'row';
  // Across the stack, lined up with the edge it sits against; centred on a middle anchor.
  const alignItems =
    direction === 'column'
      ? anchor === 'top-center' || anchor === 'bottom-center'
        ? 'center'
        : right
          ? 'flex-end'
          : 'flex-start'
      : anchor === 'left-center' || anchor === 'right-center'
        ? 'center'
        : bottom
          ? 'flex-end'
          : 'flex-start';
  return { flexDirection, alignItems };
}

/**
 * Which edges of a box anchored at `anchor` move when it is resized, so that the anchored
 * side stays put: `'end'` (right, bottom), `'start'` (left, top), or `'both'` about a middle.
 *
 * @group Utils
 */
export function anchorGrowth(anchor: Anchor): {
  x: 'start' | 'end' | 'both';
  y: 'start' | 'end' | 'both';
} {
  const x =
    anchor === 'top-center' || anchor === 'bottom-center'
      ? 'both'
      : anchor.endsWith('right') || anchor === 'right-center'
        ? 'start'
        : 'end';
  const y =
    anchor === 'left-center' || anchor === 'right-center'
      ? 'both'
      : anchor.startsWith('bottom')
        ? 'start'
        : 'end';
  return { x, y };
}

/**
 * The items of `shown` grouped by the anchor they sit at, each anchor's in the order they
 * stack (nearest the edge first): `layout` over `defaults`. Items of one order keep the order
 * they were given in.
 *
 * @group Utils
 */
export function resolveAnchorLayout<T extends string>(
  shown: readonly T[],
  defaults: Readonly<Record<T, Required<AnchorPlacement>>>,
  layout: Partial<Record<T, AnchorPlacement>> = {},
): Map<Anchor, { item: T; direction: 'row' | 'column' }[]> {
  const groups = new Map<
    Anchor,
    { item: T; direction: 'row' | 'column'; order: number }[]
  >();
  for (const item of shown) {
    const place = { ...defaults[item], ...layout[item] };
    const group = groups.get(place.anchor) ?? [];
    group.push({ item, direction: place.direction, order: place.order });
    groups.set(place.anchor, group);
  }
  // Array.prototype.sort is stable: equal orders stay in the order the items were given.
  return new Map(
    [...groups].map(([anchor, group]) => [
      anchor,
      group
        .sort((a, b) => a.order - b.order)
        .map(({ item, direction }) => ({ item, direction })),
    ]),
  );
}
