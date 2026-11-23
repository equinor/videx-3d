import type { Vec2 } from '../types/common';

/** Gravity, m/s². */
export const SEA_G = 9.81;

/**
 * A swell: waves from weather far away, running on regardless of the wind here.
 *
 * @group Weather
 */
export type SeaSwell = {
  /** significant wave height, metres */
  height: number;
  /** peak period, seconds (a long ocean swell 10–20 s) */
  period: number;
  /** the way it travels, in the wave plane (X, Z); need not be unit */
  direction: Vec2;
  /** how narrow it runs about its direction: the exponent s of cos^2s(θ/2). Default 24 */
  spread?: number;
};

/**
 * What the sea's spectrum is made from: the wind here, and swells from afar.
 *
 * @group Weather
 */
export type SeaSpectrumInput = {
  /** wind speed 10 m over the sea (U10), m/s */
  windSpeed: number;
  /** the way the wind blows toward, in the wave plane (X, Z); need not be unit */
  windDirection: Vec2;
  swells?: SeaSwell[];
  /** every wave's height scaled by this, the spectrum's variance by its square. Default 1 */
  heightScale?: number;
  /**
   * ⚠️ Tuning, to be settled: the least spreading exponent s of the wind sea's short waves
   * (cos^2s). Default 1, Mitsuyasu's as given: nearly isotropic, some running upwind.
   */
  spreadFloor?: number;
  /**
   * ⚠️ Tuning, to be settled: the wind sea's waves above this many times its peak frequency
   * fade out (as the `Ocean` drew 0.6–3× until 2026-11). Default none.
   */
  tail?: number;
};

/** A long swell's default spreading exponent (cos^2s): narrow. */
const SEA_SWELL_SPREAD = 24;

// The least wind the wind sea is reckoned from, so its peak stays finite.
const MIN_WIND = 0.5;
// The swell's frequency spread about its peak, a share of it.
const SWELL_WIDTH = 0.07;

/**
 * The fully developed wind sea for a wind (m/s): its peak angular frequency and significant
 * wave height (Pierson–Moskowitz), as the `Ocean` has always taken them: 10 m/s gives
 * Hs ≈ 2.1 m and a peak wavelength ≈ 88 m.
 */
export function windSeaPeak(windSpeed: number) {
  const u = Math.max(windSpeed, MIN_WIND);
  return {
    omega: (0.855 * SEA_G) / u,
    height: windSpeed > 0 ? (0.21 * windSpeed * windSpeed) / SEA_G : 0,
  };
}

// Elfouhaily et al. 1997 ("A unified directional spectrum for long and short wind-driven
// waves", JGR 102(C7)): the wind sea's curvature spectrum B(k) = k³·S(k), long waves (B_l)
// and short (B_h), fully developed (inverse wave age Ω about 0.84).
// The capillary-gravity peak: its wavenumber (rad/m) and phase speed (m/s).
const ELF_KM = 370;
const ELF_CM = 0.23;

// The phase speed of a wave `k`, gravity and capillarity.
const phaseSpeed = (k: number) =>
  Math.sqrt((SEA_G / k) * (1 + (k / ELF_KM) * (k / ELF_KM)));

/**
 * The friction velocity u* over the sea for a wind U10 (m/s): √Cd·U10, the drag Cd =
 * (0.8 + 0.065·U10)·10⁻³ (Wu 1982).
 */
export function frictionVelocity(windSpeed: number): number {
  const u = Math.max(windSpeed, 0);
  return Math.sqrt((0.8 + 0.065 * u) * 1e-3) * u;
}

/**
 * The short waves' strength for a friction velocity u* (Elfouhaily's α_m): none in a calm, it
 * grows with the wind, three times as fast once u* passes the capillary-gravity waves' phase
 * speed (0.23 m/s, about 7 m/s of wind).
 */
export function shortWaveStrength(uStar: number): number {
  if (!(uStar > 0)) return 0;
  const r = Math.log(uStar / ELF_CM);
  return Math.max(0.01 * (1 + (uStar <= ELF_CM ? r : 3 * r)), 0);
}

// The two parts of Elfouhaily's curvature spectrum at `k`, about the peak `kp` with inverse
// wave age `omega` and short-wave strength `alphaM`: [long, short].
function elfouhaily(
  k: number,
  kp: number,
  omega: number,
  alphaM: number,
): [number, number] {
  if (!(k > 0)) return [0, 0];
  const gamma = omega <= 1 ? 1.7 : 1.7 + 6 * Math.log10(omega);
  const sigma = 0.08 * (1 + 4 / (omega * omega * omega));
  const root = Math.sqrt(k / kp);
  const lpm = Math.exp(-1.25 * (kp / k) * (kp / k));
  const jp = Math.pow(
    gamma,
    Math.exp(-((root - 1) * (root - 1)) / (2 * sigma * sigma)),
  );
  const c = phaseSpeed(k);
  const fp = lpm * jp * Math.exp(-(omega / Math.sqrt(10)) * (root - 1));
  const fm = lpm * jp * Math.exp(-0.25 * (k / ELF_KM - 1) * (k / ELF_KM - 1));
  const long = 0.5 * 0.006 * Math.sqrt(omega) * (phaseSpeed(kp) / c) * fp;
  const short = 0.5 * alphaM * (ELF_CM / c) * fm;
  return [long, short];
}

