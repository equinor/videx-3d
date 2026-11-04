import { useCallback, useMemo, useRef } from 'react';
import type { ColorRepresentation } from 'three';
import { polygonLabelPoint } from '../../../../sdk/geometries/polygon-label';
import type { PlanarPolygonCoordinates } from '../../../../sdk/geometries/planar-geometry';
import {
  PlanarLineGeometry,
  PlanarPointGeometry,
  PlanarPolygonGeometry,
} from '../../../../sdk/geometries/planar-geometry';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../../../sdk/layers/geo-features';
import { layerExtentVisibilityAt } from '../../../../sdk/layers/layer-visibility';
import {
  drawMapLabel,
  lonLatBoxesMeet,
  mapClipRect,
  mapViewGeoLine,
  mapViewGeoPixel,
  mapViewLonLatBox,
  paintMapPath,
  traceMapPixels,
} from '../../../../sdk/layers/map-draw';
import type { Vec2 } from '../../../../sdk/types/common';
import { useGeoFeatures } from '../../../Layers/layer-globe';
import type { GeoPolygonStyle } from '../../../Layers/GeoPolygons';
import type { GeoSymbolStyle } from '../../../Layers/GeoSymbols';
import type { GeoTubeStyle } from '../../../Layers/GeoTubes';
import {
  useGeoMapCanvasLayer,
  type GeoMapCanvasDraw,
  type GeoMapState,
} from '../geo-map-context';
import {
  cssColor,
  prepareGeoMapFeatures,
  type GeoMapFeatureKind,
  type GeoMapLayerOptions,
  type GeoMapPreparedFeature,
} from './geo-map-features';

type Data<P> = GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;

// The features of `data` that `filter` keeps, and a way to have them ready for the map's
// frame: made again only for new features or another frame.
function useGeoMapPrepared<P>(
  data: Data<P>,
  filter: ((feature: GeoFeature<P>) => boolean) | undefined,
  kind: GeoMapFeatureKind,
) {
  const all = useGeoFeatures(data);
  const features = useMemo(
    () => (filter ? all.filter(filter) : all),
    [all, filter],
  );
  const cache = useRef<{
    features: readonly GeoFeature<P>[];
    toXZ: GeoMapState['toXZ'];
    prepared: GeoMapPreparedFeature<P>[];
  } | null>(null);
  const prepared = useCallback(
    (toXZ: GeoMapState['toXZ']) => {
      const was = cache.current;
      if (was && was.features === features && was.toXZ === toXZ)
        return was.prepared;
      const next = prepareGeoMapFeatures(features, kind, toXZ);
      cache.current = { features, toXZ, prepared: next };
      return next;
    },
    [features, kind],
  );
  return prepared;
}

