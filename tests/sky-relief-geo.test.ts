import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { geoAt, geoWarp } from '../src/components/Sky/sky-relief-geo';
import { heightFieldWarp } from '../src/sdk/materials/height-field-clip';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';

// The demo field's frame (UTM 31N, ED50), the stage's disc 8 km across about its origin.
const FRAME: GeoFrame = {
  projection: getProjectionDefFromUtmZone('31N'),
  origin: [434500, 6478000],
};

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
