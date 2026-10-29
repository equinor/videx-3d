import { useEffect, useMemo } from 'react';
import { Color, ColorRepresentation, Uniform } from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import {
  PlanarPolygonGeometry,
  type PlanarPolygonCoordinates,
} from '../../sdk/geometries/planar-geometry';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import {
  buildOverlayTile,
  OVERLAY_TILE_BAND,
  OVERLAY_TILE_SIZE,
  packOverlayShapes,
  type OverlayTile,
} from '../../sdk/layers/overlay-tiles';
import { GeoFeatureIndex, GeoTileStyles } from './geo-tile-layer';
import {
  GeoTileLayer,
  type GeoTileLayerOptions,
  type GeoTileLayerSource,
} from './GeoTileLayer';
import { overlayTile } from './layer-defs';
import { useGeoFeatures } from './layer-globe';
import sample from './shaders/geo-polygons-sample.glsl';

/**
 * How a polygon is drawn by {@link GeoPolygons}.
 *
 * @group Layers
 */
export type GeoPolygonStyle = {
  /** Default '#ffb000' */
  fill?: ColorRepresentation;
  /** Default 0.35 */
  fillOpacity?: number;
  /** Default the fill's colour */
  stroke?: ColorRepresentation;
  /** Default 1 */
  strokeOpacity?: number;
};

/**
 * GeoPolygons props
 * @expand
 */
export type GeoPolygonsProps<P = Record<string, unknown>> =
  GeoTileLayerOptions & {
    /** the polygons, in longitude and latitude: GeoJSON, or features read from it (`geoFeaturesFromGeoJson`). Other kinds are left out */
    data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
    /** one style for all, or one per feature. Keep a function stable (`useCallback`) */
    style?: GeoPolygonStyle | ((feature: GeoFeature<P>) => GeoPolygonStyle);
    /** the outline's width in pixels, inside each polygon's edge. Default 1.5; at most about 4 */
    strokeWidth?: number;
  };

const color = new Color();
const DEFAULT_STYLE: GeoPolygonStyle = {};

/**
 * Polygons in longitude and latitude — GeoJSON, say: licences, fields, discoveries,
 * safety zones — drawn over the Earth, at the sea's level or any height over it, or on the
 * relief (`drape`), with fills and outlines of their own. A {@link GeoTileLayer}: placed on
 * the globe by their latitudes and longitudes, no relief needed.
 *
 * Each tile is a distance field of the polygons over it, chosen and loaded only where there
 * are polygons, finer where they are near: edges stay sharp at any zoom, outlines keep their
 * width in pixels. Tiles are built by the `overlayTile` generator where one is registered
 * (`generateOverlayTile`), else on the main thread.
 *
 * By default (`water` 'clear') drawn on top of the see-through objects, after them (on
 * `LAYERS.OVERLAY` with an `OITRenderPass`), tested against what is opaque: what stands in
 * front hides it. Where polygons overlap, the later one's fill is on top; every outline
 * shows.
 *
 * See `documents/layers.md`.
 *
 * @example
 * <World frame={frame}>
 *   <GeoPolygons
 *     data={discoveries}
 *     style={f => ({ fill: f.properties.hcType === 'GAS' ? 'red' : 'green' })}
 *     maxHeight={400000}
 *   />
 * </World>
 *
 * @group Components
 */
export const GeoPolygons = <P,>({
  data,
  style = DEFAULT_STYLE,
  strokeWidth = 1.5,
  water = 'clear',
  ...options
}: GeoPolygonsProps<P>) => {
  const features = useGeoFeatures(data);

  // Each feature's id is its place among the features: its styles are found by it.
  const index = useMemo(
    () =>
      new GeoFeatureIndex(
        features.flatMap((feature, id) =>
          feature.geometry instanceof PlanarPolygonGeometry
            ? [
                {
                  value: {
                    id,
                    polygon: feature.geometry
                      .coordinates as PlanarPolygonCoordinates,
                  },
                  bounds: feature.bounds,
                },
              ]
            : [],
        ),
        OVERLAY_TILE_BAND,
        OVERLAY_TILE_SIZE,
      ),
    [features],
  );

  const styles = useMemo(() => new GeoTileStyles(2), []);
  useEffect(() => () => styles.dispose(), [styles]);
  const styleKey = typeof style === 'function' ? style : JSON.stringify(style);
  const styleTexture = useMemo(
    () =>
      styles.set(features.length, (id, out, offset) => {
        const given = typeof style === 'function' ? style(features[id]) : style;
        color.set(given.fill ?? '#ffb000');
        out.set([color.r, color.g, color.b, given.fillOpacity ?? 0.35], offset);
        color.set(given.stroke ?? given.fill ?? '#ffb000');
        out.set(
          [color.r, color.g, color.b, given.strokeOpacity ?? 1],
          offset + 4,
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the style's content
    [styles, features, styleKey],
  );

  const uniforms = useMemo(
    () => ({
      uGeoTileStyles: new Uniform(styles.texture),
      uGeoTileStylesWidth: new Uniform(GeoTileStyles.WIDTH),
      uGeoPolygonBand: new Uniform(OVERLAY_TILE_BAND),
      uGeoPolygonStrokeWidth: new Uniform(1.5),
    }),
    [styles],
  );
  useEffect(() => {
    uniforms.uGeoTileStyles.value = styleTexture;
    uniforms.uGeoPolygonStrokeWidth.value = strokeWidth;
  }, [uniforms, styleTexture, strokeWidth]);
  const shader = useMemo(() => ({ sample, uniforms }), [uniforms]);

  // Tiles from the generator where it is registered; on this thread if not.
  const generate = useGenerator<OverlayTile>(overlayTile);
  const source = useMemo<GeoTileLayerSource | null>(() => {
    if (index.count === 0) return null;
    let worker = true;
    return {
      size: OVERLAY_TILE_SIZE,
      covers: key => index.over(key).length > 0,
      load: async key => {
        const shapes = packOverlayShapes(index.values(key));
        if (worker) {
          try {
            const tile = await generate(shapes, key, OVERLAY_TILE_SIZE);
            if (tile) return tile;
          } catch {
            // Not registered: build them here from now on.
          }
          worker = false;
        }
        return buildOverlayTile(shapes, key, OVERLAY_TILE_SIZE);
      },
    };
  }, [index, generate]);

  return (
    <GeoTileLayer source={source} shader={shader} water={water} {...options} />
  );
};
