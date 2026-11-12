import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/sdk/types/common';
import {
  seaSpectrum,
  windSeaPeak,
  type SeaSpectrumInput,
} from '../src/sdk/weather/sea-spectrum';
import { SeaState } from '../src/sdk/weather/sea-state';

const EAST: Vec2 = [1, 0];
const SOUTH: Vec2 = [0, 1];
const wind = (speed: number, direction: Vec2 = EAST): SeaSpectrumInput => ({
  windSpeed: speed,
  windDirection: direction,
});

// A grid of points over a few hundred metres, for comparing fields.
const POINTS: [number, number][] = [];
for (let i = 0; i < 12; i++)
  for (let j = 0; j < 12; j++) POINTS.push([i * 37.3 - 200, j * 41.9 - 250]);

const field = (sea: SeaState) => POINTS.map(([x, z]) => sea.heightAt(x, z));

// The energy-weighted mean direction of the waves drawn, radians.
function meanDirection(sea: SeaState): number {
  let x = 0;
  let z = 0;
  for (const table of sea.layerTables())
    for (let i = 0; i < table.count; i++) {
      const [kx, kz, re, im] = table.data.subarray(i * 4, i * 4 + 4);
      const e = re * re + im * im;
      const k = Math.hypot(kx, kz);
      x += (e * kx) / k;
      z += (e * kz) / k;
    }
  return Math.atan2(z, x);
}

const run = (sea: SeaState, seconds: number, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) sea.update(dt);
};

describe('seaSpectrum', () => {
  it('holds the wind sea’s variance at Hs ≈ 0.21 U² / g, as the Ocean always had', () => {
    const spectrum = seaSpectrum(wind(10));
    const hs = windSeaPeak(10).height;
    expect(spectrum.significantHeight).toBeCloseTo(hs, 6);
    expect(spectrum.variance(1e-4, 50)).toBeCloseTo((hs / 4) ** 2, 2);
  });

  it('adds a swell’s variance about its period', () => {
    const swell = { height: 2, period: 12, direction: SOUTH };
    const spectrum = seaSpectrum({ ...wind(0), swells: [swell] });
    expect(spectrum.significantHeight).toBeCloseTo(2, 6);
    const kPeak = (2 * Math.PI) ** 2 / (9.81 * 144);
    expect(spectrum.variance(0.5 * kPeak, 2 * kPeak)).toBeCloseTo(0.25, 2);
  });
});

