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
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';

const DEG = Math.PI / 180;

describe('conformalSphere', () => {
  it('is the sphere an oblique stereographic projection stands on (proj sterea)', () => {
    const [lat0, lon0] = [58.44, 1.88];
    const sphere = conformalSphere(lat0 * DEG);
    expect(Math.sin(sphere.chi0)).toBeCloseTo(
      Math.sin(lat0 * DEG) / sphere.n,
      14,
    );
    const sterea = `+proj=sterea +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`;
    const R = sphere.radius;
    let worst = 0;
    for (const [lat, lon] of [
      [58.44, 1.88],
      [58.5, 4.0],
      [59.0, 6.2],
      [62.0, -3.0],
      [70.5, 25.0],
      [54.0, 10.0],
    ]) {
      const chi = conformalLatitude(sphere, lat * DEG);
      const L = sphere.n * (lon - lon0) * DEG;
      const B =
        1 +
        Math.sin(chi) * Math.sin(sphere.chi0) +
        Math.cos(chi) * Math.cos(sphere.chi0) * Math.cos(L);
      const x = (2 * R * Math.cos(chi) * Math.sin(L)) / B;
      const y =
        (2 *
          R *
          (Math.sin(chi) * Math.cos(sphere.chi0) -
            Math.cos(chi) * Math.sin(sphere.chi0) * Math.cos(L))) /
        B;
      const [px, py] = proj4(wgs84Def, sterea, [lon, lat]);
      worst = Math.max(worst, Math.hypot(x - px, y - py));
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('gives back the latitude it was given', () => {
    const sphere = conformalSphere(60 * DEG);
    for (const lat of [-89, -45, 0, 30, 58.44, 71, 89.9]) {
      const back = geodeticLatitude(
        sphere,
        conformalLatitude(sphere, lat * DEG),
      );
      expect(back / DEG).toBeCloseTo(lat, 11);
    }
  });
});

// The demo field's frame (UTM 31N, ED50), the stage's disc 8 km across about its origin.
const UTM31 = getProjectionDefFromUtmZone('31N');
const FRAME: GeoFrame = { projection: UTM31, origin: [434500, 6478000] };
const BOUNDS: [number, number, number, number] = [-4000, -4000, 4000, 4000];

const earth = () => {
  const g = new Globe();
  g.setDisc(BOUNDS);
  g.setFrame(FRAME);
  return g;
};

// Latitude and longitude of world X/Z, through the frame's map.
const latLonAt = (x: number, z: number) => {
  const [lon, lat] = proj4(UTM31, wgs84Def, [
    FRAME.origin[0] + x,
    FRAME.origin[1] - z,
  ]);
  return { lat, lon };
};

describe('Globe, on the Earth (setFrame)', () => {
  it('is the Earth there: its radius, place and true north', () => {
    const g = earth();
    const where = g.location!;
    expect(where.latitude).toBeCloseTo(58.4359, 3);
    expect(where.longitude).toBeCloseTo(1.8766, 3);
    // The ellipsoid's mean radius of curvature at 58.4° (6 387.8 km), times UTM's 0.9996…
    expect(g.radius).toBeGreaterThan(6.384e6);
    expect(g.radius).toBeLessThan(6.388e6);
    // …and true north turned from grid north by the convergence: west of the zone's
    // central meridian (3°E), about 0.96° clockwise seen from above.
    const turn = Math.atan2(-g.north.x, -g.north.z) / DEG;
    expect(turn).toBeGreaterThan(-1.1);
    expect(turn).toBeLessThan(-0.8);
    // Without a frame, as before.
    g.setFrame(null);
    expect(g.radius).toBe(6371000);
    expect(g.location).toBeNull();
  });

  it('places a latitude and longitude, and gives it back, anywhere on the Earth', () => {
    const g = earth();
    const p = new Vector3();
    for (const [lat, lon, h] of [
      [58.4359, 1.8766, 0],
      [58.5, 4.0, 120],
      [60.0, 10.0, -300],
      [71.0, 25.0, 0],
      [0, 0, 0],
      [-33.9, 18.4, 1000],
      [-58.4, -178.1, 0],
    ]) {
      g.geodetic(lat, lon, h, p);
      expect(g.altitude(p)).toBeCloseTo(h, 3);
      const back = g.geographic(p);
      expect(back.latitude).toBeCloseTo(lat, 9);
      expect(back.longitude).toBeCloseTo(lon, 9);
    }
    // No seam on the far side: 0.02° of longitude across the meridian opposite the field,
    // at 30°S, is 1.9 km there.
    const across = 1.8766 + 180;
    const west = g.geodetic(-30, across - 0.01, 0, new Vector3());
    const east = g.geodetic(-30, across + 0.01 - 360, 0, new Vector3());
    expect(west.distanceTo(east)).toBeGreaterThan(1800);
    expect(west.distanceTo(east)).toBeLessThan(2000);
  });

  it('meets the map over the field: to a few centimetres 4 km out', () => {
    const g = earth();
    const p = new Vector3();
    let worst = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      const [x, z] = [3900 * Math.cos(a), 3900 * Math.sin(a)];
      const { lat, lon } = latLonAt(x, z);
      g.geodetic(lat, lon, 0, p);
      worst = Math.max(worst, Math.hypot(p.x - x, p.y, p.z - z));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('places map X/Z by its latitude and longitude beyond the disc, and back', () => {
    const g = earth();
    const p = new Vector3();
    const q = new Vector3();
    for (const [x, z] of [
      [123000, -7000],
      [256000, -62000],
      [-500000, 300000],
    ]) {
      const { lat, lon } = latLonAt(x, z);
      g.place(x, z, 50, p);
      g.geodetic(lat, lon, 50, q);
      expect(p.distanceTo(q)).toBeLessThan(1e-6);
      // To proj4's round trip through the datum shift (ED50's).
      const foot = g.foot(p, new Vector3());
      expect(foot.x).toBeCloseTo(x, 2);
      expect(foot.z).toBeCloseTo(z, 2);
    }
    // Over the disc, the map itself.
    expect(g.place(1000, -2000, 7, p).toArray()).toEqual([1000, 7, -2000]);
  });

  it('keeps distances along the ground: 1 000 km of a meridian', () => {
    const g = earth();
    const a = g.geodetic(50, 3, 0, new Vector3());
    const b = g.geodetic(59, 3, 0, new Vector3());
    // The arc on the scene's sphere against the ellipsoid's meridian (about 1 002.5 km),
    // in the map's units (UTM's 0.9996): the sphere matches the ellipsoid at 58.4°, and
    // strays from it slowly with distance from there.
    const arc = 2 * g.radius * Math.asin(a.distanceTo(b) / (2 * g.radius));
    expect(arc / 1002500).toBeGreaterThan(0.995);
    expect(arc / 1002500).toBeLessThan(1.0);
  });

  it('places what is drawn flat 5 km about the trench as the ground there', () => {
    const g = earth();
    const [x0, z0] = [123000, -7000];
    const m = g.tangent(x0, z0, new Matrix4());
    const up = g.upAt(g.place(x0, z0, 0, new Vector3()), new Vector3());
    let along = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      const [x, z] = [x0 + 5000 * Math.cos(a), z0 + 5000 * Math.sin(a)];
      const miss = new Vector3(x, 0, z)
        .applyMatrix4(m)
        .sub(g.place(x, z, 0, new Vector3()));
      along = Math.max(along, miss.addScaledVector(up, -miss.dot(up)).length());
    }
    expect(along).toBeLessThan(0.2);
  });
});
