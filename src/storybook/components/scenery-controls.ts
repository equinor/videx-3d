import type { ArgTypes, Decorator } from '@storybook/react-vite';
import { useArgs, useEffect } from 'storybook/preview-api';
import { builtInColorRamps } from '../../common/color-ramps';
import { ContourColorMode } from '../../common/types';
import { DEFAULT_OCEAN_WATER_OPACITY } from '../../components/Ocean/ocean-material';
import { DEFAULT_OCEAN_BODY_FOG_DENSITY } from '../../components/Ocean/ocean-volume-material';
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
  type SceneryCloudLayers,
  type SceneryCloudsProps,
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
  // Clouds
  clouds: boolean;
  cloudLayers: SceneryCloudLayers;
  cloudCoverage: number;
  cloudAltitude: number;
  cloudScale: number;
  cloudThickness: number;
  cloudBandDistance: number;
  cloudSoftness: number;
  cloudOpacity: number;
  cloudSeed: number;
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
  drawSky: boolean;
  skyVoid: boolean;
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
  // Sea
  skyWater: boolean;
  skySeabed: boolean;
  waterOpacity: number;
  skySeabedOpacity: number;
  windSpeed: number;
  foamAmount: number;
  /** compass bearing the wind blows toward */
  windDirection: number;
  seaSteepness: number;
  seaDeepColor: string;
  seaShallowColor: string;
  skySeabedColor: string;
  seaFogDensity: number;
  seaDetailScale: number;
  seaDetailStrength: number;
  seaTonalVariation: number;
  seaTonalScale: number;
  seaFresnelPower: number;
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
  clouds: true,
  cloudLayers: sceneryDefaults.clouds.layers,
  cloudCoverage: sceneryDefaults.clouds.coverage,
  cloudAltitude: sceneryDefaults.clouds.altitude,
  cloudScale: sceneryDefaults.clouds.scale,
  cloudThickness: sceneryDefaults.clouds.thickness,
  cloudBandDistance: sceneryDefaults.clouds.bandDistance,
  cloudSoftness: sceneryDefaults.clouds.softness,
  cloudOpacity: sceneryDefaults.clouds.opacity,
  cloudSeed: sceneryDefaults.clouds.seed,
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
  drawSky: true,
  skyVoid: false,
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
  skyWater: true,
  skySeabed: true,
  waterOpacity: DEFAULT_OCEAN_WATER_OPACITY,
  skySeabedOpacity: sceneryDefaults.ocean.seabedOpacity,
  // As `OceanMaterial`'s own defaults.
  windSpeed: 10,
  foamAmount: 0.5,
  windDirection: 90,
  seaSteepness: 0.7,
  seaDeepColor: '#0a2540',
  seaShallowColor: '#1b6f8a',
  skySeabedColor: sceneryDefaults.ocean.seabed.color,
  seaFogDensity: DEFAULT_OCEAN_BODY_FOG_DENSITY,
  seaDetailScale: 0.05,
  seaDetailStrength: 0.2,
  seaTonalVariation: 0.4,
  seaTonalScale: 4,
  seaFresnelPower: 4,
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
  globe: sceneryDefaults.globe,
  environment: true,
  lightProbe: true,
  environmentIntensity: 1,
  environmentResolution: 128,
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

/** A `SceneryClouds`' props from {@link SceneryArgs}; `false` for none. */
export const sceneryCloudsFromArgs = (
  args: SceneryArgs,
): SceneryCloudsProps | false =>
  args.clouds && {
    layers: args.cloudLayers,
    coverage: args.cloudCoverage,
    altitude: args.cloudAltitude,
    scale: args.cloudScale,
    thickness: args.cloudThickness,
    bandDistance: args.cloudBandDistance,
    softness: args.cloudSoftness,
    opacity: args.cloudOpacity,
    seed: args.cloudSeed,
  };

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

