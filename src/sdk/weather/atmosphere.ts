// The atmosphere the 3D clouds come out of (SceneryCloudVolume `atmosphere`, documents/clouds.md):
// a simplified sounding — the air's temperature and moisture with height, an inversion capping
// the mixed layer — and how strongly the surface heats the air. A diagnostic parcel model: no
// fluid is simulated. The air's own condensate where it is saturated (sheets: stratus, fog, the
// deck under an inversion), and thermals of every strength lifted through it, rising dry to where
// they condense, moist above, mixing in the air about them the faster the smaller they are,
// until their buoyancy and momentum are spent: their condensate and updraft with height. What
// kinds of cloud there are follows from the conditions, not from a shape per kind.
//
// A thermal lives: its source releases a train of bubbles, each rising as the parcel does and
// widening as it mixes in air. One that stops flattens and spreads, and, no longer fed, mixes
// into the air about it, evaporating as fast as that air is dry. So a cloud's cap forms, grows
// into turrets, its base lifts when the source gives out, and it spreads, frays and is gone
// (thermalCondensate). Its source drifts with the mixed layer's wind, and its bubbles further
// downwind with the shear over it as they rise (courseAloft).

/**
 * The atmosphere over the scene, as the 3D clouds read it.
 *
 * @group Weather
 */
export type Atmosphere = {
  /** air temperature at the surface (°C) */
  temperature: number;
  /** dew point at the surface (°C): how moist the surface air is */
  dewPoint: number;
  /**
   * how high the surface air is mixed (m): through it the temperature falls dry adiabatically
   * and the water is the surface air's. Reaching over its condensation height (and under the
   * inversion), it is a sheet: stratus, a stratocumulus deck, fog at the surface
   */
  mixedLayer: number;
  /** how fast the temperature falls from the mixed layer up to the inversion (K/km) */
  lapseRate: number;
  /** relative humidity from the mixed layer up to the inversion, 0 to 1 */
  humidity: number;
  /** height of the inversion (m): what stops the thermals rising, and flattens their tops */
  inversionHeight: number;
  /** how much warmer the air gets across the inversion (K): 0 for none */
  inversionStrength: number;
  /** how fast the temperature falls over the inversion (K/km) */
  lapseAbove: number;
  /** relative humidity over the inversion, 0 to 1 */
  humidityAbove: number;
  /**
   * a layer of air lifted toward saturation aloft (as ahead of a warm front): its base (m), its
   * depth (m) and its relative humidity (0 for none). Over 1, the share condensed: just over, a
   * thin veil; more, a deck
   */
  moistLayerHeight: number;
  moistLayerDepth: number;
  moistLayerHumidity: number;
  /**
   * how much stronger the wind gets with height over the mixed layer (m/s per km), blowing the
   * way the wind at the surface does: clouds lean and stretch downwind as they rise into it
   */
  shear: number;
  /** how strongly the surface heats the air: how many thermals rise, and how strong, 0 to 1 */
  heating: number;
  /** how patchy the heating and the moisture are, 0 even to 1 patchy */
  patchiness: number;
};

/** Conditions by name, each giving a different kind of sky. */
export type AtmospherePreset =
  | 'fair'
  | 'marine-sc'
  | 'stratus'
  | 'stratus-veil'
  | 'fog'
  | 'altostratus'
  | 'unstable'
  | 'spreading';

// No moist layer aloft.
const DRY_ALOFT = { moistLayerHeight: 4000, moistLayerDepth: 500, moistLayerHumidity: 0 };

/**
 * Conditions by name: `fair` (a summer afternoon: thermals out of a 1 km mixed layer into
 * moist, unstable air, stopped by an inversion at 2.5 km: cumulus of every size, flat-topped),
 * `marine-sc` (a moist mixed layer reaching a strong low inversion: a stratocumulus deck),
 * `stratus` (stable, saturated under a low inversion), `stratus-veil` (the mixed layer just
 * saturating under its top: a thin low veil with holes), `fog` (saturated at the surface),
 * `altostratus` (quiet, dry air below a moist layer at some 4 km: a large veil aloft) and
 * `unstable` (strong heating with no cap: towering cumulus among small ones) and `spreading`
 * (cumulus rising into moist air under a strong inversion: as they lose their lift they spread
 * into stratocumulus sheets).
 *
 * @group Weather
 */
