// ⚠️ Free of three.js: the tiles' builders run where the generators run.

/**
 * The width of a root tile of the scene's quadtree, in scene units: 2^21, about 2100 km
 * in metres. A tile at depth `d` is `TILE_ROOT_SIZE / 2^d` wide.
 *
 * @group Tiles
 */
export const TILE_ROOT_SIZE = 2 ** 21;

const SPAN = 2 ** 24;
const HALF = 2 ** 23;

/**
 * One number for tile (`depth`, `i`, `j`) of the quadtree: column `i` along X and row
 * `j` along Z, at most 2^23 either side of the origin, depth under 32.
 *
 * @group Tiles
 */
export function tileKey(depth: number, i: number, j: number): number {
  return (depth * SPAN + (i + HALF)) * SPAN + (j + HALF);
}

/**
 * The depth, column and row of a {@link tileKey}.
 *
 * @group Tiles
 */
export function tileAddress(key: number): [number, number, number] {
  const j = (key % SPAN) - HALF;
  const rest = Math.floor(key / SPAN);
  const i = (rest % SPAN) - HALF;
  const depth = Math.floor(rest / SPAN);
  return [depth, i, j];
}

/**
 * The min X, min Z and width of a tile, for roots `rootSize` wide.
 *
 * @group Tiles
 */
export function tileSquare(
  key: number,
  rootSize = TILE_ROOT_SIZE,
): [number, number, number] {
  const [depth, i, j] = tileAddress(key);
  const size = rootSize / 2 ** depth;
  return [i * size, j * size, size];
}

/**
 * The tile at `depth` that holds point (`x`, `z`), for roots `rootSize` wide. A point on
 * an edge belongs to the tile it starts.
 *
 * @group Tiles
 */
export function tileKeyAt(
  depth: number,
  x: number,
  z: number,
  rootSize = TILE_ROOT_SIZE,
): number {
  const size = rootSize / 2 ** depth;
  return tileKey(depth, Math.floor(x / size), Math.floor(z / size));
}

/**
 * The tile one level up.
 *
 * @group Tiles
 */
export function tileParent(key: number): number {
  const [depth, i, j] = tileAddress(key);
  return tileKey(depth - 1, Math.floor(i / 2), Math.floor(j / 2));
}

/**
 * The four tiles one level down: along X, then along Z.
 *
 * @group Tiles
 */
export function tileChildren(key: number): [number, number, number, number] {
  const [depth, i, j] = tileAddress(key);
  const d = depth + 1;
  return [
    tileKey(d, 2 * i, 2 * j),
    tileKey(d, 2 * i + 1, 2 * j),
    tileKey(d, 2 * i, 2 * j + 1),
    tileKey(d, 2 * i + 1, 2 * j + 1),
  ];
}