// A style per feature, one for all or by a function, remembered per feature.
function useStyles<P, S>(
  style: S | ((feature: GeoFeature<P>) => S),
  resolve: (given: S) => unknown,
) {
  // An object written inline is a new one each render: by its content; a function by itself.
  const key = typeof style === 'function' ? style : JSON.stringify(style);
  return useMemo(() => {
    const known = new WeakMap<GeoFeature<P>, unknown>();
    const one = typeof style === 'function' ? null : resolve(style as S);
    return (feature: GeoFeature<P>) => {
      if (one) return one;
      let resolved = known.get(feature);
      if (!resolved) {
        resolved = resolve((style as (feature: GeoFeature<P>) => S)(feature));
        known.set(feature, resolved);
      }
      return resolved;
    };
    // By the style's content; `resolve` is the same at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * GeoMapPolygons props: as `GeoPolygons`', give the same object to both.
 * @expand
 */
export type GeoMapPolygonsProps<P = Record<string, unknown>> =
  GeoMapLayerOptions<P> & {
    /** the polygons, in longitude and latitude: GeoJSON, or features read from it. Other kinds are left out */
    data: Data<P>;
    /** one style for all, or one per feature, as `GeoPolygons` takes it. Keep a function stable (`useCallback`) */
    style?: GeoPolygonStyle | ((feature: GeoFeature<P>) => GeoPolygonStyle);
    /** the outline's width in pixels. Default 1.5 */
    strokeWidth?: number;
    /** the whole layer's. Default 1 */
    opacity?: number;
  };

type PolygonPaint = {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
};

const NO_STYLE = {};

/**
 * A `GeoPolygons`' polygons on a {@link GeoMap}: the same data, style and band of heights, so
 * one object of props draws them in the scene and on the map. Drawn on the map's canvas, filled
 * and outlined; carried to the scene's map once, and through the projection's plane directly
 * in a projection, so a polygon anywhere on the Earth lands where it is. Those off the map
 * are passed over, and vertices closer than a pixel dropped: the full data stays cheap at any
 * extent.
 *
 * @example
 * const discoveries = { data, style: f => ({ fill: f.properties.gas ? 'red' : 'green' }), maxHeight: 1500000 };
 * <GeoPolygons {...discoveries} />    // in the World
 * <GeoMapPolygons {...discoveries} /> // on a map
 *
 * @group Components
 */
export const GeoMapPolygons = <P,>({
  data,
  style = NO_STYLE,
  strokeWidth = 1.5,
  opacity = 1,
  filter,
  order = 0,
  visible,
  minHeight,
  maxHeight,
  fade,
  minExtent,
  maxExtent,
}: GeoMapPolygonsProps<P>) => {
  const prepared = useGeoMapPrepared(data, filter, 'polygon');
  const paintOf = useStyles<P, GeoPolygonStyle>(
    style,
    (given): PolygonPaint => {
      const fill = cssColor(given.fill, '#ffb000');
      return {
        fill,
        fillOpacity: given.fillOpacity ?? 0.35,
        stroke:
          given.stroke === undefined ? fill : cssColor(given.stroke, fill),
        strokeOpacity: given.strokeOpacity ?? 1,
      };
    },
  ) as (feature: GeoFeature<P>) => PolygonPaint;
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, state) => {
      const shown =
        layerExtentVisibilityAt(
          state.extent,
          { visible, minHeight, maxHeight, fade, minExtent, maxExtent },
          state.heightPerExtent,
        ) * opacity;
      if (shown <= 0) return;
      const { view } = state;
      const box = mapViewLonLatBox(view, state.toLonLat);
      const clip = mapClipRect(view);
      for (const { feature, paths } of prepared(state.toXZ)) {
        if (!lonLatBoxesMeet(feature.bounds, box)) continue;
        ctx.beginPath();
        for (const path of paths)
          traceMapPixels(
            ctx,
            mapViewGeoLine(view, path.lonLat, path.xz),
            true,
            clip,
          );
        const paint = paintOf(feature);
        paintMapPath(ctx, {
          fill: paint.fill,
          fillOpacity: paint.fillOpacity * shown,
          stroke: paint.stroke,
          strokeOpacity: paint.strokeOpacity * shown,
          strokeWidth,
        });
      }
    },
    [
      prepared,
      paintOf,
      strokeWidth,
      opacity,
      visible,
      minHeight,
      maxHeight,
      fade,
      minExtent,
      maxExtent,
    ],
  );
  useGeoMapCanvasLayer(draw, { order });
  return null;
};

/**
 * GeoMapLines props: as `GeoTubes`', give the same object to both.
 * @expand
 */
export type GeoMapLinesProps<P = Record<string, unknown>> =
  GeoMapLayerOptions<P> & {
    /** the lines, in longitude and latitude: GeoJSON, or features read from it. Other kinds are left out */
    data: Data<P>;
    /** one style for all, or one per feature, as `GeoTubes` takes it (its `diameter` aside). Keep a function stable (`useCallback`) */
    style?: GeoTubeStyle | ((feature: GeoFeature<P>) => GeoTubeStyle);
    /** the lines' width in pixels: one for all, or one per feature (keep it stable). Default 1.5 */
    strokeWidth?: number | ((feature: GeoFeature<P>) => number);
    /** the whole layer's. Default 1 */
    opacity?: number;
    /** an outline round each line, for it to read on any ground. Default `'rgba(0, 0, 0, 0.5)'`; `'none'` for none */
    casing?: string;
  };

type LinePaint = { stroke: string; strokeOpacity: number };

/**
 * A `GeoTubes`' lines — pipelines, cables — on a {@link GeoMap}: the same data, style and band
 * of heights, drawn as lines a few pixels wide on the map's canvas. Those off the map are
 * passed over, vertices closer than a pixel dropped, and what is left cut to the map.
 *
 * @group Components
 */
export const GeoMapLines = <P,>({
  data,
  style = NO_STYLE,
  strokeWidth = 1.5,
  opacity = 1,
  casing = 'rgba(0, 0, 0, 0.5)',
  filter,
  order = 0,
  visible,
  minHeight,
  maxHeight,
  fade,
  minExtent,
  maxExtent,
}: GeoMapLinesProps<P>) => {
  const prepared = useGeoMapPrepared(data, filter, 'line');
  const paintOf = useStyles<P, GeoTubeStyle>(
    style,
    (given): LinePaint => ({
      stroke: cssColor(given.color, '#ffb000'),
      strokeOpacity: given.opacity ?? 1,
    }),
  ) as (feature: GeoFeature<P>) => LinePaint;
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, state) => {
      const shown =
        layerExtentVisibilityAt(
          state.extent,
          { visible, minHeight, maxHeight, fade, minExtent, maxExtent },
          state.heightPerExtent,
        ) * opacity;
      if (shown <= 0) return;
      const { view } = state;
      const box = mapViewLonLatBox(view, state.toLonLat);
      const clip = mapClipRect(view);
      const visibleLines: [GeoFeature<P>, Path2D, number][] = [];
      for (const { feature, paths } of prepared(state.toXZ)) {
        if (!lonLatBoxesMeet(feature.bounds, box)) continue;
        const path = new Path2D();
        for (const line of paths)
          traceMapPixels(
            path,
            mapViewGeoLine(view, line.lonLat, line.xz),
            false,
            clip,
          );
        visibleLines.push([
          feature,
          path,
          typeof strokeWidth === 'function'
            ? strokeWidth(feature)
            : strokeWidth,
        ]);
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // The casings under every line, so crossings read.
      if (casing !== 'none') {
        ctx.globalAlpha = shown;
        ctx.strokeStyle = casing;
        for (const [, path, width] of visibleLines) {
          ctx.lineWidth = width + 2;
          ctx.stroke(path);
        }
      }
      for (const [feature, path, width] of visibleLines) {
        const paint = paintOf(feature);
        ctx.globalAlpha = paint.strokeOpacity * shown;
        ctx.strokeStyle = paint.stroke;
        ctx.lineWidth = width;
        ctx.stroke(path);
      }
      ctx.globalAlpha = 1;
    },
    [
      prepared,
      paintOf,
      strokeWidth,
      opacity,
      casing,
      visible,
      minHeight,
      maxHeight,
      fade,
      minExtent,
      maxExtent,
    ],
  );
  useGeoMapCanvasLayer(draw, { order });
  return null;
};

