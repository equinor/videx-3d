import type { ArgTypes, Decorator } from '@storybook/react-vite';
import { useArgs, useEffect } from 'storybook/preview-api';
import type { SkyLayer, SkyProps } from '../../components/Sky/Sky';
import type {
  SkyBoxStageLayer,
  SkyBoxStageRelief,
} from '../../components/Sky/SkyBoxStage';
import {
  skyDefaults,
  type SkyAbyss,
  type SkyCloudLayers,
  type SkyClouds,
  type SkyMoon,
  type SkyObserver,
  type SkyOcean,
  type SkyStars,
  type SkySun,
} from '../../components/Sky/sky-model';
import { DEFAULT_OCEAN_WATER_OPACITY } from '../../components/Ocean/ocean-material';
import { DEFAULT_OCEAN_BODY_FOG_DENSITY } from '../../components/Ocean/ocean-volume-material';
import { ReliefFrame, reliefFrameAt } from '../../sdk/geometries/relief-grid';
import type { ReliefLayer } from '../../sdk/geometries/relief-tiles';
import { crsOriginLocation } from '../../sdk/projection/crs';
import { solarPosition } from '../../sdk/utils/solar-position';
import { bakedReliefId } from '../data/baked-reliefs';
import { demoCrs } from '../data/demo-crs';
import {
  skyCutawayArgs,
  SkyCutawayArgs,
  skyCutawayArgTypes,
  skyCutawayDecorator,
  skyCutawayFromArgs,
} from './sky-cutaway-controls';
import {
  toneMappingArgs,
  ToneMappingArgs,
  toneMappingArgTypes,
} from './tone-mapping-controls';

/**
 * A `<Sky>` as story args, shared by every story that draws one so the same control has
 * the same name everywhere. Basic controls show in every story; advanced and debug ones
 * only where `skyArgTypes({ debug: true })` asks for them, and keep their defaults
 * elsewhere.
 */
export type SkyArgs = {
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
  cloudLayers: SkyCloudLayers;
  cloudCoverage: number;
  cloudAltitude: number;
  cloudScale: number;
  cloudThickness: number;
  cloudBandDistance: number;
  cloudSoftness: number;
  cloudOpacity: number;
  cloudSeed: number;
  // Sky
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
  abyssWalls: boolean;
  abyssWallDistance: number;
  abyssWallColor: string;
  abyssWallCutColor: string;
  abyssWallLightStrength: number;
  abyssWallLightElevation: number;
  abyssWallLightDepth: number;
  abyssWallHazeDistance: number;
  abyssWallHazeDepth: number;
  abyssWallMist: number;
  abyssWallMistReach: number;
  abyssWallRockSize: number;
  abyssWallRelief: number;
  abyssWallFlare: number;
  abyssWallWander: number;
  abyssWallCutDistance: number;
  abyssWallSand: number;
  abyssWallSandColor: string;
  abyssWallGlow: number;
  abyssWallGlowColor: string;
  abyssWallRimFade: number;
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
} & SkyCutawayArgs &
  ToneMappingArgs;

// The demo field's place, from the CRS its `UtmArea` places it with.
const demoPlace = crsOriginLocation(demoCrs);

