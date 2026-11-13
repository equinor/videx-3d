import type { Vec2 } from '../types/common';
import {
  type CompassFrame,
  directionFromCompass,
} from '../utils/vector-operations';
import type { WeatherGusts } from './wind-field';

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
  /** what its clouds are made of */
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
 * How much cover either side of a tie between two levels' covers a level's cut by the other is
 * eased in over ({@link cloudLayersInProportion}).
 *
 * @group Weather
 */
export const CLOUD_LAYERS_TIE = 0.1;

/**
 * `layers` (one at each {@link CloudLevel}, as {@link cloudLayersByLevel} gives them) kept in
 * proportion, so one level dominates the sky: each is cut by `dominance` times the cover of the
 * one covering most over it. With `dominance` 1, an overcast leaves no other level any cloud, as
 * from under it none shows; 0 leaves them all as they are. A cut is eased in over
 * {@link CLOUD_LAYERS_TIE} of cover either side of a tie, so two levels covering about as much
 * cut each other about as much, and a cover changing from place to place (a global weather's)
 * changes the cuts smoothly. Several levels with a lot of cloud are a deep frontal system, which
 * draws as one deep layer (nimbostratus).
 *
 * @group Weather
 */
export function cloudLayersInProportion(
  layers: readonly (CloudLayer | null)[],
  dominance: number,
): (CloudLayer | null)[] {
  const d = Math.min(Math.max(dominance, 0), 1);
  const ease = (x: number) => {
    const t = Math.min(
      Math.max((x + CLOUD_LAYERS_TIE) / (2 * CLOUD_LAYERS_TIE), 0),
      1,
    );
    return t * t * (3 - 2 * t);
  };
  return layers.map((layer, k) => {
    if (!layer) return layer;
    let over = 0;
    layers.forEach((other, j) => {
      if (other && j !== k)
        over = Math.max(over, other.cover * ease(other.cover - layer.cover));
    });
    return over > 0 ? { ...layer, cover: layer.cover * (1 - d * over) } : layer;
  });
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
  /**
   * how it varies over the sea: gusts and slicks ({@link WeatherGusts}). Left out, as the
   * wind's speed gives them
   */
  gusts?: WeatherGusts;
};

/**
 * The weather away from the scene: weather systems — fronts and cyclones, clear highs,
 * fields of cellular convection — over the whole Earth: a global weather's cloud, everywhere
 * (see `documents/clouds.md`, "The weather far off").
 *
 * @group Weather
 */
export type WeatherSystems = {
  /** which weather: another seed is other systems, elsewhere. Default 0 */
  seed?: number;
};

/**
 * A local weather: its cloud layers alone, about one place on the Earth, and none beyond.
 *
 * @group Weather
 */
export type WeatherLocal = {
  /**
   * where its middle lies (WGS84, degrees), with {@link longitude}. Default where the
   * `World`'s anchor lies as the local weather is first drawn: kept there as the anchor moves
   */
  latitude?: number;
  longitude?: number;
  /**
   * how far its layers reach from its middle (metres), their cover thinning out over the
   * outer fifth. Default {@link WEATHER_LOCAL_RADIUS}
   */
  radius?: number;
};

/**
 * How far a {@link WeatherLocal}'s layers reach from its middle unless it says (metres).
 *
 * @group Weather
 */
export const WEATHER_LOCAL_RADIUS = 100000;

/**
 * The weather: its wind, and its cloud. A `Weather` component hands it to what draws it: the
 * sea's waves and the clouds.
 *
 * - **Local** (with {@link local}): its cloud layers, about one place, and no cloud beyond.
 * - **Global** (without): the weather systems over the whole Earth ({@link systems}), the
 *   scene included; its layers are not drawn.
 *
 * @group Weather
 */
export type WeatherState = {
  wind?: WeatherWind;
  /** its cloud layers, in any order: drawn while it is local */
  clouds?: CloudLayer[];
  /** local: its layers alone, about one place; without it, global */
  local?: WeatherLocal;
  /** the weather systems, while it is global */
  systems?: WeatherSystems;
};

