import { describe, expect, it } from 'vitest';
import {
  geoTileKeyAt,
  geoTileRegion,
  geoTileSquareFrom,
} from '../src/sdk/tiles/geo-tile-keys';
import {
  geoTileCountOver,
  geoTileDepthFor,
  selectGeoMapTiles,
} from '../src/sdk/tiles/geo-tile-select';
import { tileAddress, tileParent } from '../src/sdk/tiles/tile-keys';

const depthOf = (key: number) => tileAddress(key)[0];

// Every tile from the roots down to `depth` over the globe is in, as a leaf at `leafAt`.
function allIn(depth: number, leafAt = Infinity) {
  return (key: number) => {
    const d = depthOf(key);
    return d <= depth ? { leaf: d >= leafAt } : undefined;
  };
}

describe('geoTileSquareFrom', () => {
  it('is the tile square relative to the point', () => {
    const key = geoTileKeyAt(10, 2.5, 58.4);
    const [west, north, span] = geoTileRegion(key);
    const [x, z, width] = geoTileSquareFrom(key, 2.5, 58.4);
    expect(width).toBe(span);
    expect(x).toBeCloseTo(west - 2.5, 12);
    expect(z).toBeCloseTo(58.4 - north, 12);
    expect(x).toBeLessThanOrEqual(0);
    expect(x + width).toBeGreaterThan(0);
    expect(z).toBeLessThanOrEqual(0);
    expect(z + width).toBeGreaterThan(0);
  });

  it('takes a tile across the antimeridian the short way round', () => {
    // The tile east of 180°W, seen from 179.9°E: just east of the point.
    const key = geoTileKeyAt(8, -179.95, 10);
    const [x] = geoTileSquareFrom(key, 179.9, 10);
    expect(x).toBeCloseTo(0.1, 9);
    // A root about the point covers it on either side.
    const root = geoTileKeyAt(0, -90, 0);
    const [rx, , rw] = geoTileSquareFrom(root, 10, 0);
    expect(rx).toBeCloseTo(-190, 9);
    expect(rx + rw).toBeCloseTo(-10, 9);
  });
});

describe('geoTileDepthFor', () => {
  it('chooses the shallowest depth whose cells are no taller than asked', () => {
    const depth = geoTileDepthFor(100, 32);
    const cellAt = (d: number) =>
      ((180 / 2 ** d / 32) * Math.PI * 6371008.8) / 180;
    expect(cellAt(depth)).toBeLessThanOrEqual(100);
    expect(cellAt(depth - 1)).toBeGreaterThan(100);
  });

  it('is clamped', () => {
    expect(geoTileDepthFor(1e9, 32)).toBe(0);
    expect(geoTileDepthFor(1e-6, 32, 19)).toBe(19);
    expect(geoTileDepthFor(0, 32, 19)).toBe(19);
  });

  it('takes the cells narrower toward the poles into account', () => {
    // At 60° a cell is half as wide: its mean size is a level coarser at most.
    const equator = geoTileDepthFor(100, 32);
    const north = geoTileDepthFor(100, 32, 24, 60);
    expect(north).toBeLessThanOrEqual(equator);
    expect(north).toBeGreaterThanOrEqual(equator - 1);
  });
});

describe('geoTileCountOver', () => {
  it('counts the tiles a box touches', () => {
    // Depth 8: 0.703125° tiles. Two columns, one row.
    expect(geoTileCountOver([0.1, 0.1, 1, 0.5], 8)).toBe(2);
    expect(geoTileCountOver([0.1, 0.1, 0.2, 0.2], 8)).toBe(1);
    // Four each way: from -1.40625 to 1.40625.
    expect(geoTileCountOver([-1, -1, 1, 1], 8)).toBe(16);
  });
});

