import type { Vec2 } from '../types/common';

// ⚠️ Free of three.js: it runs where the generators run.

/**
 * A tile of ground drawn as a height field: its square, and the slot its heights are in.
 *
 * @group Geometries
 */
export type HeightFieldTile = {
  minX: number;
  minZ: number;
  width: number;
  slot: number;
};

/**
 * Which tile is drawn where over a region (see `HeightFieldClip`): a grid of entries,
 * each the tile that covers its middle.
 *
 * @group Geometries
 */
export type HeightFieldIndex = {
  /** the grid's min X/Z, a multiple of `entry` */
  origin: Vec2;
  /** an entry's width */
  entry: number;
  /** entries along X and along Z */
  size: [number, number];
  /** per entry, row by row from min Z: its tile's min X, min Z, width and slot; slot -1 where none */
  data: Float32Array;
};

/**
 * Index the tiles drawn over `region` (min X, min Z, max X, max Z). The entries are as
 * wide as the narrowest tile and aligned to it — tiles of a quadtree, whatever point their
 * coordinates are taken about, then cover whole entries; past `maxEntries` along a side
 * they are wider, each the tile at its middle.
 * An earlier tile is not overwritten by a later one. An entry no tile covers takes
 * `fill` at its middle, if given.
 *
 * @returns null without tiles
 *
 * @group Geometries
 */
export function buildHeightFieldIndex(
  tiles: HeightFieldTile[],
  region: [number, number, number, number],
  fill?: (x: number, z: number) => HeightFieldTile | undefined,
  maxEntries = 1024,
): HeightFieldIndex | null {
  if (tiles.length === 0) return null;
  const [x0, z0, x1, z1] = region;
  // The narrowest tile: the entries are on its grid, wherever the coordinates' origin lies.
  let narrowest = tiles[0];
  for (const tile of tiles) if (tile.width < narrowest.width) narrowest = tile;
  let entry = narrowest.width;
  let ox = 0;
  let oz = 0;
  let nx = 1;
  let nz = 1;
  for (;;) {
    ox = narrowest.minX + Math.floor((x0 - narrowest.minX) / entry) * entry;
    oz = narrowest.minZ + Math.floor((z0 - narrowest.minZ) / entry) * entry;
    nx = Math.max(Math.ceil((x1 - ox) / entry), 1);
    nz = Math.max(Math.ceil((z1 - oz) / entry), 1);
    if (Math.max(nx, nz) <= maxEntries) break;
    entry *= 2;
  }
  const data = new Float32Array(nx * nz * 4);
  for (let k = 3; k < data.length; k += 4) data[k] = -1;
  const put = (k: number, tile: HeightFieldTile) => {
    data[k] = tile.minX;
    data[k + 1] = tile.minZ;
    data[k + 2] = tile.width;
    data[k + 3] = tile.slot;
  };
  for (const tile of tiles) {
    // The entries whose middle lies in the tile.
    const i0 = Math.max(Math.ceil((tile.minX - ox) / entry - 0.5), 0);
    const i1 = Math.min(
      Math.ceil((tile.minX + tile.width - ox) / entry - 0.5) - 1,
      nx - 1,
    );
    const j0 = Math.max(Math.ceil((tile.minZ - oz) / entry - 0.5), 0);
    const j1 = Math.min(
      Math.ceil((tile.minZ + tile.width - oz) / entry - 0.5) - 1,
      nz - 1,
    );
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = 4 * (j * nx + i);
        if (data[k + 3] < 0) put(k, tile);
      }
    }
  }
  if (fill) {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = 4 * (j * nx + i);
        if (data[k + 3] >= 0) continue;
        const tile = fill(ox + (i + 0.5) * entry, oz + (j + 0.5) * entry);
        if (tile) put(k, tile);
      }
    }
  }
  return { origin: [ox, oz], entry, size: [nx, nz], data };
}

/**
 * Where `index` holds X/Z: the offset of its entry's tile in `data`, or -1 outside the
 * index or where no tile is.
 *
 * @group Geometries
 */
export function heightFieldIndexAt(
  index: HeightFieldIndex,
  x: number,
  z: number,
): number {
  const i = Math.floor((x - index.origin[0]) / index.entry);
  const j = Math.floor((z - index.origin[1]) / index.entry);
  const [nx, nz] = index.size;
  if (i < 0 || j < 0 || i >= nx || j >= nz) return -1;
  const k = 4 * (j * nx + i);
  return index.data[k + 3] < 0 ? -1 : k;
}

/**
 * The height of a patch of `cells` x `cells` cells at (`u`, `v`), in cells from its min
 * corner and clamped to it, as its triangles draw it: each cell split along the diagonal
 * from node (i + 1, j) to node (i, j + 1). `node(i, j)` gives a node's height.
 *
 * @group Geometries
 */
export function heightFieldPatchAt(
  node: (i: number, j: number) => number,
  cells: number,
  u: number,
  v: number,
): number {
  const fu = Math.min(Math.max(u, 0), cells);
  const fv = Math.min(Math.max(v, 0), cells);
  const i = Math.min(Math.floor(fu), cells - 1);
  const j = Math.min(Math.floor(fv), cells - 1);
  const tu = fu - i;
  const tv = fv - j;
  const h10 = node(i + 1, j);
  const h01 = node(i, j + 1);
  if (tu + tv <= 1) {
    const h00 = node(i, j);
    return h00 + tu * (h10 - h00) + tv * (h01 - h00);
  }
  const h11 = node(i + 1, j + 1);
  return h11 + (1 - tu) * (h01 - h11) + (1 - tv) * (h10 - h11);
}

/**
 * The slope of a patch's triangle at (`u`, `v`), as {@link heightFieldPatchAt} draws it:
 * how far the height rises per cell along `u` and along `v`.
 *
 * @group Geometries
 */
export function heightFieldPatchSlope(
  node: (i: number, j: number) => number,
  cells: number,
  u: number,
  v: number,
): Vec2 {
  const fu = Math.min(Math.max(u, 0), cells);
  const fv = Math.min(Math.max(v, 0), cells);
  const i = Math.min(Math.floor(fu), cells - 1);
  const j = Math.min(Math.floor(fv), cells - 1);
  const h10 = node(i + 1, j);
  const h01 = node(i, j + 1);
  if (fu - i + (fv - j) <= 1) {
    const h00 = node(i, j);
    return [h10 - h00, h01 - h00];
  }
  const h11 = node(i + 1, j + 1);
  return [h11 - h01, h11 - h10];
}
