import proj4 from 'proj4';
import {
  reliefLevelSize,
  reliefMapToNode,
  reliefNodeToLevel,
  reliefNodeToMap,
} from '../data/relief/relief-window';
import type { ReliefMeta, ReliefWindow } from '../data/types/ReliefMeta';
import { WGS84_A, WGS84_E2 } from '../projection/conformal-sphere';
import { wgs84Def } from '../projection/crs';
import { geoTileRegion } from '../tiles/geo-tile-keys';
import { TILE_ROOT_SIZE, tileSquare } from '../tiles/tile-keys';
import type { Vec2 } from '../types/common';
import { toHalfFloatBits } from '../utils/half-float';
import { chamferDistance } from './chamfer';
import type { GeoFrame } from '../projection/geo-frame';

// ⚠️ Free of three.js: it runs where the generators run.

/**
 * Cells along a relief tile's side (see {@link buildReliefTile}).
 *
 * @group Geometries
 */
export const RELIEF_TILE_CELLS = 32;

/**
 * Values along the side of a block of `relief-values`: the library asks for windows of
 * this many, at a multiple of it (see `ReliefWindow`).
 *
 * @group Geometries
 */
export const RELIEF_BLOCK = 128;

// Nodes between the points projected exactly; the rest are interpolated.
const LATTICE = 4;
// Values along the side of the coarse level a layer's distance to its edge is measured
// on, and its detail bounded from.
const EDGE_LEVEL_SIZE = 512;
// A layer with data finer than this share of a tile's cell lets the tile be split.
const FINER = 0.75;

/**
 * One relief data set of a relief, and how it eases in where its data ends.
 *
 * @group Geometries
 */
export type ReliefLayer = {
  /** the relief in the store */
  id: string;
  /** how far its data fades in from where it ends, in scene units. Default 0 */
  feather?: number;
};

/**
 * What a relief is merged from: plain data.
 *
 * @group Geometries
 */
export type ReliefLayersSource = {
  /** the data sets, later ones winning where they have data */
  layers: ReliefLayer[];
  /** the height where no layer has data, metres above mean sea level (negative: below) */
  base: number;
};

/**
 * What a relief's tiles are built from, in a map: plain data.
 *
 * @group Geometries
 */
export type ReliefTileSource = ReliefLayersSource & {
  /** where the scene lies on the map */
  frame: GeoFrame;
};

/**
 * A relief as something built on it samples it — a chunk column's top, say: its tiles'
 * source, and where it lies in that frame. Plain data, so it crosses to a worker. The
 * frame it is built in must be the stage's: the same scene X/Z, and Y along `up`.
 *
 * @group Geometries
 */
export type ReliefSource = ReliefTileSource & {
  /** scene Y of mean sea level: the sea's `level` */
  level: number;
  /** how far above the relief what is built on it lies, in scene units. Default 0 */
  margin?: number;
  /** identifies its content: what is built on it is built again when this changes */
  key: string;
};

/**
 * One tile of a relief: its heights on a grid of `cells + 1` nodes along each side, and a
 * border of one node around it, row by row from the tile's min Z.
 *
 * @group Geometries
 */
export type ReliefTile = {
  key: number;
  cells: number;
  /** `(cells + 3)²` heights, metres above mean sea level */
  heights: Float32Array;
  /** per node, its normal's X and Z as half floats */
  normals: Uint16Array;
  /** per node, 1 + the index of the layer that gave most of it, or 0 for the base */
  layers: Uint8Array;
  /** the lowest and highest of its own nodes */
  min: number;
  max: number;
  /**
   * how far its surface may stray from the merged data: the largest gap at its half-cell
   * points, or more where a layer holds detail finer than those points read
   */
  error: number;
  /** no layer under it has data finer than its cells: it need not be split */
  leaf: boolean;
};

type Read = (
  dataType: string,
  key: string,
  args?: ReliefWindow,
) => Promise<unknown>;

/**
 * How far a layer's data strays from the surface of each of its levels: per value of
 * each level from `base` + 1 up, the most the data at level `base` under it lies off that
 * level's surface (see `reliefDetail`). Finer than `base`, a tile reads the data itself.
 */
type ReliefDetail = {
  base: number;
  /** level `base` + 1 + k at k */
  levels: { size: Vec2; detail: Float32Array }[];
};

/** A layer made ready for tiles: its record, its map, its distance to its edge, its detail. */
type PreparedLayer = {
  meta: ReliefMeta;
  /**
   * a grid's point — scene X/Z in a frame, or longitude and latitude (degrees) — to the
   * layer's fractional node (column, row from the north), or null
   */
  toNode: (x: number, z: number) => Vec2 | null;
  /** metres to where the data ends, on a coarse level of the grid */
  edge: { level: number; size: Vec2; distance: Float32Array };
  /** how far the data strays from each level's surface, or null where none was read */
  detail: ReliefDetail | null;
  /** the level whose single value covers the grid */
  maxLevel: number;
};

