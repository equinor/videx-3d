import {
  BufferAttribute,
  Box3,
  DataArrayTexture,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Frustum,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  RGFormat,
  ShaderMaterial,
  Uniform,
  UnsignedByteType,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import type { Globe } from '../../sdk/projection/globe';
import { geoTileRegion } from '../../sdk/tiles/geo-tile-keys';
import { tileAddress, tileParent } from '../../sdk/tiles/tile-keys';
import type { SceneryMaterial } from '../Scenery/scenery-material';
import { sceneryOceanDefines } from '../Scenery/scenery-stage';
import fragmentTemplate from './shaders/geo-tile-fragment.glsl';
import vertexShader from './shaders/geo-tile-vertex.glsl';

/** Cells along a tile's patch, flat: enough to follow the globe's curve. */
export const GEO_TILE_FLAT_CELLS = 16;

/** The most instances drawn at once: tiles, or the parts of them over the relief's tiles. */
export const GEO_TILE_MAX_INSTANCES = 4096;

/** Where a tile's data lies in itself: all of it. */
export const GEO_TILE_IDENTITY: [number, number, number] = [0, 0, 1];

/** The line the fragment template takes a layer's sampling in at. */
const SAMPLE_MARKER = 'GEO_TILE_SAMPLE_CHUNK';

/**
 * The texels a geographic tile layer holds per tile: how many channels (R, RG or RGBA) and
 * of what: 8-bit unsigned, read as 0…1 (`'u8'`); half floats (`'f16'`, given as their bits
 * in a `Uint16Array`); or 32-bit floats (`'f32'`, filtered only where
 * `OES_texture_float_linear` is). Filtered linearly, or read nearest.
 *
 * @group Layers
 */
export type GeoTileFormat = {
  /** Default 4 */
  channels?: 1 | 2 | 4;
  /** Default 'u8' */
  type?: 'u8' | 'f16' | 'f32';
  /** Default 'linear' */
  filter?: 'linear' | 'nearest';
};

/**
 * One tile of a geographic tile layer: its texels, `size + 2` a side (its size and a
 * border of one all round, so neighbours filter alike across their edge), row by row from
 * the north-west, `channels` each.
 *
 * @group Layers
 */
export type GeoTileContent = {
  key: number;
  /** the texels, of the layer's format; empty when nothing is drawn on it */
  data: Uint8Array | Uint16Array | Float32Array;
  /** nothing finer to see: it is never split */
  leaf: boolean;
  /** nothing is drawn on it: it holds no slot */
  empty: boolean;
};

/**
 * The tiles in, one layer each of a texture array, by slot.
 */
export class GeoTileTextures {
  readonly slots: number;
  readonly size: number;
  readonly channels: number;
  readonly texture: DataArrayTexture;
  private readonly free: number[] = [];

  constructor(slots: number, size: number, format: GeoTileFormat = {}) {
    const { channels = 4, type = 'u8', filter = 'linear' } = format;
    this.slots = slots;
    this.size = size;
    this.channels = channels;
    const n = size + 2;
    const length = n * n * channels * slots;
    const data =
      type === 'u8'
        ? new Uint8Array(length)
        : type === 'f16'
          ? new Uint16Array(length)
          : new Float32Array(length);
    this.texture = new DataArrayTexture(data, n, n, slots);
    this.texture.format =
      channels === 1 ? RedFormat : channels === 2 ? RGFormat : RGBAFormat;
    this.texture.type =
      type === 'u8'
        ? UnsignedByteType
        : type === 'f16'
          ? HalfFloatType
          : FloatType;
    const filtered = filter === 'linear' ? LinearFilter : NearestFilter;
    this.texture.magFilter = filtered;
    this.texture.minFilter = filtered;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
    for (let slot = slots - 1; slot >= 0; slot--) this.free.push(slot);
  }

  /** Bytes a tile takes. */
  get tileBytes() {
    const n = this.size + 2;
    return n * n * this.channels * this.texture.image.data!.BYTES_PER_ELEMENT;
  }

  /** Put a tile in a free slot, and return it: -1 when none is free. */
  put(tile: GeoTileContent): number {
    const n = this.size + 2;
    const layer = n * n * this.channels;
    if (tile.data.length !== layer) {
      throw new Error(
        `A geographic tile of ${tile.data.length} values, not ${layer} (${n}² × ${this.channels})`,
      );
    }
    const slot = this.free.pop();
    if (slot === undefined) return -1;
    (this.texture.image.data as Uint8Array).set(
      tile.data as Uint8Array,
      slot * layer,
    );
    this.texture.addLayerUpdate(slot);
    this.texture.needsUpdate = true;
    return slot;
  }

  release(slot: number) {
    if (slot >= 0) this.free.push(slot);
  }

  dispose() {
    this.texture.dispose();
  }
}

/**
 * Each feature's style, by its id: `texels` RGBA floats a feature, read by a layer's
 * fragment shader with `texelFetch` (see `geoTileStyle` in the layers' sampling chunks).
 */
export class GeoTileStyles {
  static readonly WIDTH = 512;
  readonly texels: number;
  texture: DataTexture;

  constructor(texels: number) {
    this.texels = texels;
    this.texture = this.create(1);
  }

  private rows(count: number) {
    return Math.max(1, Math.ceil((this.texels * count) / GeoTileStyles.WIDTH));
  }

  private create(count: number) {
    const rows = this.rows(count);
    const texture = new DataTexture(
      new Float32Array(GeoTileStyles.WIDTH * rows * 4),
      GeoTileStyles.WIDTH,
      rows,
      RGBAFormat,
      FloatType,
    );
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Set `count` features' styles: `write` puts feature `id`'s `texels` × 4 floats into
   * `out` from `offset`. A new texture when it grows (returned, else the same).
   */
  set(
    count: number,
    write: (id: number, out: Float32Array, offset: number) => void,
  ): DataTexture {
    if (this.rows(count) !== this.texture.image.height) {
      this.texture.dispose();
      this.texture = this.create(count);
    }
    const data = this.texture.image.data as Float32Array;
    data.fill(0);
    for (let id = 0; id < count; id++) write(id, data, 4 * this.texels * id);
    this.texture.needsUpdate = true;
    return this.texture;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** Per-instance attributes of a tile's patch, and their sizes. */
export const GEO_TILE_ATTRIBUTES = [
  ['layerTile', 4],
  ['layerTileChi', 3],
  ['layerTileUv', 3],
  ['layerTileFrom', 4],
  ['layerTileRelief', 4],
  ['layerTileReliefFrom', 4],
  ['layerTileReliefBlend', 1],
] as const;

/**
 * The patch every instance is drawn with: `cells` x `cells` cells over node coordinates
 * 0…`cells` in X/Z, facing up, its triangles' diagonals from node (i + 1, j) to
 * (i, j + 1) as the relief's are, instanced per square drawn by:
 *
 * - `layerTile`: its west and east edges' longitude on the conformal sphere from the globe's
 *   disc's centre, its blend from the tile it replaces and its slot; `layerTileChi`: its north
 *   edge's, middle's and south edge's latitude there (`geoTileOffsets`);
 * - `layerTileUv`: where it lies in its tile's data (`tileOffsetIn`: a square drawn is its
 *   tile, or part of it over a finer tile of the relief); `layerTileFrom`: where it lies in
 *   the tile it blends from, and that tile's slot, -1 for none (`TileTransitions`);
 * - `layerTileRelief`, `layerTileReliefFrom`, `layerTileReliefBlend`: draped, where it lies in
 *   the relief's tile drawn under it and its slot (-1: flat), and that tile's own blend
 *   from its source, as the relief draws it.
 *
 * No skirts: drawn see-through, two over each other would show.
 */
export function createGeoTilePatch(
  cells: number,
  maxInstances = GEO_TILE_MAX_INSTANCES,
): InstancedBufferGeometry {
  const n = cells + 1;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      positions[3 * (j * n + i)] = i;
      positions[3 * (j * n + i) + 2] = j;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  for (const [name, size] of GEO_TILE_ATTRIBUTES) {
    const attribute = new InstancedBufferAttribute(
      new Float32Array(size * maxInstances),
      size,
    );
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;
  return geometry;
}

/**
 * The layer's material: its tiles on `globe`, from `textures`, coloured by `sample` — GLSL
 * defining `vec4 geoTileSample(float slot, vec2 uv, float texelMetres)`: the premultiplied
 * colour at `uv` across the tile in `slot`, whose texels are `texelMetres` across along a
 * meridian. It may read `uGeoTiles` (the texture array) and `uGeoTileSize`, and `uniforms`.
 *
 * - `drape` with the relief's heights: lies on the relief's tiles, as they are drawn.
 * - `sky`: seen through the sea as its seabed is, before the sea's surface, wired for an
 *   `OITRenderPass`. Without one, drawn over everything see-through (`LAYERS.OVERLAY`).
 *
 * See-through, never writing depth; tested against it, so what stands in front hides it.
 */
export function createGeoTileMaterial({
  globe,
  textures,
  sample,
  uniforms,
  cells,
  relief,
  sky,
}: {
  globe: Globe;
  textures: GeoTileTextures;
  sample: string;
  uniforms?: Record<string, IUniform>;
  cells: number;
  relief: { heights: DataArrayTexture; cells: number } | null;
  sky: SceneryMaterial | null;
}): ShaderMaterial {
  const defines: Record<string, unknown> = sky ? sceneryOceanDefines(sky) : {};
  const own: Record<string, IUniform> = {
    ...globe.uniforms,
    ...uniforms,
    uGeoTileCells: new Uniform(cells),
    uGeoTileHeight: new Uniform(0),
    uGeoTileLift: new Uniform(new Vector2()),
    uGeoTiles: new Uniform(textures.texture),
    uGeoTileSize: new Uniform(textures.size),
    uGeoTileOpacity: new Uniform(1),
    // Revealed as a map (geo-reveal.glsl): not, all of it shown.
    uGeoReveal: new Uniform(new Vector2(0, 1)),
  };
  if (relief) {
    defines.GEO_TILE_DRAPE = '';
    own.uReliefTileHeights = new Uniform(relief.heights);
    own.uReliefTileCells = new Uniform(relief.cells);
  }
  if (sky) defines.GEO_TILE_WATER = '';
  // The sky's own uniform objects, inherited rather than copied, as its other materials do.
  const all = sky
    ? Object.assign(
        Object.create(sky.uniforms) as Record<string, IUniform>,
        own,
      )
    : own;
  if (!fragmentTemplate.includes(SAMPLE_MARKER)) {
    throw new Error(
      'The geographic tiles’ fragment shader lost its sample marker',
    );
  }
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader: fragmentTemplate.replace(SAMPLE_MARKER, sample),
    uniforms: all,
    defines,
    transparent: true,
    depthWrite: false,
    lights: !!sky,
  });
  if (!sky) return material;
  // Alpha is per fragment: below 1, so OITRenderPass routes it as transparent.
  material.opacity = 0.999;
  return attachOitVariants(material);
}

/**
 * Which features lie over a geographic tile, by their bounds, with a margin of `band`
 * texels (and two more) of a tile `size` texels across; kept per tile, each found from its
 * parent's when that is kept (a tile's features are among its parent's).
 */
export class GeoFeatureIndex<T> {
  private readonly items: {
    value: T;
    bounds: [number, number, number, number];
  }[];
  private readonly found = new Map<number, number[]>();
  private readonly all: number[];
  private readonly band: number;
  private readonly size: number;

  constructor(
    items: { value: T; bounds: [number, number, number, number] }[],
    band: number,
    size: number,
  ) {
    this.items = items;
    this.band = band;
    this.size = size;
    this.all = items.map((_, k) => k);
  }

  get count() {
    return this.items.length;
  }

  /** The features over the tile, by their place in the index. */
  over(key: number): number[] {
    const kept = this.found.get(key);
    if (kept) return kept;
    const [depth] = tileAddress(key);
    const [west, north, span] = geoTileRegion(key);
    // The band past the tile's edge, a texel more, and a parallel's narrowing.
    const highest = Math.min(
      Math.max(Math.abs(north), Math.abs(north - span)),
      87,
    );
    const margin =
      ((this.band + 2) * span) /
      this.size /
      Math.cos((highest * Math.PI) / 180);
    const from =
      depth > 0 ? (this.found.get(tileParent(key)) ?? this.all) : this.all;
    const over = from.filter(k => {
      const [minLon, minLat, maxLon, maxLat] = this.items[k].bounds;
      return (
        maxLon >= west - margin &&
        minLon <= west + span + margin &&
        maxLat >= north - span - margin &&
        minLat <= north + margin
      );
    });
    if (this.found.size > 8192) this.found.clear();
    this.found.set(key, over);
    return over;
  }

  /** The features' values over the tile. */
  values(key: number): T[] {
    return this.over(key).map(k => this.items[k].value);
  }
}

type TileBounds = {
  box: Box3;
  /** from the globe's centre toward the tile's middle (unit), and the angle it spans about it */
  toward: Vector3;
  spread: number;
  /** the highest it lies, over the sea */
  top: number;
};

const corner = new Vector3();
const toEye = new Vector3();

/**
 * Where a layer's tiles lie in the world, kept per tile: a tile between fixed heights on a
 * globe placed once lies where it lies whatever the camera, so its box and its spread on the
 * sphere are found once, not every frame (`geoTileInView` and `geoTileDistance` find them
 * per call, for tiles whose heights change). Found again when the globe is placed anew or
 * the heights change (`prepare`).
 */
export class GeoTileBounds {
  private readonly kept = new Map<number, TileBounds>();
  private placedFor = '';
  private globe: Globe | null = null;
  private low = 0;
  private high = 0;
  private rangeAt: ((key: number) => [number, number] | null) | null = null;

  /**
   * Keep the tiles for this globe, as placed now, between these heights over its sea; and,
   * with `rangeAt` (a relief's ground over a tile, as it lies on it), between those too, tile
   * by tile — a box only as tall as the ground under it, so its distance, which its detail is
   * chosen by, is not taken from the deepest trench and the highest peak. A new `version`
   * finds them again (the ground's tiles changed).
   */
  prepare(
    globe: Globe,
    low: number,
    high = low,
    rangeAt?: ((key: number) => [number, number] | null) | null,
    version = 0,
  ) {
    const key = `${globe.discCentre.x},${globe.discCentre.z},${globe.radius},${globe.enabled},${globe.level},${low},${high},${rangeAt ? version : '-'}`;
    if (key !== this.placedFor || rangeAt !== this.rangeAt) {
      this.placedFor = key;
      this.kept.clear();
    }
    this.globe = globe;
    this.low = low;
    this.high = high;
    this.rangeAt = rangeAt ?? null;
  }

  private of(key: number): TileBounds {
    let found = this.kept.get(key);
    if (found) return found;
    const globe = this.globe!;
    const [west, north, span] = geoTileRegion(key);
    const ground = this.rangeAt?.(key) ?? null;
    const low = ground ? Math.min(this.low, ground[0]) : this.low;
    const high = ground ? Math.max(this.high, ground[1]) : this.high;
    // As geoTileInView bounds a tile: points over it, more the larger it is.
    const steps = span > 20 ? 6 : span > 2 ? 3 : 1;
    const box = new Box3();
    const heights = low === high ? [low] : [low, high];
    for (const height of heights) {
      for (let j = 0; j <= steps; j++) {
        for (let i = 0; i <= steps; i++) {
          box.expandByPoint(
            globe.geodetic(
              north - (span * j) / steps,
              west + (span * i) / steps,
              height,
              corner,
            ),
          );
        }
      }
      box.expandByPoint(
        globe.geodetic(north - span / 2, west + span / 2, height, corner),
      );
    }
    const middle = globe.geodetic(
      north - span / 2,
      west + span / 2,
      high,
      new Vector3(),
    );
    // Between its points the sphere bulges out, most across a diagonal of their grid.
    const R = globe.radius;
    const across = ((span / steps) * Math.SQRT2 * Math.PI) / 180 / 2;
    box.expandByScalar((R + Math.max(high, 0)) * (1 - Math.cos(across)));
    const toward = middle.sub(globe.centre).normalize();
    // The angle on the sphere from its middle to its farthest corner.
    let spread = 0;
    for (const [lat, lon] of [
      [north, west],
      [north, west + span],
      [north - span, west],
      [north - span, west + span],
    ]) {
      globe.geodetic(lat, lon, high, corner).sub(globe.centre);
      spread = Math.max(spread, corner.angleTo(toward));
    }
    found = { box, toward, spread, top: high };
    if (this.kept.size > 16384) this.kept.clear();
    this.kept.set(key, found);
    return found;
  }

  /** From `eye` to the tile's box: its nearest point, near enough to choose its detail by. */
  distance(key: number, eye: Vector3): number {
    return this.of(key).box.distanceToPoint(eye);
  }

  /**
   * Whether the tile may be seen from `eye`: its box in the frustum and, on a curved globe,
   * not wholly past the horizon (as `geoTileInView` tests its nearest point, here by the
   * angle it spans).
   */
  shows(key: number, eye: Vector3, frustum: Frustum): boolean {
    const bounds = this.of(key);
    const globe = this.globe!;
    if (globe.enabled) {
      const R = globe.radius;
      toEye.subVectors(eye, globe.centre);
      const fromCentre = toEye.length();
      if (fromCentre > R) {
        const top = Math.max(bounds.top, 0);
        const angle = toEye.angleTo(bounds.toward) - bounds.spread;
        if (angle > Math.acos(R / fromCentre) + Math.acos(R / (R + top)) + 1e-4)
          return false;
      }
    }
    return frustum.intersectsBox(bounds.box);
  }
}
