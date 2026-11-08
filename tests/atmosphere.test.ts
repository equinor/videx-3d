import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_LEVELS,
  ATMOSPHERE_PRESETS,
  ATMOSPHERE_STEP,
  ATMOSPHERE_TIME_STEP,
  atmosphereExtent,
  atmosphereTable,
  bubbleShape,
  condensationHeight,
  courseAloft,
  environmentCondensate,
  liftThermal,
  moistStability,
  THERMAL_MIXING,
  THERMAL_STABLE,
  THERMAL_TURRET,
  thermalBubble,
  thermalCondensate,
  thermalLife,
  thermalRadius,
  type Atmosphere,
  type ThermalLife,
} from '../src/sdk/weather/atmosphere';

const extentOf = (name: keyof typeof ATMOSPHERE_PRESETS) => {
  const a = ATMOSPHERE_PRESETS[name];
  return atmosphereExtent(a, atmosphereTable(a, 32), 32);
};

describe('atmosphere', () => {
  it('condenses a surface parcel 125 m up per kelvin of dew point depression', () => {
    expect(condensationHeight(20, 12)).toBe(1000);
    expect(condensationHeight(10, 12)).toBe(0);
  });

  it('bases thermals at the condensation height', () => {
    const fair = ATMOSPHERE_PRESETS.fair;
    const { base } = liftThermal(fair, 0.5);
    const lcl = condensationHeight(fair.temperature, fair.dewPoint);
    expect(Math.abs(base - lcl)).toBeLessThan(200);
  });

  it('caps fair weather cumulus near its inversion, in many sizes', () => {
    const fair = ATMOSPHERE_PRESETS.fair;
    const tops = [0.25, 0.5, 0.75, 1].map(s => liftThermal(fair, s).top);
    expect(tops[0]).toBeLessThan(fair.inversionHeight - 500);
    expect(Math.max(...tops)).toBeLessThan(fair.inversionHeight + 1000);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  it('lets strong thermals tower in unstable air', () => {
    expect(liftThermal(ATMOSPHERE_PRESETS.unstable, 1).top).toBeGreaterThan(6000);
    expect(liftThermal(ATMOSPHERE_PRESETS.unstable, 0).top).toBeLessThan(2500);
  });

  it('saturates fog from the ground', () => {
    expect(environmentCondensate(ATMOSPHERE_PRESETS.fog, 50).condensate).toBeGreaterThan(0);
    expect(extentOf('fog')[0]).toBe(0);
  });

  it('lays the altostratus veil alone, near 4 km', () => {
    const [bottom, top] = extentOf('altostratus');
    expect(bottom).toBeGreaterThan(3500);
    expect(top).toBeLessThan(5000);
    const alto = ATMOSPHERE_PRESETS.altostratus;
    expect(environmentCondensate(alto, 4250).condensate).toBeGreaterThan(0);
    expect(environmentCondensate(alto, 2000).condensate).toBeLessThan(0);
  });

  it('spans a low veil finely', () => {
    const [bottom, top] = extentOf('stratus-veil');
    expect(top - bottom).toBeLessThan(800);
    expect(bottom).toBeLessThan(375);
  });
});

// The heights a thermal's cloud spans on its axis (m), or null where it has none.
const cloudOf = (a: Atmosphere, life: ThermalLife, pulses: number, age: number) => {
  let low = Infinity;
  let high = -Infinity;
  for (let z = 0; z <= 10000; z += 25)
    if (thermalCondensate(a, life, pulses, age, z) > 0) {
      low = Math.min(low, z);
      high = Math.max(high, z);
    }
  return low <= high ? [low, high] : null;
};

// How long a thermal's cloud outlives its last bubble's stopping (s), looked for a minute at a time.
const outlives = (a: Atmosphere, life: ThermalLife, pulses: number) => {
  const stop = (pulses - 1) * life.pulse + life.lift.topTime;
  for (let after = 0; after < 6 * 3600; after += 60)
    if (!cloudOf(a, life, pulses, stop + after)) return after;
  return Infinity;
};

describe('thermal life', () => {
  const fair = ATMOSPHERE_PRESETS.fair;

  it('rises a bubble to its top, then settles it back to where it stopped being buoyant', () => {
    const life = thermalLife(fair, 0.5);
    const heights = [0, 0.25, 0.5, 0.75, 1].map(
      share => thermalBubble(life, share * life.lift.topTime).height,
    );
    expect(heights[0]).toBe(0);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(heights[3]).toBeLessThan(life.lift.top);
    expect(heights[4]).toBe(life.lift.top);
    const settled = thermalBubble(life, life.lift.topTime + 10 * life.mixing).height;
    expect(life.lift.neutral).toBeLessThan(life.lift.top);
    expect(Math.abs(settled - life.lift.neutral)).toBeLessThan(25);
    // Under an inversion: at its base.
    expect(Math.abs(life.lift.neutral - fair.inversionHeight)).toBeLessThan(100);
  });

  it('flattens and spreads a bubble once it has stopped', () => {
    const life = thermalLife(fair, 0.5);
    const stopped = thermalBubble(life, life.lift.topTime);
    const later = thermalBubble(life, life.lift.topTime + life.mixing);
    expect(later.across).toBeGreaterThan(1.5 * stopped.across);
    expect(later.up).toBeLessThan(0.75 * stopped.up);
    expect(later.kept).toBeLessThan(0.5);
  });

  it('keeps a spreading bubble’s water, thinning it once it is a sheet', () => {
    const r = 600;
    const mixing = 400;
    let widest = 0;
    let worst = 0;
    for (let stopped = 0; stopped <= 6000; stopped += 50) {
      const shape = bubbleShape(r, stopped, mixing, 1);
      widest = Math.max(widest, shape.across / r);
      worst = Math.max(worst, Math.abs((shape.across ** 2 * shape.up * shape.dilution) / r ** 3 - 1));
    }
    expect(worst).toBeLessThan(1e-9);
    expect(widest).toBeGreaterThan(3.5);
  });

  it('spreads a bubble into a sheet only where stable air stops it', () => {
    // An inversion is stable for cloud; the conditionally unstable air under it is not.
    expect(moistStability(fair, fair.inversionHeight + 50)).toBeGreaterThan(THERMAL_STABLE[1]);
    const between = 0.5 * (fair.mixedLayer + fair.inversionHeight);
    expect(moistStability(fair, between)).toBeLessThan(THERMAL_STABLE[0]);
    const capped = thermalLife(fair, 0.5);
    const weak = thermalLife(fair, 0.25);
    expect(weak.lift.top).toBeLessThan(fair.inversionHeight - 300);
    expect(capped.spreads).toBeGreaterThan(0.9);
    expect(weak.spreads).toBeLessThan(0.1);
    // Long stopped: the capped one a wide sheet, the weak one as round as it stopped.
    const late = (life: ThermalLife) => thermalBubble(life, life.lift.topTime + 3 * life.mixing);
    expect(late(capped).across / late(capped).up).toBeGreaterThan(8);
    expect(late(weak).across / late(weak).up).toBeLessThan(1.2);
  });

  it('tables the air’s stability, as the bubbles’ listing spreads them by', () => {
    const rows = 32;
    const table = atmosphereTable(fair, rows);
    let worst = 0;
    for (let i = 0; i < ATMOSPHERE_LEVELS; i += 7) {
      const tabled = table[4 * (rows * ATMOSPHERE_LEVELS + i) + 2];
      worst = Math.max(worst, Math.abs(tabled - moistStability(fair, i * ATMOSPHERE_STEP)));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('releases a broad thermal’s bubbles as turrets, mixing away as one cloud', () => {
    const broad = thermalLife(fair, 1);
    expect(thermalRadius(1)).toBeGreaterThan(THERMAL_TURRET);
    expect(broad.radius).toBe(THERMAL_TURRET);
    expect(broad.mixing).toBeGreaterThanOrEqual(thermalRadius(1) / THERMAL_MIXING);
    expect(thermalLife(fair, 0.3).radius).toBe(thermalRadius(0.3));
  });

  it('spreads a cumulus losing its lift into a lasting sheet in moist air, not in dry', () => {
    const moist = ATMOSPHERE_PRESETS.spreading;
    const dry = { ...moist, humidity: 0.75 };
    const life = thermalLife(moist, 0.5);
    const moistLasts = outlives(moist, life, 4);
    const dryLasts = outlives(dry, thermalLife(dry, 0.5), 4);
    expect(moistLasts).toBeGreaterThan(2 * dryLasts);
    const last = 3 * life.pulse;
    const stopping = thermalBubble(life, life.lift.topTime);
    const sheet = thermalBubble(life, life.lift.topTime + moistLasts - 60 + last);
    expect(sheet.across).toBeGreaterThan(2.5 * stopping.across);
    expect(sheet.up).toBeLessThan(0.3 * stopping.up);
  });

  it('lifts its base once its source gives out', () => {
    const life = thermalLife(fair, 0.5);
    const pulses = 4;
    const last = (pulses - 1) * life.pulse;
    const fed = cloudOf(fair, life, pulses, last + 0.25 * life.lift.topTime);
    const later = cloudOf(fair, life, pulses, last + 0.5 * life.lift.topTime);
    expect(fed).not.toBeNull();
    expect(later).not.toBeNull();
    expect(Math.abs(fed![0] - life.lift.base)).toBeLessThan(100);
    expect(later![0]).toBeGreaterThan(fed![0] + 300);
  });

  it('evaporates the sooner the drier the air about it', () => {
    const humid = { ...fair, humidity: 0.9 };
    const dry = outlives(fair, thermalLife(fair, 0.5), 4);
    const moist = outlives(humid, thermalLife(humid, 0.5), 4);
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThan(1200);
    expect(moist).toBeGreaterThan(1.5 * dry);
  });

  it('keeps its cloud in saturated air', () => {
    const saturated = { ...fair, humidity: 1 };
    const life = thermalLife(saturated, 0.5);
    const stop = 3 * life.pulse + life.lift.topTime;
    const dry = outlives(fair, thermalLife(fair, 0.5), 4);
    expect(cloudOf(saturated, life, 4, stop + 4 * dry)).not.toBeNull();
  });

  it('carries a bubble downwind with the shear, the more the longer it has been aloft', () => {
    const calm = thermalLife({ ...fair, shear: 0 }, 0.5);
    const sheared = thermalLife({ ...fair, shear: 2 }, 0.5);
    const top = sheared.lift.topTime;
    expect(thermalBubble(calm, 2 * top).lean).toBe(0);
    const rising = thermalBubble(sheared, 0.5 * top).lean;
    const stopped = thermalBubble(sheared, top).lean;
    const later = thermalBubble(sheared, top + 600).lean;
    expect(rising).toBeGreaterThan(0);
    expect(stopped).toBeGreaterThan(rising);
    // Stopped, at the shear's wind at its top over the mixed layer's.
    const carried = 600 * sheared.shear * (sheared.lift.top - sheared.mixedTop);
    expect(Math.abs(later - stopped - carried)).toBeLessThan(0.01 * carried);
  });

  it('tables the time aloft the bake carries the bubbles by', () => {
    const rows = 32;
    const row = 20;
    const table = atmosphereTable(fair, rows);
    const lift = liftThermal(fair, row / (rows - 1));
    const mixedTop = Math.min(fair.mixedLayer, fair.inversionHeight);
    for (const j of [30, 90, 200]) {
      const tabled = table[4 * ((rows + 1 + row) * ATMOSPHERE_LEVELS + j) + 1];
      const aloft = courseAloft(lift, mixedTop, j * ATMOSPHERE_TIME_STEP);
      expect(Math.abs(tabled - aloft)).toBeLessThanOrEqual(1e-4 * Math.max(aloft, 1));
    }
  });
});
