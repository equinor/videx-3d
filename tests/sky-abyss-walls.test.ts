import { describe, expect, it } from 'vitest';
import {
  createSkyAbyssWallGeometry,
  SKY_ABYSS_WALL_COLUMNS,
  SKY_ABYSS_WALL_ROWS,
  skyAbyssWallGrid,
  skyAbyssWallLap,
} from '../src/components/Sky/sky-abyss-walls';

// Volve's stage, and the walls' defaults.
const half: [number, number] = [7548, 6946];
const away = 10500;
const scale = 9900;
const black = 8000;

describe('skyAbyssWallGrid', () => {
  it('lays a column about every 4 texels of the cliffs round the lap', () => {
    const grid = skyAbyssWallGrid(half, away, scale, black, 1024);
    const texel = (scale * 8) / 1024;
    const column = skyAbyssWallLap(half, away) / grid.columns;
    expect(column / texel).toBeGreaterThan(3.5);
    expect(column / texel).toBeLessThan(4.5);
    expect(grid.rows).toBe(SKY_ABYSS_WALL_ROWS);
    expect(grid.depth).toBe(2.5 * black);
  });

  it('keeps its columns within bounds', () => {
    const [fewest, most] = SKY_ABYSS_WALL_COLUMNS;
    expect(skyAbyssWallGrid([0, 0], 100, 1e6, black, 1024).columns).toBe(
      fewest,
    );
    expect(skyAbyssWallGrid(half, away, 10, black, 1024).columns).toBe(most);
  });
});

describe('createSkyAbyssWallGeometry', () => {
  const geometry = createSkyAbyssWallGeometry();
  const positions = geometry.getAttribute('position').array;
  const indices = geometry.index!.array;
  const at = (v: number) => [positions[3 * v], positions[3 * v + 1]];
  const rows = SKY_ABYSS_WALL_ROWS;

  it('holds each vertex’s column and row, column by column', () => {
    const [, most] = SKY_ABYSS_WALL_COLUMNS;
    expect(positions.length).toBe(3 * (most + 1) * (rows + 1));
    expect(at(0)).toEqual([0, 0]);
    expect(at(rows)).toEqual([0, rows]);
    expect(at(rows + 1)).toEqual([1, 0]);
  });

  it('draws a grid of fewer columns with the first indices alone', () => {
    const columns = 300;
    const drawn = indices.subarray(0, 6 * columns * rows);
    const cells = new Set<string>();
    for (let k = 0; k < drawn.length; k += 3) {
      const corners = [0, 1, 2].map(n => at(drawn[k + n]));
      for (const [i, j] of corners) {
        expect(i).toBeLessThanOrEqual(columns);
        expect(j).toBeLessThanOrEqual(rows);
      }
      const i = Math.min(...corners.map(c => c[0]));
      const j = Math.min(...corners.map(c => c[1]));
      cells.add(`${i},${j}`);
    }
    expect(cells.size).toBe(columns * rows);
  });

  it('meets along each cell’s diagonal from (i + 1, j) to (i, j + 1), all wound alike', () => {
    for (let k = 0; k < indices.length; k += 3) {
      const [a, b, c] = [0, 1, 2].map(n => at(indices[k + n]));
      const i = Math.min(a[0], b[0], c[0]);
      const j = Math.min(a[1], b[1], c[1]);
      const keys = [a, b, c].map(([x, y]) => `${x - i},${y - j}`);
      expect(keys).toContain('1,0');
      expect(keys).toContain('0,1');
      // Round (i) then down (j): the same turn for every triangle.
      const turn =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      expect(turn).toBe(-1);
    }
  });
});
