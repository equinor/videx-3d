import { Vector2, Vector4 } from 'three';

// Deterministic pseudo-random in [0,1] used to decorrelate wave phases and
// directions. Stable per index so the sea state is reproducible.
function oceanHash01(n: number): number {
  const f = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return f - Math.floor(f);
}

/**
 * Sample the JONSWAP spectrum into the wave tables `shaders/waves.glsl` reads, in
 * place, one component per entry. Returns the significant wave height.
 *
 * Cheap (a few iterations); call it when the wind or height inputs change, never
 * per frame.
 *
 * @param windDirection the direction the waves travel, in the wave plane
 */
export function sampleOceanWaves(
  waveA: Vector4[],
  waveB: Vector4[],
  windSpeed: number,
  windDirection: Vector2,
  heightScale = 1,
  directionalSpread = 1.2,
): number {
  const N = waveA.length;
  const g = 9.81;
  const gamma = 3.3; // North Sea JONSWAP peak enhancement
  const U = Math.max(windSpeed, 0.5);
  const baseAngle = Math.atan2(windDirection.y, windDirection.x);

  // Peak angular frequency + significant wave height (Pierson-Moskowitz,
  // fully developed). Hs ~ 0.21 U^2 / g; the height scale lets users tune it.
  const omegaP = (0.855 * g) / U;
  const Hs = ((0.21 * U * U) / g) * heightScale;

  // Sample the spectrum geometrically across the energy-bearing band.
  const omegaMin = 0.6 * omegaP;
  const omegaMax = 3.0 * omegaP;
  const logStep = Math.log(omegaMax / omegaMin) / Math.max(N - 1, 1);

  type Comp = {
    ax: number;
    az: number;
    k: number;
    omega: number;
    a: number;
    ph: number;
  };
  const comps: Comp[] = [];
  let m0 = 0; // zeroth spectral moment (variance) of the sampled set

  for (let i = 0; i < N; i++) {
    const omega = omegaMin * Math.exp(logStep * i);
    const dOmega = omega * logStep; // geometric bin width
    const sigma = omega <= omegaP ? 0.07 : 0.09;
    const alpha = 0.0081;
    const r = Math.exp(
      -((omega - omegaP) * (omega - omegaP)) /
        (2 * sigma * sigma * omegaP * omegaP),
    );
    const S =
      ((alpha * g * g) / Math.pow(omega, 5)) *
      Math.exp(-1.25 * Math.pow(omegaP / omega, 4)) *
      Math.pow(gamma, r);
    const a = Math.sqrt(2 * S * dOmega);
    m0 += 0.5 * a * a;

    const k = (omega * omega) / g; // deep-water dispersion
    // Directional spreading: a deterministic fan plus a per-wave jitter,
    // both scaled by the spread, so directions are non-uniform but centred on
    // the wind direction.
    const fan = N > 1 ? (i / (N - 1) - 0.5) * 2 : 0; // -1..1
    const jitter = oceanHash01(i * 12.9898 + 4.1) - 0.5;
    const angle = baseAngle + (fan * 0.6 + jitter * 0.6) * directionalSpread;
    const ph = oceanHash01(i * 78.233 + 1.7) * Math.PI * 2;

    comps.push({ ax: Math.cos(angle), az: Math.sin(angle), k, omega, a, ph });
  }

  // Renormalise component amplitudes so the field's significant wave height
  // (4 * sqrt(m0)) matches the physical target Hs regardless of N.
  const curHs = 4 * Math.sqrt(Math.max(m0, 1e-12));
  const scale = curHs > 1e-6 ? Hs / curHs : 0;

  for (let i = 0; i < N; i++) {
    const c = comps[i];
    waveA[i].set(c.ax, c.az, c.k, c.omega);
    waveB[i].set(c.a * scale, c.ph, 0, 0);
  }

  return Hs;
}

/** Mean square slope of the wave tables: how widely their normals scatter the light. */
export function oceanSlopeVariance(waveA: Vector4[], waveB: Vector4[]): number {
  let variance = 0;
  for (let i = 0; i < waveA.length; i++) {
    const slope = waveB[i].x * waveA[i].z;
    variance += 0.5 * slope * slope;
  }
  return variance;
}
