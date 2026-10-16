import { Box3, Frustum, Matrix4, Vector3 } from 'three';
import type { StackTiling } from '../../sdk';
import { selectLodLevel } from '../../sdk/utils/lod';

/**
 * Each tile's footprint in the chunk's own frame: its grid rectangle's four corners
 * mapped to scene XZ, as x, z pairs (eight numbers per tile). In the tile order of
 * `StackTiling` (row-major).
 */
export function chunkTileCorners(tiling: StackTiling): Float32Array {
  const { cells, first, count } = tiling;
  const [a, b, c, d, e, f] = tiling.toGrid;
  const det = a * e - b * d;
  const corners = new Float32Array(count[0] * count[1] * 8);
  let at = 0;
  for (let j = 0; j < count[1]; j++) {
    for (let i = 0; i < count[0]; i++) {
      const col0 = (first[0] + i) * cells - 0.5;
      const row0 = (first[1] + j) * cells - 0.5;
      for (const [col, row] of [
        [col0, row0],
        [col0 + cells, row0],
        [col0, row0 + cells],
        [col0 + cells, row0 + cells],
      ]) {
        // The inverse of `toGrid`: grid (column, row) back to scene XZ.
        corners[at++] = (e * (col - c) - b * (row - f)) / det;
        corners[at++] = (a * (row - f) - d * (col - c)) / det;
      }
    }
  }
  return corners;
}

/**
 * Each tile's box in the chunk's own frame: its footprint (see
 * {@link chunkTileCorners}) over the chunk's height range.
 */
export function chunkTileBoxes(
  tiling: StackTiling,
  yMin: number,
  yMax: number,
): Box3[] {
  const corners = chunkTileCorners(tiling);
  const boxes: Box3[] = [];
  const point = new Vector3();
  for (let at = 0; at < corners.length; at += 8) {
    const box = new Box3();
    for (let k = at; k < at + 8; k += 2) {
      box.expandByPoint(point.set(corners[k], yMin, corners[k + 1]));
      box.expandByPoint(point.set(corners[k], yMax, corners[k + 1]));
    }
    boxes.push(box);
  }
  return boxes;
}

/**
 * Per tile, the lowest and highest `y` a cap's triangles reach, as pairs: over its
 * full level (`index` with `starts` in triangles), widened by `margin` for the
 * coarser levels, which stray from it by at most their height error. A tile with no
 * full-level triangles, or every tile without `y`, gets `[yMin, yMax]`.
 */
export function capTileHeights(
  index: ArrayLike<number>,
  starts: Uint32Array,
  y: ArrayLike<number> | null,
  margin: number,
  yMin: number,
  yMax: number,
): Float32Array {
  const tiles = starts.length - 1;
  const heights = new Float32Array(tiles * 2);
  for (let t = 0; t < tiles; t++) {
    let low = Infinity;
    let high = -Infinity;
    const end = y ? starts[t + 1] * 3 : 0;
    for (let i = starts[t] * 3; i < end; i++) {
      const h = y![index[i]];
      if (h < low) low = h;
      if (h > high) high = h;
    }
    heights[2 * t] = low <= high ? low - margin : yMin;
    heights[2 * t + 1] = low <= high ? high + margin : yMax;
  }
  return heights;
}

/**
 * Per tile, whether its prism — its footprint `corners` (see
 * {@link chunkTileCorners}) over its `heights` (low, high pairs) — reaches into
 * `frustum`, which must be in the same frame. A tile is out only when all eight
 * corners are behind one plane, so a prism near a frustum corner stays in.
 */
export function tilesInView(
  frustum: Frustum,
  corners: ArrayLike<number>,
  heights: ArrayLike<number>,
  inView: Uint8Array,
): void {
  const planes = frustum.planes;
  for (let t = 0; t < inView.length; t++) {
    const low = heights[2 * t];
    const high = heights[2 * t + 1];
    let shows = 1;
    for (let p = 0; p < planes.length && shows; p++) {
      const { normal: n, constant } = planes[p];
      let behind = true;
      for (let k = 8 * t; k < 8 * t + 8 && behind; k += 2) {
        const d = n.x * corners[k] + n.z * corners[k + 1] + constant;
        if (d + n.y * low >= 0 || d + n.y * high >= 0) behind = false;
      }
      if (behind) shows = 0;
    }
    inView[t] = shows;
  }
}

