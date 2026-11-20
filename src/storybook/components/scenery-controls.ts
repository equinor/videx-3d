import type { ArgTypes, Decorator } from '@storybook/react-vite';
import { useArgs, useEffect } from 'storybook/preview-api';
import { builtInColorRamps } from '../../common/color-ramps';
import { ContourColorMode } from '../../common/types';
import {
  DEFAULT_OCEAN_WATER_OPACITY,
  type OceanFoamTuning,
  type OceanWaveTuning,
} from '../../components/Ocean/ocean-material';
import type { SeaQuality } from '../../sdk/weather/sea-state';
import type { WaterOpticsPreset } from '../../sdk/weather/water-optics';
import {
  SKY_PRESETS,
  weatherSeaSwells,
  type SkyPreset,
  type WeatherState,
  type WeatherSwell,
} from '../../sdk/weather/weather';
import type { Vec2 } from '../../sdk/types/common';
import type { GeoReliefProps } from '../../components/Layers/GeoRelief';
import {
  GRATICULE_LABEL_DENSITY,
  GRATICULE_LABEL_SIZE,
} from '../../components/Layers/graticule-labels';
import {
  GRATICULE_DEFAULTS,
  type GeoGraticuleOptions,
} from '../../components/Layers/graticule-options';
import type {
  SceneryLayer,
  SceneryProps,
} from '../../components/Scenery/Scenery';
import type { SceneryStageLayer } from '../../components/Scenery/SceneryStage';
import {
  sceneryDefaults,
  type SceneryAbyssProps,
  type SceneryCloudsProps,
  type SceneryCloudsQuality,
  type SceneryHollowStyle,
  type SceneryOceanProps,
  type SkyMoon,
  type SkyObserver,
  type SkyStars,
  type SkySun,
} from '../../components/Scenery/scenery-model';
import type { ReliefLayer } from '../../sdk/geometries/relief-tiles';
import {
  GeoFrame,
  geoFrameAt,
  geoFrameLocation,
} from '../../sdk/projection/geo-frame';
import { solarPosition } from '../../sdk/utils/solar-position';
import { bakedReliefId } from '../data/baked-reliefs';
import { demoFrame } from '../data/demo-crs';
import { SYNTHETIC_SEABED_ID } from '../data/synthetic-surfaces';
import {
  progressArgs,
  ProgressArgs,
  progressDecorator,
  storyProgress,
} from '../decorators/progress-decorator';
import {
  SceneryCutawayArgs,
  sceneryCutawayArgTypes,
  sceneryCutawayDecorator,
  skyCutawayArgs,
} from './scenery-cutaway-controls';
import {
  toneMappingArgs,
  ToneMappingArgs,
  toneMappingArgTypes,
} from './tone-mapping-controls';

/**
 * A `<Scenery>` as story args, shared by every story that draws one so the same control has
 * the same name everywhere. Basic controls show in every story; advanced and debug ones
 * only where `sceneryArgTypes({ debug: true })` asks for them, and keep their defaults
 * elsewhere.
 */
export type SceneryArgs = {
  // Sun
  sunFromTime: boolean;
  sunAzimuth: number;
  sunElevation: number;
  /** `YYYY-MM-DD` */
  sunDate: string;
  /** local solar time, 0 to 24 */
  sunHour: number;
  sunLatitude: number;
  sunLongitude: number;
  observerNow: boolean;
  sunIntensity: number;
  sunSize: number;
  sunGlow: number;
  sunGlare: number;
  sunRays: number;
  sunShimmer: boolean;
  sunTwilight: number;
  // Graticule
  graticuleLatLon: boolean;
  graticuleLatLonColor: string;
  graticuleLatLonThickness: number;
  /** degrees between lines; 0 follows the view */
  graticuleLatLonInterval: number;
  /** following the view, the least spacing on screen, in pixels */
  graticuleLatLonMinSpacing: number;
  graticuleLatLonLabels: boolean;
  graticuleLatLonLabelSize: number;
  graticuleLatLonLabelDensity: number;
  graticuleLatLonLabelSizing: 'stepped' | 'smooth';
  graticuleUtm: boolean;
  graticuleUtmColor: string;
  graticuleUtmThickness: number;
  graticuleUtmLabels: boolean;
  graticuleTimeZones: boolean;
  graticuleTimeZonesColor: string;
  graticuleTimeZonesThickness: number;
  graticuleTimeZonesLabels: boolean;
  graticuleOpacity: number;
  // Scenery
  backgroundMode: 'sky' | 'void' | 'none';
  // Clouds (sceneryCloudsFromArgs)
  clouds: SkyPreset;
  cloudsQuality: SceneryCloudsQuality;
  air: boolean;
  airHaze: number;
  airHazeHeight: number;
  skyZenith: string;
  skyHorizon: string;
  skyGround: string;
  skyNadir: string;
  skyIntensity: number;
  skyHorizonBlend: number;
  moon: boolean;
  moonIntensity: number;
  stars: boolean;
  starBrightness: number;
  /** the sun's and the moon's discs, this many times their real size */
  discScale: number;
  // Sea
  skyWater: boolean;
  skySeabed: boolean;
  waterOpacity: number;
  skySeabedOpacity: number;
  windSpeed: number;
  foamAmount: number;
  /** surf where the waves break on a coast of the scene's ground (`shoreFoam`) */
  seaShoreFoam: number;
  /** compass bearing the wind blows toward */
  windDirection: number;
  /** a swell's significant height, metres: 0 none */
  swellHeight: number;
  /** its peak period, seconds */
  swellPeriod: number;
  /** compass bearing it comes from */
  swellFrom: number;
  seaSteepness: number;
  /** ⚠️ Tuning, to be settled: the wave model's open choices (the sea bench sets them) */
  seaWaveTuning?: OceanWaveTuning;
  /** ⚠️ Tuning, to be settled: the foam's shaping (the sea bench sets it) */
  seaFoamTuning?: OceanFoamTuning;
  /** the sea's `quality` (`SEA_QUALITY`); default medium */
  seaQuality?: SeaQuality;
  /** the sea's look by name (`WATER_OPTICS_PRESETS`): realistic (the North Sea's), or clear */
  seaOptics: WaterOpticsPreset;
  skySeabedColor: string;
  seaDetailScale: number;
  /** 0 for water's own Fresnel; above, the old Schlick exponent (`fresnelPower`) */
  seaFresnelPower: number;
  /** how much of the sun's glitter is drawn (`sparkle`): 0 none */
  seaSparkle: number;
  /** how much light through the crests is drawn (`crestLight`): 0 none, 1 as modelled */
  seaCrestLight: number;
  /** the whitecaps' life (`foamLife`): by the quality, or on or off */
  seaFoamLife: 'auto' | 'on' | 'off';
  seaDetailFadeStart: number;
  seaDetailFadeEnd: number;
  // Subsurface
  subsurfaceFollowSun: boolean;
  subsurfaceLightAzimuth: number;
  subsurfaceLightElevation: number;
  subsurfaceLightLowest: number;
  subsurfaceLightHighest: number;
  subsurfaceLightColor: string;
  subsurfaceLightIntensity: number;
  subsurfaceLightTransition: number;
  subsurfaceIntensity: number;
  subsurfacePanelColor: string;
  subsurfacePanelIntensity: number;
  subsurfaceBelow: boolean;
  subsurfaceBelowColor: string;
  subsurfaceBelowIntensity: number;
  abyssCeiling: string;
  abyssHorizon: string;
  abyssDepth: string;
  abyssFadeDistance: number;
  abyssTransition: number;
  abyssDarkening: number;
  abyssDetail: number;
  abyssDetailScale: number;
  abyssDepthDetail: number;
  abyssDepthDetailScale: number;
  abyssFalloff: number;
  /** the void as a hollow under the field (`SceneryAbyss`'s `hollow`) */
  hollow: boolean;
  hollowStyle: SceneryHollowStyle;
  hollowRadius: number;
  hollowFloorDepth: number;
  hollowWalls?: string;
  hollowFloor?: string;
  hollowEmberColor?: string;
  hollowLidColor?: string;
  hollowEmbers?: number;
  hollowLightFalloff: number;
  hollowMurk: number;
  hollowPulse?: number;
  hollowAir?: number;
  hollowHandle: boolean;
  /** set by {@link sceneryHollowDecorator}: the radius the rim grip left */
  onHollowRadius?: (radius: number) => void;
  // Environment
  globe: boolean;
  environment: boolean;
  lightProbe: boolean;
  environmentIntensity: number;
  environmentResolution: number;
  lightProbeIntensity: number;
  captureInterval: number;
  captureMaxWait: number;
  // Rendering and debug
  pipeline: 'default' | 'oit';
  stats: boolean;
  tint: boolean;
  showEnvironment: boolean;
} & SceneryCutawayArgs &
  ToneMappingArgs;

// The demo field's place, from the CRS its `UtmArea` places it with.
const demoPlace = geoFrameLocation(demoFrame);

