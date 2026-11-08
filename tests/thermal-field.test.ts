import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_PRESETS,
  atmosphereExtent,
  atmosphereTable,
  liftThermal,
  THERMAL_GROWTH,
  THERMAL_TURRET,
  type Atmosphere,
} from '../src/sdk/weather/atmosphere';
import {
  binBubbles,
  BUBBLE_FLOATS,
  bubbleReach,
  PATCHES_PERIOD,
  patchesAt,
  patchesMap,
  thermalBubbles,
  type ThermalFieldSettings,
} from '../src/sdk/weather/thermal-field';

const ROWS = 32;
const map = patchesMap(1);

const settingsOf = (a: Atmosphere, time: number, speed: number, half = 8000): ThermalFieldSettings => ({
  half,
  time,
  seed: 1,
  heating: a.heating,
  patchiness: a.patchiness,
  east: 0.6,
  north: 0.8,
  speed,
  shear: 0,
  mixedTop: Math.min(a.mixedLayer, a.inversionHeight),
});

describe('thermal field', () => {
  const fair = ATMOSPHERE_PRESETS.fair;
  const table = atmosphereTable(fair, ROWS);

  it('repeats its patches over their period, within 0 to 1', () => {
    let lowest = Infinity;
    let highest = -Infinity;
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const x = (i * 7919) % 50000;
      const y = (i * 104729) % 50000;
      for (const channel of [0, 1]) {
        const v = patchesAt(map, x, y, channel);
        lowest = Math.min(lowest, v);
        highest = Math.max(highest, v);
        worst = Math.max(worst, Math.abs(v - patchesAt(map, x + PATCHES_PERIOD, y - PATCHES_PERIOD, channel)));
      }
    }
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(highest).toBeLessThanOrEqual(1);
    expect(highest - lowest).toBeGreaterThan(0.3);
    expect(worst).toBeLessThan(1e-5);
  });

  it('lists bubbles where thermals rise into cloud, none where none do', () => {
    expect(thermalBubbles(table, ROWS, map, settingsOf(fair, 1800, 0)).count).toBeGreaterThan(50);
    const alto = ATMOSPHERE_PRESETS.altostratus;
    const still = atmosphereTable(alto, ROWS);
    expect(thermalBubbles(still, ROWS, map, settingsOf(alto, 1800, 0)).count).toBe(0);
  });

  it('carries its bubbles with the wind', () => {
    const time = 1200;
    const speed = 7;
    const keyOf = (b: Float32Array, i: number) =>
      [3, 2, 4, 6].map(k => b[i * BUBBLE_FLOATS + k].toFixed(3)).join('|');
    const calm = thermalBubbles(table, ROWS, map, settingsOf(fair, time, 0, 20000), 20000);
    const windy = thermalBubbles(table, ROWS, map, settingsOf(fair, time, speed, 20000), 20000);
    // Many thermals share a phase and a strength: each windy bubble's nearest like calm one.
    const where = new Map<string, [number, number][]>();
    for (let i = 0; i < calm.count; i++) {
      const key = keyOf(calm.bubbles, i);
      if (!where.has(key)) where.set(key, []);
      where.get(key)!.push([calm.bubbles[i * BUBBLE_FLOATS], calm.bubbles[i * BUBBLE_FLOATS + 1]]);
    }
    let matched = 0;
    let worst = 0;
    for (let i = 0; i < windy.count; i++) {
      const e = windy.bubbles[i * BUBBLE_FLOATS] - 0.6 * speed * time;
      const n = windy.bubbles[i * BUBBLE_FLOATS + 1] - 0.8 * speed * time;
      // Within the calm square, away from its edge where it lists bubbles the windy one doesn't.
      if (Math.max(Math.abs(e), Math.abs(n)) > 14000) continue;
      const like = where.get(keyOf(windy.bubbles, i));
      if (!like) continue;
      matched++;
      worst = Math.max(worst, Math.min(...like.map(([x, y]) => Math.hypot(e - x, n - y))));
    }
    expect(matched).toBeGreaterThan(20);
    expect(worst).toBeLessThan(0.5);
  });

  it('keeps each bubble its own billows from one time to the next', () => {
    const before = thermalBubbles(table, ROWS, map, settingsOf(fair, 1800, 6));
    const after = thermalBubbles(table, ROWS, map, settingsOf(fair, 1801, 6));
    const own = (b: Float32Array, i: number) =>
      [8, 9, 10].map(k => b[i * BUBBLE_FLOATS + k].toFixed(4)).join('|');
    const was = new Map<string, number>();
    for (let i = 0; i < before.count; i++) was.set(own(before.bubbles, i), i);
    let matched = 0;
    let worst = 0;
    for (let i = 0; i < after.count; i++) {
      const j = was.get(own(after.bubbles, i));
      if (j === undefined) continue;
      matched++;
      const [a, b] = [after.bubbles, before.bubbles];
      const step = Math.hypot(
        a[i * BUBBLE_FLOATS] - b[j * BUBBLE_FLOATS],
        a[i * BUBBLE_FLOATS + 1] - b[j * BUBBLE_FLOATS + 1],
        a[i * BUBBLE_FLOATS + 2] - b[j * BUBBLE_FLOATS + 2],
      );
      worst = Math.max(worst, step);
    }
    // A second on: the same bubbles, a few metres on, wherever they lie in the list.
    expect(matched).toBeGreaterThan(0.9 * Math.min(before.count, after.count));
    expect(worst).toBeLessThan(25);
  });

  it('bins every bubble wherever it reaches', () => {
    const field = thermalBubbles(table, ROWS, map, settingsOf(fair, 900, 5));
    const extent = atmosphereExtent(fair, table, ROWS);
    const [across, up] = [40, 16];
    const bins = binBubbles(field, 8000, extent, across, up);
    const size = 16000 / across;
    const depth = (extent[1] - extent[0]) / up;
    let checked = 0;
    let missing = '';
    for (let i = 0; i < 4000 && !missing; i++) {
      const x = ((i * 7919) % 16000) - 8000 + 0.5;
      const y = ((i * 104729) % 16000) - 8000 + 0.5;
      const z = extent[0] + ((i * 15485863) % 1000) / 1000 * (extent[1] - extent[0]);
      const bx = Math.min(Math.floor((x + 8000) / size), across - 1);
      const by = Math.min(Math.floor((y + 8000) / size), across - 1);
      const bz = Math.min(Math.floor((z - extent[0]) / depth), up - 1);
      const bin = (by * up + bz) * across + bx;
      const list = new Set(Array.from(bins.indices.subarray(bins.bins[2 * bin], bins.bins[2 * bin] + bins.bins[2 * bin + 1])));
      for (let b = 0; b < field.count; b++) {
        const o = b * BUBBLE_FLOATS;
        const [reach, reachUp] = bubbleReach(field.bubbles[o + 4], field.bubbles[o + 5], field.bubbles[o + 7]);
        const d2 = ((x - field.bubbles[o]) / reach) ** 2 + ((y - field.bubbles[o + 1]) / reach) ** 2 + ((z - field.bubbles[o + 2]) / reachUp) ** 2;
        if (d2 >= 1) continue;
        checked++;
        if (!list.has(b)) missing = `bubble ${b} at ${x}, ${y}, ${z}`;
      }
    }
    expect(missing).toBe('');
    expect(checked).toBeGreaterThan(100);
  });

  it('spreads sheets under the inversion, not below it', () => {
    let sheets = 0;
    let lowest = Infinity;
    for (const time of [1200, 2400, 3600]) {
      const field = thermalBubbles(table, ROWS, map, settingsOf(fair, time, 0));
      for (let b = 0; b < field.count; b++) {
        const o = b * BUBBLE_FLOATS;
        if (field.bubbles[o + 4] / field.bubbles[o + 7] < 2) continue;
        sheets++;
        lowest = Math.min(lowest, field.bubbles[o + 2]);
      }
    }
    expect(sheets).toBeGreaterThan(5);
    expect(lowest).toBeGreaterThan(fair.inversionHeight - 300);
  });

  it('heaps large cumulus of turrets, none broader than THERMAL_TURRET at its source', () => {
    const highest = liftThermal(fair, 1).top;
    let broadest = 0;
    let count = 0;
    for (const time of [1200, 2400, 3600]) {
      const field = thermalBubbles(table, ROWS, map, settingsOf(fair, time, 0));
      count += field.count;
      for (let b = 0; b < field.count; b++)
        broadest = Math.max(broadest, field.bubbles[b * BUBBLE_FLOATS + 7]);
    }
    expect(count).toBeGreaterThan(100);
    expect(broadest).toBeLessThanOrEqual(THERMAL_TURRET + THERMAL_GROWTH * highest + 1e-3);
  });
});
