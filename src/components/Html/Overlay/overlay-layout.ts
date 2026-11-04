import type { Anchor } from '../../../common/anchor';

/**
 * The tracks an `Overlay` shares the space between its docks by, across into three columns
 * and, in each column, down into three rows: a middle track as large as its items, and the two
 * outer ones sharing the rest equally — so the middles stay centred while there is room — but
 * never smaller than their items, so a corner that needs more pushes the middle aside instead
 * of running over it.
 */
export const OVERLAY_GRID_TRACKS = 'minmax(auto, 1fr) auto minmax(auto, 1fr)';

/** Where an anchor's stack sits between an `Overlay`'s docks, and how it lines up there. */
export type OverlayCell = {
  /** 1 the left column, 2 the middle, 3 the right */
  column: 1 | 2 | 3;
  /** in its column: 1 the top, 2 the middle, 3 the bottom */
  gridRow: 1 | 2 | 3;
  justifySelf: 'start' | 'center' | 'end';
  alignSelf: 'start' | 'center' | 'end';
};

const SELF = ['start', 'center', 'end'] as const;

/**
 * Where an anchor's stack sits between an `Overlay`'s docks: in one of three columns side by
 * side — the left corners and the middle of the left edge in the first, the middles of the
 * top and bottom edges in the second, the right ones in the third — and in one of three rows
 * of its column, lined up against the edges it is anchored to and centred along the others.
 * The columns do not overlap, nor the rows of a column, so no two stacks ever do; and only the
 * stacks of one column push each other up and down.
 */
export function overlayCell(anchor: Anchor): OverlayCell {
  const gridRow = anchor.startsWith('top')
    ? 1
    : anchor.startsWith('bottom')
      ? 3
      : 2;
  const column =
    anchor.endsWith('left') || anchor === 'left-center'
      ? 1
      : anchor.endsWith('right') || anchor === 'right-center'
        ? 3
        : 2;
  return {
    column,
    gridRow,
    justifySelf: SELF[column - 1],
    alignSelf: SELF[gridRow - 1],
  };
}
