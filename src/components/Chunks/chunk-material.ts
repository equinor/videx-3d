import {
  Color,
  ColorRepresentation,
  DoubleSide,
  IUniform,
  Matrix3,
  ShaderLib,
  ShaderMaterial,
  Side,
  Texture,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import { Vec2 } from '../../sdk';
import { ChunkContactTexture } from './chunk-contacts';
import { ChunkDepthMap } from './chunk-depth-map';
import { ChunkDetail, resolveChunkDetail } from './chunk-detail';
import fragmentShader from './shaders/chunk-frag.glsl';
import vertexShader from './shaders/chunk-vert.glsl';

/** Ambient multipliers facing up / facing down. See {@link ChunkMaterialParameters.ambient}. */
export const DEFAULT_CHUNK_AMBIENT: Vec2 = [1.35, 0.5];

/**
 * The shared uniforms a fence cut reads. One set per stack, handed to every
 * material it draws with, so a new wellbore is four writes rather than a rebuild.
 *
 * @group Components
 */
export type ChunkFenceUniforms = {
  /** x: half width, y: which side goes, z: unused, w: +1, or -1 to invert */
  params: IUniform<Vector4>;
  /** x: extra half width at the shallow end, yz: the arc lengths it tapers between */
  taper: IUniform<Vector3>;
  /** signed distance to the curve in R, distance ALONG it in G, both in metres */
  map: IUniform<Texture | null>;
  /** object XZ -> uv */
  toUv: IUniform<Matrix3>;
  /** grid size in texels */
  size: IUniform<Vector2>;
};

/**
 * Tinting of whatever lies under a water level. See
 * {@link ChunkMaterialParameters.waterTint}.
 */
export type ChunkWaterTintParameters = {
  /** the water colour to tint toward */
  color: ColorRepresentation;
  /** the water level, in the stack's own metres (Y up, so a level below datum is negative) */
  level: number;
  /** tint strength deep down (0..1) */
  strength: number;
  /** depth below the level at which the tint reaches ~86% of `strength`, in metres */
  depth: number;
  /**
   * The sea bed's own depth grid. With it the tint is driven by the water column
   * standing over the fragment's MAP location rather than by an interpolated
   * vertex depth, so the gradient follows the bathymetry rather than the
   * tessellation, which at field scale is metres coarse.
   *
   * ⚠️ Where the grid is unmapped the fragment's own depth is used, so omitting it
   * is the same as a grid with no coverage.
   */
  map?: ChunkDepthMap;
  /** depth of the wet band below the waterline, in metres. 0 = off */
  wetBand?: number;
  /** how much that band darkens the ground, 0..1 */
  wetStrength?: number;
};

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
  /**
   * Tint this layer toward a water colour where it lies BELOW a water level, as
   * if seen through the water column. Omit for none, which compiles the branch
   * out.
   *
   * ⭐ Depth-dependent, unlike the flat tint the `Ocean` component's own sea bed
   * uses: a chunk's sea bed can rise THROUGH the water (a coast, an island), and
   * absorption that fades to nothing at the waterline gets that right without
   * anything having to know where the shoreline runs.
   */
  waterTint?: ChunkWaterTintParameters;
  /**
   * Cut this material with a plane: fragments where `dot(xyz, position) + w > 0`
   * are discarded, in the mesh's OWN object space.
   *
   * ⭐ A SHARED uniform object, deliberately — pass the same one to every material
   * of a stack and moving the plane is a single write per frame that reaches all of
   * them, and (because a `ShaderMaterial`'s OIT variants share their `uniforms` by
   * reference) all four OIT passes with them. `material.clippingPlanes` cannot do
   * this: `Material.copy` deep-clones a `Plane`, so each variant would snapshot the
   * plane at build time and a moving one would freeze under `OITRenderPass` while
   * animating under a plain `RenderPass`.
   *
   * ⚠️ Read at CONSTRUCTION, like `detail`: it sets a define, so turning
   * sectioning on or off means a new material. Moving the plane does not.
   */
  sectionPlane?: IUniform<Vector4>;
  /**
   * Cut this material with a vertical **fence** — a surface swept along a curve in
   * plan, typically a wellbore's trajectory. Shares its uniforms for the same
   * reason {@link ChunkMaterialParameters.sectionPlane} does.
   *
   * `params` is (half width in metres, which side goes, unused, +1 or -1 to invert
   * the test); the rest place the signed-distance field in the mesh's OWN object
   * XZ.
   *
   * ⭐ Read PER FRAGMENT, so the cut follows the field rather than this mesh's
   * triangles — which is what lets a face built independently of the tessellation
   * line up with the opening it sits in.
   *
   * ⚠️ Read at CONSTRUCTION, like `sectionPlane`.
   */
  fence?: ChunkFenceUniforms;
  /**
   * Fluid contacts to draw as LINES on this layer, where the geometry's own height
   * crosses the contact's grid.
   *
   * ⭐ One per-fragment test covers every view: on a cap it draws the accumulation
   * outline, on a section face or a wall the horizontal contact line. Nothing is
   * built for it, so a contact can be swapped or swept without rebuilding anything.
   *
   * ⚠️ Read at CONSTRUCTION, like `detail`: the COUNT sets a define. Moving a
   * contact's data means a new texture, but not a new material.
   */
  contacts?: ChunkContactTexture[];
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
      waterTintColor: { value: new Color() },
      // x: water level, y: strength, z: 1 / depth scale
      waterTintParams: { value: new Vector3() },
      // x: 1 / wet band depth, y: darkening amount
      waterTintShore: { value: new Vector2() },
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
 * identity is what makes the OIT pass re-classify). {@link
 * ChunkMaterialParameters.waterTint} is read there too, for the same reason.
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
    this.applyWaterTint(parameters.waterTint);

    // The shader has always carried the fog chunks, but a ShaderMaterial's `fog`
    // defaults to false, so three never defined USE_FOG and they compiled to
    // nothing. On, they let `scene.fog` attenuate a chunk by distance from the
    // camera — which is what makes an underwater view read as underwater.
    this.fog = true;

    if (parameters.sectionPlane) {
      (this.defines as Record<string, unknown>).CHUNK_SECTION = '';
      this.uniforms.sectionPlane = parameters.sectionPlane;
    }

    if (parameters.fence) {
      (this.defines as Record<string, unknown>).CHUNK_FENCE = '';
      this.uniforms.fenceParams = parameters.fence.params;
      this.uniforms.fenceTaper = parameters.fence.taper;
      this.uniforms.fenceMap = parameters.fence.map;
      this.uniforms.fenceToUv = parameters.fence.toUv;
      this.uniforms.fenceSize = parameters.fence.size;
    }

    this.applyContacts(parameters.contacts);

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

  /** Write the water tint into the uniforms and enable the shader's branch for it. */
  private applyWaterTint(tint: ChunkWaterTintParameters | undefined) {
    const defines = this.defines as Record<string, unknown>;
    delete defines.CHUNK_WATER_TINT;
    delete defines.CHUNK_BATHYMETRY;
    if (!tint || tint.strength <= 0) return;

    const u = this.uniforms;
    defines.CHUNK_WATER_TINT = '';
    (u.waterTintColor.value as Color).set(tint.color);
    (u.waterTintParams.value as Vector3).set(
      tint.level,
      tint.strength,
      1 / Math.max(tint.depth, 1e-3),
    );
    (u.waterTintShore.value as Vector2).set(
      1 / Math.max(tint.wetBand ?? 0, 1e-3),
      tint.wetBand ? (tint.wetStrength ?? 0.4) : 0,
    );

    if (tint.map) {
      defines.CHUNK_BATHYMETRY = '';
      // Added rather than cloned from the base: a sampler the shared template does
      // not declare would be uploaded by every material that has no map.
      this.uniforms.bathyMap = { value: tint.map.texture };
      this.uniforms.bathyToUv = { value: tint.map.toUv };
      this.uniforms.bathySize = {
        value: new Vector2(
          tint.map.texture.image.width,
          tint.map.texture.image.height,
        ),
      };
    }
  }

  /** Bind the contact textures and enable the shader's loop over them. */
  private applyContacts(contacts: ChunkContactTexture[] | undefined) {
    const defines = this.defines as Record<string, unknown>;
    delete defines.CHUNK_CONTACTS;
    if (!contacts || contacts.length === 0) return;

    defines.CHUNK_CONTACTS = contacts.length;
    // Added rather than cloned from the base: the arrays are sized by this
    // material's own contact count, which the shared template cannot know.
    this.uniforms.contactMap = { value: contacts.map(c => c.texture) };
    this.uniforms.contactToUv = { value: contacts.map(c => c.toUv) };
    this.uniforms.contactColor = { value: contacts.map(c => c.color) };
    this.uniforms.contactStyle = { value: contacts.map(c => c.style) };
    this.uniforms.contactSize = {
      value: contacts.map(
        c =>
          new Vector4(
            c.texture.image.width,
            c.texture.image.height,
            c.opacity,
            c.maxHalfWidth,
          ),
      ),
    };
  }
}