/**
 * Reads relief records and blocks for {@link buildReliefTile}, and keeps them: blocks,
 * least recently used first out, under a budget in bytes.
 *
 * @group Geometries
 */
export class ReliefReader {
  private read: Read;
  private budget: number;
  private metas = new Map<string, Promise<ReliefMeta | null>>();
  // In use order, the most recent last; `bytes` is 0 until a block is in.
  private blocks = new Map<
    string,
    { block: Promise<Float32Array | null>; bytes: number }
  >();
  private layers = new Map<string, Promise<PreparedLayer | null>>();
  private held = 0;

  /**
   * @param read the store's `get`
   * @param budget the most the blocks kept may hold, in bytes. Default 128 MB
   */
  constructor(read: Read, budget = 128 * 1024 * 1024) {
    this.read = read;
    this.budget = budget;
  }

  meta(id: string): Promise<ReliefMeta | null> {
    let meta = this.metas.get(id);
    if (!meta) {
      meta = this.read('relief-meta', id).then(
        record => (record as ReliefMeta | null) ?? null,
      );
      this.metas.set(id, meta);
    }
    return meta;
  }

  /** Block (`bx`, `by`) of `level`: {@link RELIEF_BLOCK}² values, NaN past the level's edge. */
  block(
    id: string,
    level: number,
    bx: number,
    by: number,
  ): Promise<Float32Array | null> {
    const key = `${id}|${level}|${bx}|${by}`;
    const kept = this.blocks.get(key);
    if (kept) {
      this.blocks.delete(key);
      this.blocks.set(key, kept);
      return kept.block;
    }
    const entry = {
      block: Promise.resolve<Float32Array | null>(null),
      bytes: 0,
    };
    entry.block = this.read('relief-values', id, {
      level,
      first: [bx * RELIEF_BLOCK, by * RELIEF_BLOCK],
      count: [RELIEF_BLOCK, RELIEF_BLOCK],
    }).then(values => {
      const array = (values as Float32Array | null) ?? null;
      if (!array) {
        if (this.blocks.get(key) === entry) this.blocks.delete(key);
      } else if (this.blocks.get(key) === entry) {
        entry.bytes = array.byteLength;
        this.held += entry.bytes;
        this.trim();
      }
      return array;
    });
    this.blocks.set(key, entry);
    return entry.block;
  }

  /**
   * A layer made ready for tiles in `frame`, or with `null` for grids in longitude and
   * latitude (degrees, WGS84): geographic tiles.
   */
  layer(id: string, frame: GeoFrame | null): Promise<PreparedLayer | null> {
    const key = `${id}|${frame ? JSON.stringify(frame) : 'geographic'}`;
    let layer = this.layers.get(key);
    if (!layer) {
      layer = this.prepare(id, frame);
      this.layers.set(key, layer);
    }
    return layer;
  }

