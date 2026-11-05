import { describe, expect, it } from 'vitest';
import {
  CLOUD_COVER_OKTAS,
  CLOUD_LEVELS,
  CLOUD_TYPE_HEIGHTS,
  cloudCoverOf,
  cloudLayerPreset,
  cloudLayersByLevel,
  cloudLayersOf,
  cloudLayerWind,
  cloudLevelOf,
  cloudStreetsOf,
  cloudWindAt,
  isSkyPreset,
  oktasToCover,
  SKY_PRESETS,
  WEATHER_SYSTEMS_DEFAULTS,
  weatherOceanWind,
  weatherPreset,
  weatherSystemsOf,
  windToward,
  type CloudLevel,
  type CloudType,
  type SkyPreset,
} from '../src/sdk/weather/weather';

describe('cloud cover', () => {
  it('reads each report back as itself from the middle of its oktas', () => {
    for (const cover of Object.keys(
      CLOUD_COVER_OKTAS,
    ) as (keyof typeof CLOUD_COVER_OKTAS)[]) {
      const layer = cloudLayerPreset(cover);
      expect(cloudCoverOf(layer?.cover ?? 0)).toBe(cover);
    }
  });

  it('turns oktas into a share of the sky, clamped', () => {
    expect(oktasToCover(4)).toBe(0.5);
    expect(oktasToCover(-1)).toBe(0);
    expect(oktasToCover(9)).toBe(1);
  });

  it('makes no layer for a clear sky, and a full one for overcast', () => {
    expect(cloudLayerPreset('clear')).toBeNull();
    expect(weatherPreset('clear').clouds).toEqual([]);
    expect(cloudLayerPreset('overcast', 'stratus')?.cover).toBe(1);
  });

  it('grows cumulus taller the more they cover, and keeps stratus thin and low', () => {
    const few = cloudLayerPreset('few', 'cumulus')!;
    const broken = cloudLayerPreset('broken', 'cumulus')!;
    expect(broken.top).toBeGreaterThan(few.top);
    expect(few.base).toBe(broken.base);
    const stratus = cloudLayerPreset('broken', 'stratus')!;
    expect(stratus.top).toBeLessThan(few.base);
  });

  it('names layers by cover, cumulus unless the type follows', () => {
    expect(cloudLayersOf('clear')).toEqual([]);
    expect(cloudLayersOf('clear stratus')).toEqual([]);
    expect(cloudLayersOf('broken')).toEqual([cloudLayerPreset('broken')]);
    expect(cloudLayersOf('overcast stratus')).toEqual([
      cloudLayerPreset('overcast', 'stratus'),
    ]);
  });

  it('names skies, which win over a cover of the same name', () => {
    expect(isSkyPreset('warm-front')).toBe(true);
    expect(isSkyPreset('broken')).toBe(false);
    expect(isSkyPreset('toString')).toBe(false);
    expect(cloudLayersOf('scattered')).toEqual([cloudLayerPreset('scattered')]);
    expect(cloudLayersOf('overcast')).toEqual([
      cloudLayerPreset('overcast', 'stratocumulus'),
    ]);
    expect(cloudLayersOf('overcast cumulus')).toEqual([
      cloudLayerPreset('overcast', 'cumulus'),
    ]);
    expect(cloudLayersOf('warm-front').map(layer => layer.type)).toEqual([
      'altostratus',
      'cirrostratus',
    ]);
  });

  it('lays every sky at most one layer to a level', () => {
    for (const sky of Object.keys(SKY_PRESETS) as SkyPreset[]) {
      const layers = cloudLayersOf(sky);
      const levels = layers.map(layer => cloudLevelOf(layer.type));
      expect(new Set(levels).size).toBe(levels.length);
    }
  });
});

describe('cloud levels', () => {
  it('puts each type at its level, and no two levels’ heights overlap', () => {
    const span: Record<CloudLevel, [number, number]> = {
      low: [Infinity, -Infinity],
      mid: [Infinity, -Infinity],
      high: [Infinity, -Infinity],
    };
    for (const type of Object.keys(CLOUD_TYPE_HEIGHTS) as CloudType[]) {
      const { base, top } = CLOUD_TYPE_HEIGHTS[type];
      const level = span[cloudLevelOf(type)];
      level[0] = Math.min(level[0], base);
      level[1] = Math.max(level[1], top[1]);
      expect(top[0]).toBeGreaterThan(base);
      expect(top[1]).toBeGreaterThanOrEqual(top[0]);
    }
    expect(CLOUD_LEVELS).toEqual(['low', 'mid', 'high']);
    expect(span.low[1]).toBeLessThan(span.mid[0]);
    expect(span.mid[1]).toBeLessThan(span.high[0]);
  });

  it('draws one layer a level, in order, the one covering most', () => {
    const cirrus = cloudLayerPreset('few', 'cirrus')!;
    const stratus = cloudLayerPreset('broken', 'stratus')!;
    const cumulus = cloudLayerPreset('scattered', 'cumulus')!;
    expect(cloudLayersByLevel([cirrus, cumulus, stratus])).toEqual([
      stratus,
      null,
      cirrus,
    ]);
    expect(cloudLayersByLevel([])).toEqual([null, null, null]);
    // The first of equals.
    const other = { ...stratus, type: 'stratocumulus' as const };
    expect(cloudLayersByLevel([stratus, other])[0]).toBe(stratus);
  });
});

