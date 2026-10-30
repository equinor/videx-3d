import {
  Color,
  DataArrayTexture,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  RGBAFormat,
  ShaderMaterial,
  Uniform,
  Vector2,
  type IUniform,
  type Texture,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import { createTubeSegmentGeometry } from '../../sdk/geometries/tube-segment-geometry';
import {
  GEO_TUBE_NODE_STRIDE,
  type GeoTubeNodeArrays,
  type GeoTubeNodesLaid,
} from '../../sdk/layers/geo-tubes';
import type { Globe } from '../../sdk/projection/globe';
import { geoTileKeyAt, geoTileRegion } from '../../sdk/tiles/geo-tile-keys';
import { tileAddress, tileParent } from '../../sdk/tiles/tile-keys';
import type { SceneryMaterial } from '../Scenery/scenery-material';
import type { SceneryReliefDrawn } from '../Scenery/scenery-relief-hub';
import { SKY_RELIEF_MAX_TILES } from '../Scenery/scenery-relief-tiles';
import { sceneryOceanDefines } from '../Scenery/scenery-stage';
import { GeoTileStyles } from './geo-tile-layer';
import fragmentShader from './shaders/geo-tube-fragment.glsl';
import vertexShader from './shaders/geo-tube-vertex.glsl';

/**
 * Floats a tube's node holds of the relief tile drawn under it: where it lies across that
 * tile (2), and the tile's group (1, -1 for none; see {@link GeoTubeReliefGroups}).
 */
export const GEO_TUBE_RELIEF_STRIDE = 3;

/** Texels along a row of {@link GeoTubeReliefGroups}' texture: two a group. */
export const GEO_TUBE_GROUPS_WIDTH = 256;

type Walked = { key: number; drawn: boolean };

// Looking from the root for the relief tile drawn over a point (as geoDrawnTileAt): the one
// drawn, or where looking stopped, a tile neither drawn nor over one drawn.
function walkAt(
  longitude: number,
  latitude: number,
  relief: SceneryReliefDrawn,
): Walked {
  let key = -1;
  for (let depth = 0; depth <= 30; depth++) {
    key = geoTileKeyAt(depth, longitude, latitude);
    if (relief.index.has(key)) return { key, drawn: true };
    if (!relief.ancestors.has(key)) return { key, drawn: false };
  }
  return { key, drawn: false };
}

// The same for every point in tile `miss`, where looking stopped before, as far down as it:
// null where it is over tiles drawn now, and each point must be looked for below it.
function walkTo(miss: number, relief: SceneryReliefDrawn): Walked | null {
  const chain = [miss];
  for (let at = miss; tileAddress(at)[0] > 0; ) {
    at = tileParent(at);
    chain.push(at);
  }
  for (let k = chain.length - 1; k >= 0; k--) {
    const key = chain[k];
    if (relief.index.has(key)) return { key, drawn: true };
    if (!relief.ancestors.has(key)) return { key, drawn: false };
  }
  return null;
}

/**
 * The relief tiles a layer's tube nodes lie on, one group a tile: each node holds where it
 * lies across its tile and the group (written when it is placed, and again only once that
 * tile is no longer drawn), and the groups' texture what the relief draws there now — the
 * tile's slot and blend, and the tile it blends from — rewritten as often as the relief
 * chooses, a few hundred groups rather than every node. Nodes over no tile drawn are kept by
 * the tile where looking stopped, and looked for again a tile at a time.
 */
export class GeoTubeReliefGroups {
  /** two texels a group: its tile's slot, its blend (x, y); where it lies in the tile it blends from, that tile's slot */
  readonly texture: DataTexture;
  private readonly data: Float32Array;
  private readonly max: number;
  // Each group's tile (-1: free), the group of each tile, the nodes on each.
  private keys: number[] = [];
  private readonly slots = new Map<number, number>();
  private members: number[][] = [];
  private free: number[] = [];
  // Nodes over no tile drawn, by the tile where looking stopped (neither drawn nor over a
  // tile drawn): all under it alike until the tiles drawn change there.
  private homeless = new Map<number, number[]>();
  // The choice of tiles the nodes were placed for, and whether the relief is gone.
  private seen = -1;
  private cleared = false;
  // The nodes written since the last upload.
  private first = Infinity;
  private last = -Infinity;

  constructor(max = SKY_RELIEF_MAX_TILES) {
    this.max = max;
    const rows = Math.ceil((2 * max) / GEO_TUBE_GROUPS_WIDTH);
    this.data = new Float32Array(GEO_TUBE_GROUPS_WIDTH * rows * 4);
    this.texture = new DataTexture(
      this.data,
      GEO_TUBE_GROUPS_WIDTH,
      rows,
      RGBAFormat,
      FloatType,
    );
    this.texture.needsUpdate = true;
  }

  /** Every node anew (laid again): placed on the tiles drawn now, by {@link update}. */
  place(nodes: GeoTubeNodes, relief: SceneryReliefDrawn | null) {
    this.keys = [];
    this.slots.clear();
    this.members = [];
    this.free = [];
    this.homeless.clear();
    this.seen = -1;
    this.cleared = false;
    const array = nodes.relief.array as Float32Array;
    for (let i = 0; i < nodes.count; i++)
      array[i * GEO_TUBE_RELIEF_STRIDE + 2] = -1;
    if (nodes.count > 0) {
      nodes.relief.addUpdateRange(0, nodes.count * GEO_TUBE_RELIEF_STRIDE);
      nodes.relief.needsUpdate = true;
    }
    // Looked for from the root: the whole Earth is where looking stops for all.
    if (nodes.count > 0)
      this.homeless.set(
        -1,
        Array.from({ length: nodes.count }, (_, i) => i),
      );
    this.update(nodes, relief);
  }

  /**
   * What the relief draws now (each time it chooses): the nodes over tiles no longer drawn,
   * or where tiles are drawn anew, placed again; and each group's tile as drawn.
   */
  update(nodes: GeoTubeNodes, relief: SceneryReliefDrawn | null) {
    const data = this.data;
    if (!relief) {
      // Gone: every node on its own ground.
      if (this.cleared) return;
      this.cleared = true;
      for (let s = 0; s < this.keys.length; s++) {
        data[8 * s] = -1;
        data[8 * s + 7] = -1;
      }
      this.texture.needsUpdate = true;
      return;
    }
    this.cleared = false;
    if (relief.keysVersion !== this.seen) {
      this.seen = relief.keysVersion;
      const moved: number[] = [];
      for (let s = 0; s < this.keys.length; s++) {
        const key = this.keys[s];
        if (key < 0 || relief.index.has(key)) continue;
        for (const i of this.members[s]) moved.push(i);
        this.slots.delete(key);
        this.keys[s] = -1;
        this.members[s] = [];
        this.free.push(s);
      }
      // The homeless, a tile where looking stopped at a time: looked for again down to it.
      const misses = this.homeless;
      this.homeless = new Map();
      for (const [miss, list] of misses) {
        const found = miss < 0 ? null : walkTo(miss, relief);
        if (!found) for (const i of list) moved.push(i);
        else if (found.drawn) this.settle(nodes, list, found.key);
        else this.strand(found.key, list);
      }
      if (moved.length > 0) this.relocate(nodes, moved, relief);
      if (this.first <= this.last) {
        const R = GEO_TUBE_RELIEF_STRIDE;
        nodes.relief.addUpdateRange(
          this.first * R,
          (this.last - this.first + 1) * R,
        );
        nodes.relief.needsUpdate = true;
        this.first = Infinity;
        this.last = -Infinity;
      }
    }
    let changed = false;
    for (let s = 0; s < this.keys.length; s++) {
      const key = this.keys[s];
      if (key < 0) continue;
      const instance = relief.index.get(key);
      const at = 8 * s;
      const slot = instance === undefined ? -1 : relief.tiles[4 * instance + 3];
      const blend = instance === undefined ? 1 : relief.blends[instance];
      if (data[at] !== slot || data[at + 1] !== blend) {
        data[at] = slot;
        data[at + 1] = blend;
        changed = true;
      }
      for (let k = 0; k < 4; k++) {
        const from =
          instance === undefined ? -1 : relief.froms[4 * instance + k];
        if (data[at + 4 + k] !== from) {
          data[at + 4 + k] = from;
          changed = true;
        }
      }
    }
    if (changed) this.texture.needsUpdate = true;
  }

  // Nodes `list` on drawn tile `key`.
  private settle(nodes: GeoTubeNodes, list: number[], key: number) {
    const slot = this.slotOf(key);
    if (slot < 0) {
      this.strand(key, list);
      return;
    }
    const [west, north, extent] = geoTileRegion(key);
    const array = nodes.relief.array as Float32Array;
    const R = GEO_TUBE_RELIEF_STRIDE;
    const members = this.members[slot];
    for (const i of list) {
      members.push(i);
      array[i * R] = (nodes.lonLat[2 * i] - west) / extent;
      array[i * R + 1] = (north - nodes.lonLat[2 * i + 1]) / extent;
      array[i * R + 2] = slot;
      if (i < this.first) this.first = i;
      if (i > this.last) this.last = i;
    }
  }

  // Nodes `list` over no tile drawn, looking stopped at `miss` (already marked homeless).
  private strand(miss: number, list: number[]) {
    const known = this.homeless.get(miss);
    if (known) for (const i of list) known.push(i);
    else this.homeless.set(miss, list.slice());
  }

  // Each node in `list` on the tile drawn under it, if any: where the last node was found
  // (or looking stopped for it) tried first.
  private relocate(
    nodes: GeoTubeNodes,
    list: number[],
    relief: SceneryReliefDrawn,
  ) {
    list.sort((a, b) => a - b);
    const array = nodes.relief.array as Float32Array;
    const R = GEO_TUBE_RELIEF_STRIDE;
    let hint = -1;
    let drawn = false;
    let slot = -1;
    let west = 0;
    let north = 0;
    let extent = -1;
    for (const i of list) {
      const longitude = nodes.lonLat[2 * i];
      const latitude = nodes.lonLat[2 * i + 1];
      const inside =
        extent >= 0 &&
        longitude >= west &&
        longitude <= west + extent &&
        latitude <= north &&
        latitude >= north - extent;
      if (!inside) {
        const found = walkAt(longitude, latitude, relief);
        hint = found.key;
        drawn = found.drawn;
        [west, north, extent] = geoTileRegion(hint);
        slot = drawn ? this.slotOf(hint) : -1;
      }
      if (i < this.first) this.first = i;
      if (i > this.last) this.last = i;
      if (slot < 0) {
        array[i * R + 2] = -1;
        const known = this.homeless.get(hint);
        if (known) known.push(i);
        else this.homeless.set(hint, [i]);
        continue;
      }
      this.members[slot].push(i);
      array[i * R] = (longitude - west) / extent;
      array[i * R + 1] = (north - latitude) / extent;
      array[i * R + 2] = slot;
    }
  }
  // The group of tile `key`, a new one if it has none; -1 when all are taken.
  private slotOf(key: number): number {
    const known = this.slots.get(key);
    if (known !== undefined) return known;
    let slot = this.free.pop();
    if (slot === undefined) {
      if (this.keys.length >= this.max) return -1;
      slot = this.keys.length;
      this.keys.push(-1);
      this.members.push([]);
    }
    this.keys[slot] = key;
    this.members[slot] = [];
    this.slots.set(key, slot);
    return slot;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** The nodes of a layer's tubes, laid about the camera, and the relief under each. */
export class GeoTubeNodes {
  readonly capacity: number;
  readonly nodes: InstancedInterleavedBuffer;
  readonly relief: InstancedInterleavedBuffer;
  /** each node's longitude and latitude, distance along its part, and whether near (see `GeoTubeNodeArrays`) */
  readonly lonLat: Float64Array;
  readonly along: Float64Array;
  readonly near: Uint8Array;
  readonly groups = new GeoTubeReliefGroups();
  count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    // One node more: the last segment's end reads a stride past its start.
    this.nodes = new InstancedInterleavedBuffer(
      new Float32Array((capacity + 1) * GEO_TUBE_NODE_STRIDE),
      GEO_TUBE_NODE_STRIDE,
    );
    this.relief = new InstancedInterleavedBuffer(
      new Float32Array((capacity + 1) * GEO_TUBE_RELIEF_STRIDE),
      GEO_TUBE_RELIEF_STRIDE,
    );
    this.nodes.setUsage(DynamicDrawUsage);
    this.relief.setUsage(DynamicDrawUsage);
    this.lonLat = new Float64Array(capacity * 2);
    this.along = new Float64Array(capacity);
    this.near = new Uint8Array(capacity);
  }

  /** The node arrays, for `liftGeoTubeNodes`. */
  get arrays(): GeoTubeNodeArrays {
    return {
      capacity: this.capacity,
      nodes: this.nodes.array as Float32Array,
      lonLat: this.lonLat,
      along: this.along,
      near: this.near,
    };
  }

  /** Take nodes laid (`geoTubeNodesAround`): as many as fit. */
  set(laid: GeoTubeNodesLaid) {
    const count = Math.min(laid.count, this.capacity);
    this.count = count;
    (this.nodes.array as Float32Array).set(
      laid.nodes.subarray(0, count * GEO_TUBE_NODE_STRIDE),
    );
    this.lonLat.set(laid.lonLat.subarray(0, count * 2));
    this.along.set(laid.along.subarray(0, count));
    this.near.set(laid.near.subarray(0, count));
    if (count > 0) this.upload(0, count);
  }

  /** Upload nodes `first`…`last` (and the one after: the last segment's end). */
  upload(first: number, last: number) {
    this.nodes.addUpdateRange(
      first * GEO_TUBE_NODE_STRIDE,
      (last - first + 2) * GEO_TUBE_NODE_STRIDE,
    );
    this.nodes.needsUpdate = true;
  }

  dispose() {
    this.groups.dispose();
  }
}

/**
 * The tubes' geometry: the shared ring (`createTubeSegmentGeometry`), instanced per segment
 * between two consecutive nodes — A a node, B the next, a stride further.
 */
export function createGeoTubeGeometry(
  radialSegments: number,
  nodes: GeoTubeNodes,
): InstancedBufferGeometry {
  const geometry = createTubeSegmentGeometry(radialSegments);
  const n = GEO_TUBE_NODE_STRIDE;
  const r = GEO_TUBE_RELIEF_STRIDE;
  const attributes: [string, InstancedInterleavedBuffer, number, number][] = [
    ['tubeNodeA', nodes.nodes, 4, 0],
    ['tubeTangentA', nodes.nodes, 4, 4],
    ['tubeIdA', nodes.nodes, 1, 8],
    ['tubeNodeB', nodes.nodes, 4, n],
    ['tubeTangentB', nodes.nodes, 4, n + 4],
    ['tubeReliefA', nodes.relief, 3, 0],
    ['tubeReliefB', nodes.relief, 3, r],
  ];
  for (const [name, buffer, size, offset] of attributes)
    geometry.setAttribute(
      name,
      new InterleavedBufferAttribute(buffer, size, offset),
    );
  return geometry;
}

/**
 * The tubes' material: on `globe`, coloured by `styles` (two texels a feature: its colour
 * and opacity, and its diameter), on the relief's heights with `relief` (through the nodes'
 * `groups`), seen through the sea with `sky`. Opaque unless `translucent`, wired for an
 * `OITRenderPass` either way.
 */
export function createGeoTubeMaterial({
  globe,
  styles,
  relief,
  groups,
  sky,
  translucent,
}: {
  globe: Globe;
  styles: Texture;
  relief: { heights: DataArrayTexture; cells: number } | null;
  groups: GeoTubeReliefGroups;
  sky: SceneryMaterial | null;
  translucent: boolean;
}): ShaderMaterial {
  const defines: Record<string, unknown> = sky ? sceneryOceanDefines(sky) : {};
  const own: Record<string, IUniform> = {
    ...globe.uniforms,
    resolution: new Uniform(new Vector2(1, 1)),
    uTubeExaggeration: new Uniform(1),
    uTubeMinPixels: new Uniform(2),
    uTubeStyles: new Uniform(styles),
    uTubeStylesWidth: new Uniform(GeoTileStyles.WIDTH),
    uTubeOpacity: new Uniform(1),
    // Revealed as a map (geo-reveal.glsl): not, all of it shown.
    uGeoReveal: new Uniform(new Vector2(0, 1)),
    shadingColor: new Uniform(new Color(0, 0, 0)),
    shadingStrength: new Uniform(0.6),
    shadingFalloff: new Uniform(2),
  };
  if (relief) {
    defines.GEO_TUBE_DRAPE = '';
    defines.GEO_TUBE_GROUPS_WIDTH = GEO_TUBE_GROUPS_WIDTH;
    own.uReliefTileHeights = new Uniform(relief.heights);
    own.uReliefTileCells = new Uniform(relief.cells);
    own.uTubeReliefGroups = new Uniform(groups.texture);
  }
  if (sky) defines.GEO_TUBE_WATER = '';
  if (!translucent) defines.OPAQUE = '';
  // The sky's own uniform objects, inherited rather than copied, as its other materials do.
  const uniforms = sky
    ? Object.assign(
        Object.create(sky.uniforms) as Record<string, IUniform>,
        own,
      )
    : own;
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines,
    transparent: translucent,
    depthWrite: !translucent,
    lights: !!sky,
  });
  // Alpha is per fragment: below 1, so OITRenderPass routes it as transparent.
  if (translucent) material.opacity = 0.999;
  return attachOitVariants(material);
}
