import { describe, expect, it } from 'vitest';
import {
  WATER_FADE,
  WATER_OPACITY_DEPTH,
  WATER_OPTICS_PRESETS,
  waterExtinctionOf,
  waterOpticsOf,
  waterTransmittance,
} from '../src/sdk/weather/water-optics';

describe('water optics', () => {
  it('leaves 5 % of what lies a clarity away, red first in blue water', () => {
    const optics = WATER_OPTICS_PRESETS.realistic;
    const shown = waterTransmittance(waterExtinctionOf(optics), optics.clarity);
    const mean = Math.exp(
      (Math.log(shown[0]) + Math.log(shown[1]) + Math.log(shown[2])) / 3,
    );
    expect(mean).toBeCloseTo(0.05, 6);
    expect(shown[0]).toBeLessThan(shown[1]);
    expect(shown[1]).toBeLessThan(shown[2]);
    // Grey water takes all channels alike.
    const grey = waterExtinctionOf({ color: '#808080', clarity: 10 });
    expect(grey[0]).toBeCloseTo(grey[2], 9);
  });

  it('takes a preset by name, else the deprecated deep colour and fog density', () => {
    expect(waterOpticsOf('clear')).toEqual(WATER_OPTICS_PRESETS.clear);
    expect(waterOpticsOf()).toEqual(WATER_OPTICS_PRESETS.realistic);
    const legacy = waterOpticsOf(undefined, {
      deepColor: '#102030',
      bodyFogDensity: 0.004,
    });
    expect(legacy.color).toBe('#102030');
    expect(legacy.clarity).toBeCloseTo(WATER_FADE / 0.004, 9);
    // Its own wins over both, what it leaves out from the default preset.
    expect(
      waterOpticsOf({ clarity: 30 }, { bodyFogDensity: 0.004 }).clarity,
    ).toBe(30);
  });

  it('takes a deprecated waterOpacity as the clarity that hides that share over 10 m', () => {
    const optics = waterOpticsOf(undefined, { waterOpacity: 0.7 });
    const shown = waterTransmittance(
      waterExtinctionOf(optics),
      WATER_OPACITY_DEPTH,
    );
    const mean = Math.exp(
      (Math.log(shown[0]) + Math.log(shown[1]) + Math.log(shown[2])) / 3,
    );
    expect(mean).toBeCloseTo(0.3, 6);
    // Clamped at the ends; the fog density wins over it.
    expect(waterOpticsOf(undefined, { waterOpacity: 0 }).clarity).toBe(1000);
    expect(waterOpticsOf(undefined, { waterOpacity: 1 }).clarity).toBe(1);
    expect(
      waterOpticsOf(undefined, { waterOpacity: 0.7, bodyFogDensity: 0.05 })
        .clarity,
    ).toBeCloseTo(WATER_FADE / 0.05, 9);
  });
});
