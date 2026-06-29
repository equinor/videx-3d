import {
  Color,
  DoubleSide,
  ShaderMaterial,
  ShaderMaterialParameters,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import fragmentShader from './shaders/fragment.glsl';
import vertexShader from './shaders/vertex.glsl';

export type OceanMaterialParameters = ShaderMaterialParameters & {
  waveCount?: number;
  detailOctaves?: number;
  contactCount?: number;
};

/**
 * An oriented footprint of a floating object resting on the ocean surface, used
 * to spread contact foam around it. All values are in the ocean's local frame
 * (sea level = local y 0).
 */
export type OceanContact = {
  /** Footprint centre X (local). */
  x: number;
  /** Footprint centre Z (local). */
  z: number;
  /** Heading in radians (rotation about +Y). */
  heading: number;
  /** Half-extent along the heading (e.g. half the hull length). */
  halfLength: number;
  /** Half-extent across the heading (e.g. half the beam). */
  halfWidth: number;
  /** Width (m) of the foam band straddling the footprint edge. */
  foamWidth: number;
  /**
   * Foam strength multiplier (0 = none, 1 = full). Contact foam is independent
   * of the wind-driven `foamAmount`, so this controls how much foam the object
   * generates. Default `1`.
   */
  intensity?: number;
  /**
   * How much the foam is reduced toward the bow/stern (the forward axis), 0..1.
   * 0 = an even collar all around; 1 = foam only along the sides (where a hull
   * pushes the most water). Default `0`.
   */
  endFalloff?: number;
};

// Deterministic pseudo-random in [0,1] used to decorrelate wave phases and
// directions. Stable per index so the sea state is reproducible.
function oceanHash01(n: number): number {
  const f = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return f - Math.floor(f);
}

/**
 * Stylized, OIT-compatible ocean surface material.
 *
 * The wave field is a discrete set of directional components sampled from a
 * JONSWAP spectrum tuned for the North Sea (gamma = 3.3), driven by a single
 * physical input: the wind speed (m/s, U10). Peak frequency, wavelength and
 * significant wave height follow the standard Pierson-Moskowitz/JONSWAP
 * relations, so the wave sizes and spacing are physically plausible (e.g.
 * U = 10 m/s gives Hs ~ 2.1 m and a peak wavelength ~ 88 m). The spectrum is
 * sampled on the CPU whenever the wind changes and uploaded as uniform arrays;
 * the shaders just sum the components.
 *
 * All wave/foam animation is evaluated in world X/Z space so it tiles
 * seamlessly across patched geometry. The material is wired for the
 * OITRenderPass via {@link attachOitVariants}; because its OIT variants share
 * this material's `uniforms` object by reference, animated uniforms (time,
 * wind, colours) stay live through every transparency pass.
 */
export class OceanMaterial extends ShaderMaterial {
  isOceanMaterial = true;

  private _waveCount!: number;
  private _waveHeightScale!: number;
  private _directionalSpread!: number;
  private _contactCount!: number;

  constructor(parameters: OceanMaterialParameters = {}) {
    const {
      waveCount = 16,
      detailOctaves = 4,
      contactCount = 8,
      ...rest
    } = parameters;

    // Preallocated wave-component tables (filled by updateWaves()).
    const waveA: Vector4[] = [];
    const waveB: Vector4[] = [];
    for (let i = 0; i < waveCount; i++) {
      waveA.push(new Vector4());
      waveB.push(new Vector4());
    }

    // Preallocated contact-footprint tables (filled by setContacts()).
    const contactA: Vector4[] = [];
    const contactB: Vector4[] = [];
    const contactC: Vector4[] = [];
    for (let i = 0; i < contactCount; i++) {
      contactA.push(new Vector4());
      contactB.push(new Vector4());
      contactC.push(new Vector4());
    }

    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      // Visible from below too, so the surface still reads when the camera is
      // underwater / inside the ocean box.
      side: DoubleSide,
      defines: {
        OCEAN_WAVE_COUNT: waveCount,
        OCEAN_DETAIL_OCTAVES: detailOctaves,
        OCEAN_CONTACT_COUNT: contactCount,
      },
      uniforms: {
        uTime: new Uniform(0),
        uWindDirection: new Uniform(new Vector2(1, 0).normalize()),
        uWindSpeed: new Uniform(10),
        uSteepness: new Uniform(0.7),
        uDisplacement: new Uniform(0),

        // Spectral wave table + derived significant wave height.
        uWaveA: new Uniform(waveA),
        uWaveB: new Uniform(waveB),
        uSignificantHeight: new Uniform(1),

        uDeepColor: new Uniform(new Color('#0a2540')),
        uShallowColor: new Uniform(new Color('#1b6f8a')),
        uOpacity: new Uniform(0.7),

        uTonalVariation: new Uniform(0.4),
        // Stored as cycles per meter; the public `tonalScale` property exposes
        // it as a patch size in kilometers (default ~4 km => 1 / 4000).
        uTonalScale: new Uniform(1 / 4000),
        uTonalSharpness: new Uniform(0.5),
        uTonalColor: new Uniform(new Color('#cfe3f2')),

        uSkyColor: new Uniform(new Color('#7fb2e6')),
        uHorizonColor: new Uniform(new Color('#cfe3f2')),
        uReflectionIntensity: new Uniform(1),

        uSunDirection: new Uniform(new Vector3(-0.3, 0.8, -0.5).normalize()),
        uSunColor: new Uniform(new Color('#fff6e0')),
        uSunShininess: new Uniform(200),

        uFoamColor: new Uniform(new Color('#ffffff')),
        uFoamAmount: new Uniform(0.5),

        // Floating-object contact-foam footprints (filled by setContacts()).
        uContactCount: new Uniform(0),
        uContactA: new Uniform(contactA),
        uContactB: new Uniform(contactB),
        uContactC: new Uniform(contactC),

        uFresnelPower: new Uniform(4),
        uDetailScale: new Uniform(0.05),
        uDetailStrength: new Uniform(0.2),

        uMasterOpacity: new Uniform(1),
      },
    });

    this._waveCount = waveCount;
    this._waveHeightScale = 1;
    this._directionalSpread = 1.2;
    this._contactCount = contactCount;

    if (Object.keys(rest).length) this.setValues(rest);

    this.updateWaves();

    attachOitVariants(this);
  }

  /**
   * (Re)sample the JONSWAP spectrum into the wave-component uniform arrays from
   * the current wind speed/direction. Cheap (a few iterations) and only called
   * when the wind/height inputs change, never per frame.
   */
  private updateWaves(): void {
    const N = this._waveCount;
    const g = 9.81;
    const gamma = 3.3; // North Sea JONSWAP peak enhancement
    const U = Math.max(this.uniforms.uWindSpeed.value as number, 0.5);
    const dir = this.uniforms.uWindDirection.value as Vector2;
    const baseAngle = Math.atan2(dir.y, dir.x);

    // Peak angular frequency + significant wave height (Pierson-Moskowitz,
    // fully developed). Hs ~ 0.21 U^2 / g; the height scale lets users tune it.
    const omegaP = (0.855 * g) / U;
    const Hs = ((0.21 * U * U) / g) * this._waveHeightScale;

    // Sample the spectrum geometrically across the energy-bearing band.
    const omegaMin = 0.6 * omegaP;
    const omegaMax = 3.0 * omegaP;
    const logStep = Math.log(omegaMax / omegaMin) / Math.max(N - 1, 1);

    const waveA = this.uniforms.uWaveA.value as Vector4[];
    const waveB = this.uniforms.uWaveB.value as Vector4[];

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
      const angle =
        baseAngle + (fan * 0.6 + jitter * 0.6) * this._directionalSpread;
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

    this.uniforms.uSignificantHeight.value = Hs;
  }

  get time(): number {
    return this.uniforms.uTime.value;
  }
  set time(value: number) {
    this.uniforms.uTime.value = value;
  }

  get windDirection(): Vector2 {
    return this.uniforms.uWindDirection.value;
  }
  set windDirection(value: Vector2) {
    this.uniforms.uWindDirection.value.copy(value).normalize();
    this.updateWaves();
  }

  get windSpeed(): number {
    return this.uniforms.uWindSpeed.value;
  }
  set windSpeed(value: number) {
    this.uniforms.uWindSpeed.value = value;
    this.updateWaves();
  }

  /** Wave height multiplier applied on top of the spectrum's physical Hs. */
  get amplitude(): number {
    return this._waveHeightScale;
  }
  set amplitude(value: number) {
    this._waveHeightScale = value;
    this.updateWaves();
  }

  /** Angular spread (radians) of the wave directions around the wind. */
  get directionalSpread(): number {
    return this._directionalSpread;
  }
  set directionalSpread(value: number) {
    this._directionalSpread = value;
    this.updateWaves();
  }

  /** Significant wave height (m) derived from the current wind/height scale. */
  get significantHeight(): number {
    return this.uniforms.uSignificantHeight.value;
  }

  get steepness(): number {
    return this.uniforms.uSteepness.value;
  }
  set steepness(value: number) {
    this.uniforms.uSteepness.value = value;
  }

  get displacement(): number {
    return this.uniforms.uDisplacement.value;
  }
  set displacement(value: number) {
    // Clamped to [0, 1]: above 1 the horizontal Gerstner term over-steepens and
    // folds the mesh (visible as side artifacts), so displacement is treated as
    // off (0) / on (1).
    this.uniforms.uDisplacement.value = Math.min(Math.max(value, 0), 1);
  }

  get deepColor(): Color {
    return this.uniforms.uDeepColor.value;
  }
  set deepColor(value: Color | string | number) {
    this.uniforms.uDeepColor.value.set(value as Color);
  }

  get shallowColor(): Color {
    return this.uniforms.uShallowColor.value;
  }
  set shallowColor(value: Color | string | number) {
    this.uniforms.uShallowColor.value.set(value as Color);
  }

  get waterOpacity(): number {
    return this.uniforms.uOpacity.value;
  }
  set waterOpacity(value: number) {
    this.uniforms.uOpacity.value = value;
  }

  /** Strength of the large-scale tonal variation (currents / slicks). */
  get tonalVariation(): number {
    return this.uniforms.uTonalVariation.value;
  }
  set tonalVariation(value: number) {
    this.uniforms.uTonalVariation.value = value;
  }

  /**
   * Approximate size of the large-scale tonal variation patches, in kilometers.
   * Larger values give broader, slower-changing current/slick fields; smaller
   * values break the water up into finer patches.
   */
  get tonalScale(): number {
    const freq = this.uniforms.uTonalScale.value;
    return freq > 0 ? 1 / (freq * 1000) : 0;
  }
  set tonalScale(value: number) {
    this.uniforms.uTonalScale.value = value > 0 ? 1 / (value * 1000) : 0;
  }

  /**
   * Crispness of the tonal variation patch boundaries. 0 keeps the soft FBM
   * gradient; higher values (up to 1) narrow the transition band so the
   * currents/slicks read as distinct, well-defined regions.
   */
  get tonalSharpness(): number {
    return this.uniforms.uTonalSharpness.value;
  }
  set tonalSharpness(value: number) {
    this.uniforms.uTonalSharpness.value = value;
  }

  /** Colour the water drifts toward in the tonal variation (current / algae / pollution tint). */
  get tonalColor(): Color {
    return this.uniforms.uTonalColor.value;
  }
  set tonalColor(value: Color | string | number) {
    this.uniforms.uTonalColor.value.set(value as Color);
  }

  get skyColor(): Color {
    return this.uniforms.uSkyColor.value;
  }
  set skyColor(value: Color | string | number) {
    this.uniforms.uSkyColor.value.set(value as Color);
  }

  get horizonColor(): Color {
    return this.uniforms.uHorizonColor.value;
  }
  set horizonColor(value: Color | string | number) {
    this.uniforms.uHorizonColor.value.set(value as Color);
  }

  get reflectionIntensity(): number {
    return this.uniforms.uReflectionIntensity.value;
  }
  set reflectionIntensity(value: number) {
    this.uniforms.uReflectionIntensity.value = value;
  }

  get sunDirection(): Vector3 {
    return this.uniforms.uSunDirection.value;
  }
  set sunDirection(value: Vector3) {
    this.uniforms.uSunDirection.value.copy(value).normalize();
  }

  get sunColor(): Color {
    return this.uniforms.uSunColor.value;
  }
  set sunColor(value: Color | string | number) {
    this.uniforms.uSunColor.value.set(value as Color);
  }

  get sunShininess(): number {
    return this.uniforms.uSunShininess.value;
  }
  set sunShininess(value: number) {
    this.uniforms.uSunShininess.value = value;
  }

  get foamColor(): Color {
    return this.uniforms.uFoamColor.value;
  }
  set foamColor(value: Color | string | number) {
    this.uniforms.uFoamColor.value.set(value as Color);
  }

  get foamAmount(): number {
    return this.uniforms.uFoamAmount.value;
  }
  set foamAmount(value: number) {
    this.uniforms.uFoamAmount.value = value;
  }

  get fresnelPower(): number {
    return this.uniforms.uFresnelPower.value;
  }
  set fresnelPower(value: number) {
    this.uniforms.uFresnelPower.value = value;
  }

  get detailScale(): number {
    return this.uniforms.uDetailScale.value;
  }
  set detailScale(value: number) {
    this.uniforms.uDetailScale.value = value;
  }

  get detailStrength(): number {
    return this.uniforms.uDetailStrength.value;
  }
  set detailStrength(value: number) {
    this.uniforms.uDetailStrength.value = value;
  }

  /** Maximum number of contact footprints this material can render at once. */
  get contactCount(): number {
    return this._contactCount;
  }

  /**
   * Upload the current set of floating-object contact footprints. Excess
   * entries beyond {@link contactCount} are ignored. Cheap: it only copies into
   * the preallocated uniform vectors, so it is safe to call every frame.
   */
  setContacts(contacts: OceanContact[]): void {
    const a = this.uniforms.uContactA.value as Vector4[];
    const b = this.uniforms.uContactB.value as Vector4[];
    const c = this.uniforms.uContactC.value as Vector4[];
    const n = Math.min(contacts.length, this._contactCount);
    for (let i = 0; i < n; i++) {
      const k = contacts[i];
      a[i].set(k.x, k.z, Math.cos(k.heading), Math.sin(k.heading));
      b[i].set(k.halfLength, k.halfWidth, k.foamWidth, k.intensity ?? 1);
      c[i].set(k.endFalloff ?? 0, 0, 0, 0);
    }
    this.uniforms.uContactCount.value = n;
  }

  /** Clear all contact footprints (no contact foam). */
  clearContacts(): void {
    this.uniforms.uContactCount.value = 0;
  }
}
