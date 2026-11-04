import { describe, expect, it } from 'vitest';
import {
  equalEarth,
  EQUAL_EARTH_RADIUS,
  lambertConformalConic,
  lambertParallelsFor,
  mapPlane,
  mapProjectionScale,
  webMercator,
  WEB_MERCATOR_MAX_LATITUDE,
} from '../src/sdk/projection/map-projections';
import {
  mapScaleBar,
  mapViewCone,
  mapViewFromPixel,
  mapViewLonLatAt,
  mapViewLonLatToPixel,
  mapViewToPixel,
  mapViewZoomAt,
  niceScaleLength,
  projectMapView,
  type MapView,
} from '../src/sdk/projection/map-view';
import type { Vec2 } from '../src/sdk/types/common';

const points: Vec2[] = [
  [0, 0],
  [2.5, 58.4],
  [-120, -33],
  [179, 70],
  [-45, -80],
];

describe('map projections', () => {
  for (const projection of [webMercator, equalEarth]) {
    it(`${projection.name}: inverse undoes forward`, () => {
      for (const [lon, lat] of points) {
        if (Math.abs(lat) > WEB_MERCATOR_MAX_LATITUDE) continue;
        const [x, y] = projection.forward(lon, lat);
        expect(projection.contains(x, y)).toBe(true);
        const [l, p] = projection.inverse(x, y);
        expect(l).toBeCloseTo(lon, 9);
        expect(p).toBeCloseTo(lat, 9);
      }
    });
  }

  it('web-mercator: twice as large at 60°, and clamped at its ends', () => {
    expect(mapProjectionScale(webMercator, 0, 0)).toBeCloseTo(1, 2);
    expect(mapProjectionScale(webMercator, 0, 60)).toBeCloseTo(2, 2);
    const [, top] = webMercator.forward(0, 89);
    const [, end] = webMercator.forward(0, WEB_MERCATOR_MAX_LATITUDE);
    expect(top).toBeCloseTo(end, 6);
    expect(webMercator.contains(0, end * 1.01)).toBe(false);
  });

  it('equal-earth: equal-area, and bounded by its outline', () => {
    for (const lat of [0, 30, 60, 80])
      expect(mapProjectionScale(equalEarth, 20, lat)).toBeCloseTo(1, 3);
    const [edge] = equalEarth.forward(180, 0);
    expect(equalEarth.contains(edge * 0.999, 0)).toBe(true);
    expect(equalEarth.contains(edge * 1.001, 0)).toBe(false);
    // Narrower toward the poles.
    const [, y] = equalEarth.forward(0, 80);
    expect(equalEarth.contains(edge * 0.9, y)).toBe(false);
    // Past the edge: the nearest point it holds.
    expect(equalEarth.inverse(edge * 2, 0)[0]).toBe(180);
    expect(EQUAL_EARTH_RADIUS).toBeGreaterThan(6e6);
  });
});

describe('lambertConformalConic', () => {
  const lcc = lambertConformalConic([50, 66], 58);
  // Scale east and north at a point, from finite differences on the sphere.
  const scales = (lon: number, lat: number) => {
    const d = 0.001;
    const at = lcc.forward(lon, lat);
    const east = lcc.forward(lon + d / Math.cos((lat * Math.PI) / 180), lat);
    const north = lcc.forward(lon, lat + d);
    const metres = ((d * Math.PI) / 180) * EQUAL_EARTH_RADIUS;
    return [
      Math.hypot(east[0] - at[0], east[1] - at[1]) / metres,
      Math.hypot(north[0] - at[0], north[1] - at[1]) / metres,
    ];
  };

  it('undoes itself, east and west of its meridian', () => {
    for (const [lon, lat] of [
      [0, 58],
      [25, 70],
      [-60, 30],
      [120, -40],
    ] as Vec2[]) {
      const [x, y] = lcc.forward(lon, lat);
      expect(lcc.contains(x, y)).toBe(true);
      const [l, p] = lcc.inverse(x, y);
      expect(l).toBeCloseTo(lon, 8);
      expect(p).toBeCloseTo(lat, 8);
    }
  });

  it('is conformal, true to scale on its standard parallels and less between', () => {
    for (const lat of [40, 58, 75]) {
      const [k, h] = scales(10, lat);
      expect(k).toBeCloseTo(h, 4);
    }
    expect(scales(0, 50)[0]).toBeCloseTo(1, 4);
    expect(scales(0, 66)[0]).toBeCloseTo(1, 4);
    expect(scales(0, 58)[0]).toBeLessThan(1);
    expect(mapProjectionScale(lcc, 0, 66)).toBeCloseTo(1, 3);
  });

  it('puts its origin at y = 0 and ends short of the far pole', () => {
    expect(lcc.forward(0, 58)[1]).toBeCloseTo(0, 6);
    const [x, y] = lcc.forward(0, -85);
    expect(lcc.inverse(x, y)[1]).toBeCloseTo(-80, 6);
    // Past 180° from its meridian: off the map.
    const { n, rho0 } = lcc.cone!;
    const [, y40] = lcc.forward(0, 40);
    const r = rho0 - y40;
    const theta = n * Math.PI + 0.05;
    expect(lcc.contains(r * Math.sin(theta), rho0 - r * Math.cos(theta))).toBe(
      false,
    );
    const inside = n * Math.PI - 0.05;
    expect(
      lcc.contains(r * Math.sin(inside), rho0 - r * Math.cos(inside)),
    ).toBe(true);
  });

  it('opens the other way in the south, and is Mercator about the equator', () => {
    const south = lambertConformalConic([-30, -50], -40);
    expect(south.cone!.n).toBeLessThan(0);
    const [x, y] = south.forward(15, -45);
    const [l, p] = south.inverse(x, y);
    expect(l).toBeCloseTo(15, 8);
    expect(p).toBeCloseTo(-45, 8);
    expect(lambertConformalConic([-10, 10], 0)).toBe(webMercator);
  });

  it('takes its parallels a sixth in from the edges', () => {
    expect(lambertParallelsFor(58, 30)).toEqual([48, 68]);
  });
});

