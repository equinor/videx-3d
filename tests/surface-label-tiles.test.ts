import { describe, expect, it } from 'vitest';
import { ContourColorMode } from '../src/common/types';
import { resolveSurfaceContours } from '../src/components/Surfaces/surface-contours';
import {
  surfaceLabelTileGround,
  surfaceLabelTileKey,
  surfaceLabelTileLevels,
  surfaceLabelTileOf,
  surfaceLabelTiles,
} from '../src/sdk/geometries/surface-label-tiles';

describe('surface label tiles', () => {
  it('keys a tile one way and back', () => {
    const tile = { level: 3, column: 517, row: 1029 };
    expect(surfaceLabelTileOf(surfaceLabelTileKey(tile))).toEqual(tile);
  });

  it('covers the grid with one tile at its coarsest level', () => {
    expect(surfaceLabelTileLevels(33, 33, 32)).toBe(0);
    expect(surfaceLabelTileLevels(34, 20, 32)).toBe(1);
    expect(surfaceLabelTileLevels(65, 65, 32)).toBe(1);
    expect(surfaceLabelTileLevels(100, 40, 32)).toBe(2);
  });

  it('splits down to the grid’s own nodes, none wholly off it', () => {
    const all = surfaceLabelTiles(100, 40, 32, () => true).map(
      surfaceLabelTileOf,
    );
    // Columns from 0, 32, 64 and 96 (99 the last); rows from 0 and 32 (39 the last).
    expect(all).toHaveLength(8);
    expect(all.every(tile => tile.level === 0)).toBe(true);
    expect(surfaceLabelTiles(100, 40, 32, () => false)).toEqual([
      surfaceLabelTileKey({ level: 2, column: 0, row: 0 }),
    ]);
  });

  it('takes every 2^level-th node, held to the grid, refusing by no data', () => {
    const nx = 10;
    const ny = 8;
    const values = new Float32Array(nx * ny).map(
      (_, i) => (i % nx) + 100 * Math.floor(i / nx),
    );
    // No data at column 6, row 2.
    values[2 * nx + 6] = -1;
    const cells = 2;
    const nodes = cells + 3;
    const key = surfaceLabelTileKey({ level: 1, column: 1, row: 0 });
    const ground = surfaceLabelTileGround(
      values,
      nx,
      ny,
      cells,
      key,
      value => value - 1000,
      value => value >= 0,
    )!;
    // Its own nodes are grid columns 4, 6, 8 and rows 0, 2, 4; its border 2 and 10 (held
    // to 9), -2 (held to 0) and 6.
    const at = (i: number, j: number) => ground.heights[j * nodes + i];
    expect(at(1, 1)).toBe(4 - 1000);
    expect(at(3, 3)).toBe(8 + 400 - 1000);
    expect(at(0, 1)).toBe(2 - 1000);
    expect(at(4, 1)).toBe(9 - 1000);
    expect(at(1, 0)).toBe(4 - 1000);
    const refused = (i: number, j: number) => ground.refused[j * nodes + i];
    // Past the grid's edge (column 10, row -2), the node with no data (2, 2), and those next to them.
    expect(refused(4, 2)).toBe(1);
    expect(refused(3, 2)).toBe(1);
    expect(refused(2, 0)).toBe(1);
    expect(refused(1, 1)).toBe(1);
    expect(refused(2, 2)).toBe(1);
    expect(refused(1, 3)).toBe(1);
    // Two nodes from either: kept.
    expect(refused(1, 4)).toBe(0);
    // The least and most of its own nodes with data.
    expect(ground.low).toBe(4 - 1000);
    expect(ground.high).toBe(8 + 400 - 1000);
    expect(
      surfaceLabelTileGround(
        new Float32Array(nx * ny).fill(-1),
        nx,
        ny,
        cells,
        key,
        value => value,
        value => value >= 0,
      ),
    ).toBeNull();
  });
});

describe('surface contours', () => {
  it('maps the props before `contours` in, without major lines', () => {
    expect(resolveSurfaceContours(undefined, {})).toBeNull();
    const old = resolveSurfaceContours(undefined, {
      showContours: true,
      contoursInterval: 10,
      contoursColorMode: ContourColorMode.lighten,
    })!;
    expect(old.interval).toBe(10);
    expect(old.major).toBe(0);
    expect(old.colorMode).toBe(ContourColorMode.lighten);
    expect(old.thickness).toBe(0.8);
    // `contours` given: those are not read.
    expect(
      resolveSurfaceContours(true, {
        showContours: true,
        contoursInterval: 10,
      })!.interval,
    ).toBe(100);
    expect(resolveSurfaceContours(false, { showContours: true })).toBeNull();
  });
});
