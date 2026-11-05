import type { Vec2 } from '../types/common';
import {
  type CompassFrame,
  directionFromCompass,
} from '../utils/vector-operations';

/**
 * What a {@link CloudLayer} is made of, by the cloud atlas's genera, at its
 * {@link CloudLevel}:
 *
 * - low: `'cumulus'`, heaped, separate clouds with flat bases and rounded tops;
 *   `'stratocumulus'`, a lumpy grey deck broken by gaps; `'stratus'`, a low, flat, even
 *   sheet; `'nimbostratus'`, a deep, dark rain cloud with a ragged base, reaching up toward
 *   the middle level;
 * - middle: `'altocumulus'`, small puffs in rows across the wind (a mackerel sky);
 *   `'altostratus'`, a thin grey sheet the sun shows through as through ground glass;
 * - high, of ice: `'cirrus'`, streaks drawn out along the wind; `'cirrostratus'`, a milky veil.
 *
 * @group Weather
 */
export type CloudType =
  | 'cumulus'
  | 'stratocumulus'
  | 'stratus'
  | 'nimbostratus'
  | 'altocumulus'
  | 'altostratus'
  | 'cirrus'
  | 'cirrostratus';

/**
 * The height a {@link CloudType} forms at: `'low'` (bases under some 2 km), `'mid'` (some 3 to
 * 5.5 km) or `'high'` (some 8 to 10 km, of ice). The clouds draw one layer at each.
 *
 * @group Weather
 */
export type CloudLevel = 'low' | 'mid' | 'high';

/**
 * The {@link CloudLevel}s, from the ground up.
 *
 * @group Weather
 */
export const CLOUD_LEVELS: readonly CloudLevel[] = ['low', 'mid', 'high'];

/**
 * The {@link CloudLevel} each {@link CloudType} forms at.
 *
 * @group Weather
 */
export const CLOUD_TYPE_LEVELS: Readonly<Record<CloudType, CloudLevel>> = {
  cumulus: 'low',
  stratocumulus: 'low',
  stratus: 'low',
  nimbostratus: 'low',
  altocumulus: 'mid',
  altostratus: 'mid',
  cirrus: 'high',
  cirrostratus: 'high',
};

/**
 * The {@link CloudLevel} `type` forms at.
 *
 * @group Weather
 */
export function cloudLevelOf(type: CloudType): CloudLevel {
  return CLOUD_TYPE_LEVELS[type];
}

/**
 * One layer of cloud, the same everywhere around the scene (see `documents/clouds.md`). The
 * clouds draw one at each {@link CloudLevel} ({@link cloudLayersByLevel}).
 *
 * @group Weather
 */
export type CloudLayer = {
  type: CloudType;
  /** the share of the ground the layer's cloud lies over, from 0 (none) to 1 (overcast) */
  cover: number;
  /** height of its base over the sea, in metres */
  base: number;
  /** height of its tops over the sea, in metres: the tallest of them, for cumulus */
  top: number;
  /**
   * the wind at its height, which its clouds drift with. Default the weather's wind turned and
   * strengthened aloft ({@link cloudWindAt})
   */
  wind?: WeatherWind;
};

/**
 * The layers drawn of `layers`: one at each {@link CloudLevel}, in the order of
 * {@link CLOUD_LEVELS}, null where none lies. Of two at a level, the one covering more (the
 * first of equals); the rest are left out.
 *
 * @group Weather
 */
export function cloudLayersByLevel(
  layers: readonly CloudLayer[],
): (CloudLayer | null)[] {
  const drawn: (CloudLayer | null)[] = CLOUD_LEVELS.map(() => null);
  for (const layer of layers) {
    const slot = CLOUD_LEVELS.indexOf(cloudLevelOf(layer.type));
    const held = drawn[slot];
    if (!held || layer.cover > held.cover) drawn[slot] = layer;
  }
  return drawn;
}

/**
 * The wind over the sea.
 *
 * @group Weather
 */
export type WeatherWind = {
  /** metres a second, 10 m over the sea (U10) */
  speed: number;
  /** compass bearing it blows from, in degrees (0 north, 90 east), as weather reports give it */
  from: number;
};