// A scene of 100 km a degree, about 0°, 0°: X east, Z south.
const toLonLat = (x: number, z: number): Vec2 => [x / 1e5, -z / 1e5];
const toXZ = (lon: number, lat: number): Vec2 => [lon * 1e5, -lat * 1e5];

describe('mapPlane', () => {
  it('takes scene points to the plane, east and south, and back', () => {
    const plane = mapPlane(equalEarth, 10, toLonLat, toXZ);
    const [u, v] = plane.toPlane(10e5, -40e5);
    // On the central meridian, north of the equator.
    expect(u).toBeCloseTo(0, 6);
    expect(v).toBeLessThan(0);
    const [x, z] = plane.fromPlane(u, v);
    expect(x).toBeCloseTo(10e5, 3);
    expect(z).toBeCloseTo(-40e5, 3);
    expect(plane.lonLatAt(u, v)[1]).toBeCloseTo(40, 9);
  });

  it('wraps longitudes about its central meridian', () => {
    const plane = mapPlane(webMercator, 170, toLonLat, toXZ);
    // 175°W is 15° east of 170°E.
    const [u] = plane.toPlane(-175e5, 0);
    expect(u).toBeCloseTo(webMercator.forward(15, 0)[0], 3);
  });
});

describe('mapViewCone', () => {
  const view: MapView = {
    center: [2e5, -58e5],
    up: [0, -1],
    metresPerPixel: 1000,
    size: [200, 100],
  };
  const at: Vec2 = [2e5, -58e5];
  const angleOf = ([x, y]: Vec2) => Math.atan2(x, -y);

  it('in the scene’s map: the wedge of old, its edges at the fov about the heading', () => {
    // Heading east, 60°, 50 px.
    const cone = mapViewCone(view, at, [1, 0], Math.PI / 3, { pixels: 50 });
    expect(cone[0]).toEqual([0, 0]);
    const first = cone[1];
    const last = cone[cone.length - 1];
    expect(angleOf(first)).toBeCloseTo(Math.PI / 2 - Math.PI / 6, 6);
    expect(angleOf(last)).toBeCloseTo(Math.PI / 2 + Math.PI / 6, 6);
    expect(Math.hypot(...first)).toBeCloseTo(50, 6);
    // In metres: 20 km is 20 pixels.
    const metres = mapViewCone(view, at, [1, 0], Math.PI / 3, 20000);
    expect(Math.hypot(...metres[1])).toBeCloseTo(20, 6);
  });

  it('in Equal Earth: its edges where the ground’s directions land, not at the fov', () => {
    const plane = mapPlane(equalEarth, 2, toLonLat, toXZ);
    const projected = projectMapView(view, plane, 'north-up');
    const half = Math.PI / 4;
    const cone = mapViewCone(projected, at, [0, -1], 2 * half, { pixels: 50 });
    const edge = cone[1];
    // Where a short step along the left edge lands.
    const [ox, oy] = mapViewToPixel(projected, at[0], at[1]);
    const d = 1000;
    const [sx, sy] = mapViewToPixel(
      projected,
      at[0] - Math.sin(half) * d,
      at[1] - Math.cos(half) * d,
    );
    expect(angleOf(edge)).toBeCloseTo(angleOf([sx - ox, sy - oy]), 2);
    // Equal Earth at 58°N stretches east–west: not the fov's 45°.
    expect(Math.abs(Math.abs(angleOf(edge)) - half)).toBeGreaterThan(0.02);
  });

  it('in metres, a circle on the ground: egg-shaped in Web Mercator', () => {
    const plane = mapPlane(webMercator, 2, toLonLat, toXZ);
    const projected = projectMapView(view, plane, 'north-up');
    const circle = mapViewCone(projected, at, [0, -1], Math.PI * 2, 500000);
    const ys = circle.map(([, y]) => y);
    // Farther up (north) than down, in pixels: the map grows toward the pole.
    expect(-Math.min(...ys)).toBeGreaterThan(Math.max(...ys) * 1.05);
  });
});

