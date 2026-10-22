import type { ArgTypes, Decorator } from '@storybook/react-vite';
import { useArgs, useEffect } from 'storybook/preview-api';
import type { SkyProps } from '../../components/Sky/Sky';
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
import { solarPosition } from '../../sdk/utils/solar-position';
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
  /** TEMPORARY, to compare */
  cloudBandSink: boolean;
  // Sky
  drawSky: boolean;
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
  curvedHorizon: boolean;
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

// 10 September, 13:00 solar time over Volve: about the Sky's default sun (200°, 35°).
export const skyArgs: SkyArgs = {
  sunFromTime: false,
  sunAzimuth: skyDefaults.sun.azimuth,
  sunElevation: skyDefaults.sun.elevation,
  sunDate: '2024-09-10',
  sunHour: 13,
  sunLatitude: 58.44,
  sunLongitude: 1.89,
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
  cloudBandSink: skyDefaults.clouds.bandSink,
  drawSky: true,
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
  curvedHorizon: skyDefaults.curvedHorizon,
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
    bandSink: args.cloudBandSink,
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
    curvedHorizon: args.curvedHorizon,
    background: args.drawSky,
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
  cloudBandSink: {
    ...toggle(
      CLOUDS,
      'TEMPORARY, to compare: with the curved horizon, the band also sinks a little as the camera climbs, as on a flat sea.',
    ),
    if: { arg: 'clouds' },
  },
  drawSky: toggle(
    SKY,
    'Draw the sky and its stage behind the scene (`background`). Switched instantly, with nothing rebuilt or baked: off, the sky still lights the scene, by the subsurface.',
  ),
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
    'The sea\u2019s seabed, everywhere, an occupant\u2019s included. Off, the void lies below the water, and the cutaway cuts the water alone.',
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
    500,
    100000,
    500,
    SUBSURFACE,
    'Distance over which the void\u2019s lid recedes into its horizon colour, in metres.',
  ),
  abyssTransition: range(
    1,
    2000,
    1,
    SUBSURFACE,
    'Depth below the level over which the void fades in, in metres.',
  ),
  abyssDarkening: range(
    0,
    20000,
    100,
    SUBSURFACE,
    'Depth below the level over which the void dims toward black, in metres; 0 for none.',
  ),
  abyssDetail: range(
    0,
    1,
    0.01,
    SUBSURFACE,
    'Noise relief on the void\u2019s lid; 0 for none.',
  ),
  abyssDetailScale: range(
    50,
    10000,
    50,
    SUBSURFACE,
    'Size of that relief, in metres.',
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
  curvedHorizon: toggle(
    ENVIRONMENT,
    'The sea, the sky and the clouds follow the Earth\u2019s curve, so the horizon drops as the camera climbs: about 1\u00b0 at 1 km, 4\u00b0 at 15 km. The sea stays flat over the scene.',
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

/**
 * Controls for {@link SkyArgs}. The basic ones show; with `debug`, so do the advanced and
 * debug ones. With `shownIf`, each control shows only while that arg is on (unless it has a
 * condition of its own).
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
    } else if (shownIf && !argType.if) {
      argTypes[key as keyof SkyArgs] = { ...argType, if: { arg: shownIf } };
    }
  }
  return argTypes;
}
