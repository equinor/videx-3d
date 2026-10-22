import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import type { SurfaceMeta } from '../src/sdk/data/types/SurfaceMeta';
import {
  reliefFrameAt,
  resampleRelief,
} from '../src/sdk/geometries/relief-grid';
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
const frame = reliefFrameAt(2, 58);

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

describe('toHalfFloatBits', () => {
  it('round-trips heights and saturates beyond the half range', () => {
    for (const value of [0, 1, -1, 0.5, 2077, -3925, 11000]) {
      expect(fromHalf(toHalfFloatBits(value))).toBeCloseTo(value, -1);
    }
    expect(fromHalf(toHalfFloatBits(1e6))).toBe(Infinity);
    expect(Number.isNaN(fromHalf(toHalfFloatBits(NaN)))).toBe(true);
  });
});