export const ATMOSPHERE_PRESETS: Readonly<Record<AtmospherePreset, Atmosphere>> = {
  fair: {
    temperature: 22,
    dewPoint: 13,
    mixedLayer: 1000,
    lapseRate: 6.5,
    humidity: 0.75,
    inversionHeight: 2500,
    inversionStrength: 6,
    lapseAbove: 6.5,
    humidityAbove: 0.3,
    ...DRY_ALOFT,
    shear: 1.5,
    heating: 0.6,
    patchiness: 0.5,
  },
  'marine-sc': {
    temperature: 15,
    dewPoint: 11,
    mixedLayer: 1100,
    lapseRate: 6.5,
    humidity: 0.8,
    inversionHeight: 1100,
    inversionStrength: 6,
    lapseAbove: 6.5,
    humidityAbove: 0.2,
    ...DRY_ALOFT,
    shear: 1,
    heating: 0.3,
    patchiness: 0.5,
  },
  stratus: {
    temperature: 12,
    dewPoint: 11.2,
    mixedLayer: 600,
    lapseRate: 6.5,
    humidity: 0.8,
    inversionHeight: 600,
    inversionStrength: 5,
    lapseAbove: 6.5,
    humidityAbove: 0.4,
    ...DRY_ALOFT,
    shear: 0.5,
    heating: 0.05,
    patchiness: 0.4,
  },
  'stratus-veil': {
    temperature: 12,
    dewPoint: 9,
    mixedLayer: 460,
    lapseRate: 6.5,
    humidity: 0.8,
    inversionHeight: 460,
    inversionStrength: 4,
    lapseAbove: 6.5,
    humidityAbove: 0.3,
    ...DRY_ALOFT,
    shear: 0.5,
    heating: 0.05,
    patchiness: 0.6,
  },
  fog: {
    temperature: 10,
    dewPoint: 10,
    mixedLayer: 200,
    lapseRate: 6.5,
    humidity: 0.8,
    inversionHeight: 200,
    inversionStrength: 6,
    lapseAbove: 6.5,
    humidityAbove: 0.4,
    ...DRY_ALOFT,
    shear: 0,
    heating: 0,
    patchiness: 0.3,
  },
  altostratus: {
    temperature: 18,
    dewPoint: 4,
    mixedLayer: 1200,
    lapseRate: 6.5,
    humidity: 0.5,
    inversionHeight: 9000,
    inversionStrength: 0,
    lapseAbove: 6.5,
    humidityAbove: 0.5,
    moistLayerHeight: 4000,
    moistLayerDepth: 500,
    moistLayerHumidity: 1.02,
    shear: 3,
    heating: 0.05,
    patchiness: 0.7,
  },
  unstable: {
    temperature: 28,
    dewPoint: 18,
    mixedLayer: 1200,
    lapseRate: 7.5,
    humidity: 0.75,
    inversionHeight: 9000,
    inversionStrength: 0,
    lapseAbove: 7,
    humidityAbove: 0.5,
    ...DRY_ALOFT,
    shear: 2,
    heating: 0.9,
    patchiness: 0.7,
  },
  spreading: {
    temperature: 18,
    dewPoint: 12,
    mixedLayer: 700,
    lapseRate: 6.5,
    humidity: 0.96,
    inversionHeight: 1900,
    inversionStrength: 6,
    lapseAbove: 6.5,
    humidityAbove: 0.3,
    ...DRY_ALOFT,
    shear: 1,
    heating: 0.6,
    patchiness: 0.5,
  },
};

