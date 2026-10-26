import { describe, expect, it } from 'vitest';
import { gridToRelief } from '../src/sdk/data/relief/grid-to-relief';
import {
  reliefLevel,
  reliefLevelSize,
  reliefLevelToNode,
  reliefMapToNode,
  reliefNodeToLevel,
  reliefNodeToMap,
  reliefWindow,
} from '../src/sdk/data/relief/relief-window';
import type { ReliefData } from '../src/sdk/data/types/ReliefMeta';

// A grid whose value at node (col, row) is `col + 100 * row`, the northern row first.
function indexGrid(nx: number, ny: number): ReliefData {
  const values = new Float32Array(nx * ny);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) values[row * nx + col] = col + 100 * row;
  }
  return gridToRelief(
    { values, size: [nx, ny], origin: [0, 0], cell: [1, 1], crs: 'EPSG:4326' },
    { id: 'grid', name: 'grid' },
  );
}

describe('gridToRelief', () => {
  it('puts the northern row first, scales, shifts and drops no-data values', () => {
    // Rows from the south: 1 2 / 3 -9999; a depth grid (scale -1) on a datum 2 m off.
    const relief = gridToRelief(
      {
        values: [1, 2, 3, -9999],
        size: [2, 2],
        origin: [10, 20],
        cell: [0.5, 0.25],
        crs: 'EPSG:4326',
        rows: 'south',
      },
      { id: 'r', name: 'R', noData: -9999, scale: -1, offset: 2 },
    );
    expect(Array.from(relief.values)).toEqual([-1, NaN, 1, 0]);
    expect(relief.meta.min).toBe(-1);
    expect(relief.meta.max).toBe(1);
    expect(relief.meta.grid).toEqual({
      origin: [10, 20],
      cell: [0.5, 0.25],
      size: [2, 2],
    });
  });

  it('takes a test for no data, and drops values that are not finite', () => {
    const relief = gridToRelief(
      {
        values: [5, Infinity, NaN, 1e31],
        size: [4, 1],
        origin: [0, 0],
        cell: [1, 1],
        crs: 'x',
      },
      { id: 'r', name: 'R', noData: value => value > 1e30 },
    );
    expect(Array.from(relief.values)).toEqual([5, NaN, NaN, NaN]);
  });

  it('refuses values that do not fill the grid', () => {
    expect(() =>
      gridToRelief(
        {
          values: [1, 2, 3],
          size: [2, 2],
          origin: [0, 0],
          cell: [1, 1],
          crs: 'x',
        },
        { id: 'r', name: 'R' },
      ),
    ).toThrow('gridToRelief: 3 values for a 2 x 2 grid');
  });
});

describe('reliefLevel', () => {
  it('averages 2 x 2 of the level below, keeping partial blocks at the edges', () => {
    const relief = indexGrid(5, 3);
    expect(reliefLevelSize(relief.meta, 1)).toEqual([3, 2]);
    const level = reliefLevel(relief, 1);
    // Block (0, 0): nodes (0,0) (1,0) (0,1) (1,1) = 0 1 100 101.
    expect(level[0]).toBe(50.5);
    // Block (2, 0): column 4 alone, rows 0 and 1.
    expect(level[2]).toBe(54);
    // Block (0, 1): row 2 alone.
    expect(level[3]).toBe(200.5);
    // Block (2, 1): node (4, 2) alone.
    expect(level[5]).toBe(204);
  });

  it('averages only what holds data, and is NaN where nothing does', () => {
    const relief = gridToRelief(
      {
        values: [NaN, 4, NaN, NaN, NaN, NaN, NaN, NaN],
        size: [4, 2],
        origin: [0, 0],
        cell: [1, 1],
        crs: 'x',
      },
      { id: 'r', name: 'R' },
    );
    expect(Array.from(reliefLevel(relief, 1))).toEqual([4, NaN]);
  });

  it('builds each level once, and keeps it with the values', () => {
    const relief = indexGrid(8, 8);
    const first = reliefLevel(relief, 3);
    expect(first.length).toBe(1);
    expect(reliefLevel(relief, 3)).toBe(first);
    expect(reliefLevel(relief, 2)).toBe(reliefLevel(relief, 2));
    expect(reliefLevel(relief, 0)).toBe(relief.values);
  });
});

describe('reliefWindow', () => {
  it('cuts a window of a level, NaN past its edges', () => {
    const relief = indexGrid(4, 3);
    const window = reliefWindow(relief, {
      level: 0,
      first: [2, 1],
      count: [3, 3],
    });
    expect(Array.from(window)).toEqual([
      102,
      103,
      NaN,
      202,
      203,
      NaN,
      NaN,
      NaN,
      NaN,
    ]);
  });

  it('is all NaN wholly off the grid', () => {
    const relief = indexGrid(4, 4);
    const window = reliefWindow(relief, {
      level: 1,
      first: [-4, 0],
      count: [2, 2],
    });
    expect(Array.from(window).every(Number.isNaN)).toBe(true);
  });

  it('reads a coarser level', () => {
    const relief = indexGrid(4, 4);
    const window = reliefWindow(relief, {
      level: 1,
      first: [0, 0],
      count: [2, 2],
    });
    expect(Array.from(window)).toEqual([50.5, 52.5, 250.5, 252.5]);
  });
});

describe('relief grid coordinates', () => {
  it('places a level value at the centre of its block', () => {
    expect(reliefLevelToNode(2, 1, 0)).toEqual([5.5, 1.5]);
    expect(reliefNodeToLevel(2, 5.5, 1.5)).toEqual([1, 0]);
    expect(reliefLevelToNode(0, 3, 4)).toEqual([3, 4]);
  });

  it('maps nodes to the map and back, rows from the north, rotated', () => {
    const relief = gridToRelief(
      {
        values: new Float32Array(12),
        size: [4, 3],
        origin: [100, 200],
        cell: [10, 20],
        crs: 'x',
        rotation: 90,
      },
      { id: 'r', name: 'R' },
    );
    // The north-west node: 2 rows of 20 up from the origin, turned 90° counter-clockwise.
    const [x, y] = reliefNodeToMap(relief.meta, 0, 0);
    expect(x).toBeCloseTo(60);
    expect(y).toBeCloseTo(200);
    // The south-east node: 3 columns of 10 along X, turned onto Y.
    const [ex, ey] = reliefNodeToMap(relief.meta, 3, 2);
    expect(ex).toBeCloseTo(100);
    expect(ey).toBeCloseTo(230);
    const [col, row] = reliefMapToNode(relief.meta, 73, 214);
    const [bx, by] = reliefNodeToMap(relief.meta, col, row);
    expect(bx).toBeCloseTo(73);
    expect(by).toBeCloseTo(214);
  });
});
