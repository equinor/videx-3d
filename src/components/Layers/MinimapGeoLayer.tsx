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
import { useGeoFeatures } from './layer-globe';

/**
 * How a feature is drawn by {@link MinimapGeoLayer}: SVG paint.
 *
 * @group Layers
 */
export type MinimapGeoStyle = {
  /** Default '#ffb000' */
  fill?: string;
  /** Default 0.35 */
  fillOpacity?: number;
  /** Default the fill's colour */
  stroke?: string;
  /** pixels. Default 1 */
  strokeWidth?: number;
};

/**
 * MinimapGeoLayer props
 * @expand
 */
export type MinimapGeoLayerProps<P = Record<string, unknown>> = Omit<
  LayerVisibility,
  'minHeight' | 'maxHeight'
> & {
  /** the features, in longitude and latitude: GeoJSON, or features read from it. Polygons and lines are drawn */
  data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
  /**
   * where the scene lies on the Earth: the `World`'s frame. Needed: a minimap's layers are
   * drawn in a React root of their own, which does not see the `World`
   */
  frame: GeoFrame;
  /** one style for all, or one per feature. Keep a function stable (`useCallback`) */
  style?: MinimapGeoStyle | ((feature: GeoFeature<P>) => MinimapGeoStyle);
  /** the map's extent (metres across) below which the layer fades out; omitted, never */
  minExtent?: number;
  /** the map's extent above which the layer fades out; omitted, never */
  maxExtent?: number;
};

type Projected = {
  rings: Vec2[][];
  bounds: [number, number, number, number];
  closed: boolean;
};

const DEFAULT_STYLE: MinimapGeoStyle = {};

/**
 * Geographic features on a {@link Minimap} — the same data a `GeoPolygons` draws in the
 * scene — as SVG paths, carried to the scene's X/Z once (`geoFrameXZ`, through `frame`) and
 * moved without a React render as the minimap changes. Features off the map are hidden, and
 * points closer than a pixel are dropped, so a large layer stays cheap at any extent.
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
  visible = true,
  minExtent,
  maxExtent,
  fade,
}: MinimapGeoLayerProps<P>) => {
  const features = useGeoFeatures(data);
  const frameKey = JSON.stringify(frame);
  const projected = useMemo(() => {
    const toXZ = geoFrameXZ(JSON.parse(frameKey) as GeoFrame);
    return features.map((feature): Projected | null => {
      if (feature.geometry.type === 'point2d') return null;
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
      };
    });
  }, [features, frameKey]);

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
      for (const ring of feature.rings) {
        let lastX = Infinity;
        let lastZ = Infinity;
        let lastPixel: Vec2 | null = null;
        let started = false;
        for (let k = 0; k < ring.length; k++) {
          const [x, z] = ring[k];
          const last = k === ring.length - 1;
          if (!last && started && (x - lastX) ** 2 + (z - lastZ) ** 2 < pixel2)
            continue;
          const pixel = mapViewToPixel(view, x, z);
          // In a projection, a long edge bends.
          if (lastPixel)
            for (const [bx, by] of mapViewBetween(
              view,
              [lastX, lastZ],
              [x, z],
              lastPixel,
              pixel,
            ))
              d += `L${bx.toFixed(1)} ${by.toFixed(1)}`;
          d += `${started ? 'L' : 'M'}${pixel[0].toFixed(1)} ${pixel[1].toFixed(1)}`;
          started = true;
          lastX = x;
          lastZ = z;
          lastPixel = pixel;
        }
        if (feature.closed && started) d += 'Z';
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
            fillOpacity={s.fillOpacity ?? 0.35}
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