describe('SeaState', () => {
  it('draws the significant wave height asked for', () => {
    for (const speed of [5, 10, 20]) {
      const stats = new SeaState(wind(speed)).stats();
      expect(stats.significantHeight / stats.targetHeight).toBeGreaterThan(0.9);
      expect(stats.significantHeight / stats.targetHeight).toBeLessThan(1.1);
    }
  });

  it('keeps the waves in place across a change of wind: no rescale, no turn, no phase jump', () => {
    const changed = new SeaState(wind(10));
    const same = new SeaState(wind(10));
    run(changed, 5);
    run(same, 5);
    changed.setInput(wind(15, SOUTH));
    changed.update(1 / 60);
    same.update(1 / 60);
    const a = field(changed);
    const b = field(same);
    let worst = 0;
    for (let i = 0; i < a.length; i++)
      worst = Math.max(worst, Math.abs(a[i] - b[i]));
    // One frame of easing toward the new sea: under 1 % of the wave height.
    expect(worst, `worst ${worst.toFixed(4)} m`).toBeLessThan(
      0.01 * windSeaPeak(10).height,
    );
  });

  it('turns with the wind over time, not at once', () => {
    const sea = new SeaState(wind(10, EAST));
    expect(Math.abs(meanDirection(sea))).toBeLessThan(0.05);
    sea.setInput(wind(10, SOUTH));
    run(sea, 2);
    const early = meanDirection(sea);
    run(sea, 600, 1 / 10);
    const late = meanDirection(sea);
    expect(early, 'still mostly the old sea').toBeLessThan(Math.PI / 6);
    expect(Math.abs(late - Math.PI / 2), 'the new sea').toBeLessThan(0.15);
    const stats = sea.stats();
    expect(stats.significantHeight / stats.targetHeight).toBeGreaterThan(0.9);
  });

  it('keeps a swell running in a calm, and lets a wind sea die away', () => {
    const swell = { height: 2, period: 12, direction: SOUTH };
    const sea = new SeaState({ ...wind(10), swells: [swell] });
    sea.setInput({ ...wind(0), swells: [swell] });
    run(sea, 900, 1 / 5);
    const stats = sea.stats();
    expect(stats.significantHeight).toBeGreaterThan(1.8);
    expect(stats.significantHeight).toBeLessThan(2.2);
    expect(Math.abs(meanDirection(sea) - Math.PI / 2)).toBeLessThan(0.1);
  });

  it('lets waves join and leave only at no amplitude', () => {
    const sea = new SeaState(wind(8, EAST));
    const amplitudes = () => {
      const out = new Map<string, number>();
      for (const [l, table] of sea.layerTables().entries())
        for (let i = 0; i < table.count; i++) {
          const [kx, kz, re, im] = table.data.subarray(i * 4, i * 4 + 4);
          out.set(`${l}:${kx}:${kz}`, Math.hypot(re, im));
        }
      return out;
    };
    sea.setInput(wind(16, [-1, 1]));
    let before = amplitudes();
    let joined = 0;
    let left = 0;
    let worstJoin = 0;
    let worstLeave = 0;
    for (let frame = 0; frame < 3000; frame++) {
      sea.update(1 / 15);
      const now = amplitudes();
      for (const [key, a] of now)
        if (!before.has(key)) {
          joined++;
          worstJoin = Math.max(worstJoin, a);
        }
      for (const [key, a] of before)
        if (!now.has(key)) {
          left++;
          worstLeave = Math.max(worstLeave, a);
        }
      before = now;
    }
    const hs = windSeaPeak(16).height;
    expect(joined, 'waves joined').toBeGreaterThan(0);
    expect(left, 'waves left').toBeGreaterThan(0);
    expect(worstJoin / hs, 'the largest wave joining, of Hs').toBeLessThan(
      0.002,
    );
    expect(worstLeave / hs, 'the largest wave leaving, of Hs').toBeLessThan(
      0.002,
    );
  });

  it('sums its tables as its tiles do', () => {
    const sea = new SeaState(wind(12, [1, 2]));
    run(sea, 3.7);
    const tables = sea.layerTables();
    let worst = 0;
    for (const [x, z] of POINTS) {
      let h = 0;
      for (const table of tables)
        for (let i = 0; i < table.count; i++) {
          const [kx, kz, re, im] = table.data.subarray(i * 4, i * 4 + 4);
          const p = kx * x + kz * z;
          h += re * Math.cos(p) - im * Math.sin(p);
        }
      const tiles = sea.layers.reduce(
        (sum, _, l) => sum + sea.tileHeightAt(l, x, z),
        0,
      );
      worst = Math.max(worst, Math.abs(h - tiles));
    }
    // float32 tables against doubles.
    expect(worst, `worst ${worst.toFixed(5)} m`).toBeLessThan(2e-3);
  });

  it('tiles each layer on its own grid', () => {
    for (const size of [2011, 307, 47]) {
      const sea = new SeaState(wind(10, [1, 0.3]), {
        layers: [{ size, texels: 64, waves: 128 }],
      });
      const { angle } = sea.layers[0];
      const step: Vec2 = [size * Math.cos(angle), size * Math.sin(angle)];
      const across: Vec2 = [-size * Math.sin(angle), size * Math.cos(angle)];
      let worst = 0;
      for (const [x, z] of POINTS.slice(0, 20)) {
        const h = sea.tileHeightAt(0, x, z);
        worst = Math.max(
          worst,
          Math.abs(h - sea.tileHeightAt(0, x + step[0], z + step[1])),
          Math.abs(h - sea.tileHeightAt(0, x + across[0], z + across[1])),
        );
      }
      expect(worst, `tile ${size} m`).toBeLessThan(1e-6);
    }
  });

  it('does not repeat with its tiles as drawn, and keeps their variance', () => {
    const sea = new SeaState(wind(10, [1, 0.3]));
    const correlation = (a: number[], b: number[]) => {
      const n = a.length;
      const ma = a.reduce((s, x) => s + x, 0) / n;
      const mb = b.reduce((s, x) => s + x, 0) / n;
      let ab = 0;
      let aa = 0;
      let bb = 0;
      for (let i = 0; i < n; i++) {
        ab += (a[i] - ma) * (b[i] - mb);
        aa += (a[i] - ma) ** 2;
        bb += (b[i] - mb) ** 2;
      }
      return { r: ab / Math.sqrt(aa * bb), variance: aa / n };
    };
    let worstRepeat = 0;
    let worstVariance = 1;
    let where = '';
    sea.layers.forEach((tile, l) => {
      const step: Vec2 = [
        tile.size * Math.cos(tile.angle),
        tile.size * Math.sin(tile.angle),
      ];
      const drawn: number[] = [];
      const shifted: number[] = [];
      const raw: number[] = [];
      for (let i = 0; i < 1500; i++) {
        const x = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 20 * tile.size;
        const z = ((Math.sin(i * 78.233) * 12345.6789) % 1) * 20 * tile.size;
        drawn.push(sea.heightAt(x, z, l));
        shifted.push(sea.heightAt(x + step[0], z + step[1], l));
        raw.push(sea.tileHeightAt(l, x, z));
      }
      const repeat = correlation(drawn, shifted).r;
      const ratio =
        correlation(drawn, drawn).variance / correlation(raw, raw).variance;
      if (Math.abs(repeat) > worstRepeat) {
        worstRepeat = Math.abs(repeat);
        where = `layer ${l}`;
      }
      worstVariance = Math.min(worstVariance, ratio, 2 - ratio);
    });
    expect(
      worstRepeat,
      `the drawn sea against itself a tile on, ${where}`,
    ).toBeLessThan(0.3);
    expect(worstVariance, 'height variance kept by the blend').toBeGreaterThan(
      0.8,
    );
  });

  it('is the same sea for the same seed and clock, another for another seed', () => {
    const a = new SeaState(wind(10), { seed: 3 });
    const b = new SeaState(wind(10), { seed: 3 });
    const c = new SeaState(wind(10), { seed: 4 });
    for (const sea of [a, b, c]) run(sea, 2);
    expect(field(a)).toEqual(field(b));
    expect(field(a)).not.toEqual(field(c));
  });
});
