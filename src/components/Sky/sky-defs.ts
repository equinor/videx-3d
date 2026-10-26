import type { ReliefGeoGrid } from '../../sdk/geometries/relief-grid';
import type { ReliefTile } from '../../sdk/geometries/relief-tiles';

/**
 * Generator key for a `SkyBoxStage`'s relief overview: a `relief-meta` record and its
 * `relief-values`, resampled onto longitude and latitude over all of it (see
 * `generateSkyRelief`), which the stage draws past its tiles' reach from the relief's
 * first layer.
 */
export const skyRelief = 'skyRelief';

/** What the {@link skyRelief} generator returns: `null` without the relief. */
export type SkyReliefResponse = ReliefGeoGrid | null;

/**
 * Generator key for one tile of a `SkyBoxStage`'s relief: its layers merged onto the
 * tile, a geographic one (see `generateSkyReliefTile`, `buildGeoReliefTile`).
 */
export const skyReliefTile = 'skyReliefTile';

/** What the {@link skyReliefTile} generator returns. */
export type SkyReliefTileResponse = ReliefTile | null;