/** A `SceneryOcean`'s props from {@link SceneryArgs}, but for its level and depth, which are the story's. */
export const sceneryOceanFromArgs = (args: SceneryArgs): SceneryOceanProps => ({
  water: args.skyWater,
  seabed: args.skySeabed && { color: args.skySeabedColor },
  seabedOpacity: args.skySeabedOpacity,
  waterOpacity: args.waterOpacity,
  windSpeed: args.windSpeed,
  // A compass bearing in the controls; the sea takes world X/Z.
  windDirection: [
    Math.sin((args.windDirection * Math.PI) / 180),
    -Math.cos((args.windDirection * Math.PI) / 180),
  ],
  steepness: args.seaSteepness,
  foamAmount: args.foamAmount,
  deepColor: args.seaDeepColor,
  shallowColor: args.seaShallowColor,
  bodyFogDensity: args.seaFogDensity,
  detailScale: args.seaDetailScale,
  detailStrength: args.seaDetailStrength,
  tonalVariation: args.seaTonalVariation,
  tonalScale: args.seaTonalScale,
  fresnelPower: args.seaFresnelPower,
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
});

/**
 * Every `<Scenery>` prop {@link SceneryArgs} set. Its features (clouds, sea, void, cutaway)
 * are components of their own under it: see `SceneryArgsFeatures`.
 */
