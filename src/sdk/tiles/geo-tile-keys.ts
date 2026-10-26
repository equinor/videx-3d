import { tileAddress, tileKey } from './tile-keys';

// ⚠️ Free of three.js: the tiles' builders run where the generators run.

/**
 * Degrees a root of the geographic quadtree spans, in longitude and in latitude: two
 * roots, the western and the eastern hemisphere, each from pole to pole. A tile at depth
 * `d` spans `180 / 2^d` degrees each way. Its column `i` runs east from 180°W, its row `j`
 * south from 90°N; keys, parents and children are {@link tileKey}'s.
 *
 * @group Tiles
 */
export const GEO_TILE_ROOT_SPAN = 180;

/**
 * The geographic quadtree's two roots, west and east.
 *
 * @group Tiles
 */
export const GEO_TILE_ROOTS: readonly number[] = [
  tileKey(0, 0, 0),
  tileKey(0, 1, 0),
];

/**
 * The west longitude, the north latitude and the span of a geographic tile, in degrees.
 *
 * @group Tiles
 */
export function geoTileRegion(key: number): [number, number, number] {
  const [depth, i, j] = tileAddress(key);
  const span = GEO_TILE_ROOT_SPAN / 2 ** depth;
  return [-180 + i * span, 90 - j * span, span];
}

/**
 * The geographic tile at `depth` that holds `longitude`, `latitude` (degrees): the
 * longitude taken about the globe, the latitude clamped to the poles. A point on an edge
 * belongs to the tile east and south of it.
 *
 * @group Tiles
 */
export function geoTileKeyAt(
  depth: number,
  longitude: number,
  latitude: number,
): number {
  const span = GEO_TILE_ROOT_SPAN / 2 ** depth;
  const columns = 2 ** (depth + 1);
  const rows = 2 ** depth;
  const east = (((longitude + 180) % 360) + 360) % 360;
  const south = Math.min(Math.max(90 - latitude, 0), 180);
  return tileKey(
    depth,
    Math.min(Math.floor(east / span), columns - 1),
    Math.min(Math.floor(south / span), rows - 1),
  );
}
