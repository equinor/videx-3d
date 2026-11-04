import { describe, expect, it } from 'vitest';
import {
  anchorGrowth,
  anchorStack,
  anchorStyle,
  resolveAnchorLayout,
  type AnchorPlacement,
} from '../src/common/anchor';
import {
  panelHandleCursor,
  panelHandles,
  resizePanel,
} from '../src/components/Html/Panel/panel-resize';
import { overlayCell } from '../src/components/Html/Overlay/overlay-layout';
import { ANCHORS } from '../src/common/anchor';
import {
  altitudeControlTravel,
  resolveAltitudeControl,
} from '../src/components/Html/AltitudeControl/altitude-control';

type Item = 'a' | 'b' | 'c';
const DEFAULTS: Record<Item, Required<AnchorPlacement>> = {
  a: { anchor: 'top-left', direction: 'column', order: 0 },
  b: { anchor: 'top-right', direction: 'column', order: 0 },
  c: { anchor: 'bottom-right', direction: 'column', order: 1 },
};

describe('resolveAnchorLayout', () => {
  it('puts each item at its default anchor, and leaves out what is not shown', () => {
    const groups = resolveAnchorLayout(['a', 'b'], DEFAULTS);
    expect(groups.get('top-left')?.map(g => g.item)).toEqual(['a']);
    expect(groups.get('top-right')?.map(g => g.item)).toEqual(['b']);
    expect(groups.has('bottom-right')).toBe(false);
  });

  it('moves an item to another anchor and flows it as asked', () => {
    const groups = resolveAnchorLayout(['a', 'b', 'c'], DEFAULTS, {
      b: { anchor: 'bottom-right', direction: 'row' },
    });
    expect(groups.has('top-right')).toBe(false);
    expect(groups.get('bottom-right')).toEqual([
      { item: 'b', direction: 'row' },
      { item: 'c', direction: 'column' },
    ]);
  });

  it('stacks by order, nearest the edge first, and keeps the given order for equal orders', () => {
    const groups = resolveAnchorLayout(['a', 'b', 'c'], DEFAULTS, {
      b: { anchor: 'top-left', order: -1 },
      c: { anchor: 'top-left', order: 0 },
    });
    expect(groups.get('top-left')?.map(g => g.item)).toEqual(['b', 'a', 'c']);
  });
});

describe('anchorStyle', () => {
  it('places corners in from both edges, and middles in from theirs', () => {
    expect(anchorStyle('bottom-right', 6)).toEqual({
      right: '6px',
      bottom: '6px',
    });
    expect(anchorStyle('left-center', 6)).toEqual({
      left: '6px',
      top: '50%',
      transform: 'translateY(-50%)',
    });
    expect(anchorStyle('top-center', 4)).toEqual({
      top: '4px',
      left: '50%',
      transform: 'translateX(-50%)',
    });
  });
});

describe('anchorStack', () => {
  it('puts the first item nearest the edge', () => {
    expect(anchorStack('top-left', 'column').flexDirection).toBe('column');
    expect(anchorStack('bottom-left', 'column').flexDirection).toBe(
      'column-reverse',
    );
    expect(anchorStack('top-right', 'row').flexDirection).toBe('row-reverse');
    expect(anchorStack('bottom-center', 'row').flexDirection).toBe('row');
  });

  it('lines items up with the edge they sit against', () => {
    expect(anchorStack('top-right', 'column').alignItems).toBe('flex-end');
    expect(anchorStack('top-center', 'column').alignItems).toBe('center');
    expect(anchorStack('bottom-left', 'row').alignItems).toBe('flex-end');
    expect(anchorStack('left-center', 'row').alignItems).toBe('center');
  });
});

describe('anchorGrowth', () => {
  it('grows away from the anchored sides, and about a middle both ways', () => {
    expect(anchorGrowth('bottom-right')).toEqual({ x: 'start', y: 'start' });
    expect(anchorGrowth('top-left')).toEqual({ x: 'end', y: 'end' });
    expect(anchorGrowth('top-center')).toEqual({ x: 'both', y: 'end' });
    expect(anchorGrowth('right-center')).toEqual({ x: 'start', y: 'both' });
  });
});

