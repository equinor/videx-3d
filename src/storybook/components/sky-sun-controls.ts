import type { ArgTypes, Decorator } from '@storybook/react-vite';
import { useArgs, useEffect } from 'storybook/preview-api';
import type {
  SkyClouds,
  SkyMoon,
  SkyObserver,
  SkyStars,
  SkySun,
} from '../../components/Sky/sky-model';
import { solarPosition } from '../../sdk/utils/solar-position';

/** A Sky's sun, moon, stars and clouds as story args: the sun set by hand, or from a time and place. */
export type SkySunArgs = {
  sunAzimuth: number;
  sunElevation: number;
  sunFromTime: boolean;
  /** `YYYY-MM-DD` */
  sunDate: string;
  /** local solar time, 0 to 24 */
  sunHour: number;
  sunLatitude: number;
  sunLongitude: number;
  sunGlare: number;
  sunRays: number;
  sunShimmer: boolean;
  sunTwilight: number;
  moon: boolean;
  moonIntensity: number;
  stars: boolean;
  starBrightness: number;
  clouds: boolean;
  cloudCoverage: number;
  cloudAltitude: number;
  cloudScale: number;
  cloudSoftness: number;
  cloudOpacity: number;
  cloudSeed: number;
};

// 10 September, 13:00 solar time over Volve: about the Sky's default sun (200°, 35°).
export const skySunArgs: SkySunArgs = {
  sunAzimuth: 200,
  sunElevation: 35,
  sunFromTime: false,
  sunDate: '2024-09-10',
  sunHour: 13,
  sunLatitude: 58.44,
  sunLongitude: 1.89,
  sunGlare: 0.5,
  sunRays: 0,
  sunShimmer: false,
  sunTwilight: 1,
  moon: true,
  moonIntensity: 0.3,
  stars: true,
  starBrightness: 1,
  clouds: false,
  cloudCoverage: 0.4,
  cloudAltitude: 6000,
  cloudScale: 4000,
  cloudSoftness: 0.25,
  cloudOpacity: 0.9,
  cloudSeed: 0,
};

/** The moment {@link SkySunArgs} set, or null: local solar time is UTC shifted by the longitude, 15° an hour. */
function skySunDate(args: SkySunArgs) {
  const [year, month, day] = args.sunDate.split('-').map(Number);
  const utc =
    Date.UTC(year, month - 1, day) +
    (args.sunHour - args.sunLongitude / 15) * 3600000;
  return Number.isFinite(utc) ? new Date(utc) : null;
}

/** The sun's azimuth and elevation from {@link SkySunArgs}: as set, or from the time and place. */
export function skySunPosition(args: SkySunArgs) {
  const manual = { azimuth: args.sunAzimuth, elevation: args.sunElevation };
  const date = args.sunFromTime ? skySunDate(args) : null;
  if (!date) return manual;
  return solarPosition(date, args.sunLatitude, args.sunLongitude);
}

/** A Sky's `observer` from {@link SkySunArgs}: the time and place, when the sun is set from them. */
export function skyObserverFromArgs(args: SkySunArgs): SkyObserver | null {
  const date = args.sunFromTime ? skySunDate(args) : null;
  return (
    date && {
      date,
      latitude: args.sunLatitude,
      longitude: args.sunLongitude,
    }
  );
}

