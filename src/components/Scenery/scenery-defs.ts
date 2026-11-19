import type {
  GeoReliefGrid,
  ReliefTile,
} from '../../sdk/geometries/relief-tiles';

/**
 * Generator key for one tile of the relief (a `GeoRelief`): its layers merged onto the
 * tile, a geographic one (see `generateSceneryReliefTile`, `buildGeoReliefTile`). The
 * relief's tiles, the overview past them and a `GeoMap` (a `Minimap`'s too) are all drawn
 * from these. Asked for a `GeoReliefGridRequest` instead of a tile's key, the heights of
 * that grid of tiles stitched into one (`buildGeoReliefTileGrid`): a `Scenery`'s ground map.
 */
export const sceneryReliefTile = 'sceneryReliefTile';

/** What the {@link sceneryReliefTile} generator returns for a tile. */
export type SceneryReliefTileResponse = ReliefTile | null;

/** What the {@link sceneryReliefTile} generator returns for a grid of tiles. */
export type SceneryReliefGridResponse = GeoReliefGrid | null;
