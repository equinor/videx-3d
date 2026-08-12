import {
  Color,
  ColorRepresentation,
  DoubleSide,
  ShaderLib,
  ShaderMaterial,
  Side,
  UniformsUtils,
  Vector2,
  Vector4,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import { Vec2 } from '../../sdk';
import { ChunkDetail, resolveChunkDetail } from './chunk-detail';
import fragmentShader from './shaders/chunk-frag.glsl';
import vertexShader from './shaders/chunk-vert.glsl';

/** Ambient multipliers facing up / facing down. See {@link ChunkMaterialParameters.ambient}. */
export const DEFAULT_CHUNK_AMBIENT: Vec2 = [1.35, 0.5];

/** {@link ChunkMaterial} parameters. */
export type ChunkMaterialParameters = {
  color?: ColorRepresentation;
  opacity?: number;
  transparent?: boolean;
  depthWrite?: boolean;
  wireframe?: boolean;
  side?: Side;
  /** specular highlight colour. Default a dark grey — rock is not glossy. */
  specular?: ColorRepresentation;
  /** specular exponent. Default 24 (broad and soft). */
  shininess?: number;
  /**
   * Orientation-dependent ambient as `[facingUp, facingDown]` multipliers, or `false`
   * for none. Default `[1.35, 0.5]`.
   *
   * ⭐ Stands in for an environment map: three routes `scene.environment` to
   * standard/physical materials only, so a library `ShaderMaterial` receives its ambient
   * as ONE FLAT TERM and every face turned away from the sun is lit identically — which
   * is what makes an unlit side read as a blank silhouette and hides all relief on it.
   * This redistributes the same irradiance instead of adding energy, so it restores the
   * shape without an env map's colour bleed, and it does not depend on the host scene
   * having an environment at all.
   */
  ambient?: Vec2 | false;
  /**
   * Procedural surface relief for this layer. Omit for none, which compiles the
   * whole branch out.
   */
  detail?: ChunkDetail;
  /**
   * The mesh is a chunk WALL, i.e. it carries the `wallV` attribute. Lets the
   * detail anchor bedding to the unit rather than to absolute depth.
   */
  wall?: boolean;
};

const shader = {
  uniforms: UniformsUtils.merge([
    UniformsUtils.clone(ShaderLib['phong'].uniforms),
    {
      detailStrength: { value: 1 },
      detailShade: { value: new Vector2() },
      detailGranular: { value: new Vector4() },
      detailGrain: { value: new Vector4() },
      detailGrainB: { value: new Vector4() },
      detailDunes: { value: new Vector4() },
      chunkAmbient: { value: new Vector2(1.35, 0.5) },
    },
  ]),
  vertexShader,
  fragmentShader,
};

/**
 * The material a `Chunk`'s caps and walls are drawn with.
 *
 * Blinn-Phong (a little specular makes the procedural relief read; pure diffuse
 * flattens it) with one addition: texture-free procedural detail from
 * `shaderLib/procedural-normal.glsl`, selected by a {@link ChunkDetail} preset and
 * OFF by default.
 *
 * ⭐ The detail is anchored in WORLD space, not in the geometry's UVs. A chunk cap
 * carries a per-layer GRID uv (that is what lets `SurfaceMaterial` be used as a cap
 * material) and a wall carries a metric one, so neither is a frame a pattern could
 * be shared across — and a texture would need a repeat/scale chosen per surface,
 * which is the thing this replaces. World anchoring also means a cap and the wall
 * below it meet with the pattern continuous, and that a vertical exaggeration does
 * not stretch it.
 *
 * ⚠️ `detail` and `wall` are read at CONSTRUCTION: they set shader defines, so
 * changing them means a new material. That is how the appearance layer already
 * works (`ChunkMeshes` rebuilds its materials on any appearance change, and a fresh
 * identity is what makes the OIT pass re-classify).
 *
 * @group Components
 */
export class ChunkMaterial extends ShaderMaterial {
  isChunkMaterial = true;

  constructor(parameters: ChunkMaterialParameters = {}) {
    super();

    this.uniforms = UniformsUtils.clone(shader.uniforms);
    this.vertexShader = shader.vertexShader;
    this.fragmentShader = shader.fragmentShader;
    this.lights = true;
    this.clipping = true;
    this.fog = true;
    this.side = parameters.side ?? DoubleSide;
    this.wireframe = parameters.wireframe ?? false;
    this.transparent = parameters.transparent ?? false;
    this.depthWrite = parameters.depthWrite ?? true;
    // The pipeline tone-maps once, in the OutputPass.
    this.toneMapped = false;
    this.defines = {};

    const u = this.uniforms;
    u.diffuse.value = new Color(parameters.color ?? '#ffffff');
    u.specular.value = new Color(parameters.specular ?? '#1a1a1a');
    u.shininess.value = parameters.shininess ?? 24;
    u.opacity.value = parameters.opacity ?? 1;

    const ambient = parameters.ambient ?? DEFAULT_CHUNK_AMBIENT;
    if (ambient) {
      (this.defines as Record<string, unknown>).CHUNK_AMBIENT = '';
      (u.chunkAmbient.value as Vector2).set(ambient[0], ambient[1]);
    }

    // `opacity` is what the OIT pass routes on, so the Material property and the
    // uniform must never disagree.
    Object.defineProperty(this, 'opacity', {
      get: () => u.opacity.value as number,
      set: (value: number) => {
        u.opacity.value = value;
      },
    });
    Object.defineProperty(this, 'color', {
      get: () => u.diffuse.value as Color,
      set: (value: ColorRepresentation) => {
        (u.diffuse.value as Color).set(value);
      },
    });

    this.applyDetail(parameters.detail, parameters.wall === true);

    attachOitVariants(this);
  }

  /** Write a preset into the uniforms and enable the shader's branches for it. */
  private applyDetail(detail: ChunkDetail | undefined, wall: boolean) {
    const resolved = resolveChunkDetail(detail);
    const defines = this.defines as Record<string, unknown>;
    delete defines.CHUNK_DETAIL;
    delete defines.CHUNK_DETAIL_GRANULAR;
    delete defines.CHUNK_DETAIL_GRAIN;
    delete defines.CHUNK_DETAIL_DUNES;
    delete defines.CHUNK_WALL;
    if (!resolved) return;

    const { params, strength } = resolved;
    const u = this.uniforms;
    defines.CHUNK_DETAIL = '';
    if (wall) defines.CHUNK_WALL = '';
    u.detailStrength.value = strength;
    (u.detailShade.value as Vector2).set(params.albedo, params.height);

    if (params.granular) {
      const g = params.granular;
      defines.CHUNK_DETAIL_GRANULAR = '';
      (u.detailGranular.value as Vector4).set(
        g.strength,
        g.frequency,
        g.octaves,
        g.anisotropy ?? 0,
      );
    }
    if (params.grain) {
      const g = params.grain;
      defines.CHUNK_DETAIL_GRAIN = '';
      (u.detailGrain.value as Vector4).set(
        g.strength,
        g.frequency,
        g.angle,
        g.sharpness,
      );
      (u.detailGrainB.value as Vector4).set(
        g.uniformity,
        g.octaves,
        wall ? (g.bedding ?? 0) : 0,
        g.laminae ?? 1,
      );
    }
    if (params.dunes) {
      const d = params.dunes;
      defines.CHUNK_DETAIL_DUNES = '';
      const [dx, dz] = d.direction ?? [1, 0];
      (u.detailDunes.value as Vector4).set(d.strength, d.wavelength, dx, dz);
    }
  }
}
