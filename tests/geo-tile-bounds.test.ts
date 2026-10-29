import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GeoTileBounds } from '../src/components/Layers/geo-tile-layer';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import { Globe } from '../src/sdk/projection/globe';
import { geoTileKeyAt, geoTileRegion } from '../src/sdk/tiles/geo-tile-keys';

// A layer's tiles lie between fixed heights (flat at one, or draped on a relief between its
// lowest and highest ground): their bounds are kept between frames (GeoTileBounds) instead
// of found per call (geoTileInView). They must keep every tile any of whose ground can be
// seen, and never be farther than its nearest point.
describe('GeoTileBounds', () => {
  for (const [curved, low, high, perTile] of [
    [true, 0, 0, false],
    [false, 0, 0, false],
    [true, -400, 1500, false],
    // The same range, from the relief's ground tile by tile (draped).
    [true, -400, 1500, true],
  ] as const) {
    it(`keeps every tile any of whose ground can be seen (${curved ? 'curved' : 'flat'}, ${low}…${high} m${perTile ? ', per tile' : ''})`, () => {
      const globe = new Globe();
      globe.setDisc([-8000, -8000, 8000, 8000]);
      globe.setFrame({
        projection: getProjectionDefFromUtmZone('31N'),
        origin: [434500, 6478000],
      });
      globe.enabled = curved;
      const R = globe.radius;
      const centre = globe.centre;
      const bounds = new GeoTileBounds();
      if (perTile)
        bounds.prepare(globe, 0, 0, () => [low, high] as [number, number], 1);
      else bounds.prepare(globe, low, high);
      let seed = 3;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const camera = new PerspectiveCamera(60, 1.5, 1, 1e9);
      const frustum = new Frustum();
      const point = new Vector3();
      const ray = new Vector3();
      const toCentre = new Vector3();
      const missed: string[] = [];
      const farther: string[] = [];
      let seen = 0;
      for (const altitude of [200, 5e3, 50e3, 400e3, 2000e3]) {
        for (let view = 0; view < 12; view++) {
          const lat = 56 + 16 * random();
          const lon = -2 + 14 * random();
          const eye = globe.geodetic(lat, lon, altitude, new Vector3());
          camera.position.copy(eye);
          globe.upAt(eye, camera.up);
          camera.lookAt(
            globe.geodetic(
              lat + (random() - 0.5) * 6,
              lon + (random() - 0.5) * 10,
              0,
              point,
            ),
          );
          camera.updateMatrixWorld();
          frustum.setFromProjectionMatrix(
            new Matrix4().multiplyMatrices(
              camera.projectionMatrix,
              camera.matrixWorldInverse,
            ),
          );
          for (let n = 0; n < 24; n++) {
            const depth = 3 + Math.floor(random() * 10);
            const key = geoTileKeyAt(
              depth,
              lon + (random() - 0.5) * 12,
              lat + (random() - 0.5) * 8,
            );
            const [west, north, span] = geoTileRegion(key);
            let visible = false;
            let closest = Infinity;
            for (let j = 0; j <= 12; j++) {
              for (let i = 0; i <= 12; i++) {
                // Anywhere between the heights the tile's ground may lie at.
                const height =
                  low + ((high - low) * ((i * 7 + j * 5) % 13)) / 12;
                globe.geodetic(
                  north - (span * j) / 12,
                  west + (span * i) / 12,
                  height,
                  point,
                );
                closest = Math.min(closest, point.distanceTo(eye));
                if (!frustum.containsPoint(point)) continue;
                // Behind the sea's sphere: the line of sight dips into it.
                let hidden = false;
                if (curved) {
                  ray.subVectors(point, eye);
                  const length = ray.length();
                  ray.divideScalar(length);
                  toCentre.subVectors(centre, eye);
                  const along = toCentre.dot(ray);
                  const apart2 = toCentre.lengthSq() - along * along;
                  hidden =
                    along > 0 &&
                    along < length - 1 &&
                    apart2 < (R - 1) * (R - 1);
                }
                if (!hidden) visible = true;
              }
            }
            if (visible) {
              seen++;
              if (!bounds.shows(key, eye, frustum))
                missed.push(`${key} from ${altitude}`);
            }
            if (bounds.distance(key, eye) > closest + 1)
              farther.push(`${key}: ${bounds.distance(key, eye)} > ${closest}`);
          }
        }
      }
      expect(seen).toBeGreaterThan(50);
      expect(missed).toEqual([]);
      expect(farther).toEqual([]);
    });
  }
});
