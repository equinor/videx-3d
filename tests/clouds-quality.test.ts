import { describe, expect, it } from 'vitest';
import {
  CLOUDS_LOOKS,
  CLOUDS_QUALITY,
  cloudsGustyLook,
  cloudsLight,
  cloudsQuality,
} from '../src/components/Scenery/scenery-clouds';
import { cloudLevelOf, type CloudType } from '../src/sdk/weather/weather';

const ORDER = ['low', 'medium', 'high', 'ultra'] as const;

describe('cloudsQuality', () => {
  it('spends more from low to ultra', () => {
    for (let i = 1; i < ORDER.length; i++) {
      const less = CLOUDS_QUALITY[ORDER[i - 1]];
      const more = CLOUDS_QUALITY[ORDER[i]];
      expect(more.resolution).toBeGreaterThanOrEqual(less.resolution);
      expect(more.steps).toBeGreaterThan(less.steps);
      expect(more.lightSamples).toBeGreaterThanOrEqual(less.lightSamples);
      expect(more.shapeReads).toBeGreaterThanOrEqual(less.shapeReads);
      expect(more.shadowSize).toBeGreaterThanOrEqual(less.shadowSize);
    }
  });

  it('is the level as it is without overrides', () => {
    expect(cloudsQuality('medium')).toEqual(CLOUDS_QUALITY.medium);
  });

  it('takes a resolution of its own and keeps the rest', () => {
    const level = cloudsQuality('low', { resolution: 0.8 });
    expect(level).toEqual({ ...CLOUDS_QUALITY.low, resolution: 0.8 });
  });

  it('takes a temporal of its own and keeps the rest', () => {
    const level = cloudsQuality('high', { temporal: 'off' });
    expect(level).toEqual({ ...CLOUDS_QUALITY.high, temporal: 'off' });
    expect(cloudsQuality('high', { temporal: undefined })).toEqual(
      CLOUDS_QUALITY.high,
    );
  });
});

describe('CLOUDS_LOOKS', () => {
  it('draws the high ice thinner than any low cloud, and cirrus drawn out most', () => {
    const types = Object.keys(CLOUDS_LOOKS) as CloudType[];
    const low = types.filter(type => cloudLevelOf(type) === 'low');
    const high = types.filter(type => cloudLevelOf(type) === 'high');
    const thinnestLow = Math.min(
      ...low.map(type => CLOUDS_LOOKS[type].extinction),
    );
    for (const type of high)
      expect(CLOUDS_LOOKS[type].extinction).toBeLessThan(thinnestLow);
    const stretch = types.map(type => CLOUDS_LOOKS[type].stretch);
    expect(CLOUDS_LOOKS.cirrus.stretch).toBe(Math.max(...stretch));
  });

  it('keeps every look within its ranges', () => {
    for (const look of Object.values(CLOUDS_LOOKS)) {
      expect(look.scale).toBeGreaterThan(0);
      expect(look.stretch).toBeGreaterThanOrEqual(1);
      for (const share of [look.softness, look.lumps, look.towering])
        expect(share).toBeGreaterThanOrEqual(0);
      expect(look.masses).toBeGreaterThanOrEqual(0);
      expect(look.masses).toBeLessThanOrEqual(1.5);
      expect(look.extinction).toBeGreaterThan(0);
      expect(look.lifetime).toBeGreaterThan(0);
      expect(look.rise).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('cloudsGustyLook', () => {
  const cumulus = CLOUDS_LOOKS.cumulus;
  const breeze = { speed: 10, from: 240 };

  it('leaves the look as it is without wind, without gusts, and aloft', () => {
    expect(cloudsGustyLook(cumulus, 'low', null)).toBe(cumulus);
    expect(
      cloudsGustyLook(cumulus, 'low', { ...breeze, gusts: { strength: 0 } }),
    ).toBe(cumulus);
    expect(cloudsGustyLook(CLOUDS_LOOKS.cirrus, 'high', breeze)).toBe(
      CLOUDS_LOOKS.cirrus,
    );
  });

  it('makes low clouds shorter-lived, boiling and ragged, the middle level half as much', () => {
    const low = cloudsGustyLook(cumulus, 'low', breeze);
    // A fresh breeze: twenty minutes to some fourteen.
    expect(low.lifetime / 60).toBeCloseTo(13.6, 1);
    expect(low.rise).toBeGreaterThan(cumulus.rise);
    expect(low.softness).toBeGreaterThan(cumulus.softness);
    expect(low.stretch).toBeGreaterThan(cumulus.stretch);
    const mid = cloudsGustyLook(cumulus, 'mid', breeze);
    expect(mid.lifetime).toBeGreaterThan(low.lifetime);
    expect(mid.lifetime).toBeLessThan(cumulus.lifetime);
    // Gustier air, more so.
    const gale = cloudsGustyLook(cumulus, 'low', { speed: 25, from: 240 });
    expect(gale.lifetime).toBeCloseTo(cumulus.lifetime / 2, 5);
  });
});

describe('cloudsLight', () => {
  const level = (
    type: CloudType,
    cover: number,
    base: number,
    top: number,
  ) => ({
    layer: { type, cover, base, top },
    look: CLOUDS_LOOKS[type],
  });
  const sun = Math.sin((35 * Math.PI) / 180);

  it('keeps all of the light under a clear sky', () => {
    expect(cloudsLight([], 1, sun)).toBe(1);
    expect(cloudsLight([level('cumulus', 0, 1200, 2400)], 1, sun)).toBe(1);
  });

  it('keeps most of it under scattered cloud, little under overcast', () => {
    const scattered = cloudsLight([level('cumulus', 0.44, 1200, 2400)], 1, sun);
    const overcast = cloudsLight([level('stratus', 1, 250, 600)], 1, sun);
    expect(scattered).toBeGreaterThan(0.7);
    expect(scattered).toBeLessThan(1);
    expect(overcast).toBeLessThan(0.05);
  });

  it('takes more of a low sun, and more for each level over the scene', () => {
    const one = [level('altostratus', 0.6, 4200, 5400)];
    const two = [...one, level('cirrostratus', 0.6, 8200, 9000)];
    expect(cloudsLight(one, 1, 0.1)).toBeLessThan(cloudsLight(one, 1, sun));
    expect(cloudsLight(two, 1, sun)).toBeLessThan(cloudsLight(one, 1, sun));
  });
});
