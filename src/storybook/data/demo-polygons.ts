import {
  CoordinatesTransformFunction,
  PlanarGeometry,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import { Vec2 } from '../../sdk/types/common';

/**
 * A made-up footprint with everything a real one may throw at a consumer:
 * three separated components, and holes — two of them close together — so
 * multi-component handling, hole winding and even-odd fill all get exercised.
 * Storybook only.
 *
 * ⭐ Authored in **metres east / north of the field origin**, not in WGS84, so the
 * same shape lands in the same place relative to whichever field is loaded. A
 * checked-in lon/lat version only means anything against one CRS.
 */
function ring(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  ccw: boolean,
  rot = 0,
  jitter = 0,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    // Holes wind the opposite way to their outer ring.
    const k = ccw ? i : n - i;
    const t = (k / n) * Math.PI * 2 + rot;
    const rr = 1 + jitter * Math.sin(i * 3.7 + rot * 2);
    pts.push([cx + Math.cos(t) * rx * rr, cy + Math.sin(t) * ry * rr]);
  }
  pts.push(pts[0]);
  return pts;
}

/** The demo footprint as rings of metres east / north of the field origin. */
export const DEMO_MULTI_POLYGON: PlanarPolygonCoordinates = [
  [
    ring(-1300, 200, 950, 820, 22, true, 0.2, 0.06),
    ring(-1350, 150, 330, 300, 14, false, 0.4),
  ],
  [
    ring(1200, -150, 830, 560, 26, true, 0.1, 0.05),
    ring(950, -150, 200, 190, 12, false, 0),
    ring(1480, -120, 230, 210, 12, false, 0.3),
  ],
  [
    ring(-100, 1500, 560, 540, 9, true, 0.3, 0.04),
    ring(-100, 1500, 210, 200, 10, false, 0),
  ],
];

/**
 * {@link DEMO_MULTI_POLYGON} in the caller's frame.
 *
 * @param transform maps `[east, north]` metres from the field origin to the frame
 *   the consumer works in — `([e, n]) => [e, -n]` for scene XZ, `([e, n]) => [e,
 *   n]` for the XY plane Three.js shapes are authored in
 */
export function createDemoMultiPolygon(
  transform?: CoordinatesTransformFunction,
): PlanarPolygonGeometry {
  return PlanarGeometry.fromPolygonCoordinates(
    DEMO_MULTI_POLYGON,
    transform,
  ) as PlanarPolygonGeometry;
}
