import { useCallback, useRef } from 'react';
import { paintMapPath } from '../../../sdk/layers/map-draw';
import {
  mapScaleBar,
  mapViewCone,
  mapViewToPixel,
} from '../../../sdk/projection/map-view';
import {
  useGeoMapCanvasLayer,
  useGeoMapFrame,
  type GeoMapCanvasDraw,
} from './geo-map-context';
import { HANDLE_RADIUS, useDraggableMarker } from './geo-map-drag';
import { GeoMapCameraIcon, GeoMapTargetIcon } from './GeoMapIcons';

/**
 * GeoMapCameraMarker props
 * @expand
 */
export type GeoMapCameraMarkerProps = {
  /** the arrow's colour. Default white */
  color?: string;
  /** the cone's or the circle's colour. Default white */
  shapeColor?: string;
  /** the arrow's length in pixels. Default 14 */
  size?: number;
  /**
   * what is drawn round the arrow: `'cone'`, the camera's horizontal field of view; `'circle'`,
   * all round it; or `'none'`. Default `'cone'`
   */
  shape?: 'cone' | 'circle' | 'none';
  /**
   * how far the cone reaches, or the circle's radius, in metres on the ground. Default the
   * map's scale bar's length: the cone reads as the distance the bar shows, at every zoom
   */
  radius?: number;
  /**
   * whether the arrow can be dragged and dropped on the map to move the camera there: it and
   * its target move together, at the heights they have. Drop it outside the map, or press
   * Escape, to cancel. Needs controls (see `GeoMapCamera`'s `dragControls`). Default `true`
   */
  draggable?: boolean;
};

/**
 * Where the camera is on a {@link GeoMap}, and which way it looks: an arrow, turning with its
 * heading, and, round it, its horizontal field of view as a cone, or a circle — reaching as
 * far as the map's scale bar measures, unless `radius` says otherwise, so it reads as that
 * distance. Both are laid out on the ground and carried onto the map (`mapViewCone`), so
 * they are true in any of its projections: the reach is that far along the ground wherever
 * it points, and the cone's angle is the camera's where the map is not conformal (Equal
 * Earth). The shape is drawn on the map's canvas; the arrow over it, to be dragged and
 * dropped on the map to fly the camera there. Inside a `GeoMapCamera`.
 *
 * @group Components
 */
export const GeoMapCameraMarker = ({
  color = '#ffffff',
  shapeColor = '#ffffff',
  size = 14,
  shape = 'cone',
  radius,
  draggable = true,
}: GeoMapCameraMarkerProps) => {
  const turned = useRef<SVGGElement>(null);
  const heading = useRef(NaN);
  const { group, handleCircle, handle } = useDraggableMarker(
    'camera',
    draggable,
  );
  useGeoMapFrame(({ camera }) => {
    if (!camera || camera.heading === heading.current) return;
    heading.current = camera.heading;
    turned.current?.setAttribute(
      'transform',
      `rotate(${(camera.heading * 180) / Math.PI})`,
    );
  });

  // The cone or the circle, on the canvas, under the markers: drawn again as the camera moves.
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, { view, camera }) => {
      if (!camera || shape === 'none') return;
      const reach = radius ?? mapScaleBar(view).metres;
      const full = shape === 'circle';
      const points = mapViewCone(
        view,
        camera.camera,
        camera.forward,
        full ? Math.PI * 2 : camera.fov,
        reach,
      );
      const [ox, oy] = mapViewToPixel(view, camera.camera[0], camera.camera[1]);
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(ox + x, oy + y);
        else ctx.lineTo(ox + x, oy + y);
      });
      ctx.closePath();
      paintMapPath(
        ctx,
        full
          ? {
              fill: shapeColor,
              fillOpacity: 0.1,
              stroke: shapeColor,
              strokeOpacity: 0.85,
              strokeWidth: 1.5,
            }
          : { fill: shapeColor, fillOpacity: 0.25 },
      );
    },
    [shape, radius, shapeColor],
  );
  useGeoMapCanvasLayer(draw, { tier: 'live', order: -10 });

  return (
    <g ref={group}>
      <g ref={turned}>
        <GeoMapCameraIcon size={size} color={color} />
      </g>
      {draggable && (
        <circle
          ref={handleCircle}
          r={HANDLE_RADIUS}
          fill="transparent"
          pointerEvents="all"
          {...handle}
        >
          <title>Drag to move the camera</title>
        </circle>
      )}
    </g>
  );
};

/**
 * GeoMapTargetMarker props
 * @expand
 */
export type GeoMapTargetMarkerProps = {
  /** Default white */
  color?: string;
  /** its width in pixels. Default 16 */
  size?: number;
  /**
   * whether it can be dragged and dropped on the map to aim the camera at the new place: the
   * camera stays, and the target keeps its height. Drop it outside the map, or press Escape,
   * to cancel. Needs controls (see `GeoMapCamera`'s `dragControls`). Default `true`
   */
  draggable?: boolean;
};

/**
 * What the camera looks at on a {@link GeoMap}: the controls' target, dropped to the sea's
 * level. In the middle of the map when the map follows it. Drag it and drop it on the map to
 * look somewhere else. Inside a `GeoMapCamera`.
 *
 * @group Components
 */
export const GeoMapTargetMarker = ({
  color = '#ffffff',
  size = 16,
  draggable = true,
}: GeoMapTargetMarkerProps) => {
  const { group, handleCircle, handle } = useDraggableMarker(
    'target',
    draggable,
  );
  return (
    <g ref={group}>
      <GeoMapTargetIcon size={size} color={color} />
      {draggable && (
        <circle
          ref={handleCircle}
          r={HANDLE_RADIUS}
          fill="transparent"
          pointerEvents="all"
          {...handle}
        >
          <title>Drag to look somewhere else</title>
        </circle>
      )}
    </g>
  );
};
