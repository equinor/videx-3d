import { describe, expect, it } from 'vitest';
import {
  CLOUD_TYPE_CHAINS,
  CLOUD_VOLUME_LAYERS,
  cloudTypeMix,
  cloudTypeSpan,
} from '../src/components/Scenery/scenery-cloud-volume';
import {
  CLOUD_LEVELS,
  CLOUD_TYPE_HEIGHTS,
  cloudLevelOf,
  type CloudType,
} from '../src/sdk/weather/weather';

const TYPES = Object.keys(CLOUD_TYPE_HEIGHTS) as CloudType[];

describe('CLOUD_TYPE_CHAINS', () => {
  it('keeps each chain to its level, within the march’s room for types', () => {
    for (const level of CLOUD_LEVELS) {
      const chain = CLOUD_TYPE_CHAINS[level];
      expect(chain.length).toBeLessThanOrEqual(3);
      for (const type of chain) expect(cloudLevelOf(type)).toBe(level);
    }
    expect(CLOUD_LEVELS.length).toBe(CLOUD_VOLUME_LAYERS);
  });
});

describe('cloudTypeMix', () => {
  it('stays on its own type with no cover', () => {
    for (const type of TYPES) {
      const { chain, place } = cloudTypeMix(type, 0);
      expect(chain[place]).toBe(type);
    }
  });

  it('keeps nimbostratus a chain of its own', () => {
    expect(cloudTypeMix('nimbostratus', 1)).toEqual({
      chain: ['nimbostratus'],
      place: 0,
    });
  });

  it('spreads cumulus into stratocumulus as they close up', () => {
    const few = cloudTypeMix('cumulus', 0.2).place;
    const broken = cloudTypeMix('cumulus', 0.75).place;
    const overcast = cloudTypeMix('cumulus', 1).place;
    expect(few).toBe(0);
    expect(broken).toBeGreaterThan(0);
    expect(overcast).toBeGreaterThan(broken);
    expect(overcast).toBeLessThan(1);
  });

  it('breaks stratus into stratocumulus as it thins, and keeps an overcast whole', () => {
    expect(cloudTypeMix('stratus', 1).place).toBe(2);
    const broken = cloudTypeMix('stratus', 0.75).place;
    expect(broken).toBeLessThan(2);
    expect(broken).toBeGreaterThan(1);
  });

  it('never leaves its chain, nor moves past a neighbour', () => {
    for (const type of TYPES)
      for (let cover = 0; cover <= 1; cover += 0.05) {
        const { chain, place } = cloudTypeMix(type, cover);
        const own = chain.indexOf(type);
        expect(place).toBeGreaterThanOrEqual(Math.max(own - 1, 0));
        expect(place).toBeLessThanOrEqual(Math.min(own + 1, chain.length - 1));
      }
  });
});

describe('cloudTypeSpan', () => {
  const cumulus = {
    type: 'cumulus',
    cover: 0.75,
    base: 1200,
    top: 3050,
  } as const;

  it('gives a layer’s own type all of it', () => {
    expect(cloudTypeSpan('cumulus', cumulus)).toEqual([0, 1]);
  });

  it('lays a neighbour’s deck under the layer’s top, as thick as that type lies', () => {
    const [low, high] = cloudTypeSpan('stratocumulus', cumulus);
    expect(high).toBe(1);
    const { base, top } = CLOUD_TYPE_HEIGHTS.stratocumulus;
    const thick = top[0] + (top[1] - top[0]) * cumulus.cover - base;
    expect((high - low) * (cumulus.top - cumulus.base)).toBeCloseTo(thick, 6);
  });

  it('lays stratus on the layer’s base, and never past the layer', () => {
    const deck = {
      type: 'stratocumulus',
      cover: 0.5,
      base: 900,
      top: 1100,
    } as const;
    expect(cloudTypeSpan('stratus', deck)).toEqual([0, 1]);
    expect(cloudTypeSpan('cumulus', deck)).toEqual([0, 1]);
  });
});