/**
 * The weather away from the scene: weather systems — fronts and cyclones, clear highs,
 * fields of cellular convection — over the whole Earth, which the scene's own layers give way
 * to some hundreds of kilometres off (see `documents/clouds.md`, "The weather far off").
 *
 * @group Weather
 */
export type WeatherSystems = {
  /**
   * how far the cover away from the scene follows the systems rather than the scene's
   * layers, from 0 (the layers' cover everywhere) to 1 (the systems' alone). Default 1
   */
  strength?: number;
  /** which weather: another seed is other systems, elsewhere. Default 0 */
  seed?: number;
};

/**
 * The weather at the scene: its wind and its cloud layers, in any order, and the weather
 * systems away from it. A `Weather` component hands it to what draws it: the sea's waves and
 * the clouds.
 *
 * @group Weather
 */
export type WeatherState = {
  wind?: WeatherWind;
  clouds?: CloudLayer[];
  systems?: WeatherSystems;
};

/**
 * What {@link WeatherSystems} leave out is taken as.
 *
 * @group Weather
 */
export const WEATHER_SYSTEMS_DEFAULTS: Readonly<Required<WeatherSystems>> = {
  strength: 1,
  seed: 0,
};

/**
 * The weather systems to draw: `own` where it says (a component's props), then the
 * weather's, then {@link WEATHER_SYSTEMS_DEFAULTS}; the strength clamped to 0–1.
 *
 * @group Weather
 */
export function weatherSystemsOf(
  weather: WeatherState | null | undefined,
  own: WeatherSystems = {},
): Required<WeatherSystems> {
  const systems = weather?.systems;
  const strength =
    own.strength ?? systems?.strength ?? WEATHER_SYSTEMS_DEFAULTS.strength;
  return {
    strength: Math.min(Math.max(strength, 0), 1),
    seed: own.seed ?? systems?.seed ?? WEATHER_SYSTEMS_DEFAULTS.seed,
  };
}

/**
 * How far `wind` lines cumulus up into streets along it, from 0 (none) to 1: streets form in
 * a fresh to strong wind, from some 7 m/s, fully by 15. 0 without a wind.
 *
 * @group Weather
 */