// 10 September, 13:00 solar time over Volve: about the Scenery's default sun (200°, 35°).
export const sceneryArgs: SceneryArgs = {
  sunFromTime: false,
  sunAzimuth: sceneryDefaults.sun.azimuth,
  sunElevation: sceneryDefaults.sun.elevation,
  sunDate: '2024-09-10',
  sunHour: 13,
  sunLatitude: Math.round(demoPlace.latitude * 100) / 100,
  sunLongitude: Math.round(demoPlace.longitude * 100) / 100,
  observerNow: false,
  sunIntensity: sceneryDefaults.sun.intensity,
  sunSize: sceneryDefaults.sun.size,
  sunGlow: sceneryDefaults.sun.glow,
  sunGlare: sceneryDefaults.sun.glare,
  sunRays: sceneryDefaults.sun.rays,
  sunShimmer: sceneryDefaults.sun.shimmer,
  sunTwilight: sceneryDefaults.sun.twilight,
  graticuleLatLon: false,
  graticuleLatLonColor: GRATICULE_DEFAULTS.lines.color,
  graticuleLatLonThickness: GRATICULE_DEFAULTS.lines.thickness,
  graticuleLatLonInterval: 0,
  graticuleLatLonMinSpacing: GRATICULE_DEFAULTS.minSpacing,
  graticuleLatLonLabels: false,
  graticuleLatLonLabelSize: GRATICULE_LABEL_SIZE,
  graticuleLatLonLabelDensity: GRATICULE_LABEL_DENSITY,
  graticuleLatLonLabelSizing: 'stepped',
  graticuleUtm: false,
  graticuleUtmColor: GRATICULE_DEFAULTS.lines.color,
  graticuleUtmThickness: GRATICULE_DEFAULTS.lines.thickness,
  graticuleUtmLabels: false,
  graticuleTimeZones: false,
  graticuleTimeZonesColor: GRATICULE_DEFAULTS.lines.color,
  graticuleTimeZonesThickness: GRATICULE_DEFAULTS.lines.thickness,
  graticuleTimeZonesLabels: false,
  graticuleOpacity: GRATICULE_DEFAULTS.lines.opacity,
  backgroundMode: 'sky',
  clouds: 'clear',
  cloudsQuality: sceneryDefaults.clouds.quality,
  air: true,
  airHaze: sceneryDefaults.air.haze,
  airHazeHeight: sceneryDefaults.air.hazeHeight,
  skyZenith: sceneryDefaults.colors.zenith,
  skyHorizon: sceneryDefaults.colors.horizon,
  skyGround: sceneryDefaults.colors.ground,
  skyNadir: sceneryDefaults.colors.nadir,
  skyIntensity: sceneryDefaults.intensity,
  skyHorizonBlend: sceneryDefaults.horizonBlend,
  moon: true,
  moonIntensity: sceneryDefaults.moon.intensity,
  stars: true,
  starBrightness: sceneryDefaults.stars.brightness,
  discScale: sceneryDefaults.discScale,
  skyWater: true,
  skySeabed: true,
  waterOpacity: DEFAULT_OCEAN_WATER_OPACITY,
  skySeabedOpacity: sceneryDefaults.ocean.seabedOpacity,
  // As `OceanMaterial`'s own defaults.
  windSpeed: 10,
  foamAmount: 0.5,
  seaShoreFoam: 0,
  windDirection: 90,
  swellHeight: 0,
  swellPeriod: 12,
  swellFrom: 270,
  seaSteepness: 1,
  seaOptics: 'realistic',
  skySeabedColor: sceneryDefaults.ocean.seabed.color,
  seaDetailScale: 0.05,
  seaFresnelPower: 0,
  seaSparkle: 0,
  seaCrestLight: 1,
  seaFoamLife: 'auto',
  seaDetailFadeStart: 15000,
  seaDetailFadeEnd: 60000,
  subsurfaceFollowSun: sceneryDefaults.subsurface.light.followSun,
  subsurfaceLightAzimuth: sceneryDefaults.subsurface.light.azimuth,
  subsurfaceLightElevation: sceneryDefaults.subsurface.light.elevation,
  subsurfaceLightLowest: sceneryDefaults.subsurface.light.elevationRange[0],
  subsurfaceLightHighest: sceneryDefaults.subsurface.light.elevationRange[1],
  subsurfaceLightColor: sceneryDefaults.subsurface.light.color,
  subsurfaceLightIntensity: sceneryDefaults.sun.intensity,
  subsurfaceLightTransition: sceneryDefaults.subsurface.light.transition,
  subsurfaceIntensity: sceneryDefaults.subsurface.intensity,
  subsurfacePanelColor: sceneryDefaults.subsurface.panels.color,
  subsurfacePanelIntensity: sceneryDefaults.subsurface.panels.intensity,
  subsurfaceBelow: false,
  subsurfaceBelowColor: '#9fb4d0',
  subsurfaceBelowIntensity: 1,
  abyssCeiling: sceneryDefaults.abyss.colors.ceiling,
  abyssHorizon: sceneryDefaults.abyss.colors.horizon,
  abyssDepth: sceneryDefaults.abyss.colors.depth,
  abyssFadeDistance: sceneryDefaults.abyss.fadeDistance,
  abyssTransition: sceneryDefaults.abyss.transition,
  abyssDarkening: sceneryDefaults.abyss.darkening,
  abyssDetail: sceneryDefaults.abyss.detail,
  abyssDetailScale: sceneryDefaults.abyss.detailScale,
  abyssDepthDetail: sceneryDefaults.abyss.depthDetail,
  abyssDepthDetailScale: sceneryDefaults.abyss.depthDetailScale,
  abyssFalloff: sceneryDefaults.abyss.falloff,
  hollow: true,
  hollowStyle: sceneryDefaults.abyss.hollow.style,
  hollowRadius: sceneryDefaults.abyss.hollow.radius,
  hollowFloorDepth: sceneryDefaults.abyss.hollow.floorDepth,
  hollowLightFalloff: sceneryDefaults.abyss.hollow.lightFalloff,
  hollowMurk: sceneryDefaults.abyss.hollow.murk,
  hollowHandle: false,
  globe: sceneryDefaults.globe,
  environment: true,
  lightProbe: true,
  environmentIntensity: 1,
  environmentResolution: 64,
  lightProbeIntensity: 1,
  captureInterval: 250,
  captureMaxWait: 1000,
  pipeline: 'default',
  stats: false,
  tint: false,
  showEnvironment: false,
  ...skyCutawayArgs,
  ...toneMappingArgs,
};

/** The moment {@link SceneryArgs} set, or null: local solar time is UTC shifted by the longitude, 15° an hour. */
function skySunDate(args: SceneryArgs) {
  const [year, month, day] = args.sunDate.split('-').map(Number);
  const utc =
    Date.UTC(year, month - 1, day) +
    (args.sunHour - args.sunLongitude / 15) * 3600000;
  return Number.isFinite(utc) ? new Date(utc) : null;
}

/**
 * `date` (`YYYY-MM-DD`) moved on by a whole number of `days` (back, if negative), as
 * `YYYY-MM-DD`: for a clock that runs past midnight. As it is if it is no date.
 */
export function skyDateAfter(date: string, days: number): string {
  if (days === 0) return date;
  const [year, month, day] = date.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day + days);
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : date;
}

/** The sun's azimuth and elevation from {@link SceneryArgs}: as set, or from the time and place. */
export function skySunPosition(args: SceneryArgs) {
  const manual = { azimuth: args.sunAzimuth, elevation: args.sunElevation };
  const date = args.sunFromTime ? skySunDate(args) : null;
  if (!date) return manual;
  return solarPosition(date, args.sunLatitude, args.sunLongitude);
}

/** A Scenery's `observer` from {@link SceneryArgs}: the time and place, when the sun is set from them. */
export function skyObserverFromArgs(args: SceneryArgs): SkyObserver | null {
  const date = args.sunFromTime ? skySunDate(args) : null;
  return (
    date && {
      date,
      latitude: args.sunLatitude,
      longitude: args.sunLongitude,
    }
  );
}

/** {@link SceneryArgs} for `date` at a place: its local solar date and hour. */
export function skySunArgsAt(
  date: Date,
  latitude: number,
  longitude: number,
): Partial<SceneryArgs> {
  const solar = new Date(date.getTime() + (longitude / 15) * 3600000);
  const hour =
    solar.getUTCHours() +
    solar.getUTCMinutes() / 60 +
    solar.getUTCSeconds() / 3600;
  return {
    sunFromTime: true,
    sunDate: solar.toISOString().slice(0, 10),
    sunHour: Math.round(hour * 100) / 100,
    sunLatitude: Math.round(latitude * 100) / 100,
    sunLongitude: Math.round(longitude * 100) / 100,
  };
}

/** Writes a radius dragged with the hollow's rim grip back into `hollowRadius`. */
const sceneryHollowDecorator: Decorator = (Story, context) => {
  const [, updateArgs] = useArgs<SceneryArgs>();
  return Story({
    args: {
      ...context.args,
      onHollowRadius: (radius: number) =>
        updateArgs({ hollowRadius: Math.round(radius / 1000) * 1000 }),
    },
  });
};

/** Ticking `observerNow` sets the time to now and the place to the browser's (if it may tell), then clears it. */
const skyObserverNowDecorator: Decorator = Story => {
  const [args, updateArgs] = useArgs<SceneryArgs>();
  const now = !!args.observerNow;
  useEffect(() => {
    if (!now) return;
    const set = (latitude: number, longitude: number) =>
      updateArgs({
        ...skySunArgsAt(new Date(), latitude, longitude),
        observerNow: false,
      });
    const stay = () => set(args.sunLatitude, args.sunLongitude);
    if (!navigator.geolocation) {
      stay();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => set(coords.latitude, coords.longitude),
      stay,
      { timeout: 10000, maximumAge: 600000 },
    );
  }, [now, args.sunLatitude, args.sunLongitude, updateArgs]);
  return Story();
};

/**
 * The decorators the {@link SceneryArgs} need: the cutaway's grip writing its offset back,
 * `observerNow`, and the progress display the sky reports to (`storyProgress`). Add them
 * last (outermost): `useArgs` is valid only in a decorator.
 */
