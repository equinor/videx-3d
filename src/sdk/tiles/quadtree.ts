import type { Vec3 } from '../types/common';
import { LOD_COARSEN_MARGIN } from '../utils/lod';
import {
  TILE_ROOT_SIZE,
  tileAddress,
  tileChildren,
  tileKey,
} from './tile-keys';

// ⚠️ What a tile holds, and how the view is tested, are the caller's.

/**
 * What {@link selectQuadtreeTiles} needs of a tile that is in.
 *
 * @group Tiles
 */
export type QuadtreeTileInfo = {
  /** how far its surface strays from the data it stands for, in scene units */
  error: number;
  /** the lowest and highest Y it reaches */
  minY: number;
  maxY: number;
  /** nothing finer lies under it: it is never split */
  leaf: boolean;
};

/**
 * How {@link selectQuadtreeTiles} chooses.
 *
 * @group Tiles
 */
export type QuadtreeSelectOptions = {
  /** the camera, in the tiles' frame */
  eye: Vec3;
  /** tiles wholly farther than this from the eye, along X/Z, are left out */
  reach: number;
  /** pixels one unit spans at a distance (see `pixelsPerUnit`) */
  pixelsPerUnit: (distance: number) => number;
  /** the most a tile's error may show on screen, in pixels */
  pixelError: number;
  /** the deepest tile, whatever the error. Default 24 */
  maxDepth?: number;
  /** the roots' width. Default {@link TILE_ROOT_SIZE} */
  rootSize?: number;
  /** a tile that is in, or undefined */
  info: (key: number) => QuadtreeTileInfo | undefined;
  /** whether a prism reaches into the view; omitted, every tile does */
  inView?: (
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    minY: number,
    maxY: number,
  ) => boolean;
  /** the most error allowed over a square, whatever it shows on screen; omitted, none */
  errorCap?: (minX: number, minZ: number, maxX: number, maxZ: number) => number;
  /**
   * Squares (min X, min Z, max X, max Z) where a tile's error may show less than
   * `pixelError`: a tile that overlaps one is split until its error shows no more than
   * that one's `pixelError` (the least of them), and merged back by the same rule.
   */
  finer?: {
    bounds: [number, number, number, number];
    pixelError: number;
  }[];
  /**
   * What a tile holds besides its shape — its shading, say — read at its cells: a tile
   * that is not a leaf is also split while its cells (`cells` along its side) span more
   * than `pixels` on screen at its nearest point, however small its error — but only where
   * the ground's slope strays from the tile's by more than `minSlope` (its error over half
   * a cell; default 0, everywhere): flat ground is shaded alike at any depth. Omitted,
   * only the error splits.
   */
  cellPixels?: { cells: number; pixels: number; minSlope?: number };
  /** the tiles split last time: one is merged back only once well under the limit */
  split?: ReadonlySet<number>;
};

/**
 * What {@link selectQuadtreeTiles} chose.
 *
 * @group Tiles
 */
export type QuadtreeSelection = {
  /** the tiles to draw: together they cover what is in view, once */
  draw: number[];
  /** the tiles wanted and not in, with how much: pixels of error over the limit, Infinity for a root */
  want: { key: number; priority: number }[];
  /** the tiles split this time, for the next call's `split` */
  split: Set<number>;
};

/**
 * Choose the tiles to draw from a quadtree in X/Z, roots `rootSize` wide about the origin.
 * A tile is split while its error, on screen at its nearest point, is over `pixelError`
 * — and merged back only once under it by `LOD_COARSEN_MARGIN`, as `selectLodLevel`
 * does — or while its error is over `errorCap` there, or (with `cellPixels`) while its
 * cells span more pixels there than allowed. Over `finer` squares the limit is theirs. A
 * split tile is drawn until all four of its
 * children in view are in, and those not in are wanted: the ground is never missing, nor
 * drawn twice. Tiles out of view are left out, judged by their own heights once in and
 * by their parent's until then.
 *
 * @group Tiles
 */