  /** `level` over columns `i0`–`i1` and rows `j0`–`j1` (inclusive, clamped to the level). */
  async window(
    id: string,
    meta: ReliefMeta,
    level: number,
    i0: number,
    j0: number,
    i1: number,
    j1: number,
  ): Promise<LevelWindow | null> {
    const [w, h] = reliefLevelSize(meta, level);
    i0 = Math.max(i0, 0);
    j0 = Math.max(j0, 0);
    i1 = Math.min(i1, w - 1);
    j1 = Math.min(j1, h - 1);
    if (i1 < i0 || j1 < j0) return null;
    const width = i1 - i0 + 1;
    const height = j1 - j0 + 1;
    const values = new Float32Array(width * height);
    const bx0 = Math.floor(i0 / RELIEF_BLOCK);
    const bx1 = Math.floor(i1 / RELIEF_BLOCK);
    const by0 = Math.floor(j0 / RELIEF_BLOCK);
    const by1 = Math.floor(j1 / RELIEF_BLOCK);
    const reads: Promise<void>[] = [];
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        reads.push(
          this.block(id, level, bx, by).then(block => {
            const ci0 = Math.max(i0, bx * RELIEF_BLOCK);
            const ci1 = Math.min(i1, (bx + 1) * RELIEF_BLOCK - 1);
            const cj0 = Math.max(j0, by * RELIEF_BLOCK);
            const cj1 = Math.min(j1, (by + 1) * RELIEF_BLOCK - 1);
            for (let j = cj0; j <= cj1; j++) {
              for (let i = ci0; i <= ci1; i++) {
                values[(j - j0) * width + (i - i0)] = block
                  ? block[
                      (j - by * RELIEF_BLOCK) * RELIEF_BLOCK +
                        (i - bx * RELIEF_BLOCK)
                    ]
                  : NaN;
              }
            }
          }),
        );
      }
    }
    await Promise.all(reads);
    return new LevelWindow(level, i0, j0, width, height, values);
  }

  private trim() {
    for (const [key, entry] of this.blocks) {
      if (this.held <= this.budget) return;
      if (!entry.bytes) continue;
      this.blocks.delete(key);
      this.held -= entry.bytes;
    }
  }

  private async prepare(
    id: string,
    frame: GeoFrame | null,
  ): Promise<PreparedLayer | null> {
    const meta = await this.meta(id);
    if (!meta) return null;
    let toNode: PreparedLayer['toNode'];
    // Metres between the grid's nodes at (`col`, `row`) and one column or row on.
    let between: (col: number, row: number, dc: number, dr: number) => number;
    if (frame) {
      const converter = proj4(frame.projection, meta.crs);
      const [ox, oy] = frame.origin;
      const [sx, sz] = frame.offset ?? [0, 0];
      toNode = (x, z) => {
        const [mx, my] = converter.forward([x - sx + ox, oy - (z - sz)]);
        if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;
        return reliefMapToNode(meta, mx, my);
      };
      const toScene = (col: number, row: number): Vec2 => {
        const [mx, my] = reliefNodeToMap(meta, col, row);
        const [fx, fy] = converter.inverse([mx, my]);
        return [fx - ox + sx, oy - fy + sz];
      };
      between = (col, row, dc, dr) => {
        const [ax, az] = toScene(col, row);
        const [bx, bz] = toScene(col + dc, row + dr);
        return Math.hypot(bx - ax, bz - az);
      };
    } else {
      const converter = proj4(wgs84Def, meta.crs);
      toNode = (longitude, latitude) => {
        const [mx, my] = converter.forward([longitude, latitude]);
        if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;
        return reliefMapToNode(meta, mx, my);
      };
      between = (col, row, dc, dr) => {
        const a = converter.inverse(reliefNodeToMap(meta, col, row));
        const b = converter.inverse(reliefNodeToMap(meta, col + dc, row + dr));
        return groundMetres(a[0], a[1], b[0], b[1]);
      };
    }

    const [nx, ny] = meta.grid.size;
    const maxLevel = Math.max(Math.ceil(Math.log2(Math.max(nx, ny))), 0);
    const level = Math.max(
      Math.ceil(Math.log2(Math.max(nx, ny) / EDGE_LEVEL_SIZE)),
      0,
    );
    const [w, h] = reliefLevelSize(meta, level);
    const coarse = await this.window(id, meta, level, 0, 0, w - 1, h - 1);
    // Metres per node along the grid's columns and rows, at its middle.
    const c = (nx - 1) / 2;
    const r = (ny - 1) / 2;
    const step = 2 ** level;
    const wx = between(c, r, 1, 0) * step || 1;
    const wy = between(c, r, 0, 1) * step || 1;
    const distance = coarse
      ? edgeDistance(coarse.values, w, h, wx, wy)
      : new Float32Array(w * h);
    // A small layer seen from afar averages away in the levels a tile reads: its detail
    // is bounded once, from the level its edge is measured on.
    const detail = coarse
      ? reliefDetail(coarse.values, w, h, level, maxLevel)
      : null;
    return {
      meta,
      toNode,
      edge: { level, size: [w, h], distance },
      detail,
      maxLevel,
    };
  }
}

/** A window of one level of a relief, read bilinearly where it holds data. */
class LevelWindow {
  constructor(
    readonly level: number,
    readonly i0: number,
    readonly j0: number,
    readonly width: number,
    readonly height: number,
    readonly values: Float32Array,
  ) {}

  /**
   * The height at fractional value (`col`, `row`) of the level, from the values around it
   * that hold data, into `out[0]`, and how much of the 2 x 2 around it holds data into
   * `out[1]`.
   */
  sample(col: number, row: number, out: Float64Array) {
    const c = col - this.i0;
    const r = row - this.j0;
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const tc = c - c0;
    const tr = r - r0;
    let sum = 0;
    let weight = 0;
    for (let b = 0; b < 2; b++) {
      const y = r0 + b;
      if (y < 0 || y >= this.height) continue;
      for (let a = 0; a < 2; a++) {
        const x = c0 + a;
        if (x < 0 || x >= this.width) continue;
        const value = this.values[y * this.width + x];
        if (value !== value) continue;
        const w = (a ? tc : 1 - tc) * (b ? tr : 1 - tr);
        sum += w * value;
        weight += w;
      }
    }
    out[0] = weight > 0 ? sum / weight : 0;
    out[1] = weight;
  }
}

/**
 * Per value of a grid, how far it lies from where the data ends — a value that is NaN,
 * or past the grid's edge — with `wx` and `wy` units between values along X and Y; 0
 * where there is no data.
 */
function edgeDistance(
  values: Float32Array,
  w: number,
  h: number,
  wx: number,
  wy: number,
): Float32Array {
  // A border of no data around it, for the edge.
  const pw = w + 2;
  const ph = h + 2;
  const mask = new Uint8Array(pw * ph).fill(1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const value = values[j * w + i];
      if (value === value) mask[(j + 1) * pw + i + 1] = 0;
    }
  }
  const padded = chamferDistance(mask, pw, ph, wx, wy);
  const distance = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    distance.set(
      padded.subarray((j + 1) * pw + 1, (j + 1) * pw + 1 + w),
      j * w,
    );
  }
  return distance;
}

