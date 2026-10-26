import {
  ClampToEdgeWrapping,
  Color,
  ColorRepresentation,
  DataTexture,
  DoubleSide,
  HalfFloatType,
  IUniform,
  LinearFilter,
  Material,
  Matrix3,
  NearestFilter,
  RedFormat,
  RGFormat,
  ShaderLib,
  ShaderMaterial,
  Side,
  Texture,
  UniformsUtils,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import { StackCapNormalMap, StackTiling, Vec2 } from '../../sdk';
import {
  applyFenceField,
  FenceFieldUniforms,
} from '../../sdk/materials/fence-field';
import {
  applyHeightFieldClip,
  HeightFieldClipUniforms,
} from '../../sdk/materials/height-field-clip';
import {
  applySurfaceDetail,
  createSurfaceDetailUniforms,
  SurfaceDetailUniforms,
} from '../../sdk/materials/surface-detail';
import { ChunkContactTexture } from './chunk-contacts';
import { ChunkDepthMap } from './chunk-depth-map';
import { ChunkDetail } from './chunk-detail';
import { attachChunkPicking } from './chunk-picking-material';
import fragmentShader from './shaders/chunk-frag.glsl';
import vertexShader from './shaders/chunk-vert.glsl';

/** Ambient multipliers facing up / facing down. See {@link ChunkMaterialParameters.ambient}. */
export const DEFAULT_CHUNK_AMBIENT: Vec2 = [1.35, 0.5];

/**
 * The shared uniforms the tile diagnostic reads: where a chunk's tiles are, and
 * one value per tile (`values`, red channel, 0..1 — meant for a LOD level).
 *
 * @group Components
 */
export type ChunkTileUniforms = {
  toGrid: IUniform<Matrix3>;
  /** x: cells per tile, yz: the first tile */
  layout: IUniform<Vector3>;
  values: IUniform<DataTexture>;
  /** 1: colour each tile by its value; 0: a checker, which shows the tiling */
  byValue: IUniform<number>;
};

/**
 * {@link ChunkTileUniforms} for a chunk's tiling, every tile's value 0. The
 * caller owns `values.value` and disposes it.
 *
 * @group Components
 */
export function createTileUniforms(tiling: StackTiling): ChunkTileUniforms {
  const [a, b, c, d, e, f] = tiling.toGrid;
  const [width, height] = tiling.count;
  const values = new DataTexture(
    new Uint8Array(width * height),
    width,
    height,
    RedFormat,
    UnsignedByteType,
  );
  values.magFilter = NearestFilter;
  values.minFilter = NearestFilter;
  values.needsUpdate = true;
  return {
    toGrid: { value: new Matrix3().set(a, b, c, d, e, f, 0, 0, 1) },
    layout: {
      value: new Vector3(tiling.cells, tiling.first[0], tiling.first[1]),
    },
    values: { value: values },
    byValue: { value: 0 },
  };
}

/**
 * A cap's {@link StackCapNormalMap} as a texture, and the object XZ to uv
 * transform to read it with (see {@link bindChunkNormalMap}). The caller disposes
 * the texture.
 *
 * @group Components
 */
export function createCapNormalTexture(map: StackCapNormalMap): {
  texture: DataTexture;
  toUv: Matrix3;
} {
  const texture = new DataTexture(
    map.data,
    map.width,
    map.height,
    RGFormat,
    HalfFloatType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const [a, b, c, d, e, f] = map.toUv;
  return { texture, toUv: new Matrix3().set(a, b, c, d, e, f, 0, 0, 1) };
}

/**
 * Point a {@link ChunkMaterial} at a cap's normal map for the draw about to
 * happen, or off it with `null`. Read only where the tile is drawn coarser than
 * the full level (see `ChunkMaterialParameters.tileLevels`); elsewhere the cap
 * shades from its `normal` attribute. Meant for `Object3D.onBeforeRender`, which
 * hands over the material actually drawn (an OIT variant included); anything else
 * is left alone.
 *
 * ⚠️ Per draw rather than per material: one material can draw caps with different
 * maps, and three re-uploads uniforms only when the material changes between draws.
 *
 * @group Components
 */
export function bindChunkNormalMap(
  material: Material,
  texture: Texture | null,
  toUv: Matrix3 | null,
): void {
  const u = (material as ShaderMaterial).uniforms;
  if (!u?.capNormalOn) return;
  u.capNormalMap.value = texture;
  if (toUv) (u.capNormalToUv.value as Matrix3).copy(toUv);
  u.capNormalOn.value = texture ? 1 : 0;
  (material as ShaderMaterial).uniformsNeedUpdate = true;
}

/**
 * The shared uniforms a fence cut reads. One set per stack, handed to every
 * material it draws with, so a new wellbore is four writes rather than a rebuild.
 *
 * @group Components
 */
export type ChunkFenceUniforms = FenceFieldUniforms;

/**
 * The per-side values {@link ChunkFenceUniforms} is filled from.
 *
 * ⚠️ Every field here has to reach the uniform of the same name — `texture` into `map`, the
 * rest one-to-one. See {@link applyFenceSide}.
 */
export type ChunkFenceSideValues = {
  texture: Texture;
  toUv: Matrix3;
  size: Vector2;
  cells: Texture;
  segments: Texture;
  index: Vector4;
  indexSize: Vector2;
  pages: Vector4;
  segmentsSize: Vector2;
};

/**
 * The shared uniform objects for one stack's fence, at their neutral values.
 *
 * ⭐ Every material of every chunk is handed THESE OBJECTS, so a side swap is a write into
 * them rather than a material rebuild. `params` is passed in because the block and its
 * inverse share everything except that one vector.
 */
export function createFenceUniforms(
  params: IUniform<Vector2>,
): ChunkFenceUniforms {
  return {
    params,
    map: { value: null },
    toUv: { value: new Matrix3() },
    size: { value: new Vector2(1, 1) },
    cells: { value: null },
    segments: { value: null },
    index: { value: new Vector4(0, 0, 1, 1) },
    indexSize: { value: new Vector2(1, 1) },
    pages: { value: new Vector4(0, 0, 1, 1) },
    segmentsSize: { value: new Vector2(1, 1) },
  };
}

/**
 * Copy one resolved side into the shared uniforms. This IS the side swap.
 *
 * ⚠️⚠️ EVERY field of {@link ChunkFenceSideValues} must be copied here. A field that is
 * declared, typed and assigned everywhere else but missed HERE keeps its neutral value
 * silently: `pages` was once left behind, so `fencePages.xy` stayed 0, the shader's page-bounds
 * test failed for every fragment and the whole cut fell back to the coarse flood fill — a
 * boundary quantised to the field cell, which reads as a staircase that scales with ZOOM rather
 * than with pixels. Nothing typechecks this, so `tests/fence-uniforms.test.ts` asserts it.
 */
export function applyFenceSide(
  uniforms: ChunkFenceUniforms,
  side: ChunkFenceSideValues | null,
) {
  uniforms.map.value = side?.texture ?? null;
  uniforms.cells.value = side?.cells ?? null;
  uniforms.segments.value = side?.segments ?? null;
  if (!side) return;
  uniforms.toUv.value.copy(side.toUv);
  uniforms.size.value.copy(side.size);
  uniforms.index.value.copy(side.index);
  uniforms.indexSize.value.copy(side.indexSize);
  uniforms.pages.value.copy(side.pages);
  uniforms.segmentsSize.value.copy(side.segmentsSize);
}

/**
 * The shared uniforms a fence face's overlay reads (see `ChunkFenceOverlay`). One set per stack,
 * so a new side, palette or mix is a write into them rather than a material rebuild.
 *
 * @group Components
 */
export type ChunkFenceOverlayUniforms = {
  /** the shown side's values, in `.r` */
  values: IUniform<Texture | null>;
  /** x, y: face `uv.x` at the values' u = 0 and u = 1 edges; z, w: scene Y at v = 0 and v = 1 */
  rect: IUniform<Vector4>;
  /** 1-row colour lookup */
  palette: IUniform<Texture | null>;
  /**
   * x, y: the values at the palette's ends; z: mix, 0 while there is nothing to show;
   * w: shading — 0 flat, 1 lit, 2 facing
   */
  params: IUniform<Vector4>;
};

/** The shared fence overlay uniforms, showing nothing. @group Components */
export function createFenceOverlayUniforms(): ChunkFenceOverlayUniforms {
  return {
    values: { value: null },
    rect: { value: new Vector4(0, 1, 0, 1) },
    palette: { value: null },
    params: { value: new Vector4(0, 1, 0, 1) },
  };
}

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
  /** a SHARED 1 while the water is drawn and 0 while not, which the tint is scaled by: hiding it is a write, not a rebuild */
  shown?: IUniform<number>;
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
  /**
   * Mix an overlay into a fence's cut FACE, read by the face's `uv.x` (metres along the cut) and
   * its height. Only meaningful on a fence face.
   *
   * ⚠️ Read at CONSTRUCTION, like `fence`.
   */
  fenceOverlay?: ChunkFenceOverlayUniforms;
  /**
   * Draw the overlay ALONE — at full strength, and nothing where it has no data. For a
   * face across an unfilled interval, which has no formation to fall back on. Needs
   * `fenceOverlay`. ⚠️ Read at CONSTRUCTION.
   */
  fenceOverlayOnly?: boolean;
  /**
   * Saturation of the lit colour: 1 (default) as lit, 0 grey. ⭐ SHARED like
   * `sectionPlane`, so one write reaches every material given the same object —
   * and a uniform, so it shares the shader program with every other value.
   */
  saturation?: IUniform<number>;
  /**
   * Tint by tessellation tile, with the seams drawn: a diagnostic for tiling and
   * LOD. SHARED like `sectionPlane`. ⚠️ Read at CONSTRUCTION.
   */
  tiles?: ChunkTileUniforms;
  /**
   * Each tile's level of detail (`values`, 0 = full): a cap reads its normal map
   * only on a tile drawn coarser (see {@link bindChunkNormalMap}). Without it, a
   * bound map is read everywhere. SHARED like `sectionPlane`. ⚠️ Read at
   * CONSTRUCTION.
   */
  tileLevels?: ChunkTileUniforms;
  /**
   * Leave out what lies above the ground drawn over the stack — the relief a
   * `SkyBoxStage` draws, through `ChunkStackProps.clip` — per fragment, in the mesh's
   * OWN object space. SHARED like `sectionPlane`: one binding for every material, which
   * follows the clip as it is drawn. ⚠️ Read at CONSTRUCTION.
   */
  heightClip?: HeightFieldClipUniforms;
};

const shader = {
  uniforms: UniformsUtils.merge([
    UniformsUtils.clone(ShaderLib['phong'].uniforms),
    {
      ...createSurfaceDetailUniforms(),
      chunkAmbient: { value: new Vector2(1.35, 0.5) },
      chunkSaturation: { value: 1 },
      waterTintColor: { value: new Color() },
      // x: water level, y: strength, z: 1 / depth scale
      waterTintParams: { value: new Vector3() },
      // x: 1 / wet band depth, y: darkening amount
      waterTintShore: { value: new Vector2() },
      waterTintShown: { value: 1 },
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
 * ⭐ The detail is anchored in WORLD space, not in the geometry's UVs. A cap has no
 * uv of its own (its position is a shared `xz` plus a per-layer `y`) and a wall's is
 * metric, so neither is a frame a pattern could be shared across — and a texture
 * would need a repeat/scale chosen per surface, which is the thing this replaces.
 * World anchoring also means a cap and the wall below it meet with the pattern
 * continuous, and that a vertical exaggeration does not stretch it.
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
    // Caps carry a shared `xz` + per-layer `y` (no `position`); walls and cut faces
    // carry `position`. The absent attribute defaults to 0, so the vertex shader's
    // `position + vec3(xz.x, y, xz.y)` resolves both without a separate variant.
    (
      this as unknown as { defaultAttributeValues: Record<string, number[]> }
    ).defaultAttributeValues = { position: [0, 0, 0], xz: [0, 0], y: [0] };

    const u = this.uniforms;
    u.diffuse.value = new Color(parameters.color ?? '#ffffff');
    u.specular.value = new Color(parameters.specular ?? '#1a1a1a');
    u.shininess.value = parameters.shininess ?? 24;
    u.opacity.value = parameters.opacity ?? 1;
    if (parameters.saturation) u.chunkSaturation = parameters.saturation;

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

    // A cap's tiles drawn coarser than the full level may shade from its normal
    // map, bound per draw (see `bindChunkNormalMap`).
    if (!parameters.wall) {
      (this.defines as Record<string, unknown>).CHUNK_NORMAL_MAP = '';
      u.capNormalMap = { value: null };
      u.capNormalToUv = { value: new Matrix3() };
      u.capNormalOn = { value: 0 };
      if (parameters.tileLevels) {
        (this.defines as Record<string, unknown>).CHUNK_TILE_LEVELS = '';
      }
    }

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
      applyFenceField(this.uniforms, parameters.fence);
    }

    if (parameters.fenceOverlay) {
      (this.defines as Record<string, unknown>).CHUNK_FENCE_OVERLAY = '';
      this.uniforms.overlayValues = parameters.fenceOverlay.values;
      this.uniforms.overlayRect = parameters.fenceOverlay.rect;
      this.uniforms.overlayPalette = parameters.fenceOverlay.palette;
      this.uniforms.overlayParams = parameters.fenceOverlay.params;
      if (parameters.fenceOverlayOnly) {
        (this.defines as Record<string, unknown>).CHUNK_FENCE_OVERLAY_ONLY = '';
      }
    }

    this.applyContacts(parameters.contacts);

    if (parameters.tiles) {
      (this.defines as Record<string, unknown>).CHUNK_TILE_DEBUG = '';
      this.uniforms.tileByValue = parameters.tiles.byValue;
    }
    const tiles = parameters.tiles ?? parameters.tileLevels;
    if (tiles) {
      this.uniforms.tileToGrid = tiles.toGrid;
      this.uniforms.tileLayout = tiles.layout;
      this.uniforms.tileValues = tiles.values;
    }

    if (parameters.heightClip) {
      (this.defines as Record<string, unknown>).CHUNK_HEIGHT_CLIP = '';
      applyHeightFieldClip(this.uniforms, parameters.heightClip);
    }

    attachChunkPicking(this, {
      sectionPlane: parameters.sectionPlane,
      fence: parameters.fence,
      overlayOnly: parameters.fenceOverlayOnly
        ? parameters.fenceOverlay
        : undefined,
      heightClip: parameters.heightClip,
    });
    attachOitVariants(this);
  }

  /** Write a preset into the uniforms and enable the shader's branches for it. */
  private applyDetail(detail: ChunkDetail | undefined, wall: boolean) {
    const defines = this.defines as Record<string, unknown>;
    const on = applySurfaceDetail(
      this.uniforms as unknown as SurfaceDetailUniforms,
      defines,
      detail,
      wall,
    );
    // A wall carries `wallV`, which the bedding reads.
    if (on && wall) defines.CHUNK_WALL = '';
    else delete defines.CHUNK_WALL;
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
    if (tint.shown) u.waterTintShown = tint.shown;

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
