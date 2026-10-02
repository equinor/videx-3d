import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/sdk';
import { convexSignedDistance } from '../src/sdk/utils/margin-zone';
import { coarsenConvexHull, convexHull2D } from '../src/sdk/utils/polyline-2d';

const circle = (r: number, n: number, rx = r): Vec2[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * r] as Vec2;
  });

const isConvex = (h: Vec2[]) => {
  let sign = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const c = h[(i + 2) % h.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
};

describe('coarsenConvexHull', () => {
  const cases: [string, Vec2[]][] = [
    ['dense circle', convexHull2D(circle(500, 2000))],
    ['dense ellipse', convexHull2D(circle(200, 1500, 900))],
    ['clockwise ellipse', convexHull2D(circle(200, 1500, 900)).reverse()],
    ['random cloud', convexHull2D(Array.from({ length: 3000 }, (_, k) => [Math.sin(k * 12.9898) * 400, Math.cos(k * 78.233) * 300] as Vec2))],
  ];
  for (const tolerance of [0.01, 0.1, 1]) {
    for (const [name, hull] of cases) {
      it(`${name} at ${tolerance} m: contains the hull, at most the tolerance larger, convex`, () => {
        const out = coarsenConvexHull(hull, tolerance);
        expect(out.length).toBeLessThanOrEqual(hull.length);
        expect(isConvex(out)).toBe(true);
        for (const p of hull) expect(convexSignedDistance(p, out).distance).toBeLessThanOrEqual(1e-9);
        for (const p of out) expect(convexSignedDistance(p, hull).distance).toBeLessThanOrEqual(tolerance + 1e-9);
      });
    }
  }

  it('drops most of a dense circle', () => {
    const hull = convexHull2D(circle(500, 2000));
    // a 3° step on a 500 m circle stands 0.17 m off it, so 0.2 m needs no more than 120 corners
    expect(coarsenConvexHull(hull, 0.2).length).toBeLessThanOrEqual(120);
  });

  it('returns a square unchanged', () => {
    const square: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(coarsenConvexHull(square, 0.5)).toBe(square);
  });
});