export function cloudStreetsOf(wind: WeatherWind | null | undefined): number {
  if (!wind) return 0;
  const t = Math.min(Math.max((wind.speed - 7) / 8, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * How much of the sky a layer covers, in the words of weather reports (METAR): `few` 1–2
 * eighths (oktas), `scattered` 3–4, `broken` 5–7, `overcast` all 8.
 *
 * @group Weather
 */
export type CloudCover = 'clear' | 'few' | 'scattered' | 'broken' | 'overcast';

/**
 * The oktas (eighths of the sky) each {@link CloudCover} stands for, least and most.
 *
 * @group Weather
 */
export const CLOUD_COVER_OKTAS: Readonly<
  Record<CloudCover, readonly [number, number]>
> = {
  clear: [0, 0],
  few: [1, 2],
  scattered: [3, 4],
  broken: [5, 7],
  overcast: [8, 8],
};

/**
 * Where a preset lays each {@link CloudType}'s layer, in metres over the sea: its base, and
 * its tops at no cover and at full cover. Cumulus grow taller the more they cover
 * (fair-weather humilis to congestus), and so, less, do the decks; stratus stay a thin sheet.
 * No two levels' overlap.
 *
 * @group Weather
 */
export const CLOUD_TYPE_HEIGHTS: Readonly<
  Record<CloudType, { base: number; top: readonly [number, number] }>
> = {
  cumulus: { base: 1200, top: [2000, 3400] },
  stratocumulus: { base: 900, top: [1300, 1700] },
  stratus: { base: 400, top: [900, 900] },
  nimbostratus: { base: 600, top: [2600, 3400] },
  altocumulus: { base: 3800, top: [4200, 4600] },
  altostratus: { base: 4000, top: [4800, 5500] },
  cirrus: { base: 8000, top: [8800, 9500] },
  cirrostratus: { base: 8500, top: [9000, 9300] },
};

/**
 * The share of the sky `oktas` eighths of it cover, from 0 to 1.
 *
 * @group Weather
 */
export function oktasToCover(oktas: number): number {
  return Math.min(Math.max(oktas / 8, 0), 1);
}

/**
 * The {@link CloudCover} a share of the sky (0 to 1) is reported as: by the nearest okta.
 *
 * @group Weather
 */
export function cloudCoverOf(cover: number): CloudCover {
  const oktas = Math.round(Math.min(Math.max(cover, 0), 1) * 8);
  for (const name of Object.keys(CLOUD_COVER_OKTAS) as CloudCover[]) {
    const [least, most] = CLOUD_COVER_OKTAS[name];
    if (oktas >= least && oktas <= most) return name;
  }
  return 'overcast';
}

/**
 * A layer of `type` covering as much as `cover` says — the middle of its oktas: `few` 1.5/8,
 * `scattered` 3.5/8, `broken` 6/8, `overcast` all — at the type's heights
 * ({@link CLOUD_TYPE_HEIGHTS}). `null` for a clear sky.
 *
 * @group Weather
 */
export function cloudLayerPreset(
  cover: CloudCover,
  type: CloudType = 'cumulus',
): CloudLayer | null {
  if (cover === 'clear') return null;
  const [least, most] = CLOUD_COVER_OKTAS[cover];
  const share = oktasToCover((least + most) / 2);
  const { base, top } = CLOUD_TYPE_HEIGHTS[type];
  return {
    type,
    cover: share,
    base,
    top: top[0] + (top[1] - top[0]) * share,
  };
}

/**
 * The weather with one layer of `type` covering as much as `cover` says (none for `clear`),
 * and `wind` if given: without one, what reads the weather keeps its own.
 *
 * @example
 * <Weather weather={weatherPreset('broken', 'cumulus', { speed: 12, from: 240 })}>
 *
 * @group Weather
 */
export function weatherPreset(
  cover: CloudCover,
  type: CloudType = 'cumulus',
  wind?: WeatherWind,
): WeatherState {
  const layer = cloudLayerPreset(cover, type);
  return { ...(wind ? { wind } : {}), clouds: layer ? [layer] : [] };
}

/**
 * Skies by name, each a layer or two at their levels (see {@link SKY_PRESETS}).
 *
 * @group Weather
 */
export type SkyPreset =
  | 'clear'
  | 'fair'
  | 'scattered'
  | 'mackerel'
  | 'cirrus'
  | 'stratocumulus'
  | 'warm-front'
  | 'showers'
  | 'overcast'
  | 'overcast-rain';

/**
 * The layers each {@link SkyPreset} names, by cover and type ({@link cloudLayerPreset}):
 *
 * - `clear`: none;
 * - `fair`: a few fair-weather cumulus under a few cirrus;
 * - `scattered`: scattered cumulus;
 * - `mackerel`: broken altocumulus, in rows;
 * - `cirrus`: scattered cirrus in a blue sky;
 * - `stratocumulus`: a broken deck of stratocumulus;
 * - `warm-front`: a warm front coming: broken altostratus under a veil of cirrostratus;
 * - `showers`: broken, towering cumulus under scattered cirrus;
 * - `overcast`: an overcast deck of stratocumulus;
 * - `overcast-rain`: overcast nimbostratus.
 *
 * @group Weather
 */
export const SKY_PRESETS: Readonly<
  Record<SkyPreset, readonly (readonly [CloudCover, CloudType])[]>
> = {
  clear: [],
  fair: [
    ['few', 'cumulus'],
    ['few', 'cirrus'],
  ],
  scattered: [['scattered', 'cumulus']],
  mackerel: [['broken', 'altocumulus']],
  cirrus: [['scattered', 'cirrus']],
  stratocumulus: [['broken', 'stratocumulus']],
  'warm-front': [
    ['broken', 'altostratus'],
    ['overcast', 'cirrostratus'],
  ],
  showers: [
    ['broken', 'cumulus'],
    ['scattered', 'cirrus'],
  ],
  overcast: [['overcast', 'stratocumulus']],
  'overcast-rain': [['overcast', 'nimbostratus']],
};

/**
 * Cloud layers by name: a {@link SkyPreset}; or as a report gives a layer, a
 * {@link CloudCover} alone (cumulus) or with its {@link CloudType} after it. Where a sky and a
 * cover share a name, the sky's: `'overcast'` is a deck of stratocumulus, `'overcast
 * cumulus'` the cumulus.
 *
 * @example
 * <SceneryCloudVolume layers="warm-front" />
 * <SceneryCloudVolume layers="overcast stratus" />
 *
 * @group Weather
 */
export type CloudLayersPreset =
  | SkyPreset
  | CloudCover
  | `${CloudCover} ${CloudType}`;

/**
 * Whether `name` is a {@link SkyPreset}.
 *
 * @group Weather
 */
export function isSkyPreset(name: string): name is SkyPreset {
  return Object.prototype.hasOwnProperty.call(SKY_PRESETS, name);
}

/**
 * The layers a {@link CloudLayersPreset} names: a sky's ({@link SKY_PRESETS}), or one layer
 * ({@link cloudLayerPreset}); none for `clear`.
 *
 * @group Weather
 */
export function cloudLayersOf(preset: CloudLayersPreset): CloudLayer[] {
  if (isSkyPreset(preset))
    return SKY_PRESETS[preset].flatMap(
      ([cover, type]) => cloudLayerPreset(cover, type) ?? [],
    );
  const [cover, type] = preset.split(' ') as [
    CloudCover,
    CloudType | undefined,
  ];
  const layer = cloudLayerPreset(cover, type ?? 'cumulus');
  return layer ? [layer] : [];
}

/**
 * The way `wind` blows toward, level, as X and Z of `frame` (unit length): the way the waves
 * it raises travel, as an `Ocean`'s `windDirection` takes it. Default frame: north `-Z`
 * (`CRS.utmToWorld`), so east is `+X`.
 *
 * @group Weather
 */
export function windToward(wind: WeatherWind, frame?: CompassFrame): Vec2 {
  const [x, , z] = directionFromCompass(wind.from + 180, 0, frame);
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}

/**
 * The wind a sea is drawn with: its own where it has it (`own`), the weather's for what it
 * leaves out. What neither gives stays out, so the sea keeps what it had.
 *
 * @group Weather
 */
export function weatherOceanWind(
  weather: WeatherState | null | undefined,
  own: { windSpeed?: number; windDirection?: Vec2 },
  frame?: CompassFrame,
): { windSpeed?: number; windDirection?: Vec2 } {
  const wind = weather?.wind;
  return {
    windSpeed: own.windSpeed ?? wind?.speed,
    windDirection:
      own.windDirection ?? (wind ? windToward(wind, frame) : undefined),
  };
}

/**
 * How the wind at each {@link CloudLevel} stands to the wind over the sea ({@link WeatherWind}):
 * stronger (`speed` times), away from the sea's drag, and turned (`veer` degrees) with height:
 * clockwise in the north, anticlockwise in the south, as the friction that turns it toward low
 * pressure fades (the Ekman spiral). Typical of a mid-latitude atmosphere: some 1.5 times the
 * surface wind at the low clouds (850 hPa), twice at the middle (600 hPa) and three times at the
 * high (300 hPa, toward the jet).
 *
 * @group Weather
 */
export const CLOUD_WIND_ALOFT: Readonly<
  Record<CloudLevel, { speed: number; veer: number }>
> = {
  low: { speed: 1.5, veer: 15 },
  mid: { speed: 2.2, veer: 30 },
  high: { speed: 3, veer: 40 },
};

/**
 * The wind at `level`'s clouds from the wind over the sea, `wind`, at `latitude` (degrees:
 * which way it turns with height, {@link CLOUD_WIND_ALOFT}); null without one.
 *
 * @group Weather
 */
export function cloudWindAt(
  wind: WeatherWind | null | undefined,
  level: CloudLevel,
  latitude = 45,
): WeatherWind | null {
  if (!wind) return null;
  const aloft = CLOUD_WIND_ALOFT[level];
  const turn = latitude >= 0 ? aloft.veer : -aloft.veer;
  return {
    speed: wind.speed * aloft.speed,
    from: (((wind.from + turn) % 360) + 360) % 360,
  };
}

/**
 * The wind `layer`'s clouds drift with: its own (`CloudLayer.wind`), else the wind over the sea
 * turned and strengthened to its level ({@link cloudWindAt}); null for none.
 *
 * @group Weather
 */
export function cloudLayerWind(
  layer: CloudLayer,
  wind: WeatherWind | null | undefined,
  latitude = 45,
): WeatherWind | null {
  return layer.wind ?? cloudWindAt(wind, cloudLevelOf(layer.type), latitude);
}
