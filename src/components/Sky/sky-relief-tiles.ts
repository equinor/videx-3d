import {
  BufferAttribute,
  Color,
  ColorRepresentation,
  DataArrayTexture,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  IUniform,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  RGFormat,
  ShaderMaterial,
  Uniform,
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three';
import {
  buildHeightFieldIndex,
  HeightFieldIndex,
  heightFieldIndexAt,
  heightFieldPatchAt,
  HeightFieldTile,
} from '../../sdk/geometries/height-field-clip';
import type { PolygonDistanceField } from '../../sdk/geometries/polygon-distance-field';
import type { ReliefTile } from '../../sdk/geometries/relief-tiles';
import { applyFenceField, CutUniforms } from '../../sdk/materials/fence-field';
import type {
  HeightFieldClip,
  HeightFieldClipUniforms,
} from '../../sdk/materials/height-field-clip';
import { TILE_ROOT_SIZE } from '../../sdk/tiles/tile-keys';
import { attachOitVariants } from '../../rendering/oit-material';
import fragmentShader from './shaders/relief-fragment.glsl';
import vertexShader from './shaders/relief-tiles-vertex.glsl';
import type { SkyMaterial } from './sky-material';
import { skyOceanDefines } from './sky-stage';

/** The most relief tiles drawn at once. */
export const SKY_RELIEF_MAX_TILES = 2048;

/**
 * The patch every relief tile is drawn with: `cells` x `cells` cells over node
 * coordinates 0…`cells` in X/Z, facing up, and a skirt down from each side (its lower
 * edge marked by `reliefSkirt`), facing out. Instanced by a `reliefTile` (min X/Z, width,
 * slot) and a `reliefTileSkirt` (how far its skirt drops) per tile. Its triangles'
 * diagonals run from node (i + 1, j) to (i, j + 1), as `buildReliefTile` measures a
 * tile's error.
 */
export function createSkyReliefTilePatch(
  cells: number,
  maxTiles = SKY_RELIEF_MAX_TILES,
): InstancedBufferGeometry {
  const n = cells + 1;
  // The grid, then each side's nodes again as its skirt's lower edge.
  const ring: [number, number][] = [];
  for (let i = 0; i < cells; i++) ring.push([i, 0]);
  for (let j = 0; j < cells; j++) ring.push([cells, j]);
  for (let i = cells; i > 0; i--) ring.push([i, cells]);
  for (let j = cells; j > 0; j--) ring.push([0, j]);
  const count = n * n + ring.length;
  const positions = new Float32Array(count * 3);
  const skirt = new Float32Array(count);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      positions[3 * (j * n + i)] = i;
      positions[3 * (j * n + i) + 2] = j;
    }
  }
  ring.forEach(([i, j], k) => {
    const at = n * n + k;
    positions[3 * at] = i;
    positions[3 * at + 2] = j;
    skirt[at] = 1;
  });
  const indices: number[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  for (let k = 0; k < ring.length; k++) {
    const [i0, j0] = ring[k];
    const [i1, j1] = ring[(k + 1) % ring.length];
    const top0 = j0 * n + i0;
    const top1 = j1 * n + i1;
    const low0 = n * n + k;
    const low1 = n * n + ((k + 1) % ring.length);
    // Facing out: a crack shows the farther tile's skirt from outside.
    indices.push(top0, top1, low0, top1, low1, low0);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('reliefSkirt', new BufferAttribute(skirt, 1));
  geometry.setIndex(indices);
  const tiles = new InstancedBufferAttribute(new Float32Array(4 * maxTiles), 4);
  tiles.setUsage(DynamicDrawUsage);
  geometry.setAttribute('reliefTile', tiles);
  const skirts = new InstancedBufferAttribute(new Float32Array(maxTiles), 1);
  skirts.setUsage(DynamicDrawUsage);
  geometry.setAttribute('reliefTileSkirt', skirts);
  geometry.instanceCount = 0;
  return geometry;
}

/**
 * The relief tiles in: their heights (32-bit floats, read by `texelFetch`), normals
 * (X and Z as half floats, filtered) and which layer gave each node (8 bits, for the debug
 * view), one layer of each per slot.
 */
export class SkyReliefTileTextures {
  readonly nodes: number;
  readonly slots: number;
  readonly heights: DataArrayTexture;
  readonly normals: DataArrayTexture;
  /** per node, 1 + the layer that gave most of it, or 0 for the base: for the debug view */
  readonly layers: DataArrayTexture;
  private free: number[] = [];

  constructor(cells: number, slots: number) {
    this.nodes = cells + 3;
    this.slots = slots;
    const area = this.nodes * this.nodes;
    this.heights = new DataArrayTexture(
      new Float32Array(area * slots),
      this.nodes,
      this.nodes,
      slots,
    );
    this.heights.format = RedFormat;
    this.heights.type = FloatType;
    this.heights.minFilter = NearestFilter;
    this.heights.magFilter = NearestFilter;
    this.heights.generateMipmaps = false;
    this.heights.needsUpdate = true;
    this.normals = new DataArrayTexture(
      new Uint16Array(area * 2 * slots),
      this.nodes,
      this.nodes,
      slots,
    );
    this.normals.format = RGFormat;
    this.normals.type = HalfFloatType;
    this.normals.minFilter = LinearFilter;
    this.normals.magFilter = LinearFilter;
    this.normals.generateMipmaps = false;
    this.normals.needsUpdate = true;
    this.layers = new DataArrayTexture(
      new Uint8Array(area * slots),
      this.nodes,
      this.nodes,
      slots,
    );
    this.layers.format = RedFormat;
    this.layers.type = UnsignedByteType;
    this.layers.minFilter = NearestFilter;
    this.layers.magFilter = NearestFilter;
    this.layers.generateMipmaps = false;
    this.layers.unpackAlignment = 1;
    this.layers.needsUpdate = true;
    for (let slot = slots - 1; slot >= 0; slot--) this.free.push(slot);
  }

  /** A slot holding `tile`, or -1 when every slot is taken. */
  put(tile: ReliefTile): number {
    const slot = this.free.pop();
    if (slot === undefined) return -1;
    const area = this.nodes * this.nodes;
    (this.heights.image.data as Float32Array).set(tile.heights, slot * area);
    (this.normals.image.data as Uint16Array).set(tile.normals, slot * area * 2);
    (this.layers.image.data as Uint8Array).set(tile.layers, slot * area);
    for (const texture of [this.heights, this.normals, this.layers]) {
      texture.addLayerUpdate(slot);
      texture.needsUpdate = true;
    }
    return slot;
  }

  release(slot: number) {
    if (slot >= 0) this.free.push(slot);
  }

  get used() {
    return this.slots - this.free.length;
  }

  dispose() {
    this.heights.dispose();
    this.normals.dispose();
    this.layers.dispose();
  }
}

/** A relief tile drawn over a region, with its square and slot. */
export type SkyReliefTileGroundTile = {
  square: HeightFieldTile;
  tile: ReliefTile;
};

/**
 * The ground a stage's relief tiles draw over a region, handed out as a
 * `HeightFieldClip`: an index of the tiles there over the tiles' own heights texture.
 * `set` it when the tiles there change; it is live while `live` is set and it has tiles.
 */
export class SkyReliefTileGround implements HeightFieldClip {
  readonly uniforms: HeightFieldClipUniforms;
  margin = 0;
  private readonly textures: SkyReliefTileTextures;
  private readonly cells: number;
  private index: HeightFieldIndex | null = null;
  private live = false;

  constructor(textures: SkyReliefTileTextures, cells: number) {
    this.textures = textures;
    this.cells = cells;
    this.uniforms = {
      heightClipTiles: { value: textures.heights },
      heightClipIndex: { value: null },
      heightClipRegion: { value: new Vector4() },
      heightClipParams: { value: new Vector4(0, 0, 0, cells) },
    };
  }

  /**
   * Index `tiles` over `region` (min X, min Z, max X, max Z), the drawn ones first; where
   * none is, `fill`'s at a point. Heights are measured from `level`.
   */
  set(
    tiles: SkyReliefTileGroundTile[],
    region: [number, number, number, number],
    level: number,
    fill?: (x: number, z: number) => SkyReliefTileGroundTile | undefined,
  ) {
    let margin = 0;
    let lowest = Infinity;
    const take = ({ square, tile }: SkyReliefTileGroundTile) => {
      margin = Math.max(margin, tile.error);
      lowest = Math.min(lowest, tile.min);
      return square;
    };
    const index = buildHeightFieldIndex(
      tiles.map(take),
      region,
      fill &&
        ((x, z) => {
          const found = fill(x, z);
          return found ? take(found) : undefined;
        }),
    );
    this.index = index;
    this.margin = margin;
    const params = this.uniforms.heightClipParams.value;
    if (!index) {
      params.x = 0;
      return;
    }
    const [nx, nz] = index.size;
    let texture = this.uniforms.heightClipIndex.value as DataTexture | null;
    if (!texture || texture.image.width !== nx || texture.image.height !== nz) {
      texture?.dispose();
      texture = new DataTexture(index.data, nx, nz, RGBAFormat, FloatType);
      texture.minFilter = NearestFilter;
      texture.magFilter = NearestFilter;
      texture.generateMipmaps = false;
      this.uniforms.heightClipIndex.value = texture;
    } else {
      (texture.image.data as Float32Array).set(index.data);
    }
    texture.needsUpdate = true;
    this.uniforms.heightClipRegion.value.set(
      index.origin[0],
      index.origin[1],
      index.entry,
      0,
    );
    params.set(this.live ? 1 : 0, level, level + lowest, this.cells);
  }

  /** Clip while `live` and there are tiles: while the ground is drawn. */
  setLive(live: boolean) {
    this.live = live;
    this.uniforms.heightClipParams.value.x = live && this.index ? 1 : 0;
  }

  heightAt(x: number, z: number): number | null {
    const index = this.index;
    if (!index) return null;
    const at = heightFieldIndexAt(index, x, z);
    if (at < 0) return null;
    const { data } = index;
    const cells = this.cells;
    const nodes = this.textures.nodes;
    const heights = this.textures.heights.image.data as Float32Array;
    const offset = Math.round(data[at + 3]) * nodes * nodes;
    const width = data[at + 2];
    return (
      this.uniforms.heightClipParams.value.y +
      heightFieldPatchAt(
        (i, j) => heights[offset + (1 + j) * nodes + 1 + i],
        cells,
        ((x - data[at]) / width) * cells,
        ((z - data[at + 1]) / width) * cells,
      )
    );
  }

  dispose() {
    (this.uniforms.heightClipIndex.value as DataTexture | null)?.dispose();
    this.uniforms.heightClipIndex.value = null;
    this.index = null;
    this.uniforms.heightClipParams.value.x = 0;
  }
}

/**
 * A debug view of a relief drawn from tiles: `'tiles'` tints each tile by its depth and
 * outlines it; `'layers'` colours each node by the layer that gave it (grey where none
 * did, the base).
 */
export type SkyReliefTileDebug = 'tiles' | 'layers';

/** The most occupants a relief drawn from tiles knows the outlines of. */
export const SKY_RELIEF_MAX_OCCUPANTS = 4;

/**
 * A stage's occupants' outlines for a relief drawn from tiles: their
 * `polygonDistanceField`s, all of one size, side by side in one texture.
 */
export class SkyReliefOccupantFields {
  readonly texture: DataTexture;
  /** per occupant: X/Z of its square's min corner, and a texel's width */
  readonly frames: Vector3[];

  constructor(fields: PolygonDistanceField[]) {
    const size = fields[0].size;
    const data = new Float32Array(size * size * fields.length);
    const width = size * fields.length;
    fields.forEach((field, k) => {
      for (let j = 0; j < size; j++) {
        data.set(
          field.values.subarray(j * size, (j + 1) * size),
          j * width + k * size,
        );
      }
    });
    this.texture = new DataTexture(data, width, size, RedFormat, FloatType);
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.frames = fields.map(
      field => new Vector3(field.origin[0], field.origin[1], field.cell),
    );
  }

  get count() {
    return this.frames.length;
  }

  dispose() {
    this.texture.dispose();
  }
}

/**
 * What a relief drawn from tiles does over a stage's occupants: over their outlines the
 * cutaway takes the water, not the ground; and one of them may cut it with its own cut,
 * inside its outline.
 */
export type SkyReliefTileOccupants = {
  fields: SkyReliefOccupantFields;
  /** the occupant (its index in `fields`) whose cut also cuts the relief, and the cut */
  cut?: { index: number; with: CutUniforms };
};

/**
 * A material for a stage's relief drawn from tiles: as the overview's
 * (`createSkyReliefFarMaterial`), land above the sea and seabed below it, opaque,
 * inheriting the sky material's uniform objects; but its heights and normals are its
 * tiles'. A change to the sky's defines needs a new one.
 *
 * @param stage with a see-through seabed: `'around'` leaves the stage's area
 *   (`uReliefStage`) to {@link createSkyReliefTileSeeThroughMaterial}; omitted, the
 *   tiles are drawn everywhere
 * @param occupants the stage's occupants' outlines, and the cut of one of them
 */
export function createSkyReliefTileMaterial(
  sky: SkyMaterial,
  textures: SkyReliefTileTextures,
  color: 'ramp' | ColorRepresentation,
  stage?: 'around',
  debug?: SkyReliefTileDebug,
  occupants?: SkyReliefTileOccupants,
) {
  const defines = skyOceanDefines(sky);
  defines.RELIEF_TILES = '';
  if (stage === 'around') defines.RELIEF_STAGE_AROUND = '';
  if (debug === 'tiles') defines.RELIEF_DEBUG_TILES = '';
  if (debug === 'layers') defines.RELIEF_DEBUG_LAYERS = '';
  const uniforms = Object.create(sky.uniforms) as Record<string, Uniform>;
  uniforms.uReliefTileHeights = new Uniform(textures.heights);
  uniforms.uReliefTileNormals = new Uniform(textures.normals);
  uniforms.uReliefTileLayers = new Uniform(textures.layers);
  uniforms.uReliefTileNodes = new Uniform(textures.nodes);
  uniforms.uReliefTileCells = new Uniform(textures.nodes - 3);
  uniforms.uReliefTileRoot = new Uniform(TILE_ROOT_SIZE);
  uniforms.uReliefReach = new Uniform(1e30);
  uniforms.uReliefCameraUnder = new Uniform(0);
  uniforms.uReliefStage = new Uniform(new Vector4());
  if (occupants && occupants.fields.count > 0) {
    defines.RELIEF_OCCUPANTS = occupants.fields.count;
    uniforms.uReliefOccupantFields = new Uniform(occupants.fields.texture);
    uniforms.uReliefOccupantFrames = new Uniform(occupants.fields.frames);
    const cut = occupants.cut;
    if (cut && (cut.with.plane || cut.with.fence)) {
      defines.RELIEF_CUT_OCCUPANT = cut.index;
      if (cut.with.plane) {
        defines.RELIEF_OCCUPANT_SECTION = '';
        (uniforms as Record<string, IUniform>).sectionPlane = cut.with.plane;
      }
      if (cut.with.fence) {
        defines.RELIEF_OCCUPANT_FENCE = '';
        applyFenceField(uniforms, cut.with.fence);
      }
    }
  }
  if (color === 'ramp') {
    defines.RELIEF_RAMP = '';
  } else {
    uniforms.uReliefLandColor = new Uniform(new Color(color));
  }
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines,
    lights: true,
    dithering: true,
  });
}