export const sceneryPropsFromArgs = (args: SceneryArgs) =>
  ({
    sun: skySunFromArgs(args),
    observer: skyObserverFromArgs(args),
    moon: skyMoonFromArgs(args),
    stars: skyStarsFromArgs(args),
    air: args.air && { haze: args.airHaze, hazeHeight: args.airHazeHeight },
    colors: {
      zenith: args.skyZenith,
      horizon: args.skyHorizon,
      ground: args.skyGround,
      nadir: args.skyNadir,
    },
    intensity: args.skyIntensity,
    horizonBlend: args.skyHorizonBlend,
    globe: args.globe,
    background: args.drawSky && (args.skyVoid ? 'void' : true),
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
  'seaSteepness',
  'seaDeepColor',
  'seaShallowColor',
  'skySeabedColor',
  'seaFogDensity',
  'seaDetailScale',
  'seaDetailStrength',
  'seaTonalVariation',
  'seaTonalScale',
  'seaFresnelPower',
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
const CLOUDS = 'Clouds';
const GRATICULE = 'Graticule';
const SKY = 'Scenery';
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
    0.05,
    SUN,
    'Angular radius of the sun disc, in degrees.',
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
  clouds: toggle(
    CLOUDS,
    'Still clouds, lit by the sun, or the moon at night: a deck overhead and a band of distant ones along the horizon. The deck fades out close to the camera, so climbing to it clears it from overhead outward, and the water does not reflect them.',
  ),
  cloudLayers: {
    control: { type: 'inline-radio' },
    options: ['deck', 'band', 'both'],
    description:
      'The deck alone, out to the horizon; the band alone; or both, the deck meeting the band at its base.',
    if: { arg: 'clouds' },
    table: { category: CLOUDS },
  },
  cloudCoverage: {
    ...range(0, 1, 0.01, CLOUDS, 'How much of the sky they cover; 0 for none.'),
    if: { arg: 'clouds' },
  },
  cloudAltitude: {
    ...range(500, 30000, 100, CLOUDS, 'Height of their base, in metres.'),
    if: { arg: 'clouds' },
  },
  cloudScale: {
    ...range(200, 30000, 100, CLOUDS, 'Size of the clouds, in metres.'),
    if: { arg: 'clouds' },
  },
  cloudThickness: {
    ...range(
      0,
      5000,
      50,
      CLOUDS,
      'Depth of the clouds, in metres: how far the band\u2019s tops reach above their base, and how far the deck\u2019s thicker parts shift against their outlines as the view moves.',
    ),
    if: { arg: 'clouds' },
  },
  cloudBandDistance: {
    ...range(
      20000,
      200000,
      1000,
      CLOUDS,
      'How far off the band\u2019s clouds are, in metres: further, they sit lower, look smaller and are hazier.',
    ),
    if: { arg: 'clouds' },
  },
  cloudSoftness: {
    ...range(0, 1, 0.01, CLOUDS, 'Width of their edges.'),
    if: { arg: 'clouds' },
  },
  cloudOpacity: {
    ...range(
      0,
      1,
      0.01,
      CLOUDS,
      'How much they stand out from the sky behind them. The sun, moon and stars stay hidden behind them, from 0.5 down less so.',
    ),
    if: { arg: 'clouds' },
  },
  cloudSeed: {
    ...range(0, 100, 1, CLOUDS, 'Picks another pattern.'),
    if: { arg: 'clouds' },
  },
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
  drawSky: toggle(
    SKY,
    'Draw the sky and its stage behind the scene (`background`). Switched instantly, with nothing rebuilt or baked: off, the sky still lights the scene, by the subsurface.',
  ),
  skyVoid: {
    ...toggle(
      SKY,
      "The void\u2019s grey gradient in the sky\u2019s place (`background: 'void'`), as the stand-in draws it while the sky compiles: no air, sun, moon, stars or clouds, and the scene lit by the subsurface everywhere. The void and a sea are drawn as ever. Recompiles.",
    ),
    if: { arg: 'drawSky' },
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
  skyWater: toggle(
    SEA,
    'The sea\u2019s water, everywhere. Off, the seabed lies dry, and the cutaway cuts it.',
  ),
  skySeabed: toggle(
    SEA,
    'The sea\u2019s seabed, everywhere, an occupant\u2019s included. Off, the void lies below the water, its lid still a roof from below, and the cutaway cuts the water alone.',
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
  windDirection: range(
    0,
    360,
    1,
    SEA,
    'Compass bearing the wind blows toward.',
  ),
  seaSteepness: range(0, 2, 0.05, SEA, 'Choppiness of the waves.'),
  seaDeepColor: color(SEA, 'The water seen straight down.'),
  seaShallowColor: color(SEA, 'The water seen at grazing angles.'),
  skySeabedColor: color(SEA, 'The seabed\u2019s colour.'),
  seaFogDensity: range(
    0,
    0.05,
    0.0005,
    SEA,
    'How quickly the water tints what is seen through it, per metre.',
  ),
  seaDetailScale: range(0.005, 0.5, 0.005, SEA, 'Micro-ripple frequency.'),
  seaDetailStrength: range(0, 1, 0.01, SEA, 'Micro-ripple strength.'),
  seaTonalVariation: range(
    0,
    1,
    0.01,
    SEA,
    'Strength of the large patches of currents and slicks.',
  ),
  seaTonalScale: range(0.5, 20, 0.5, SEA, 'Size of those patches, in km.'),
  seaFresnelPower: range(
    1,
    8,
    0.1,
    SEA,
    'Higher keeps the reflections nearer the horizon.',
  ),
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
  abyssHorizon: color(
    SUBSURFACE,
    'Where the void\u2019s lid and depths meet, far away.',
  ),
  abyssDepth: color(SUBSURFACE, 'Straight down, deep in the void.'),
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
  abyssDepthDetail: range(
    0,
    0.5,
    0.01,
    SUBSURFACE,
    'Faint distant rock in the void\u2019s depths, wavy strata broken by crags; 0 for none.',
  ),
  abyssDepthDetailScale: range(
    0.25,
    4,
    0.05,
    SUBSURFACE,
    'Size of the rock\u2019s features.',
  ),
  abyssFalloff: range(
    0.1,
    3,
    0.05,
    SUBSURFACE,
    'How the void\u2019s depths darken below the horizon: the gradient\u2019s exponent. Smaller reaches the depth colour sooner.',
  ),
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
    description: 'Cube face size of the environment\u2019s bake.',
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
 * island over the field, made up, to see a local layer merge.
 */
export const SCENERY_DEMO_BAKED_SEABED = bakedReliefId('synthetic:cap-seabed');

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
