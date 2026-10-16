import { describe, expect, it } from 'vitest';
import {
  prepareWellboreBounds,
  wellboreBoundsDistance,
} from '../src/components/Wellbores/WellboreBounds/wellbore-bounds-distance';
import { calculateWellboreBounds } from '../src/generators/wellbore-bounds-generator';
import type { PositionLog, ReadonlyStore, Vec3 } from '../src/sdk';

// A well dropping 1 km, building out to the east, then turning north.
const CHAIN: Vec3[] = [
  [0, 0, 0],
  [0, -1000, 0],
  [600, -1600, 0],
  [1600, -1700, 0],
  [2200, -1750, 900],
];

/** Generator output for a chain: its bounding-box sphere, then the points. */
function boundsOf(chain: Vec3[]): Float32Array {
  const min = [0, 1, 2].map(k => Math.min(...chain.map(p => p[k])));
  const max = [0, 1, 2].map(k => Math.max(...chain.map(p => p[k])));
  const half = [0, 1, 2].map(k => (max[k] - min[k]) / 2);
  return Float32Array.from([
    ...[0, 1, 2].map(k => min[k] + half[k]),
    Math.hypot(half[0], half[1], half[2]),
    ...chain.flat(),
  ]);
}

function toPolyline(chain: Vec3[], p: Vec3): number {
  let best = Infinity;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const u = [0, 1, 2].map(k => chain[i][k] - a[k]);
    const w = [0, 1, 2].map(k => p[k] - a[k]);
    const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const t = Math.max(
      0,
      Math.min(1, (w[0] * u[0] + w[1] * u[1] + w[2] * u[2]) / uu),
    );
    best = Math.min(
      best,
      Math.hypot(w[0] - t * u[0], w[1] - t * u[1], w[2] - t * u[2]),
    );
  }
  return best;
}

