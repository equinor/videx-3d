import { Color, type ColorRepresentation } from 'three';
import type { PlanarPolygonCoordinates } from '../../../../sdk/geometries/planar-geometry';
import {
  PlanarLineGeometry,
  PlanarPointGeometry,
  PlanarPolygonGeometry,
} from '../../../../sdk/geometries/planar-geometry';
import {
  densifyPlanarGeometry,
  type GeoFeature,
} from '../../../../sdk/layers/geo-features';
import type { LayerExtentVisibility } from '../../../../sdk/layers/layer-visibility';
import type { Vec2 } from '../../../../sdk/types/common';

/** The kinds of geometry a map layer of features draws. */
export type GeoMapFeatureKind = 'polygon' | 'line' | 'point';

/** A ring or a line of a feature, in longitude and latitude and in scene X/Z, point by point. */
export type GeoMapPath = { lonLat: Vec2[]; xz: Vec2[] };

/** A feature made ready to draw on a map: its paths, densified, both ways. */
export type GeoMapPreparedFeature<P> = {
  feature: GeoFeature<P>;
  /** a polygon's rings (holes after their outer ring), a line's parts, or a point each */
  paths: GeoMapPath[];
};

// Degrees between the points of a long edge: an edge straight in longitude and latitude is
// curved on a map (about 5 km).
const DENSIFY = 0.05;

/**
 * `features` of `kind` made ready to draw on a map: densified every 0.05°, so an edge keeps
 * its shape in any projection, and carried to scene X/Z once (`toXZ`), where the scene's own
 * map draws them. Features of other kinds are left out.
 */
export function prepareGeoMapFeatures<P>(
  features: readonly GeoFeature<P>[],
  kind: GeoMapFeatureKind,
  toXZ: (longitude: number, latitude: number) => Vec2,
): GeoMapPreparedFeature<P>[] {
  const out: GeoMapPreparedFeature<P>[] = [];
  const path = (lonLat: Vec2[]): GeoMapPath => ({
    lonLat,
    xz: lonLat.map(([lon, lat]) => toXZ(lon, lat)),
  });
  for (const feature of features) {
    const geometry = feature.geometry;
    if (kind === 'polygon' && geometry instanceof PlanarPolygonGeometry) {
      const dense = densifyPlanarGeometry(geometry, DENSIFY);
      const polygons = dense.coordinates as PlanarPolygonCoordinates;
      out.push({ feature, paths: polygons.flat().map(path) });
    } else if (kind === 'line' && geometry instanceof PlanarLineGeometry) {
      const dense = densifyPlanarGeometry(geometry, DENSIFY);
      out.push({ feature, paths: (dense.coordinates as Vec2[][]).map(path) });
    } else if (kind === 'point' && geometry instanceof PlanarPointGeometry) {
      out.push({
        feature,
        paths: (geometry.coordinates as Vec2[]).map(point => path([point])),
      });
    }
  }
  return out;
}

const colors = new Map<ColorRepresentation, string>();
const color = new Color();

/** A colour as CSS, for a canvas: `fallback` where none is given. Remembered, so cheap per frame. */
export function cssColor(
  value: ColorRepresentation | undefined,
  fallback: string,
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'object') {
    const known = colors.get(value);
    if (known) return known;
    const css = color.set(value).getStyle();
    if (colors.size > 1024) colors.clear();
    colors.set(value, css);
    return css;
  }
  return color.copy(value as Color).getStyle();
}

/**
 * What a map's twin of a scene layer takes besides its data and style: when it shows, by the
 * scene layer's band of camera heights or a band of map extents of its own, which of its
 * features, and its place among the map's canvas layers.
 *
 * @group Components
 */
export type GeoMapLayerOptions<P> = LayerExtentVisibility & {
  /** which features to draw: the scene's data, less what clutters a small map (subsea templates, say). Keep it stable (`useCallback`) */
  filter?: (feature: GeoFeature<P>) => boolean;
  /** among the map's canvas layers: lower is drawn first. Default 0 */
  order?: number;
};
