import { parseGeoJsonFeature } from '../src/sdk/utils/geojson';

describe('geojson', () => {
  test('should be able to transform point features to planar point geometry', () => {
    const json1 = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [1, 2],
      },
      properties: {
        foo: 'bar',
      },
    };

    const json2 = {
      type: 'Feature',
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [1, 2],
          [-3, 3],
          [2, -2],
        ],
      },
    };

    const json3 = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [1, 2],
      },
    };

    let planarPointGeometry = parseGeoJsonFeature(json1);

    expect(planarPointGeometry.geometry.type).eq('point2d');
    expect(planarPointGeometry.geometry.offset).toEqual([0, 0]);
    expect(planarPointGeometry.geometry.size).toEqual([0, 0]);
    expect(planarPointGeometry.geometry.coordinates).toEqual([[1, 2]]);
    expect(planarPointGeometry.properties).toEqual(json1.properties);

    planarPointGeometry = parseGeoJsonFeature(json2);

    expect(planarPointGeometry.geometry.type).eq('point2d');
    expect(planarPointGeometry.geometry.offset).toEqual([0, 0]);
    expect(planarPointGeometry.geometry.size).toEqual([5, 5]);
    expect(planarPointGeometry.geometry.coordinates).toEqual([
      [1, 2],
      [-3, 3],
      [2, -2],
    ]);
    expect(planarPointGeometry.properties).toEqual({});

    planarPointGeometry = parseGeoJsonFeature(json3, d => [d[0] * 2, d[1] * 2]);

    expect(planarPointGeometry.geometry.type).eq('point2d');
    expect(planarPointGeometry.geometry.offset).toEqual([0, 0]);
    expect(planarPointGeometry.geometry.size).toEqual([0, 0]);
    expect(planarPointGeometry.geometry.coordinates).toEqual([[2, 4]]);
  });

  test('should be able to transform line string features to planar line geometry', () => {
    const json1 = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [2, 2],
          [3, -4],
        ],
      },
    };

    const json2 = {
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [2, 2],
            [3, -4],
          ],
          [
            [-1, 2],
            [-2, 4],
          ],
        ],
      },
    };

    let planarLineGeometry = parseGeoJsonFeature(json1);

    expect(planarLineGeometry.geometry.type).eq('line2d');
    expect(planarLineGeometry.geometry.offset).toEqual([0, 0]);
    expect(planarLineGeometry.geometry.size).toEqual([3, 6]);
    expect(planarLineGeometry.geometry.coordinates).toEqual([
      [
        [0, 0],
        [2, 2],
        [3, -4],
      ],
    ]);

    planarLineGeometry = parseGeoJsonFeature(json2);

    expect(planarLineGeometry.geometry.type).eq('line2d');
    expect(planarLineGeometry.geometry.offset).toEqual([0, 0]);
    expect(planarLineGeometry.geometry.size).toEqual([5, 8]);
  });

  test('should be able to transform polygon features to planar polygon geometry', () => {
    const json1 = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 2],
            [3, -4],
            [0, 0],
          ],
        ],
      },
    };

    const json2 = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [2, 7],
              [3, -4],
              [0, 0],
            ],
          ],
          [
            [
              [-2, 0],
              [0, 4],
              [2, 0],
              [-2, 0],
            ],
            [
              [-1, 0.5],
              [0, 2.5],
              [1, 0.5],
              [-1, 0.5],
            ],
          ],
        ],
      },
    };

    let planarLineGeometry = parseGeoJsonFeature(json1);

    expect(planarLineGeometry.geometry.type).eq('polygon2d');
    expect(planarLineGeometry.geometry.offset).toEqual([0, 0]);
    expect(planarLineGeometry.geometry.size).toEqual([3, 6]);

    planarLineGeometry = parseGeoJsonFeature(json2);

    expect(planarLineGeometry.geometry.type).eq('polygon2d');
    expect(planarLineGeometry.geometry.offset).toEqual([0, 0]);
    expect(planarLineGeometry.geometry.size).toEqual([5, 11]);
  });
});
