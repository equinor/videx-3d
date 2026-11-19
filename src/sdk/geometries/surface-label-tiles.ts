// ⚠️ Free of three.js.

/**
 * A tile of a surface grid's quadtree, as contour labels are found on it (see
 * {@link surfaceLabelTiles}): every `2^level`-th of the grid's nodes (0 its own), `cells`
 * of them across, `column` and `row` its place among the tiles of its level.
 *
 * @group Geometries
 */
export type SurfaceLabelTile = { level: number; column: number; row: number };

const SHIFT = 2 ** 16;

/** A {@link SurfaceLabelTile}'s key: one number, the same for the same tile. @group Geometries */
export const surfaceLabelTileKey = ({ level, column, row }: SurfaceLabelTile) =>
  (level * SHIFT + row) * SHIFT + column;

/** The tile a {@link surfaceLabelTileKey} is of. @group Geometries */
export function surfaceLabelTileOf(key: number): SurfaceLabelTile {
  const column = key % SHIFT;
  const rest = (key - column) / SHIFT;
  const row = rest % SHIFT;
  return { level: (rest - row) / SHIFT, column, row };
}

/**
 * The coarsest level of a grid `nx` by `ny` nodes in tiles of `cells`: the first whose one
 * tile covers it.
 *
 * @group Geometries
 */
export function surfaceLabelTileLevels(
  nx: number,
  ny: number,
  cells: number,
): number {
  const extent = Math.max(nx, ny, 2) - 1;
  return Math.max(Math.ceil(Math.log2(extent / cells) - 1e-9), 0);
}

/**
 * The grid's columns and rows a tile spans: `[column0, row0, column1, row1]`, from its first
 * node to its last, the last perhaps past the grid's.
 *
 * @group Geometries
 */
export function surfaceLabelTileSpan(
  { level, column, row }: SurfaceLabelTile,
  cells: number,
): [number, number, number, number] {
  const across = cells * 2 ** level;
  return [
    column * across,
    row * across,
    (column + 1) * across,
    (row + 1) * across,
  ];
}

/**
 * The tiles of a grid `nx` by `ny` nodes to find contour labels on as seen: from the one
 * covering the whole grid (level {@link surfaceLabelTileLevels}), each split in four while
 * `split` asks for it and it is coarser than the grid's own nodes, those wholly off the
 * grid left out. Their keys ({@link surfaceLabelTileKey}).
 *
 * @group Geometries
 */
export function surfaceLabelTiles(
  nx: number,
  ny: number,
  cells: number,
  split: (tile: SurfaceLabelTile) => boolean,
): number[] {
  const keys: number[] = [];
  const visit = (tile: SurfaceLabelTile) => {
    const [column0, row0] = surfaceLabelTileSpan(tile, cells);
    if (column0 >= nx - 1 || row0 >= ny - 1) return;
    if (tile.level > 0 && split(tile)) {
      const level = tile.level - 1;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++)
          visit({ level, column: 2 * tile.column + i, row: 2 * tile.row + j });
    } else keys.push(surfaceLabelTileKey(tile));
  };
  visit({ level: surfaceLabelTileLevels(nx, ny, cells), column: 0, row: 0 });
  return keys;
}

/**
 * A surface tile's heights as `reliefContourLabelPoints` takes them: `(cells + 3)²` nodes, a
 * border of one round its own, row by row, every `2^level`-th of the grid's `values`
 * (row-major, `nx` a row) as `height` gives them, held to the grid at its edges. With which
 * nodes a label must not lie by (`refused`, 1): those off the grid or without data (`valid`
 * false), and those next to one, where the lines would run along the drop to nothing or
 * on past the grid's edge. And the least and most height of its own nodes with data; null
 * if none has any.
 *
 * @group Geometries
 */
export function surfaceLabelTileGround(
  values: ArrayLike<number>,
  nx: number,
  ny: number,
  cells: number,
  key: number,
  height: (value: number) => number,
  valid: (value: number) => boolean,
): {
  heights: Float32Array;
  refused: Uint8Array;
  low: number;
  high: number;
} | null {
  const tile = surfaceLabelTileOf(key);
  const stride = 2 ** tile.level;
  const [column0, row0] = surfaceLabelTileSpan(tile, cells);
  const nodes = cells + 3;
  const heights = new Float32Array(nodes * nodes);
  const missing = new Uint8Array(nodes * nodes);
  let low = Infinity;
  let high = -Infinity;
  for (let j = 0; j < nodes; j++) {
    const row = row0 + (j - 1) * stride;
    const inRows = row >= 0 && row <= ny - 1;
    const r = Math.min(Math.max(row, 0), ny - 1);
    for (let i = 0; i < nodes; i++) {
      const column = column0 + (i - 1) * stride;
      const c = Math.min(Math.max(column, 0), nx - 1);
      const value = values[r * nx + c];
      const at = j * nodes + i;
      heights[at] = height(value);
      if (!inRows || column < 0 || column > nx - 1 || !valid(value)) {
        missing[at] = 1;
        continue;
      }
      if (i > 0 && j > 0 && i <= cells + 1 && j <= cells + 1) {
        low = Math.min(low, heights[at]);
        high = Math.max(high, heights[at]);
      }
    }
  }
  if (low > high) return null;
  const refused = new Uint8Array(nodes * nodes);
  for (let j = 0; j < nodes; j++)
    for (let i = 0; i < nodes; i++) {
      if (!missing[j * nodes + i]) continue;
      for (let y = Math.max(j - 1, 0); y <= Math.min(j + 1, nodes - 1); y++)
        for (let x = Math.max(i - 1, 0); x <= Math.min(i + 1, nodes - 1); x++)
          refused[y * nodes + x] = 1;
    }
  return { heights, refused, low, high };
}
