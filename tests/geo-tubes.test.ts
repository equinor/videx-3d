import { describe, expect, it } from 'vitest';
import { drapePolyline } from '../src/sdk/geometries/surface-drape';
import { geoDistance, type LonLat } from '../src/sdk/layers/geo-lines';
import {
  GEO_TUBE_NODE_STRIDE as S,
  geoSpanLift,
  geoTubeNodesAround,
  layGeoTubeNodes,
  liftGeoTubeNodes,
  packGeoTubeRoutes,
  type GeoTubeRoute,
} from '../src/sdk/layers/geo-tubes';
import {
  conformalOffset,
  conformalSphere,
  type ConformalOrigin,
} from '../src/sdk/projection/conformal-sphere';
import { geoTileKeyAt } from '../src/sdk/tiles/geo-tile-keys';
import { geoDrawnTileAt, tileAncestors } from '../src/sdk/tiles/tile-cover';
import { tileChildren } from '../src/sdk/tiles/tile-keys';

const centre: LonLat = [1.9, 58.44];
const origin: ConformalOrigin = {
  sphere: conformalSphere((centre[1] * Math.PI) / 180),
  longitude0: (centre[0] * Math.PI) / 180,
};
const arrays = (capacity: number) => ({
  capacity,
  nodes: new Float32Array(capacity * S),
  lonLat: new Float64Array(capacity * 2),
  along: new Float64Array(capacity),
  near: new Uint8Array(capacity),
});
const route = (parts: LonLat[][], id = 0): GeoTubeRoute => {
  const all = parts.flat();
  return {
    id,
    parts,
    bounds: [
      Math.min(...all.map(p => p[0])),
      Math.min(...all.map(p => p[1])),
      Math.max(...all.map(p => p[0])),
      Math.max(...all.map(p => p[1])),
    ],
  };
};
const routes = (...list: GeoTubeRoute[]) => packGeoTubeRoutes(list);
describe('geoDrawnTileAt', () => {
  it('finds the tile drawn over a point, from the roots down', () => {
    const key = geoTileKeyAt(9, centre[0], centre[1]);
    const children = tileChildren(key);
    const drawn = new Set(children);
    const found = geoDrawnTileAt(
      centre[0],
      centre[1],
      drawn,
      tileAncestors(drawn),
    );
    expect(found).toBe(geoTileKeyAt(10, centre[0], centre[1]));
    expect(children).toContain(found);
    expect(geoDrawnTileAt(10, 60, drawn, tileAncestors(drawn))).toBeNull();
  });
});

describe('packGeoTubeRoutes', () => {
  it('packs every part of two vertices or more, with its feature and bounds', () => {
    const packed = routes(
      route(
        [
          [
            [1, 2],
            [3, 4],
          ],
          [[9, 9]],
        ],
        5,
      ),
      route([
        [
          [0, 0],
          [1, -1],
          [2, 0],
        ],
      ]),
    );
    expect(Array.from(packed.starts)).toEqual([0, 2, 5]);
    expect(Array.from(packed.ids)).toEqual([5, 0]);
    expect(Array.from(packed.bounds)).toEqual([1, 2, 3, 4, 0, -1, 2, 0]);
    expect(packed.coordinates.length).toBe(10);
  });
});

describe('layGeoTubeNodes', () => {
  // East from the centre, 60 km.
  const line: LonLat[] = [
    [1.9, 58.44],
    [2.926, 58.44],
  ];

  it('lays nodes `spacing` apart near the camera and farther apart farther off', () => {
    const out = arrays(10000);
    const count = layGeoTubeNodes(
      routes(route([line], 3)),
      centre,
      0,
      { spacing: 20, spacingPerDistance: 0.01 },
      origin,
      -100,
      out,
    );
    const at = (i: number): LonLat => [
      out.lonLat[2 * i],
      out.lonLat[2 * i + 1],
    ];
    // 20 m apart within 2 km, then 1 % of the distance: about 100 + 100 ln(30).
    expect(count).toBeGreaterThan(350);
    expect(count).toBeLessThan(550);
    expect(geoDistance(at(0), at(1))).toBeCloseTo(20, 0);
    // The last full step, at about 60 km (the very last is what is left to the vertex).
    const lastStep = geoDistance(at(count - 3), at(count - 2));
    expect(lastStep).toBeGreaterThan(400);
    expect(lastStep).toBeLessThan(620);
    // Its vertices kept, its end ending its part; east, level, on the fallback.
    expect(at(0)).toEqual(line[0]);
    expect(at(count - 1)).toEqual(line[1]);
    for (let i = 0; i < count; i++) {
      const n = i * S;
      const offset = conformalOffset(origin, at(i)[1], at(i)[0]);
      expect(out.nodes[n]).toBeCloseTo(offset[0], 6);
      expect(out.nodes[n + 1]).toBeCloseTo(offset[1], 6);
      expect(out.nodes[n + 2]).toBe(0);
      expect(out.nodes[n + 3]).toBe(-100);
      expect(out.nodes[n + 4]).toBeCloseTo(1, 5);
      expect(out.nodes[n + 6]).toBe(0);
      expect(out.nodes[n + 7]).toBe(i === count - 1 ? 1 : 0);
      expect(out.nodes[n + 8]).toBe(3);
      expect(out.near[i]).toBe(0);
    }
    expect(out.along[count - 1]).toBeCloseTo(geoDistance(line[0], line[1]), -1);
  });

  it('counts the camera’s height in the distance', () => {
    const low = layGeoTubeNodes(
      routes(route([line])),
      centre,
      0,
      { spacing: 20 },
      origin,
      0,
      arrays(10000),
    );
    const high = layGeoTubeNodes(
      routes(route([line])),
      centre,
      20000,
      { spacing: 20 },
      origin,
      0,
      arrays(10000),
    );
    expect(high).toBeLessThan(low / 2);
  });

  it('leaves out routes past maxDistance, and returns -1 when they do not fit', () => {
    const far = route([
      [
        [5, 60],
        [5.1, 60],
      ],
    ]);
    expect(
      layGeoTubeNodes(
        routes(far),
        centre,
        0,
        { spacing: 20, maxDistance: 50000 },
        origin,
        0,
        arrays(100),
      ),
    ).toBe(0);
    expect(
      layGeoTubeNodes(
        routes(route([line])),
        centre,
        0,
        { spacing: 20 },
        origin,
        0,
        arrays(10),
      ),
    ).toBe(-1);
  });

  it('marks the nodes closer together than the span as near', () => {
    const out = arrays(10000);
    const count = layGeoTubeNodes(
      routes(route([line])),
      centre,
      0,
      { spacing: 20, span: 60 },
      origin,
      0,
      out,
    );
    // Steps under 60 m: within 6 km of the camera, a run from the start.
    let last = -1;
    for (let i = 0; i < count; i++) if (out.near[i]) last = i;
    expect(out.near[0]).toBe(1);
    for (let i = 0; i <= last; i++) expect(out.near[i]).toBe(1);
    expect(out.along[last]).toBeGreaterThan(5900);
    expect(out.along[last]).toBeLessThan(6000);
  });
});

