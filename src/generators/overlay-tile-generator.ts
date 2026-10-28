import { transfer } from 'comlink';
import type { ReadonlyStore } from '../sdk';
import {
  buildOverlayTile,
  type OverlayShapes,
  type OverlayTile,
} from '../sdk/layers/overlay-tiles';

/**
 * One overlay tile (see `buildOverlayTile`): the polygons sent over the geographic tile
 * `key`, rasterised as the distance to their edges and which one is on top. Reads nothing
 * from the store: the shapes come with the call, only those over the tile.
 *
 * @param shapes the polygons over the tile (`packOverlayShapes`)
 * @param key the tile (see `geoTileKeyAt`)
 * @param size texels along its side, its border aside
 * @param band how far from an edge the distance is exact, in texels
 */
export async function generateOverlayTile(
  this: ReadonlyStore,
  shapes: OverlayShapes,
  key: number,
  size?: number,
  band?: number,
): Promise<OverlayTile> {
  const tile = buildOverlayTile(shapes, key, size, band);
  return transfer(tile, [tile.data.buffer as ArrayBuffer]);
}
