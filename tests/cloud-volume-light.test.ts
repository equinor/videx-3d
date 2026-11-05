import { describe, expect, it } from 'vitest';
import { cloudVolumeLight } from '../src/components/Scenery/scenery-cloud-volume';
import { cloudLayersOf, type CloudLayer } from '../src/sdk/weather/weather';

const HIGH = Math.sin((35 * Math.PI) / 180);

describe('cloudVolumeLight', () => {
  it('lets all the light through a clear sky', () => {
    expect(cloudVolumeLight([], 1, HIGH)).toBe(1);
    expect(cloudVolumeLight(cloudLayersOf('clear'), 1, HIGH)).toBe(1);
  });

  it('dims the light more the more the sky is covered', () => {
    const light = (['few', 'scattered', 'broken', 'overcast'] as const).map(
      cover => cloudVolumeLight(cloudLayersOf(cover), 1, HIGH),
    );
    for (let i = 1; i < light.length; i++)
      expect(light[i]).toBeLessThan(light[i - 1]);
    // Scattered cloud keeps most of the sun; overcast takes it.
    expect(light[1]).toBeGreaterThan(0.7);
    expect(light[3]).toBeLessThan(0.05);
  });

  it('dims a thin sheet less, and more with the sun low', () => {
    const sheet: CloudLayer[] = [
      { type: 'stratus', cover: 1, base: 1000, top: 1050 },
    ];
    const high = cloudVolumeLight(sheet, 1, HIGH);
    expect(high).toBeGreaterThan(0.2);
    expect(cloudVolumeLight(sheet, 1, 0.1)).toBeLessThan(high);
    expect(cloudVolumeLight(sheet, 0.5, HIGH)).toBeGreaterThan(high);
  });

  it('takes one layer a level, as the clouds draw them', () => {
    const layer: CloudLayer = {
      type: 'stratus',
      cover: 1,
      base: 500,
      top: 520,
    };
    expect(cloudVolumeLight([layer, layer, layer], 1, HIGH)).toBeCloseTo(
      cloudVolumeLight([layer], 1, HIGH),
      12,
    );
    // A layer at another level dims it further.
    const veil: CloudLayer = {
      type: 'cirrostratus',
      cover: 1,
      base: 9000,
      top: 9300,
    };
    expect(cloudVolumeLight([layer, veil], 1, HIGH)).toBeLessThan(
      cloudVolumeLight([layer], 1, HIGH),
    );
  });

  it('lets more through a high veil than a deck of the same cover', () => {
    const veil = cloudVolumeLight(cloudLayersOf('overcast cirrostratus'), 1, HIGH);
    const deck = cloudVolumeLight(cloudLayersOf('overcast'), 1, HIGH);
    expect(veil).toBeGreaterThan(0.5);
    expect(deck).toBeLessThan(veil);
  });
});
