import type { SeabedMesh } from '../../sdk/geometries/surface-clip';

/**
 * Generator key for a `SkyBoxStage` occupant's seabed: a surface clipped to the outline,
 * in the scene frame (see `generateSkySeabed`).
 */
export const skySeabed = 'skySeabed';

/** What the {@link skySeabed} generator returns: `null` without the surface, or off it. */
export type SkySeabedResponse = SeabedMesh | null;