/** The heights the model works at: every this many metres from the surface up to the top. */
export const ATMOSPHERE_STEP = 25;
export const ATMOSPHERE_TOP = 10000;
export const ATMOSPHERE_LEVELS = ATMOSPHERE_TOP / ATMOSPHERE_STEP + 1;
/** A thermal's radius at strength 0 and 1 (metres): the stronger, the broader. */
export const THERMAL_RADIUS: readonly [number, number] = [120, 2000];
/**
 * The broadest a thermal's bubbles are where they leave its source (m): a thermal broader than
 * this rises as a cluster of turrets this broad (thermalBubbles' sources), not as one bubble, so
 * a large cumulus is heaped of many, as one is, and grows outward as more of them join it.
 */
export const THERMAL_TURRET = 600;
/** The air a thermal mixes in per metre it rises, times its radius (Simpson's 0.2 / R). */
export const THERMAL_ENTRAINMENT = 0.2;
/** How deep the inversion and the mixed layer's top are (metres): what changes across them does so over this much. */
export const INVERSION_DEPTH = 100;
/** The time between the heights a thermal's course is tabled at (s; atmosphereTable). */
export const ATMOSPHERE_TIME_STEP = 10;
/** How fast a thermal's bubble widens as it rises (metres of radius per metre), mixing in air. */
export const THERMAL_GROWTH = 0.1;
/**
 * How fast the eddies about a cloud no longer fed mix it into the air (m/s): a bubble that has
 * stopped mixes over its radius in its radius over this. Slow: stopped and spread, a cloud lies
 * stably, its eddies weak.
 */
export const THERMAL_MIXING = 0.75;
/** How far a bubble that has stopped spreads sideways, times its radius (to a sheet). */
export const THERMAL_SPREAD = 3;
/**
 * How fast it spreads: in this many of its mixing times. It flattens as it spreads, keeping its
 * volume, down to THERMAL_SHEET of its radius thick; spread further, its water thins out.
 */
export const THERMAL_SPREAD_TIME = 1.5;
export const THERMAL_SHEET = 0.25;
/** How fast a bubble that has stopped sinks back to where it stopped being buoyant: in this many of its mixing times. */
export const THERMAL_SETTLE_TIME = 0.3;
/** The time between a thermal's bubbles: this many of its radii over its strongest updraft. */
export const THERMAL_PULSE = 2;
/** The most bubbles a thermal releases: the strongest, a few of these; the weakest, one or two. */
export const THERMAL_PULSES = 6;
/**
 * How stable the air must be for a bubble that stops in it to spread into a sheet (1/s: the
 * moist Brunt–Väisälä frequency, moistStability): none at the first, fully at the second. An
 * isothermal layer some way between; an inversion of a few kelvin past it.
 */
export const THERMAL_STABLE: readonly [number, number] = [0.005, 0.03];

const G = 9.81;
const CP = 1005;
const RD = 287.04;
const LV = 2.5e6;
const RV = 461.5;
const EPS = 0.622;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The air's pressure `z` metres up (hPa): a standard atmosphere's, near enough. */
export function pressureAt(z: number): number {
  return 1013.25 * Math.exp(-z / 8400);
}

/** The vapour pressure over water at saturation at `celsius` (hPa; Bolton). */
export function saturationPressure(celsius: number): number {
  return 6.112 * Math.exp((17.67 * celsius) / (celsius + 243.5));
}

/** The mixing ratio of saturated air at `kelvin` and `pressure` (hPa), kg of water per kg of air. */
export function saturationMixingRatio(kelvin: number, pressure: number): number {
  const e = saturationPressure(kelvin - 273.15);
  return (EPS * e) / Math.max(pressure - e, 1);
}

/** The height a surface parcel at `celsius` and `dewPoint` condenses at (metres; Espy's 125 m/K). */
export function condensationHeight(celsius: number, dewPoint: number): number {
  return Math.max(125 * (celsius - dewPoint), 0);
}

/**
 * The air about the scene `z` metres up: its temperature (K) and its water (total, kg/kg). Through
 * the mixed layer, dry adiabatic and with the surface air's water; from it to the inversion,
 * falling at `lapseRate` and as humid as `humidity` says; over the inversion, warmer by its
 * strength, then falling at `lapseAbove`, as humid as `humidityAbove` says. Never moister than
 * the surface air.
 */
