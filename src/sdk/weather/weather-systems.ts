/**
 * Where the weather systems lie over the Earth: the lows and the highs the 3D clouds' map of
 * the weather far off is drawn about (`SceneryCloudVolume`, `documents/clouds.md`). Plain data,
 * so it can be made up from a seed, as here, or come from an analysis's pressure centres.
 *
 * @module
 */

const DEG = Math.PI / 180;
const EARTH_KM = 6371;

/**
 * A weather system's centre: a low (a cyclone, cloudy) or a high (an anticyclone, clear).
 *
 * @group Weather
 */
export type WeatherSystemCentre = {
  /** degrees north */
  latitude: number;
  /** degrees east */
  longitude: number;
  /** its pressure about its centre, relative: negative a low, positive a high, about −1.4 to 1 */
  pressure: number;
  /** how far it reaches (km): its pressure falls to 1/e of the centre's there */
  radius: number;
};

/**
 * How many weather systems {@link createWeatherSystemCentres} places by default: some 2500 km
 * apart.
 *
 * @group Weather
 */
export const WEATHER_SYSTEM_COUNT = 64;

// A deterministic stream of numbers in [0, 1) (mulberry32).
function random(seed: number) {
  let state = (seed * 0x9e3779b9 + 0x6d2b79f5) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A normal deviate from two uniform ones (Box–Muller).
const normal = (next: () => number) =>
  Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());

// The angle between two places (radians).
function angleBetween(a: WeatherSystemCentre, b: WeatherSystemCentre) {
  const cos =
    Math.sin(a.latitude * DEG) * Math.sin(b.latitude * DEG) +
    Math.cos(a.latitude * DEG) *
      Math.cos(b.latitude * DEG) *
      Math.cos((a.longitude - b.longitude) * DEG);
  return Math.acos(Math.min(Math.max(cos, -1), 1));
}

// One system, as the climate makes them: lows mostly in the storm tracks (some 50° of
// latitude), a few tropical cyclones, small and deep; highs mostly over the subtropics (some
// 30°), broad, and over the poles.
function createSystem(next: () => number): WeatherSystemCentre {
  const north = next() < 0.5 ? 1 : -1;
  const longitude = next() * 360 - 180;
  const kind = next();
  let away: number;
  let pressure: number;
  let radius: number;
  if (kind < 0.42) {
    away = Math.min(Math.max(52 + 9 * normal(next), 33), 75);
    pressure = -(0.6 + 0.8 * next());
    radius = 650 + 550 * next();
  } else if (kind < 0.48) {
    away = 10 + 15 * next();
    pressure = -(1.0 + 0.4 * next());
    radius = 350 + 200 * next();
  } else if (kind < 0.9) {
    away = Math.min(Math.max(31 + 6 * normal(next), 18), 45);
    pressure = 0.5 + 0.5 * next();
    radius = 1100 + 800 * next();
  } else {
    away = 72 + 15 * next();
    pressure = 0.4 + 0.4 * next();
    radius = 900 + 600 * next();
  }
  return { latitude: north * away, longitude, pressure, radius };
}

/**
 * Weather systems over the whole Earth, the same for the same `seed`: `count` lows and highs
 * where the climate has them (see {@link WeatherSystemCentre}), apart by at least most of
 * their reaches, so they do not stack.
 *
 * @group Weather
 */
export function createWeatherSystemCentres(
  seed = 0,
  count = WEATHER_SYSTEM_COUNT,
): WeatherSystemCentre[] {
  const next = random(seed + 1);
  const systems: WeatherSystemCentre[] = [];
  for (let attempt = 0; systems.length < count && attempt < count * 200; attempt++) {
    const candidate = createSystem(next);
    // Closer than this lets one swallow the other; the more attempts fail, the closer they
    // may come, so the count is always reached.
    const slack = Math.max(1 - attempt / (count * 100), 0.3);
    const fits = systems.every(
      other =>
        angleBetween(candidate, other) * EARTH_KM >=
        0.85 * slack * (candidate.radius + other.radius),
    );
    if (fits) systems.push(candidate);
  }
  return systems;
}
