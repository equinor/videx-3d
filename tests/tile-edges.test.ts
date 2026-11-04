import { describe, expect, it } from 'vitest';
import { gridToRelief } from '../src/sdk/data/relief/grid-to-relief';
import { reliefWindow } from '../src/sdk/data/relief/relief-window';
import type {
  ReliefData,
  ReliefWindow,
} from '../src/sdk/data/types/ReliefMeta';
import {
  buildGeoReliefTile,
  ReliefReader,
} from '../src/sdk/geometries/relief-tiles';
import {
  geoTileKeyAt,
  geoTileNeighbour,
  geoTileNeighbours,
} from '../src/sdk/tiles/geo-tile-keys';
import {
  blendTileEdgeHeights,
  TILE_EDGE,
  TILE_EDGE_BAND,
  tileCoarserEdges,
  tileEdgeWeight,
} from '../src/sdk/tiles/tile-edges';
import { tileAddress, tileChildren, tileKey } from '../src/sdk/tiles/tile-keys';

const CELLS = 32;
const NODES = CELLS + 3;

// Bumpy ground in longitude and latitude over 0–6°E, 56–62°N, 0.01° cells: tiles at
// different depths read it differently.
function bumpy(): ReliefData {
  const cell = 0.01;
  const nx = 601;
  const values = new Float32Array(nx * nx);
  for (let row = 0; row < nx; row++) {
    for (let col = 0; col < nx; col++) {
      const lon = col * cell;
      const lat = 56 + (nx - 1 - row) * cell;
      values[row * nx + col] =
        100 * lon +
        40 * Math.sin(lon * 41) * Math.cos(lat * 37) +
        15 * Math.sin(lon * 173 + lat * 151);
    }
  }
  return gridToRelief(
    {
      values,
      size: [nx, nx],
      origin: [0, 56],
      cell: [cell, cell],
      crs: '+proj=longlat +datum=WGS84 +no_defs',
    },
    { id: 'bumpy', name: 'bumpy' },
  );
}

const reader = () => {
  const relief = bumpy();
  return new ReliefReader(
    async (dataType: string, id: string, window?: ReliefWindow) => {
      if (id !== 'bumpy') return null;
      if (dataType === 'relief-meta') return relief.meta;
      return reliefWindow(relief, window!);
    },
  );
};
const SOURCE = { layers: [{ id: 'bumpy' }], base: -120 };

// A tile's own node (column east, row south).
const own = (heights: ArrayLike<number>, column: number, row: number) =>
  heights[(1 + row) * NODES + 1 + column];

describe('geographic tile neighbours', () => {
  it('wraps round the globe in longitude and stops at the poles', () => {
    const depth = 3;
    const east = tileKey(depth, 2 ** (depth + 1) - 1, 2);
    expect(tileAddress(geoTileNeighbour(east, 1, 0)!)).toEqual([depth, 0, 2]);
    expect(tileAddress(geoTileNeighbour(tileKey(depth, 0, 2), -1, 0)!)).toEqual(
      [depth, 2 ** (depth + 1) - 1, 2],
    );
    expect(geoTileNeighbour(tileKey(depth, 4, 0), 0, -1)).toBeNull();
    expect(
      geoTileNeighbour(tileKey(depth, 4, 2 ** depth - 1), 1, 1),
    ).toBeNull();
    // Eight round a tile, five by a pole.
    expect(geoTileNeighbours(tileKey(depth, 4, 3)).length).toBe(8);
    expect(geoTileNeighbours(tileKey(depth, 4, 0)).length).toBe(5);
  });
});

