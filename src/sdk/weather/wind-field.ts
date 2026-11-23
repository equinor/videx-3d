import type { Vec2 } from '../types/common';

/**
 * The gusts and slicks in a {@link WeatherWind}: the wind over the sea is not the same
 * everywhere. Gusts, from cat's paws of some tens of metres to gust fronts of kilometres, run
 * downwind with it; slicks, calm streaks along the wind where surface films damp the ripples,
 * drift slowly and lie mostly in light winds. What reads the local wind
 * (`weatherWindAt`, `weather-wind.glsl`) sees the same field: the sea roughens with it.
 *
 * @group Weather
 */
export type WeatherGusts = {
  /**
   * how strong: the local wind's spread about the mean, as a share of it (one standard
   * deviation). Default `gustStrengthFor` the wind: about 0.38 in light air, 0.24 in a gale
   */
  strength?: number;
  /** the largest gusts across, metres; cat's paws are a 25th of it. Default 3000 */
  scale?: number;
  /** how much of the slicks the wind allows (none above about 10 m/s) are drawn, 0 to 1. Default 1 */
  slicks?: number;
  /** the slicks' streaks across, metres (five times as long along the wind). Default 400 */
  slickScale?: number;
  /** another seed is other gusts and slicks. Default 0 */
  seed?: number;
};

/** A {@link WeatherGusts} with nothing left out, the slicks the wind allows included. */
export type WeatherGustField = Required<WeatherGusts>;

/**
 * The gusts' strength for a wind (m/s): the local wind's spread about the mean as a share of
 * it, larger in light, unsteady air.
 *
 * @group Weather
 */
export function gustStrengthFor(windSpeed: number): number {
  return Math.min(Math.max(0.38 - 0.0095 * Math.max(windSpeed, 0), 0.24), 0.38);
}

/**
 * The share of the slicks a wind (m/s) allows: all in light air, none from about 10 m/s, as
 * the films that make them break up.
 *
 * @group Weather
 */
export function slickShareFor(windSpeed: number): number {
  const t = Math.min(Math.max((windSpeed - 4) / 6, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The gust field for a wind (m/s) and its {@link WeatherGusts}, what they leave out by the
 * wind.
 *
 * @group Weather
 */
export function weatherGustsOf(
  windSpeed: number,
  gusts?: WeatherGusts | null,
): WeatherGustField {
  return {
    strength: gusts?.strength ?? gustStrengthFor(windSpeed),
    scale: gusts?.scale ?? 3000,
    slicks: (gusts?.slicks ?? 1) * slickShareFor(windSpeed),
    slickScale: gusts?.slickScale ?? 400,
    seed: gusts?.seed ?? 0,
  };
}

/**
 * The gusts' octaves: size (of the field's `scale`), stretch along the wind, speed (of the
 * wind's) and weight. Each runs at its own speed, so the field changes shape as it goes.
 */
export const WEATHER_GUST_OCTAVES = [
  { size: 1, stretch: 1.6, speed: 0.85, weight: 0.5 },
  { size: 1 / 5, stretch: 1.4, speed: 1, weight: 0.33 },
  { size: 1 / 25, stretch: 1.2, speed: 1.15, weight: 0.25 },
] as const;

// The slicks' run with the wind (a surface current), their stretch along it, and the value
// noise's level over which they lie; how much of the sea they cover, about, where all allowed.
const SLICK_SPEED = 0.03;
const SLICK_STRETCH = 5;
const SLICK_EDGE: Vec2 = [0.6, 0.75];
/** About the share of the sea slicks cover where the wind allows them all. */
export const WEATHER_SLICK_MEAN = 0.234;
// One standard deviation of the value noise (2v − 1, smoothstep-blended uniform lattice
// values: √(1/3)·∫(1 − s)² + s² per axis), to make the gusts' spread `strength`.
const NOISE_SPREAD = 0.4289;

const f = Math.fround;

// Hoskins' hash12, step by step in single precision, as the GPU has it (weather-wind.glsl).
function hash(x: number, y: number): number {
  const fract = (v: number) => f(v - Math.floor(v));
  let a = fract(f(x * f(0.1031)));
  let b = fract(f(y * f(0.1031)));
  let c = a;
  const d = f(
    f(a * f(b + f(33.33))) + f(f(b * f(c + f(33.33))) + f(c * f(a + f(33.33)))),
  );
  a = f(a + d);
  b = f(b + d);
  c = f(c + d);
  return fract(f(f(a + b) * c));
}

// Value noise in [0, 1], smoothed, on the integer lattice.
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The local wind at (x, z) of the plane (metres): `factor` on the mean wind, about 1 ±
 * `strength`, and `slick` (0 to 1) where a slick lies. `toward` is the way the wind blows
 * (unit), `travel` how far the mean wind has run (metres: speed × time), `gusts` the field
 * ({@link weatherGustsOf}). With `pixel` (metres) the features under about two of it give
 * way to their mean, as the GPU draws them. The twin of `weatherWindAt` in
 * `weather-wind.glsl`, to single precision.
 *
 * @group Weather
 */
export function weatherWindAt(
  x: number,
  z: number,
  toward: Vec2,
  travel: number,
  gusts: WeatherGustField,
  pixel = 0,
): { factor: number; slick: number } {
  const along = x * toward[0] + z * toward[1];
  const across = -x * toward[1] + z * toward[0];
  let n = 0;
  let norm = 0;
  WEATHER_GUST_OCTAVES.forEach((octave, i) => {
    const size = gusts.scale * octave.size;
    const fade = 1 - smoothstep(0.25, 0.5, pixel / size);
    norm += octave.weight * octave.weight;
    if (fade <= 0) return;
    const u = (along - octave.speed * travel) / (size * octave.stretch);
    const v = across / size;
    const value = noise(
      u + gusts.seed * 17.3 + i * 31.7,
      v + gusts.seed * 9.1 + i * 53.3,
    );
    n += octave.weight * fade * (2 * value - 1);
  });
  const spread = n / (NOISE_SPREAD * Math.sqrt(norm));
  const factor = Math.max(1 + gusts.strength * spread, 0.05);
  const slickFade = 1 - smoothstep(0.25, 0.5, pixel / gusts.slickScale);
  const value = noise(
    (along - SLICK_SPEED * travel) / (gusts.slickScale * SLICK_STRETCH) +
      gusts.seed * 5.7,
    across / gusts.slickScale + gusts.seed * 3.1,
  );
  const slick =
    gusts.slicks *
    (WEATHER_SLICK_MEAN +
      slickFade *
        (smoothstep(SLICK_EDGE[0], SLICK_EDGE[1], value) - WEATHER_SLICK_MEAN));
  return { factor, slick };
}
