import type { Vec3 } from '../types/common';
import { LOD_COARSEN_MARGIN } from '../utils/lod';
import {
  TILE_ROOT_SIZE,
  tileAddress,
  tileChild,
  tileChildren,
  tileColumn,
  tileDepth,
  tileKey,
  tileParent,
  tileRow,
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
  /**
   * shaded unevenly whatever its shape — across a coast, say: `cellPixels` applies to it
   * whatever `minSlope` says
   */
  rough?: boolean;
};

/**
 * How a quadtree's tiles lie, when not as squares in X/Z about the origin (a geographic
 * quadtree's, say): its roots, each tile's square in the layout's own coordinates — in
 * which `finer` and pinned squares are given too — and, in scene units, how far a tile is
 * from the eye, whether it can be seen, and how wide it is along the ground.
 *
 * @group Tiles
 */
export type QuadtreeLayout = {
  roots: readonly number[];
  /** a tile's min corner and width, in the layout's coordinates */
  square(key: number): [number, number, number];
  /** from the eye to the nearest point of the tile, reaching from `minY` to `maxY` */
  distance(key: number, minY: number, maxY: number): number;
  /** whether the tile, reaching from `minY` to `maxY`, can be seen: within reach and in view */
  shows(key: number, minY: number, maxY: number): boolean;
  /** how wide the tile is along the ground: its cells are this over their count */
  width(key: number): number;
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
   * a cell; default 0, everywhere), or the tile is `rough`: flat ground is shaded alike at
   * any depth. `pixels` may be a function of the tile's distance (from its nearest point),
   * for a limit that changes across the view. Omitted, only the error splits.
   */
  cellPixels?: {
    cells: number;
    pixels: number | ((distance: number) => number);
    minSlope?: number;
  };
  /** the tiles split last time: one is merged back only once well under the limit */
  split?: ReadonlySet<number>;
  /**
   * how the tiles lie, when not as squares in X/Z (see {@link QuadtreeLayout}): then
   * `eye`, `reach`, `rootSize` and `inView` are not used, and `finer` and `errorCap` take
   * the layout's coordinates
   */
  layout?: QuadtreeLayout;
  /**
   * Where a split tile has some of its children in view in and others not: draw those in,
   * each as it is chosen, and fill the squares of those not in from the tile itself
   * (`fills`), rather than drawing the tile over all of them. Finer tiles already in then
   * stay drawn after a large zoom-out while the rest load. A tile none of whose children in
   * view are in is drawn whole, as without it. Default `false`
   */
  fill?: boolean;
  /**
   * Also want, at `prefetchPriority`, the siblings of each drawn tile's parent that are not
   * in: the level a zoom-out goes to next, ahead of it. Default `false`
   */
  prefetch?: boolean;
  /**
   * The tiles at the same depth touching a tile, across its edges and its corners
   * (`geoTileNeighbours`, say): given, no tile is drawn more than a level coarser than one
   * touching it. A coarser one is split, as the view would split it — a leaf too, whose
   * children hold no more than it — its children not in wanted, at
   * {@link BALANCE_TILE_PRIORITY}, and with `fill` their squares filled from it; so a
   * tile's edge blended toward its parent meets what is drawn next to it (a relief's seams).
   * Fills, and a tile whose children in view are none in (or without `fill`, not all),
   * are not split. Omitted, none.
   */
  balance?: (key: number) => readonly number[];
};

/** The priority {@link selectQuadtreeTiles} wants prefetched tiles at: after every other. */
export const PREFETCH_TILE_PRIORITY = -1;

/**
 * The priority {@link selectQuadtreeTiles} wants the tiles its `balance` splits for at:
 * after those the view wants, before prefetched ones.
 */
export const BALANCE_TILE_PRIORITY = 0;

/**
 * What {@link selectQuadtreeTiles} chose.
 *
 * @group Tiles
 */
