import { describe, expect, it } from 'vitest';
import { gridToRelief } from '../src/sdk/data/relief/grid-to-relief';
import { reliefWindow } from '../src/sdk/data/relief/relief-window';
import type {
  ReliefData,
  ReliefWindow,
} from '../src/sdk/data/types/ReliefMeta';
import {
  buildReliefTile,
  ReliefReader,
  reliefTileHeightAt,
  ReliefTileSource,
  sampleReliefSource,
} from '../src/sdk/geometries/relief-tiles';
import { tileKey } from '../src/sdk/tiles/tile-keys';

const UTM = '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs';
// Roots 51.2 km wide: a depth-4 tile is 3200 m, 100 m a cell.
const ROOT = 51200;
const CELLS = 32;

// A grid of `cell` metres over map X -1000..4900 and Y -5000..900 (scene Z = -Y), its
// height `height(x, y)`, NaN outside `inside`.
function grid(
  id: string,
  height: (x: number, y: number) => number,
  cell = 100,
  inside: (x: number, y: number) => boolean = () => true,
): ReliefData {
  const nx = Math.round(5900 / cell) + 1;
  const ny = Math.round(5900 / cell) + 1;
  const values = new Float32Array(nx * ny);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const x = -1000 + col * cell;
      const y = -5000 + (ny - 1 - row) * cell;
      values[row * nx + col] = inside(x, y) ? height(x, y) : NaN;
    }
  }
  return gridToRelief(
    {
      values,
      size: [nx, ny],
      origin: [-1000, -5000],
      cell: [cell, cell],
      crs: UTM,
    },
    { id, name: id },
  );
}

function storeOf(...reliefs: ReliefData[]) {
  const calls: { id: string; window?: ReliefWindow }[] = [];
  const read = async (dataType: string, id: string, window?: ReliefWindow) => {
    const relief = reliefs.find(r => r.meta.id === id);
    if (!relief) return null;
    if (dataType === 'relief-meta') return relief.meta;
    calls.push({ id, window });
    return reliefWindow(relief, window!);
  };
  return { reader: new ReliefReader(read), calls };
}

const frame = { projection: UTM, origin: [0, 0] as [number, number] };
const source = (
  layers: ReliefTileSource['layers'],
  base = -120,
): ReliefTileSource => ({ frame, layers, base });

// Height at tile node (u, v) of a tile at the origin with cells `cell` wide.
const nodeAt = (tile: { heights: Float32Array }, u: number, v: number) =>
  tile.heights[v * (CELLS + 3) + u];