/**
 * What {@link WeatherSystems} leave out is taken as.
 *
 * @group Weather
 */
export const WEATHER_SYSTEMS_DEFAULTS: Readonly<Required<WeatherSystems>> = {
  seed: 0,
};

/**
 * The weather systems to draw: `own` where it says (a component's props), then the
 * weather's, then {@link WEATHER_SYSTEMS_DEFAULTS}.
 *
 * @group Weather
 */
export function weatherSystemsOf(
  weather: WeatherState | null | undefined,
  own: WeatherSystems = {},
): Required<WeatherSystems> {
  return {
    seed: own.seed ?? weather?.systems?.seed ?? WEATHER_SYSTEMS_DEFAULTS.seed,
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
 * A local weather with one layer of `type` covering as much as `cover` says (none for
 * `clear`), at the type's heights, and `wind` if given: without one, what reads the weather
 * keeps its own.
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
  return {
    ...(wind ? { wind } : {}),
    clouds: layer ? [layer] : [],
    local: {},
  };
}

/**
 * Skies by name: weather as it comes, each its layers at their heights and its wind (see
 * {@link SKY_PRESETS}).
 *
 * @group Weather
 */
export type SkyPreset =
  | 'clear'
  | 'fair'
  | 'few-high'
  | 'scattered'
  | 'streets'
  | 'marine-sc'
  | 'low-stratus'
  | 'warm-front-approach'
  | 'warm-front-rain'
  | 'showers'
  | 'mackerel'
  | 'high-overcast'
  | 'unsettled';

/**
 * A {@link SkyPreset}'s weather: its layers, each at the heights it lies at in that weather,
 * and its wind.
 *
 * @group Weather
 */
export type SkyPresetWeather = {
  layers: readonly CloudLayer[];
  wind: WeatherWind;
};

// A layer covering as much as `cover` says (the middle of its oktas, or a share of the sky), from
// `base` to `top`.
const skyLayer = (
  cover: CloudCover | number,
  type: CloudType,
  base: number,
  top: number,
): CloudLayer => {
  if (typeof cover === 'number') return { type, cover, base, top };
  const [least, most] = CLOUD_COVER_OKTAS[cover];
  return { type, cover: oktasToCover((least + most) / 2), base, top };
};

/**
 * The weather each {@link SkyPreset} names: layers as they come together, at the heights they
 * lie at in it, and the wind that goes with it.
 *
 * - `clear`: a high's clear sky, a light breeze;
 * - `fair`: a few small fair-weather cumulus, flat-topped under the high's inversion;
 * - `few-high`: a few cirrus streaks and altocumulus patches, nothing low: a sky that hides
 *   little of what lies under it (`SceneryClouds`'s default);
 * - `scattered`: an afternoon's scattered cumulus, a few cirrus far above;
 * - `streets`: scattered cumulus lined up into streets in a fresh, cold wind;
 * - `marine-sc`: a broken deck of stratocumulus low over the sea, nothing above its inversion;
 * - `low-stratus`: an overcast of stratus a few hundred metres up, drizzle weather;
 * - `warm-front-approach`: a veil of cirrostratus over altostratus thickening under it;
 * - `warm-front-rain`: overcast nimbostratus from low down to the middle level, a fresh wind;
 * - `showers`: behind a cold front, broken towering cumulus under scattered cirrus, a strong
 *   wind;
 * - `mackerel`: broken altocumulus in rows, a few cirrus;
 * - `high-overcast`: a milky veil of cirrostratus alone;
 * - `unsettled`: scattered cumulus, broken altocumulus and scattered cirrus.
 *
 * @group Weather
 */
export const SKY_PRESETS: Readonly<Record<SkyPreset, SkyPresetWeather>> = {
  clear: { layers: [], wind: { speed: 4, from: 300 } },
  fair: {
    layers: [skyLayer('few', 'cumulus', 1000, 1600)],
    wind: { speed: 5, from: 270 },
  },
  'few-high': {
    layers: [
      skyLayer(0.1, 'altocumulus', 3800, 4200),
      skyLayer(0.2, 'cirrus', 8500, 9300),
    ],
    wind: { speed: 6, from: 240 },
  },
  scattered: {
    layers: [
      skyLayer('scattered', 'cumulus', 1200, 2400),
      skyLayer('few', 'cirrus', 8500, 9300),
    ],
    wind: { speed: 6, from: 240 },
  },
  streets: {
    layers: [skyLayer('scattered', 'cumulus', 900, 1800)],
    wind: { speed: 13, from: 330 },
  },
  'marine-sc': {
    layers: [skyLayer('broken', 'stratocumulus', 500, 900)],
    wind: { speed: 7, from: 200 },
  },
  'low-stratus': {
    layers: [skyLayer('overcast', 'stratus', 250, 600)],
    wind: { speed: 6, from: 180 },
  },
  'warm-front-approach': {
    layers: [
      skyLayer('broken', 'altostratus', 4200, 5400),
      skyLayer('overcast', 'cirrostratus', 8200, 9000),
    ],
    wind: { speed: 9, from: 170 },
  },
  'warm-front-rain': {
    layers: [skyLayer('overcast', 'nimbostratus', 600, 3400)],
    wind: { speed: 12, from: 160 },
  },
  showers: {
    layers: [
      skyLayer('broken', 'cumulus', 800, 3400),
      skyLayer('scattered', 'cirrus', 8000, 8900),
    ],
    wind: { speed: 14, from: 290 },
  },
  mackerel: {
    layers: [
      skyLayer('broken', 'altocumulus', 3800, 4400),
      skyLayer('few', 'cirrus', 8600, 9300),
    ],
    wind: { speed: 8, from: 250 },
  },
  'high-overcast': {
    layers: [skyLayer('overcast', 'cirrostratus', 8500, 9300)],
    wind: { speed: 8, from: 230 },
  },
  unsettled: {
    layers: [
      skyLayer('scattered', 'cumulus', 1000, 2200),
      skyLayer('broken', 'altocumulus', 4000, 4600),
      skyLayer('scattered', 'cirrus', 8200, 9000),
    ],
    wind: { speed: 9, from: 240 },
  },
};

/**
 * The local weather a {@link SkyPreset} names: its layers and its wind, about `local`'s middle
 * (default the `World`'s anchor, {@link WeatherLocal}).
 *
 * @example
 * <Weather weather={weatherPresetOf('marine-sc')}>
 *
 * @group Weather
 */
export function weatherPresetOf(
  name: SkyPreset,
  local: WeatherLocal = {},
): WeatherState {
  const { layers, wind } = SKY_PRESETS[name];
  return {
    wind: { ...wind },
    clouds: structuredClone(layers) as CloudLayer[],
    local: { ...local },
  };
}

/**
 * Cloud layers by name: a {@link SkyPreset}; or as a report gives a layer, a
 * {@link CloudCover} alone (cumulus) or with its {@link CloudType} after it. Where a sky and a
 * cover share a name, the sky's: `'scattered'` is an afternoon's cumulus with a few cirrus,
 * `'scattered cumulus'` the cumulus alone.
 *
 * @example
 * <SceneryClouds layers="warm-front-approach" />
 * <SceneryClouds layers="overcast stratus" />
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
 * The layers a {@link CloudLayersPreset} names: a sky's ({@link SKY_PRESETS}, at its
 * heights), or one layer ({@link cloudLayerPreset}); none for `clear`.
 *
 * @group Weather
 */
export function cloudLayersOf(preset: CloudLayersPreset): CloudLayer[] {
  if (isSkyPreset(preset))
    return structuredClone(SKY_PRESETS[preset].layers) as CloudLayer[];
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
  own: { windSpeed?: number; windDirection?: Vec2; gusts?: WeatherGusts },
  frame?: CompassFrame,
): { windSpeed?: number; windDirection?: Vec2; gusts?: WeatherGusts } {
  const wind = weather?.wind;
  return {
    windSpeed: own.windSpeed ?? wind?.speed,
    windDirection:
      own.windDirection ?? (wind ? windToward(wind, frame) : undefined),
    gusts: own.gusts ?? wind?.gusts,
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
