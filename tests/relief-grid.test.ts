import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import type { SurfaceMeta } from '../src/sdk/data/types/SurfaceMeta';
import {
  resampleRelief,
  resampleReliefGeographic,
} from '../src/sdk/geometries/relief-grid';
import { geoFrameAt } from '../src/sdk/projection/geo-frame';
import { toHalfFloatBits } from '../src/sdk/utils/half-float';

const LONLAT = '+proj=longlat +datum=WGS84 +no_defs';

function fromHalf(bits: number) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

// A lon/lat grid, the northern row first, its value set by `height(lon, lat)`.
function lonLatGrid(
  west: number,
  south: number,
  inc: number,
  nx: number,
  ny: number,
  height: (lon: number, lat: number) => number,
) {
  const values = new Float32Array(nx * ny);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      values[row * nx + col] = height(
        west + col * inc,
        south + (ny - 1 - row) * inc,
      );
    }
  }
  const meta = {
    id: 'test',
    name: 'test',
    projection: LONLAT,
    min: 0,
    max: 0,
    displayMin: 0,
    displayMax: 0,
    color: '#000',
    visualization: 'relief',
    header: {
      nx,
      ny,
      xori: west,
      yori: south,
      xinc: inc,
      yinc: inc,
      xmax: west + (nx - 1) * inc,
      ymax: south + (ny - 1) * inc,
      rot: 0,
    },
  } satisfies SurfaceMeta;
  return { values, meta };
}

// The scene centred on 2°E 58°N, in metres on a transverse Mercator map about it.
const frame = geoFrameAt(2, 58);

function texel(
  grid: NonNullable<ReturnType<typeof resampleRelief>>,
  x: number,
  z: number,
) {
  const [level] = grid.levels;
  const i = Math.round((x - grid.origin[0]) / grid.cell);
  const j = Math.round((z - grid.origin[1]) / grid.cell);
  const k = 2 * (j * level.width + i);
  const coverage = fromHalf(level.data[k + 1]);
  return {
    height: fromHalf(level.data[k]) / coverage,
    coverage,
    at: [grid.origin[0] + i * grid.cell, grid.origin[1] + j * grid.cell],
  };
}

describe('resampleRelief', () => {
  it('places the relief in the scene: east along +X, north along -Z', () => {
    const height = (lon: number, lat: number) =>
      100 * (lon - 2) + 1000 * (lat - 58);
    const { values, meta } = lonLatGrid(-2, 54, 1 / 30, 240, 240, height);
    const grid = resampleRelief(values, meta, frame, {
      center: [0, 0],
      radius: 100000,
    })!;
    expect(grid).not.toBeNull();
    const toLonLat = proj4(LONLAT, frame.projection);
    // North of the centre it rises by 1000 m a degree, east by 100.
    for (const [x, z] of [
      [0, 0],
      [0, -55660],
      [29490, 0],
      [-40000, 30000],
    ]) {
      const sample = texel(grid, x, z);
      const [lon, lat] = toLonLat.inverse([sample.at[0], -sample.at[1]]);
      // Half floats keep about 3 significant digits.
      expect(sample.height).toBeCloseTo(height(lon, lat), -1);
      expect(sample.coverage).toBeCloseTo(1, 2);
    }
    expect(texel(grid, 0, -55660).height).toBeGreaterThan(480);
    expect(texel(grid, 29490, 0).height).toBeGreaterThan(30);
  });

  it('is as fine as the relief near the centre, and covers no more than asked', () => {
    const { values, meta } = lonLatGrid(-2, 54, 1 / 30, 240, 240, () => 0);
    const grid = resampleRelief(values, meta, frame, {
      center: [0, 0],
      radius: 100000,
    })!;
    // 2' of longitude at 58°N is about 1.97 km.
    expect(grid.cell).toBeGreaterThan(1900);
    expect(grid.cell).toBeLessThan(2000);
    expect(grid.origin[0]).toBeCloseTo(-100000, 0);
    expect(grid.levels[0].width).toBeLessThanOrEqual(
      Math.ceil(200000 / grid.cell) + 1,
    );
  });

  it('marks no data as uncovered, and mips down to one texel', () => {
    const { values, meta } = lonLatGrid(-2, 54, 1 / 30, 240, 240, lon =>
      lon < 2 ? NaN : 10,
    );
    const grid = resampleRelief(values, meta, frame, {
      center: [0, 0],
      radius: 50000,
    })!;
    expect(texel(grid, -20000, 0).coverage).toBe(0);
    expect(texel(grid, 20000, 0).coverage).toBeCloseTo(1, 2);
    expect(texel(grid, 20000, 0).height).toBeCloseTo(10, 1);
    const last = grid.levels[grid.levels.length - 1];
    expect([last.width, last.height]).toEqual([1, 1]);
    for (let k = 1; k < grid.levels.length; k++) {
      expect(grid.levels[k].width).toBe(
        Math.max(grid.levels[k - 1].width >> 1, 1),
      );
    }
  });

  it('returns null where the relief does not reach', () => {
    const { values, meta } = lonLatGrid(20, 40, 1 / 30, 30, 30, () => 0);
    expect(
      resampleRelief(values, meta, frame, { center: [0, 0], radius: 50000 }),
    ).toBeNull();
  });
});

