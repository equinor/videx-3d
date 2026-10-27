import type { ReliefGeoGrid } from '../../sdk/geometries/relief-grid';
import type { ReliefTile } from '../../sdk/geometries/relief-tiles';

/**
 * Generator key for a `SceneryStage`'s relief overview: a `relief-meta` record and its
 * `relief-values`, resampled onto longitude and latitude over all of it (see
 * `generateSceneryRelief`), which the stage draws past its tiles' reach from the relief's
 * first layer.
 */
export const sceneryRelief = 'sceneryRelief';

/** What the {@link sceneryRelief} generator returns: `null` without the relief. */
export type SceneryReliefResponse = ReliefGeoGrid | null;

/**
 * Generator key for one tile of a `SceneryStage`'s relief: its layers merged onto the
 * tile, a geographic one (see `generateSceneryReliefTile`, `buildGeoReliefTile`).
 */
export const sceneryReliefTile = 'sceneryReliefTile';

/** What the {@link sceneryReliefTile} generator returns. */
export type SceneryReliefTileResponse = ReliefTile | null;
