import {
  ResolvedSurfaceDetail,
  resolveSurfaceDetail,
  SURFACE_DETAIL_PRESET_NAMES,
  SURFACE_DETAIL_PRESETS,
  SurfaceDetail,
  surfaceDetailKey,
  SurfaceDetailParams,
  SurfaceDetailPreset,
} from '../../sdk/materials/surface-detail';

// The chunk names of the sdk's surface detail (`sdk/materials/surface-detail.ts`).

/**
 * A {@link SurfaceDetailPreset}, for a chunk layer.
 *
 * @group Components
 */
export type ChunkDetailPreset = SurfaceDetailPreset;

/**
 * A {@link SurfaceDetail}, for a chunk layer.
 *
 * @group Components
 */
export type ChunkDetail = SurfaceDetail;

export type ChunkDetailParams = SurfaceDetailParams;

export type ResolvedChunkDetail = ResolvedSurfaceDetail;

export const CHUNK_DETAIL_PRESETS = SURFACE_DETAIL_PRESETS;

export const CHUNK_DETAIL_PRESET_NAMES = SURFACE_DETAIL_PRESET_NAMES;

/**
 * Resolve a {@link ChunkDetail}: see {@link resolveSurfaceDetail}.
 *
 * @group Components
 */
export const resolveChunkDetail = resolveSurfaceDetail;

export const chunkDetailKey = surfaceDetailKey;