describe('resampleReliefGeographic', () => {
  // A texel's height and coverage at longitude and latitude (degrees), nearest.
  const geoTexel = (
    grid: NonNullable<ReturnType<typeof resampleReliefGeographic>>,
    lon: number,
    lat: number,
  ) => {
    const [level] = grid.levels;
    const i = Math.round((lon - grid.origin[0]) / grid.cell[0]);
    const j = Math.round((lat - grid.origin[1]) / grid.cell[1]);
    const k = 2 * (j * level.width + i);
    const coverage = fromHalf(level.data[k + 1]);
    return { height: fromHalf(level.data[k]) / coverage, coverage };
  };

  it('keeps a grid in longitude and latitude cell for cell, rows from the south', () => {
    const height = (lon: number, lat: number) => 10 * lon + 100 * lat;
    const { values, meta } = lonLatGrid(-2, 54, 1 / 30, 120, 90, height);
    const grid = resampleReliefGeographic(values, meta)!;
    expect(grid.wraps).toBe(false);
    expect(grid.cell[0]).toBeCloseTo(1 / 30, 12);
    expect(grid.cell[1]).toBeCloseTo(1 / 30, 12);
    expect(grid.origin).toEqual([-2, 54]);
    expect([grid.levels[0].width, grid.levels[0].height]).toEqual([120, 90]);
    for (const [lon, lat] of [
      [-2, 54],
      [0, 55],
      [1.5, 56.5],
    ]) {
      const sample = geoTexel(grid, lon, lat);
      expect(sample.height).toBeCloseTo(height(lon, lat), -1);
      expect(sample.coverage).toBeCloseTo(1, 2);
    }
  });

  it('goes all the way round for a world relief, its texels 360° across', () => {
    const { values, meta } = lonLatGrid(-179.5, -89.5, 1, 360, 180, lon => lon);
    const grid = resampleReliefGeographic(values, meta)!;
    expect(grid.wraps).toBe(true);
    expect(grid.levels[0].width * grid.cell[0]).toBeCloseTo(360, 9);
    expect(geoTexel(grid, 179.5, 0).height).toBeCloseTo(179.5, 0);
    // At most the size asked, still all the way round.
    const small = resampleReliefGeographic(values, meta, { maxSize: 90 })!;
    expect(small.wraps).toBe(true);
    expect(small.levels[0].width).toBe(90);
    expect(small.levels[0].width * small.cell[0]).toBeCloseTo(360, 9);
  });

  it('covers a relief in a map over its own longitudes and latitudes', () => {
    // 100 x 100 cells of 1 km on a transverse Mercator map about 2°E 58°N.
    const values = new Float32Array(100 * 100).fill(50);
    const meta = {
      ...lonLatGrid(0, 0, 1, 2, 2, () => 0).meta,
      projection: frame.projection,
      header: {
        nx: 100,
        ny: 100,
        xori: -50000,
        yori: -50000,
        xinc: 1000,
        yinc: 1000,
        xmax: 49000,
        ymax: 49000,
        rot: 0,
      },
    } satisfies SurfaceMeta;
    const grid = resampleReliefGeographic(values, meta)!;
    expect(grid.wraps).toBe(false);
    // About 50 km either side: 0.45° north and south, 0.85° east and west at 58°N.
    expect(grid.origin[1]).toBeCloseTo(58 - 0.449, 1);
    expect(grid.origin[0]).toBeCloseTo(2 - 0.848, 1);
    // A kilometre: 1/111 of a degree north, 1/59 east.
    expect(grid.cell[1] * 111.2).toBeCloseTo(1, 1);
    expect(grid.cell[0] * 111.2 * Math.cos((58 * Math.PI) / 180)).toBeCloseTo(
      1,
      1,
    );
    expect(geoTexel(grid, 2, 58).height).toBeCloseTo(50, 0);
  });

  it('weights each texel by what weightAt gives its node, heights kept', () => {
    const height = (lon: number, lat: number) => 10 * lon + 100 * lat;
    const { values, meta } = lonLatGrid(-2, 54, 1 / 30, 120, 90, height);
    const rows: number[] = [];
    // Faded in over the 10 westernmost columns, as a layer's feather fades it from its edge.
    const grid = resampleReliefGeographic(values, meta, {
      weightAt: (col, row, coverage) => {
        rows.push(row);
        return coverage * Math.min(col / 10, 1);
      },
    })!;
    for (const [col, weight] of [
      [0, 0],
      [5, 0.5],
      [10, 1],
      [60, 1],
    ]) {
      const sample = geoTexel(grid, -2 + col / 30, 55);
      expect(sample.coverage).toBeCloseTo(weight, 2);
    }
    // Where it gives anything, the height is the relief's.
    for (const col of [5, 10, 60]) {
      const lon = -2 + col / 30;
      expect(geoTexel(grid, lon, 55).height).toBeCloseTo(height(lon, 55), -1);
    }
    // Its nodes as the relief numbers them: rows from the north.
    expect(Math.min(...rows)).toBeCloseTo(0, 6);
    expect(Math.max(...rows)).toBeCloseTo(89, 6);
    // Unweighted, it is as before.
    const plain = resampleReliefGeographic(values, meta)!;
    expect(geoTexel(plain, -2, 55).coverage).toBeCloseTo(1, 2);
  });
});

describe('toHalfFloatBits', () => {
  it('round-trips heights and saturates beyond the half range', () => {
    for (const value of [0, 1, -1, 0.5, 2077, -3925, 11000]) {
      expect(fromHalf(toHalfFloatBits(value))).toBeCloseTo(value, -1);
    }
    expect(fromHalf(toHalfFloatBits(1e6))).toBe(Infinity);
    expect(Number.isNaN(fromHalf(toHalfFloatBits(NaN)))).toBe(true);
  });
});
