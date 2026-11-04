import { tileAddress, tileParent } from './tile-keys';

// ⚠️ Free of three.js: the relief's labels find their lines with it where the generators run.

/**
 * Bits of a drawn tile's edge mask ({@link tileCoarserEdges}): an edge or a corner where a
 * tile drawn coarser touches it — west toward its column − 1, north toward its row − 1 (a
 * geographic tile's rows run south) — and which quarter of its parent it is.
 *
 * @group Tiles
 */
export const TILE_EDGE = {
  west: 1,
  east: 2,
  north: 4,
  south: 8,
  northWest: 16,
  northEast: 32,
  southWest: 64,
  southEast: 128,
  /** its column is odd: the east half of its parent */
  oddColumn: 256,
  /** its row is odd: the south half of its parent */
  oddRow: 512,
} as const;

/** The bits of {@link TILE_EDGE} that are edges or corners. */
export const TILE_EDGE_SIDES = 255;

/**
 * How far into a tile, in its cells, its surface blends toward its parent's from an edge
 * or a corner where a tile drawn coarser touches it ({@link tileEdgeWeight}).
 *
 * @group Tiles
 */
export const TILE_EDGE_BAND = 4;

// Each edge and corner: its bit, and the neighbour across it, columns east and rows south.
const SIDES: [bit: number, columns: number, rows: number][] = [
  [TILE_EDGE.west, -1, 0],
  [TILE_EDGE.east, 1, 0],
  [TILE_EDGE.north, 0, -1],
  [TILE_EDGE.south, 0, 1],
  [TILE_EDGE.northWest, -1, -1],
  [TILE_EDGE.northEast, 1, -1],
  [TILE_EDGE.southWest, -1, 1],
  [TILE_EDGE.southEast, 1, 1],
];

/**
 * A drawn tile's edge mask ({@link TILE_EDGE}): which of its edges and corners touch a
 * tile drawn coarser than it — there its surface is blended toward its parent's
 * ({@link tileEdgeWeight}), which meets that coarser tile exactly, as tiles at one depth
 * meet each other — and which quarter of its parent it is. `depth` is how deep the data
 * drawn over it is; `depthOf` the same for any tile drawn (a fill's, its source's), and
 * undefined for one not drawn; `neighbour` the tile at its depth `columns` east and `rows`
 * south of it, or null (`geoTileNeighbour`). The tile drawn over a neighbour is that
 * neighbour or its nearest ancestor drawn; none (finer ones, or none at all) is not coarser.
 *
 * @group Tiles
 */
export function tileCoarserEdges(
  key: number,
  depth: number,
  depthOf: (key: number) => number | undefined,
  neighbour: (key: number, columns: number, rows: number) => number | null,
): number {
  const [, i, j] = tileAddress(key);
  let mask =
    (((i % 2) + 2) % 2 === 1 ? TILE_EDGE.oddColumn : 0) |
    (((j % 2) + 2) % 2 === 1 ? TILE_EDGE.oddRow : 0);
  for (const [bit, columns, rows] of SIDES) {
    const next = neighbour(key, columns, rows);
    if (next === null) continue;
    for (let at = next; ; at = tileParent(at)) {
      const drawn = depthOf(at);
      if (drawn !== undefined) {
        if (drawn < depth) mask |= bit;
        break;
      }
      if (tileAddress(at)[0] === 0) break;
    }
  }
  return mask;
}

/**
 * How much of its parent's surface a tile takes at `u`, `v` across it (0…1 east and
 * south), by its edge mask: all of it on an edge or at a corner a coarser tile touches,
 * none past {@link TILE_EDGE_BAND} of its `cells` from them, eased between (a smoothstep).
 * From a corner, the distance is the larger of the two along the axes, so two tiles at
 * one depth either side of an edge blend alike along it.
 *
 * @group Tiles
 */
export function tileEdgeWeight(
  mask: number,
  u: number,
  v: number,
  cells: number,
): number {
  if ((mask & TILE_EDGE_SIDES) === 0) return 0;
  const w = u * cells;
  const e = (1 - u) * cells;
  const n = v * cells;
  const s = (1 - v) * cells;
  let d = Infinity;
  if (mask & TILE_EDGE.west) d = Math.min(d, w);
  if (mask & TILE_EDGE.east) d = Math.min(d, e);
  if (mask & TILE_EDGE.north) d = Math.min(d, n);
  if (mask & TILE_EDGE.south) d = Math.min(d, s);
  if (mask & TILE_EDGE.northWest) d = Math.min(d, Math.max(w, n));
  if (mask & TILE_EDGE.northEast) d = Math.min(d, Math.max(e, n));
  if (mask & TILE_EDGE.southWest) d = Math.min(d, Math.max(w, s));
  if (mask & TILE_EDGE.southEast) d = Math.min(d, Math.max(e, s));
  const x = Math.min(Math.max(d / TILE_EDGE_BAND, 0), 1);
  return 1 - x * x * (3 - 2 * x);
}

/**
 * A tile's heights (`(cells + 3)²`, a border of one node round its own, row by row from
 * the north) with its own nodes blended toward its parent's surface by its edge mask
 * ({@link tileEdgeWeight}): its parent's (the same layout) read bilinear between its
 * nodes, as the relief shades its ground. A mask with no edge or corner set returns
 * `heights` itself.
 *
 * @group Tiles
 */
export function blendTileEdgeHeights(
  heights: ArrayLike<number>,
  parent: ArrayLike<number>,
  cells: number,
  mask: number,
): ArrayLike<number> {
  if ((mask & TILE_EDGE_SIDES) === 0) return heights;
  const nodes = cells + 3;
  const out = Float32Array.from(heights);
  const column0 = mask & TILE_EDGE.oddColumn ? cells / 2 : 0;
  const row0 = mask & TILE_EDGE.oddRow ? cells / 2 : 0;
  for (let row = 0; row <= cells; row++) {
    for (let column = 0; column <= cells; column++) {
      const weight = tileEdgeWeight(mask, column / cells, row / cells, cells);
      if (weight <= 0) continue;
      // Where it lies among its parent's own nodes.
      const x = column0 + column / 2;
      const y = row0 + row / 2;
      const i = Math.min(Math.floor(x), cells - 1);
      const j = Math.min(Math.floor(y), cells - 1);
      const fx = x - i;
      const fy = y - j;
      const at = (a: number, b: number) => parent[(1 + b) * nodes + 1 + a];
      const surface =
        (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) +
        (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
      const k = (1 + row) * nodes + 1 + column;
      out[k] += (surface - out[k]) * weight;
    }
  }
  return out;
}