// ∫ B(k)/k³ dk of one of Elfouhaily's parts over [kLo, kHi), in log steps.
function elfouhailyVariance(
  part: 0 | 1,
  kp: number,
  omega: number,
  alphaM: number,
  kLo: number,
  kHi: number,
): number {
  const steps = 600;
  const lo = Math.log(kLo);
  const hi = Math.log(kHi);
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const k = Math.exp(lo + ((i + 0.5) / steps) * (hi - lo));
    sum +=
      (elfouhaily(k, kp, omega, alphaM)[part] / (k * k)) * ((hi - lo) / steps);
  }
  return sum;
}
/**
 * The directional spreading of a wind sea at `w` about its peak `wp` (Mitsuyasu): the exponent
 * s of cos^2s(θ/2), narrowest at the peak, wider for shorter waves.
 */
function windSeaSpread(w: number, wp: number, floor = 1): number {
  const sp = 17;
  const ratio = w / wp;
  const s = ratio <= 1 ? sp * Math.pow(ratio, 5) : sp * Math.pow(ratio, -2.5);
  return Math.min(Math.max(s, floor, 1), 40);
}

/**
 * cos^2s(θ/2), normalised over the circle: Γ(s+1) / (2√π Γ(s+½)), the ratio of the Gammas
 * taken as √(s + ¼) (within 1 % for s ≥ 1).
 */
function spreadingDensity(theta: number, s: number): number {
  const c = Math.cos(0.5 * theta);
  return (Math.sqrt(s + 0.25) / (2 * Math.sqrt(Math.PI))) * Math.pow(c * c, s);
}

const angleOf = (v: Vec2) => Math.atan2(v[1], v[0]);

/**
 * A sea's spectrum, ready to be read: its variance density over wavenumber vectors in the
 * wave plane, and its variance and slope variance over bands of wavenumber.
 *
 * @group Weather
 */
export type SeaSpectrum = {
  /** variance density at the wavenumber vector (kx, kz), m² per (rad/m)² */
  density: (kx: number, kz: number) => number;
  /** height variance of the waves with wavenumbers in [kLo, kHi), m² */
  variance: (kLo: number, kHi: number) => number;
  /** slope variance (both axes summed) of the waves with wavenumbers in [kLo, kHi) */
  slopeVariance: (kLo: number, kHi: number) => number;
  /**
   * the wind sea's short waves' share of {@link slopeVariance} per unit of their strength α_m
   * ({@link shortWaveStrength}), which alone follows the wind as it gusts
   */
  shortSlopeVariance: (kLo: number, kHi: number) => number;
  /** significant wave height of all of it, metres */
  significantHeight: number;
  input: SeaSpectrumInput;
};

type Part = {
  // frequency density S(ω), m²·s
  frequency: (w: number) => number;
  // the short waves' share of it per unit of their strength α_m (the wind sea's), m²·s
  short?: (w: number) => number;
  // directional exponent s at ω
  spread: (w: number) => number;
  angle: number;
  variance: number;
};

/**
 * The spectrum of the wind sea and swells `input` describes: the wind sea fully developed for
 * the wind (Elfouhaily et al. 1997: its long waves at the `Ocean`'s Hs and peak, its short
 * waves, from about a metre down, growing with the wind's friction velocity), each swell a
 * narrow peak about its period, every part spread about its direction (cos^2s). Deep water:
 * ω² = g·k.
 *
 * @group Weather
 */