const smoothstep = (a: number, b: number, t: number) => {
  const u = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
};

const DEG = Math.PI / 180;

/**
 * The WGS84 ellipsoid's radii of curvature at `latitude` (degrees), in metres: along the
 * meridian (north–south) and across it (east–west, before the cosine of the latitude).
 */
function ellipsoidRadii(latitude: number): [number, number] {
  const sin = Math.sin(latitude * DEG);
  const w = 1 - WGS84_E2 * sin * sin;
  const across = WGS84_A / Math.sqrt(w);
  return [(across * (1 - WGS84_E2)) / w, across];
}

// Metres along the ground between two nearby longitudes and latitudes (degrees).
function groundMetres(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const [meridian, across] = ellipsoidRadii((latA + latB) / 2);
  const east =
    (((((lonB - lonA + 540) % 360) + 360) % 360) - 180) *
    DEG *
    across *
    Math.cos(((latA + latB) / 2) * DEG);
  return Math.hypot(east, (latB - latA) * DEG * meridian);
}

// Bilinear in a level of `w` x `h` values from those holding data, NaN where none does.
function sampleLevel(
  values: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  let sum = 0;
  let weight = 0;
  for (let b = 0; b < 2; b++) {
    const row = y0 + b;
    if (row < 0 || row >= h) continue;
    for (let a = 0; a < 2; a++) {
      const col = x0 + a;
      if (col < 0 || col >= w) continue;
      const value = values[row * w + col];
      if (value !== value) continue;
      const k = (a ? tx : 1 - tx) * (b ? ty : 1 - ty);
      sum += k * value;
      weight += k;
    }
  }
  return weight > 0 ? sum / weight : NaN;
}

/**
 * The detail of a layer from `values`, its level `base` (`w` x `h`, NaN for no data), up
 * to `maxLevel`: each coarser level averaged from the one under it, as the store's are,
 * and per value the most its 2 x 2 under it lie off its surface (read bilinearly, as a
 * tile reads it), plus their own. A plane lies on every level's surface, so it has none;
 * a hill narrower than a level's values is all detail there.
 */
function reliefDetail(
  values: Float32Array,
  w: number,
  h: number,
  base: number,
  maxLevel: number,
): ReliefDetail {
  const levels: ReliefDetail['levels'] = [];
  let below = values;
  let belowDetail: Float32Array | null = null;
  let bw = w;
  let bh = h;
  for (let level = base + 1; level <= maxLevel; level++) {
    const lw = Math.ceil(bw / 2);
    const lh = Math.ceil(bh / 2);
    const average = new Float32Array(lw * lh);
    for (let j = 0; j < lh; j++) {
      for (let i = 0; i < lw; i++) {
        let sum = 0;
        let count = 0;
        for (let b = 0; b < 2; b++) {
          const row = 2 * j + b;
          if (row >= bh) continue;
          for (let a = 0; a < 2; a++) {
            const col = 2 * i + a;
            if (col >= bw) continue;
            const value = below[row * bw + col];
            if (value !== value) continue;
            sum += value;
            count++;
          }
        }
        average[j * lw + i] = count > 0 ? sum / count : NaN;
      }
    }
    // Value (col, row) under lies at ((col - 0.5) / 2, (row - 0.5) / 2) of this level.
    const detail = new Float32Array(lw * lh);
    for (let row = 0; row < bh; row++) {
      for (let col = 0; col < bw; col++) {
        const value = below[row * bw + col];
        if (value !== value) continue;
        const surface = sampleLevel(
          average,
          lw,
          lh,
          (col - 0.5) / 2,
          (row - 0.5) / 2,
        );
        if (surface !== surface) continue;
        const off =
          Math.abs(value - surface) +
          (belowDetail ? belowDetail[row * bw + col] : 0);
        const k = (row >> 1) * lw + (col >> 1);
        if (off > detail[k]) detail[k] = off;
      }
    }
    levels.push({ size: [lw, lh], detail });
    below = average;
    belowDetail = detail;
    bw = lw;
    bh = lh;
  }
  return { base, levels };
}

/**
 * The most detail of `level` over `range` (the grid's columns and rows, fractional): how
 * far the data there may lie off that level's surface. 0 at or under the detail's base.
 */
function footprintDetail(
  detail: ReliefDetail,
  level: number,
  range: [number, number, number, number],
): number {
  const entry = detail.levels[level - detail.base - 1];
  if (!entry) return 0;
  const [w, h] = entry.size;
  const [i0, j0] = reliefNodeToLevel(level, range[0], range[1]);
  const [i1, j1] = reliefNodeToLevel(level, range[2], range[3]);
  let most = 0;
  for (
    let j = Math.max(Math.floor(j0), 0);
    j <= Math.min(Math.ceil(j1), h - 1);
    j++
  ) {
    for (
      let i = Math.max(Math.floor(i0), 0);
      i <= Math.min(Math.ceil(i1), w - 1);
      i++
    ) {
      const value = entry.detail[j * w + i];
      if (value > most) most = value;
    }
  }
  return most;
}