export const sceneryDecorators: Decorator[] = [
  sceneryCutawayDecorator,
  sceneryHollowDecorator,
  skyObserverNowDecorator,
  progressDecorator,
];

/**
 * The progress controls for a sky story: a popup along the top that waits half a second,
 * so the few relief tiles a camera move loads do not flash it.
 */
export const sceneryProgressArgs: ProgressArgs = {
  ...progressArgs,
  progressPosition: 'top',
  progressDelay: 500,
};

// Where a story's sky reports its progress.
const reportSkyProgress = storyProgress.source('sky', {
  name: 'Scenery',
  title: 'Preparing the sky',
});

/** Where a story's relief (a `GeoRelief`) reports how its tiles load. */
export const reportReliefProgress = storyProgress.source('relief', {
  name: 'Relief',
  title: 'Loading the relief',
});

/** A Scenery's `sun` from {@link SceneryArgs}. */
export const skySunFromArgs = (args: SceneryArgs): SkySun => ({
  ...skySunPosition(args),
  intensity: args.sunIntensity,
  size: args.sunSize,
  glow: args.sunGlow,
  glare: args.sunGlare,
  rays: args.sunRays,
  shimmer: args.sunShimmer,
  twilight: args.sunTwilight,
});

/** A `GeoGraticule`'s lines from {@link SceneryArgs}; `false` for none. */
export const sceneryGraticuleFromArgs = (
  args: SceneryArgs,
): GeoGraticuleOptions | false => {
  const opacity = args.graticuleOpacity;
  const props: GeoGraticuleOptions = {
    latLon: args.graticuleLatLon && {
      color: args.graticuleLatLonColor,
      thickness: args.graticuleLatLonThickness,
      opacity,
      interval: args.graticuleLatLonInterval || undefined,
      minSpacing: args.graticuleLatLonMinSpacing,
    },
    utm: args.graticuleUtm && {
      color: args.graticuleUtmColor,
      thickness: args.graticuleUtmThickness,
      opacity,
    },
    timeZones: args.graticuleTimeZones && {
      color: args.graticuleTimeZonesColor,
      thickness: args.graticuleTimeZonesThickness,
      opacity,
    },
    labels: {
      latLon: args.graticuleLatLonLabels && {
        size: args.graticuleLatLonLabelSize,
        density: args.graticuleLatLonLabelDensity,
        sizing: args.graticuleLatLonLabelSizing,
      },
      utm: args.graticuleUtmLabels,
      timeZones: args.graticuleTimeZonesLabels,
    },
  };
  return !!(props.latLon || props.utm || props.timeZones) && props;
};

/** A Scenery's `moon` from {@link SceneryArgs}. */
export const skyMoonFromArgs = (args: SceneryArgs): SkyMoon | false =>
  args.moon && { intensity: args.moonIntensity };

/** A Scenery's `stars` from {@link SceneryArgs}. */
export const skyStarsFromArgs = (args: SceneryArgs): SkyStars | false =>
  args.stars && { brightness: args.starBrightness, latitude: args.sunLatitude };

/** The swell of {@link SceneryArgs}, as a weather has it: none at no height. */
/** A story's `foamLife` choice as the prop: `auto` leaves it to the quality. */
export const foamLifeOf = (
  choice: 'auto' | 'on' | 'off',
): boolean | undefined => (choice === 'auto' ? undefined : choice === 'on');

export const swellFromArgs = (args: SceneryArgs): WeatherSwell[] =>
  args.swellHeight > 0
    ? [
        {
          height: args.swellHeight,
          period: args.swellPeriod,
          from: args.swellFrom,
        },
      ]
    : [];

/**
 * A story's `Weather` from {@link SceneryArgs}: its wind and swell, and its air's haze (with
 * `air` on). For a story with a `<Weather>` around its Scenery, whose sea and air then take
 * them from it (`weather` in {@link sceneryOceanFromArgs} and {@link sceneryPropsFromArgs}).
 */
export const sceneryWeatherFromArgs = (
  args: SceneryArgs,
): Pick<WeatherState, 'wind' | 'swell' | 'air'> => ({
  wind: { speed: args.windSpeed, from: (args.windDirection + 180) % 360 },
  swell: swellFromArgs(args),
  ...(args.air
    ? { air: { haze: args.airHaze, hazeHeight: args.airHazeHeight } }
    : {}),
});

/**
 * A `SceneryClouds`' props from {@link SceneryArgs}: a sky preset's layers at the quality
 * chosen; null for `clear`. With a `Weather` around the Scenery they take its wind and gusts.
 */
export const sceneryCloudsFromArgs = (
  args: Pick<SceneryArgs, 'clouds' | 'cloudsQuality'>,
): SceneryCloudsProps | null =>
  args.clouds === 'clear'
    ? null
    : { layers: args.clouds, quality: args.cloudsQuality };

/**
 * A `SceneryOcean`'s props from {@link SceneryArgs}, but for its level and depth, which are the
 * story's. With `weather`, no wind or swell of its own: it draws the enclosing `Weather`'s sea
 * ({@link sceneryWeatherFromArgs}).
 */
export const sceneryOceanFromArgs = (
  args: SceneryArgs,
  weather = false,
): SceneryOceanProps => ({
  water: args.skyWater,
  seabed: args.skySeabed && { color: args.skySeabedColor },
  seabedOpacity: args.skySeabedOpacity,
  waterOpacity: args.waterOpacity,
  ...(weather
    ? {}
    : {
        windSpeed: args.windSpeed,
        // A compass bearing in the controls; the sea takes world X/Z.
        windDirection: [
          Math.sin((args.windDirection * Math.PI) / 180),
          -Math.cos((args.windDirection * Math.PI) / 180),
        ] as Vec2,
        swells: weatherSeaSwells(swellFromArgs(args)),
      }),
  steepness: args.seaSteepness,
  waveTuning: args.seaWaveTuning,
  foamTuning: args.seaFoamTuning,
  quality: args.seaQuality,
  foamAmount: args.foamAmount,
  shoreFoam: args.seaShoreFoam,
  optics: args.seaOptics,
  detailScale: args.seaDetailScale,
  fresnelPower: args.seaFresnelPower > 0 ? args.seaFresnelPower : undefined,
  sparkle: args.seaSparkle,
  crestLight: args.seaCrestLight,
  foamLife: foamLifeOf(args.seaFoamLife),
  detailFadeDistance: [args.seaDetailFadeStart, args.seaDetailFadeEnd],
});

/** A `SceneryAbyss`' props from {@link SceneryArgs}, but for its level, which is the story's. */
export const sceneryAbyssFromArgs = (args: SceneryArgs): SceneryAbyssProps => ({
  colors: {
    ceiling: args.abyssCeiling,
    horizon: args.abyssHorizon,
    depth: args.abyssDepth,
  },
  fadeDistance: args.abyssFadeDistance,
  transition: args.abyssTransition,
  darkening: args.abyssDarkening,
  detail: args.abyssDetail,
  detailScale: args.abyssDetailScale,
  depthDetail: args.abyssDepthDetail,
  depthDetailScale: args.abyssDepthDetailScale,
  falloff: args.abyssFalloff,
  hollow: args.hollow && {
    style: args.hollowStyle,
    radius: args.hollowRadius,
    floorDepth: args.hollowFloorDepth,
    colors: {
      walls: args.hollowWalls,
      floor: args.hollowFloor,
      embers: args.hollowEmberColor,
      lid: args.hollowLidColor,
    },
    embers: args.hollowEmbers,
    lightFalloff: args.hollowLightFalloff,
    murk: args.hollowMurk,
    pulse: args.hollowPulse,
    air: args.hollowAir,
    handle: args.hollowHandle,
    onRadiusChange: args.onHollowRadius,
  },
});

/**
 * Every `<Scenery>` prop {@link SceneryArgs} set. Its features (graticule, sea, void, cutaway)
 * are components of their own under it: see `SceneryArgsFeatures`. With `weather`, its air
 * without a haze of its own: the enclosing `Weather`'s ({@link sceneryWeatherFromArgs}).
 */
export const sceneryPropsFromArgs = (args: SceneryArgs, weather = false) =>
  ({
    sun: skySunFromArgs(args),
    observer: skyObserverFromArgs(args),
    moon: skyMoonFromArgs(args),
    stars: skyStarsFromArgs(args),
    discScale: args.discScale,
    air:
      args.air &&
      (weather ? {} : { haze: args.airHaze, hazeHeight: args.airHazeHeight }),
    colors: {
      zenith: args.skyZenith,
      horizon: args.skyHorizon,
      ground: args.skyGround,
      nadir: args.skyNadir,
    },
    intensity: args.skyIntensity,
    horizonBlend: args.skyHorizonBlend,
    globe: args.globe,
    background:
      args.backgroundMode === 'none'
        ? false
        : args.backgroundMode === 'void'
          ? 'void'
          : true,
    subsurface: {
      intensity: args.subsurfaceIntensity,
      panels: {
        color: args.subsurfacePanelColor,
        intensity: args.subsurfacePanelIntensity,
        below: args.subsurfaceBelow
          ? {
              color: args.subsurfaceBelowColor,
              intensity: args.subsurfaceBelowIntensity,
            }
          : undefined,
      },
      light: {
        followSun: args.subsurfaceFollowSun,
        azimuth: args.subsurfaceLightAzimuth,
        elevation: args.subsurfaceLightElevation,
        elevationRange: [
          args.subsurfaceLightLowest,
          args.subsurfaceLightHighest,
        ],
        color: args.subsurfaceLightColor,
        intensity: args.subsurfaceLightIntensity,
        transition: args.subsurfaceLightTransition,
      },
    },
    environment: args.environment && {
      intensity: args.environmentIntensity,
      resolution: args.environmentResolution,
    },
    lightProbe: args.lightProbe && { intensity: args.lightProbeIntensity },
    capture: { interval: args.captureInterval, maxWait: args.captureMaxWait },
    debug: { tint: args.tint, environment: args.showEnvironment },
    onProgress: reportSkyProgress,
  }) satisfies Partial<SceneryProps>;

