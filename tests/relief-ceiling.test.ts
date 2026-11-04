import { describe, expect, it } from 'vitest';
import {
  reliefCeiling,
  reliefCeilingAround,
} from '../src/components/Layers/relief-ceiling';
import { geoTileKeyAt } from '../src/sdk/tiles/geo-tile-keys';
import { tileAddress } from '../src/sdk/tiles/tile-keys';

// A relief with ground over these tiles alone: each key's range, low and high.
const relief = (ranges: Map<number, [number, number]>) => (key: number) =>
  ranges.get(key) ?? null;

describe('reliefCeiling', () => {
  it('takes the highest of the tiles as large as the box that cover it', () => {
    // A box 1° across: depth 7 (1.41° a tile), its corners in two tiles east–west.
    const west = geoTileKeyAt(7, 2.5, 60.5);
    const east = geoTileKeyAt(7, 3.5, 60.5);
    expect(west).not.toBe(east);
    const rangeAt = relief(
      new Map([
        [west, [-50, 400]],
        [east, [-80, 1200]],
      ]),
    );
    expect(reliefCeiling(rangeAt, 2.5, 60.2, 3.5, 60.6)).toBe(1200);
    // Over the western tile alone.
    expect(reliefCeiling(rangeAt, 2.6, 60.2, 2.7, 60.3)).toBe(null);
  });

  it('is null where no relief is in', () => {
    expect(reliefCeiling(() => null, 0, 0, 1, 1)).toBe(null);
  });

  it('reaches as many metres about a point, wider in longitude toward the poles', () => {
    const depths = (latitude: number) => {
      const found = new Set<number>();
      reliefCeilingAround(
        key => {
          found.add(tileAddress(key)[0]);
          return [0, 10];
        },
        0,
        latitude,
        111195,
      );
      return [...found];
    };
    // A degree either way at the equator, 2° across: depth 6 (2.8° a tile).
    expect(depths(0)).toEqual([6]);
    // At 60° twice as wide in longitude, 4° across: depth 5 (5.6° a tile).
    expect(depths(60)).toEqual([5]);
  });
});
