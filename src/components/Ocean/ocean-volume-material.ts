import {
  Color,
  DoubleSide,
  IUniform,
  ShaderMaterial,
  ShaderMaterialParameters,
  Uniform,
  Vector2,
  Vector4,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import {
  applyFenceField,
  FenceFieldUniforms,
} from '../../sdk/materials/fence-field';
import { WaterBody } from '../../sdk/materials/water-body';
import { SEA_BREAK_DEPTH } from '../../sdk/weather/sea-shallow';
import { SEA_LAYER_UNIFORMS, type OceanMaterial } from './ocean-material';
import fragmentShader from './shaders/volume-fragment.glsl';
import vertexShader from './shaders/volume-vertex.glsl';

export type OceanVolumeMaterialParameters = ShaderMaterialParameters & {
  waveCount?: number;
  /**
   * Read the wall's unit-relative height from a `wallV` attribute rather than
   * from `uv.y` — for a zone's interval wall, whose uv is metric.
   */
  wallAttribute?: boolean;
  /** see `sectionPlane` in {@link OceanMaterialParameters} */
  sectionPlane?: IUniform<Vector4>;
  /** see `fence` in {@link OceanMaterialParameters} */
  fence?: FenceFieldUniforms;
};

/**
 * Default per-metre tint build-up through the water body.
 *
 * ⭐ Also the default density for the sea as an immersion medium, so the water seen
 * THROUGH a wall and the water the camera is standing in build up at the same rate
 * rather than through two knobs tuned to match.
 */
export const DEFAULT_OCEAN_BODY_FOG_DENSITY = 0.004;

/**
 * OIT-compatible water-body (volume) material for the side walls of an ocean
 * box. Shades the walls as a transparent, depth-tinted body (a fog-like tint that builds up
 * with view distance), so the interior reads as water both when the camera is inside the box
 * and when looking in from outside. Rendered double-sided so the walls are visible from either
 * side. Shares the surface's water (its optics' colour, `linkSea`) so the body matches the
 * surface.
 *
 * The wall's top ring follows the same wave heights as the ocean surface (tapered
 * to zero at the sea bed) so the rim stays sealed when vertex displacement is
 * enabled. Share the surface's sea layers via {@link OceanVolumeMaterial.linkSea}
 * so the walls move in lock-step.
 *
 * Wired for the OITRenderPass via {@link attachOitVariants} (variants share this
 * material's `uniforms` by reference, so animated uniforms stay live).
 */
export class OceanVolumeMaterial extends ShaderMaterial {
  isOceanVolumeMaterial = true;

  constructor(parameters: OceanVolumeMaterialParameters = {}) {
    const {
      // Deprecated: the walls read the surface's sea layers (linkSea).
      waveCount: _waveCount,
      wallAttribute = false,
      sectionPlane,
      fence,
      ...rest
    } = parameters;

    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      defines: {
        SEA_LAYERS: 3,
        ...(wallAttribute ? { OCEAN_WALL_ATTRIBUTE: '' } : {}),
        ...(sectionPlane ? { OCEAN_SECTION: '' } : {}),
        ...(fence ? { OCEAN_FENCE: '' } : {}),
      },
      uniforms: {
        uTime: new Uniform(0),
        // The surface's sea layers, shared by linkSea; none until then.
        uSeaSurface0: new Uniform(null),
        uSeaSurface1: new Uniform(null),
        uSeaSurface2: new Uniform(null),
        uSeaSurface3: new Uniform(null),
        uSeaLayers: new Uniform([new Vector4(), new Vector4(), new Vector4()]),
        uSeaLayerStats: new Uniform([
          new Vector2(),
          new Vector2(),
          new Vector2(),
        ]),
        uSeaResidual: new Uniform(0),
        uSeaHex: new Uniform(new Vector2(1, 1)),
        uSeaBreakDepth: new Uniform(SEA_BREAK_DEPTH),
        uSeaDeepDepth: new Uniform(0),
        uSteepness: new Uniform(1),
        uDisplacement: new Uniform(0),
        uDeepColor: new Uniform(new Color('#0a2540')),
        uShallowColor: new Uniform(new Color('#1b6f8a')),
        uFogDensity: new Uniform(DEFAULT_OCEAN_BODY_FOG_DENSITY),
        uMaxOpacity: new Uniform(0.9),
        uShimmer: new Uniform(0.04),
        uMasterOpacity: new Uniform(1),
      },
    });

    if (Object.keys(rest).length) this.setValues(rest);

    if (sectionPlane) this.uniforms.sectionPlane = sectionPlane;

    if (fence) applyFenceField(this.uniforms, fence);

    // Its own water until it is linked to a surface's (linkSea).
    new WaterBody().bind(this.uniforms);

    attachOitVariants(this);
  }

  /**
   * Read the surface material's sea layers and its water (its uniform objects, by reference)
   * so the displaced wall top ring tracks the surface's waves, and the walls its water's look,
   * with no extra per-frame work.
   */
  linkSea(surface: OceanMaterial): void {
    for (const name of SEA_LAYER_UNIFORMS)
      this.uniforms[name] = surface.uniforms[name];
    surface.water.bind(this.uniforms);
    const layers = surface.seaState.layers.length;
    if (this.defines.SEA_LAYERS !== layers) {
      this.defines.SEA_LAYERS = layers;
      this.needsUpdate = true;
    }
  }

  get time(): number {
    return this.uniforms.uTime.value;
  }
  set time(value: number) {
    this.uniforms.uTime.value = value;
  }

  /** @deprecated the top ring is displaced vertically, by the surface's heights */
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

  /** @deprecated the walls take the water's colour (its optics, `linkSea`); no effect */
  get deepColor(): Color {
    return this.uniforms.uDeepColor.value;
  }
  set deepColor(value: Color | string | number) {
    this.uniforms.uDeepColor.value.set(value as Color);
  }

  /** @deprecated the walls take the water's colour (its optics, `linkSea`); no effect */
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