export type QuadtreeSelection = {
  /** the tiles to draw: together with `fills`, they cover what is in view, once */
  draw: number[];
  /**
   * squares to draw from an ancestor's data until their own tile is in (`fill`): `key` the
   * tile not in, `source` the ancestor drawn in its place, which is in. Empty without `fill`
   */
  fills: { key: number; source: number }[];
  /** the tiles wanted and not in, with how much: pixels of error over the limit, Infinity for a root */
  want: { key: number; priority: number }[];
  /** the tiles split this time, for the next call's `split` */
  split: Set<number>;
  /** prefetched tiles that are in (`prefetch`): keep them in as the drawn ones are */
  prefetched: number[];
};

/**
 * Choose the tiles to draw from a quadtree in X/Z, roots `rootSize` wide about the origin.
 * A tile is split while its error, on screen at its nearest point, is over `pixelError`
 * — and merged back only once under it by `LOD_COARSEN_MARGIN`, as `selectLodLevel`
 * does — or while its error is over `errorCap` there, or (with `cellPixels`) while its
 * cells span more pixels there than allowed. Over `finer` squares the limit is theirs. A
 * split tile is drawn until all four of its
 * children in view are in — or, with `fill`, its children in are drawn and the squares of
 * those not in are filled from it — and those not in are wanted: the ground is never
 * missing, nor drawn twice. Tiles out of view are left out, judged by their own heights
 * once in and by their parent's until then.
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
    layout,
    fill = false,
    prefetch = false,
    balance,
  } = options;
  const [ex, ey, ez] = eye;
  const draw: number[] = [];
  const fills: QuadtreeSelection['fills'] = [];
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

  // A tile's square, how far it is, whether it shows and how wide it is: the layout's, or
  // as squares in X/Z. ⚠️ No tuples where the choice asks a tile at a time: it asks
  // thousands of times a frame, and each was garbage (2026-11-19).
  const squareOf = (key: number): [number, number, number] => {
    if (layout) return layout.square(key);
    const [depth, i, j] = tileAddress(key);
    const size = rootSize / 2 ** depth;
    return [i * size, j * size, size];
  };
  const sizeOf = (key: number) => rootSize / 2 ** tileDepth(key);
  const distanceOf = (key: number, minY: number, maxY: number) => {
    if (layout) return layout.distance(key, minY, maxY);
    const size = sizeOf(key);
    return Math.hypot(
      nearXZ(tileColumn(key) * size, tileRow(key) * size, size),
      Math.max(minY - ey, ey - maxY, 0),
    );
  };
  const showsTile = (key: number, minY: number, maxY: number) => {
    if (layout) return layout.shows(key, minY, maxY);
    const size = sizeOf(key);
    return shows(tileColumn(key) * size, tileRow(key) * size, size, minY, maxY);
  };
  // Only these need a tile's square in the layout's coordinates.
  const bySquare = !!errorCap || (finer !== undefined && finer.length > 0);

  // The children in view of the tile `visit` splits at each depth (it goes a level down at
  // a time): 4 slots a depth.
  const insideKeys = new Float64Array(4 * (maxDepth + 1));
  const insideInfo: (QuadtreeTileInfo | undefined)[] = new Array(
    4 * (maxDepth + 1),
  );

  const visit = (key: number, tile: QuadtreeTileInfo) => {
    const depth = tileDepth(key);
    const distance = distanceOf(key, tile.minY, tile.maxY);
    const scale = pixelsPerUnit(distance);
    const shown = tile.error * scale;
    // How far a cell spans on screen, over its limit (0 at the limit); only where the
    // ground's slope strays from the tile's.
    const cell = cellPixels
      ? (layout ? layout.width(key) : sizeOf(key)) / cellPixels.cells
      : 0;
    const cellLimit = !cellPixels
      ? 0
      : typeof cellPixels.pixels === 'function'
        ? cellPixels.pixels(distance)
        : cellPixels.pixels;
    const cellOver =
      cellPixels &&
      (!cellPixels.minSlope ||
        tile.rough ||
        tile.error > (cellPixels.minSlope * cell) / 2)
        ? cell * scale - cellLimit
        : -Infinity;
    let cap = Infinity;
    let limit = pixelError;
    if (bySquare) {
      const [minX, minZ, size] = squareOf(key);
      if (errorCap) cap = errorCap(minX, minZ, minX + size, minZ + size);
      limit = limitOver(minX, minZ, size);
    }
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
          cellOver > cellLimit * (LOD_COARSEN_MARGIN - 1)));
    if (!splits) {
      draw.push(key);
      return;
    }
    const at = 4 * depth;
    let count = 0;
    let missing = false;
    let some = false;
    for (let c = 0; c < 4; c++) {
      const child = tileChild(key, c);
      const childInfo = info(child);
      const range = childInfo ?? tile;
      if (!showsTile(child, range.minY, range.maxY)) continue;
      insideKeys[at + count] = child;
      insideInfo[at + count] = childInfo;
      count++;
      if (!childInfo) missing = true;
      else some = true;
    }
    if (missing) {
      const priority = Math.max(
        shown - limit,
        cellOver,
        tile.error > cap ? limit : 0,
      );
      for (let n = at; n < at + count; n++) {
        if (!insideInfo[n]) want.push({ key: insideKeys[n], priority });
      }
      if (!fill || !some) {
        draw.push(key);
        return;
      }
      // Those in as chosen, the rest filled from this tile.
      split.add(key);
      for (let n = at; n < at + count; n++) {
        const childInfo = insideInfo[n];
        if (childInfo) visit(insideKeys[n], childInfo);
        else fills.push({ key: insideKeys[n], source: key });
      }
      return;
    }
    split.add(key);
    for (let n = at; n < at + count; n++) visit(insideKeys[n], insideInfo[n]!);
  };

  // Balanced (`balance`): a drawn tile more than a level coarser than one touching it is
  // split, until none is; each tile split brings its children in to be looked at in turn.
  const balanceDrawn = () => {
    if (!balance) return;
    const drawn = new Set(draw);
    const filled = new Set<number>();
    for (const { key } of fills) filled.add(key);
    const wanted = new Set<number>();
    for (const { key } of want) wanted.add(key);
    // The children a split draws, in turn: after those chosen, those still drawn.
    const added: number[] = [];
    // The tile drawn or filled over a square: it, or its nearest ancestor that is.
    const covering = (key: number): number | null => {
      for (let at = key; ; at = tileParent(at)) {
        if (drawn.has(at) || filled.has(at)) return at;
        if (tileDepth(at) === 0) return null;
      }
    };
    // Split `at` for balance: false where it cannot be (its children in view not in). A leaf
    // too: its children hold no more than it, but meet a finer neighbour's parent.
    const splitKeys = new Float64Array(4);
    const splitIn = [false, false, false, false];
    const splitFor = (at: number): boolean => {
      const tile = info(at);
      if (!tile || tileDepth(at) >= maxDepth) return false;
      let count = 0;
      let some = false;
      let missing = false;
      for (let c = 0; c < 4; c++) {
        const child = tileChild(at, c);
        const childInfo = info(child);
        const range = childInfo ?? tile;
        if (!showsTile(child, range.minY, range.maxY)) continue;
        splitKeys[count] = child;
        splitIn[count] = !!childInfo;
        count++;
        if (childInfo) some = true;
        else missing = true;
      }
      for (let n = 0; n < count; n++) {
        const child = splitKeys[n];
        if (splitIn[n] || wanted.has(child)) continue;
        wanted.add(child);
        want.push({ key: child, priority: BALANCE_TILE_PRIORITY });
      }
      if (count === 0 || (missing && (!fill || !some))) return false;
      drawn.delete(at);
      split.add(at);
      for (let n = 0; n < count; n++) {
        const child = splitKeys[n];
        if (splitIn[n]) {
          drawn.add(child);
          added.push(child);
        } else {
          filled.add(child);
          fills.push({ key: child, source: at });
        }
        queue.push(child);
      }
      return true;
    };
    const queue = draw.slice();
    for (const key of filled) queue.push(key);
    while (queue.length > 0) {
      const key = queue.pop()!;
      if (!drawn.has(key) && !filled.has(key)) continue;
      const depth = tileDepth(key);
      if (depth < 2) continue;
      // Each neighbour's tile split until within a level of this one, or it cannot be.
      for (const neighbour of balance(key)) {
        for (;;) {
          const at = covering(neighbour);
          if (at === null || !drawn.has(at)) break;
          if (tileDepth(at) >= depth - 1 || !splitFor(at)) break;
        }
      }
    }
    // In the order chosen, those split for it left out and their children after.
    let kept = 0;
    for (let n = 0; n < draw.length; n++)
      if (drawn.has(draw[n])) draw[kept++] = draw[n];
    draw.length = kept;
    for (const key of added) if (drawn.has(key)) draw.push(key);
  };

  // The siblings of each drawn tile's parent not in: wanted last.
  const prefetched: number[] = [];
  const prefetchAround = () => {
    if (!prefetch) return;
    const seen = new Set<number>();
    for (const key of draw) {
      if (tileDepth(key) < 2) continue;
      const parent = tileParent(key);
      const grand = tileParent(parent);
      if (seen.has(grand)) continue;
      seen.add(grand);
      for (let c = 0; c < 4; c++) {
        const aunt = tileChild(grand, c);
        if (aunt === parent) continue;
        if (info(aunt)) prefetched.push(aunt);
        else want.push({ key: aunt, priority: PREFETCH_TILE_PRIORITY });
      }
    }
  };

  if (layout) {
    for (const key of layout.roots) {
      const root = info(key);
      if (!root) {
        want.push({ key, priority: Infinity });
        continue;
      }
      if (!showsTile(key, root.minY, root.maxY)) continue;
      visit(key, root);
    }
    balanceDrawn();
    prefetchAround();
    return { draw, fills, want, split, prefetched };
  }
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
  balanceDrawn();
  prefetchAround();
  return { draw, fills, want, split, prefetched };
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
  /** how the tiles lie (see {@link QuadtreeLayout}): `squares` are in its coordinates */
  layout?: Pick<QuadtreeLayout, 'roots' | 'square'>;
}): { keep: number[]; want: { key: number; priority: number }[] } {
  const {
    squares,
    info,
    maxDepth = 24,
    rootSize = TILE_ROOT_SIZE,
    limit = 1024,
    layout,
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
    const depth = tileDepth(key);
    if (tile.leaf || depth >= maxDepth) return;
    for (const child of tileChildren(key)) {
      const [cx, cz, size] = squareOf(child);
      const under = over.filter(
        ([x0, z0, x1, z1]) =>
          cx <= x1 && cz <= z1 && cx + size >= x0 && cz + size >= z0,
      );
      if (under.length > 0) visit(child, under);
    }
  };
  const squareOf = (key: number): [number, number, number] => {
    if (layout) return layout.square(key);
    const [depth, i, j] = tileAddress(key);
    const size = rootSize / 2 ** depth;
    return [i * size, j * size, size];
  };
  const roots = new Map<number, Square[]>();
  if (layout) {
    for (const key of layout.roots) {
      const [rx, rz, size] = squareOf(key);
      const over = squares.filter(
        ([x0, z0, x1, z1]) =>
          rx <= x1 && rz <= z1 && rx + size >= x0 && rz + size >= z0,
      );
      if (over.length > 0) roots.set(key, over);
    }
  }
  for (const square of layout ? [] : squares) {
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