const range = (
  min: number,
  max: number,
  step: number,
  category: string,
  description?: string,
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  table: { category },
});

const toggle = (category: string, description: string) => ({
  control: { type: 'boolean' as const },
  description,
  table: { category },
});

const color = (category: string, description?: string) => ({
  control: { type: 'color' as const },
  description,
  table: { category },
});

// The controls shown only in the debug story; every other one shows in every story.
const ADVANCED = new Set<string>([
  'sunSize',
  'sunGlow',
  'sunGlare',
  'sunRays',
  'sunShimmer',
  'sunTwilight',
  'skyZenith',
  'skyHorizon',
  'skyGround',
  'skyNadir',
  'skyIntensity',
  'skyHorizonBlend',
  'windDirection',
  'swellPeriod',
  'swellFrom',
  'seaSteepness',
  'skySeabedColor',
  'seaDetailScale',
  'seaFresnelPower',
  'seaSparkle',
  'seaCrestLight',
  'seaFoamLife',
  'seaDetailFadeStart',
  'seaDetailFadeEnd',
  'abyssCeiling',
  'abyssHorizon',
  'abyssDepth',
  'abyssFadeDistance',
  'abyssTransition',
  'abyssDarkening',
  'abyssDetail',
  'abyssDetailScale',
  'abyssDepthDetail',
  'abyssDepthDetailScale',
  'abyssFalloff',
  'hollowWalls',
  'hollowFloor',
  'hollowEmberColor',
  'hollowLidColor',
  'hollowLightFalloff',
  'hollowMurk',
  'hollowPulse',
  'hollowAir',
  'hollowHandle',
  'subsurfaceIntensity',
  'subsurfacePanelColor',
  'subsurfaceBelow',
  'subsurfaceBelowColor',
  'subsurfaceBelowIntensity',
  'environmentIntensity',
  'environmentResolution',
  'lightProbeIntensity',
  'captureInterval',
  'captureMaxWait',
  'cutawayExitTilt',
  'cutawaySoftness',
  'cutawayWave1Amplitude',
  'cutawayWave1Frequency',
  'cutawayWave1Phase',
  'cutawayWave2Amplitude',
  'cutawayWave2Frequency',
  'cutawayWave2Phase',
  'cutawayRimColor',
  'cutawayRimWidth',
  'cutawayShadowOpacity',
  'cutawayShadowWidth',
  'cutawayEase',
  'cutawayZoomFollow',
  'cutawayReference',
  'tint',
  'showEnvironment',
]);

const SUN = 'Sun';
const GRATICULE = 'Graticule';
const SKY = 'Scenery';
const CLOUDS = 'Clouds';
const SEA = 'Sea';
const SUBSURFACE = 'Subsurface';
const ENVIRONMENT = 'Environment';
const DEBUG = 'Debug';