// 10 September, 13:00 solar time over Volve: about the Sky's default sun (200°, 35°).
export const skyArgs: SkyArgs = {
  sunFromTime: false,
  sunAzimuth: skyDefaults.sun.azimuth,
  sunElevation: skyDefaults.sun.elevation,
  sunDate: '2024-09-10',
  sunHour: 13,
  sunLatitude: Math.round(demoPlace.latitude * 100) / 100,
  sunLongitude: Math.round(demoPlace.longitude * 100) / 100,
  observerNow: false,
  sunIntensity: skyDefaults.sun.intensity,
  sunSize: skyDefaults.sun.size,
  sunGlow: skyDefaults.sun.glow,
  sunGlare: skyDefaults.sun.glare,
  sunRays: skyDefaults.sun.rays,
  sunShimmer: skyDefaults.sun.shimmer,
  sunTwilight: skyDefaults.sun.twilight,
  clouds: true,
  cloudLayers: skyDefaults.clouds.layers,
  cloudCoverage: skyDefaults.clouds.coverage,
  cloudAltitude: skyDefaults.clouds.altitude,
  cloudScale: skyDefaults.clouds.scale,
  cloudThickness: skyDefaults.clouds.thickness,
  cloudBandDistance: skyDefaults.clouds.bandDistance,
  cloudSoftness: skyDefaults.clouds.softness,
  cloudOpacity: skyDefaults.clouds.opacity,
  cloudSeed: skyDefaults.clouds.seed,
  drawSky: true,
  skyVoid: false,
  air: true,
  airHaze: skyDefaults.air.haze,
  airHazeHeight: skyDefaults.air.hazeHeight,
  skyZenith: skyDefaults.colors.zenith,
  skyHorizon: skyDefaults.colors.horizon,
  skyGround: skyDefaults.colors.ground,
  skyNadir: skyDefaults.colors.nadir,
  skyIntensity: skyDefaults.intensity,
  skyHorizonBlend: skyDefaults.horizonBlend,
  moon: true,
  moonIntensity: skyDefaults.moon.intensity,
  stars: true,
  starBrightness: skyDefaults.stars.brightness,
  skyWater: true,
  skySeabed: true,
  waterOpacity: DEFAULT_OCEAN_WATER_OPACITY,
  skySeabedOpacity: skyDefaults.ocean.seabedOpacity,
  // As `OceanMaterial`'s own defaults.
  windSpeed: 10,
  foamAmount: 0.5,
  windDirection: 90,
  seaSteepness: 0.7,
  seaDeepColor: '#0a2540',
  seaShallowColor: '#1b6f8a',
  skySeabedColor: skyDefaults.ocean.seabed.color,
  seaFogDensity: DEFAULT_OCEAN_BODY_FOG_DENSITY,
  seaDetailScale: 0.05,
  seaDetailStrength: 0.2,
  seaTonalVariation: 0.4,
  seaTonalScale: 4,
  seaFresnelPower: 4,
  seaDetailFadeStart: 15000,
  seaDetailFadeEnd: 60000,
  subsurfaceFollowSun: skyDefaults.subsurface.light.followSun,
  subsurfaceLightAzimuth: skyDefaults.subsurface.light.azimuth,
  subsurfaceLightElevation: skyDefaults.subsurface.light.elevation,
  subsurfaceLightLowest: skyDefaults.subsurface.light.elevationRange[0],
  subsurfaceLightHighest: skyDefaults.subsurface.light.elevationRange[1],
  subsurfaceLightColor: skyDefaults.subsurface.light.color,
  subsurfaceLightIntensity: skyDefaults.sun.intensity,
  subsurfaceLightTransition: skyDefaults.subsurface.light.transition,
  subsurfaceIntensity: skyDefaults.subsurface.intensity,
  subsurfacePanelColor: skyDefaults.subsurface.panels.color,
  subsurfacePanelIntensity: skyDefaults.subsurface.panels.intensity,
  subsurfaceBelow: false,
  subsurfaceBelowColor: '#9fb4d0',
  subsurfaceBelowIntensity: 1,
  abyssCeiling: skyDefaults.abyss.colors.ceiling,
  abyssHorizon: skyDefaults.abyss.colors.horizon,
  abyssDepth: skyDefaults.abyss.colors.depth,
  abyssFadeDistance: skyDefaults.abyss.fadeDistance,
  abyssTransition: skyDefaults.abyss.transition,
  abyssDarkening: skyDefaults.abyss.darkening,
  abyssDetail: skyDefaults.abyss.detail,
  abyssDetailScale: skyDefaults.abyss.detailScale,
  abyssDepthDetail: skyDefaults.abyss.depthDetail,
  abyssDepthDetailScale: skyDefaults.abyss.depthDetailScale,
  abyssFalloff: skyDefaults.abyss.falloff,
  // TODO: back to false once the walls are done.
  abyssWalls: true,
  abyssWallDistance: skyDefaults.abyss.walls.distance,
  abyssWallColor: skyDefaults.abyss.walls.color,
  abyssWallCutColor: skyDefaults.abyss.walls.cutColor,
  abyssWallLightStrength: skyDefaults.abyss.walls.lightStrength,
  abyssWallLightElevation: skyDefaults.abyss.walls.lightElevation,
  abyssWallLightDepth: skyDefaults.abyss.walls.lightDepth,
  abyssWallHazeDistance: skyDefaults.abyss.walls.hazeDistance,
  abyssWallHazeDepth: skyDefaults.abyss.walls.hazeDepth,
  abyssWallMist: skyDefaults.abyss.walls.mist,
  abyssWallMistReach: skyDefaults.abyss.walls.mistReach,
  abyssWallRockSize: skyDefaults.abyss.walls.rockSize,
  abyssWallRelief: skyDefaults.abyss.walls.relief,
  abyssWallFlare: skyDefaults.abyss.walls.flare,
  abyssWallWander: skyDefaults.abyss.walls.wander,
  abyssWallCutDistance: skyDefaults.abyss.walls.cutDistance,
  abyssWallSand: skyDefaults.abyss.walls.sand,
  abyssWallSandColor: skyDefaults.abyss.walls.sandColor,
  abyssWallGlow: skyDefaults.abyss.walls.glow,
  abyssWallGlowColor: skyDefaults.abyss.walls.glowColor,
  abyssWallRimFade: skyDefaults.abyss.walls.rimFade,
  globe: skyDefaults.globe,
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

/** The moment {@link SkyArgs} set, or null: local solar time is UTC shifted by the longitude, 15° an hour. */
function skySunDate(args: SkyArgs) {
  const [year, month, day] = args.sunDate.split('-').map(Number);
  const utc =
    Date.UTC(year, month - 1, day) +
    (args.sunHour - args.sunLongitude / 15) * 3600000;
  return Number.isFinite(utc) ? new Date(utc) : null;
}

/** The sun's azimuth and elevation from {@link SkyArgs}: as set, or from the time and place. */
export function skySunPosition(args: SkyArgs) {
  const manual = { azimuth: args.sunAzimuth, elevation: args.sunElevation };
  const date = args.sunFromTime ? skySunDate(args) : null;
  if (!date) return manual;
  return solarPosition(date, args.sunLatitude, args.sunLongitude);
}

/** A Sky's `observer` from {@link SkyArgs}: the time and place, when the sun is set from them. */
export function skyObserverFromArgs(args: SkyArgs): SkyObserver | null {
  const date = args.sunFromTime ? skySunDate(args) : null;
  return (
    date && {
      date,
      latitude: args.sunLatitude,
      longitude: args.sunLongitude,
    }
  );
}

/** {@link SkyArgs} for `date` at a place: its local solar date and hour. */
export function skySunArgsAt(
  date: Date,
  latitude: number,
  longitude: number,
): Partial<SkyArgs> {
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
  const [args, updateArgs] = useArgs<SkyArgs>();
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
 * The decorators the {@link SkyArgs} need: the cutaway's grip writing its offset back,
 * and `observerNow`. Add them last (outermost): `useArgs` is valid only in a decorator.
 */
export const skyDecorators: Decorator[] = [
  skyCutawayDecorator,
  skyObserverNowDecorator,
];

/** A Sky's `sun` from {@link SkyArgs}. */
export const skySunFromArgs = (args: SkyArgs): SkySun => ({
  ...skySunPosition(args),
  intensity: args.sunIntensity,
  size: args.sunSize,
  glow: args.sunGlow,
  glare: args.sunGlare,
  rays: args.sunRays,
  shimmer: args.sunShimmer,
  twilight: args.sunTwilight,
});

/** A Sky's `clouds` from {@link SkyArgs}. */
export const skyCloudsFromArgs = (args: SkyArgs): SkyClouds | false =>
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

/** A Sky's `moon` from {@link SkyArgs}. */
export const skyMoonFromArgs = (args: SkyArgs): SkyMoon | false =>
  args.moon && { intensity: args.moonIntensity };

/** A Sky's `stars` from {@link SkyArgs}. */
export const skyStarsFromArgs = (args: SkyArgs): SkyStars | false =>
  args.stars && { brightness: args.starBrightness, latitude: args.sunLatitude };

/** A Sky's `ocean` from {@link SkyArgs}, but for its level and depth, which are the story's. */
export const skyOceanFromArgs = (args: SkyArgs): SkyOcean => ({
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

/** A Sky's `abyss` from {@link SkyArgs}, but for its level, which is the story's. */
export const skyAbyssFromArgs = (args: SkyArgs): SkyAbyss => ({
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
  walls: args.abyssWalls && {
    distance: args.abyssWallDistance,
    color: args.abyssWallColor,
    cutColor: args.abyssWallCutColor,
    lightStrength: args.abyssWallLightStrength,
    lightElevation: args.abyssWallLightElevation,
    lightDepth: args.abyssWallLightDepth,
    hazeDistance: args.abyssWallHazeDistance,
    hazeDepth: args.abyssWallHazeDepth,
    mist: args.abyssWallMist,
    mistReach: args.abyssWallMistReach,
    rockSize: args.abyssWallRockSize,
    relief: args.abyssWallRelief,
    flare: args.abyssWallFlare,
    wander: args.abyssWallWander,
    cutDistance: args.abyssWallCutDistance,
    sand: args.abyssWallSand,
    sandColor: args.abyssWallSandColor,
    glow: args.abyssWallGlow,
    glowColor: args.abyssWallGlowColor,
    rimFade: args.abyssWallRimFade,
  },
});

/**
 * Every `<Sky>` prop {@link SkyArgs} set but `ocean` and `abyss` (see
 * {@link skyOceanFromArgs}, {@link skyAbyssFromArgs}), whose levels are the story's.
 */
export const skyPropsFromArgs = (args: SkyArgs) =>
  ({
    sun: skySunFromArgs(args),
    observer: skyObserverFromArgs(args),
    moon: skyMoonFromArgs(args),
    stars: skyStarsFromArgs(args),
    clouds: skyCloudsFromArgs(args),
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
    cutaway: skyCutawayFromArgs(args),
    debug: { tint: args.tint, environment: args.showEnvironment },
  }) satisfies Partial<SkyProps>;

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
const SKY = 'Sky';
const SEA = 'Sea';
const SUBSURFACE = 'Subsurface';
const ENVIRONMENT = 'Environment';
const DEBUG = 'Debug';

const allSkyArgTypes = (): ArgTypes<SkyArgs> => ({
  sunFromTime: toggle(
    SUN,
    'Set the sky from a date, an hour and a place (the Sky\u2019s `observer`): the real sun, moon and its phase, stars and planets. Off, the sun is set by hand, the moon is a full one opposite it and the stars are procedural.',
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
  drawSky: toggle(
    SKY,
    'Draw the sky and its stage behind the scene (`background`). Switched instantly, with nothing rebuilt or baked: off, the sky still lights the scene, by the subsurface.',
  ),
  skyVoid: {
    ...toggle(
      SKY,
      "The void\u2019s grey gradient in the sky\u2019s place (`background: 'void'`), as the stand-in draws it while the sky compiles: no air, sun, moon, stars or clouds, and the scene lit by the subsurface everywhere. The void, its walls and a sea are drawn as ever. Recompiles.",
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
  abyssCeiling: color(
    SUBSURFACE,
    'The void\u2019s lid overhead. With walls, only while they have no sand.',
  ),
  abyssHorizon: color(
    SUBSURFACE,
    'Where the void\u2019s lid and depths meet, far away. With walls, the colour of their haze and mist.',
  ),
  abyssDepth: color(
    SUBSURFACE,
    'Straight down, deep in the void. With walls, only in the void background (`skyVoid`) and while the sky compiles: their haze fills the depths.',
  ),
  abyssFadeDistance: {
    ...range(
      0,
      100000,
      500,
      SUBSURFACE,
      'Distance over which the void\u2019s lid recedes into its horizon colour, in metres; 0 for never. Without walls only: with them the lid is in their haze (`abyssWallHazeDistance`).',
    ),
    if: { arg: 'abyssWalls', truthy: false },
  },
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
    'Noise ripples on the void\u2019s lid, the sand\u2019s underside with walls; 0 for none.',
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
      'Faint distant rock in the void\u2019s depths, wavy strata broken by crags; 0 for none. Without walls only.',
    ),
    if: { arg: 'abyssWalls', truthy: false },
  },
  abyssDepthDetailScale: {
    ...range(0.25, 4, 0.05, SUBSURFACE, 'Size of the rock\u2019s features.'),
    if: { arg: 'abyssWalls', truthy: false },
  },
  abyssFalloff: range(
    0.1,
    3,
    0.05,
    SUBSURFACE,
    'How the void\u2019s depths darken below the horizon: the gradient\u2019s exponent. Smaller reaches the depth colour sooner. With walls, only in the void background (`skyVoid`) and while the sky compiles.',
  ),
  abyssWalls: toggle(
    SUBSURFACE,
    'Prototype: cliffs about the stage in the void, so moving in it shows its scale.',
  ),
  abyssWallDistance: {
    ...range(
      1000,
      50000,
      500,
      SUBSURFACE,
      'How far out from the stage\u2019s edge the walls stand at the lid, in metres. Also how far the glow reaches beyond the stage, and what caps `abyssWallRelief` and `abyssWallWander`.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallColor: {
    ...color(SUBSURFACE, 'The walls\u2019 rock.'),
    if: { arg: 'abyssWalls' },
  },
  abyssWallCutColor: {
    ...color(SUBSURFACE, 'The rock\u2019s inside, where the walls are cut.'),
    if: { arg: 'abyssWalls' },
  },
  abyssWallLightStrength: {
    ...range(
      0,
      1,
      0.01,
      SUBSURFACE,
      'How strongly the walls\u2019 own light rakes them, bringing out the cliffs; 0 for none, the subsurface\u2019s light map alone.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallLightElevation: {
    ...range(
      -90,
      90,
      1,
      SUBSURFACE,
      'Elevation of that raking light, in degrees, at the subsurface light\u2019s bearing; below 0 from below.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallLightDepth: {
    ...range(
      1000,
      50000,
      500,
      SUBSURFACE,
      'Depth below the lid over which the light on the walls, the sand and the glow fades to nearly black, in metres: larger lights them deeper. The walls\u2019 mesh reaches 2.5 times as deep. The haze darkens by its own (`abyssWallHazeDepth`).',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallHazeDistance: {
    ...range(
      0,
      200000,
      1000,
      SUBSURFACE,
      'Distance over which the walls, the lid and the depths fade into the haze in the hollow, in metres: smaller is thicker; 0 for none. Its colour is `abyssHorizon`.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallHazeDepth: {
    ...range(
      0,
      50000,
      500,
      SUBSURFACE,
      'Depth below the lid over which that haze, and the mist, darken to nearly black, in metres: larger keeps the haze lit deeper, so more of it shows; 0 for never.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallMist: {
    ...range(
      0,
      1,
      0.01,
      SUBSURFACE,
      'How dense the mist clinging to the walls is, in patches; 0 for none. The open gap stays clear.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallMistReach: {
    ...range(
      100,
      10000,
      100,
      SUBSURFACE,
      'How far the mist hangs off the rock, in metres.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallRockSize: {
    ...range(
      200,
      20000,
      100,
      SUBSURFACE,
      'Size of the walls\u2019 rock features, in metres: the cliffs, the beds and joints where they are cut, the sand\u2019s mottle. Smaller is finer, and needs more of the mesh\u2019s columns (at most 1024 round).',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallRelief: {
    ...range(
      0,
      10000,
      100,
      SUBSURFACE,
      'How far the walls\u2019 rock stands in and out, in metres; at most 0.9 of `abyssWallDistance`.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallFlare: {
    ...range(
      0,
      2,
      0.05,
      SUBSURFACE,
      'How far the walls lean out per metre of depth, so the hollow widens; 0 for straight down.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallWander: {
    ...range(
      0,
      20000,
      100,
      SUBSURFACE,
      'How far the walls\u2019 outline wanders in and out in long bays and headlands, in metres; 0 for none; at most `abyssWallDistance` less `abyssWallRelief`.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallCutDistance: {
    ...range(
      0,
      20000,
      100,
      SUBSURFACE,
      'How far in front of the camera, at least, a vertical plane cuts the walls away, in metres; it cuts through the stage\u2019s centre while that is further, and below the lid past the stage, so no cut face stands behind it (easing in over this distance down from the lid). Once the whole stage is in view through the hollow, nothing is cut.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallSand: {
    ...range(
      0,
      5000,
      100,
      SUBSURFACE,
      'How thick the soft sand over the walls\u2019 rock is, below the lid, in metres: the hollow\u2019s top in it is smooth, draped over the rock\u2019s large shape, and the lid seen from below is that sand. 0 for none: all rock, and the void\u2019s own lid.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallSandColor: {
    ...color(
      SUBSURFACE,
      'The sand over the walls\u2019 rock, and the lid from below.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallGlow: {
    ...range(
      0,
      1,
      0.01,
      SUBSURFACE,
      'A dim light at the top of the stage: on the lid and the sand over it, fading out beyond it over about `abyssWallDistance`; 0 for none. Needs sand.',
    ),
    if: { arg: 'abyssWalls' },
  },
  abyssWallGlowColor: {
    ...color(SUBSURFACE, 'That light\u2019s colour.'),
    if: { arg: 'abyssWalls' },
  },
  abyssWallRimFade: {
    ...range(
      0,
      200000,
      1000,
      SUBSURFACE,
      'The distance beyond the walls\u2019 rim over which the hollow\u2019s light fades to a fifth, and the rest to black over twice that again, and their haze thins to none, in metres: far from the hollow the lid, the sand and the cut darken to black, seen through clear air, instead of fading into the haze\u2019s grey. 0 for none.',
    ),
    if: { arg: 'abyssWalls' },
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
  ...skyCutawayArgTypes(),
  ...toneMappingArgTypes(),
});

// The renderer's tone mapping, applied with a sky or without: never behind `shownIf`.
const UNGATED = new Set(Object.keys(toneMappingArgs));

/**
 * Controls for {@link SkyArgs}. The basic ones show; with `debug`, so do the advanced and
 * debug ones. With `shownIf`, each control shows only while that arg is on (unless it has a
 * condition of its own, or is the renderer's tone mapping). ⚠️ Storybook also leaves such an
 * arg out of the story's args while it is hidden.
 */
export function skyArgTypes({
  debug = false,
  shownIf,
}: { debug?: boolean; shownIf?: string } = {}): ArgTypes<SkyArgs> {
  const argTypes = allSkyArgTypes();
  for (const [key, argType] of Object.entries(argTypes)) {
    if (!argType) continue;
    if (!debug && ADVANCED.has(key)) {
      argTypes[key as keyof SkyArgs] = { ...argType, table: { disable: true } };
    } else if (shownIf && !argType.if && !UNGATED.has(key)) {
      argTypes[key as keyof SkyArgs] = { ...argType, if: { arg: shownIf } };
    }
  }
  return argTypes;
}

/** Story args for a `SkyBoxStage`'s relief (see {@link skyReliefFromArgs}). */
export type SkyReliefArgs = {
  relief: boolean;
  /** the demo reliefs merged, by id (see {@link SKY_DEMO_RELIEF_LAYERS}) */
  reliefLayers: string[];
  reliefColor: 'flat' | 'ramp';
  reliefLandColor: string;
};

/**
 * The demo reliefs around the field, coarse to fine, for a relief drawn from tiles: later
 * ones win where they have data (see scripts/generate-relief.js).
 */
export const SKY_DEMO_RELIEF_LAYERS: ReliefLayer[] = [
  { id: 'etopo-2022-nordic' },
  { id: 'etopo-2022-15s-sw-norway', feather: 3000 },
  { id: 'emodnet-2020-sw-norway', feather: 1500 },
  { id: 'emodnet-2020-volve', feather: 500 },
];

// What each demo relief is, for the `reliefLayers` control.
const SKY_DEMO_RELIEF_LABELS: Record<string, string> = {
  'etopo-2022-nordic': 'ETOPO 2022, 2\u2032, Norway to the British Isles',
  'etopo-2022-15s-sw-norway': 'ETOPO 2022, 15\u2033, Volve to the coast',
  'emodnet-2020-sw-norway': 'EMODnet, 1/8\u2032, Volve to the coast (sea only)',
  'emodnet-2020-volve': 'EMODnet, 1/16\u2032, around Volve (sea only)',
};

/**
 * The synthetic column's sea bed baked into a relief (`surfaceToRelief`): a coast and an
 * island over the field, made up, to see a local layer merge.
 */
export const SKY_DEMO_BAKED_SEABED = bakedReliefId('synthetic:cap-seabed');

/**
 * A store surface baked into a relief layer by the demo store, as a story's own finest
 * layer: a field's sea bed, say, so the relief over it is the field's own top.
 */
export const skyBakedReliefLayer = (
  surfaceId: string,
  feather = 500,
): ReliefLayer => ({ id: bakedReliefId(surfaceId), feather });

// The layers a `hide` control offers: the sky's own, by label, and a stage's.
const SKY_HIDE_LAYERS: Record<string, SkyLayer> = {
  'sky background': 'background',
  'sky surface': 'surface',
  'sky walls': 'walls',
};
const STAGE_HIDE_LAYERS: SkyBoxStageLayer[] = ['surface', 'bed', 'relief'];

/** A `hide` control for a sky story: layers of the sky and of its stage not to draw (see {@link skyHideFromArgs}). */
export const skyHideArgType = {
  control: { type: 'check' },
  options: [...Object.keys(SKY_HIDE_LAYERS), ...STAGE_HIDE_LAYERS],
  description:
    'Layers not to draw. Only their visibility changes: nothing is rebuilt or baked again.',
  table: { category: 'Debug' },
} as const;

/** The layers a `hide` control's `hide` names, as the `Sky`'s and a `SkyBoxStage`'s debug views take them. */
export function skyHideFromArgs(hide: string[] = []) {
  return {
    sky: hide.filter(l => l in SKY_HIDE_LAYERS).map(l => SKY_HIDE_LAYERS[l]),
    stage: STAGE_HIDE_LAYERS.filter(l => hide.includes(l)),
  };
}

/** A `SkyBoxStage`'s `outline` debug view as a control. */
export const skyOutlineArgType = {
  description:
    'The stage\u2019s `bounds` (grey) and its occupants\u2019 outlines at the sea\u2019s seabed (white) and at its surface (black), drawn over everything.',
  table: { category: 'Debug' },
} as const;

/** Story args for the void walls' debug views (see {@link skyWallDebugFromArgs}). */
export type SkyWallDebugArgs = {
  wallWireframe: boolean;
  wallFlat: boolean;
  wallCut: boolean;
};

export const skyWallDebugArgs: SkyWallDebugArgs = {
  wallWireframe: false,
  wallFlat: false,
  wallCut: false,
};

export const skyWallDebugArgTypes: ArgTypes<SkyWallDebugArgs> = {
  wallWireframe: {
    description:
      'The void walls\u2019 mesh drawn as its triangles\u2019 edges, in one colour.',
    table: { category: 'Debug' },
  },
  wallFlat: {
    description:
      'The void walls shaded as their mesh\u2019s triangles face, without the rock\u2019s finer relief from the cliffs\u2019 normal map; and the faces of their cut (on the cut plane, and on the lid from above) drawn as geometry, so they hide the data behind the rock.',
    table: { category: 'Debug' },
  },
  wallCut: {
    description:
      'The vertical plane the void walls are cut along, as a grid over everything: it faces the camera\u2019s heading, through the stage\u2019s centre or `abyssWallCutDistance` in front of the camera, and below the lid past the stage, from the lid down to the walls\u2019 foot; gone once the whole stage is in view through the hollow and nothing is cut.',
    table: { category: 'Debug' },
  },
};

/** The void walls' debug views (`SkyDebug.walls`) from {@link SkyWallDebugArgs}. */
export function skyWallDebugFromArgs(args: SkyWallDebugArgs) {
  return {
    wireframe: args.wallWireframe,
    flat: args.wallFlat,
    cut: args.wallCut,
  };
}

export const skyReliefArgs: SkyReliefArgs = {
  relief: false,
  reliefLayers: SKY_DEMO_RELIEF_LAYERS.map(layer => layer.id),
  reliefColor: 'flat',
  reliefLandColor: '#34433b',
};

/** Controls for {@link SkyReliefArgs}; with `shownIf`, the toggle shows only while that arg is on. */
export function skyReliefArgTypes(shownIf?: string): ArgTypes<SkyReliefArgs> {
  return {
    relief: {
      ...toggle(
        SEA,
        'Land and seabed from the store, drawn from tiles over everything, the stage included: the demo reliefs ticked in `reliefLayers`, merged coarse to fine. Made on demand: `npm run generate-relief`.',
      ),
      ...(shownIf ? { if: { arg: shownIf } } : {}),
    },
    reliefLayers: {
      control: { type: 'check', labels: SKY_DEMO_RELIEF_LABELS },
      options: SKY_DEMO_RELIEF_LAYERS.map(layer => layer.id),
      description:
        'The demo reliefs merged, coarse to fine whatever the order ticked: a later one wins where it has data, faded in over 3, 1.5 and 0.5 km from where its data ends. A story may add layers of its own over them. Changing them builds every tile again.',
      table: { category: SEA },
      if: { arg: 'relief' },
    },
    reliefColor: {
      control: { type: 'inline-radio' },
      options: ['flat', 'ramp'],
      description:
        'The land flat, the seabed as the sea\u2019s; or the land by height, the sea\u2019s seabed darkening with depth.',
      table: { category: SEA },
      if: { arg: 'relief' },
    },
    reliefLandColor: {
      ...color(SEA, 'The land\u2019s colour.'),
      if: { arg: 'reliefColor', eq: 'flat' },
    },
  };
}

/**
 * Where a story's scene lies on the map when no `UtmArea` places it: at the sun's place
 * (see {@link SkyArgs}), which Storybook leaves out of the args while the sun is set by hand.
 */
export const skyReliefFrame = (args: Partial<SkyArgs>): ReliefFrame =>
  reliefFrameAt(
    args.sunLongitude ?? skyArgs.sunLongitude,
    args.sunLatitude ?? skyArgs.sunLatitude,
  );

/**
 * A `SkyBoxStage`'s `relief` from {@link SkyReliefArgs}, the scene placed by `frame`: the
 * demo reliefs ticked while `relief` is on, then the story's own `local` layers, finest
 * last. None without any.
 */
export const skyReliefFromArgs = (
  args: Partial<SkyReliefArgs>,
  frame: ReliefFrame,
  local: ReliefLayer[] = [],
): SkyBoxStageRelief | undefined => {
  const ticked = args.reliefLayers ?? skyReliefArgs.reliefLayers;
  const layers = [
    ...(args.relief
      ? SKY_DEMO_RELIEF_LAYERS.filter(layer => ticked.includes(layer.id))
      : []),
    ...local,
  ];
  if (layers.length === 0) return undefined;
  return {
    frame,
    layers,
    color:
      args.reliefColor === 'ramp'
        ? 'ramp'
        : (args.reliefLandColor ?? skyReliefArgs.reliefLandColor),
  };
};
