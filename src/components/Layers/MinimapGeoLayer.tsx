import { useMemo, useRef } from 'react';
import type { PlanarPolygonCoordinates } from '../../sdk/geometries/planar-geometry';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import { projectGeoFeature } from '../../sdk/layers/geo-features';
import {
  layerVisibilityAt,
  type LayerVisibility,
} from '../../sdk/layers/layer-visibility';
import { geoFrameXZ, type GeoFrame } from '../../sdk/projection/geo-frame';
import { mapViewBetween, mapViewToPixel } from '../../sdk/projection/map-view';
import type { Vec2 } from '../../sdk/types/common';
import { useMinimapFrame } from '../Html/Minimap/minimap-context';
import { minimapClipRect, minimapPathData } from '../Html/Minimap/minimap-path';
import { useGeoFeatures } from './layer-globe';

/**
 * How a feature is drawn by {@link MinimapGeoLayer}: SVG paint.
 *
 * @group Layers
 */
export type MinimapGeoStyle = {
  /** Default '#ffb000' */
  fill?: string;
  /** Default 0.35; 1 for points */
  fillOpacity?: number;
  /** Default the fill's colour */
  stroke?: string;
  /** pixels. Default 1 */
  strokeWidth?: number;
  /** a point's dot's radius, in pixels. Default 3 */
  radius?: number;
};

/**
 * MinimapGeoLayer props
 * @expand
 */
export type MinimapGeoLayerProps<P = Record<string, unknown>> = Omit<
  LayerVisibility,
  'minHeight' | 'maxHeight'
> & {
  /** the features, in longitude and latitude: GeoJSON, or features read from it. Polygons, lines and points (as dots) are drawn */
  data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
  /**
   * where the scene lies on the Earth: the `World`'s frame. Needed: a minimap's layers are
   * drawn in a React root of their own, which does not see the `World`
   */
  frame: GeoFrame;
  /** one style for all, or one per feature. Keep a function stable (`useCallback`) */
  style?: MinimapGeoStyle | ((feature: GeoFeature<P>) => MinimapGeoStyle);
  /**
   * which features to draw: the same data as the scene's layers, less what would clutter a
   * small map (subsea templates under their platforms, say). Keep it stable (`useCallback`)
   */
  filter?: (feature: GeoFeature<P>) => boolean;
  /** the map's extent (metres across) below which the layer fades out; omitted, never */
  minExtent?: number;
  /** the map's extent above which the layer fades out; omitted, never */
  maxExtent?: number;
};

type Projected = {
  rings: Vec2[][];
  bounds: [number, number, number, number];
  closed: boolean;
  /** each of `rings` is one point, drawn as a dot */
  dots: boolean;
};

const DEFAULT_STYLE: MinimapGeoStyle = {};

/**
 * Geographic features on a {@link Minimap} — the same data a `GeoPolygons`, `GeoTubes` or
 * `GeoSymbols` draws in the scene, less what `filter` leaves out — as SVG paths, carried to
 * the scene's X/Z once (`geoFrameXZ`, through `frame`) and moved without a React render as
 * the minimap changes. Points are dots of a radius in pixels. Features off the map are
 * hidden, and vertices and points closer than a pixel are dropped as it is drawn, so the
 * full data stays cheap at any extent: no simpler copy of it is needed.
 *
 * @example
 * <Minimap layers={layers}>
 *   <MinimapGeoLayer data={discoveries} frame={frame} style={{ fill: '#2fbf4a' }} />
 * </Minimap>
 *
 * @group Components
 */
