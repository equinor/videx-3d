import { describe, expect, it } from 'vitest';
import {
  CLOUD_VOLUME_QUALITY,
  cloudVolumeFormOf,
  cloudVolumeQuality,
} from '../src/components/Scenery/scenery-cloud-volume';

const ORDER = ['low', 'medium', 'high', 'ultra'] as const;

describe('cloudVolumeQuality', () => {
  it('spends more from low to ultra', () => {
    for (let i = 1; i < ORDER.length; i++) {
      const less = CLOUD_VOLUME_QUALITY[ORDER[i - 1]];
      const more = CLOUD_VOLUME_QUALITY[ORDER[i]];
      expect(more.resolution).toBeGreaterThanOrEqual(less.resolution);
      expect(more.iterations).toBeGreaterThan(less.iterations);
      expect(more.samples).toBeGreaterThanOrEqual(less.samples);
      expect(more.lightSamples).toBeGreaterThanOrEqual(less.lightSamples);
      expect(more.stratoSamples).toBeGreaterThanOrEqual(less.stratoSamples);
      expect(more.softSamples).toBeGreaterThan(less.softSamples);
      expect(more.softLightSamples).toBeGreaterThanOrEqual(
        less.softLightSamples,
      );
      // Drawn as themselves down to smaller clouds.
      expect(more.pixels).toBeLessThanOrEqual(less.pixels);
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

describe('cloudVolumeFormOf', () => {
  it('draws cumulus as cumulus and the low decks as strato', () => {
    expect(cloudVolumeFormOf('cumulus')).toBe('cumulus');
    expect(cloudVolumeFormOf('stratus')).toBe('strato');
    expect(cloudVolumeFormOf('stratocumulus')).toBe('strato');
    expect(cloudVolumeFormOf('nimbostratus')).toBe('strato');
  });

  it('draws none of the middle and high types yet', () => {
    for (const type of [
      'altocumulus',
      'altostratus',
      'cirrus',
      'cirrostratus',
    ] as const)
      expect(cloudVolumeFormOf(type)).toBeNull();
  });
});