describe('tile edges', () => {
  const parent = geoTileKeyAt(7, 3, 59);
  const coarse = geoTileNeighbour(parent, 1, 0)!;
  const children = tileChildren(parent);
  // Its east half's north child: a coarser tile east of it, and south-east.
  const fine = children[1];
  const depthOf = (key: number) =>
    children.includes(key) ? 8 : key === coarse ? 7 : undefined;

  it('marks the edges and corners a coarser tile touches, and its quarter', () => {
    const mask = tileCoarserEdges(fine, 8, depthOf, geoTileNeighbour);
    expect(mask).toBe(
      TILE_EDGE.east | TILE_EDGE.southEast | TILE_EDGE.oddColumn,
    );
    // Its sibling west of it touches none; south of it, the coarser tile east and north-east.
    expect(tileCoarserEdges(children[0], 8, depthOf, geoTileNeighbour)).toBe(0);
    expect(tileCoarserEdges(children[3], 8, depthOf, geoTileNeighbour)).toBe(
      TILE_EDGE.east |
        TILE_EDGE.northEast |
        TILE_EDGE.oddColumn |
        TILE_EDGE.oddRow,
    );
  });

  it('weighs its parent in from a marked edge or corner, out over a few cells', () => {
    const east = TILE_EDGE.east;
    expect(tileEdgeWeight(east, 1, 0.3, CELLS)).toBe(1);
    expect(tileEdgeWeight(east, 1 - TILE_EDGE_BAND / CELLS, 0.3, CELLS)).toBe(
      0,
    );
    expect(tileEdgeWeight(east, 0.5, 0.3, CELLS)).toBe(0);
    const half = tileEdgeWeight(
      east,
      1 - TILE_EDGE_BAND / 2 / CELLS,
      0.3,
      CELLS,
    );
    expect(half).toBeCloseTo(0.5, 6);
    // From a corner: the larger distance along the axes.
    const corner = TILE_EDGE.southEast;
    expect(tileEdgeWeight(corner, 1, 1, CELLS)).toBe(1);
    expect(tileEdgeWeight(corner, 1, 0.5, CELLS)).toBe(0);
    expect(tileEdgeWeight(0, 1, 1, CELLS)).toBe(0);
    // Two tiles at one depth either side of an edge blend alike along it: the one with a
    // coarser tile west of it, and the one south of it, which that tile's corner touches.
    for (let u = 0; u <= 1; u += 1 / 64)
      expect(tileEdgeWeight(TILE_EDGE.west, u, 1, CELLS)).toBeCloseTo(
        tileEdgeWeight(TILE_EDGE.northWest, u, 0, CELLS),
        12,
      );
  });

  it('meets a coarser neighbour exactly, blended toward its parent', async () => {
    const store = reader();
    const [p, c, f] = await Promise.all(
      [parent, coarse, fine].map(key => buildGeoReliefTile(store, SOURCE, key)),
    );
    // Tiles at one depth meet node for node.
    for (let row = 0; row <= CELLS; row++)
      expect(own(p.heights, CELLS, row)).toBeCloseTo(own(c.heights, 0, row), 4);
    // The coarser tile's west edge, between its nodes, where the finer one's east edge
    // nodes lie (the north half of it).
    const coarseAt = (row: number) => {
      const y = row / 2;
      const j = Math.floor(y);
      const t = y - j;
      const a = own(c.heights, 0, j);
      return t === 0 ? a : a + (own(c.heights, 0, j + 1) - a) * t;
    };
    let before = 0;
    for (let row = 0; row <= CELLS; row++)
      before = Math.max(
        before,
        Math.abs(own(f.heights, CELLS, row) - coarseAt(row)),
      );
    expect(before).toBeGreaterThan(1);
    const mask = tileCoarserEdges(fine, 8, depthOf, geoTileNeighbour);
    const blended = blendTileEdgeHeights(f.heights, p.heights, CELLS, mask);
    for (let row = 0; row <= CELLS; row++)
      expect(own(blended, CELLS, row)).toBeCloseTo(coarseAt(row), 3);
    // Past the band, its own.
    for (let row = 0; row <= CELLS; row++)
      expect(own(blended, CELLS - TILE_EDGE_BAND - 1, row)).toBe(
        own(f.heights, CELLS - TILE_EDGE_BAND - 1, row),
      );
    // Its sibling west of it touches no coarser tile: untouched.
    expect(blendTileEdgeHeights(f.heights, p.heights, CELLS, 0)).toBe(
      f.heights,
    );
  });
});