const worldEye = new Vector3();
const nearest = new Vector3();

/**
 * Pick each tile's level of detail: the coarsest whose height error, projected at
 * the tile's nearest point to the eye, stays within `pixelError` pixels (see
 * {@link selectLodLevel}).
 *
 * @param eye the camera position in the boxes' frame
 * @param errors per level, the full one first: its height error, ascending
 * @param levels per tile, its current level; updated in place
 * @param scales per tile, written with its pixels per unit of height error when given
 * @param frame the boxes' frame to world, when the two differ: distances are
 *   measured in the world, and the height errors take its vertical scale (a
 *   vertical exaggeration)
 * @returns whether any tile changed level
 */
export function selectTileLevels(
  boxes: Box3[],
  eye: Vector3,
  scale: (distance: number) => number,
  errors: number[],
  pixelError: number,
  levels: Uint8Array,
  scales?: Float32Array,
  frame?: Matrix4,
): boolean {
  let changed = false;
  let vertical = 1;
  if (frame) {
    const m = frame.elements;
    vertical = Math.hypot(m[4], m[5], m[6]);
    worldEye.copy(eye).applyMatrix4(frame);
  }
  for (let t = 0; t < boxes.length; t++) {
    // Per axis is exact for the scale an exaggeration is: diagonal in the box's frame.
    const distance = frame
      ? boxes[t].clampPoint(eye, nearest).applyMatrix4(frame).distanceTo(worldEye)
      : boxes[t].distanceToPoint(eye);
    const ppu = scale(distance) * vertical;
    if (scales) scales[t] = ppu;
    const k = selectLodLevel(errors, ppu, pixelError, levels[t]);
    if (k !== levels[t]) {
      levels[t] = k;
      changed = true;
    }
  }
  return changed;
}

/**
 * The tiles whose drawn level (`applied`) is not the one wanted (`levels`), in the
 * order to redraw them: those that need more detail first, the most visible error
 * (`excess`, e.g. pixels) first; then those that can do with less, the least
 * visible first.
 */
export function orderTileChanges(
  levels: Uint8Array,
  applied: Uint8Array,
  excess: ArrayLike<number>,
): number[] {
  const finer: number[] = [];
  const coarser: number[] = [];
  for (let t = 0; t < levels.length; t++) {
    if (levels[t] < applied[t]) finer.push(t);
    else if (levels[t] > applied[t]) coarser.push(t);
  }
  finer.sort((a, b) => excess[b] - excess[a]);
  coarser.sort((a, b) => excess[a] - excess[b]);
  return finer.concat(coarser);
}

/** Room a {@link TilePool} keeps past its fullest layout, for tiles that grow. */
export const TILE_POOL_HEADROOM = 0.25;

/**
 * One cap's index drawn at a level per tile, laid out so that a tile changing
 * level rewrites that tile's slot and nothing else. A slot that grows moves to
 * the end; what a tile no longer uses is filled with degenerate triangles, which
 * draw nothing, until {@link compactTilePool} squeezes them out.
 */
export type TilePool = {
  /** what is drawn, up to `end` */
  index: Uint32Array;
  /** per level, the full one first: the cap's triangles */
  lists: ArrayLike<number>[];
  /** per level: where each tile starts in its list (triangles) */
  starts: Uint32Array[];
  /** what the full level is culled by (see {@link cullTilePool}); `null` = nothing */
  cull: TilePoolCull | null;
  /** per tile, whether it is in view (see {@link viewTilePool}): one that is not draws nothing */
  inView: Uint8Array;
  /** per tile, out of view but still drawn: a hide {@link flushTilePool} has not applied yet */
  viewStale: Uint8Array;
  viewStaleCount: number;
  /** per tile, its level */
  level: Uint8Array;
  /** per tile, where its slot starts, how long it is and how much of it is in use (indices) */
  slot: Uint32Array;
  room: Uint32Array;
  used: Uint32Array;
  end: number;
  /** indices in use; the rest of `[0, end)` is degenerate */
  live: number;
  /**
   * Written since the caller last uploaded, as `[start, count]` pairs, none empty:
   * WebGL2's `bufferSubData` reads a length of 0 as "to the end of the array".
   */
  written: number[];
};