describe('projectMapView', () => {
  const view: MapView = {
    center: [2e5, -58e5],
    up: [0, -1],
    metresPerPixel: 1000,
    size: [200, 100],
  };

  it('draws the middle at the middle, and its pixels and points both ways', () => {
    const plane = mapPlane(webMercator, 2, toLonLat, toXZ);
    const projected = projectMapView(view, plane, 'north-up');
    expect(projected.up).toEqual([0, -1]);
    const [column, row] = mapViewToPixel(projected, 2e5, -58e5);
    expect(column).toBeCloseTo(100, 6);
    expect(row).toBeCloseTo(50, 6);
    const [x, z] = mapViewFromPixel(projected, 37, 81);
    const [c, r] = mapViewToPixel(projected, x, z);
    expect(c).toBeCloseTo(37, 6);
    expect(r).toBeCloseTo(81, 6);
  });

  it('keeps ground metres per pixel at the middle', () => {
    const plane = mapPlane(webMercator, 2, toLonLat, toXZ);
    const projected = projectMapView(view, plane, 'north-up');
    // 10 km north of the middle lands ten pixels up (a degree is 111 km on the ground).
    const north = -58e5 - (10000 / 111195) * 1e5;
    const [, row] = mapViewToPixel(projected, 2e5, north);
    expect(row).toBeCloseTo(40, 0);
  });

  it('carries a heading across into the plane', () => {
    const plane = mapPlane(equalEarth, 2, toLonLat, toXZ);
    // Heading east in the scene: east in the plane too.
    const projected = projectMapView(
      { ...view, up: [1, 0] },
      plane,
      'heading-up',
    );
    expect(projected.up[0]).toBeCloseTo(1, 2);
    expect(Math.abs(projected.up[1])).toBeLessThan(0.05);
  });
});

describe('map views in longitude and latitude', () => {
  const view: MapView = {
    center: [2e5, -58e5],
    up: [0, -1],
    metresPerPixel: 1000,
    size: [200, 100],
  };

  it('takes a point of the Earth to the plane directly, as through the scene', () => {
    const plane = mapPlane(webMercator, 2, toLonLat, toXZ);
    const [u, v] = plane.fromLonLat(5, 60);
    const [su, sv] = plane.toPlane(...toXZ(5, 60));
    expect(u).toBeCloseTo(su, 6);
    expect(v).toBeCloseTo(sv, 6);
    // Across the antimeridian from 170°E: the short way round.
    const far = mapPlane(webMercator, 170, toLonLat, toXZ);
    expect(far.fromLonLat(-175, 0)[0]).toBeCloseTo(
      webMercator.forward(15, 0)[0],
      3,
    );
  });

  it('lands longitude and latitude where scene X/Z land, and back', () => {
    const plane = mapPlane(equalEarth, 2, toLonLat, toXZ);
    for (const v of [view, projectMapView(view, plane, 'north-up')]) {
      const [c, r] = mapViewLonLatToPixel(v, 3, 57.5, toXZ);
      const [sc, sr] = mapViewToPixel(v, ...toXZ(3, 57.5));
      expect(c).toBeCloseTo(sc, 6);
      expect(r).toBeCloseTo(sr, 6);
      const [lon, lat] = mapViewLonLatAt(v, c, r, toLonLat);
      expect(lon).toBeCloseTo(3, 6);
      expect(lat).toBeCloseTo(57.5, 6);
    }
  });

  it('reads longitudes about the plane’s meridian, wrapped to ±180', () => {
    const plane = mapPlane(webMercator, 179, toLonLat, toXZ);
    const projected = projectMapView(
      { ...view, center: toXZ(179, 0), metresPerPixel: 3000 },
      plane,
      'north-up',
    );
    // 50 pixels east of the middle at 3 km a pixel: 1.35°, past the antimeridian.
    const [lon] = mapViewLonLatAt(projected, 150, 50, toLonLat);
    expect(lon).toBeLessThan(-179);
    expect(lon).toBeGreaterThan(-180);
  });

  it('zooms about a pixel: the ground under it stays under it', () => {
    for (const up of [
      [0, -1],
      [Math.SQRT1_2, -Math.SQRT1_2],
    ] as Vec2[]) {
      const before = { ...view, up };
      const centre = mapViewZoomAt(before, 160, 20, 0.5);
      const after: MapView = {
        ...before,
        center: centre,
        metresPerPixel: before.metresPerPixel * 0.5,
      };
      const [x, z] = mapViewFromPixel(before, 160, 20);
      const [c, r] = mapViewToPixel(after, x, z);
      expect(c).toBeCloseTo(160, 6);
      expect(r).toBeCloseTo(20, 6);
    }
    // About the middle: the middle stays.
    expect(mapViewZoomAt(view, 100, 50, 3)).toEqual(view.center);
  });

  it('measures the scale bar a quarter of the width, at least 72 pixels', () => {
    expect(mapScaleBar(view)).toEqual(niceScaleLength(1000, 72));
    expect(mapScaleBar({ ...view, size: [800, 400] })).toEqual(
      niceScaleLength(1000, 200),
    );
  });
});