// Bilinear in a grid of `w` x `h` floats, clamped to it.
function bilinear(
  grid: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  if (!(x > -1 && y > -1 && x < w && y < h)) return 0;
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.min(Math.floor(cx), w - 2 < 0 ? 0 : w - 2);
  const y0 = Math.min(Math.floor(cy), h - 2 < 0 ? 0 : h - 2);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const top = grid[y0 * w + x0] * (1 - tx) + grid[y0 * w + x1] * tx;
  const bottom = grid[y1 * w + x0] * (1 - tx) + grid[y1 * w + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Where a grid's node (`u`, `v`) lies: scene X/Z in a frame, or longitude and latitude. */
type GridPoint = (u: number, v: number) => Vec2;

// The nodes of `nodes` along an axis the lattice projects exactly: every LATTICE, and
// the last. A single node gets a second one past it, to interpolate between.
function latticeStops(nodes: number): number[] {
  const at: number[] = [];
  for (let k = 0; k < Math.max(nodes - 1, 1); k += LATTICE) at.push(k);
  at.push(Math.max(nodes - 1, 1));
  return at;
}

/**
 * Where a grid's points land on a layer's grid: projected exactly every {@link LATTICE}
 * nodes, and interpolated between.
 */
class Lattice {
  private readonly atU: number[];
  private readonly atV: number[];
  private readonly cols: Float64Array;
  private readonly rows: Float64Array;
  /** the grid's columns and rows the lattice spans, or null where none projects */
  readonly range: [number, number, number, number] | null;

  constructor(
    toNode: (x: number, z: number) => Vec2 | null,
    point: GridPoint,
    nodesU: number,
    nodesV: number,
  ) {
    const atU = latticeStops(nodesU);
    const atV = latticeStops(nodesV);
    this.atU = atU;
    this.atV = atV;
    const n = atU.length;
    const m = atV.length;
    this.cols = new Float64Array(n * m);
    this.rows = new Float64Array(n * m);
    let c0 = Infinity;
    let c1 = -Infinity;
    let r0 = Infinity;
    let r1 = -Infinity;
    for (let b = 0; b < m; b++) {
      for (let a = 0; a < n; a++) {
        const [x, z] = point(atU[a], atV[b]);
        const node = toNode(x, z);
        const k = b * n + a;
        this.cols[k] = node ? node[0] : NaN;
        this.rows[k] = node ? node[1] : NaN;
        if (node) {
          c0 = Math.min(c0, node[0]);
          c1 = Math.max(c1, node[0]);
          r0 = Math.min(r0, node[1]);
          r1 = Math.max(r1, node[1]);
        }
      }
    }
    this.range = c0 <= c1 ? [c0, r0, c1, r1] : null;
  }

  /** The layer's grid node at grid node (`u`, `v`), fractional, into `out`. */
  node(u: number, v: number, out: Float64Array) {
    const { atU, atV } = this;
    const n = atU.length;
    const a = Math.min(Math.floor(u / LATTICE), n - 2);
    const b = Math.min(Math.floor(v / LATTICE), atV.length - 2);
    const tu = (u - atU[a]) / (atU[a + 1] - atU[a]);
    const tv = (v - atV[b]) / (atV[b + 1] - atV[b]);
    const k = b * n + a;
    const lerp2 = (grid: Float64Array) =>
      (grid[k] * (1 - tu) + grid[k + 1] * tu) * (1 - tv) +
      (grid[k + n] * (1 - tu) + grid[k + n + 1] * tu) * tv;
    out[0] = lerp2(this.cols);
    out[1] = lerp2(this.rows);
  }
}

/** One layer made ready to merge onto a grid: where the grid lands on it, and its windows. */
type LayerRead = {
  /** the layer's index in the source */
  index: number;
  lattice: Lattice;
  /** the level read for the grid's nodes, and its window */
  level: number;
  window: LevelWindow;
  /** the level read for the points half a cell apart, and its window */
  halfLevel: number;
  halfWindow: LevelWindow;
  /** with `halves`: how far the data under the grid may lie off `halfLevel`'s surface */
  detail: number;
  /** metres between the layer's own nodes, at the grid's middle */
  spacing: number;
  /** how much of the layer a point gets: its coverage there, faded in over the feather */
  weightAt: (col: number, row: number, coverage: number) => number;
};

/**
 * Each layer of `source` projected onto a grid of `nodesU` x `nodesV` points, lying in
 * `space` (a frame's X/Z, or longitude and latitude with null), and the windows it is read
 * from: at the coarsest of its levels no coarser than the grid's finer spacing (`cellU`
 * metres between its columns, `cellV` between its rows), and with `halves` the level under
 * it too.
 */
function readReliefLayers(
  reader: ReliefReader,
  source: ReliefLayersSource,
  space: GeoFrame | null,
  point: GridPoint,
  nodesU: number,
  nodesV: number,
  cellU: number,
  cellV: number,
  halves: boolean,
): Promise<(LayerRead | null)[]> {
  const cell = Math.min(cellU, cellV);
  return Promise.all(
    source.layers.map(async (spec, index): Promise<LayerRead | null> => {
      const layer = await reader.layer(spec.id, space);
      if (!layer) return null;
      const { meta, edge } = layer;
      const lattice = new Lattice(layer.toNode, point, nodesU, nodesV);
      const range = lattice.range;
      if (!range) return null;
      const [nx, ny] = meta.grid.size;
      if (range[2] < -1 || range[3] < -1 || range[0] > nx || range[1] > ny)
        return null;

      // The layer's nodes per metre along its finer axis, at the grid's middle.
      const at = new Float64Array(2);
      const midU = (nodesU - 1) / 2;
      const midV = (nodesV - 1) / 2;
      lattice.node(midU, midV, at);
      const [c0, r0] = at;
      lattice.node(midU + 1, midV, at);
      const dcx = (at[0] - c0) / cellU;
      const drx = (at[1] - r0) / cellU;
      lattice.node(midU, midV + 1, at);
      const dcz = (at[0] - c0) / cellV;
      const drz = (at[1] - r0) / cellV;
      const perCol = Math.hypot(dcx, dcz);
      const perRow = Math.hypot(drx, drz);
      const spacing = 1 / Math.max(perCol, perRow, 1e-12 / cell);
      const level = Math.min(
        Math.max(Math.floor(Math.log2(cell / spacing)), 0),
        layer.maxLevel,
      );
      const halfLevel = halves ? Math.max(level - 1, 0) : level;

      const read = (atLevel: number) => {
        const [i0, j0] = reliefNodeToLevel(atLevel, range[0], range[1]);
        const [i1, j1] = reliefNodeToLevel(atLevel, range[2], range[3]);
        return reader.window(
          meta.id,
          meta,
          atLevel,
          Math.floor(i0) - 1,
          Math.floor(j0) - 1,
          Math.ceil(i1) + 1,
          Math.ceil(j1) + 1,
        );
      };
      const [window, halfWindow] = await Promise.all([
        read(level),
        halfLevel === level ? null : read(halfLevel),
      ]);
      if (!window) return null;

      const feather = spec.feather ?? 0;
      const [ew, eh] = edge.size;
      const weightAt = (col: number, row: number, coverage: number) => {
        if (coverage <= 0 || feather <= 0) return coverage;
        const [ec, er] = reliefNodeToLevel(edge.level, col, row);
        return (
          coverage *
          smoothstep(0, feather, bilinear(edge.distance, ew, eh, ec, er))
        );
      };
      return {
        index,
        lattice,
        level,
        halfLevel,
        window,
        halfWindow: halfWindow ?? window,
        detail:
          halves && layer.detail
            ? footprintDetail(layer.detail, halfLevel, range)
            : 0,
        spacing,
        weightAt,
      };
    }),
  );
}

/**
 * Merge one layer onto a grid's `heights` (`nodesU` per row): eased toward the layer by
 * how much of it each node gets. With `layers`, a node more than half the layer's takes
 * its id (1 + its index). Returns whether it gave any node anything.
 */
function mergeReliefLayer(
  read: LayerRead,
  heights: Float32Array,
  nodesU: number,
  nodesV: number,
  layers?: Uint8Array,
): boolean {
  const { index, lattice, level, window, weightAt } = read;
  const node = new Float64Array(2);
  const sample = new Float64Array(2);
  let gives = false;
  for (let v = 0; v < nodesV; v++) {
    for (let u = 0; u < nodesU; u++) {
      lattice.node(u, v, node);
      if (!(node[0] === node[0])) continue;
      const [lc, lr] = reliefNodeToLevel(level, node[0], node[1]);
      window.sample(lc, lr, sample);
      const weight = weightAt(node[0], node[1], sample[1]);
      if (weight <= 0) continue;
      gives = true;
      const k = v * nodesU + u;
      heights[k] += (sample[0] - heights[k]) * weight;
      if (layers && weight > 0.5) layers[k] = index + 1;
    }
  }
  return gives;
}

/**
 * A regular grid in the scene: node (`col`, `row`) lies at `origin + col × u + row × v`,
 * scene X/Z.
 *
 * @group Geometries
 */
export type ReliefSampleGrid = {
  origin: Vec2;
  /** from one column to the next */
  u: Vec2;
  /** from one row to the next */
  v: Vec2;
  /** columns and rows */
  size: [number, number];
};

/**
 * A relief merged onto any regular grid in the scene, as its tiles are: each layer read
 * at the coarsest of its levels no coarser than the grid's spacing, faded in over its
 * `feather` from where its data ends, and merged over the base in turn. Row by row,
 * metres above mean sea level. See documents/tiles.md, "Sampling the same ground
 * elsewhere".
 *
 * @group Geometries
 */
export async function sampleReliefSource(
  reader: ReliefReader,
  source: ReliefTileSource,
  grid: ReliefSampleGrid,
): Promise<Float32Array> {
  const [nodesU, nodesV] = grid.size;
  const [ox, oz] = grid.origin;
  const [ux, uz] = grid.u;
  const [vx, vz] = grid.v;
  const point: GridPoint = (a, b) => [
    ox + a * ux + b * vx,
    oz + a * uz + b * vz,
  ];
  const cell = Math.min(Math.hypot(ux, uz), Math.hypot(vx, vz));
  const heights = new Float32Array(nodesU * nodesV).fill(source.base);
  const reads = await readReliefLayers(
    reader,
    source,
    source.frame,
    point,
    nodesU,
    nodesV,
    cell,
    cell,
    false,
  );
  for (const read of reads) {
    if (read) mergeReliefLayer(read, heights, nodesU, nodesV);
  }
  return heights;
}

/**
 * The height of a built relief tile at scene X/Z (`x`, `z`), in metres above mean sea
 * level: bilinear between its nodes, as the relief is shaded. A point off the tile takes
 * its nearest edge.
 *
 * @param rootSize the quadtree's roots' width, as the tile was built with
 *
 * @group Geometries
 */
export function reliefTileHeightAt(
  tile: ReliefTile,
  x: number,
  z: number,
  rootSize = TILE_ROOT_SIZE,
): number {
  const [minX, minZ, size] = tileSquare(tile.key, rootSize);
  return tileHeightAt(tile, (x - minX) / size, (z - minZ) / size);
}

/**
 * The height of a built geographic relief tile (`buildGeoReliefTile`) at `longitude`,
 * `latitude` (degrees), in metres above mean sea level: bilinear between its nodes, as the
 * relief is shaded. A point off the tile takes its nearest edge.
 *
 * @group Geometries
 */
export function geoReliefTileHeightAt(
  tile: ReliefTile,
  longitude: number,
  latitude: number,
): number {
  const [west, north, span] = geoTileRegion(tile.key);
  const east = ((((longitude - west + 180) % 360) + 360) % 360) - 180;
  return tileHeightAt(tile, east / span, (north - latitude) / span);
}

// A tile's height at (`u`, `v`), its own nodes from 0 to 1 along each side, clamped.
function tileHeightAt(tile: ReliefTile, fu0: number, fv0: number): number {
  const { cells, heights } = tile;
  const nodes = cells + 3;
  const u = Math.min(Math.max(fu0 * cells, 0), cells);
  const v = Math.min(Math.max(fv0 * cells, 0), cells);
  const i = Math.min(Math.floor(u), cells - 1);
  const j = Math.min(Math.floor(v), cells - 1);
  const fu = u - i;
  const fv = v - j;
  // The tile's own node (i, j), past its border of one.
  const k = (1 + j) * nodes + 1 + i;
  return (
    (heights[k] * (1 - fu) + heights[k + 1] * fu) * (1 - fv) +
    (heights[k + nodes] * (1 - fu) + heights[k + nodes + 1] * fu) * fv
  );
}

/**
 * Build one tile of a relief: each layer of `source` projected onto the tile's nodes and
 * read at the coarsest of its levels no coarser than the tile's cells, faded in over its
 * `feather` from where its data ends, and merged over the base in turn, later layers
 * winning where they have data. See documents/tiles.md, "Relief tiles".
 *
 * @param key the tile (see `tileKey`)
 * @param cells cells along the tile's side
 * @param rootSize the quadtree's roots' width
 *
 * @group Geometries
 */
export async function buildReliefTile(
  reader: ReliefReader,
  source: ReliefTileSource,
  key: number,
  cells = RELIEF_TILE_CELLS,
  rootSize = TILE_ROOT_SIZE,
): Promise<ReliefTile> {
  const [minX, minZ, size] = tileSquare(key, rootSize);
  const cell = size / cells;
  return buildTile(reader, source, key, cells, {
    space: source.frame,
    point: (u, v) => [minX + (u - 1) * cell, minZ + (v - 1) * cell],
    cellU: () => cell,
    cellV: cell,
  });
}

/**
 * Build one tile of a relief on the geographic quadtree (see `geoTileRegion`): as
 * {@link buildReliefTile}, its nodes on a grid of longitude and latitude, column by column
 * east and row by row south from its north-west corner. Its normals' X and Z are east and
 * south where each node lies, and its error and cells are in metres: a tile is the same
 * whatever frame the scene is drawn in. See documents/world.md, step 6.
 *
 * @param key the tile (see `geoTileKeyAt`)
 * @param cells cells along the tile's side
 *
 * @group Geometries
 */
export async function buildGeoReliefTile(
  reader: ReliefReader,
  source: ReliefLayersSource,
  key: number,
  cells = RELIEF_TILE_CELLS,
): Promise<ReliefTile> {
  const [west, north, span] = geoTileRegion(key);
  const step = span / cells;
  const latitudeAt = (v: number) =>
    Math.min(Math.max(north - (v - 1) * step, -90), 90);
  const [meridian] = ellipsoidRadii(north - span / 2);
  const cellV = step * DEG * meridian;
  return buildTile(reader, source, key, cells, {
    space: null,
    point: (u, v) => [west + (u - 1) * step, latitudeAt(v)],
    cellU: v => {
      const latitude = latitudeAt(v);
      const [, across] = ellipsoidRadii(latitude);
      // At a pole a row is a point: kept a sliver wide, so its slopes stay finite.
      return Math.max(
        step * DEG * across * Math.cos(latitude * DEG),
        cellV * 1e-3,
      );
    },
    cellV,
  });
}

/** Where a tile's nodes lie, and how far apart, for `buildTile`. */
type TileGrid = {
  /** the frame its points are in, or null for longitude and latitude */
  space: GeoFrame | null;
  point: GridPoint;
  /** metres between its columns along row `v` (fractional) */
  cellU: (v: number) => number;
  /** metres between its rows */
  cellV: number;
};

async function buildTile(
  reader: ReliefReader,
  source: ReliefLayersSource,
  key: number,
  cells: number,
  grid: TileGrid,
): Promise<ReliefTile> {
  // The tile's nodes and a border of one around them.
  const nodes = cells + 3;
  // Its half-cell points: the nodes and the midpoints between them, without the border.
  const fine = 2 * cells + 1;
  const heights = new Float32Array(nodes * nodes).fill(source.base);
  const halves = new Float64Array(fine * fine).fill(source.base);
  const layers = new Uint8Array(nodes * nodes);
  let leaf = true;

  const node = new Float64Array(2);
  const sample = new Float64Array(2);
  const midCellU = grid.cellU((nodes - 1) / 2);
  const cell = Math.min(midCellU, grid.cellV);

  // Each layer's projection onto the tile, the level it is read at and its windows,
  // read all at once; merged in turn below.
  const reads = await readReliefLayers(
    reader,
    source,
    grid.space,
    grid.point,
    nodes,
    nodes,
    midCellU,
    grid.cellV,
    true,
  );

  for (const read of reads) {
    if (!read) continue;
    const { lattice, halfLevel, halfWindow, weightAt } = read;
    const gives = mergeReliefLayer(read, heights, nodes, nodes, layers);
    for (let v = 0; v < fine; v++) {
      for (let u = 0; u < fine; u++) {
        lattice.node(1 + u / 2, 1 + v / 2, node);
        if (!(node[0] === node[0])) continue;
        const [lc, lr] = reliefNodeToLevel(halfLevel, node[0], node[1]);
        halfWindow.sample(lc, lr, sample);
        const weight = weightAt(node[0], node[1], sample[1]);
        if (weight <= 0) continue;
        const k = v * fine + u;
        halves[k] += (sample[0] - halves[k]) * weight;
      }
    }
    if (gives && read.spacing < cell * FINER) leaf = false;
  }

  // The tile's own nodes, and the gap at its half-cell points between the merged data
  // and the surface its triangles draw (their diagonal runs from (i + 1, j) to (i, j + 1)),
  // or more where its layers hold detail finer than those points read.
  let min = Infinity;
  let max = -Infinity;
  for (let v = 1; v <= cells + 1; v++) {
    for (let u = 1; u <= cells + 1; u++) {
      const h = heights[v * nodes + u];
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  let error = 0;
  for (const read of reads) if (read) error = Math.max(error, read.detail);
  for (let v = 0; v < fine; v++) {
    for (let u = 0; u < fine; u++) {
      const i = u >> 1;
      const j = v >> 1;
      const at = (a: number, b: number) => heights[(1 + b) * nodes + 1 + a];
      let surface: number;
      if (!(u & 1) && !(v & 1)) surface = at(i, j);
      else if (!(v & 1)) surface = 0.5 * (at(i, j) + at(i + 1, j));
      else if (!(u & 1)) surface = 0.5 * (at(i, j) + at(i, j + 1));
      else surface = 0.5 * (at(i + 1, j) + at(i, j + 1));
      error = Math.max(error, Math.abs(halves[v * fine + u] - surface));
    }
  }

  const normals = new Uint16Array(nodes * nodes * 2);
  for (let v = 0; v < nodes; v++) {
    const v0 = Math.max(v - 1, 0);
    const v1 = Math.min(v + 1, nodes - 1);
    const cellU = grid.cellU(v);
    for (let u = 0; u < nodes; u++) {
      const u0 = Math.max(u - 1, 0);
      const u1 = Math.min(u + 1, nodes - 1);
      const dx =
        (heights[v * nodes + u1] - heights[v * nodes + u0]) /
        ((u1 - u0) * cellU);
      const dz =
        (heights[v1 * nodes + u] - heights[v0 * nodes + u]) /
        ((v1 - v0) * grid.cellV);
      const length = Math.hypot(dx, 1, dz);
      const k = 2 * (v * nodes + u);
      normals[k] = toHalfFloatBits(-dx / length);
      normals[k + 1] = toHalfFloatBits(-dz / length);
    }
  }

  return { key, cells, heights, normals, layers, min, max, error, leaf };
}
