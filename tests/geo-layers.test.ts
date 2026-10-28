import { describe, expect, it } from 'vitest';
import { polygonLabelPoint } from '../src/sdk/geometries/polygon-label';
import {
  densifyPlanarGeometry,
  geoFeaturesFromGeoJson,
  type GeoJsonFeatureCollection,
} from '../src/sdk/layers/geo-features';
import { layerVisibilityAt } from '../src/sdk/layers/layer-visibility';
import {
  buildOverlayTile,
  OVERLAY_TILE_BAND,
  packOverlayShapes,
} from '../src/sdk/layers/overlay-tiles';
import { advanceTrack, courseToHeading, knots } from '../src/sdk/layers/tracks';
import {
  PlanarPolygonGeometry,
  type PlanarPolygonCoordinates,
} from '../src/sdk/geometries/planar-geometry';
import {
  geoFrameAt,
  geoFrameXZ,
  geoFrameLonLat,
} from '../src/sdk/projection/geo-frame';
import { geoTileKeyAt, geoTileRegion } from '../src/sdk/tiles/geo-tile-keys';
import type { Vec2 } from '../src/sdk/types/common';

const square = (lon: number, lat: number, size: number): Vec2[] => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];

describe('geoFeaturesFromGeoJson', () => {
  const collection: GeoJsonFeatureCollection<{ name: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'a',
        properties: { name: 'polygon with a hole' },
        geometry: {
          type: 'Polygon',
          coordinates: [square(2, 58, 1), square(2.25, 58.25, 0.5)],
        },
      },
      { type: 'Feature', properties: { name: 'none' }, geometry: null },
      {
        type: 'Feature',
        properties: { name: 'two parts' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[square(4, 60, 0.1)], [square(5, 61, 0.2)]],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'line' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
    ],
  };
  const features = geoFeaturesFromGeoJson(collection);

  it('reads polygons with holes and multi-part polygons, and leaves out what has no geometry', () => {
    expect(features.map(f => f.properties.name)).toEqual([
      'polygon with a hole',
      'two parts',
      'line',
    ]);
    const [holed, parts] = features;
    expect(holed.geometry).toBeInstanceOf(PlanarPolygonGeometry);
    expect((holed.geometry.coordinates as Vec2[][][])[0]).toHaveLength(2);
    expect((parts.geometry.coordinates as Vec2[][][]).length).toBe(2);
  });

  it('keeps the collection order in index, and the id or the index as id', () => {
    expect(features.map(f => f.index)).toEqual([0, 2, 3]);
    expect(features.map(f => f.id)).toEqual(['a', 2, 3]);
  });

  it('gives bounds in longitude and latitude', () => {
    expect(features[1].bounds).toEqual([4, 60, 5.2, 61.2]);
  });

  it('densifies long edges and keeps the vertices', () => {
    const dense = densifyPlanarGeometry(features[0].geometry, 0.1);
    const outer = (dense.coordinates as Vec2[][][])[0][0];
    expect(outer.length).toBe(4 * 10 + 1);
    expect(outer[10]).toEqual([3, 58]);
  });
});

describe('geoFrameXZ', () => {
  it('is the reverse of geoFrameLonLat', () => {
    const frame = { ...geoFrameAt(2, 58), offset: [100, -50] as Vec2 };
    const toXZ = geoFrameXZ(frame);
    const toLonLat = geoFrameLonLat(frame);
    const [x, z] = toXZ(2.3, 58.2);
    const [lon, lat] = toLonLat(x, z);
    expect(lon).toBeCloseTo(2.3, 9);
    expect(lat).toBeCloseTo(58.2, 9);
    // East is +X, north is −Z.
    expect(toXZ(2, 58)).toEqual([100, -50].map(v => expect.closeTo(v, 6)));
    expect(toXZ(2.01, 58)[0]).toBeGreaterThan(100);
    expect(toXZ(2, 58.01)[1]).toBeLessThan(-50);
  });
});