export function seaSpectrum(input: SeaSpectrumInput): SeaSpectrum {
  const parts: Part[] = [];
  const scale2 = Math.max(input.heightScale ?? 1, 0) ** 2;
  const wind = windSeaPeak(input.windSpeed);
  if (wind.height > 0 && scale2 > 0) {
    const wp = wind.omega;
    const m0 = (wind.height / 4) ** 2 * scale2;
    // Elfouhaily's spectrum about the `Ocean`'s peak (its inverse wave age from that peak and
    // the wind, ≈ 0.855), its long waves scaled to the `Ocean`'s Hs; its short waves as the
    // wind's friction velocity gives them, absolute (heightScale² on both).
    const kp = (wp * wp) / SEA_G;
    const u = Math.max(input.windSpeed, MIN_WIND);
    const omega = Math.sqrt((kp * u * u) / SEA_G);
    const alphaM = shortWaveStrength(frictionVelocity(input.windSpeed));
    const longVariance = elfouhailyVariance(
      0,
      kp,
      omega,
      alphaM,
      0.2 * kp,
      4000,
    );
    const shortVariance =
      elfouhailyVariance(1, kp, omega, alphaM, 0.2 * kp, 4000) * scale2;
    // The short waves hold some of the variance about the peak too: the long ones the rest.
    const longScale =
      longVariance > 0 ? Math.max(m0 - shortVariance, 0) / longVariance : 0;
    const floor = input.spreadFloor ?? 1;
    const tail = input.tail;
    const cut =
      tail && tail > 0
        ? (w: number) => 1 / (1 + Math.pow(w / (tail * wp), 8))
        : () => 1;
    parts.push({
      // S(ω) = S(k)·dk/dω, S(k) = B(k)/k³, k = ω²/g.
      frequency: w => {
        const k = (w * w) / SEA_G;
        const [long, short] = elfouhaily(k, kp, omega, alphaM);
        return (
          ((long * longScale + short * scale2) / (k * k * k)) *
          ((2 * w) / SEA_G) *
          cut(w)
        );
      },
      short: w => {
        const k = (w * w) / SEA_G;
        return (
          ((elfouhaily(k, kp, omega, 1)[1] * scale2) / (k * k * k)) *
          ((2 * w) / SEA_G) *
          cut(w)
        );
      },
      spread: w => windSeaSpread(w, wp, floor),
      angle: angleOf(input.windDirection),
      variance: Math.max(m0, shortVariance),
    });
  }
  for (const swell of input.swells ?? []) {
    if (!(swell.height > 0) || !(swell.period > 0) || scale2 <= 0) continue;
    const ws = (2 * Math.PI) / swell.period;
    const sigma = SWELL_WIDTH * ws;
    const m0 = (swell.height / 4) ** 2 * scale2;
    const s = swell.spread ?? SEA_SWELL_SPREAD;
    parts.push({
      frequency: w =>
        (m0 / (sigma * Math.sqrt(2 * Math.PI))) *
        Math.exp(-((w - ws) * (w - ws)) / (2 * sigma * sigma)),
      spread: () => s,
      angle: angleOf(swell.direction),
      variance: m0,
    });
  }

  // S(kx, kz) = S(ω) · dω/dk · D(θ) / k, with ω = √(g k), dω/dk = g / 2ω.
  const density = (kx: number, kz: number) => {
    const k = Math.hypot(kx, kz);
    if (k <= 0) return 0;
    const w = Math.sqrt(SEA_G * k);
    const jacobian = SEA_G / (2 * w) / k;
    const theta = Math.atan2(kz, kx);
    let sum = 0;
    for (const part of parts) {
      const f = part.frequency(w);
      if (f <= 0) continue;
      sum += f * spreadingDensity(theta - part.angle, part.spread(w));
    }
    return sum * jacobian;
  };

  // ∫ S(ω) k^p dω over the band, in log steps (directions integrate to 1); `short`, the short
  // waves' per unit of their strength alone.
  const moment = (kLo: number, kHi: number, p: number, short = false) => {
    if (!(kHi > kLo) || parts.length === 0) return 0;
    const wLo = Math.sqrt(SEA_G * Math.max(kLo, 1e-6));
    const wHi = Math.sqrt(SEA_G * kHi);
    const steps = 400;
    const lo = Math.log(wLo);
    const hi = Math.log(wHi);
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const w = Math.exp(lo + ((i + 0.5) / steps) * (hi - lo));
      const k = (w * w) / SEA_G;
      let f = 0;
      for (const part of parts)
        f += short ? (part.short?.(w) ?? 0) : part.frequency(w);
      sum += f * Math.pow(k, p) * w * ((hi - lo) / steps);
    }
    return sum;
  };

  const total = parts.reduce((s, part) => s + part.variance, 0);
  return {
    density,
    variance: (kLo, kHi) => moment(kLo, kHi, 0),
    slopeVariance: (kLo, kHi) => moment(kLo, kHi, 2),
    shortSlopeVariance: (kLo, kHi) => moment(kLo, kHi, 2, true),
    significantHeight: 4 * Math.sqrt(total),
    input,
  };
}

/**
 * The sea's mean square slope for a wind (m/s), the smallest waves included (Cox and Munk,
 * 1954), as the `Ocean`'s glint has it.
 */
export function coxMunkSlopeVariance(windSpeed: number): number {
  return 0.003 + 0.00512 * Math.max(windSpeed, 0);
}
