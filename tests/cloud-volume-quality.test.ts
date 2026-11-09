import { describe, expect, it } from 'vitest';
import {
  CLOUD_VOLUME_LOOKS,
  CLOUD_VOLUME_QUALITY,
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
    }
  });
});
