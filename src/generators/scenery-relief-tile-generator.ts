import { transfer } from 'comlink';
import type {
  SceneryReliefGridResponse,
  SceneryReliefTileResponse,
} from '../components/Scenery/scenery-defs';
import type { ReadonlyStore } from '../sdk';
import {
  buildGeoReliefTile,
  buildGeoReliefTileGrid,
  buildReliefTile,
  type GeoReliefGridRequest,
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
 * Asked for a grid of geographic tiles instead of one (`key` a `GeoReliefGridRequest`), their
 * heights alone stitched into one grid (`buildGeoReliefTileGrid`), so what samples a wide
 * stretch of ground (a `Scenery`'s ground map) takes it whole, the stitching off its thread.
 *
 * @param source the layers and the base, and for a tile in a map where the scene lies on it
 * @param key the tile (see `geoTileKeyAt`, or `tileKey`), or the tiles of a grid
 * @param cells cells along its side
 * @param heightsOnly a geographic tile's heights alone (`buildGeoReliefTile`'s), for what
 * samples the ground without drawing it
 */
export async function generateSceneryReliefTile(
  this: ReadonlyStore,
  source: ReliefLayersSource | ReliefTileSource,
  key: number | GeoReliefGridRequest,
  cells?: number,
  heightsOnly?: boolean,
): Promise<SceneryReliefTileResponse | SceneryReliefGridResponse> {
  let reader = readers.get(this);
  if (!reader) {
    reader = new ReliefReader((dataType, id, args) =>
      this.get(dataType, id, args),
    );
    readers.set(this, reader);
  }
  if (typeof key !== 'number') {
    if ('frame' in source && source.frame)
      throw new Error(
        'generateSceneryReliefTile: a grid is of geographic tiles',
      );
    const grid = await buildGeoReliefTileGrid(reader, source, key, cells);
    return transfer(grid, [grid.heights.buffer as ArrayBuffer]);
  }
  const tile =
    'frame' in source && source.frame
      ? await buildReliefTile(reader, source, key, cells)
      : await buildGeoReliefTile(reader, source, key, cells, heightsOnly);
  return transfer(tile, [
    tile.heights.buffer as ArrayBuffer,
    tile.normals.buffer as ArrayBuffer,
    tile.layers.buffer as ArrayBuffer,
  ]);
}
