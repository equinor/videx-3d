import type { ReliefGrid } from '../../sdk/geometries/relief-grid';
import type { SeabedMesh } from '../../sdk/geometries/surface-clip';

/**
 * Generator key for a `SkyBoxStage` occupant's seabed: a surface clipped to the outline,
 * in the scene frame (see `generateSkySeabed`).
 */
export const skySeabed = 'skySeabed';

/** What the {@link skySeabed} generator returns: `null` without the surface, or off it. */
export type SkySeabedResponse = SeabedMesh | null;

/**
 * Generator key for a `SkyBoxStage`'s relief: a `relief-meta` record and its
 * `relief-values`, resampled around the stage (see `generateSkyRelief`).
 */
export const skyRelief = 'skyRelief';

/** What the {@link skyRelief} generator returns: `null` without the relief, or off it. */
export type SkyReliefResponse = ReliefGrid | null;
