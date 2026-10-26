import { transfer } from 'comlink';
import type { SkyReliefTileResponse } from '../components/Sky/sky-defs';
import type { ReadonlyStore } from '../sdk';
import {
  buildReliefTile,
  ReliefReader,
  ReliefTileSource,
} from '../sdk/geometries/relief-tiles';

// One reader per store: it keeps the relief records and blocks between tiles.
const readers = new WeakMap<ReadonlyStore, ReliefReader>();

/**
 * One tile of a relief: its layers — `relief-meta` records and windows of their
 * `relief-values` — merged onto the tile (see `buildReliefTile`). The blocks read are kept
 * where the generator runs, so neighbouring tiles read them once.
 *
 * @param source the layers, where the scene lies on the map, and the base
 * @param key the tile (see `tileKey`)
 * @param cells cells along its side
 */
export async function generateSkyReliefTile(
  this: ReadonlyStore,
  source: ReliefTileSource,
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
  const tile = await buildReliefTile(reader, source, key, cells);
  return transfer(tile, [
    tile.heights.buffer as ArrayBuffer,
    tile.normals.buffer as ArrayBuffer,
    tile.layers.buffer as ArrayBuffer,
  ]);
}
