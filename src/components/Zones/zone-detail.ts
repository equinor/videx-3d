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

// The zone names of the sdk's surface detail (`sdk/materials/surface-detail.ts`).

/**
 * A {@link SurfaceDetailPreset}, for a zone layer.
 *
 * @group Components
 */
export type ZoneDetailPreset = SurfaceDetailPreset;

/**
 * A {@link SurfaceDetail}, for a zone layer.
 *
 * @group Components
 */
export type ZoneDetail = SurfaceDetail;

export type ZoneDetailParams = SurfaceDetailParams;

export type ResolvedZoneDetail = ResolvedSurfaceDetail;

export const ZONE_DETAIL_PRESETS = SURFACE_DETAIL_PRESETS;

export const ZONE_DETAIL_PRESET_NAMES = SURFACE_DETAIL_PRESET_NAMES;

/**
 * Resolve a {@link ZoneDetail}: see {@link resolveSurfaceDetail}.
 *
 * @group Components
 */
export const resolveZoneDetail = resolveSurfaceDetail;

export const zoneDetailKey = surfaceDetailKey;
