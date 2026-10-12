import { describe, expect, it } from 'vitest';
import { polylineTangents2D } from '../src/sdk/utils/polyline-2d';

type P = [number, number];

const angle = (t: Float64Array, i: number, u: Float64Array, j: number) =>
  Math.acos(Math.min(1, t[2 * i] * u[2 * j] + t[2 * i + 1] * u[2 * j + 1]));

describe('polylineTangents2D', () => {
  it('ignores points added on a straight run, noise and all', () => {
    // A 1 km circle at ~131 m spacing; each side gets points 1 cm in, a third of
    // the way along and 1 cm short of its end, each up to 2 mm off the side.
    const n = 48;
    const ring: P[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      ring.push([1000 * Math.cos(a), 1000 * Math.sin(a)]);
    }
    const dense: P[] = [];
    const original: number[] = [];
    ring.forEach((p, k) => {
      original.push(dense.length);
      dense.push(p);
      const q = ring[(k + 1) % n];
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const side = Math.hypot(dx, dz);
      [0.01 / side, 1 / 3, 1 - 0.01 / side].forEach((f, i) => {
        const e = 0.002 * Math.sin(7 * k + 3 * i);
        dense.push([
          p[0] + f * dx - (e * dz) / side,
          p[1] + f * dz + (e * dx) / side,
        ]);
      });
    });

    const plain = polylineTangents2D(ring, { closed: true });
    const result = polylineTangents2D(dense, { closed: true });
    let worst = 0;
    original.forEach((d, k) => {
      worst = Math.max(worst, angle(result.before, d, plain.before, k));
    });
    // A band needs degrees, which is what the old vertex average moved these by.
    expect(worst).toBeLessThan(1e-3);
  });

  it('gives an added point the tangent interpolated between its neighbours', () => {
    const path: P[] = [
      [0, 0],
      [100, 0],
      [100.5, 0.5],
      [200, 100],
    ];
    const t = polylineTangents2D(path);
    // (100, 0) is the bend; (100.5, 0.5) lies on the chord after it.
    const bend = Math.atan2(t.before[3], t.before[2]);
    const added = Math.atan2(t.before[5], t.before[4]);
    const end = Math.atan2(t.before[7], t.before[6]);
    expect(bend).toBeGreaterThan(0);
    expect(added).toBeGreaterThan(bend);
    expect(added).toBeLessThan(end);
  });

  it('keeps corners sharp past the smoothing angle', () => {
    const square: P[] = [
      [0, 0],
      [50, 0],
      [100, 0],
      [100, 50],
      [100, 100],
      [50, 100],
      [0, 100],
      [0, 50],
    ];
    const t = polylineTangents2D(square, { closed: true, smoothAngle: 40 });
    expect(Array.from(t.corner)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect([t.before[0], t.before[1]]).toEqual([0, -1]);
    expect([t.after[0], t.after[1]]).toEqual([1, 0]);
    // A midpoint follows its edge exactly.
    expect([t.before[2], t.before[3]]).toEqual([1, 0]);
    expect([t.before[6], t.before[7]]).toEqual([0, 1]);
  });

  it('keeps a hairpin tip, which is collinear with its neighbours but not between them', () => {
    const t = polylineTangents2D([
      [0, 0],
      [10, 0],
      [0, 1],
    ]);
    const back = Math.hypot(10, 1);
    const x = 1 - 10 / back;
    const z = 1 / back;
    const len = Math.hypot(x, z);
    expect(t.before[2]).toBeCloseTo(x / len, 12);
    expect(t.before[3]).toBeCloseTo(z / len, 12);
  });
});
