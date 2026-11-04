import { useCallback, useRef, type ReactNode } from 'react';
import {
  drawMapLabel,
  mapClipRect,
  paintMapPath,
  traceMapPixels,
} from '../../../../sdk/layers/map-draw';
import {
  mapViewBetween,
  mapViewToPixel,
} from '../../../../sdk/projection/map-view';
import type { Vec2 } from '../../../../sdk/types/common';
import {
  useGeoMapCanvasLayer,
  useGeoMapFrame,
  type GeoMapCanvasDraw,
  type GeoMapCanvasTier,
  type GeoMapState,
} from '../geo-map-context';

/** One point of a {@link GeoMapPoints} layer. */
export type GeoMapPoint = {
  /** scene X/Z */
  at: Vec2;
  color?: string;
  /** pixels. Default the layer's */
  radius?: number;
  label?: string;
};

/**
 * GeoMapPoints props
 * @expand
 */
export type GeoMapPointsProps = {
  points: GeoMapPoint[];
  /** default colour. Default `'#ff5a36'` */
  color?: string;
  /** default radius in pixels. Default 3.5 */
  radius?: number;
  /** the labels' font size in pixels. Default 10 */
  fontSize?: number;
  /** among the map's canvas layers: lower is drawn first. Default 0 */
  order?: number;
};

/**
 * Points on a {@link GeoMap}, at scene X/Z, each with an optional label: a field's wellheads,
 * say. Drawn on the map's canvas as it moves, without a React render; a point off the map is
 * passed over, and a label that would cover another one already written is left out.
 *
 * @group Components
 */
export const GeoMapPoints = ({
  points,
  color = '#ff5a36',
  radius = 3.5,
  fontSize = 10,
  order = 0,
}: GeoMapPointsProps) => {
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, { view, labelSpacer }) => {
      const [width, height] = view.size;
      const placed: [number, number, GeoMapPoint][] = [];
      for (const point of points) {
        const [x, y] = mapViewToPixel(view, point.at[0], point.at[1]);
        const r = point.radius ?? radius;
        if (x < -r || y < -r || x > width + r || y > height + r) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        paintMapPath(ctx, {
          fill: point.color ?? color,
          stroke: '#000000',
          strokeOpacity: 0.7,
          strokeWidth: 1,
        });
        placed.push([x, y, point]);
      }
      // The labels over every dot, the first given first, clear of the other layers' labels.
      for (const [x, y, point] of placed)
        if (point.label)
          drawMapLabel(
            ctx,
            point.label,
            x,
            y,
            { fontSize, offset: (point.radius ?? radius) + 3 },
            labelSpacer,
          );
    },
    [points, color, radius, fontSize],
  );
  useGeoMapCanvasLayer(draw, { order });
  return null;
};

/**
 * GeoMapPolyline props
 * @expand
 */
export type GeoMapPolylineProps = {
  /** scene X/Z */
  points: Vec2[];
  /** close it into a polygon, which `fill` then fills. Default `false` */
  closed?: boolean;
  /** Default `'#ffffff'` */
  stroke?: string;
  /** pixels. Default 1.5 */
  strokeWidth?: number;
  /** Default none */
  fill?: string;
  /** Default 0.2 */
  fillOpacity?: number;
  /** a dash pattern in pixels, `[4, 3]` say */
  dash?: number[];
  /** among the map's canvas layers: lower is drawn first. Default 0 */
  order?: number;
};

/**
 * A line or an outline on a {@link GeoMap}, through points at scene X/Z: a wellbore's
 * trajectory, a licence's boundary. Drawn on the map's canvas as it moves, without a React
 * render, and per point: for many thousands of points, simplify them first. Only what lies
 * on the map is drawn (`traceMapPixels`), however far the line reaches past it; in a
 * projection its long segments bend.
 *
 * @group Components
 */
export const GeoMapPolyline = ({
  points,
  closed = false,
  stroke = '#ffffff',
  strokeWidth = 1.5,
  fill = 'none',
  fillOpacity = 0.2,
  dash,
  order = 0,
}: GeoMapPolylineProps) => {
  const dashKey = dash?.join(' ') ?? '';
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, { view }) => {
      const pixels: Vec2[] = [];
      let last: Vec2 | null = null;
      for (let i = 0; i < points.length; i++) {
        const at = mapViewToPixel(view, points[i][0], points[i][1]);
        // In a projection, a long segment bends.
        if (last)
          pixels.push(
            ...mapViewBetween(view, points[i - 1], points[i], last, at),
          );
        pixels.push(at);
        last = at;
      }
      // Cut to the map: filled, as an area; else as a line, closed back to its start.
      const filled = closed && fill !== 'none';
      if (closed && !filled && pixels.length > 1) pixels.push(pixels[0]);
      ctx.beginPath();
      traceMapPixels(ctx, pixels, filled, mapClipRect(view));
      paintMapPath(ctx, {
        fill: filled ? fill : undefined,
        fillOpacity,
        stroke,
        strokeWidth,
        dash: dashKey ? dashKey.split(' ').map(Number) : undefined,
      });
    },
    [points, closed, stroke, strokeWidth, fill, fillOpacity, dashKey],
  );
  useGeoMapCanvasLayer(draw, { order });
  return null;
};

/**
 * GeoMapCanvasLayer props
 * @expand
 */
export type GeoMapCanvasLayerProps = {
  /**
   * draws the layer on the map's canvas: in its CSS pixels, from its top left, each time the
   * map changes. Keep it stable (`useCallback`): a new one draws again
   */
  draw: GeoMapCanvasDraw;
  /** `'features'` (default), or `'live'`: drawn again as the camera moves too */
  tier?: GeoMapCanvasTier;
  /** among the map's canvas layers: lower is drawn first. Default 0 */
  order?: number;
};

/**
 * A layer of your own on a {@link GeoMap}'s canvas: for anything the ready-made layers do not
 * draw, cheaply, however much of it there is. See also `useGeoMapCanvasLayer`, and the
 * drawing helpers of `sdk/layers/map-draw` (`traceMapPixels`, `paintMapPath`,
 * `drawMapLabel`).
 *
 * @group Components
 */
export const GeoMapCanvasLayer = ({
  draw,
  tier,
  order,
}: GeoMapCanvasLayerProps) => {
  useGeoMapCanvasLayer(draw, { tier, order });
  return null;
};

/**
 * GeoMapSvgLayer props
 * @expand
 */
export type GeoMapSvgLayerProps = {
  /**
   * Called with the layer's `<g>` and the map's state now, and each time it changes: draw
   * into it however you like (move what you made, redraw it)
   */
  onFrame: (group: SVGGElement, state: GeoMapState) => void;
  children?: ReactNode;
};

/**
 * A layer of SVG of your own on a {@link GeoMap}, over its canvas: a `<g>` (with its
 * `children`, if any) handed to `onFrame` as the map changes. For a few things that take
 * pointer events; many are cheaper on the canvas ({@link GeoMapCanvasLayer}).
 *
 * @group Components
 */
export const GeoMapSvgLayer = ({ onFrame, children }: GeoMapSvgLayerProps) => {
  const group = useRef<SVGGElement>(null);
  useGeoMapFrame(state => {
    if (group.current) onFrame(group.current, state);
  });
  return <g ref={group}>{children}</g>;
};