/**
 * GeoMapSymbols props: as `GeoSymbols`', give the same object to both.
 * @expand
 */
export type GeoMapSymbolsProps<P = Record<string, unknown>> =
  GeoMapLayerOptions<P> & {
    /** the points, in longitude and latitude: GeoJSON, or features read from it. Other kinds are left out */
    data: Data<P>;
    /** one style for all, or one per feature, as `GeoSymbols` takes it (its `size` aside). Keep a function stable (`useCallback`) */
    style?: GeoSymbolStyle | ((feature: GeoFeature<P>) => GeoSymbolStyle);
    /** a dot's radius in pixels: one for all, or one per feature (keep it stable). Default 3 */
    radius?: number | ((feature: GeoFeature<P>) => number);
    /** the whole layer's. Default 1 */
    opacity?: number;
  };

/**
 * A `GeoSymbols`' points — facilities, wellheads — on a {@link GeoMap}: the same data, style
 * and band of heights, as dots `radius` pixels across on the map's canvas, each in its colour
 * with a dark edge.
 *
 * @group Components
 */
export const GeoMapSymbols = <P,>({
  data,
  style = NO_STYLE,
  radius = 3,
  opacity = 1,
  filter,
  order = 0,
  visible,
  minHeight,
  maxHeight,
  fade,
  minExtent,
  maxExtent,
}: GeoMapSymbolsProps<P>) => {
  const prepared = useGeoMapPrepared(data, filter, 'point');
  const colorOf = useStyles<P, GeoSymbolStyle>(style, given =>
    cssColor(given.color, '#ffb000'),
  ) as (feature: GeoFeature<P>) => string;
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, state) => {
      const shown =
        layerExtentVisibilityAt(
          state.extent,
          { visible, minHeight, maxHeight, fade, minExtent, maxExtent },
          state.heightPerExtent,
        ) * opacity;
      if (shown <= 0) return;
      const { view } = state;
      const [width, height] = view.size;
      const box = mapViewLonLatBox(view, state.toLonLat);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      for (const { feature, paths } of prepared(state.toXZ)) {
        if (!lonLatBoxesMeet(feature.bounds, box)) continue;
        const r = typeof radius === 'function' ? radius(feature) : radius;
        ctx.fillStyle = colorOf(feature);
        ctx.globalAlpha = shown;
        for (const point of paths) {
          const [x, y] = mapViewGeoPixel(view, point.lonLat[0], point.xz[0]);
          if (x < -r || y < -r || x > width + r || y > height + r) continue;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },
    [
      prepared,
      colorOf,
      radius,
      opacity,
      visible,
      minHeight,
      maxHeight,
      fade,
      minExtent,
      maxExtent,
    ],
  );
  useGeoMapCanvasLayer(draw, { order });
  return null;
};

/**
 * GeoMapLabels props: as `GeoLabels`', give the same object to both.
 * @expand
 */
export type GeoMapLabelsProps<P = Record<string, unknown>> = Omit<
  GeoMapLayerOptions<P>,
  'order'
