import { describe, expect, it } from 'vitest';
import {
  CLOUD_VOLUME_LOOKS,
  CLOUD_VOLUME_QUALITY,
  cloudVolumeLight,
  cloudVolumeQuality,
} from '../src/components/Scenery/scenery-cloud-volume';
import { cloudLevelOf, type CloudType } from '../src/sdk/weather/weather';

const ORDER = ['low', 'medium', 'high', 'ultra'] as const;

describe('cloudVolumeQuality', () => {
  it('spends more from low to ultra', () => {
    for (let i = 1; i < ORDER.length; i++) {
      const less = CLOUD_VOLUME_QUALITY[ORDER[i - 1]];
      const more = CLOUD_VOLUME_QUALITY[ORDER[i]];
      expect(more.resolution).toBeGreaterThanOrEqual(less.resolution);
      expect(more.steps).toBeGreaterThan(less.steps);
      expect(more.lightSamples).toBeGreaterThanOrEqual(less.lightSamples);
    }
  });

  it('is the level as it is without overrides', () => {
    expect(cloudVolumeQuality('medium')).toEqual(CLOUD_VOLUME_QUALITY.medium);
  });

  it('takes a resolution of its own and keeps the rest', () => {
    const level = cloudVolumeQuality('low', { resolution: 0.8 });
    expect(level).toEqual({ ...CLOUD_VOLUME_QUALITY.low, resolution: 0.8 });
  });
});

describe('CLOUD_VOLUME_LOOKS', () => {
  it('draws the high ice thinner than any low cloud, and cirrus drawn out most', () => {
    const types = Object.keys(CLOUD_VOLUME_LOOKS) as CloudType[];
    const low = types.filter(type => cloudLevelOf(type) === 'low');
    const high = types.filter(type => cloudLevelOf(type) === 'high');
    const thinnestLow = Math.min(
      ...low.map(type => CLOUD_VOLUME_LOOKS[type].extinction),
    );
    for (const type of high)
      expect(CLOUD_VOLUME_LOOKS[type].extinction).toBeLessThan(thinnestLow);
    const stretch = types.map(type => CLOUD_VOLUME_LOOKS[type].stretch);
    expect(CLOUD_VOLUME_LOOKS.cirrus.stretch).toBe(Math.max(...stretch));
  });

  it('keeps every look within its ranges', () => {
    for (const look of Object.values(CLOUD_VOLUME_LOOKS)) {
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

describe('cloudVolumeLight', () => {
  const level = (
    type: CloudType,
    cover: number,
    base: number,
    top: number,
  ) => ({
    layer: { type, cover, base, top },
    look: CLOUD_VOLUME_LOOKS[type],
  });
  const sun = Math.sin((35 * Math.PI) / 180);

  it('keeps all of the light under a clear sky', () => {
    expect(cloudVolumeLight([], 1, sun)).toBe(1);
    expect(cloudVolumeLight([level('cumulus', 0, 1200, 2400)], 1, sun)).toBe(1);
  });

  it('keeps most of it under scattered cloud, little under overcast', () => {
    const scattered = cloudVolumeLight(
      [level('cumulus', 0.44, 1200, 2400)],
      1,
      sun,
    );
    const overcast = cloudVolumeLight([level('stratus', 1, 250, 600)], 1, sun);
    expect(scattered).toBeGreaterThan(0.7);
    expect(scattered).toBeLessThan(1);
    expect(overcast).toBeLessThan(0.05);
  });

  it('takes more of a low sun, and more for each level over the scene', () => {
    const one = [level('altostratus', 0.6, 4200, 5400)];
    const two = [...one, level('cirrostratus', 0.6, 8200, 9000)];
    expect(cloudVolumeLight(one, 1, 0.1)).toBeLessThan(
      cloudVolumeLight(one, 1, sun),
    );
    expect(cloudVolumeLight(two, 1, sun)).toBeLessThan(
      cloudVolumeLight(one, 1, sun),
    );
  });
});
