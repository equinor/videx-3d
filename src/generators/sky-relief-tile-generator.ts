import { transfer } from 'comlink';
import type { SkyReliefTileResponse } from '../components/Sky/sky-defs';
import type { ReadonlyStore } from '../sdk';
import {
  buildGeoReliefTile,
  buildReliefTile,
  ReliefLayersSource,
  ReliefReader,
  ReliefTileSource,
} from '../sdk/geometries/relief-tiles';

// One reader per store: it keeps the relief records and blocks between tiles.
const readers = new WeakMap<ReadonlyStore, ReliefReader>();

/**
 * One tile of a relief: its layers — `relief-meta` records and windows of their
 * `relief-values` — merged onto the tile: a geographic tile (see `buildGeoReliefTile`), or
 * with a `frame` a tile of that map's quadtree (`buildReliefTile`). The blocks read are kept
 * where the generator runs, so neighbouring tiles read them once.
 *
 * @param source the layers and the base, and for a tile in a map where the scene lies on it
 * @param key the tile (see `geoTileKeyAt`, or `tileKey`)
 * @param cells cells along its side
 */
export async function generateSkyReliefTile(
  this: ReadonlyStore,
  source: ReliefLayersSource | ReliefTileSource,
  key: number,
  cells?: number,
): Promise<SkyReliefTileResponse> {
  let reader = readers.get(this);
  if (!reader) {
    reader = new ReliefReader((dataType, id, args) =>
      this.get(dataType, id, args),
    );
    readers.set(this, reader);
  }
  const tile =
    'frame' in source && source.frame
      ? await buildReliefTile(reader, source, key, cells)
      : await buildGeoReliefTile(reader, source, key, cells);
  return transfer(tile, [
    tile.heights.buffer as ArrayBuffer,
    tile.normals.buffer as ArrayBuffer,
    tile.layers.buffer as ArrayBuffer,
  ]);
}
