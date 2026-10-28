import { Frustum, Matrix4, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import { Globe } from '../src/sdk/projection/globe';
import {
  geoTileDistance,
  geoTileInView,
  geoTileLayout,
  geoTileNearest,
} from '../src/sdk/tiles/geo-tile-globe';
import { geoTileKeyAt } from '../src/sdk/tiles/geo-tile-keys';

const earth = () => {
  const globe = new Globe();
  globe.setDisc([-8000, -8000, 8000, 8000]);
  globe.setFrame({
    projection: getProjectionDefFromUtmZone('31N'),
    origin: [434500, 6478000],
  });
  return globe;
};

const view = (globe: Globe, lat: number, lon: number, altitude: number) => {
  const eye = globe.geodetic(lat, lon, altitude, new Vector3());
  const camera = new PerspectiveCamera(60, 1.5, 1, 1e9);
  camera.position.copy(eye);
  globe.upAt(eye, camera.up);
  camera.lookAt(globe.geodetic(lat + 0.5, lon + 1, 0, new Vector3()));
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  );
  return { eye, eyeAt: { latitude: lat, longitude: lon }, frustum };
};

const keys = (lat: number, lon: number) => {
  const out: number[] = [];
  for (let depth = 4; depth <= 12; depth += 2)
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++)
        out.push(
          geoTileKeyAt(
            depth,
            lon + i * 2 ** (6 - depth),
            lat + j * 2 ** (5 - depth),
          ),
        );
  return out;
};

// What the cached answers must agree with: a globe of their own, asked once.
const fresh = <T>(make: (globe: Globe) => T) => make(earth());

describe('geographic tiles on a globe, kept between calls', () => {
  it('answers as a fresh globe does, asked again and from other eyes', () => {
    const globe = earth();
    for (const [lat, lon, altitude] of [
      [58.4, 1.9, 2000],
      [58.4, 1.9, 2000],
      [59.0, 4.0, 40000],
      [57.5, 0.5, 300],
    ]) {
      const v = view(globe, lat, lon, altitude);
      for (const key of keys(lat, lon)) {
        const cached = {
          inView: geoTileInView(
            globe,
            key,
            v.frustum,
            v.eye,
            v.eyeAt,
            -300,
            900,
          ),
          nearest: geoTileNearest(globe, key, v.eyeAt, new Vector2()).toArray(),
          distance: geoTileDistance(
            globe,
            key,
            v.eye,
            v.eyeAt,
            altitude,
            -300,
            900,
          ),
        };
        const once = fresh(g => {
          const w = view(g, lat, lon, altitude);
          return {
            inView: geoTileInView(g, key, w.frustum, w.eye, w.eyeAt, -300, 900),
            nearest: geoTileNearest(g, key, w.eyeAt, new Vector2()).toArray(),
            distance: geoTileDistance(
              g,
              key,
              w.eye,
              w.eyeAt,
              altitude,
              -300,
              900,
            ),
          };
        });
        expect(cached).toEqual(once);
      }
    }
  });

  it('forgets what it kept when the globe changes', () => {
    const globe = earth();
    const v = view(globe, 58.4, 1.9, 2000);
    const key = geoTileKeyAt(8, 2.5, 58.8);
    const before = geoTileNearest(globe, key, v.eyeAt, new Vector2()).toArray();
    globe.setFrame({
      projection: getProjectionDefFromUtmZone('31N'),
      origin: [534500, 6578000],
    });
    const after = geoTileNearest(globe, key, v.eyeAt, new Vector2()).toArray();
    const changed = earth();
    changed.setFrame({
      projection: getProjectionDefFromUtmZone('31N'),
      origin: [534500, 6578000],
    });
    expect(after).toEqual(
      geoTileNearest(changed, key, v.eyeAt, new Vector2()).toArray(),
    );
    expect(after).not.toEqual(before);
  });

  it('a layout gives each tile’s distance once per eye, and again once it moves', () => {
    const globe = earth();
    const v = view(globe, 58.4, 1.9, 2000);
    const layoutView = {
      globe,
      eye: v.eye.clone(),
      eyeAt: { ...v.eyeAt },
      altitude: 2000,
      frustum: v.frustum,
      seen: 1e7,
      level: 0,
    };
    const layout = geoTileLayout(layoutView);
    const key = geoTileKeyAt(8, 2.5, 58.8);
    const first = layout.distance(key, -300, 900);
    expect(layout.distance(key, -300, 900)).toBe(first);
    const moved = globe.geodetic(58.9, 2.6, 2000, new Vector3());
    layoutView.eye.copy(moved);
    layoutView.eyeAt = { latitude: 58.9, longitude: 2.6 };
    expect(layout.distance(key, -300, 900)).toBeLessThan(first);
  });
});