/** {@link SkySunArgs} for `date` at a place: its local solar date and hour. */
export function skySunArgsAt(
  date: Date,
  latitude: number,
  longitude: number,
): Partial<SkySunArgs> {
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

/**
 * Ticking `observerNow` sets the sun's time to now and its place to the browser's (if it
 * may tell; else the place stays), then clears it. Add it outermost: `useArgs` is a
 * preview hook, valid only in a decorator.
 */
export const skyObserverNowDecorator: Decorator = Story => {
  const [args, updateArgs] = useArgs<SkySunArgs & { observerNow?: boolean }>();
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

/** The control for {@link skyObserverNowDecorator}, under `category`. */
export const skyObserverNowArgType = (category = 'Sun') => ({
  observerNow: {
    control: { type: 'boolean' as const },
    description:
      'Set the time to now and the place to yours, if the browser may tell; then it clears itself.',
    table: { category },
  },
});

/** A Sky's `sun` from {@link SkySunArgs}: where it is, its glare and its rays. */
export const skySunFromArgs = (args: SkySunArgs): SkySun => ({
  ...skySunPosition(args),
  glare: args.sunGlare,
  rays: args.sunRays,
  shimmer: args.sunShimmer,
  twilight: args.sunTwilight,
});

/** A Sky's `clouds` from {@link SkySunArgs}. */
export const skyCloudsFromArgs = (args: SkySunArgs): SkyClouds | false =>
  args.clouds && {
    coverage: args.cloudCoverage,
    altitude: args.cloudAltitude,
    scale: args.cloudScale,
    softness: args.cloudSoftness,
    opacity: args.cloudOpacity,
    seed: args.cloudSeed,
  };

/** A Sky's `moon` from {@link SkySunArgs}. */
export const skyMoonFromArgs = (args: SkySunArgs): SkyMoon | false =>
  args.moon && { intensity: args.moonIntensity };

/** A Sky's `stars` from {@link SkySunArgs}. */
export const skyStarsFromArgs = (args: SkySunArgs): SkyStars | false =>
  args.stars && { brightness: args.starBrightness, latitude: args.sunLatitude };

const range = (
  min: number,
  max: number,
  step: number,
  category: string,
  description: string,
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  table: { category },
});

/** Controls for {@link SkySunArgs}, under `category`. */
export const skySunArgTypes = (category = 'Sun'): ArgTypes<SkySunArgs> => ({
  sunFromTime: {
    control: { type: 'boolean' },
    description:
      'Set the sky from a date, an hour and a place (the Sky\u2019s `observer`): the real sun, moon and its phase, stars and planets. Off, the sun is set by hand, the moon is a full one opposite it and the stars are procedural.',
    table: { category },
  },
  sunAzimuth: {
    ...range(0, 360, 1, category, 'Compass bearing of the sun, in degrees.'),
    if: { arg: 'sunFromTime', truthy: false },
  },
  sunElevation: {
    ...range(-30, 90, 0.5, category, 'Degrees above the horizon.'),
    if: { arg: 'sunFromTime', truthy: false },
  },
  sunDate: {
    control: { type: 'text' },
    description: 'The date, as `YYYY-MM-DD`.',
    if: { arg: 'sunFromTime' },
    table: { category },
  },
  sunHour: {
    ...range(
      0,
      24,
      0.05,
      category,
      'Local solar time at the place: 12 is noon, when the sun is due south (north in the southern hemisphere).',
    ),
    if: { arg: 'sunFromTime' },
  },
  sunLatitude: {
    ...range(-90, 90, 0.1, category, 'Degrees north.'),
    if: { arg: 'sunFromTime' },
  },
  sunLongitude: {
    ...range(-180, 180, 0.1, category, 'Degrees east.'),
    if: { arg: 'sunFromTime' },
  },
  sunGlare: range(
    0,
    2,
    0.05,
    category,
    'Strength of the bright glare hugging the sun disc.',
  ),
  sunRays: range(
    0,
    2,
    0.05,
    category,
    'Strength of the rays around the sun disc; 0 for none.',
  ),
  sunShimmer: {
    control: { type: 'boolean' },
    description: 'The rays shimmer slowly.',
    if: { arg: 'sunRays', truthy: true },
    table: { category },
  },
  sunTwilight: range(
    0,
    2,
    0.05,
    category,
    'Strength of the warm glow along the horizon at sunrise and sunset, and the pink belt opposite it; 0 for none.',
  ),
  moon: {
    control: { type: 'boolean' },
    description:
      'The moon: its disc and glow, and the sky\u2019s light once the sun is well down. From a time and place it is the real one, with its phase, up by day too; else a full moon opposite the sun.',
    table: { category },
  },
  moonIntensity: {
    ...range(
      0,
      1,
      0.01,
      category,
      'Intensity of the moonlight, at full night.',
    ),
    if: { arg: 'moon' },
  },
  stars: {
    control: { type: 'boolean' },
    description:
      'Stars, out once it is dark. From a time and place, the real ones to magnitude 5 and the planets, each out as the sky darkens enough for it, over faint procedural ones; else procedural.',
    table: { category },
  },
  starBrightness: {
    ...range(0, 2, 0.05, category, 'Brightness of the stars.'),
    if: { arg: 'stars' },
  },
  clouds: {
    control: { type: 'boolean' },
    description:
      'A deck of still clouds, seen from below and lit by the sun, or the moon at night. They fade out as the camera climbs to the deck, and the water does not reflect them.',
    table: { category: 'Clouds' },
  },
  cloudCoverage: {
    ...range(0, 1, 0.01, 'Clouds', 'How much of the sky they cover.'),
    if: { arg: 'clouds' },
  },
  cloudAltitude: {
    ...range(500, 30000, 100, 'Clouds', 'Height of the deck, in metres.'),
    if: { arg: 'clouds' },
  },
  cloudScale: {
    ...range(200, 30000, 100, 'Clouds', 'Size of the clouds, in metres.'),
    if: { arg: 'clouds' },
  },
  cloudSoftness: {
    ...range(0, 1, 0.01, 'Clouds', 'Width of their edges.'),
    if: { arg: 'clouds' },
  },
  cloudOpacity: {
    ...range(0, 1, 0.01, 'Clouds', 'Their opacity.'),
    if: { arg: 'clouds' },
  },
  cloudSeed: {
    ...range(0, 100, 1, 'Clouds', 'Picks another pattern.'),
    if: { arg: 'clouds' },
  },
});