export const MinimapGeoLayer = <P,>({
  data,
  frame,
  style = DEFAULT_STYLE,
  filter,
  visible = true,
  minExtent,
  maxExtent,
  fade,
}: MinimapGeoLayerProps<P>) => {
  const all = useGeoFeatures(data);
  const features = useMemo(
    () => (filter ? all.filter(filter) : all),
    [all, filter],
  );
  const frameKey = JSON.stringify(frame);
  const projected = useMemo(() => {
    const toXZ = geoFrameXZ(JSON.parse(frameKey) as GeoFrame);
    return features.map((feature): Projected | null => {
      if (feature.geometry.type === 'point2d') {
        const points = (feature.geometry.coordinates as Vec2[]).map(
          ([lon, lat]) => toXZ(lon, lat),
        );
        if (points.length === 0) return null;
        const xs = points.map(([x]) => x);
        const zs = points.map(([, z]) => z);
        return {
          rings: points.map(point => [point]),
          bounds: [
            Math.min(...xs),
            Math.min(...zs),
            Math.max(...xs),
            Math.max(...zs),
          ],
          closed: true,
          dots: true,
        };
      }
      // Densified so an edge in longitude and latitude keeps its shape (0.05°, ~5 km).
      const geometry = projectGeoFeature(
        feature,
        ([lon, lat]) => toXZ(lon, lat),
        0.05,
      );
      const rings =
        geometry.type === 'polygon2d'
          ? (geometry.coordinates as PlanarPolygonCoordinates).flat()
          : (geometry.coordinates as Vec2[][]);
      const [minX, minZ] = geometry.min;
      const [maxX, maxZ] = geometry.max;
      return {
        rings,
        bounds: [minX, minZ, maxX, maxZ],
        closed: geometry.type === 'polygon2d',
        dots: false,
      };
    });
  }, [features, frameKey]);
  const radii = useMemo(
    () =>
      features.map(feature => {
        const s = typeof style === 'function' ? style(feature) : style;
        return s.radius ?? 3;
      }),
    [features, style],
  );

  const group = useRef<SVGGElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const options = useRef<LayerVisibility>({});
  options.current = {
    visible,
    minHeight: minExtent,
    maxHeight: maxExtent,
    fade,
  };
  useMinimapFrame(({ view, extent }) => {
    const shown = layerVisibilityAt(extent, options.current);
    group.current?.setAttribute('opacity', String(shown));
    group.current?.setAttribute('visibility', shown > 0 ? 'visible' : 'hidden');
    if (shown <= 0) return;
    // The map's bounds in X/Z, a pixel's worth of margin around it; in a projection, whose
    // scale varies over the map, a good deal more.
    const reach =
      Math.hypot(view.size[0], view.size[1]) *
      0.5 *
      view.metresPerPixel *
      (view.projected ? 4 : 1);
    const [cx, cz] = view.center;
    const pixel2 = view.metresPerPixel * view.metresPerPixel;
    const clip = minimapClipRect(view);
    const [width, height] = view.size;
    projected.forEach((feature, i) => {
      const path = paths.current[i];
      if (!path) return;
      if (
        !feature ||
        feature.bounds[2] < cx - reach ||
        feature.bounds[0] > cx + reach ||
        feature.bounds[3] < cz - reach ||
        feature.bounds[1] > cz + reach
      ) {
        path.setAttribute('d', '');
        return;
      }
      let d = '';
      if (feature.dots) {
        const r = radii[i];
        for (const [[x, z]] of feature.rings) {
          const [px, py] = mapViewToPixel(view, x, z);
          if (px < -r || py < -r || px > width + r || py > height + r) continue;
          d += `M${(px - r).toFixed(1)} ${py.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
        }
        path.setAttribute('d', d);
        return;
      }
      for (const ring of feature.rings) {
        // Its pixels, those closer than a pixel dropped, a long edge bent in a projection.
        const pixels: Vec2[] = [];
        let lastX = Infinity;
        let lastZ = Infinity;
        for (let k = 0; k < ring.length; k++) {
          const [x, z] = ring[k];
          const last = k === ring.length - 1;
          if (
            !last &&
            pixels.length > 0 &&
            (x - lastX) ** 2 + (z - lastZ) ** 2 < pixel2
          )
            continue;
          const pixel = mapViewToPixel(view, x, z);
          if (pixels.length > 0)
            for (const between of mapViewBetween(
              view,
              [lastX, lastZ],
              [x, z],
              pixels[pixels.length - 1],
              pixel,
            ))
              pixels.push(between);
          pixels.push(pixel);
          lastX = x;
          lastZ = z;
        }
        // Only what is on the map, and a margin: a browser draws a path at its full length,
        // and a route crossing a map zoomed in reaches a million pixels past it.
        d += minimapPathData(pixels, feature.closed, clip);
      }
      path.setAttribute('d', d);
    });
  });

  return (
    <g ref={group}>
      {features.map((feature, i) => {
        const s = typeof style === 'function' ? style(feature) : style;
        const fill = s.fill ?? '#ffb000';
        return (
          <path
            key={feature.index}
            ref={node => {
              paths.current[i] = node;
            }}
            fill={projected[i]?.closed ? fill : 'none'}
            fillOpacity={s.fillOpacity ?? (projected[i]?.dots ? 1 : 0.35)}
            fillRule="evenodd"
            stroke={s.stroke ?? fill}
            strokeWidth={s.strokeWidth ?? 1}
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
};