export function environmentAt(
  a: Atmosphere,
  z: number,
): { temperature: number; water: number } {
  const t0 = a.temperature + 273.15;
  const zm = Math.min(a.mixedLayer, a.inversionHeight);
  const zi = a.inversionHeight;
  const tm = t0 - (9.8 * zm) / 1000;
  const ti = tm - (a.lapseRate * (zi - zm)) / 1000;
  const temperature =
    z <= zm
      ? t0 - (9.8 * z) / 1000
      : z <= zi
        ? tm - (a.lapseRate * (z - zm)) / 1000
        : ti +
          a.inversionStrength * smoothstep(zi, zi + INVERSION_DEPTH, z) -
          (a.lapseAbove * (z - zi)) / 1000;
  const surface = saturationMixingRatio(a.dewPoint + 273.15, pressureAt(0));
  const saturated = saturationMixingRatio(temperature, pressureAt(z));
  const relative = a.humidity + (a.humidityAbove - a.humidity) * smoothstep(zi, zi + INVERSION_DEPTH, z);
  const mixed = smoothstep(zm, zm + INVERSION_DEPTH, z);
  const water = surface + (Math.min(relative * saturated, surface) - surface) * mixed;
  // The moist layer aloft, its edges eased over a quarter of its depth (at most INVERSION_DEPTH).
  const h = a.moistLayerHeight;
  const depth = Math.max(a.moistLayerDepth, 1);
  const ease = Math.min(INVERSION_DEPTH, 0.25 * depth);
  const inside = smoothstep(h - ease, h + ease, z) * (1 - smoothstep(h + depth - ease, h + depth + ease, z));
  return {
    temperature,
    water: Math.max(water, a.moistLayerHumidity * saturated * inside),
  };
}

// The temperature (K) and condensate (kg/kg) of air `z` metres up with liquid water static
// energy `energy` (cp T + g z − L ql, J/kg) and total water `water`: whatever vapour is over
// saturation condensed, warming it (Newton's method on the energy).
function settle(energy: number, water: number, z: number) {
  const p = pressureAt(z);
  let t = (energy - G * z) / CP;
  if (water <= saturationMixingRatio(t, p)) return { temperature: t, condensate: 0 };
  for (let i = 0; i < 6; i++) {
    const qs = saturationMixingRatio(t, p);
    const f = CP * t + G * z - LV * (water - qs) - energy;
    const slope = CP + (LV * LV * qs) / (RV * t * t);
    t -= f / slope;
  }
  return {
    temperature: t,
    condensate: Math.max(water - saturationMixingRatio(t, p), 0),
  };
}

const virtual = (t: number, vapour: number, condensate: number) =>
  t * (1 + 0.608 * vapour - condensate);

/**
 * How stable the air `z` metres up is for cloud (1/s): the Brunt–Väisälä frequency a saturated
 * parcel feels there, from how much slower the air cools with height than the moist adiabat; 0
 * where it cools as fast or faster, and cloud would rise on through it. An inversion is very
 * stable; conditionally unstable air, as under a fair weather inversion, not at all.
 */
export function moistStability(a: Atmosphere, z: number): number {
  const below = environmentAt(a, z - 0.5 * ATMOSPHERE_STEP).temperature;
  const above = environmentAt(a, z + 0.5 * ATMOSPHERE_STEP).temperature;
  const t = 0.5 * (below + above);
  const lapse = (below - above) / ATMOSPHERE_STEP;
  const qs = saturationMixingRatio(t, pressureAt(z));
  const moist = (G * (1 + (LV * qs) / (RD * t))) / (CP + (LV * LV * qs * EPS) / (RD * t * t));
  return Math.sqrt(Math.max((G / t) * (moist - lapse), 0));
}

/**
 * How far a thermal's bubbles that stop spread into sheets (0 to 1 of THERMAL_SPREAD): by the
 * most stable air (THERMAL_STABLE) between where they stop being buoyant, `neutral`, and
 * INVERSION_DEPTH over their `top` (m), `stability` giving it (1/s: moistStability) at each of
 * the table's levels between. Stopped by an inversion, a cumulus spreads under it into
 * stratocumulus; stopped in conditionally unstable air, it mixes away where it is, in shreds.
 */
