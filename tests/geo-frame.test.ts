import proj4 from 'proj4';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CRS,
  getProjectionDefFromUtmZone,
  wgs84Def,
} from '../src/sdk/projection/crs';
import {
  crsFromGeoFrame,
  GeoFrame,
  geoFrameAt,
  geoFrameFromCrs,
  geoFrameLocation,
  geoFrameSameMap,
  placeGeoFrame,
} from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';
import { geoFrameMatrix } from '../src/sdk/projection/place-frame';

// The demo field (story-args.json): UTM 31N.
const utmDef = getProjectionDefFromUtmZone('31N');
const crs = new CRS(utmDef, [434500, 6478000], 'utm');
const scene = geoFrameFromCrs(crs);

// A field in the next zone, out over the Norwegian Trench, 123 km east and 7 km north of
// the demo's origin: its own UTM 32N map about the point there.
const utm32 = getProjectionDefFromUtmZone('32N');
const TRENCH: [number, number] = [123000, -7000];
const trench: GeoFrame = {
  projection: utm32,
  origin: proj4(utmDef, utm32, [
    scene.origin[0] + TRENCH[0],
    scene.origin[1] - TRENCH[1],
  ]) as [number, number],
};

// Where the scene's map has a point of `frame`'s, `e` east and `n` north of its origin.
const exactly = (frame: GeoFrame, e: number, n: number) => {
  const [x, y] = proj4(frame.projection, scene.projection, [
    frame.origin[0] + e,
    frame.origin[1] + n,
  ]);
  return new Vector3(x - scene.origin[0], 0, scene.origin[1] - y);
};

// The worst miss over a ring of points `r` from `frame`'s origin, and its origin, between
// `placed` (a frame's X/Z to the scene) and `truth`.
const worstMiss = (
  r: number,
  placed: (x: number, z: number) => Vector3,
  truth: (e: number, n: number) => Vector3,
) => {
  let worst = 0;
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    const e = k === 16 ? 0 : r * Math.cos(a);
    const n = k === 16 ? 0 : r * Math.sin(a);
    worst = Math.max(worst, placed(e, -n).distanceTo(truth(e, n)));
  }
  return worst;
};

describe('geoFrameLocation', () => {
  it('gives the origin in degrees north and east', () => {
    const { latitude, longitude } = geoFrameLocation(scene);
    expect(latitude).toBeCloseTo(58.4359, 4);
    expect(longitude).toBeCloseTo(1.8766, 4);
  });

  it('gives back the point a frame was made about', () => {
    const place = geoFrameLocation(geoFrameAt(2.5, 59.25));
    expect(place.latitude).toBeCloseTo(59.25, 9);
    expect(place.longitude).toBeCloseTo(2.5, 9);
  });
});

describe('geoFrameFromCrs', () => {
  it('takes the CRS projection and origin', () => {
    const frame = geoFrameFromCrs(crs);
    expect(frame.projection).toBe(utmDef);
    expect(frame.origin).toEqual(crs.originUtm);
    expect(frame.origin).not.toBe(crs.originUtm);
    expect(frame.offset).toBeUndefined();
    expect(geoFrameFromCrs(crs, [10, -20]).offset).toEqual([10, -20]);
  });

  it('places a point where the CRS places it', () => {
    const frame = geoFrameFromCrs(crs);
    const [lng, lat] = [2.9, 58.1];
    const world = crs.wgs84ToWorld(lng, lat);
    // Scene X runs east and Z south of the frame's origin.
    const [e, n] = proj4(wgs84Def, frame.projection, [lng, lat]);
    expect(e - frame.origin[0]).toBeCloseTo(world.x, 6);
    expect(frame.origin[1] - n).toBeCloseTo(world.z, 6);
  });

  it('and back: crsFromGeoFrame', () => {
    const back = crsFromGeoFrame(scene);
    expect(back.utmDef).toBe(utmDef);
    expect(back.originUtm).toEqual(crs.originUtm);
    expect(geoFrameSameMap(geoFrameFromCrs(back), scene)).toBe(true);
  });
});

describe('placeGeoFrame', () => {
  it("leaves the scene's own map where it is, at its offset", () => {
    expect(placeGeoFrame(scene, scene)).toEqual({
      x: 0,
      z: 0,
      rotation: 0,
      scale: 1,
    });
    expect(placeGeoFrame(scene, { ...scene, offset: [5, -7] })).toEqual({
      x: 5,
      z: -7,
      rotation: 0,
      scale: 1,
    });
  });

  it('moves another origin in the same map, and only moves it', () => {
    const near: GeoFrame = {
      projection: utmDef,
      origin: [scene.origin[0] + 3000, scene.origin[1] - 4000],
    };
    const placed = placeGeoFrame(near, scene);
    expect(placed).toEqual({ x: 3000, z: 4000, rotation: 0, scale: 1 });
  });

  it("places a field in another UTM zone where the scene's map has it", () => {
    const placed = placeGeoFrame(trench, scene);
    // Its origin, to proj4's round trip through the datum; its grid turned by the zones'
    // convergence, about 2.6° here.
    expect(placed.x).toBeCloseTo(TRENCH[0], 2);
    expect(placed.z).toBeCloseTo(TRENCH[1], 2);
    expect(Math.abs(placed.rotation)).toBeGreaterThan(0.04);
    // 0.1%, the zones' scale factors there (UTM 32N's 1.0006 at 5° from its meridian):
    // 5 m at 5 km, were it left out.
    expect(placed.scale).toBeCloseTo(0.999, 3);
    // And what lies 5 km around it, to about 10 cm: the two maps' second order.
    const flat = geoFrameMatrix(placed, null, new Matrix4());
    const miss = worstMiss(
      5000,
      (x, z) => new Vector3(x, 0, z).applyMatrix4(flat),
      (e, n) => exactly(trench, e, n),
    );
    expect(miss).toBeLessThan(0.15);
  });
});

describe('geoFrameMatrix, on the globe', () => {
  // The demo stage's disc about the scene's origin, 8 km across.
  const g = new Globe();
  g.setDisc([-4000, -4000, 4000, 4000]);

  it('is the flat placement over the disc', () => {
    const placed = { x: 1000, z: -500, rotation: 0.3, scale: 1.0002 };
    const flat = geoFrameMatrix(placed, null, new Matrix4());
    expect(geoFrameMatrix(placed, g, new Matrix4()).equals(flat)).toBe(true);
  });

  it('meets the ground the globe places point by point, 5 km around, out at the trench', () => {
    const m = geoFrameMatrix(placeGeoFrame(trench, scene), g, new Matrix4());
    const ground = (p: Vector3) => g.place(p.x, p.z, 0, new Vector3());
    const up = g.upAt(ground(exactly(trench, 0, 0)), new Vector3());
    // Along the ground, and over it: flat, the field stands off the sphere by d² / 2R
    // toward its edge, as the chosen field's own plane does.
    let along = 0;
    let over = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      const [e, n] = [5000 * Math.cos(a), 5000 * Math.sin(a)];
      const miss = new Vector3(e, 0, -n)
        .applyMatrix4(m)
        .sub(ground(exactly(trench, e, n)));
      const height = miss.dot(up);
      along = Math.max(along, miss.addScaledVector(up, -height).length());
      over = Math.max(over, Math.abs(height - 5000 ** 2 / (2 * g.radius)));
    }
    expect(along).toBeLessThan(0.15);
    expect(over).toBeLessThan(0.05);
    // Upright on the globe there.
    expect(new Vector3(0, 1, 0).transformDirection(m).angleTo(up)).toBeLessThan(
      1e-9,
    );
  });
});