describe('buildOverlayTile', () => {
  const depth = 8;
  const key = geoTileKeyAt(depth, 2.3, 58.3);
  const [west, north, span] = geoTileRegion(key);
  const size = 64;
  const n = size + 2;
  const cell = span / size;
  const texelAt = (lon: number, lat: number) => {
    const i = Math.floor((lon - west) / cell + 1);
    const j = Math.floor((north - lat) / cell + 1);
    return j * n + i;
  };
  const decode = (data: Uint8Array, at: number) => ({
    d: ((data[4 * at] - 128) / 127) * OVERLAY_TILE_BAND,
    id: (data[4 * at + 1] << 8) + data[4 * at + 2] - 1,
  });
  // A square over the middle of the tile, a hole in it, and a second square over its
  // east side on top.
  const mid = west + span / 2;
  const midLat = north - span / 2;
  const a: PlanarPolygonCoordinates = [
    [
      square(mid - span / 4, midLat - span / 4, span / 2),
      square(mid - span / 16, midLat - span / 16, span / 8),
    ],
  ];
  const b: PlanarPolygonCoordinates = [
    [square(mid, midLat - span / 8, span / 4)],
  ];
  const tile = buildOverlayTile(
    packOverlayShapes([
      { id: 7, polygon: a },
      { id: 300, polygon: b },
    ]),
    key,
    size,
  );

  it('is signed: inside positive, outside and in a hole negative', () => {
    expect(
      decode(tile.data, texelAt(mid - span / 5, midLat)).d,
    ).toBeGreaterThan(0);
    expect(decode(tile.data, texelAt(west + span / 32, midLat)).d).toBeLessThan(
      0,
    );
    expect(
      decode(tile.data, texelAt(mid - span / 64, midLat - span / 64)).d,
    ).toBeLessThan(0);
    expect(tile.empty).toBe(false);
    expect(tile.leaf).toBe(false);
  });

  it('names the last shape over a texel, ids past 255 too', () => {
    expect(decode(tile.data, texelAt(mid - span / 5, midLat)).id).toBe(7);
    expect(decode(tile.data, texelAt(mid + span / 6, midLat)).id).toBe(300);
    expect(decode(tile.data, texelAt(west + span / 32, midLat)).id).toBe(-1);
  });

  it('keeps an edge inside the overlap, for its outline', () => {
    // b's west edge runs through a's inside, at `mid`.
    const at = texelAt(mid + cell / 2, midLat - span / 32);
    const { d } = decode(tile.data, at);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1.5);
  });

  it('measures in metres alike both ways: along a parallel a texel is cos(latitude) narrower', () => {
    // A texel's middle a texel west of a's west edge lies cos(lat) of a meridian texel off it.
    const edge = mid - span / 4;
    const at = texelAt(edge - cell, midLat);
    const i = at % n;
    const u = i + 0.5 - ((edge - west) / cell + 1);
    const expected = Math.abs(u) * Math.cos((midLat * Math.PI) / 180);
    expect(Math.abs(decode(tile.data, at).d)).toBeCloseTo(expected, 1);
  });

  it('agrees with its neighbour across their edge', () => {
    const east = geoTileKeyAt(depth, west + span * 1.5, midLat);
    const across: PlanarPolygonCoordinates = [
      [square(west + span - span / 8, midLat - span / 8, span / 4)],
    ];
    const shapes = packOverlayShapes([{ id: 0, polygon: across }]);
    const left = buildOverlayTile(shapes, key, size);
    const right = buildOverlayTile(shapes, east, size);
    // The left tile's border column past its east edge is the right tile's first column.
    for (let j = 1; j <= size; j++) {
      expect(left.data[4 * (j * n + size + 1)]).toBe(
        right.data[4 * (j * n + 1)],
      );
    }
  });

  it('shows a shape smaller than a texel as a dot', () => {
    const tiny: PlanarPolygonCoordinates = [
      [square(mid + cell * 0.1, midLat + cell * 0.1, cell * 0.2)],
    ];
    const dot = buildOverlayTile(
      packOverlayShapes([{ id: 3, polygon: tiny }]),
      key,
      size,
    );
    expect(dot.empty).toBe(false);
    const at = texelAt(mid + cell * 0.2, midLat + cell * 0.2);
    expect(decode(dot.data, at)).toMatchObject({ id: 3 });
    expect(decode(dot.data, at).d).toBeGreaterThan(0);
  });

  it('is a leaf when no edge comes near, and empty with no shape', () => {
    const over: PlanarPolygonCoordinates = [
      [square(west - 1, north - span - 1, span + 2)],
    ];
    const inside = buildOverlayTile(
      packOverlayShapes([{ id: 0, polygon: over }]),
      key,
      size,
    );
    expect(inside.leaf).toBe(true);
    expect(inside.empty).toBe(false);
    const none = buildOverlayTile(packOverlayShapes([]), key, size);
    expect(none.empty).toBe(true);
  });
});

