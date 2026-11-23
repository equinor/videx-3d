import { describe, expect, it } from 'vitest';
import {
  tileAddress,
  tileChildren,
  tileColumn,
  tileDepth,
  tileKey,
  tileNearestIn,
  tileParent,
  tileRow,
} from '../src/sdk/tiles/tile-keys';

describe('tile key parts', () => {
  const cases = [
    [0, 0, 0],
    [3, -5, 7],
    [19, 2 ** 19 - 1, -(2 ** 19)],
    [31, 2 ** 23 - 1, -(2 ** 23)],
  ];

  it('read a key as its address does, either side of the origin and at the deepest', () => {
    for (const [depth, i, j] of cases) {
      const key = tileKey(depth, i, j);
      expect([tileDepth(key), tileColumn(key), tileRow(key)]).toEqual(
        tileAddress(key),
      );
    }
  });

  it('is held by its parent, as one of its children', () => {
    for (const [depth, i, j] of cases.filter(([d]) => d > 0)) {
      const key = tileKey(depth, i, j);
      const parent = tileParent(key);
      expect(tileAddress(parent)).toEqual([
        depth - 1,
        Math.floor(i / 2),
        Math.floor(j / 2),
      ]);
      expect(tileChildren(parent)).toContain(key);
    }
  });
});

describe('tileNearestIn', () => {
  const deep = tileKey(4, 9, 6);
  const parent = tileKey(3, 4, 3);
  const root = tileKey(0, 0, 0);

  it('is the tile itself when it is in', () => {
    const isIn = (key: number) => key === deep || key === parent;
    expect(tileNearestIn(deep, isIn)).toBe(deep);
  });

  it('is the nearest tile above that is in: the tile only sharpens it', () => {
    const isIn = (key: number) => key === parent || key === root;
    expect(tileNearestIn(deep, isIn)).toBe(parent);
    expect(tileNearestIn(deep, key => key === root)).toBe(root);
  });

  it('is null where nothing over it is in: a hole', () => {
    // A tile beside it, and one below it, cover nothing of it.
    const isIn = (key: number) =>
      key === tileKey(4, 8, 6) || key === tileKey(5, 18, 12);
    expect(tileNearestIn(deep, isIn)).toBeNull();
    expect(tileNearestIn(root, () => false)).toBeNull();
  });
});
