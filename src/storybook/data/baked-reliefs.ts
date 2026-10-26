/**
 * The demo store bakes any of its surfaces into a relief on demand, under the surface's
 * id with this prefix (`surfaceToRelief`, in the demo field's map): a local layer for a
 * `SkyBoxStage` relief.
 */
export const BAKED_RELIEF_PREFIX = 'surface:';

/** The id of the relief the demo store bakes from a surface. */
export const bakedReliefId = (surfaceId: string) =>
  `${BAKED_RELIEF_PREFIX}${surfaceId}`;
