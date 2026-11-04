import { describe, expect, it } from 'vitest';
import { reliefContourLabelPoints } from '../src/sdk/geometries/relief-contour-labels';

const CELLS = 32;
const NODES = CELLS + 3;

// A tile's heights, `(cells + 3)²` with a border of one, from a height at each own node
// (column east, row south).
const tileOf = (height: (column: number, row: number) => number) => {
  const heights = new Float32Array(NODES * NODES);
  for (let r = 0; r < NODES; r++)
    for (let c = 0; c < NODES; c++)
      heights[r * NODES + c] = height(c - 1, r - 1);
  return { cells: CELLS, heights };
};

describe('reliefContourLabelPoints', () => {
  it('labels a line evenly along it, the top of its text uphill', () => {
    // Rising 10 m a column eastward: the 100 m line runs down column 10.
    const points = reliefContourLabelPoints(
      tileOf(c => 10 * c),
      [100],
      10,
    );
    // 32 cells long: three labels, a third of it apart.
    expect(points.map(p => Math.round(p.row * 100) / 100)).toEqual(
      [32 / 6, 16, 160 / 6].map(r => Math.round(r * 100) / 100),
    );
    for (const p of points) {
      expect(p.column).toBeCloseTo(10, 6);
      expect(p.level).toBe(100);
      // A plane: drawn as it is contoured.
      expect(p.height).toBeCloseTo(100, 4);
      expect(p.rise[0]).toBeCloseTo(10, 6);
      expect(p.rise[1]).toBeCloseTo(0, 6);
      // Reading south, so its top — the way it reads turned toward north from east —
      // points east, uphill.
      expect(p.along[0]).toBeCloseTo(0, 6);
      expect(p.along[1]).toBeCloseTo(1, 6);
    }
    // Falling eastward instead: reading north, its top west.
    const falling = reliefContourLabelPoints(
      tileOf(c => -10 * c),
      [-100],
      10,
    );
    expect(falling.length).toBe(3);
    for (const p of falling) expect(p.along[1]).toBeCloseTo(-1, 6);
  });

  it('turns the top of its text toward the summit round a hill', () => {
    // A cone at the tile's middle, 1000 m, falling 50 m a cell.
    const middle = CELLS / 2;
    const points = reliefContourLabelPoints(
      tileOf((c, r) => 1000 - 50 * Math.hypot(c - middle, r - middle)),
      [500],
      6,
    );
    // Round a circle 10 cells across: about 62 cells, labelled about every 6.
    expect(points.length).toBeGreaterThanOrEqual(9);
    for (const p of points) {
      expect(Math.hypot(p.column - middle, p.row - middle)).toBeCloseTo(10, 0);
      // Its top, in columns east and rows south: the way it reads turned toward north.
      const top = [p.along[1], -p.along[0]];
      const toSummit = [middle - p.column, middle - p.row];
      expect(top[0] * toSummit[0] + top[1] * toSummit[1]).toBeGreaterThan(0);
    }
  });

  it('lies on the ground as drawn, on the triangle it is in', () => {
    // Uneven ground: labels land inside cells, off the nodes.
    const height = (c: number, r: number) =>
      40 * Math.sin(c * 0.7) * Math.cos(r * 0.5) + 10 * c;
    const points = reliefContourLabelPoints(tileOf(height), [100, 150, 200], 4);
    expect(points.length).toBeGreaterThan(5);
    for (const p of points) {
      // Split from (i + 1, j) to (i, j + 1), as `geoReliefTileHeightAt` draws it.
      const i = Math.floor(p.column);
      const j = Math.floor(p.row);
      const u = p.column - i;
      const v = p.row - j;
      const [h00, h10, h01, h11] = [
        height(i, j),
        height(i + 1, j),
        height(i, j + 1),
        height(i + 1, j + 1),
      ];
      const drawn =
        u + v <= 1
          ? h00 + u * (h10 - h00) + v * (h01 - h00)
          : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
      expect(p.height).toBeCloseTo(drawn, 3);
    }
  });

  it('lies on the line as the relief shades it: bilinear in its cell', () => {
    // Twisted cells: the bilinear line curves off marching squares' straight chords.
    const height = (c: number, r: number) =>
      60 * Math.sin(c * 0.9) * Math.cos(r * 0.8) + 8 * c;
    const levels = [80, 120, 160];
    const points = reliefContourLabelPoints(tileOf(height), levels, 3, {
      ranks: 2,
    });
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) {
      const i = Math.min(Math.floor(p.column), CELLS - 1);
      const j = Math.min(Math.floor(p.row), CELLS - 1);
      const u = p.column - i;
      const v = p.row - j;
      const bilinear =
        height(i, j) * (1 - u) * (1 - v) +
        height(i + 1, j) * u * (1 - v) +
        height(i, j + 1) * (1 - u) * v +
        height(i + 1, j + 1) * u * v;
      // Within a ten-thousandth of a cell of it: a few millimetres here.
      expect(bilinear).toBeCloseTo(p.level, 1);
    }
  });

  it('passes over a line too short, the tile’s edge, and what `keep` refuses', () => {
    // The 950 m line a quarter circle a cell across, at the tile's corner: too short.
    const corner = reliefContourLabelPoints(
      tileOf((c, r) => 1000 - 50 * Math.hypot(c, r)),
      [950],
      24,
    );
    expect(corner).toEqual([]);
    // Along the edge: within 1.5 cells of it.
    expect(
      reliefContourLabelPoints(
        tileOf(c => 10 * c),
        [10],
        10,
      ),
    ).toEqual([]);
    // Only the north half kept.
    const kept = reliefContourLabelPoints(
      tileOf(c => 10 * c),
      [100],
      10,
      { keep: (_, row) => row < 16 },
    );
    expect(kept.length).toBe(1);
    expect(kept[0].row).toBeLessThan(16);
  });

  it('halves the spacing each rank, the labels before keeping their places', () => {
    const plane = tileOf(c => 10 * c);
    const coarse = reliefContourLabelPoints(plane, [100], 10);
    const all = reliefContourLabelPoints(plane, [100], 10, { ranks: 2 });
    // Rank 0 as found alone.
    expect(all.filter(p => p.rank === 0).map(p => p.row)).toEqual(
      coarse.map(p => p.row),
    );
    // Rank 1 halfway between them; rank 2 halving again, out to the line's ends.
    expect(
      all.filter(p => p.rank === 1).map(p => Math.round(p.row * 100) / 100),
    ).toEqual([32 / 3, 64 / 3].map(r => Math.round(r * 100) / 100));
    const rows = all.map(p => p.row).sort((a, b) => a - b);
    expect(rows.length).toBe(11);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i] - rows[i - 1]).toBeCloseTo(8 / 3, 6);
    // Only the finer ranks, found after the coarser.
    const finer = reliefContourLabelPoints(plane, [100], 10, {
      ranks: 2,
      from: 1,
    });
    expect(finer.map(p => p.rank).sort()).toEqual(
      all
        .filter(p => p.rank > 0)
        .map(p => p.rank)
        .sort(),
    );
  });

  it('labels a short or tight line at the rank it fits', () => {
    const middle = CELLS / 2;
    const cone = tileOf(
      (c, r) => 1000 - 50 * Math.hypot(c - middle, r - middle),
    );
    // A ring a cell and a half round (about 9.4 long): too short for spacing 24.
    expect(reliefContourLabelPoints(cone, [925], 24)).toEqual([]);
    const short = reliefContourLabelPoints(cone, [925], 24, { ranks: 3 });
    // Half of spacing / 4 is 3: rank 2 gives it one in its middle, rank 3 more between.
    expect(short.filter(p => p.rank < 2)).toEqual([]);
    expect(short.filter(p => p.rank === 2).length).toBe(1);
    expect(short.filter(p => p.rank === 3).length).toBeGreaterThan(0);
    // A ring 2 cells round turns 43° over 1.5 cells either way: too bent at rank 0, read
    // along at the finer ranks, which look less far along it.
    const tight = reliefContourLabelPoints(cone, [900], 4, { ranks: 2 });
    expect(tight.filter(p => p.rank === 0)).toEqual([]);
    expect(tight.filter(p => p.rank > 0).length).toBeGreaterThan(0);
  });

  it('measures along the ground: a column `aspect` rows wide', () => {
    // Rising 10 m a row southward: the 100 m line runs along row 10, 32 columns long — 16
    // rows on the ground at half a row a column, so 4 labels 4 apart.
    const points = reliefContourLabelPoints(
      tileOf((_, r) => 10 * r),
      [100],
      4,
      { aspect: 0.5 },
    );
    expect(points.length).toBe(4);
    for (const p of points) {
      expect(p.row).toBeCloseTo(10, 6);
      // Reading west, its top turned toward north from it points south: uphill.
      expect(p.along[0]).toBeCloseTo(-1, 6);
    }
  });
});