export function sheetSpread(
  neutral: number,
  top: number,
  stability: (level: number) => number,
): number {
  let most = 0;
  const from = Math.max(Math.floor(neutral / ATMOSPHERE_STEP), 0);
  const to = Math.min(Math.ceil((top + INVERSION_DEPTH) / ATMOSPHERE_STEP), ATMOSPHERE_LEVELS - 1);
  for (let i = from; i <= to; i++) most = Math.max(most, stability(i));
  return smoothstep(THERMAL_STABLE[0], THERMAL_STABLE[1], most);
}

/** A thermal's radius at `strength` (metres, 0 to 1: THERMAL_RADIUS). */
export function thermalRadius(strength: number): number {
  const [least, most] = THERMAL_RADIUS;
  return least * Math.pow(most / least, Math.min(Math.max(strength, 0), 1));
}

/**
 * A thermal of `strength` (0 to 1) rising from the surface through `a`: at each level
 * (ATMOSPHERE_STEP apart) its condensate (kg/kg), its updraft (m/s) and the time it takes to get
 * there (s); where its cloud's base is and where it stops (metres; base at the top where it forms
 * none), when it stops (s), and where its updraft is strongest (m: where it stops being buoyant,
 * near enough; what it sinks back to and spreads at once stopped). Warmer and moister than the
 * air about it as the surface heats it; mixing in that air as it rises, the faster the narrower
 * it is; buoyant while warmer (by its virtual temperature, its condensate's weight pulling it
 * down), carried on by its momentum past where it stops being so.
 */
export function liftThermal(
  a: Atmosphere,
  strength: number,
): {
  condensate: Float32Array;
  updraft: Float32Array;
  time: Float32Array;
  base: number;
  top: number;
  topTime: number;
  neutral: number;
} {
  const condensate = new Float32Array(ATMOSPHERE_LEVELS);
  const updraft = new Float32Array(ATMOSPHERE_LEVELS);
  const time = new Float32Array(ATMOSPHERE_LEVELS);
  const s = Math.min(Math.max(strength, 0), 1);
  const entrainment = THERMAL_ENTRAINMENT / thermalRadius(s);
  const surface = environmentAt(a, 0);
  let energy = CP * (surface.temperature + a.heating * (0.2 + 1.3 * s));
  let water = surface.water * (1 + a.heating * (0.03 + 0.07 * s));
  let w2 = (0.5 + 1.5 * s) ** 2;
  let base = ATMOSPHERE_TOP;
  let top = 0;
  let neutral = 0;
  let t = 0;
  let before = Math.sqrt(w2);
  for (let i = 0; i < ATMOSPHERE_LEVELS; i++) {
    const z = i * ATMOSPHERE_STEP;
    const air = environmentAt(a, z);
    const airEnergy = CP * air.temperature + G * z;
    if (i > 0) {
      // Mixing in the air about it over the step.
      const mixed = Math.min(entrainment * ATMOSPHERE_STEP, 1);
      energy += mixed * (airEnergy - energy);
      water += mixed * (air.water - water);
    }
    const parcel = settle(energy, water, z);
    const airSettled = settle(airEnergy, air.water, z);
    const buoyancy =
      (G *
        (virtual(parcel.temperature, water - parcel.condensate, parcel.condensate) -
          virtual(airSettled.temperature, air.water - airSettled.condensate, airSettled.condensate))) /
      airSettled.temperature;
    if (i > 0) w2 += 2 * ATMOSPHERE_STEP * (0.67 * buoyancy - entrainment * w2);
    if (w2 <= 0) break;
    const w = Math.sqrt(w2);
    if (i > 0) t += (2 * ATMOSPHERE_STEP) / (before + w);
    before = w;
    condensate[i] = parcel.condensate;
    updraft[i] = w;
    time[i] = t;
    if (parcel.condensate > 0 && base === ATMOSPHERE_TOP) base = z;
    if (buoyancy > 0) neutral = z;
    top = z;
  }
  return { condensate, updraft, time, base, top, topTime: t, neutral };
}

