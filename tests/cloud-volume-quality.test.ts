import { describe, expect, it } from 'vitest';
import {
  CLOUD_VOLUME_QUALITY,
  cloudVolumeQuality,
} from '../src/components/Scenery/scenery-cloud-volume';

const ORDER = ['low', 'medium', 'high', 'ultra'] as const;

describe('cloudVolumeQuality', () => {
  it('spends more from low to ultra', () => {
    for (let i = 1; i < ORDER.length; i++) {
      const less = CLOUD_VOLUME_QUALITY[ORDER[i - 1]];
      const more = CLOUD_VOLUME_QUALITY[ORDER[i]];
      expect(more.resolution).toBeGreaterThanOrEqual(less.resolution);
      expect(more.rays).toBeGreaterThan(less.rays);
      expect(more.steps).toBeGreaterThanOrEqual(less.steps);
    }
  });

  it('is the level as it is without overrides', () => {
    expect(cloudVolumeQuality('medium')).toEqual(CLOUD_VOLUME_QUALITY.medium);
  });

  it('takes a resolution of its own without the budget of rays', () => {
    const level = cloudVolumeQuality('low', { resolution: 0.8 });
    expect(level.resolution).toBe(0.8);
    expect(level.rays).toBe(Infinity);
    expect(level.sparse).toBe(CLOUD_VOLUME_QUALITY.low.sparse);
    expect(level.steps).toBe(CLOUD_VOLUME_QUALITY.low.steps);
  });

  it('takes steps of its own and keeps the budget', () => {
    const level = cloudVolumeQuality('medium', { steps: 20 });
    expect(level.steps).toBe(20);
    expect(level.rays).toBe(CLOUD_VOLUME_QUALITY.medium.rays);
  });
});
