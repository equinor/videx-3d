import {
  BufferAttribute,
  Box3,
  Color,
  DataArrayTexture,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Uniform,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three';
import type { PlanarPolygonCoordinates } from '../../sdk/geometries/planar-geometry';
import { PlanarPolygonGeometry } from '../../sdk/geometries/planar-geometry';
import type { GeoFeature } from '../../sdk/layers/geo-features';
import {
  OVERLAY_TILE_BAND,
  OVERLAY_TILE_SIZE,
  packOverlayShapes,
  type OverlayShapes,
  type OverlayTile,
} from '../../sdk/layers/overlay-tiles';
import type { Globe } from '../../sdk/projection/globe';
import { geoTileRegion } from '../../sdk/tiles/geo-tile-keys';
import { tileAddress, tileParent } from '../../sdk/tiles/tile-keys';
import fragmentShader from './shaders/overlay-fragment.glsl';
import vertexShader from './shaders/overlay-vertex.glsl';

/** Cells along an overlay tile's patch: enough to follow the globe's curve. */
export const OVERLAY_PATCH_CELLS = 16;

/** The most overlay tiles drawn at once. */
export const OVERLAY_MAX_TILES = 1024;

/**
 * The overlay tiles in, one layer each of a texture array (see `OverlayTile`), by slot.
 */
export class OverlayTileTextures {
  readonly slots: number;
  readonly size: number;
  readonly texture: DataArrayTexture;
  private readonly free: number[] = [];

  constructor(slots: number, size = OVERLAY_TILE_SIZE) {
    this.slots = slots;
    this.size = size;
    const n = size + 2;
    this.texture = new DataArrayTexture(
      new Uint8Array(n * n * 4 * slots),
      n,
      n,
      slots,
    );
    this.texture.format = RGBAFormat;
    this.texture.type = UnsignedByteType;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
    for (let slot = slots - 1; slot >= 0; slot--) this.free.push(slot);
  }

  /** Put a tile in a free slot, and return it: -1 when none is free. */
  put(tile: OverlayTile): number {
    const slot = this.free.pop();
    if (slot === undefined) return -1;
    const n = this.size + 2;
    const layer = n * n * 4;
    (this.texture.image.data as Uint8Array).set(tile.data, slot * layer);
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
 * Each shape's fill and outline, by its id: two texels a shape (linear RGB and alpha, as
 * floats), read by the overlay's fragment shader.
 */
export class OverlayStyles {
  static readonly WIDTH = 512;
  texture: DataTexture;

  constructor() {
    this.texture = OverlayStyles.create(1);
  }

  private static create(count: number) {
    const rows = Math.max(1, Math.ceil((2 * count) / OverlayStyles.WIDTH));
    const texture = new DataTexture(
      new Float32Array(OverlayStyles.WIDTH * rows * 4),
      OverlayStyles.WIDTH,
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

  /** Set `count` shapes' styles; a new texture when it grows (returned, else the same). */
  set(
    count: number,
    style: (id: number) => {
      fill: Color;
      fillOpacity: number;
      stroke: Color;
      strokeOpacity: number;
    },
  ): DataTexture {
    const rows = Math.max(1, Math.ceil((2 * count) / OverlayStyles.WIDTH));
    if (rows !== this.texture.image.height) {
      this.texture.dispose();
      this.texture = OverlayStyles.create(count);
    }
    const data = this.texture.image.data as Float32Array;
    data.fill(0);
    for (let id = 0; id < count; id++) {
      const { fill, fillOpacity, stroke, strokeOpacity } = style(id);
      data.set([fill.r, fill.g, fill.b, fillOpacity], 8 * id);
      data.set([stroke.r, stroke.g, stroke.b, strokeOpacity], 8 * id + 4);
    }
    this.texture.needsUpdate = true;
    return this.texture;
  }

  dispose() {
    this.texture.dispose();
  }
}

/**
 * The patch every overlay tile is drawn with: `cells` x `cells` cells over node
 * coordinates 0…`cells` in X/Z, facing up, instanced per tile by an `overlayTile` (its
 * west and east edges' longitude on the conformal sphere from the globe's disc's centre,
 * its blend and its slot), an `overlayTileChi` (its north edge's, middle's and south
 * edge's latitude there), as `geoTileOffsets` gives them, and an `overlayFrom` (where it
 * lies in the tile it blends from, `tileOffsetIn`, and that tile's slot, -1 for none; see
 * `TileTransitions`). No skirts: drawn see-through, two over each other would show.
 */
export function createOverlayPatch(
  cells = OVERLAY_PATCH_CELLS,
  maxTiles = OVERLAY_MAX_TILES,
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
  for (const [name, size] of [
    ['overlayTile', 4],
    ['overlayTileChi', 3],
    ['overlayFrom', 4],
  ] as const) {
    const attribute = new InstancedBufferAttribute(
      new Float32Array(size * maxTiles),
      size,
    );
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;
  return geometry;
}

/**
 * The overlay's material: its tiles on `globe`, from `textures`, coloured by `styles`.
 * See-through, never writing depth; tested against it, so what stands in front hides it.
 */
export function createOverlayMaterial(
  globe: Globe,
  textures: OverlayTileTextures,
  styles: DataTexture,
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...globe.uniforms,
      uOverlayCells: new Uniform(OVERLAY_PATCH_CELLS),
      uOverlayHeight: new Uniform(0),
      uOverlayLift: new Uniform(new Vector2()),
      uOverlayTiles: new Uniform(textures.texture),
      uOverlaySize: new Uniform(textures.size),
      uOverlayBand: new Uniform(OVERLAY_TILE_BAND),
      uOverlayStyles: new Uniform(styles),
      uOverlayStylesWidth: new Uniform(OverlayStyles.WIDTH),
      uOverlayStrokeWidth: new Uniform(1),
      uOverlayOpacity: new Uniform(1),
    },
    transparent: true,
    depthWrite: false,
  });
}

/**
 * Which of a layer's polygons lie over a geographic tile: by their bounds, with a margin
 * of the distance field's band; kept per tile, each found from its parent's when that is
 * kept (a tile's shapes are among its parent's).
 */
export class OverlayFeatureIndex {
  private readonly polygons: {
    id: number;
    polygon: PlanarPolygonCoordinates;
    bounds: [number, number, number, number];
  }[];
  private readonly found = new Map<number, number[]>();
  private readonly all: number[];

  constructor(features: GeoFeature<unknown>[], ids: number[]) {
    this.polygons = [];
    features.forEach((feature, k) => {
      if (feature.geometry instanceof PlanarPolygonGeometry)
        this.polygons.push({
          id: ids[k],
          polygon: feature.geometry.coordinates as PlanarPolygonCoordinates,
          bounds: feature.bounds,
        });
    });
    this.all = this.polygons.map((_, k) => k);
  }

  get count() {
    return this.polygons.length;
  }

  /** The polygons over the tile, by their place in the index. */
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
      ((OVERLAY_TILE_BAND + 2) * span) /
      OVERLAY_TILE_SIZE /
      Math.cos((highest * Math.PI) / 180);
    const from =
      depth > 0 ? (this.found.get(tileParent(key)) ?? this.all) : this.all;
    const over = from.filter(k => {
      const [minLon, minLat, maxLon, maxLat] = this.polygons[k].bounds;
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

  /** The polygons over the tile, packed for `buildOverlayTile`. */
  shapes(key: number): OverlayShapes {
    return packOverlayShapes(
      this.over(key).map(k => ({
        id: this.polygons[k].id,
        polygon: this.polygons[k].polygon,
      })),
    );
  }
}

type TileBounds = {
  box: Box3;
  /** from the globe's centre toward the tile's middle (unit), and the angle it spans about it */
  toward: Vector3;
  spread: number;
};

const corner = new Vector3();
const toEye = new Vector3();

/**
 * Where an overlay's tiles lie in the world, kept per tile: a flat tile at a fixed height
 * on a globe placed once lies where it lies whatever the camera, so its box and its spread
 * on the sphere are found once, not every frame (`geoTileInView` and `geoTileDistance`
 * find them per call, for tiles whose heights change). Found again when the globe is placed
 * anew or the height changes (`prepare`).
 */
export class OverlayTileBounds {
  private readonly kept = new Map<number, TileBounds>();
  private placedFor = '';
  private globe: Globe | null = null;
  private height = 0;

  /** Keep the tiles for this globe, as placed now, and this height over its sea. */
  prepare(globe: Globe, height: number) {
    const key = `${globe.discCentre.x},${globe.discCentre.z},${globe.radius},${globe.enabled},${globe.level},${height}`;
    if (key !== this.placedFor) {
      this.placedFor = key;
      this.kept.clear();
    }
    this.globe = globe;
    this.height = height;
  }

  private of(key: number): TileBounds {
    let found = this.kept.get(key);
    if (found) return found;
    const globe = this.globe!;
    const [west, north, span] = geoTileRegion(key);
    // As geoTileInView bounds a tile: points over it, more the larger it is.
    const steps = span > 20 ? 6 : span > 2 ? 3 : 1;
    const box = new Box3();
    for (let j = 0; j <= steps; j++) {
      for (let i = 0; i <= steps; i++) {
        box.expandByPoint(
          globe.geodetic(
            north - (span * j) / steps,
            west + (span * i) / steps,
            this.height,
            corner,
          ),
        );
      }
    }
    const middle = globe.geodetic(
      north - span / 2,
      west + span / 2,
      this.height,
      new Vector3(),
    );
    box.expandByPoint(middle);
    // Between its points the sphere bulges out, most across a diagonal of their grid.
    const R = globe.radius;
    const across = ((span / steps) * Math.SQRT2 * Math.PI) / 180 / 2;
    box.expandByScalar((R + Math.max(this.height, 0)) * (1 - Math.cos(across)));
    const toward = middle.sub(globe.centre).normalize();
    // The angle on the sphere from its middle to its farthest corner.
    let spread = 0;
    for (const [lat, lon] of [
      [north, west],
      [north, west + span],
      [north - span, west],
      [north - span, west + span],
    ]) {
      globe.geodetic(lat, lon, this.height, corner).sub(globe.centre);
      spread = Math.max(spread, corner.angleTo(toward));
    }
    found = { box, toward, spread };
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
        const top = Math.max(this.height, 0);
        const angle = toEye.angleTo(bounds.toward) - bounds.spread;
        if (angle > Math.acos(R / fromCentre) + Math.acos(R / (R + top)) + 1e-4)
          return false;
      }
    }
    return frustum.intersectsBox(bounds.box);
  }
}