/**
 * The stage's area of a relief drawn from tiles, at the sea's seabed opacity
 * (`SkyMaterial.oceanSeabedOpacity`), as the stage's own see-through seabed is: a
 * transparent part wired for the `OITRenderPass`, its skirts left out. It shares
 * `opaque`'s uniform objects (see {@link createSkyReliefTileMaterial} with `'around'`).
 */
export function createSkyReliefTileSeeThroughMaterial(opaque: ShaderMaterial) {
  const defines: Record<string, unknown> = { ...opaque.defines };
  delete defines.RELIEF_STAGE_AROUND;
  defines.RELIEF_SEE_THROUGH = '';
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: opaque.uniforms,
    defines,
    transparent: true,
    depthWrite: false,
    lights: true,
    dithering: true,
  });
  // Alpha is per fragment: below 1, so OITRenderPass routes it as transparent.
  material.opacity = 0.999;
  return attachOitVariants(material);
}

/**
 * A second patch geometry for a relief's tiles, sharing `patch`'s vertices and its
 * triangles, with tiles of its own: to draw some of the tiles again with another material.
 */
export function createSkyReliefTileSubset(
  patch: InstancedBufferGeometry,
  maxTiles = SKY_RELIEF_MAX_TILES,
): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', patch.getAttribute('position'));
  geometry.setAttribute('reliefSkirt', patch.getAttribute('reliefSkirt'));
  geometry.setIndex(patch.getIndex());
  const tiles = new InstancedBufferAttribute(new Float32Array(4 * maxTiles), 4);
  tiles.setUsage(DynamicDrawUsage);
  geometry.setAttribute('reliefTile', tiles);
  const skirts = new InstancedBufferAttribute(new Float32Array(maxTiles), 1);
  skirts.setUsage(DynamicDrawUsage);
  geometry.setAttribute('reliefTileSkirt', skirts);
  geometry.instanceCount = 0;
  return geometry;
}