/**
 * What a {@link TilePool}'s full level is culled by: the units above and below each
 * of its triangles, and per tile the distinct pairs among them — which tell what a
 * new open table changes in a tile without scanning its triangles.
 */
export type TilePoolCull = {
  above: Uint8Array;
  below: Uint8Array;
  /** the open table the tiles are brought to; `null` = everything shows */
  table: Uint8Array | null;
  /** per tile, where its pairs start (one past the end last) */
  pairStart: Uint32Array;
  pairAbove: Uint8Array;
  pairBelow: Uint8Array;
  /** full-level triangles per pair */
  pairTriangles: Uint32Array;
  /** per pair, whether it was showing when its tile was last written */
  pairDrawn: Uint8Array;
  /** per tile, its full-level triangles that show under `table` */
  visible: Uint32Array;
  /** per tile, drawn with more than `table` shows: a hide not applied yet */
  stale: Uint8Array;
  staleCount: number;
};

let pairSlots: Int32Array | null = null;

function createPoolCull(
  starts: Uint32Array,
  above: Uint8Array,
  below: Uint8Array,
): TilePoolCull {
  const tiles = starts.length - 1;
  const slots = (pairSlots ??= new Int32Array(1 << 16).fill(-1));
  const pairStart = new Uint32Array(tiles + 1);
  const pairAbove: number[] = [];
  const pairBelow: number[] = [];
  const pairTriangles: number[] = [];
  const visible = new Uint32Array(tiles);
  for (let t = 0; t < tiles; t++) {
    const first = pairAbove.length;
    for (let i = starts[t]; i < starts[t + 1]; i++) {
      const key = (above[i] << 8) | below[i];
      let p = slots[key];
      if (p < 0) {
        p = pairAbove.length;
        slots[key] = p;
        pairAbove.push(above[i]);
        pairBelow.push(below[i]);
        pairTriangles.push(0);
      }
      pairTriangles[p]++;
    }
    for (let p = first; p < pairAbove.length; p++) {
      slots[(pairAbove[p] << 8) | pairBelow[p]] = -1;
    }
    pairStart[t + 1] = pairAbove.length;
    visible[t] = starts[t + 1] - starts[t];
  }
  return {
    above,
    below,
    table: null,
    pairStart,
    pairAbove: Uint8Array.from(pairAbove),
    pairBelow: Uint8Array.from(pairBelow),
    pairTriangles: Uint32Array.from(pairTriangles),
    pairDrawn: new Uint8Array(pairAbove.length).fill(1),
    visible,
    stale: new Uint8Array(tiles),
    staleCount: 0,
  };
}

function pairShows(cull: TilePoolCull, p: number) {
  const table = cull.table;
  return !table || !!(table[cull.pairAbove[p]] || table[cull.pairBelow[p]]);
}

function markDrawn(cull: TilePoolCull, t: number) {
  for (let p = cull.pairStart[t]; p < cull.pairStart[t + 1]; p++) {
    cull.pairDrawn[p] = pairShows(cull, p) ? 1 : 0;
  }
  if (cull.stale[t]) {
    cull.stale[t] = 0;
    cull.staleCount--;
  }
}

function tileLength(pool: TilePool, t: number, k: number) {
  if (!pool.inView[t]) return 0;
  const cull = pool.cull;
  if (cull) {
    if (k === 0) return cull.visible[t] * 3;
    // A tile without full-level triangles has nothing to say it is buried.
    if (cull.visible[t] === 0 && pool.starts[0][t + 1] > pool.starts[0][t]) {
      return 0;
    }
  }
  return (pool.starts[k][t + 1] - pool.starts[k][t]) * 3;
}