/**
 * The air's own condensate `z` metres up, or how far it is from saturation (negative), kg/kg:
 * where the mixed layer reaches its condensation height under the inversion, a sheet; and
 * the air's water at saturation there (kg/kg).
 */
export function environmentCondensate(
  a: Atmosphere,
  z: number,
): { condensate: number; saturated: number } {
  const air = environmentAt(a, z);
  const saturated = saturationMixingRatio(air.temperature, pressureAt(z));
  return { condensate: air.water - saturated, saturated };
}

/**
 * How far moister and drier patches of air move its water, as a share of its water at
 * saturation, at `patchiness` 1: what breaks a sheet into veils with holes, and where the air
 * is near saturation, raises patches of it into cloud.
 */
export const ATMOSPHERE_MOISTURE = 0.1;

/**
 * A thermal's life: its parcel's course (liftThermal), its turrets' radius at its source (m: its
 * own, at most THERMAL_TURRET), the time between its bubbles (s: THERMAL_PULSE radii over its
 * strongest updraft), the time a bubble that has stopped takes to mix over its radius (s: the
 * thermal's whole radius at its top over THERMAL_MIXING: a cluster's turrets mix away together),
 * how far those spread into sheets (0 to 1: sheetSpread), the top of the mixed layer (m) and the
 * shear over it (m/s per m).
 *
 * @group Weather
 */
export type ThermalLife = {
  lift: ReturnType<typeof liftThermal>;
  radius: number;
  pulse: number;
  mixing: number;
  spreads: number;
  mixedTop: number;
  shear: number;
};

/** The life of a thermal of `strength` (0 to 1) in `a`. */
export function thermalLife(a: Atmosphere, strength: number): ThermalLife {
  const lift = liftThermal(a, strength);
  const whole = thermalRadius(strength);
  const radius = Math.min(whole, THERMAL_TURRET);
  const most = lift.updraft.reduce((m, w) => Math.max(m, w), 0);
  return {
    lift,
    radius,
    pulse: (THERMAL_PULSE * radius) / Math.max(most, 0.5),
    mixing: (whole + THERMAL_GROWTH * lift.top) / THERMAL_MIXING,
    spreads: sheetSpread(lift.neutral, lift.top, i => moistStability(a, i * ATMOSPHERE_STEP)),
    mixedTop: Math.min(a.mixedLayer, a.inversionHeight),
    shear: a.shear / 1000,
  };
}

/** The height (m) a thermal's bubble, on the course `lift`, has risen to `age` s after its release. */
export function courseHeight(lift: ThermalLife['lift'], age: number): number {
  if (age >= lift.topTime) return lift.top;
  let lo = 0;
  let hi = Math.round(lift.top / ATMOSPHERE_STEP);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lift.time[mid] <= age) lo = mid;
    else hi = mid;
  }
  const span = lift.time[hi] - lift.time[lo];
  const f = span > 0 ? Math.min(Math.max((age - lift.time[lo]) / span, 0), 1) : 0;
  return (lo + f * (hi - lo)) * ATMOSPHERE_STEP;
}

/**
 * How long a thermal's bubble, on the course `lift`, has been over `mixedTop` by `age` s after
 * its release, each second weighed by how far over it (m s; in ATMOSPHERE_TIME_STEP steps, as
 * atmosphereTable tables it): the shear over the mixed layer times this is how far downwind of
 * its source it has been carried.
 */
export function courseAloft(lift: ThermalLife['lift'], mixedTop: number, age: number): number {
  const over = (t: number) => Math.max(courseHeight(lift, t) - mixedTop, 0);
  const steps = Math.floor(age / ATMOSPHERE_TIME_STEP);
  let aloft = 0;
  let before = over(0);
  for (let j = 1; j <= steps; j++) {
    const now = over(j * ATMOSPHERE_TIME_STEP);
    aloft += 0.5 * ATMOSPHERE_TIME_STEP * (before + now);
    before = now;
  }
  return aloft + 0.5 * (age - steps * ATMOSPHERE_TIME_STEP) * (before + over(age));
}

