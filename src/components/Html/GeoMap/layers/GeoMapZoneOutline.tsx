import { useCallback, useMemo } from 'react';
import {
  mapClipRect,
  paintMapPath,
  traceMapPixels,
} from '../../../../sdk/layers/map-draw';
import { mapViewToPixel } from '../../../../sdk/projection/map-view';
import type { Vec2 } from '../../../../sdk/types/common';
import {
  useGeoMapCanvasLayer,
  type GeoMapCanvasDraw,
} from '../geo-map-context';

// Degrees between the points of a zone's outline: its meridians bend in the scene's map.
const ZONE_STEP = 0.25;

/**
 * The bounds of the zone the scene's map is laid out for, on a {@link GeoMap} (its
 * `zoneBounds`): a box in longitude and latitude carried through the scene's map, so its
 * meridians bend and close in toward the pole as they lie in it. Shown only while the map is
 * drawn in the scene's map.
 */
export const GeoMapZoneOutline = ({
  bounds,
  toXZ,
  color,
}: {
  /** `[west, south, east, north]`, degrees */
  bounds: [number, number, number, number];
  /** longitude and latitude to scene X/Z (`geoFrameXZ`) */
  toXZ: (longitude: number, latitude: number) => Vec2;
  color: string;
}) => {
  const ring = useMemo(() => {
    const [west, south, east, north] = bounds;
    const corners: Vec2[] = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ];
    const points: Vec2[] = [];
    for (let c = 0; c < 4; c++) {
      const [a, b] = [corners[c], corners[c + 1]];
      const steps = Math.max(
        Math.ceil(
          Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / ZONE_STEP,
        ),
        1,
      );
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        points.push(toXZ(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t));
      }
    }
    points.push(points[0]);
    return points;
  }, [bounds, toXZ]);

  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, { view }) => {
      if (view.projected) return;
      const pixel2 = view.metresPerPixel * view.metresPerPixel;
      const clip = mapClipRect(view);
      ctx.beginPath();
      // A run of the outline's pixels, until the map does not reach it.
      let run: Vec2[] = [];
      let lastX = Infinity;
      let lastZ = Infinity;
      for (let k = 0; k < ring.length; k++) {
        const [x, z] = ring[k];
        // Where the map does not reach it: the line breaks.
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          traceMapPixels(ctx, run, false, clip);
          run = [];
          continue;
        }
        if (
          run.length > 0 &&
          k < ring.length - 1 &&
          (x - lastX) ** 2 + (z - lastZ) ** 2 < pixel2
        )
          continue;
        run.push(mapViewToPixel(view, x, z));
        lastX = x;
        lastZ = z;
      }
      traceMapPixels(ctx, run, false, clip);
      paintMapPath(ctx, {
        stroke: color,
        strokeOpacity: 0.75,
        strokeWidth: 1.25,
        dash: [6, 4],
      });
    },
    [ring, color],
  );
  useGeoMapCanvasLayer(draw, { order: -100 });
  return null;
};