function copyTile(pool: TilePool, t: number, k: number, at: number) {
  const cull = pool.cull;
  const n = tileLength(pool, t, k);
  if (pool.viewStale[t]) {
    pool.viewStale[t] = 0;
    pool.viewStaleCount--;
  }
  // Nothing to copy; and out of view, the culled copy below would not stop at `n`.
  if (n === 0) {
    if (cull) markDrawn(cull, t);
    return;
  }
  const first = pool.starts[k][t];
  const list = pool.lists[k] as Uint32Array;
  if (cull && k === 0 && n < (pool.starts[0][t + 1] - first) * 3) {
    const { above, below, table } = cull;
    const index = pool.index;
    let w = at;
    for (let i = first; i < pool.starts[0][t + 1]; i++) {
      if (!table![above[i]] && !table![below[i]]) continue;
      index[w++] = list[3 * i];
      index[w++] = list[3 * i + 1];
      index[w++] = list[3 * i + 2];
    }
  } else {
    pool.index.set(list.subarray(first * 3, first * 3 + n), at);
  }
  if (cull) markDrawn(cull, t);
}

/** A pool with each tile at `levels`, packed. */
export function createTilePool(
  lists: ArrayLike<number>[],
  starts: Uint32Array[],
  levels: Uint8Array,
): TilePool {
  const tiles = levels.length;
  let fullest = 0;
  for (let t = 0; t < tiles; t++) {
    let most = 0;
    for (const s of starts) most = Math.max(most, s[t + 1] - s[t]);
    fullest += most * 3;
  }
  const pool: TilePool = {
    index: new Uint32Array(Math.ceil(fullest * (1 + TILE_POOL_HEADROOM))),
    lists,
    starts,
    cull: null,
    inView: new Uint8Array(tiles).fill(1),
    viewStale: new Uint8Array(tiles),
    viewStaleCount: 0,
    level: levels.slice(),
    slot: new Uint32Array(tiles),
    room: new Uint32Array(tiles),
    used: new Uint32Array(tiles),
    end: 0,
    live: 0,
    written: [],
  };
  compactTilePool(pool);
  return pool;
}

/** Pack every tile at its level, slots exactly its size. Returns the indices written. */
export function compactTilePool(pool: TilePool): number {
  let at = 0;
  for (let t = 0; t < pool.level.length; t++) {
    const n = tileLength(pool, t, pool.level[t]);
    copyTile(pool, t, pool.level[t], at);
    pool.slot[t] = at;
    pool.room[t] = n;
    pool.used[t] = n;
    at += n;
  }
  pool.end = at;
  pool.live = at;
  pool.written.length = 0;
  if (at > 0) pool.written.push(0, at);
  return at;
}

/**
 * Cull the full level by an open `table` (`null` = draw it all), and a coarser tile
 * wherever none of its full-level triangles shows. A tile that would show more is
 * rewritten now; one that would only show less keeps what it draws (more than
 * needed, never a hole) and is left stale for {@link flushTilePool}. The first call
 * learns the cap's neighbours, per triangle of its full level. Returns the indices
 * written.
 */
export function cullTilePool(
  pool: TilePool,
  neighbours: { above: Uint8Array; below: Uint8Array },
  table: Uint8Array | null,
): number {
  const cull = (pool.cull ??= createPoolCull(
    pool.starts[0],
    neighbours.above,
    neighbours.below,
  ));
  cull.table = table;
  const tiles = pool.level.length;
  // Every count first: a write below may pack the whole pool.
  for (let t = 0; t < tiles; t++) {
    let visible = 0;
    for (let p = cull.pairStart[t]; p < cull.pairStart[t + 1]; p++) {
      if (pairShows(cull, p)) visible += cull.pairTriangles[p];
    }
    cull.visible[t] = visible;
  }
  let written = 0;
  for (let t = 0; t < tiles; t++) {
    let gains = false;
    let loses = false;
    let drew = false;
    for (let p = cull.pairStart[t]; p < cull.pairStart[t + 1]; p++) {
      const shows = pairShows(cull, p);
      const drawn = cull.pairDrawn[p] === 1;
      if (shows && !drawn) gains = true;
      if (!shows && drawn) loses = true;
      if (drawn) drew = true;
    }
    // A coarser tile is drawn whole or not at all.
    if (pool.level[t] > 0) {
      gains = cull.visible[t] > 0 && !drew;
      loses = cull.visible[t] === 0 && drew;
    }
    if (gains) {
      written += writePoolTile(pool, t, pool.level[t]);
    } else if (loses) {
      if (!cull.stale[t]) {
        cull.stale[t] = 1;
        cull.staleCount++;
      }
    } else {
      markDrawn(cull, t);
    }
  }
  return written;
}