/**
 * The shape of a bubble of radius `r` (m) that stopped `stopped` s ago (0: rising), mixing over
 * `mixing` s: its radius across and up (m), the share of its water over the air's about it it
 * keeps as it mixes that air in, and how far that water is thinned as it spreads past a sheet
 * THERMAL_SHEET of its radius thick. Stopped, it spreads sideways into a sheet, as far as
 * `spreads` (0 to 1: sheetSpread) lets it, as a cumulus losing its lift spreads under an
 * inversion: where the air about it is moist, a stratocumulus or stratus sheet that lingers;
 * where dry, it evaporates as it goes.
 */
export function bubbleShape(r: number, stopped: number, mixing: number, spreads: number) {
  const kept = Math.exp(-stopped / mixing);
  const spread =
    1 +
    THERMAL_SPREAD * spreads * (1 - Math.exp(-stopped / (THERMAL_SPREAD_TIME * mixing)));
  const flat = Math.max(1 / (spread * spread), THERMAL_SHEET);
  return { across: r * spread, up: r * flat, kept, dilution: 1 / (spread * spread * flat) };
}

/**
 * Where a bubble that stopped at `top` `stopped` s ago, mixing over `mixing` s, lies (m): sinking
 * back from where its momentum carried it toward `neutral`, where it stopped being buoyant (over
 * THERMAL_SETTLE_TIME of its mixing times), to spread there.
 */
export function settledHeight(top: number, neutral: number, stopped: number, mixing: number) {
  return top - (top - neutral) * (1 - Math.exp(-stopped / (THERMAL_SETTLE_TIME * mixing)));
}

/**
 * A thermal's bubble `age` s after its release: its middle's height (m), its radius across and
 * up (m), the share it keeps of its water over the air's about it and how far that is thinned
 * (bubbleShape), and how far downwind of its source the shear has carried it (m; its source
 * drifts with the wind of the mixed layer). Rising, it widens as it mixes in air, and keeps it
 * all; stopped, it sinks back to where it stopped being buoyant (settledHeight), spreads there
 * into a sheet and mixes into the air about it.
 */
export function thermalBubble(life: ThermalLife, age: number) {
  const { lift } = life;
  const stopped = Math.max(age - lift.topTime, 0);
  const height =
    stopped > 0
      ? settledHeight(lift.top, lift.neutral, stopped, life.mixing)
      : courseHeight(lift, age);
  const r = life.radius + THERMAL_GROWTH * (stopped > 0 ? lift.top : height);
  const shape = bubbleShape(r, stopped, life.mixing, life.spreads);
  const lean = life.shear * courseAloft(lift, life.mixedTop, age);
  return { height, ...shape, lean };
}

/**
 * The condensate (kg/kg) `z` metres up along the middles of the bubbles of a thermal of `life`
 * in `a` (leaning downwind with the shear), `age` s after its source released the first of
 * `pulses` bubbles, one every `life.pulse`. Within a bubble, its
 * parcel's water at that height over the air's about it, as much as it keeps, eased to the air's
 * own toward its edge: so the cloud's edge lies where that mix just saturates, and as a bubble
 * mixes away its cloud shrinks into its middle, the faster the drier the air about it. Where the
 * bubbles overlap, the most of them. What the clouds' bake does about every thermal.
 */
export function thermalCondensate(
  a: Atmosphere,
  life: ThermalLife,
  pulses: number,
  age: number,
  z: number,
): number {
  const i = Math.min(Math.max(Math.round(z / ATMOSPHERE_STEP), 0), ATMOSPHERE_LEVELS - 1);
  const parcel = life.lift.condensate[i];
  const around = environmentCondensate(a, z).condensate;
  const over = parcel - around;
  let excess = 0;
  if (parcel > 0 && over > 0)
    for (let b = 0; b < pulses; b++) {
      const since = age - b * life.pulse;
      if (since < 0) break;
      const bubble = thermalBubble(life, since);
      const d = (z - bubble.height) / bubble.up;
      excess = Math.max(excess, over * bubble.kept * bubble.dilution * Math.max(1 - d * d, 0));
    }
  return Math.max(around + excess, 0);
}