describe('polygonLabelPoint', () => {
  it('lies inside a concave polygon, where its centroid does not', () => {
    // A C shape: the middle of its bounds is in its mouth.
    const c: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 8],
      [10, 8],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const label = polygonLabelPoint([[c]], 0.001)!;
    expect(label.point[0]).toBeLessThan(2);
    // In a corner, where the back meets an arm: 2√2 / (1 + √2) from the edges.
    expect(label.distance).toBeCloseTo((2 * Math.SQRT2) / (1 + Math.SQRT2), 2);
  });

  it('takes the part with the most room', () => {
    const label = polygonLabelPoint([[square(0, 0, 1)], [square(10, 10, 4)]])!;
    expect(label.point[0]).toBeCloseTo(12, 1);
    expect(label.point[1]).toBeCloseTo(12, 1);
  });

  it('is null for a polygon without area', () => {
    expect(
      polygonLabelPoint([
        [
          [
            [0, 0],
            [1, 0],
            [2, 0],
            [0, 0],
          ],
        ],
      ]),
    ).toBeNull();
  });
});

describe('tracks', () => {
  it('moves at its speed along its course', () => {
    const at = advanceTrack(
      { longitude: 2, latitude: 58, speed: 10, course: 0 },
      60,
    );
    expect(at.longitude).toBeCloseTo(2, 9);
    expect((((at.latitude - 58) * Math.PI) / 180) * 6371000).toBeCloseTo(
      600,
      3,
    );
    const east = advanceTrack(
      { longitude: 2, latitude: 60, speed: 10, course: 90 },
      60,
    );
    const metres =
      (((east.longitude - 2) * Math.PI) / 180) *
      6371000 *
      Math.cos((60 * Math.PI) / 180);
    expect(metres).toBeCloseTo(600, 1);
  });

  it('turns a course into a heading about +Y from +X, the map convergence counted', () => {
    const toXZ = geoFrameXZ(geoFrameAt(2, 58));
    // At the frame's meridian, north is −Z: rotation.y of π/2 turns +X to −Z.
    expect(courseToHeading(toXZ, 2, 58, 0)).toBeCloseTo(Math.PI / 2, 4);
    expect(courseToHeading(toXZ, 2, 58, 90)).toBeCloseTo(0, 4);
    // East of the meridian the meridians lean toward it going north: true north turns
    // west of grid north, by about Δλ sin φ.
    const convergence = ((2 * Math.PI) / 180) * Math.sin((58 * Math.PI) / 180);
    expect(courseToHeading(toXZ, 4, 58, 0)).toBeCloseTo(
      Math.PI / 2 + convergence,
      3,
    );
  });

  it('converts knots', () => {
    expect(knots(1)).toBeCloseTo(0.5144, 4);
  });
});

describe('layerVisibilityAt', () => {
  it('shows within its heights, fading past them by a ratio', () => {
    const range = { minHeight: 1000, maxHeight: 100000, fade: 0.25 };
    expect(layerVisibilityAt(50000, range)).toBe(1);
    expect(layerVisibilityAt(125000, range)).toBe(0);
    expect(layerVisibilityAt(112500, range)).toBeCloseTo(0.5);
    expect(layerVisibilityAt(800, range)).toBe(0);
    expect(layerVisibilityAt(900, range)).toBeCloseTo(0.5);
    expect(layerVisibilityAt(50000, { ...range, visible: false })).toBe(0);
    expect(layerVisibilityAt(-10, {})).toBe(1);
  });
});
