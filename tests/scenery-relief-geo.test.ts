import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { geoWarp } from '../src/components/Scenery/scenery-relief-geo';
import {
  geoAt,
  geoTileDistance,
  geoTileInView,
} from '../src/sdk/tiles/geo-tile-globe';
import { heightFieldWarp } from '../src/sdk/materials/height-field-clip';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';
import { geoTileKeyAt, geoTileRegion } from '../src/sdk/tiles/geo-tile-keys';

// The demo field's frame (UTM 31N, ED50), the stage's disc 8 km across about its origin.
const FRAME: GeoFrame = {
  projection: getProjectionDefFromUtmZone('31N'),
  origin: [434500, 6478000],
};

describe('geographic tiles seen', () => {
  it('keeps every tile any of whose ground can be seen, and is never farther than it', () => {
    const globe = new Globe();
    globe.setDisc([-4000, -4000, 4000, 4000]);
    globe.setFrame(FRAME);
    const R = globe.radius;
    const centre = globe.centre;
    const DEG = Math.PI / 180;
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
    const camera = new PerspectiveCamera(60, 1.5, 1, 1e9);
    const frustum = new Frustum();
    const point = new Vector3();
    const toCentre = new Vector3();
    const low = -2000;
    const high = 3000;
    let seen = 0;
    const missed: string[] = [];
    const farther: string[] = [];
    for (const altitude of [100, 10e3, 300e3, 2000e3, 20000e3]) {
      // The angle from the eye's foot to its horizon, and a little past for high ground.
      const cap = Math.acos(R / (R + altitude)) / DEG + 2;
      for (let view = 0; view < 16; view++) {
        const lat = -70 + 150 * random();
        const lon = wrap(360 * random());
        const eye = globe.geodetic(lat, lon, altitude, new Vector3());
        const eyeAt = globe.geographic(eye);
        const lookLat = Math.max(
          -89,
          Math.min(89, lat + (random() - 0.5) * 2 * cap),
        );
        const lookLon = wrap(
          lon + ((random() - 0.5) * 2 * cap) / Math.cos(lat * DEG),
        );
        camera.position.copy(eye);
        globe.upAt(eye, camera.up);
        camera.lookAt(globe.geodetic(lookLat, lookLon, 0, point));
        camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(
          new Matrix4().multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse,
          ),
        );
        for (let n = 0; n < 16; n++) {
          const depth = Math.floor(random() * 9);
          const near = random() < 0.7;
          const tileLat = near
            ? lookLat + (random() - 0.5) * 2 * Math.min(cap, 60)
            : -90 + 180 * random();
          const tileLon = near
            ? lookLon + (random() - 0.5) * 4 * Math.min(cap, 60)
            : 360 * random();
          const key = geoTileKeyAt(
            depth,
            wrap(tileLon),
            Math.max(-89.9, Math.min(89.9, tileLat)),
          );
          const [west, north, span] = geoTileRegion(key);
          // The tile's ground at sea level and its top, and whether any of it shows: in
          // the frustum, and not behind the sea's sphere.
          let visible = false;
          let closest = Infinity;
          for (let j = 0; j <= 16; j++) {
            for (let i = 0; i <= 16; i++) {
              for (const height of [low, 0, high]) {
                globe.geodetic(
                  north - (span * j) / 16,
                  west + (span * i) / 16,
                  height,
                  point,
                );
                closest = Math.min(closest, point.distanceTo(eye));
                if (height < 0 || visible) continue;
                if (!frustum.containsPoint(point)) continue;
                // The segment's closest approach to the sphere's centre, short of the point.
                const way = point.clone().sub(eye);
                const t = Math.min(
                  Math.max(toCentre.subVectors(centre, eye).dot(way), 0) /
                    way.lengthSq(),
                  0.999,
                );
                const pass = eye.clone().addScaledVector(way, t);
                if (pass.distanceTo(centre) >= R - 1) visible = true;
              }
            }
          }
          const kept = geoTileInView(
            globe,
            key,
            frustum,
            eye,
            eyeAt,
            low,
            high,
          );
          const label = `alt ${altitude / 1000} km at ${lat.toFixed(1)},${lon.toFixed(1)}: depth ${depth} tile ${west},${north}`;
          if (visible) seen++;
          if (visible && !kept) missed.push(label);
          const distance = geoTileDistance(
            globe,
            key,
            eye,
            eyeAt,
            globe.altitude(eye),
            low,
            high,
          );
          if (distance > closest * 1.001 + 1)
            farther.push(`${label}: ${distance} > ${closest}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(200);
    expect(missed).toEqual([]);
    expect(farther).toEqual([]);
  });
});

describe('geoWarp', () => {
  it("takes world X/Z to the tiles' longitudes and latitudes, to millimetres", () => {
    const globe = new Globe();
    globe.setDisc([-4000, -4000, 4000, 4000]);
    globe.setFrame(FRAME);
    const scale = (Math.PI / 180) * globe.radius;
    // The stage's disc, and a field 30 km off it, past where the disc is the map. What a
    // quadratic leaves is cubic: millimetres on the ground at a field's edge.
    for (const [bounds, most] of [
      [[-4000, -4000, 4000, 4000], 0.003],
      [[25000, -3000, 35000, 7000], 0.006],
    ] as [[number, number, number, number], number][]) {
      const [x0, z0, x1, z1] = bounds;
      const mid = geoAt(globe, (x0 + x1) / 2, (z0 + z1) / 2);
      // A degree of longitude is this much shorter on the ground than one of latitude.
      const east = Math.cos((mid.latitude * Math.PI) / 180);
      const warp = geoWarp(
        globe,
        bounds,
        mid.longitude,
        mid.latitude,
        scale,
        new Matrix4(),
      );
      let worst = 0;
      const q: [number, number] = [0, 0];
      for (let j = 0; j <= 20; j++) {
        for (let i = 0; i <= 20; i++) {
          const x = x0 + ((x1 - x0) * i) / 20;
          const z = z0 + ((z1 - z0) * j) / 20;
          const { latitude, longitude } = geoAt(globe, x, z);
          heightFieldWarp(warp, x, z, q);
          worst = Math.max(
            worst,
            Math.hypot(
              (q[0] - (longitude - mid.longitude) * scale) * east,
              q[1] - (mid.latitude - latitude) * scale,
            ),
          );
        }
      }
      expect(worst).toBeLessThan(most);
    }
  });
});