describe('weather systems', () => {
  it('takes a component’s own first, then the weather’s, then the defaults', () => {
    const weather = { systems: { strength: 0.3, seed: 4 } };
    expect(weatherSystemsOf(weather, { strength: 0.8 })).toEqual({
      strength: 0.8,
      seed: 4,
    });
    expect(weatherSystemsOf(weather)).toEqual({ strength: 0.3, seed: 4 });
    expect(weatherSystemsOf(null)).toEqual(WEATHER_SYSTEMS_DEFAULTS);
    expect(weatherSystemsOf({}, { seed: 2 })).toEqual({
      strength: WEATHER_SYSTEMS_DEFAULTS.strength,
      seed: 2,
    });
  });

  it('clamps the strength to 0–1', () => {
    expect(weatherSystemsOf(null, { strength: 3 }).strength).toBe(1);
    expect(weatherSystemsOf({ systems: { strength: -1 } }).strength).toBe(0);
  });
});

describe('wind', () => {
  it('lines cumulus into streets in a fresh wind, not a light one', () => {
    expect(cloudStreetsOf(undefined)).toBe(0);
    expect(cloudStreetsOf({ speed: 5, from: 0 })).toBe(0);
    expect(cloudStreetsOf({ speed: 11, from: 0 })).toBeCloseTo(0.5, 6);
    expect(cloudStreetsOf({ speed: 20, from: 0 })).toBe(1);
  });

  it('blows toward the opposite bearing: from the west is toward +X (east)', () => {
    const [x, z] = windToward({ speed: 10, from: 270 });
    expect(x).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('from the north is toward +Z (south) in the default frame', () => {
    const [x, z] = windToward({ speed: 10, from: 0 });
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it('follows a frame whose north is +X', () => {
    const [x, z] = windToward({ speed: 10, from: 180 }, { north: [1, 0, 0] });
    expect(x).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("leaves a sea's own wind as it is and fills in the rest from the weather", () => {
    const weather = weatherPreset('few', 'cumulus', { speed: 14, from: 270 });
    const own = weatherOceanWind(weather, {
      windSpeed: 5,
      windDirection: [0, 1],
    });
    expect(own).toEqual({ windSpeed: 5, windDirection: [0, 1] });

    const filled = weatherOceanWind(weather, { windSpeed: 5 });
    expect(filled.windSpeed).toBe(5);
    expect(filled.windDirection![0]).toBeCloseTo(1, 6);

    expect(weatherOceanWind(null, {})).toEqual({
      windSpeed: undefined,
      windDirection: undefined,
    });
    expect(weatherOceanWind(weatherPreset('few'), {}).windSpeed).toBe(
      undefined,
    );
  });
});

describe('wind aloft', () => {
  const wind = { speed: 10, from: 350 };

  it('is stronger and turned further the higher the level', () => {
    const levels = CLOUD_LEVELS.map(level => cloudWindAt(wind, level)!);
    for (let i = 1; i < levels.length; i++)
      expect(levels[i].speed).toBeGreaterThan(levels[i - 1].speed);
    expect(levels[0].speed).toBeGreaterThan(wind.speed);
    // Veering in the north: clockwise, and across north.
    expect(levels[0].from).toBeCloseTo(5);
    expect(levels[2].from).toBeCloseTo(30);
  });

  it('backs in the south', () => {
    expect(cloudWindAt(wind, 'mid', -40)!.from).toBeCloseTo(320);
  });

  it('is none without a wind', () => {
    expect(cloudWindAt(undefined, 'low')).toBeNull();
  });

  it("takes a layer's own wind first", () => {
    const layer = cloudLayerPreset('scattered', 'cirrus')!;
    expect(cloudLayerWind(layer, wind)).toEqual(cloudWindAt(wind, 'high'));
    const own = { speed: 40, from: 270 };
    expect(cloudLayerWind({ ...layer, wind: own }, wind)).toBe(own);
  });
});
