import { describe, expect, it } from 'vitest';
import { sampleFenceSeismicPath, Vec2 } from '../src/sdk';

const square = (h: number): Vec2[] => [
  [-h, -h],
  [h, -h],
  [h, h],
  [-h, h],
  [-h, -h],
];

// A straight cut along X from -5000 to 5000, every 25 m.
const curve: Vec2[] = Array.from({ length: 401 }, (_, i) => [
  -5000 + i * 25,
  0,
]);

describe('sampleFenceSeismicPath', () => {
  it('samples only the span inside the outline, one vertex either side', () => {
    const path = sampleFenceSeismicPath(curve, [square(990)], 10, 4096)!;
    expect(path.along[0]).toBeCloseTo(4000);
    expect(path.along[1]).toBeCloseTo(6000);
    expect(path.points[0][0]).toBeCloseTo(-1000);
    expect(path.points[path.points.length - 1][0]).toBeCloseTo(1000);
    expect(path.points.length).toBe(201);
  });

  it('spaces the positions evenly, at no more than the step', () => {
    const { points } = sampleFenceSeismicPath(curve, [square(1000)], 10, 4096)!;
    const gaps = points.slice(1).map((p, i) => p[0] - points[i][0]);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0]);
      expect(gap).toBeLessThanOrEqual(10);
    }
  });

  it('widens the step to stay within the column cap', () => {
    const path = sampleFenceSeismicPath(curve, [], 1, 100)!;
    expect(path.points.length).toBe(100);
    expect(path.along).toEqual([0, 10000]);
  });

  it('returns null for a curve that never enters the outline', () => {
    const away = curve.map(([x, z]) => [x, z + 5000] as Vec2);
    expect(sampleFenceSeismicPath(away, [square(1000)], 10, 4096)).toBeNull();
  });
});
