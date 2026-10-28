import type { Vec2 } from '../types/common';
import {
  PlanarGeometry,
  PlanarLineGeometry,
  PlanarPointGeometry,
  PlanarPolygonGeometry,
  type CoordinatesTransformFunction,
} from '../geometries/planar-geometry';

// ⚠️ Free of three.js beyond `PlanarGeometry`'s types: overlay tiles are built in workers.

/**
 * A GeoJSON geometry (RFC 7946), longitude and latitude in WGS84 degrees: the subset
 * `geoFeaturesFromGeoJson` reads. Altitudes, if given, are ignored.
 *
 * @group Layers
 */
export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiPoint'; coordinates: number[][] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/**
 * A GeoJSON feature.
 *
 * @group Layers
 */
export type GeoJsonFeature<P = Record<string, unknown>> = {
  type: 'Feature';
  id?: string | number;
  geometry: GeoJsonGeometry | null;
  properties: P;
};

/**
 * A GeoJSON feature collection.
 *
 * @group Layers
 */
export type GeoJsonFeatureCollection<P = Record<string, unknown>> = {
  type: 'FeatureCollection';
  features: GeoJsonFeature<P>[];
};

/**
 * A feature of a geographic layer: its geometry in longitude and latitude (WGS84
 * degrees, `[lon, lat]`), as a `PlanarGeometry` — points, lines or polygons, the
 * multi-part kinds folded in — and its properties.
 *
 * @group Layers
 */
export type GeoFeature<P = Record<string, unknown>> = {
  /** the feature's own id, or its index when it has none */
  id: string | number;
  /** where it is in its collection: what an overlay's styles refer to */
  index: number;
  properties: P;
  /** in longitude and latitude */
  geometry: PlanarGeometry;
  /** its bounds in longitude and latitude: min lon, min lat, max lon, max lat */
  bounds: [number, number, number, number];
};

const lonLat = (position: number[]): Vec2 => [position[0], position[1]];

function toPlanarGeometry(geometry: GeoJsonGeometry): PlanarGeometry | null {
  switch (geometry.type) {
    case 'Point':
      return new PlanarPointGeometry([lonLat(geometry.coordinates)]);
    case 'MultiPoint':
      return new PlanarPointGeometry(geometry.coordinates.map(lonLat));
    case 'LineString':
      return new PlanarLineGeometry([geometry.coordinates.map(lonLat)]);
    case 'MultiLineString':
      return new PlanarLineGeometry(
        geometry.coordinates.map(line => line.map(lonLat)),
      );
    case 'Polygon':
      return new PlanarPolygonGeometry([
        geometry.coordinates.map(ring => ring.map(lonLat)),
      ]);
    case 'MultiPolygon':
      return new PlanarPolygonGeometry(
        geometry.coordinates.map(polygon =>
          polygon.map(ring => ring.map(lonLat)),
        ),
      );
    default:
      return null;
  }
}

/**
 * The features of a GeoJSON feature collection, as {@link GeoFeature}s in longitude and
 * latitude. Features without a geometry, or of a kind not read, are left out; `index`
 * still counts them, so it matches the collection's order.
 *
 * @group Layers
 */
export function geoFeaturesFromGeoJson<P>(
  collection: GeoJsonFeatureCollection<P>,
): GeoFeature<P>[] {
  const features: GeoFeature<P>[] = [];
  collection.features.forEach((feature, index) => {
    if (!feature.geometry) return;
    const geometry = toPlanarGeometry(feature.geometry);
    if (!geometry) return;
    const [minLon, minLat] = geometry.min;
    const [maxLon, maxLat] = geometry.max;
    features.push({
      id: feature.id ?? index,
      index,
      properties: feature.properties,
      geometry,
      bounds: [minLon, minLat, maxLon, maxLat],
    });
  });
  return features;
}

/**
 * Points added along each edge longer than `maxStep` (in the coordinates' units), so the
 * edge keeps its shape when projected: a straight edge in longitude and latitude is
 * curved on a map. Polygons' rings and lines are densified; points are copied.
 *
 * @group Layers
 */
export function densifyPlanarGeometry(
  geometry: PlanarGeometry,
  maxStep: number,
): PlanarGeometry {
  const densify = (line: Vec2[]) => {
    const out: Vec2[] = [];
    for (let k = 0; k < line.length; k++) {
      const a = line[k];
      out.push([a[0], a[1]]);
      const b = line[k + 1];
      if (!b) break;
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxStep);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };
  if (geometry instanceof PlanarPolygonGeometry) {
    return new PlanarPolygonGeometry(
      (geometry.coordinates as Vec2[][][]).map(polygon => polygon.map(densify)),
    );
  }
  if (geometry instanceof PlanarLineGeometry) {
    return new PlanarLineGeometry(
      (geometry.coordinates as Vec2[][]).map(densify),
    );
  }
  return geometry.clone();
}

/**
 * A feature's geometry carried to another frame — world X/Z, say, with `geoFrameXZ` —
 * densified first so long edges keep their shape (`maxStep` degrees; omitted, not
 * densified). A new geometry: the feature's is left as it is.
 *
 * @group Layers
 */
export function projectGeoFeature(
  feature: GeoFeature<unknown>,
  toFrame: CoordinatesTransformFunction,
  maxStep?: number,
): PlanarGeometry {
  const geometry =
    maxStep && maxStep > 0
      ? densifyPlanarGeometry(feature.geometry, maxStep)
      : feature.geometry.clone();
  geometry.transform(toFrame);
  return geometry;
}
