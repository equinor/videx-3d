import type { ReliefTile } from '../../sdk/geometries/relief-tiles';

/**
 * Generator key for one tile of the relief (a `GeoRelief`): its layers merged onto the
 * tile, a geographic one (see `generateSceneryReliefTile`, `buildGeoReliefTile`). The
 * relief's tiles, the overview past them and a `Minimap` are all drawn from these.
 */
export const sceneryReliefTile = 'sceneryReliefTile';

/** What the {@link sceneryReliefTile} generator returns. */
export type SceneryReliefTileResponse = ReliefTile | null;