describe('liftGeoTubeNodes', () => {
  const line: LonLat[] = [
    [1.9, 58.44],
    [2.926, 58.44],
  ];
  // A trench 10 m deep and 100 m wide across the route, 1 km east of the centre.
  const ground = (longitude: number) =>
    Math.abs((longitude - 1.917) * 58000) < 50 ? -100 : -90;

  it('lifts a stiff pipe over a hollow near the camera, by what its span adds', () => {
    const out = arrays(10000);
    const count = layGeoTubeNodes(
      routes(route([line])),
      centre,
      0,
      { spacing: 20, span: 200 },
      origin,
      0,
      out,
    );
    const written = liftGeoTubeNodes(out, count, { span: 200 }, ground, 0);
    expect(written).not.toBeNull();
    let most = 0;
    for (let i = 0; i < count; i++) {
      const lift = out.nodes[i * S + 2];
      expect(lift).toBeGreaterThanOrEqual(0);
      most = Math.max(most, lift);
      expect(out.nodes[i * S + 3]).toBe(
        out.near[i] ? ground(out.lonLat[2 * i]) : 0,
      );
    }
    expect(most).toBeCloseTo(10, 5);
    // Again on the same ground: the same.
    const before = out.nodes.slice(0, count * S);
    liftGeoTubeNodes(out, count, { span: 200 }, ground, 0);
    expect(out.nodes.slice(0, count * S)).toEqual(before);
  });

  it('does nothing without a span', () => {
    const out = arrays(10000);
    const count = layGeoTubeNodes(
      routes(route([line])),
      centre,
      0,
      { spacing: 20 },
      origin,
      0,
      out,
    );
    expect(liftGeoTubeNodes(out, count, { span: 0 }, ground, 0)).toBeNull();
  });
});

describe('geoTubeNodesAround', () => {
  const line: LonLat[] = [
    [1.9, 58.44],
    [2.926, 58.44],
  ];

  it('hands back arrays of the nodes’ own length, as layGeoTubeNodes lays them', () => {
    const laid = geoTubeNodesAround(
      routes(route([line], 2)),
      centre,
      0,
      { spacing: 20 },
      origin,
      -50,
      10000,
    );
    const out = arrays(10000);
    const count = layGeoTubeNodes(
      routes(route([line], 2)),
      centre,
      0,
      { spacing: 20 },
      origin,
      -50,
      out,
    );
    expect(laid.count).toBe(count);
    expect(laid.nodes.length).toBe(count * S);
    expect(laid.lonLat.length).toBe(count * 2);
    expect(laid.nodes).toEqual(out.nodes.slice(0, count * S));
    expect(laid.spacingPerDistance).toBe(0.01);
  });

  it('spaces them farther apart until they fit', () => {
    const laid = geoTubeNodesAround(
      routes(route([line])),
      centre,
      0,
      { spacing: 20 },
      origin,
      0,
      200,
    );
    expect(laid.count).toBeGreaterThan(0);
    expect(laid.count).toBeLessThanOrEqual(200);
    expect(laid.spacingPerDistance).toBeGreaterThan(0.01);
  });
});
describe('geoSpanLift', () => {
  it('rests on the high points within the span, never below the ground, 0 where unknown', () => {
    const ground = Float64Array.from([0, -5, -10, -5, 0, NaN, 0]);
    const along = Float64Array.from([0, 10, 20, 30, 40, 50, 60]);
    expect(Array.from(geoSpanLift(ground, along, 0))).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(Array.from(geoSpanLift(ground, along, 20))).toEqual([
      0, 5, 5, 5, 0, 0, 0,
    ]);
    expect(Array.from(geoSpanLift(ground, along, 40))).toEqual([
      0, 5, 10, 5, 0, 0, 0,
    ]);
  });
});

describe('drapePolyline', () => {
  it('hands back the ground under each point', () => {
    const draped = drapePolyline(
      [
        [0, 0],
        [100, 0],
      ],
      x => -x / 10,
      { spacing: 25 },
    )!;
    expect(draped.ground.map(v => v + 0)).toEqual([0, -2.5, -5, -7.5, -10]);
    draped.points.forEach(([, y], i) =>
      expect(y).toBeCloseTo(draped.ground[i], 9),
    );
  });
});