const allSkyArgTypes = (): ArgTypes<SceneryArgs> => ({
  sunFromTime: toggle(
    SUN,
    'Set the sky from a date, an hour and a place (the Scenery\u2019s `observer`): the real sun, moon and its phase, stars and planets. Off, the sun is set by hand, the moon is a full one opposite it and the stars are procedural.',
  ),
  sunAzimuth: {
    ...range(0, 360, 1, SUN, 'Compass bearing of the sun, in degrees.'),
    if: { arg: 'sunFromTime', truthy: false },
  },
  sunElevation: {
    ...range(-30, 90, 0.5, SUN, 'Degrees above the horizon.'),
    if: { arg: 'sunFromTime', truthy: false },
  },
  sunDate: {
    control: { type: 'text' },
    description: 'The date, as `YYYY-MM-DD`.',
    if: { arg: 'sunFromTime' },
    table: { category: SUN },
  },
  sunHour: {
    ...range(
      0,
      24,
      0.05,
      SUN,
      'Local solar time at the place: 12 is noon, when the sun is due south (north in the southern hemisphere).',
    ),
    if: { arg: 'sunFromTime' },
  },
  sunLatitude: {
    ...range(-90, 90, 0.1, SUN, 'Degrees north.'),
    if: { arg: 'sunFromTime' },
  },
  sunLongitude: {
    ...range(-180, 180, 0.1, SUN, 'Degrees east.'),
    if: { arg: 'sunFromTime' },
  },
  observerNow: toggle(
    SUN,
    'Set the time to now and the place to yours, if the browser may tell; then it clears itself.',
  ),
  sunIntensity: range(
    0,
    5,
    0.05,
    SUN,
    'Intensity of the sky\u2019s directional light in full daylight.',
  ),
  sunSize: range(
    0.1,
    5,
    0.01,
    SUN,
    'Angular radius of the sun disc, in degrees (the real sun\u2019s 0.267).',
  ),
  sunGlow: range(0, 2, 0.05, SUN, 'Strength of the halo around the sun.'),
  sunGlare: range(
    0,
    2,
    0.05,
    SUN,
    'Strength of the bright glare hugging the sun disc.',
  ),
  sunRays: range(
    0,
    2,
    0.05,
    SUN,
    'Strength of the rays around the sun disc; 0 for none.',
  ),
  sunShimmer: {
    ...toggle(SUN, 'The rays shimmer slowly.'),
    if: { arg: 'sunRays', truthy: true },
  },
  sunTwilight: range(
    0,
    2,
    0.05,
    SUN,
    'Strength of the warm glow along the horizon at sunrise and sunset, and the pink belt opposite it; 0 for none.',
  ),
  graticuleLatLon: toggle(
    GRATICULE,
    'Lines of latitude and longitude (`GeoGraticule` `latLon`): on the sea\u2019s surface, the land and a dry seabed, at any distance. A layer of its own, drawn over what lies under it.',
  ),
  graticuleLatLonColor: {
    ...color(GRATICULE),
    if: { arg: 'graticuleLatLon' },
  },
  graticuleLatLonThickness: {
    ...range(0.5, 6, 0.25, GRATICULE, 'Width in screen pixels.'),
    if: { arg: 'graticuleLatLon' },
  },
  graticuleLatLonInterval: {
    ...range(
      0,
      30,
      0.25,
      GRATICULE,
      'Degrees between lines; 0 follows the view: 30\u00b0, and each of 10\u00b0, 5\u00b0, 1\u00b0, 30\u2032, 10\u2032, 5\u2032 and 1\u2032 only where its lines lie `graticuleLatLonMinSpacing` pixels apart.',
    ),
    if: { arg: 'graticuleLatLon' },
  },
  graticuleLatLonMinSpacing: {
    ...range(
      30,
      400,
      10,
      GRATICULE,
      'Following the view (interval 0), how far apart on screen its lines are at the least, in pixels (`minSpacing`): a finer step fades in over the halving before.',
    ),
    if: { arg: 'graticuleLatLon' },
  },
  graticuleLatLonLabels: {
    ...toggle(
      GRATICULE,
      'Each line\u2019s name painted flat on the sea along it (`labels.latLon`): a `LabelLayer` around where the view is centred, at the lines\u2019 step.',
    ),
    if: { arg: 'graticuleLatLon' },
  },
  graticuleLatLonLabelSize: {
    ...range(
      0.02,
      0.3,
      0.01,
      GRATICULE,
      'The labels\u2019 font size, as a fraction of a cell\u2019s narrower side on the ground (`labels.latLon.size`).',
    ),
    if: { arg: 'graticuleLatLonLabels' },
  },
  graticuleLatLonLabelDensity: {
    ...range(
      0.1,
      1,
      0.05,
      GRATICULE,
      'How densely the lines are named: at 1 a name every 4 cells along its line, at 0.5 every 8 (`labels.latLon.density`).',
    ),
    if: { arg: 'graticuleLatLonLabels' },
  },
  graticuleLatLonLabelSizing: {
    control: { type: 'inline-radio' },
    options: ['stepped', 'smooth'],
    description:
      'How the labels\u2019 size follows the zoom (`labels.latLon.sizing`): `stepped` by the step the lines are seen at, glued between changes of step; `smooth` with the lines\u2019 spacing as the finer step fades in, never jumping.',
    if: { arg: 'graticuleLatLonLabels' },
    table: { category: GRATICULE },
  },
  graticuleUtm: toggle(
    GRATICULE,
    'The UTM zones (`utm`): their edges every 6\u00b0 from 80\u00b0S to 84\u00b0N, Norway\u2019s 32V reaching west to 3\u00b0E (just east of Volve) and Svalbard\u2019s 31X\u201337X, and their latitude bands every 8\u00b0.',
  ),
  graticuleUtmColor: {
    ...color(GRATICULE),
    if: { arg: 'graticuleUtm' },
  },
  graticuleUtmThickness: {
    ...range(0.5, 6, 0.25, GRATICULE, 'Width in screen pixels.'),
    if: { arg: 'graticuleUtm' },
  },
  graticuleUtmLabels: {
    ...toggle(
      GRATICULE,
      'Each UTM zone\u2019s name (`32N`) in the middle of each of its cells (`labels.utm`).',
    ),
    if: { arg: 'graticuleUtm' },
  },
  graticuleTimeZones: toggle(
    GRATICULE,
    'The nautical time zones (`timeZones`): meridians 15\u00b0 apart either side of Greenwich, and the date line at 180\u00b0.',
  ),
  graticuleTimeZonesColor: {
    ...color(GRATICULE),
    if: { arg: 'graticuleTimeZones' },
  },
  graticuleTimeZonesThickness: {
    ...range(0.5, 6, 0.25, GRATICULE, 'Width in screen pixels.'),
    if: { arg: 'graticuleTimeZones' },
  },
  graticuleTimeZonesLabels: {
    ...toggle(
      GRATICULE,
      'Each time zone\u2019s offset (`UTC+1`) in the middle of each of its cells, a row every UTM band (`labels.timeZones`).',
    ),
    if: { arg: 'graticuleTimeZones' },
  },
  graticuleOpacity: range(0, 1, 0.05, GRATICULE, 'Every line\u2019s opacity.'),
  backgroundMode: {
    control: { type: 'inline-radio' },
    options: ['sky', 'void', 'none'],
    description:
      "What is drawn behind the scene (`background`): `sky` the sky and its stage; `void` the void\u2019s grey gradient in the sky\u2019s place (`'void'`), as the stand-in draws it while the sky compiles: no air, sun, moon, stars or clouds, and the scene lit by the subsurface everywhere, the void and a sea drawn as ever (recompiles); `none` nothing (`false`), switched instantly with nothing rebuilt or baked, the scene still lit by the sky, by the subsurface.",
    table: { category: SKY },
  },
  clouds: {
    control: { type: 'select' },
    options: Object.keys(SKY_PRESETS),
    description:
      'A sky of 3D clouds about the field (`SceneryClouds` `layers`, a `SKY_PRESETS` name), lit by the sun and the moon: `clear` for none. Without a `Weather` around the Scenery they have no wind: they hold still, and no gusts work on them.',
    table: { category: CLOUDS },
  },
  cloudsQuality: {
    control: { type: 'inline-radio' },
    options: ['low', 'medium', 'high', 'ultra'],
    description:
      'How much the clouds spend for how they look (`quality`, `CLOUDS_QUALITY`): the share of the screen\u2019s resolution, how finely they are marched, how often they read the shape (once at LOW and MEDIUM: a march program each, compiled as the quality switches, the clouds drawn as they were meanwhile), how much of it a frame (`temporal`), and their shadows\u2019 map (512\u00b2 at LOW and MEDIUM, 1024\u00b2 at HIGH and ULTRA: as sharp from some 6.5 km up as 512\u00b2 from 2 km).',
    table: { category: CLOUDS },
  },
  air: toggle(
    SKY,
    'The air thins with height: climbing, the sky deepens and its haze closes onto the horizon. Seen from low down, the far sea fades into the horizon.',
  ),
  airHaze: {
    ...range(
      0,
      1,
      0.01,
      SKY,
      'How much of the haze at sea level lies in a low layer rather than in the clear air: from above it, the sea below is clearer and the layer shows as a bright band along the horizon.',
    ),
    if: { arg: 'air' },
  },
  airHazeHeight: {
    ...range(
      200,
      5000,
      50,
      SKY,
      'Height over which the low haze thins by e, in metres: a hazier or a warmer day lifts it.',
    ),
    if: { arg: 'air' },
  },
  skyZenith: color(SKY, 'Straight up.'),
  skyHorizon: color(SKY, 'Just above the horizon.'),
  skyGround: color(SKY, 'Just below the horizon.'),
  skyNadir: color(SKY, 'Straight down.'),
  skyIntensity: range(
    0,
    3,
    0.05,
    SKY,
    'Scales the whole sky: background, environment and light probe.',
  ),
  skyHorizonBlend: range(
    0.001,
    0.3,
    0.001,
    SKY,
    'Width of the horizon to ground transition.',
  ),
  moon: toggle(
    SKY,
    'The moon: its disc and glow, and the sky\u2019s light once the sun is well down. From a time and place it is the real one, with its phase, up by day too; else a full moon opposite the sun.',
  ),
  moonIntensity: {
    ...range(0, 1, 0.01, SKY, 'Intensity of the moonlight, at full night.'),
    if: { arg: 'moon' },
  },
  stars: toggle(
    SKY,
    'Stars, out once it is dark. From a time and place, the real ones to magnitude 5 and the planets, each out as the sky darkens enough for it, over faint procedural ones; else procedural.',
  ),
  starBrightness: {
    ...range(0, 2, 0.05, SKY, 'Brightness of the stars.'),
    if: { arg: 'stars' },
  },
  discScale: range(
    1,
    5,
    0.1,
    SKY,
    'The sun\u2019s and the moon\u2019s discs, glare and all, this many times their real size, as games do. 1 is real: half a degree across, small in a wide view.',
  ),
  skyWater: toggle(
    SEA,
    'The sea\u2019s water, everywhere. Off, the seabed lies dry, and the cutaway cuts it.',
  ),
  skySeabed: toggle(
    SEA,
    'The sea\u2019s seabed, everywhere, an occupant\u2019s included. Off, it is peeled: with the void a hollow (`hollow`), the relief and the seabed are cut away over the hollow and stay around it; without, the void lies below the water. From below its lid is still a roof, and the cutaway cuts the water alone.',
  ),
  waterOpacity: range(0, 1, 0.01, SEA, 'The water\u2019s own opacity.'),
  skySeabedOpacity: range(
    0,
    1,
    0.01,
    SEA,
    'How much of what lies under the seabed it hides. Crossing 1 rebuilds the seabed\u2019s materials, which compile again.',
  ),
  windSpeed: range(0, 25, 0.5, SEA, 'Drives the waves, in m/s.'),
  foamAmount: range(0, 1, 0.01, SEA, 'Whitecaps on the waves.'),
  seaShoreFoam: range(
    0,
    1,
    0.01,
    SEA,
    'Surf where the waves break on a coast (`shoreFoam`): where the depth of the scene\u2019s ground under the sea falls to 1.3 times their height. The waves shoal and die out toward the shore by the same depth, whatever this is.',
  ),
  windDirection: range(
    0,
    360,
    1,
    SEA,
    'Compass bearing the wind blows toward.',
  ),
  swellHeight: range(
    0,
    6,
    0.1,
    SEA,
    'A swell from weather far away: its significant height in metres, running on whatever the wind here does. 0 none.',
  ),
  swellPeriod: {
    ...range(4, 20, 0.5, SEA, 'The swell\u2019s peak period, in seconds.'),
    if: { arg: 'swellHeight', truthy: true },
  },
  swellFrom: {
    ...range(0, 360, 1, SEA, 'Compass bearing the swell comes from.'),
    if: { arg: 'swellHeight', truthy: true },
  },
  seaSteepness: range(
    0,
    2,
    0.05,
    SEA,
    'The waves\u2019 slopes scaled for show: 1 as the spectrum gives them.',
  ),
  seaOptics: {
    control: { type: 'inline-radio' },
    options: ['realistic', 'clear'],
    description:
      'The water\u2019s look (`optics`, `WATER_OPTICS_PRESETS`): REALISTIC about the North Sea\u2019s (15 m visibility); CLEAR to see the seabed and what lies under the sea (750 m).',
    table: { category: SEA },
  },
  skySeabedColor: color(SEA, 'The seabed\u2019s colour.'),
  seaDetailScale: range(
    0.005,
    0.5,
    0.005,
    SEA,
    'The foam\u2019s feature frequency.',
  ),
  seaFresnelPower: range(
    0,
    8,
    0.1,
    SEA,
    '0: the reflection water has (Fresnel, IOR 1.333). Above: the old look, Schlick’s curve with this exponent (4 was the default; higher keeps the reflections nearer the horizon). Recompiles as it turns on or off.',
  ),
  seaSparkle: range(
    0,
    2,
    0.05,
    SEA,
    'The sun’s glitter (`sparkle`): the glint broken into the glints of ripples too small to draw, where a pixel holds few of them, the same mean. 0 none (compiled out; the component’s default on low and medium), 1 as modelled (its default on high and ultra), more for more. About 5 % of the sea. Recompiles as it turns on or off.',
  ),
  seaCrestLight: range(
    0,
    3,
    0.05,
    SEA,
    'The sun’s light through the waves’ crests (`crestLight`), with the sun behind them: a turquoise glow high on the waves, from the water’s own colour and clarity. 0 none, 1 as modelled (the default), more for more.',
  ),
  seaFoamLife: {
    control: { type: 'inline-radio' },
    options: ['auto', 'on', 'off'],
    table: { category: SEA },
    description:
      'The whitecaps’ life (`foamLife`): the foam a breaking crest leaves trails behind it, drifts downwind, fades, and is gathered by the wind into streaks, about the camera. AUTO: as the quality (high and ultra). Recompiles as it turns on or off.',
  },
  seaDetailFadeStart: range(
    0,
    200000,
    1000,
    SEA,
    'Distance at which the waves, foam and patches start fading to a flat mirror.',
  ),
  seaDetailFadeEnd: range(
    1000,
    400000,
    1000,
    SEA,
    'Distance at which they are gone.',
  ),
  subsurfaceFollowSun: toggle(
    SUBSURFACE,
    'The directional light below the seabed turns with the sun\u2019s compass bearing, its elevation held between the lowest and the highest. Off, it is fixed.',
  ),
  subsurfaceLightAzimuth: {
    ...range(
      0,
      360,
      1,
      SUBSURFACE,
      'Compass bearing of the fixed light, in degrees.',
    ),
    if: { arg: 'subsurfaceFollowSun', truthy: false },
  },
  subsurfaceLightElevation: {
    ...range(0, 90, 1, SUBSURFACE, 'Elevation of the fixed light, in degrees.'),
    if: { arg: 'subsurfaceFollowSun', truthy: false },
  },
  subsurfaceLightLowest: {
    ...range(
      0,
      90,
      1,
      SUBSURFACE,
      'Lowest the light following the sun goes, in degrees.',
    ),
    if: { arg: 'subsurfaceFollowSun' },
  },
  subsurfaceLightHighest: {
    ...range(
      0,
      90,
      1,
      SUBSURFACE,
      'Highest the light following the sun goes, in degrees.',
    ),
    if: { arg: 'subsurfaceFollowSun' },
  },
  subsurfaceLightColor: color(SUBSURFACE, 'Colour of the light below.'),
  subsurfaceLightIntensity: range(
    0,
    5,
    0.05,
    SUBSURFACE,
    'Intensity of the light below.',
  ),
  subsurfaceLightTransition: range(
    0,
    3,
    0.05,
    SUBSURFACE,
    'Seconds the light eases over between the sun\u2019s and its own as the camera crosses the seabed; 0 for at once.',
  ),
  subsurfaceIntensity: range(
    0,
    4,
    0.05,
    SUBSURFACE,
    'Scales the backdrop and the panels.',
  ),
  subsurfacePanelColor: color(SUBSURFACE, 'Colour of every light panel.'),
  subsurfacePanelIntensity: range(
    0,
    20,
    0.1,
    SUBSURFACE,
    'Radiance of every light panel.',
  ),
  subsurfaceBelow: toggle(
    SUBSURFACE,
    'Light the panels below the horizon apart.',
  ),
  subsurfaceBelowColor: {
    ...color(SUBSURFACE),
    if: { arg: 'subsurfaceBelow' },
  },
  subsurfaceBelowIntensity: {
    ...range(0, 20, 0.1, SUBSURFACE),
    if: { arg: 'subsurfaceBelow' },
  },
  abyssCeiling: color(SUBSURFACE, 'The void\u2019s lid overhead.'),
  // The plain void's own: with the hollow on, the void past it is black.
  abyssHorizon: {
    ...color(
      SUBSURFACE,
      'The plain void (hollow off): where its lid and depths meet, far away.',
    ),
    if: { arg: 'hollow', truthy: false },
  },
  abyssDepth: {
    ...color(
      SUBSURFACE,
      'The plain void (hollow off): straight down, deep in it.',
    ),
    if: { arg: 'hollow', truthy: false },
  },
  abyssFadeDistance: range(
    0,
    100000,
    500,
    SUBSURFACE,
    'Distance over which the void\u2019s lid recedes into its horizon colour, in metres; 0 for never.',
  ),
  abyssTransition: range(
    1,
    2000,
    1,
    SUBSURFACE,
    'Depth below the level over which the void fades in, in metres. Without a sea only: under one, it begins at the seabed.',
  ),
  abyssDarkening: range(
    0,
    20000,
    100,
    SUBSURFACE,
    'Depth of the camera below the level over which the whole void dims toward black, in metres; 0 for none.',
  ),
  abyssDetail: range(
    0,
    1,
    0.01,
    SUBSURFACE,
    'Noise ripples on the void\u2019s lid; 0 for none.',
  ),
  abyssDetailScale: range(
    50,
    10000,
    50,
    SUBSURFACE,
    'Size of those ripples, in metres.',
  ),
  abyssDepthDetail: {
    ...range(
      0,
      0.5,
      0.01,
      SUBSURFACE,
      'The plain void (hollow off): faint distant rock in its depths, wavy strata broken by crags; 0 for none.',
    ),
    if: { arg: 'hollow', truthy: false },
  },
  abyssDepthDetailScale: {
    ...range(
      0.25,
      4,
      0.05,
      SUBSURFACE,
      'The plain void (hollow off): size of the rock\u2019s features.',
    ),
    if: { arg: 'hollow', truthy: false },
  },
  abyssFalloff: {
    ...range(
      0.1,
      3,
      0.05,
      SUBSURFACE,
      'The plain void (hollow off): how its depths darken below the horizon, the gradient\u2019s exponent. Smaller reaches the depth colour sooner.',
    ),
    if: { arg: 'hollow', truthy: false },
  },
  hollow: toggle(
    SUBSURFACE,
    'The void as a hollow in the crust under the field (`SceneryAbyss`\u2019s `hollow`): a floor deep under the seabed and walls about it. Peeling the seabed opens it, the relief and the seabed cut away inside its rim and whole around it. Off, the bottomless gradient, and a peeled seabed gone everywhere.',
  ),
  hollowStyle: {
    control: { type: 'inline-radio' },
    options: ['calm', 'molten', 'simple'],
    description:
      'How the hollow looks (`hollow.style`): `calm`, grey rock and dark cracks, a sober backdrop; `molten`, a warm floor, its cracks glowing and pulsing; `simple`, a diagram, an even slope with depth lines, floor rings and a ring along the rim. Its colours, embers, pulse and air follow it unless set.',
    if: { arg: 'hollow' },
    table: { category: SUBSURFACE },
  },
  hollowRadius: {
    ...range(
      50000,
      1500000,
      10000,
      SUBSURFACE,
      'The hollow\u2019s rim, along the sea from the field, in metres: at 500 km its walls stand at the horizon seen from the sea.',
    ),
    if: { arg: 'hollow' },
  },
  hollowFloorDepth: {
    ...range(
      5000,
      100000,
      1000,
      SUBSURFACE,
      'Depth of the hollow\u2019s floor under the seabed, in metres: about where the mantle begins.',
    ),
    if: { arg: 'hollow' },
  },
  hollowWalls: {
    ...color(
      SUBSURFACE,
      'The hollow\u2019s walls\u2019 rock; unset, the style\u2019s.',
    ),
    if: { arg: 'hollow' },
  },
  hollowFloor: {
    ...color(
      SUBSURFACE,
      'The hollow\u2019s floor\u2019s rock; unset, the style\u2019s.',
    ),
    if: { arg: 'hollow' },
  },
  hollowEmberColor: {
    ...color(
      SUBSURFACE,
      'The glow in the floor\u2019s cracks; unset, the style\u2019s.',
    ),
    if: { arg: 'hollow' },
  },
  hollowLidColor: {
    ...color(
      SUBSURFACE,
      'The simple style\u2019s lid, seen from inside; unset, the style\u2019s.',
    ),
    if: { arg: 'hollow' },
  },
  hollowEmbers: {
    ...range(
      0,
      3,
      0.05,
      SUBSURFACE,
      'How much the floor\u2019s cracks glow; 0 for none. Unset, the style\u2019s.',
    ),
    if: { arg: 'hollow' },
  },
  hollowLightFalloff: {
    ...range(
      1000,
      50000,
      500,
      SUBSURFACE,
      'Depth under the seabed over which the light from the opening falls by e, in metres.',
    ),
    if: { arg: 'hollow' },
  },
  hollowMurk: {
    ...range(
      0,
      4,
      0.05,
      SUBSURFACE,
      'How much the void\u2019s air darkens with depth; 0 for none.',
    ),
    if: { arg: 'hollow' },
  },
  hollowPulse: {
    ...range(
      0,
      1,
      0.05,
      SUBSURFACE,
      'How far the embers\u2019 glow dims as it slowly pulses (a share of it); 0 holds it steady. Unset, the style\u2019s.',
    ),
    if: { arg: 'hollow' },
  },
  hollowAir: {
    ...range(
      0,
      1,
      0.05,
      SUBSURFACE,
      'How much of the air is left over the open hollow; the rest drains into it, darkening the sky over it. Unset, the style\u2019s.',
    ),
    if: { arg: 'hollow' },
  },
  hollowHandle: {
    ...toggle(
      SUBSURFACE,
      'A grip on the rim that drags the radius (`hollow.handle`), in the simple style only: a ghost ring follows, and the hollow takes the radius on release. A double click puts it back.',
    ),
    if: { arg: 'hollowStyle', eq: 'simple' },
  },
  globe: toggle(
    ENVIRONMENT,
    'The Earth is a fixed globe: the sea, the sky and the clouds follow its curve, so the horizon drops as the camera climbs: about 1\u00b0 at 1 km, 4\u00b0 at 15 km. The sea stays flat over the scene. Off, a flat sea everywhere: only right near one field.',
  ),
  environment: toggle(
    ENVIRONMENT,
    'Bake the sky into `scene.environment`, which lights MeshStandard/MeshPhysical materials.',
  ),
  lightProbe: toggle(
    ENVIRONMENT,
    'Bake the sky into a light probe, which lights every `lights: true` material.',
  ),
  environmentIntensity: {
    ...range(0, 3, 0.05, ENVIRONMENT),
    if: { arg: 'environment' },
  },
  environmentResolution: {
    control: { type: 'select' },
    options: [64, 128, 256, 512, 1024],
    description:
      'Cube face size of the environment\u2019s bake (`environment.resolution`, default 64). Only smooth, glossy materials lit by the environment show the difference: 128 or more for sharper reflections, at 1.6 ms more a bake (RTX A1000). A change recompiles every material it lights.',
    if: { arg: 'environment' },
    table: { category: ENVIRONMENT },
  },
  lightProbeIntensity: {
    ...range(0, 3, 0.05, ENVIRONMENT),
    if: { arg: 'lightProbe' },
  },
  captureInterval: range(
    0,
    2000,
    50,
    ENVIRONMENT,
    'How long the sky must be still before it is baked again, in milliseconds.',
  ),
  captureMaxWait: range(
    0,
    2000,
    50,
    ENVIRONMENT,
    'Longest the environment and the light probe go without a bake while the sky keeps changing, in milliseconds.',
  ),
  pipeline: {
    control: { type: 'inline-radio' },
    options: ['default', 'oit'],
    description:
      '`default` lets R3F render; `oit` renders through an order-independent transparency pipeline (`OITRenderPass` with SMAA, then `OutputPass`).',
    table: { category: DEBUG },
  },
  stats: toggle(
    DEBUG,
    'GPU time, frame time and FPS, draw calls, triangles and resident geometries, textures and programs.',
  ),
  tint: toggle(DEBUG, 'Tint each part of the sky by what draws it.'),
  showEnvironment: toggle(
    DEBUG,
    'The environment\u2019s bake for the zone in view as its six faces, lower right: `+Y` over `-X -Z +X +Z`, `-Y` under.',
  ),
  ...sceneryCutawayArgTypes(),
  ...toneMappingArgTypes(),
});

