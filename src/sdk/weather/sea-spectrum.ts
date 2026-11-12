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
};

/** A long swell's default spreading exponent (cos^2s): narrow. */
export const SEA_SWELL_SPREAD = 24;

// North Sea JONSWAP peak enhancement.
const GAMMA = 3.3;
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

// The JONSWAP shape (unnormalised) at angular frequency `w` about the peak `wp`.
function jonswapShape(w: number, wp: number): number {
  if (w <= 0) return 0;
  const sigma = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) * (w - wp)) / (2 * sigma * sigma * wp * wp));
  return (
    Math.pow(w, -5) * Math.exp(-1.25 * Math.pow(wp / w, 4)) * Math.pow(GAMMA, r)
  );
}

// ∫ shape dω, numerically, for the peak `wp` (the shape scales with it as wp^-4).
const JONSWAP_UNIT = (() => {
  // At wp = 1, over 0.2 … 12 in fine log steps.
  let sum = 0;
  const steps = 4000;
  const lo = Math.log(0.2);
  const hi = Math.log(12);
  for (let i = 0; i < steps; i++) {
    const w = Math.exp(lo + ((i + 0.5) / steps) * (hi - lo));
    sum += jonswapShape(w, 1) * w * ((hi - lo) / steps);
  }
  return sum;
})();

/**
 * The directional spreading of a wind sea at `w` about its peak `wp` (Mitsuyasu): the exponent
 * s of cos^2s(θ/2), narrowest at the peak, wider for shorter waves.
 */
export function windSeaSpread(w: number, wp: number): number {
  const sp = 17;
  const ratio = w / wp;
  const s = ratio <= 1 ? sp * Math.pow(ratio, 5) : sp * Math.pow(ratio, -2.5);
  return Math.min(Math.max(s, 1), 40);
}

/**
 * cos^2s(θ/2), normalised over the circle: Γ(s+1) / (2√π Γ(s+½)), the ratio of the Gammas
 * taken as √(s + ¼) (within 1 % for s ≥ 1).
 */
export function spreadingDensity(theta: number, s: number): number {
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
  /** significant wave height of all of it, metres */
  significantHeight: number;
  input: SeaSpectrumInput;
};

type Part = {
  // frequency density S(ω), m²·s
  frequency: (w: number) => number;
  // directional exponent s at ω
  spread: (w: number) => number;
  angle: number;
  variance: number;
};

/**
 * The spectrum of the wind sea and swells `input` describes: fully developed for the wind
 * (JONSWAP, γ 3.3), each swell a narrow peak about its period, every part spread about its
 * direction (cos^2s). Deep water: ω² = g·k.
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
    // The shape at wp is the unit one scaled: ∫ = JONSWAP_UNIT · wp^-4.
    const scale = m0 / (JONSWAP_UNIT * Math.pow(wp, -4));
    parts.push({
      frequency: w => scale * jonswapShape(w, wp),
      spread: w => windSeaSpread(w, wp),
      angle: angleOf(input.windDirection),
      variance: m0,
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

  // ∫ S(ω) k^p dω over the band, in log steps (directions integrate to 1).
  const moment = (kLo: number, kHi: number, p: number) => {
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
      for (const part of parts) f += part.frequency(w);
      sum += f * Math.pow(k, p) * w * ((hi - lo) / steps);
    }
    return sum;
  };

  const total = parts.reduce((s, part) => s + part.variance, 0);
  return {
    density,
    variance: (kLo, kHi) => moment(kLo, kHi, 0),
    slopeVariance: (kLo, kHi) => moment(kLo, kHi, 2),
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