> & {
  /** the features, in longitude and latitude: GeoJSON, or features read from it */
  data: Data<P>;
  /** each feature's text; null or empty for none. Keep it stable (`useCallback`) */
  text: (feature: GeoFeature<P>) => string | null | undefined;
  /** the text's size in CSS pixels on the map. Default 10 */
  fontSize?: number;
  /** Default the labels' font, `verdana, sans-serif` */
  fontFamily?: string;
  /** Default white */
  color?: ColorRepresentation;
  /** the halo round the text. Default `'rgba(0, 0, 0, 0.85)'` */
  haloColor?: string;
  /** the halo's width, as a fraction of the size. Default 0.125 */
  haloWidth?: number;
  /** the whole layer's. Default 1 */
  opacity?: number;
  /** among the map's canvas layers: lower is drawn first. Default 10, over the shapes */
  order?: number;
};

/**
 * A `GeoLabels`' labels on a {@link GeoMap}: the same data, text and band of heights, written
 * on the map's canvas flat, upright and with a halo — a polygon's in it, where it has the
 * most room (`polygonLabelPoint`), a line's at its middle, a point's beside it — and left out
 * where one would cover another already written, the first features first.
 *
 * @group Components
 */
export const GeoMapLabels = <P,>({
  data,
  text,
  fontSize = 10,
  fontFamily,
  color,
  haloColor = 'rgba(0, 0, 0, 0.85)',
  haloWidth = 0.125,
  opacity = 1,
  filter,
  order = 10,
  visible,
  minHeight,
  maxHeight,
  fade,
  minExtent,
  maxExtent,
}: GeoMapLabelsProps<P>) => {
  const all = useGeoFeatures(data);
  const features = useMemo(
    () => (filter ? all.filter(filter) : all),
    [all, filter],
  );
  // Each label's text and place, in longitude and latitude: found once.
  const places = useMemo(() => {
    const out: {
      feature: GeoFeature<P>;
      text: string;
      at: Vec2;
      point: boolean;
    }[] = [];
    for (const feature of features) {
      const label = text(feature);
      if (!label) continue;
      const geometry = feature.geometry;
      let at: Vec2 | null = null;
      let point = false;
      if (geometry instanceof PlanarPolygonGeometry)
        at =
          polygonLabelPoint(geometry.coordinates as PlanarPolygonCoordinates)
            ?.point ?? null;
      else if (geometry instanceof PlanarLineGeometry) {
        const line = (geometry.coordinates as Vec2[][])[0] ?? [];
        at = line[Math.floor(line.length / 2)] ?? null;
      } else if (geometry instanceof PlanarPointGeometry) {
        at = (geometry.coordinates as Vec2[])[0] ?? null;
        point = true;
      }
      if (at) out.push({ feature, text: label, at, point });
    }
    return out;
  }, [features, text]);
  const cache = useRef<{
    toXZ: GeoMapState['toXZ'];
    places: typeof places;
    xz: Vec2[];
  } | null>(null);
  const colorCss = cssColor(color, '#ffffff');
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, state) => {
      const shown =
        layerExtentVisibilityAt(
          state.extent,
          { visible, minHeight, maxHeight, fade, minExtent, maxExtent },
          state.heightPerExtent,
        ) * opacity;
      if (shown <= 0) return;
      const { view } = state;
      const [width, height] = view.size;
      // Their scene X/Z, for the scene's map: once per frame of the map, and per data.
      if (cache.current?.toXZ !== state.toXZ || cache.current.places !== places)
        cache.current = {
          toXZ: state.toXZ,
          places,
          xz: places.map(({ at }) => state.toXZ(at[0], at[1])),
        };
      const xz = cache.current.xz;
      const spacer = state.labelSpacer;
      const style = {
        fontSize,
        fontFamily,
        color: colorCss,
        halo: haloColor,
        haloWidth: 2 * haloWidth * fontSize,
      };
      ctx.globalAlpha = shown;
      places.forEach(({ text: label, at, point }, i) => {
        const [x, y] = mapViewGeoPixel(view, at, xz[i]);
        if (x < -200 || y < -20 || x > width + 200 || y > height + 20) return;
        drawMapLabel(
          ctx,
          label,
          x,
          y,
          point
            ? { ...style, align: 'right', offset: 5 }
            : { ...style, align: 'center' },
          spacer,
        );
      });
    },
    [
      places,
      fontSize,
      fontFamily,
      colorCss,
      haloColor,
      haloWidth,
      opacity,
      visible,
      minHeight,
      maxHeight,
      fade,
      minExtent,
      maxExtent,
    ],
  );
  useGeoMapCanvasLayer(draw, { order });
  return null;
};
