import proj4 from 'proj4';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  conformalLatitude,
  conformalSphere,
  geodeticLatitude,
} from '../src/sdk/projection/conformal-sphere';
import {
  getProjectionDefFromUtmZone,
  wgs84Def,
} from '../src/sdk/projection/crs';
import {
  GeoFrame,
  geoFrameAt,
  placeGeoFrame,
  placeGeoPoint,
} from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';
import { geoFrameMatrix } from '../src/sdk/projection/place-frame';

// Fields and stages near the poles, and a World anchored at one: Universal Polar
// Stereographic's origin (its false easting and northing) is the pole itself.
const UPS_N =
  '+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +k=0.994 +x_0=2000000 +y_0=2000000 +datum=WGS84 +units=m +no_defs';
const UPS_S =
  '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +k=0.994 +x_0=2000000 +y_0=2000000 +datum=WGS84 +units=m +no_defs';
const DEG = Math.PI / 180;

const frameAt = (projection: string, lon: number, lat: number): GeoFrame => ({
  projection,
  origin: proj4(wgs84Def, projection, [lon, lat]) as [number, number],
});

const FRAMES: [string, GeoFrame][] = [
  [
    'Svalbard, UTM 33N ED50, 78°N',
    frameAt(getProjectionDefFromUtmZone('33N'), 15, 78),
  ],
  [
    'UTM 33N, 89.99°N',
    frameAt('+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs', 15, 89.99),
  ],
  ['UPS North at the pole', frameAt(UPS_N, 0, 90)],
  ['UPS North, 89.9°N', frameAt(UPS_N, 40, 89.9)],
  ['a map about the North Pole', geoFrameAt(0, 90)],
  ['a map about 89.999°N', geoFrameAt(123, 89.999)],
  ['UPS South at the pole', frameAt(UPS_S, 0, -90)],
  ['a map about 89.99°S', geoFrameAt(-60, -89.99)],
];

describe('the globe at the poles', () => {
  it('matches a sphere at a pole as the limit of those beside it', () => {
    for (const sign of [1, -1]) {
      const at = conformalSphere(sign * 90 * DEG);
      expect(at.n).toBe(1);
      expect(Math.abs(at.chi0)).toBeCloseTo(Math.PI / 2, 15);
      expect(Math.sign(at.chi0)).toBe(sign);
      // Its limit, ½ ln c = ±e atanh e; and the same, smoothly, a centimetre to a kilometre off.
      const E = Math.sqrt((2 - 1 / 298.257223563) / 298.257223563);
      expect(at.halfLogC).toBeCloseTo(sign * E * Math.atanh(E), 14);
      for (const off of [1e-7, 1e-5, 1e-3, 1e-2]) {
        const near = conformalSphere(sign * (90 - off) * DEG);
        expect(Math.abs(near.halfLogC - at.halfLogC)).toBeLessThan(off * 1e-4);
        expect(Math.abs(near.chi0) - Math.PI / 2).toBeLessThan(0);
      }
    }
  });

  it('turns a latitude to its conformal one and back, to the last bits, the poles included', () => {
    for (const lat0 of [0, 58.44, 78, 89.99, 90, -90, -71]) {
      const sphere = conformalSphere(lat0 * DEG);
      for (const lat of [-90, -89.9999999, -45, 0, 30, 89.9, 89.9999999, 90]) {
        const back = geodeticLatitude(
          sphere,
          conformalLatitude(sphere, lat * DEG),
        );
        expect(Math.abs(back - lat * DEG)).toBeLessThan(1e-14);
      }
    }
  });

  it.each(FRAMES)(
    'places by latitude and longitude, there and back: %s',
    (_, frame) => {
      const globe = new Globe();
      globe.setFrame(frame);
      globe.setDisc({ centre: [0, 0], radius: 9000 });
      const p = new Vector3();
      const back = new Vector3();
      // On the disc, past it, and across the pole.
      for (const d of [1000, 8000, 20000, 150000, 300000]) {
        for (let a = 0; a < 360; a += 15) {
          globe.place(d * Math.cos(a * DEG), d * Math.sin(a * DEG), 0, p);
          const { latitude, longitude } = globe.geographic(p);
          globe.geodetic(latitude, longitude, 0, back);
          expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
          expect(back.distanceTo(p)).toBeLessThan(1e-3);
        }
      }
    },
  );

  it.each(FRAMES)('places a field and a point on it: %s', (_, frame) => {
    const globe = new Globe();
    globe.setFrame(frame);
    globe.setDisc({ centre: [0, 0], radius: 9000 });
    // A field 25 km off in a map of its own, and a facility by its longitude and latitude.
    const other = geoFrameAt(
      ...(proj4(frame.projection, wgs84Def, [
        frame.origin[0] + 25000,
        frame.origin[1],
      ]) as [number, number]),
    );
    const field = geoFrameMatrix(
      placeGeoFrame(other, frame, [0, 0]),
      globe,
      new Matrix4(),
    );
    expect(field.elements.every(Number.isFinite)).toBe(true);
    const point = placeGeoPoint(
      10,
      Math.sign(frame.origin[1] || 1) * 89.95,
      frame,
    );
    expect(
      [point.x, point.z, point.rotation, point.scale].every(Number.isFinite),
    ).toBe(true);
  });

  it('has the pole where the map has it, anchored there', () => {
    const globe = new Globe();
    globe.setFrame(frameAt(UPS_N, 0, 90));
    globe.setDisc({ centre: [0, 0], radius: 9000 });
    const toMap = proj4(wgs84Def, UPS_N);
    // A kilometre off the pole each way: where the globe has it, and where the map does.
    for (let a = 0; a < 360; a += 45) {
      const x = 1000 * Math.cos(a * DEG);
      const z = 1000 * Math.sin(a * DEG);
      const { latitude, longitude } = globe.geographic(
        globe.place(x, z, 0, new Vector3()),
      );
      const [e, n] = toMap.forward([longitude, latitude]);
      expect(Math.hypot(e - 2000000 - x, 2000000 - n - z)).toBeLessThan(0.05);
    }
  });
});
