import { describe, expect, it } from 'vitest';
import { Sphere, Vector3 } from 'three';
import { wellboreBoundsDistance } from '../src/components/Wellbores/WellboreBounds/wellbore-bounds-distance';

// The rule `WellboreBounds` applied before, with three's spheres.
function previous(spheres: Float32Array, point: Vector3, zoom: number) {
  const sphere = new Sphere(
    new Vector3(spheres[0], spheres[1], spheres[2]),
    spheres[3],
  );
  const sampled: Sphere[] = [];
  for (let i = 4; i < spheres.length; i += 4) {
    sampled.push(
      new Sphere(
        new Vector3(spheres[i], spheres[i + 1], spheres[i + 2]),
        spheres[i + 3],
      ),
    );
  }
  const mainDist = sphere.distanceToPoint(point) / zoom;
  let dist = sampled.length
    ? Math.max(sphere.radius, mainDist)
    : Math.max(0, mainDist);
  if (mainDist <= 0 && sampled.length) {
    dist = sampled.reduce(
      (min, s) => Math.min(min, Math.max(0, s.distanceToPoint(point) / zoom)),
      sphere.radius,
    );
  }
  return dist;
}

describe('wellboreBoundsDistance', () => {
  // A well dropping 2 km and stepping out 1 km, sampled every 500 m.
  const spheres = Float32Array.from([
    500, -1000, 0, 1200,
    0, -250, 0, 260,
    100, -750, 0, 270,
    300, -1250, 0, 280,
    700, -1750, 0, 290,
  ]);

  it('reads as before, inside the main sphere and out, at any zoom', () => {
    let seed = 3;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 500; i++) {
      const point = new Vector3(
        -3000 + 6000 * next(),
        -4000 + 4500 * next(),
        -3000 + 6000 * next(),
      );
      for (const zoom of [1, 2.5]) {
        expect(
          wellboreBoundsDistance(spheres, point.x, point.y, point.z, zoom),
        ).toBeCloseTo(previous(spheres, point, zoom), 3);
      }
    }
  });

  it('reads the main sphere alone when nothing was sampled', () => {
    const main = spheres.slice(0, 4);
    for (const point of [new Vector3(500, -1000, 0), new Vector3(5000, 0, 0)]) {
      expect(
        wellboreBoundsDistance(main, point.x, point.y, point.z, 1),
      ).toBeCloseTo(previous(main, point, 1), 5);
    }
  });
});