// The renderer's tone mapping, applied with a sky or without: never behind `shownIf`.
const UNGATED = new Set(Object.keys(toneMappingArgs));

/**
 * Controls for {@link SceneryArgs}. The basic ones show; with `debug`, so do the advanced and
 * debug ones. With `shownIf`, each control shows only while that arg is on (unless it has a
 * condition of its own, or is the renderer's tone mapping). ⚠️ Storybook also leaves such an
 * arg out of the story's args while it is hidden.
 */
export function sceneryArgTypes({
  debug = false,
  shownIf,
}: { debug?: boolean; shownIf?: string } = {}): ArgTypes<SceneryArgs> {
  const argTypes = allSkyArgTypes();
  for (const [key, argType] of Object.entries(argTypes)) {
    if (!argType) continue;
    if (!debug && ADVANCED.has(key)) {
      argTypes[key as keyof SceneryArgs] = {
        ...argType,
        table: { disable: true },
      };
    } else if (shownIf && !argType.if && !UNGATED.has(key)) {
      argTypes[key as keyof SceneryArgs] = { ...argType, if: { arg: shownIf } };
    }
  }
  return argTypes;
}

/** Story args for the relief, a `GeoRelief` (see {@link sceneryReliefFromArgs}). */
export type SceneryReliefArgs = SceneryReliefLookArgs & {
  relief: boolean;
  /** the demo reliefs merged, by id (see {@link SCENERY_DEMO_RELIEF_LAYERS}) */
  reliefLayers: string[];
};

