import {
  Color,
  DoubleSide,
  ShaderMaterial,
  ShaderMaterialParameters,
  Uniform,
  Vector2,
  Vector3,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import fragmentShader from './shaders/bed-fragment.glsl';
import vertexShader from './shaders/bed-vertex.glsl';

export type OceanBedMaterialParameters = ShaderMaterialParameters;

/**
 * OIT-compatible sea-bed material for the bottom face of an ocean box. Applies
 * simple sun-direction diffuse shading so the procedural bed relief is visible,
 * tints the water-facing (top) side toward the water colour, and keeps the
 * underside a light sandy/yellowish colour. Rendered double-sided.
 *
 * At opacity 1 the OITRenderPass routes it through the opaque pass (writing
 * depth), so it occludes geometry below it; lower opacity keeps it in the
 * transparency passes so subsurface geometry shows through. Because the material
 * has no `opacity` uniform, callers must mirror the alpha onto `material.opacity`
 * to drive that routing.
 *
 * Wired for the OITRenderPass via {@link attachOitVariants} (variants share this
 * material's `uniforms` by reference, so animated uniforms stay live).
 */
export class OceanBedMaterial extends ShaderMaterial {
  isOceanBedMaterial = true;

  constructor(parameters: OceanBedMaterialParameters = {}) {
    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: DoubleSide,
      uniforms: {
        uColor: new Uniform(new Color('#b8a06a')),
        uWaterColor: new Uniform(new Color('#0a2540')),
        uWaterTint: new Uniform(0.6),
        uSunDirection: new Uniform(new Vector3(-0.3, 0.8, -0.5).normalize()),
        uSunColor: new Uniform(new Color('#fff6e0')),
        uAmbient: new Uniform(0.45),
        uOpacity: new Uniform(1),
        uMasterOpacity: new Uniform(1),
        // Subtle procedural sand-dune relief (footprint anti-aliased in the
        // shader, so it fades to flat far out and only resolves up close).
        uDuneStrength: new Uniform(0.15),
        uDuneWavelength: new Uniform(180),
        uDuneDirection: new Uniform(new Vector2(1, 0.6).normalize()),
        uDuneSharpness: new Uniform(0),
      },
    });

    if (Object.keys(parameters).length) this.setValues(parameters);

    attachOitVariants(this);
  }

  get color(): Color {
    return this.uniforms.uColor.value;
  }
  set color(value: Color | string | number) {
    this.uniforms.uColor.value.set(value as Color);
  }

  get waterColor(): Color {
    return this.uniforms.uWaterColor.value;
  }
  set waterColor(value: Color | string | number) {
    this.uniforms.uWaterColor.value.set(value as Color);
  }

  /** Strength of the water tint on the water-facing side (0..1). */
  get waterTint(): number {
    return this.uniforms.uWaterTint.value;
  }
  set waterTint(value: number) {
    this.uniforms.uWaterTint.value = value;
  }

  get sunDirection(): Vector3 {
    return this.uniforms.uSunDirection.value;
  }
  set sunDirection(value: Vector3) {
    this.uniforms.uSunDirection.value.copy(value);
  }

  get sunColor(): Color {
    return this.uniforms.uSunColor.value;
  }
  set sunColor(value: Color | string | number) {
    this.uniforms.uSunColor.value.set(value as Color);
  }

  /** Ambient light floor (0..1). */
  get ambient(): number {
    return this.uniforms.uAmbient.value;
  }
  set ambient(value: number) {
    this.uniforms.uAmbient.value = value;
  }

  /** Bed opacity (also mirror onto `material.opacity` for OIT routing). */
  get bedOpacity(): number {
    return this.uniforms.uOpacity.value;
  }
  set bedOpacity(value: number) {
    this.uniforms.uOpacity.value = value;
  }

  get masterOpacity(): number {
    return this.uniforms.uMasterOpacity.value;
  }
  set masterOpacity(value: number) {
    this.uniforms.uMasterOpacity.value = value;
  }

  /**
   * Sand-dune relief strength (0 = off). Perturbs the shading normal by the
   * analytic slope of a procedural, footprint-anti-aliased dune height field, so
   * the bed reads with subtle relief up close and fades to flat far out.
   */
  get duneStrength(): number {
    return this.uniforms.uDuneStrength.value;
  }
  set duneStrength(value: number) {
    this.uniforms.uDuneStrength.value = value;
  }

  /** Base dune crest spacing in meters. */
  get duneWavelength(): number {
    return this.uniforms.uDuneWavelength.value;
  }
  set duneWavelength(value: number) {
    this.uniforms.uDuneWavelength.value = Math.max(value, 1);
  }

  /** Dune ridge propagation direction in world X/Z. */
  get duneDirection(): Vector2 {
    return this.uniforms.uDuneDirection.value;
  }
  set duneDirection(value: Vector2) {
    this.uniforms.uDuneDirection.value.copy(value);
  }

  /**
   * Extra crest/trough albedo banding (0 = off). Lightens the dune crests and
   * darkens the troughs on top of the normal-based shading for a stronger sense
   * of relief; follows the same footprint fade so it also vanishes far out.
   */
  get duneSharpness(): number {
    return this.uniforms.uDuneSharpness.value;
  }
  set duneSharpness(value: number) {
    this.uniforms.uDuneSharpness.value = value;
  }
}