describe('panelHandles', () => {
  it('has handles on the edges away from a corner, and the corner between them', () => {
    expect(panelHandles('bottom-right')).toEqual([
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: -1 },
    ]);
  });

  it('has both edges about a middle anchor', () => {
    const handles = panelHandles('left-center');
    expect(handles).toContainEqual({ x: 1, y: 0 });
    expect(handles).toContainEqual({ x: 0, y: -1 });
    expect(handles).toContainEqual({ x: 0, y: 1 });
    expect(handles).toHaveLength(5);
  });

  it('has a sidebar resized by its inner edge alone', () => {
    expect(panelHandles('left')).toEqual([{ x: 1, y: 0 }]);
    expect(panelHandles('right')).toEqual([{ x: -1, y: 0 }]);
  });

  it('shows the cursor of the way it moves', () => {
    expect(panelHandleCursor({ x: -1, y: 0 })).toBe('ew-resize');
    expect(panelHandleCursor({ x: 0, y: 1 })).toBe('ns-resize');
    expect(panelHandleCursor({ x: -1, y: -1 })).toBe('nwse-resize');
    expect(panelHandleCursor({ x: 1, y: -1 })).toBe('nesw-resize');
  });
});

describe('resizePanel', () => {
  it('grows as an edge is dragged outward', () => {
    // The left edge dragged 50 px left, the top 20 px up.
    expect(
      resizePanel([200, 200], [-50, -20], { x: -1, y: -1 }, [false, false]),
    ).toEqual([250, 220]);
    // The right edge dragged left: smaller.
    expect(
      resizePanel([200, 200], [-50, 30], { x: 1, y: 0 }, [false, false]),
    ).toEqual([150, 200]);
  });

  it('grows on both sides about a middle anchor', () => {
    expect(
      resizePanel([200, 200], [10, 0], { x: 1, y: 0 }, [true, false]),
    ).toEqual([220, 200]);
  });

  it('keeps to its limits', () => {
    const limits = { minWidth: 150, maxWidth: 300, minHeight: 100 };
    expect(
      resizePanel(
        [200, 200],
        [-500, 500],
        { x: 1, y: -1 },
        [false, false],
        limits,
      ),
    ).toEqual([150, 100]);
    expect(
      resizePanel([200, 200], [500, 0], { x: 1, y: 0 }, [false, false], limits),
    ).toEqual([300, 200]);
  });

  it('keeps the minimum where the room is less than it', () => {
    expect(
      resizePanel([200, 200], [500, 0], { x: 1, y: 0 }, [false, false], {
        minWidth: 150,
        maxWidth: 100,
      }),
    ).toEqual([150, 200]);
  });
});

describe('overlayCell', () => {
  it('puts each anchor in its own column and row, lined up with the edges it sits against', () => {
    expect(overlayCell('top-left')).toEqual({
      column: 1,
      gridRow: 1,
      justifySelf: 'start',
      alignSelf: 'start',
    });
    expect(overlayCell('left-center')).toEqual({
      column: 1,
      gridRow: 2,
      justifySelf: 'start',
      alignSelf: 'center',
    });
    expect(overlayCell('bottom-center')).toEqual({
      column: 2,
      gridRow: 3,
      justifySelf: 'center',
      alignSelf: 'end',
    });
    expect(overlayCell('right-center')).toEqual({
      column: 3,
      gridRow: 2,
      justifySelf: 'end',
      alignSelf: 'center',
    });
  });

  it('gives no two anchors the same cell, and leaves the middle of the middle column empty', () => {
    const cells = ANCHORS.map(anchor => {
      const { column, gridRow } = overlayCell(anchor);
      return `${column}:${gridRow}`;
    });
    expect(new Set(cells).size).toBe(ANCHORS.length);
    expect(cells).not.toContain('2:2');
  });
});

describe('resolveAltitudeControl', () => {
  it('has defaults: the sea’s 5 km below to 50 km above, 100 m/s, doubling every second up to 200 times', () => {
    expect(resolveAltitudeControl()).toEqual({
      min: -5000,
      max: 50000,
      maxSpeed: 100,
      boost: 200,
      boostTime: 1,
      dragRange: 100,
      color: '#ffffff',
    });
  });

  it('takes what it is given, and keeps the range, the boost and the travel usable', () => {
    const t = resolveAltitudeControl({
      min: 0,
      max: -10,
      dragRange: 2,
      boost: 0.2,
      boostTime: 0,
      maxSpeed: 30,
    });
    expect(t.max).toBeGreaterThan(t.min);
    expect(t.dragRange).toBeGreaterThanOrEqual(10);
    expect(t.boost).toBe(1);
    expect(t.boostTime).toBeGreaterThan(0);
    expect(t.maxSpeed).toBe(30);
  });
});

describe('altitudeControlTravel', () => {
  it('is the drag range in a view tall enough for it', () => {
    expect(altitudeControlTravel(100, 600)).toBe(100);
    expect(altitudeControlTravel(60, 600)).toBe(60);
  });

  it('is a sixth of a shorter view, but never to nothing', () => {
    expect(altitudeControlTravel(100, 300)).toBe(50);
    expect(altitudeControlTravel(100, 60)).toBe(12);
  });
});