export function selectQuadtreeTiles(
  options: QuadtreeSelectOptions,
): QuadtreeSelection {
  const {
    eye,
    reach,
    pixelsPerUnit,
    pixelError,
    maxDepth = 24,
    rootSize = TILE_ROOT_SIZE,
    info,
    inView,
    errorCap,
    finer,
    cellPixels,
    split: wasSplit,
  } = options;
  const [ex, ey, ez] = eye;
  const draw: number[] = [];
  const want: QuadtreeSelection['want'] = [];
  const split = new Set<number>();

  // The most error a square's tile may show: the least of `pixelError` and the finer
  // squares it overlaps.
  const limitOver = (minX: number, minZ: number, size: number) => {
    let limit = pixelError;
    if (finer) {
      for (const { bounds, pixelError: error } of finer) {
        if (
          minX < bounds[2] &&
          minZ < bounds[3] &&
          minX + size > bounds[0] &&
          minZ + size > bounds[1]
        )
          limit = Math.min(limit, error);
      }
    }
    return limit;
  };

  // Along X/Z, from the eye to the nearest point of a square.
  const nearXZ = (minX: number, minZ: number, size: number) => {
    const dx = Math.max(minX - ex, ex - (minX + size), 0);
    const dz = Math.max(minZ - ez, ez - (minZ + size), 0);
    return Math.hypot(dx, dz);
  };
  const shows = (
    minX: number,
    minZ: number,
    size: number,
    minY: number,
    maxY: number,
  ) =>
    nearXZ(minX, minZ, size) <= reach &&
    (!inView || inView(minX, minZ, minX + size, minZ + size, minY, maxY));

  const visit = (key: number, tile: QuadtreeTileInfo) => {
    const [depth, i, j] = tileAddress(key);
    const size = rootSize / 2 ** depth;
    const minX = i * size;
    const minZ = j * size;
    const dy = Math.max(tile.minY - ey, ey - tile.maxY, 0);
    const scale = pixelsPerUnit(Math.hypot(nearXZ(minX, minZ, size), dy));
    const shown = tile.error * scale;
    // How far a cell spans on screen, over its limit (0 at the limit); only where the
    // ground's slope strays from the tile's.
    const cell = cellPixels ? size / cellPixels.cells : 0;
    const cellOver =
      cellPixels &&
      (!cellPixels.minSlope || tile.error > (cellPixels.minSlope * cell) / 2)
        ? cell * scale - cellPixels.pixels
        : -Infinity;
    const cap = errorCap
      ? errorCap(minX, minZ, minX + size, minZ + size)
      : Infinity;
    const limit = limitOver(minX, minZ, size);
    const wasThere = !!wasSplit?.has(key);
    const splits =
      !tile.leaf &&
      depth < maxDepth &&
      (shown > limit ||
        tile.error > cap ||
        cellOver > 0 ||
        (wasThere && shown > limit * LOD_COARSEN_MARGIN) ||
        (wasThere &&
          !!cellPixels &&
          cellOver > cellPixels.pixels * (LOD_COARSEN_MARGIN - 1)));
    if (!splits) {
      draw.push(key);
      return;
    }
    const children = tileChildren(key);
    const half = size / 2;
    const inside: [number, QuadtreeTileInfo | undefined][] = [];
    let missing = false;
    for (let c = 0; c < 4; c++) {
      const child = children[c];
      const childInfo = info(child);
      const range = childInfo ?? tile;
      const cx = minX + (c & 1) * half;
      const cz = minZ + (c >> 1) * half;
      if (!shows(cx, cz, half, range.minY, range.maxY)) continue;
      inside.push([child, childInfo]);
      if (!childInfo) missing = true;
    }
    if (missing) {
      draw.push(key);
      const priority = Math.max(
        shown - limit,
        cellOver,
        tile.error > cap ? limit : 0,
      );
      for (const [child, childInfo] of inside) {
        if (!childInfo) want.push({ key: child, priority });
      }
      return;
    }
    split.add(key);
    for (const [child, childInfo] of inside) visit(child, childInfo!);
  };

  const i0 = Math.floor((ex - reach) / rootSize);
  const i1 = Math.floor((ex + reach) / rootSize);
  const j0 = Math.floor((ez - reach) / rootSize);
  const j1 = Math.floor((ez + reach) / rootSize);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const minX = i * rootSize;
      const minZ = j * rootSize;
      if (nearXZ(minX, minZ, rootSize) > reach) continue;
      const key = tileKey(0, i, j);
      const root = info(key);
      if (!root) {
        want.push({ key, priority: Infinity });
        continue;
      }
      if (!shows(minX, minZ, rootSize, root.minY, root.maxY)) continue;
      visit(key, root);
    }
  }
  return { draw, want, split };
}

/**
 * The priority {@link selectPinnedTiles} wants its tiles with: ahead of any the view wants
 * but a root.
 *
 * @group Tiles
 */
export const PINNED_TILE_PRIORITY = 1e9;

/**
 * The tiles under pinned squares (min X, min Z, max X, max Z), down to the leaves: what
 * must stay in whatever the view, so what is placed there settles on the finest data.
 * Those in are kept, the first missing on each path is wanted, ahead of the view's. The
 * squares are walked together, each tile once with the squares over it; at most `limit`
 * tiles.
 *
 * @group Tiles
 */
export function selectPinnedTiles(options: {
  squares: [number, number, number, number][];
  /** whether a tile that is in is a leaf, or undefined while it is not in */
  info: (key: number) => { leaf: boolean } | undefined;
  /** the deepest tile. Default 24 */
  maxDepth?: number;
  /** the roots' width. Default {@link TILE_ROOT_SIZE} */
  rootSize?: number;
  /** the most tiles walked. Default 1024 */
  limit?: number;
}): { keep: number[]; want: { key: number; priority: number }[] } {
  const {
    squares,
    info,
    maxDepth = 24,
    rootSize = TILE_ROOT_SIZE,
    limit = 1024,
  } = options;
  type Square = [number, number, number, number];
  const keep: number[] = [];
  const want: { key: number; priority: number }[] = [];
  let walked = 0;
  const visit = (key: number, over: Square[]) => {
    if (walked >= limit) return;
    walked++;
    const tile = info(key);
    if (!tile) {
      want.push({ key, priority: PINNED_TILE_PRIORITY });
      return;
    }
    keep.push(key);
    const [depth] = tileAddress(key);
    if (tile.leaf || depth >= maxDepth) return;
    const size = rootSize / 2 ** (depth + 1);
    for (const child of tileChildren(key)) {
      const [, i, j] = tileAddress(child);
      const under = over.filter(
        ([x0, z0, x1, z1]) =>
          i * size <= x1 &&
          j * size <= z1 &&
          (i + 1) * size >= x0 &&
          (j + 1) * size >= z0,
      );
      if (under.length > 0) visit(child, under);
    }
  };
  const roots = new Map<number, Square[]>();
  for (const square of squares) {
    const [x0, z0, x1, z1] = square;
    for (
      let j = Math.floor(z0 / rootSize);
      j <= Math.floor(z1 / rootSize);
      j++
    ) {
      for (
        let i = Math.floor(x0 / rootSize);
        i <= Math.floor(x1 / rootSize);
        i++
      ) {
        const key = tileKey(0, i, j);
        const over = roots.get(key);
        if (over) over.push(square);
        else roots.set(key, [square]);
      }
    }
  }
  for (const [key, over] of roots) visit(key, over);
  return { keep, want };
}
