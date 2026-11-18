import { describe, expect, it } from 'vitest';
import { tileKey, tileNearestIn } from '../src/sdk/tiles/tile-keys';

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