describe('selectGeoMapTiles', () => {
  const bounds: [number, number, number, number] = [2, 58, 3, 59];

  it('wants the roots first, and nothing finer until they are in', () => {
    const selection = selectGeoMapTiles({
      bounds,
      depth: 8,
      info: () => undefined,
    });
    expect(selection.draw).toEqual([]);
    expect(selection.used).toEqual([]);
    expect(selection.want.map(({ key }) => depthOf(key))).toEqual([0]);
  });

  it('draws the wanted depth over the bounds once in', () => {
    const selection = selectGeoMapTiles({ bounds, depth: 8, info: allIn(8) });
    expect(selection.want).toEqual([]);
    expect(selection.draw.length).toBeGreaterThan(0);
    for (const key of selection.draw) {
      expect(depthOf(key)).toBe(8);
      const [west, north, span] = geoTileRegion(key);
      expect(west < 3 && west + span > 2).toBe(true);
      expect(north > 58 && north - span < 59).toBe(true);
    }
    // Every point of the bounds is covered.
    for (const [lon, lat] of [
      [2.01, 58.01],
      [2.99, 58.99],
      [2.5, 58.5],
    ]) {
      expect(selection.draw).toContain(geoTileKeyAt(8, lon, lat));
    }
    // Each ancestor gone through is kept.
    for (const key of selection.draw)
      expect(selection.used).toContain(tileParent(key));
  });

  it('stands an ancestor in for tiles not yet in, under the finer ones', () => {
    // Depth 7 is in; of depth 8, only the tile at one corner.
    const corner = geoTileKeyAt(8, 2.01, 58.99);
    const selection = selectGeoMapTiles({
      bounds,
      depth: 8,
      info: key => {
        const d = depthOf(key);
        if (d <= 7 || key === corner) return { leaf: false };
        return undefined;
      },
    });
    expect(selection.draw[0]).toBe(corner);
    const standIns = selection.draw.slice(1);
    expect(standIns.length).toBeGreaterThan(0);
    for (const key of standIns) expect(depthOf(key)).toBe(7);
    expect(selection.want.length).toBeGreaterThan(0);
    for (const { key } of selection.want) expect(depthOf(key)).toBe(8);
    expect(selection.want.map(({ key }) => key)).not.toContain(corner);
  });

  it('stops at a leaf', () => {
    const selection = selectGeoMapTiles({
      bounds,
      depth: 12,
      info: allIn(12, 5),
    });
    expect(selection.want).toEqual([]);
    for (const key of selection.draw) expect(depthOf(key)).toBe(5);
  });

  it('goes on past a leaf as far as asked, no deeper than the depth', () => {
    const past = selectGeoMapTiles({
      bounds,
      depth: 12,
      pastLeaf: 1,
      info: allIn(12, 5),
    });
    for (const key of past.draw) expect(depthOf(key)).toBe(6);
    const capped = selectGeoMapTiles({
      bounds,
      depth: 5,
      pastLeaf: 2,
      info: allIn(12, 5),
    });
    for (const key of capped.draw) expect(depthOf(key)).toBe(5);
  });

  it('takes the depth per tile where asked', () => {
    // Deeper where a tile's north edge lies north of 58.5°.
    const depthAt = (key: number) => (geoTileRegion(key)[1] > 58.5 ? 9 : 7);
    const selection = selectGeoMapTiles({
      bounds,
      depth: 0,
      depthAt,
      info: allIn(9),
    });
    for (const key of selection.draw) {
      expect(depthOf(key)).toBeGreaterThanOrEqual(depthAt(key));
      expect(depthOf(key) - 1).toBeLessThan(depthAt(tileParent(key)));
    }
    expect(new Set(selection.draw.map(depthOf)).size).toBeGreaterThan(1);
  });

  it('wants the coarsest the most', () => {
    const selection = selectGeoMapTiles({
      bounds,
      depth: 10,
      info: key => (depthOf(key) <= 6 ? { leaf: false } : undefined),
    });
    // Only one level is wanted at a time: the one under what is in.
    for (const { key, priority } of selection.want) {
      expect(depthOf(key)).toBe(7);
      expect(priority).toBe(-7);
    }
  });

  it('covers bounds across the antimeridian', () => {
    const selection = selectGeoMapTiles({
      bounds: [179.5, -0.5, 180.5, 0.5],
      depth: 6,
      info: allIn(6),
    });
    expect(selection.draw).toContain(geoTileKeyAt(6, 179.9, 0.1));
    expect(selection.draw).toContain(geoTileKeyAt(6, -179.9, 0.1));
  });
});