describe('buildReliefTile', () => {
  it('reads a layer onto the tile, its border included', async () => {
    // A plane: in the scene (Z = -Y) it rises 0.01 a metre east and 0.02 south.
    const { reader } = storeOf(grid('plane', (x, y) => 0.01 * x - 0.02 * y));
    const tile = await buildReliefTile(
      reader,
      source([{ id: 'plane' }]),
      tileKey(4, 0, 0),
      CELLS,
      ROOT,
    );
    for (const [u, v] of [
      [0, 0],
      [1, 1],
      [17, 9],
      [CELLS + 2, CELLS + 2],
    ]) {
      const x = (u - 1) * 100;
      const z = (v - 1) * 100;
      expect(nodeAt(tile, u, v)).toBeCloseTo(0.01 * x + 0.02 * z, 3);
    }
    expect(tile.min).toBeCloseTo(0, 3);
    expect(tile.max).toBeCloseTo(0.03 * 3200, 3);
    // A plane is drawn exactly by any triangles.
    expect(tile.error).toBeLessThan(1e-3);
    expect(tile.layers.every(id => id === 1)).toBe(true);
    // As fine as the data: nothing finer to split for.
    expect(tile.leaf).toBe(true);

    // Read back anywhere on it, between its nodes too, and clamped at its edges.
    for (const [x, z] of [
      [0, 0],
      [1234.5, 2750.25],
      [3200, 3200],
      [55, 3199],
    ]) {
      expect(reliefTileHeightAt(tile, x, z, ROOT)).toBeCloseTo(
        0.01 * x + 0.02 * z,
        3,
      );
    }
    expect(reliefTileHeightAt(tile, -500, 4000, ROOT)).toBeCloseTo(
      0.02 * 3200,
      3,
    );
  });

  it('is the flat base where no layer has data, and never split', async () => {
    const { reader } = storeOf();
    const tile = await buildReliefTile(
      reader,
      source([{ id: 'missing' }], -95),
      tileKey(4, 0, 0),
      CELLS,
      ROOT,
    );
    expect(tile.heights.every(h => h === -95)).toBe(true);
    expect(tile.min).toBe(-95);
    expect(tile.max).toBe(-95);
    expect(tile.error).toBe(0);
    expect(tile.leaf).toBe(true);
    expect(tile.layers.every(id => id === 0)).toBe(true);
  });

  it('reads the coarsest level no coarser than its cells', async () => {
    const { reader, calls } = storeOf(grid('plane', () => -50));
    const coarse = await buildReliefTile(
      reader,
      source([{ id: 'plane' }]),
      // 800 m cells over 100 m data: level 3, and level 2 for its half-cell points.
      tileKey(1, 0, 0),
      CELLS,
      ROOT,
    );
    const levels = new Set(calls.map(call => call.window!.level));
    expect(levels.has(3)).toBe(true);
    expect(levels.has(2)).toBe(true);
    // Level 0 only once, whole: where the layer's distance to its edge is measured.
    expect(calls.filter(call => call.window!.level === 0).length).toBe(1);
    expect(coarse.leaf).toBe(false);
    // Every request is a block.
    for (const { window } of calls) {
      expect(window!.count).toEqual([128, 128]);
      expect(window!.first[0] % 128).toBe(0);
      expect(window!.first[1] % 128).toBe(0);
    }
  });

  it('lets a later layer win where it has data, faded in over its feather', async () => {
    // A wide layer at -100 and, over X 1000–4900, Y -5000 to -1000, a finer one at -50.
    const { reader } = storeOf(
      grid('wide', () => -100),
      grid(
        'near',
        () => -50,
        50,
        (x, y) => x >= 1000 && y <= -1000,
      ),
    );
    const tile = await buildReliefTile(
      reader,
      source([{ id: 'wide' }, { id: 'near', feather: 500 }]),
      tileKey(4, 0, 0),
      CELLS,
      ROOT,
    );
    // Scene X 200, Z 200: outside the near layer.
    expect(nodeAt(tile, 3, 3)).toBeCloseTo(-100, 3);
    // Scene X 2500, Z 2500: 1500 m inside it, past the feather.
    expect(nodeAt(tile, 26, 26)).toBeCloseTo(-50, 3);
    expect(tile.layers[26 * (CELLS + 3) + 26]).toBe(2);
    // Scene X 1200, Z 2500: 200 m inside it, part way.
    const between = nodeAt(tile, 13, 26);
    expect(between).toBeGreaterThan(-100);
    expect(between).toBeLessThan(-50);
    // A finer layer under the tile lets it split.
    expect(tile.leaf).toBe(false);
  });

  it('measures how far its triangles stray from the data', async () => {
    const bump = (x: number, y: number) =>
      -100 + 30 * Math.exp(-((x - 1600) ** 2 + (y + 1600) ** 2) / 300 ** 2);
    const { reader } = storeOf(grid('bump', bump, 25));
    const coarse = await buildReliefTile(
      reader,
      source([{ id: 'bump' }]),
      tileKey(4, 0, 0),
      CELLS,
      ROOT,
    );
    const fine = await buildReliefTile(
      reader,
      source([{ id: 'bump' }]),
      tileKey(6, 1, 1),
      CELLS,
      ROOT,
    );
    expect(coarse.error).toBeGreaterThan(0.5);
    expect(fine.error).toBeLessThan(coarse.error);
    expect(coarse.max).toBeGreaterThan(-75);
  });

  it('counts the detail of a layer too small for its own cells to see', async () => {
    // A hill 50 m wide in a 1 km patch, over a flat seabed: averaged away at a root's
    // 1.6 km cells, yet 30 m tall.
    const patch = grid(
      'patch',
      (x, y) =>
        -100 + 30 * Math.exp(-((x - 1000) ** 2 + (y + 1000) ** 2) / 50 ** 2),
      10,
      (x, y) => x >= 500 && x <= 1500 && y >= -1500 && y <= -500,
    );
    const { reader } = storeOf(
      grid('flat', () => -100),
      patch,
    );
    const layers = [{ id: 'flat' }, { id: 'patch' }];
    const root = await buildReliefTile(
      reader,
      source(layers, -100),
      tileKey(0, 0, 0),
      CELLS,
      ROOT,
    );
    expect(root.max).toBeLessThan(-95);
    expect(root.error).toBeGreaterThan(25);
    // Without the patch the root is as flat as its data, and the base under it.
    const plain = await buildReliefTile(
      reader,
      source([{ id: 'flat' }], -100),
      tileKey(0, 0, 0),
      CELLS,
      ROOT,
    );
    expect(plain.error).toBeLessThan(0.01);
  });
});