/** Story args for how a relief looks (see {@link sceneryReliefLookFromArgs}). */
export type SceneryReliefLookArgs = {
  reliefColor: 'flat' | 'ramp';
  reliefLandColor: string;
  reliefRamp: string;
  reliefRampRange: boolean;
  reliefRampMin: number;
  reliefRampMax: number;
  reliefRampReverse: boolean;
  reliefSeabed: 'sea' | 'ramp' | 'bathymetry';
  reliefContours: boolean;
  reliefContourInterval: number;
  reliefContourMajor: number;
  reliefContourThickness: number;
  reliefContourMode: 'darken' | 'lighten' | 'mixed';
  reliefContourFactor: number;
  reliefContourColor: string;
  reliefContourSeabed: boolean;
  reliefContourLabels: boolean;
  reliefContourLabelBaseline: 'top' | 'middle' | 'bottom';
  reliefContourLabelFlip: boolean;
  reliefLocalLook: boolean;
};

export const sceneryReliefLookArgs: SceneryReliefLookArgs = {
  reliefColor: 'flat',
  reliefLandColor: '#34433b',
  reliefRamp: 'terrain',
  reliefRampRange: false,
  reliefRampMin: 0,
  reliefRampMax: 2000,
  reliefRampReverse: false,
  reliefSeabed: 'sea',
  reliefContours: false,
  reliefContourInterval: 100,
  reliefContourMajor: 5,
  reliefContourThickness: 0.8,
  reliefContourMode: 'darken',
  reliefContourFactor: 0.5,
  reliefContourColor: '#000000',
  reliefContourSeabed: true,
  reliefContourLabels: false,
  reliefContourLabelBaseline: 'middle',
  reliefContourLabelFlip: true,
  reliefLocalLook: false,
};

const RELIEF = 'Relief';

/**
 * Controls for {@link SceneryReliefLookArgs}; with `shownIf`, its two switches (the colour and
 * the contours) show only while that arg is on.
 */
export function sceneryReliefLookArgTypes(
  shownIf?: string,
): ArgTypes<SceneryReliefLookArgs> {
  const shown = shownIf ? { if: { arg: shownIf } } : {};
  const ramped = { if: { arg: 'reliefColor', eq: 'ramp' } };
  const lined = { if: { arg: 'reliefContours' } };
  return {
    reliefColor: {
      control: { type: 'inline-radio' },
      options: ['flat', 'ramp'],
      description:
        'The land in one colour, the seabed as the sea\u2019s; or by height through `reliefRamp`. Changing any of the look builds nothing again.',
      table: { category: RELIEF },
      ...shown,
    },
    reliefLandColor: {
      ...color(RELIEF, 'The land\u2019s colour.'),
      if: { arg: 'reliefColor', eq: 'flat' },
    },
    reliefRamp: {
      control: { type: 'select' },
      options: builtInColorRamps.map(ramp => ramp.name),
      description:
        'The colour ramp: TERRAIN (the default), ATLAS and TERRAIN-NORDIC run over heights of their own; any other over 0 to 2000 m (\u22123000 m with the seabed on it), unless `reliefRampRange` sets it.',
      table: { category: RELIEF },
      ...ramped,
    },
    reliefRampRange: {
      ...toggle(
        RELIEF,
        'Set the heights the ramp runs over (`reliefRampMin`, `reliefRampMax`) instead of its own.',
      ),
      ...ramped,
    },
    reliefRampMin: {
      ...range(
        -11000,
        9000,
        10,
        RELIEF,
        'The height at the ramp\u2019s low end, metres.',
      ),
      if: { arg: 'reliefRampRange' },
    },
    reliefRampMax: {
      ...range(-11000, 9000, 10, RELIEF, 'The height at its high end, metres.'),
      if: { arg: 'reliefRampRange' },
    },
    reliefRampReverse: {
      ...toggle(RELIEF, 'Run the ramp from high to low.'),
      ...ramped,
    },
    reliefSeabed: {
      control: { type: 'inline-radio' },
      options: ['sea', 'ramp', 'bathymetry'],
      description:
        'The seabed: the SEA\u2019s seabed colour, darker with depth; the land\u2019s RAMP too, across both; or BATHYMETRY, a ramp of its own.',
      table: { category: RELIEF },
      ...ramped,
    },
    reliefContours: {
      ...toggle(
        RELIEF,
        'Contour lines over the relief, from the sea\u2019s level.',
      ),
      ...shown,
    },
    reliefContourInterval: {
      ...range(1, 1000, 1, RELIEF, 'Metres between contour lines.'),
      ...lined,
    },
    reliefContourMajor: {
      ...range(
        0,
        10,
        1,
        RELIEF,
        'Every how many lines a major one, twice as wide; 0 for none.',
      ),
      ...lined,
    },
    reliefContourThickness: {
      ...range(
        0.1,
        3,
        0.1,
        RELIEF,
        'The lines\u2019 width, about pixels each side.',
      ),
      ...lined,
    },
    reliefContourMode: {
      control: { type: 'inline-radio' },
      options: ['darken', 'lighten', 'mixed'],
      description:
        'How a line shades the ground: DARKEN, LIGHTEN, or MIXED toward `reliefContourColor`.',
      table: { category: RELIEF },
      ...lined,
    },
    reliefContourFactor: {
      ...range(0, 1, 0.05, RELIEF, 'How strongly a line shades.'),
      ...lined,
    },
    reliefContourColor: {
      ...color(RELIEF, 'The lines\u2019 colour, MIXED.'),
      if: { arg: 'reliefContourMode', eq: 'mixed' },
    },
    reliefContourSeabed: {
      ...toggle(RELIEF, 'Contour lines on the seabed too.'),
      ...lined,
    },
    reliefContourLabels: {
      ...toggle(
        RELIEF,
        'The major lines\u2019 heights written along them on the ground (`contours.labels`); none on the seabed while the sea has water.',
      ),
      ...lined,
    },
    reliefContourLabelBaseline: {
      control: { type: 'inline-radio' },
      options: ['top', 'middle', 'bottom'],
      description:
        'Where a contour label\u2019s text lies by its line (`contours.labels.baseline`): across it (MIDDLE), hanging from it on the downhill side (TOP), or standing on it on the uphill side (BOTTOM).',
      table: { category: RELIEF },
      ...lined,
    },
    reliefContourLabelFlip: {
      ...toggle(
        RELIEF,
        'Contour labels turned to read left to right on screen (`contours.labels.flip`); off, the top of the text always uphill, as on a paper map.',
      ),
      ...lined,
    },
    reliefLocalLook: {
      ...toggle(
        RELIEF,
        'The finest layer a look of its own (`layerLooks`): a rainbow over its depths, \u2212130 to \u221260 m, and lines every 5 m, a major one every 25 m.',
      ),
      ...shown,
    },
  };
}

const CONTOUR_MODES = {
  darken: ContourColorMode.darken,
  lighten: ContourColorMode.lighten,
  mixed: ContourColorMode.mixed,
};