function random(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe('wellboreBoundsDistance', () => {
  const bounds = prepareWellboreBounds(boundsOf(CHAIN));

  it('is the distance to the chain below exactWithin, and a lower bound of it beyond', () => {
    const next = random(3);
    let exact = 0;
    let worstExact = 0;
    let beyond = 0;
    let aboveTruth = -Infinity;
    let belowCutoff = Infinity;
    for (let i = 0; i < 2000; i++) {
      const p: Vec3 = [
        -6000 + 14000 * next(),
        -8000 + 12000 * next(),
        -6000 + 14000 * next(),
      ];
      const truth = toPolyline(CHAIN, p);
      const value = wellboreBoundsDistance(bounds, ...p, 1, 3000, 0);
      if (truth < 3000) {
        worstExact = Math.max(worstExact, Math.abs(value - truth));
        exact++;
      } else {
        aboveTruth = Math.max(aboveTruth, value - truth);
        belowCutoff = Math.min(belowCutoff, value);
        beyond++;
      }
    }
    expect(exact).toBeGreaterThan(100);
    expect(worstExact).toBeLessThan(1e-6);
    expect(beyond).toBeGreaterThan(100);
    expect(aboveTruth).toBeLessThanOrEqual(1e-9);
    expect(belowCutoff).toBeGreaterThanOrEqual(3000 - 1e-9);
  });

  it('never jumps, across the bounding sphere or the cut-off', () => {
    const next = random(11);
    for (const [zoom, padding] of [
      [1, 0],
      [2.5, 300],
    ]) {
      for (let line = 0; line < 50; line++) {
        // from 20 km out, straight through the well's neighbourhood
        const target: Vec3 = [2200 * next(), -1750 * next(), 900 * next()];
        const dir = [next() - 0.5, next() - 0.5, next() - 0.5];
        const len = Math.hypot(dir[0], dir[1], dir[2]);
        const step = 5;
        let last = NaN;
        let worst = 0;
        for (let s = -20000; s <= 20000; s += step) {
          const p = [0, 1, 2].map(k => target[k] + (dir[k] / len) * s) as Vec3;
          const value = wellboreBoundsDistance(
            bounds,
            ...p,
            zoom,
            3000,
            padding,
          );
          if (!Number.isNaN(last))
            worst = Math.max(worst, Math.abs(value - last));
          last = value;
        }
        expect(worst).toBeLessThanOrEqual(step / zoom + 1e-6);
      }
    }
  });

  it('subtracts the padding and divides by zoom', () => {
    const p: Vec3 = [300, -1200, 400];
    const truth = toPolyline(CHAIN, p);
    expect(wellboreBoundsDistance(bounds, ...p, 2, 3000, 100)).toBeCloseTo(
      (truth - 100) / 2,
      6,
    );
    expect(wellboreBoundsDistance(bounds, 0, -500, 0, 1, 3000, 100)).toBe(0);
  });

  it('reads a single point as a point, and no chain as the sphere', () => {
    const point = prepareWellboreBounds(
      Float32Array.from([10, 20, 30, 0, 10, 20, 30]),
    );
    expect(wellboreBoundsDistance(point, 10, 20, 130, 1, 3000, 0)).toBeCloseTo(
      100,
      6,
    );
    const sphere = prepareWellboreBounds(Float32Array.from([0, 0, 0, 10]));
    expect(wellboreBoundsDistance(sphere, 0, 0, 110, 1, 3000, 0)).toBeCloseTo(
      100,
      6,
    );
  });
});

// Vertical to 1000 m, a 600 m radius build to horizontal, then 1000 m flat — as
// [east, tvd, north] at measured depth `md`.
const R = 600;
function wellAt(md: number): Vec3 {
  if (md <= 1000) return [0, md, 0];
  const arc = (Math.PI / 2) * R;
  if (md <= 1000 + arc) {
    const a = (md - 1000) / R;
    return [R - R * Math.cos(a), 1000 + R * Math.sin(a), 0];
  }
  return [R + md - 1000 - arc, 1000 + R, 0];
}
const WELL_LENGTH = 1000 + (Math.PI / 2) * R + 1000;

function surveyed(at: (md: number) => Vec3, length: number, every: number) {
  const values: number[] = [];
  for (let md = 0; md < length + every; md += every) {
    const m = Math.min(md, length);
    values.push(...at(m), m);
  }
  return Float32Array.from(values) as PositionLog;
}

async function generate(poslog: PositionLog, fromMsl?: number) {
  const store = { get: async () => poslog } as unknown as ReadonlyStore;
  const data = await calculateWellboreBounds.call(store, 'w', fromMsl, 100);
  const chain: Vec3[] = [];
  for (let i = 4; i < data.length; i += 3)
    chain.push([data[i], data[i + 1], data[i + 2]]);
  return { data, chain };
}

describe('calculateWellboreBounds', () => {
  it('stays within the tolerance of the well, however densely it was surveyed', async () => {
    const generated = await Promise.all(
      [1, 30, 100].map(every => generate(surveyed(wellAt, WELL_LENGTH, every))),
    );
    for (const { data, chain } of generated) {
      for (let md = 0; md <= WELL_LENGTH; md += 5) {
        const [east, tvd] = wellAt(md);
        expect(toPolyline(chain, [east, -tvd, 0])).toBeLessThanOrEqual(100 + 2);
      }
      for (const p of chain) {
        const d = Math.hypot(p[0] - data[0], p[1] - data[1], p[2] - data[2]);
        expect(d).toBeLessThanOrEqual(data[3] + 1e-3);
      }
    }
    for (const { chain } of generated) {
      expect(
        Math.abs(chain.length - generated[0].chain.length),
      ).toBeLessThanOrEqual(1);
    }
  });

  it('gives a straight well two points, however densely it was surveyed', async () => {
    const generated = await Promise.all(
      [1, 500].map(every => generate(surveyed(md => [0, md, 0], 3000, every))),
    );
    for (const { chain } of generated) expect(chain.length).toBe(2);
  });

  it('starts the chain at fromMsl', async () => {
    const { chain } = await generate(surveyed(wellAt, WELL_LENGTH, 30), 500);
    expect(Math.abs(chain[0][1] + 500)).toBeLessThan(5);
  });

  // `from + (1 - from) * n / n` can round to just past 1, where the spline throws.
  it('reaches the end of the well from any fromMsl', async () => {
    const poslog = surveyed(wellAt, WELL_LENGTH, 30);
    const tops = Array.from({ length: 200 }, (_, i) => i * 13.7);
    const generated = await Promise.all(tops.map(top => generate(poslog, top)));
    for (const { chain } of generated) {
      const [east, tvd] = wellAt(WELL_LENGTH);
      const end = chain[chain.length - 1];
      expect(Math.hypot(end[0] - east, end[1] + tvd)).toBeLessThan(1);
    }
  });
});
