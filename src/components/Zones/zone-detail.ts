import {
  SURFACE_DETAIL_PRESET_NAMES,
  SurfaceDetail,
  surfaceDetailKey,
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

export const ZONE_DETAIL_PRESET_NAMES = SURFACE_DETAIL_PRESET_NAMES;

export const zoneDetailKey = surfaceDetailKey;
