/**
 * Where the weather systems lie over the Earth: the lows and the highs the 3D clouds' map of
 * the weather far off is drawn about (`SceneryClouds`, `documents/clouds.md`). Plain data,
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
 * their reaches, so they do not stack. As they are at time 0 ({@link weatherSystemCentresAt}).
 *
 * @group Weather
 */
export function createWeatherSystemCentres(
  seed = 0,
  count = WEATHER_SYSTEM_COUNT,
): WeatherSystemCentre[] {
  const next = random(seed + 1);
  const systems: WeatherSystemCentre[] = [];
  for (
    let attempt = 0;
    systems.length < count && attempt < count * 200;
    attempt++
  ) {
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

/**
 * How fast weather systems travel east (m/s, negative west) at `latitude` (degrees), carried by
 * the flow aloft that steers them: the trade winds' easterlies by the equator, the westerlies of
 * the storm tracks from some 35°, weaker toward the poles. What the clouds far off drift with
 * between two drawings of their map (`documents/clouds.md`, "Motion").
 *
 * @group Weather
 */
export function weatherSystemDrift(latitude: number): number {
  const a = Math.abs(latitude);
  return (
    WEATHER_SYSTEM_DRIFT.trades +
    (WEATHER_SYSTEM_DRIFT.westerlies - WEATHER_SYSTEM_DRIFT.trades) *
      smoothstep(18, 35, a) *
      (1 - 0.6 * smoothstep(60, 80, a))
  );
}

/**
 * The drift of {@link weatherSystemDrift}: east, m/s, in the trades and the westerlies; and how
 * fast lows head poleward (m/s).
 *
 * @group Weather
 */
const WEATHER_SYSTEM_DRIFT = {
  trades: -5,
  westerlies: 12,
  poleward: 2,
} as const;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// How long a system lives (seconds): lows 3–6 days, tropical ones 5–9, highs 5–10.
function lifetimeOf(system: WeatherSystemCentre, next: () => number) {
  const day = 86400;
  if (system.pressure > 0) return (5 + 5 * next()) * day;
  return (
    (Math.abs(system.latitude) < 30 ? 5 + 4 * next() : 3 + 3 * next()) * day
  );
}

// The share of a system's life over which it deepens, and over which it fills at the end.
const DEEPENING = 0.15;
const FILLING = 0.2;
// The step its track is followed in (seconds).
const TRACK_STEP = 3 * 3600;

// Where `system`, at its place, lies `seconds` on (back, when negative): carried east by the
// drift at its latitude, and a low heading poleward.
function travel(
  system: WeatherSystemCentre,
  seconds: number,
): WeatherSystemCentre {
  let latitude = system.latitude;
  let longitude = system.longitude;
  const north = latitude >= 0 ? 1 : -1;
  const poleward = system.pressure < 0 ? WEATHER_SYSTEM_DRIFT.poleward : 0;
  const sign = seconds < 0 ? -1 : 1;
  const span = Math.abs(seconds);
  const km = 1 / 1000;
  for (let t = 0; t < span; t += TRACK_STEP) {
    const dt = sign * Math.min(TRACK_STEP, span - t);
    const east = weatherSystemDrift(latitude) * dt * km;
    longitude +=
      east / (EARTH_KM * Math.max(Math.cos(latitude * DEG), 0.05)) / DEG;
    latitude = Math.min(
      Math.max(latitude + (north * poleward * dt * km) / EARTH_KM / DEG, -85),
      85,
    );
  }
  longitude = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return { ...system, latitude, longitude };
}

/**
 * The weather systems of `seed` at `time` (seconds from when they are as
 * {@link createWeatherSystemCentres} places them): each travels with the flow that steers it
 * ({@link weatherSystemDrift}; lows heading poleward), deepens and fills over its life (lows
 * 3–6 days, highs 5–10), and gives way to a new one somewhere else, so there are always as many.
 * The same for the same seed and time, whichever came before.
 *
 * @group Weather
 */
export function weatherSystemCentresAt(
  seed = 0,
  time = 0,
  count = WEATHER_SYSTEM_COUNT,
): WeatherSystemCentre[] {
  const first = createWeatherSystemCentres(seed, count);
  return first.map((born, i) => {
    const next = random(seed * 7919 + i * 104729 + 17);
    const lifetime = lifetimeOf(born, next);
    // Each is at full strength at time 0, somewhere in the middle of its life.
    const start = (DEEPENING + (1 - DEEPENING - FILLING) * next()) * lifetime;
    const lived = start + time;
    const generation = Math.floor(lived / lifetime);
    const age = lived - generation * lifetime;
    // Its first life passes where it lies at time 0; later (and earlier) ones begin anywhere the
    // climate has them.
    const system =
      generation === 0
        ? travel(born, -start)
        : createSystem(
            random(seed * 15485863 + i * 32452843 + generation * 49979687),
          );
    const strength =
      smoothstep(0, DEEPENING, age / lifetime) *
      (1 - smoothstep(1 - FILLING, 1, age / lifetime));
    const there = travel(system, age);
    there.pressure = system.pressure * strength;
    return there;
  });
}
