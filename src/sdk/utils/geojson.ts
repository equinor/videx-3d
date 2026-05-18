import {
  CoordinatesTransformFunction,
  PlanarGeometry,
} from '../geometries/planar-geometry';

export type GeoJsonFeature = {
  properties: Record<string, any>;
  geometry: PlanarGeometry;
};

/**
 * Simple helper function to parse a GeoJSON feature into a videx-3d GeoJsonFeature type,
 * where the geometry is represented as an instance of PlanarGeometry.
 * @param feature GeoJSON feature object
 * @param transform Coordinate conversion function (i.e. from wgs84 to 3D world coordinates)
 * @returns GeoJsonFeature type
 *
 * @see PlanarGeometry
 */
export function parseGeoJsonFeature(
  feature: any,
  transform?: CoordinatesTransformFunction,
): GeoJsonFeature {
  if (!feature?.geometry?.coordinates?.length || !feature?.geometry?.type) {
    throw Error('Invalid GeoJSON feature');
  }

  let geometry: PlanarGeometry;

  if (
    feature.geometry.type === 'Polygon' ||
    feature.geometry.type === 'MultiPolygon'
  ) {
    const coordinates =
      feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];
    geometry = PlanarGeometry.fromPolygonCoordinates(coordinates, transform);
  } else if (
    feature.geometry.type === 'LineString' ||
    feature.geometry.type === 'MultiLineString'
  ) {
    const coordinates =
      feature.geometry.type === 'MultiLineString'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];

    geometry = PlanarGeometry.fromLineCoordinates(coordinates, transform);
  } else if (
    feature.geometry.type === 'Point' ||
    feature.geometry.type === 'MultiPoint'
  ) {
    const coordinates =
      feature.geometry.type === 'MultiPoint'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];

    geometry = PlanarGeometry.fromPointCoordinates(coordinates, transform);
  } else {
    throw Error('Unsupported geometry type: ' + feature.geometry.type);
  }

  return {
    properties: { ...feature.properties },
    geometry,
  };
}
