import { Vec2 } from '../types/common';
import { PlanarPolygonGeometry } from './planar-geometry';
import { ringSignedArea, ringsToPolygonCoordinates } from './polygon-outline';
import { SurfaceClipHeader, surfaceGridToWorld } from './surface-clip';
import { smoothRings, traceValidBoundary } from './triangulate-grid-delaunay';

/**
 * Options for {@link createSurfaceOutline}.
 *
 * @group Geometries
 */
export type SurfaceOutlineOptions = {
  /**
   * Scene XZ of the surface's `<UtmPosition>` origin (`crs.utmToWorld(header.xori,
   * header.yori, 0)` mapped to `[x, z]`), so the outline lands in the same frame
   * as the rendered surface / any chunk built from it. Defaults to `[0, 0]`.
   */
  worldPosition?: Vec2;
  /** value marking a missing/hole sample (default -1). */
  nullValue?: number;
  /**
   * Smooth the traced cell-edge staircase into a continuous curve by this
   * strength (windowed moving average). `0` keeps the exact rim (default 0).
   */
  smoothing?: number;
  /**
   * Drop rings whose absolute area (scene units²) is below this, to remove specks
   * from a noisy data mask. Default 0 (keep all).
   */
  minRingArea?: number;
};

/**
 * Extract the outline of a surface's valid-data region as a scene-XZ
 * {@link PlanarPolygonGeometry}, suitable as a chunk cut outline. The rim is
 * traced from the grid ({@link traceValidBoundary}), optionally smoothed
 * ({@link smoothRings}), mapped into the scene frame ({@link surfaceGridToWorld}),
 * and grouped into outer/hole components ({@link ringsToPolygonCoordinates}), so
 * the outer data extent, internal no-data holes, and disconnected regions all
 * come through correctly.
 *
 * @param values row-major elevation grid of length `nx * ny`
 * @param header grid geometry (see {@link SurfaceClipHeader})
 * @param options see {@link SurfaceOutlineOptions}
 * @returns the outline polygon, or `null` when there is no valid region
 *
 * @group Geometries
 */
export function createSurfaceOutline(
  values: Float32Array,
  header: SurfaceClipHeader,
  options: SurfaceOutlineOptions = {},
): PlanarPolygonGeometry | null {
  const nullValue = options.nullValue ?? -1;
  const isInvalid = (v: number) => v === nullValue || v < 0;

  let rings = traceValidBoundary(values, header.nx, isInvalid);
  if (rings.length === 0) return null;
  if (options.smoothing && options.smoothing > 0) {
    rings = smoothRings(rings, options.smoothing);
  }

  const toWorld = surfaceGridToWorld(header, options.worldPosition);
  let sceneRings: Vec2[][] = rings.map(ring =>
    ring.map(([col, row]) => toWorld(col, row)),
  );

  if (options.minRingArea && options.minRingArea > 0) {
    const min = options.minRingArea;
    sceneRings = sceneRings.filter(r => Math.abs(ringSignedArea(r)) >= min);
  }

  const coordinates = ringsToPolygonCoordinates(sceneRings);
  if (coordinates.length === 0) return null;
  return new PlanarPolygonGeometry(coordinates);
}