/**
 * Apply the hides {@link cullTilePool} and {@link viewTilePool} left stale, until
 * about `budget` indices are written. Returns the indices written.
 */
export function flushTilePool(pool: TilePool, budget: number): number {
  const cull = pool.cull;
  let written = 0;
  for (let t = 0; t < pool.level.length; t++) {
    if (!cull?.staleCount && !pool.viewStaleCount) break;
    if (written >= budget) break;
    if (pool.viewStale[t] || cull?.stale[t]) {
      written += writePoolTile(pool, t, pool.level[t]);
    }
  }
  return written;
}

/**
 * Draw only the tiles `inView` marks (non-zero). A tile coming into view is written
 * now; one leaving keeps what it draws — off screen that costs vertex work, never a
 * hole — until {@link flushTilePool} reaches it. Returns the indices written.
 */
export function viewTilePool(
  pool: TilePool,
  inView: ArrayLike<number>,
): number {
  let written = 0;
  for (let t = 0; t < pool.inView.length; t++) {
    const shows = inView[t] ? 1 : 0;
    if (shows === pool.inView[t]) continue;
    pool.inView[t] = shows;
    if (shows && pool.viewStale[t]) {
      // Left but never emptied: any change since would have rewritten it.
      pool.viewStale[t] = 0;
      pool.viewStaleCount--;
    } else if (shows) {
      written += writePoolTile(pool, t, pool.level[t]);
    } else if (pool.used[t] > 0) {
      pool.viewStale[t] = 1;
      pool.viewStaleCount++;
    }
  }
  return written;
}

/** Whether {@link setPoolTile} can draw tile `t` at level `k` without packing the pool. */
export function fitsPoolTile(pool: TilePool, t: number, k: number): boolean {
  const n = tileLength(pool, t, k);
  if (pool.level[t] === k || n <= pool.room[t]) return true;
  const start = pool.slot[t];
  if (start + pool.room[t] === pool.end) return start + n <= pool.index.length;
  return pool.end + n <= pool.index.length;
}

/**
 * Draw tile `t` at level `k`: in its slot when it fits there (or is the last one),
 * otherwise in a new slot at the end, or after a compaction when there is no
 * room left (see {@link fitsPoolTile}). Returns the indices written.
 */
export function setPoolTile(pool: TilePool, t: number, k: number): number {
  if (pool.level[t] === k) return 0;
  return writePoolTile(pool, t, k);
}

/** {@link setPoolTile}, also when `t` is at `k` already: its content changed. */
function writePoolTile(pool: TilePool, t: number, k: number): number {
  const n = tileLength(pool, t, k);
  const old = pool.used[t];
  let start = pool.slot[t];
  let moved = 0;
  if (n > pool.room[t]) {
    if (start + pool.room[t] === pool.end && start + n <= pool.index.length) {
      pool.end = start + n;
    } else if (pool.end + n <= pool.index.length) {
      pool.index.fill(0, start, start + old);
      if (old > 0) pool.written.push(start, old);
      moved = old;
      start = pool.end;
      pool.slot[t] = start;
      pool.end += n;
    } else {
      pool.level[t] = k;
      return compactTilePool(pool);
    }
    pool.room[t] = n;
  }
  pool.level[t] = k;
  copyTile(pool, t, k, start);
  let span = n;
  if (!moved && n < old) {
    pool.index.fill(0, start + n, start + old);
    span = old;
  }
  if (span > 0) pool.written.push(start, span);
  pool.used[t] = n;
  pool.live += n - old;
  return moved + span;
}