/**
 * The atmosphere as a table for the clouds' bake: ATMOSPHERE_LEVELS texels wide, 2 `rows` + 1
 * high, RGBA. Rows 0 to `rows` − 1 are thermals from strength 0 to 1, by height (a level a texel):
 * their condensate (g/kg), updraft (m/s), the most updraft they reach (m/s) and where (m: where
 * they stop being buoyant, near enough). Row `rows` is the
 * air's own, by height: its condensate, or its distance from saturation where negative (g/kg),
 * its water at saturation (g/kg), and how stable it is for cloud (1/s: moistStability). Rows
 * `rows` + 1 to 2 `rows` are the thermals' courses, by
 * time (ATMOSPHERE_TIME_STEP a texel): the height their bubbles have reached (m), how long they
 * have been over the mixed layer (m s: courseAloft), when they stop (s) and where (m).
 */
export function atmosphereTable(a: Atmosphere, rows = 32): Float32Array {
  const width = ATMOSPHERE_LEVELS;
  const mixedTop = Math.min(a.mixedLayer, a.inversionHeight);
  const data = new Float32Array(width * (2 * rows + 1) * 4);
  for (let r = 0; r < rows; r++) {
    const lift = liftThermal(a, r / (rows - 1));
    const { condensate, updraft } = lift;
    const most = updraft.reduce((m, w) => Math.max(m, w), 0);
    for (let i = 0; i < width; i++) {
      const at = 4 * (r * width + i);
      data[at] = condensate[i] * 1000;
      data[at + 1] = updraft[i];
      data[at + 2] = most;
      data[at + 3] = lift.neutral;
    }
    let aloft = 0;
    let before = 0;
    for (let j = 0; j < width; j++) {
      const height = courseHeight(lift, j * ATMOSPHERE_TIME_STEP);
      const over = Math.max(height - mixedTop, 0);
      if (j > 0) aloft += 0.5 * ATMOSPHERE_TIME_STEP * (before + over);
      before = over;
      const at = 4 * ((rows + 1 + r) * width + j);
      data[at] = height;
      data[at + 1] = aloft;
      data[at + 2] = lift.topTime;
      data[at + 3] = lift.top;
    }
  }
  for (let i = 0; i < width; i++) {
    const z = i * ATMOSPHERE_STEP;
    const air = environmentCondensate(a, z);
    data[4 * (rows * width + i)] = air.condensate * 1000;
    data[4 * (rows * width + i) + 1] = air.saturated * 1000;
    data[4 * (rows * width + i) + 2] = moistStability(a, z);
  }
  return data;
}

/**
 * The heights (m) `a`'s clouds can lie between, from its `table` (atmosphereTable, `rows`
 * thermals): from the lowest any of its thermals or its air's moister patches condense to the
 * highest, with `margin` either side; at least `least` apart. What the bake spans, so a thin
 * veil is baked as finely as a tall tower is coarsely.
 */
export function atmosphereExtent(
  a: Atmosphere,
  table: Float32Array,
  rows = 32,
  margin = 150,
  least = 300,
): [number, number] {
  const width = ATMOSPHERE_LEVELS;
  const swing = ATMOSPHERE_MOISTURE * Math.min(Math.max(a.patchiness, 0), 1);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < width; i++) {
    const at = 4 * (rows * width + i);
    let cloud = table[at] + swing * table[at + 1] > 0;
    for (let r = 0; r < rows && !cloud; r++) cloud = table[4 * (r * width + i)] > 0;
    if (!cloud) continue;
    low = Math.min(low, i * ATMOSPHERE_STEP);
    high = Math.max(high, i * ATMOSPHERE_STEP);
  }
  if (low > high) return [0, least];
  let bottom = Math.max(low - margin, 0);
  let top = Math.min(high + margin, ATMOSPHERE_TOP);
  if (top - bottom < least) {
    const middle = 0.5 * (bottom + top);
    bottom = Math.max(middle - 0.5 * least, 0);
    top = bottom + least;
  }
  return [bottom, top];
}
