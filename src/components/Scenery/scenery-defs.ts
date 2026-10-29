import type { ReliefTile } from '../../sdk/geometries/relief-tiles';

/**
 * Generator key for one tile of a `SceneryStage`'s relief: its layers merged onto the
 * tile, a geographic one (see `generateSceneryReliefTile`, `buildGeoReliefTile`). The
 * stage's tiles, the overview past them and a `Minimap` are all drawn from these.
 */
export const sceneryReliefTile = 'sceneryReliefTile';

/** What the {@link sceneryReliefTile} generator returns. */
export type SceneryReliefTileResponse = ReliefTile | null;