// The contour labels asked for: the defaults, but where the text lies by its line and
// whether it turns to read left to right.
const contourLabelsOf = (a: SceneryReliefLookArgs) => ({
  baseline: a.reliefContourLabelBaseline,
  flip: a.reliefContourLabelFlip,
});

/**
 * A relief's `color`, `contours` and `layerLooks` from {@link SceneryReliefLookArgs}, for a
 * relief of `layers` (the last, the finest, takes `reliefLocalLook`).
 */
export function sceneryReliefLookFromArgs(
  args: Partial<SceneryReliefLookArgs>,
  layers: ReliefLayer[],
): Pick<GeoReliefProps, 'color' | 'contours' | 'layerLooks'> {
  const a = { ...sceneryReliefLookArgs, ...args };
  const seabed =
    a.reliefSeabed === 'bathymetry' ? { ramp: 'bathymetry' } : a.reliefSeabed;
  const finest = layers[layers.length - 1];
  return {
    color:
      a.reliefColor === 'ramp'
        ? {
            ramp: a.reliefRamp,
            ...(a.reliefRampRange
              ? { min: a.reliefRampMin, max: a.reliefRampMax }
              : {}),
            reverse: a.reliefRampReverse,
            seabed,
          }
        : a.reliefLandColor,
    contours: a.reliefContours && {
      interval: a.reliefContourInterval,
      major: a.reliefContourMajor,
      thickness: a.reliefContourThickness,
      colorMode: CONTOUR_MODES[a.reliefContourMode],
      factor: a.reliefContourFactor,
      color: a.reliefContourColor,
      seabed: a.reliefContourSeabed,
      labels: a.reliefContourLabels && contourLabelsOf(a),
    },
    layerLooks:
      a.reliefLocalLook && finest
        ? {
            [finest.id]: {
              color: { ramp: 'rainbow', min: -130, max: -60, seabed: 'ramp' },
              contours: {
                interval: 5,
                major: 5,
                labels:
                  a.reliefContours &&
                  a.reliefContourLabels &&
                  contourLabelsOf(a),
              },
            },
          }
        : undefined,
  };
}

/**
 * The demo reliefs around the field, coarse to fine, for a relief drawn from tiles: later
 * ones win where they have data (see scripts/generate-relief.js).
 */
export const SCENERY_DEMO_RELIEF_LAYERS: ReliefLayer[] = [
  { id: 'etopo-2022-world' },
  { id: 'etopo-2022-nordic', feather: 20000 },
  { id: 'etopo-2022-15s-sw-norway', feather: 3000 },
  { id: 'emodnet-2020-sw-norway', feather: 1500 },
  { id: 'emodnet-2020-volve', feather: 500 },
];

// What each demo relief is, for the `reliefLayers` control.
const SCENERY_DEMO_RELIEF_LABELS: Record<string, string> = {
  'etopo-2022-world': 'ETOPO 2022, 10\u2032, the world',
  'etopo-2022-nordic': 'ETOPO 2022, 2\u2032, Norway to the British Isles',
  'etopo-2022-15s-sw-norway': 'ETOPO 2022, 15\u2033, Volve to the coast',
  'emodnet-2020-sw-norway': 'EMODnet, 1/8\u2032, Volve to the coast (sea only)',
  'emodnet-2020-volve': 'EMODnet, 1/16\u2032, around Volve (sea only)',
};

/**
 * The synthetic column's sea bed baked into a relief (`surfaceToRelief`): a coast and an
 * island over the field, made up, to see a local layer merge. ⚠️ Served only to a story
 * whose `parameters.store` holds it (`syntheticScenarios: [SYNTHETIC_SEABED_KEY]`).
 */
export const SCENERY_DEMO_BAKED_SEABED = bakedReliefId(SYNTHETIC_SEABED_ID);

/**
 * A store surface baked into a relief layer by the demo store, as a story's own finest
 * layer: a field's sea bed, say, so the relief over it is the field's own top.
 */
export const sceneryBakedReliefLayer = (
  surfaceId: string,
  feather = 500,
): ReliefLayer => ({ id: bakedReliefId(surfaceId), feather });

// The layers a `hide` control offers: the sky's own, by label, and a stage's.
const SCENERY_HIDE_LAYERS: Record<string, SceneryLayer> = {
  'sky background': 'background',
  'sky sky': 'sky',
  'sky clouds': 'clouds',
  'sky abyss': 'abyss',
  'sky sea': 'sea',
  'sky water': 'water',
  'sky surface': 'surface',
};
const STAGE_HIDE_LAYERS: SceneryStageLayer[] = ['surface', 'bed'];
// And the relief, a `GeoRelief`'s `visible`.
const RELIEF_HIDE_LAYER = 'relief';

/** A `hide` control for a sky story: layers of the sky, of its stage and the relief not to draw (see {@link sceneryHideFromArgs}). */
export const sceneryHideArgType = {
  control: { type: 'check' },
  options: [
    ...Object.keys(SCENERY_HIDE_LAYERS),
    ...STAGE_HIDE_LAYERS,
    RELIEF_HIDE_LAYER,
  ],
  description:
    'Layers not to draw. Only their visibility changes: nothing is rebuilt or baked again.',
  table: { category: 'Debug' },
} as const;

/**
 * The layers a `hide` control's `hide` names, as the `Scenery`'s and a `SceneryStage`'s debug
 * views take them, and whether the relief (a `GeoRelief`) is shown.
 */
export function sceneryHideFromArgs(hide: string[] = []) {
  return {
    sky: hide
      .filter(l => l in SCENERY_HIDE_LAYERS)
      .map(l => SCENERY_HIDE_LAYERS[l]),
    stage: STAGE_HIDE_LAYERS.filter(l => hide.includes(l)),
    relief: !hide.includes(RELIEF_HIDE_LAYER),
  };
}

/** A `SceneryStage`'s `outline` debug view as a control. */
export const sceneryOutlineArgType = {
  description:
    'The stage\u2019s `boundary` (grey) and its occupants\u2019 outlines at the sea\u2019s seabed (white) and at its surface (black), drawn over everything.',
  table: { category: 'Debug' },
} as const;

export const sceneryReliefArgs: SceneryReliefArgs = {
  ...sceneryReliefLookArgs,
  relief: false,
  reliefLayers: SCENERY_DEMO_RELIEF_LAYERS.map(layer => layer.id),
};

/** Controls for {@link SceneryReliefArgs}; with `shownIf`, the toggle shows only while that arg is on. */
export function sceneryReliefArgTypes(
  shownIf?: string,
): ArgTypes<SceneryReliefArgs> {
  return {
    relief: {
      ...toggle(
        SKY,
        'Land and seabed from the store, drawn from tiles over everything, the stage included: the demo reliefs ticked in `reliefLayers`, merged coarse to fine. Made on demand: `npm run generate-relief`.',
      ),
      ...(shownIf ? { if: { arg: shownIf } } : {}),
    },
    reliefLayers: {
      control: { type: 'check', labels: SCENERY_DEMO_RELIEF_LABELS },
      options: SCENERY_DEMO_RELIEF_LAYERS.map(layer => layer.id),
      description:
        'The demo reliefs merged, coarse to fine whatever the order ticked: a later one wins where it has data, faded in over 3, 1.5 and 0.5 km from where its data ends. A story may add layers of its own over them. Changing them builds every tile again.',
      table: { category: SKY },
      if: { arg: 'relief' },
    },
    ...sceneryReliefLookArgTypes('relief'),
  };
}

/**
 * Where a story's scene lies on the map when no `UtmArea` places it: at the sun's place
 * (see {@link SceneryArgs}), which Storybook leaves out of the args while the sun is set by hand.
 */
export const sceneryReliefFrame = (args: Partial<SceneryArgs>): GeoFrame =>
  geoFrameAt(
    args.sunLongitude ?? sceneryArgs.sunLongitude,
    args.sunLatitude ?? sceneryArgs.sunLatitude,
  );

/**
 * A `GeoRelief`'s props from {@link SceneryReliefArgs}: the demo reliefs ticked while `relief`
 * is on, then the story's own `local` layers, finest last; its progress reported to the
 * story's progress display. None without any layers.
 */
export const sceneryReliefFromArgs = (
  args: Partial<SceneryReliefArgs>,
  local: ReliefLayer[] = [],
): GeoReliefProps | undefined => {
  const ticked = args.reliefLayers ?? sceneryReliefArgs.reliefLayers;
  const layers = [
    ...(args.relief
      ? SCENERY_DEMO_RELIEF_LAYERS.filter(layer => ticked.includes(layer.id))
      : []),
    ...local,
  ];
  if (layers.length === 0) return undefined;
  return {
    layers,
    ...sceneryReliefLookFromArgs(args, layers),
    onProgress: reportReliefProgress,
  };
};

/** A story's inlet map (`Minimap`), off by default. */
export type SceneryMinimapArgs = {
  minimap: boolean;
};

export const sceneryMinimapArgs: SceneryMinimapArgs = {
  minimap: false,
};

export const sceneryMinimapArgTypes: ArgTypes<SceneryMinimapArgs> = {
  minimap: toggle(
    'Minimap',
    'An inlet map (`Minimap`) with its defaults and a camera marker, bottom right: the demo reliefs ticked in the relief\u2019s layers, whether the relief is drawn or not, in the story\u2019s map.',
  ),
};

/** The demo reliefs a story's minimap draws: those `ticked`, coarse to fine. All of them by default. */
export const sceneryMinimapLayers = (
  ticked: string[] = sceneryReliefArgs.reliefLayers,
): ReliefLayer[] =>
  SCENERY_DEMO_RELIEF_LAYERS.filter(layer => ticked.includes(layer.id));
