import {
  Color,
  DoubleSide,
  ShaderMaterial,
  ShaderMaterialParameters,
  Uniform,
  Vector4,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import fragmentShader from './shaders/volume-fragment.glsl';
import vertexShader from './shaders/volume-vertex.glsl';

export type OceanVolumeMaterialParameters = ShaderMaterialParameters & {
  waveCount?: number;
};

/**
 * OIT-compatible water-body (volume) material for the side walls of an ocean
 * box. Shades the walls as a transparent, depth-tinted blue body (a fog-like
 * tint that builds up with view distance), so the interior reads as water both
 * when the camera is inside the box and when looking in from outside. Rendered
 * double-sided so the walls are visible from either side. Shares the surface's
 * deep and shallow colours so the body matches the surface.
 *
 * The wall's top ring follows the same spectral wave displacement as the ocean
 * surface (tapered to zero at the sea bed) so the rim stays sealed when vertex
 * displacement is enabled. Share the surface's wave tables via
 * {@link OceanVolumeMaterial.setWaveTables} so the walls move in lock-step.
 *
 * Wired for the OITRenderPass via {@link attachOitVariants} (variants share this
 * material's `uniforms` by reference, so animated uniforms stay live).
 */
export class OceanVolumeMaterial extends ShaderMaterial {
  isOceanVolumeMaterial = true;

  constructor(parameters: OceanVolumeMaterialParameters = {}) {
    const { waveCount = 16, ...rest } = parameters;

    // Preallocated wave-component tables. Normally replaced by the surface's
    // tables (shared by reference) via setWaveTables(); the placeholders keep
    // the uniform arrays the right length until then.
    const waveA: Vector4[] = [];
    const waveB: Vector4[] = [];
    for (let i = 0; i < waveCount; i++) {
      waveA.push(new Vector4());
      waveB.push(new Vector4());
    }

    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      defines: {
        OCEAN_WAVE_COUNT: waveCount,
        OCEAN_DISPLACE_COUNT: 3,
      },
      uniforms: {
        uTime: new Uniform(0),
        uWaveA: new Uniform(waveA),
        uWaveB: new Uniform(waveB),
        uSteepness: new Uniform(0.7),
        uDisplacement: new Uniform(0),
        uDeepColor: new Uniform(new Color('#0a2540')),
        uShallowColor: new Uniform(new Color('#1b6f8a')),
        uFogDensity: new Uniform(0.004),
        uMaxOpacity: new Uniform(0.9),
        uShimmer: new Uniform(0.04),
        uMasterOpacity: new Uniform(1),
      },
    });

    if (Object.keys(rest).length) this.setValues(rest);

    attachOitVariants(this);
  }

  /**
   * Point this material's wave-component uniform arrays at the surface
   * material's tables (by reference) so the displaced wall top ring tracks the
   * surface waves with no extra per-frame work. The surface mutates those
   * Vector4s in place when the sea state changes, so the walls update for free.
   */
  setWaveTables(waveA: Vector4[], waveB: Vector4[]): void {
    this.uniforms.uWaveA.value = waveA;
    this.uniforms.uWaveB.value = waveB;
  }

  get time(): number {
    return this.uniforms.uTime.value;
  }
  set time(value: number) {
    this.uniforms.uTime.value = value;
  }

  /** Gerstner choppiness applied to the displaced top-ring swells. */
  get steepness(): number {
    return this.uniforms.uSteepness.value;
  }
  set steepness(value: number) {
    this.uniforms.uSteepness.value = value;
  }

  /** Top-ring vertex displacement amount (0 = flat top edge, clamped to [0, 1]). */
  get displacement(): number {
    return this.uniforms.uDisplacement.value;
  }
  set displacement(value: number) {
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

  /** Per-meter tint build-up through the water body. */
  get fogDensity(): number {
    return this.uniforms.uFogDensity.value;
  }
  set fogDensity(value: number) {
    this.uniforms.uFogDensity.value = value;
  }

  /** Densest tint reached far through the water (0..1). */
  get maxOpacity(): number {
    return this.uniforms.uMaxOpacity.value;
  }
  set maxOpacity(value: number) {
    this.uniforms.uMaxOpacity.value = value;
  }

  /** Animated brightness shimmer amount (0 = off). */
  get shimmer(): number {
    return this.uniforms.uShimmer.value;
  }
  set shimmer(value: number) {
    this.uniforms.uShimmer.value = value;
  }

  get masterOpacity(): number {
    return this.uniforms.uMasterOpacity.value;
  }
  set masterOpacity(value: number) {
    this.uniforms.uMasterOpacity.value = value;
  }
}