describe('sampleReliefSource', () => {
  it('reads a relief onto any grid, rotated too', async () => {
    const { reader } = storeOf(grid('plane', (x, y) => 0.01 * x - 0.02 * y));
    // 30° from scene X, 40 m along the columns and 60 m along the rows.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const origin: [number, number] = [500, 400];
    const u: [number, number] = [40 * c, 40 * s];
    const v: [number, number] = [-60 * s, 60 * c];
    const heights = await sampleReliefSource(
      reader,
      source([{ id: 'plane' }]),
      { origin, u, v, size: [21, 13] },
    );
    expect(heights.length).toBe(21 * 13);
    for (const [col, row] of [
      [0, 0],
      [20, 0],
      [7, 5],
      [20, 12],
    ]) {
      const x = origin[0] + col * u[0] + row * v[0];
      const z = origin[1] + col * u[1] + row * v[1];
      expect(heights[row * 21 + col]).toBeCloseTo(0.01 * x + 0.02 * z, 3);
    }
  });

  it('merges as the tiles do', async () => {
    const reliefs = [
      grid('wide', () => -100),
      grid(
        'near',
        () => -50,
        50,
        (x, y) => x >= 1000 && y <= -1000,
      ),
    ];
    const layers = [{ id: 'wide' }, { id: 'near', feather: 500 }];
    const tile = await buildReliefTile(
      storeOf(...reliefs).reader,
      source(layers),
      tileKey(4, 0, 0),
      CELLS,
      ROOT,
    );
    // The tile's nodes, its border included: 100 m apart from (-100, -100).
    const heights = await sampleReliefSource(
      storeOf(...reliefs).reader,
      source(layers),
      { origin: [-100, -100], u: [100, 0], v: [0, 100], size: [35, 35] },
    );
    expect(Array.from(heights)).toEqual(Array.from(tile.heights));
  });

  it('is the base where no layer has data', async () => {
    const heights = await sampleReliefSource(
      storeOf().reader,
      source([{ id: 'missing' }], -80),
      { origin: [0, 0], u: [10, 0], v: [0, 10], size: [4, 3] },
    );
    expect(Array.from(heights)).toEqual(new Array(12).fill(-80));
  });

  it('reads a single point, a row and a column: a route', async () => {
    const plane = (x: number, z: number) => 0.01 * x + 0.02 * z;
    const { reader } = storeOf(grid('plane', (x, y) => 0.01 * x - 0.02 * y));
    for (const size of [
      [1, 1],
      [5, 1],
      [1, 5],
    ] as [number, number][]) {
      const heights = await sampleReliefSource(
        reader,
        source([{ id: 'plane' }]),
        { origin: [500, 400], u: [30, 10], v: [-10, 30], size },
      );
      for (let row = 0; row < size[1]; row++) {
        for (let col = 0; col < size[0]; col++) {
          const x = 500 + col * 30 - row * 10;
          const z = 400 + col * 10 + row * 30;
          expect(heights[row * size[0] + col]).toBeCloseTo(plane(x, z), 3);
        }
      }
    }
  });
});
