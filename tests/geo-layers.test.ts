import { describe, expect, it } from 'vitest';
import {
  polygonLabelPlaces,
  polygonLabelPoint,
  polygonLabelRect,
  polygonMainAxis,
} from '../src/sdk/geometries/polygon-label';
import {
  densifyPlanarGeometry,
  geoFeaturesFromGeoJson,
  type GeoJsonFeatureCollection,
} from '../src/sdk/layers/geo-features';
import {
  layerRevealAt,
  layerVisibilityAt,
} from '../src/sdk/layers/layer-visibility';
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

describe('polygonLabelRect', () => {
  const rect = (w: number, h: number, angle = 0): Vec2[] => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return (
      [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
        [-w / 2, -h / 2],
      ] as Vec2[]
    ).map(([x, z]) => [x * c - z * s + 5, x * s + z * c + 7] as Vec2);
  };

  it('fills a rectangle of its own shape, and is as high as one of another fits', () => {
    const own = polygonLabelRect([[rect(8, 2)]], 4, 0, 1e-4)!;
    expect(own.centre[0]).toBeCloseTo(5, 3);
    expect(own.centre[1]).toBeCloseTo(7, 3);
    expect(own.width).toBeCloseTo(8, 3);
    expect(own.height).toBeCloseTo(2, 3);
    // Twice as wide as high in an 8 × 2: as high as it is.
    const wide = polygonLabelRect([[rect(8, 2)]], 2, 0, 1e-4)!;
    expect(wide.height).toBeCloseTo(2, 3);
    expect(wide.width).toBeCloseTo(4, 3);
    // Eight times: as wide.
    const narrow = polygonLabelRect([[rect(8, 2)]], 8, 0, 1e-4)!;
    expect(narrow.width).toBeCloseTo(8, 3);
    expect(narrow.height).toBeCloseTo(1, 3);
  });

  it('fits along a turned polygon when turned with it, far larger than level', () => {
    const turned = [[rect(20, 2, Math.PI / 6)]];
    const along = polygonLabelRect(turned, 5, Math.PI / 6)!;
    expect(along.height).toBeCloseTo(2, 1);
    expect(along.centre[0]).toBeCloseTo(5, 1);
    expect(along.centre[1]).toBeCloseTo(7, 1);
    const level = polygonLabelRect(turned, 5, 0)!;
    expect(level.height).toBeLessThan(along.height / 2);
  });

  it('keeps out of a concave polygon’s mouth and its holes', () => {
    // An L: its long arm 10 × 3 along the bottom, its short one 3 × 10 up the left.
    const l: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 3],
      [3, 3],
      [3, 10],
      [0, 10],
      [0, 0],
    ];
    const found = polygonLabelRect([[l]], 3, 0, 1e-4)!;
    // Three times as wide as high: along the bottom arm, as high as it.
    expect(found.height).toBeCloseTo(3, 2);
    expect(found.centre[1]).toBeCloseTo(1.5, 2);
    expect(found.centre[0] - found.width / 2).toBeGreaterThanOrEqual(-1e-3);
    // A hole in the middle of a square: the band beside it.
    const holed = polygonLabelRect([[square(0, 0, 10), square(3, 3, 4)]], 3)!;
    const [cx, cz] = holed.centre;
    const clear =
      cz + holed.height / 2 <= 3 + 0.2 || cz - holed.height / 2 >= 7 - 0.2;
    expect(
      clear || cx + holed.width / 2 <= 3.2 || cx - holed.width / 2 >= 6.8,
    ).toBe(true);
  });

  it('takes the part with the most room, and is null without area', () => {
    const found = polygonLabelRect(
      [[square(0, 0, 1)], [square(10, 10, 4)]],
      1,
    )!;
    expect(found.centre[0]).toBeCloseTo(12, 1);
    expect(found.height).toBeCloseTo(4, 1);
    expect(
      polygonLabelRect(
        [
          [
            [
              [0, 0],
              [1, 0],
              [2, 0],
              [0, 0],
            ],
          ],
        ],
        2,
      ),
    ).toBeNull();
  });

  it('turns a label along a long polygon only where that gives far more room', () => {
    const shapes = [
      { width: 5, height: 1 },
      { width: 2.5, height: 2.2 },
    ];
    const [wide, tall] = polygonLabelPlaces(
      [[rect(20, 2, Math.PI / 6)]],
      shapes,
    );
    expect(wide!.angle).toBeCloseTo(Math.PI / 6, 6);
    expect(wide!.height).toBeCloseTo(2, 1);
    expect(tall!.angle).toBeCloseTo(Math.PI / 6, 6);
    // Not asked to: level.
    expect(
      polygonLabelPlaces([[rect(20, 2, Math.PI / 6)]], shapes, false)[0]!.angle,
    ).toBe(0);
    // A square has no main axis: level.
    expect(
      polygonLabelPlaces([[rect(10, 10, 0.3)]], shapes).map(r => r!.angle),
    ).toEqual([0, 0]);
  });
});

describe('polygonMainAxis', () => {
  it('runs along a rectangle, however it is turned or wound', () => {
    const turned = (angle: number, reverse = false) => {
      const ring: Vec2[] = [
        [-3, -0.5],
        [3, -0.5],
        [3, 0.5],
        [-3, 0.5],
      ].map(([x, z]) => [
        x * Math.cos(angle) - z * Math.sin(angle) + 100,
        x * Math.sin(angle) + z * Math.cos(angle) - 40,
      ]);
      return [[reverse ? ring.reverse() : ring]];
    };
    for (const angle of [0, 0.4, -1.1, 1.5]) {
      const axis = polygonMainAxis(turned(angle))!;
      expect(axis.angle).toBeCloseTo(angle, 6);
      expect(axis.elongation).toBeCloseTo(6, 6);
      expect(polygonMainAxis(turned(angle, true))!.angle).toBeCloseTo(angle, 6);
    }
    // Pointing back: the same axis, within (−π/2, π/2].
    expect(polygonMainAxis(turned(Math.PI - 0.3))!.angle).toBeCloseTo(-0.3, 6);
  });

  it('counts holes out, and is 1 for a square', () => {
    const square10 = square(0, 0, 10);
    expect(polygonMainAxis([[square10]])!.elongation).toBeCloseTo(1, 6);
    // A square with a slot along X taken out: its mass lies more across it.
    const slotted = polygonMainAxis([
      [
        square10,
        [
          [1, 4],
          [9, 4],
          [9, 6],
          [1, 6],
          [1, 4],
        ],
      ],
    ])!;
    expect(Math.abs(Math.abs(slotted.angle) - Math.PI / 2)).toBeLessThan(1e-6);
    expect(slotted.elongation).toBeGreaterThan(1);
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

describe('layerRevealAt', () => {
  it('reveals never without one, always with true, else by its heights', () => {
    expect(layerRevealAt(50000, undefined)).toBe(0);
    expect(layerRevealAt(50000, false)).toBe(0);
    expect(layerRevealAt(-10, true)).toBe(1);
    const above = { minHeight: 20000, fade: 0.25 };
    expect(layerRevealAt(5000, above)).toBe(0);
    expect(layerRevealAt(18000, above)).toBeCloseTo(0.5);
    expect(layerRevealAt(400000, above)).toBe(1);
    expect(layerRevealAt(400000, { ...above, visible: false })).toBe(0);
  });
});
