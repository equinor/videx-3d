import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/sdk/types/common';
import {
  filletCorner2D,
  filletPolyline2D,
  joinByTangents2D,
  polylineHeadings2D,
} from '../src/sdk/utils/polyline-2d';

const DEG = Math.PI / 180;

/** The largest turn at any interior vertex, in radians. */
function maxTurn(points: Vec2[]): number {
  const heading = polylineHeadings2D(points);
  let worst = 0;
  for (let i = 1; i < heading.length; i++) {
    let d = heading[i] - heading[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    worst = Math.max(worst, Math.abs(d));
  }
  return worst;
}

describe('filletCorner2D', () => {
  it('leaves a corner already inside the budget alone', () => {
    const out = filletCorner2D([0, 0], [100, 0], [200, 10], 20, 30 * DEG);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([100, 0]);
  });

  it('holds the turn budget on a right-angle corner', () => {
    const a: Vec2 = [0, 0];
    const v: Vec2 = [100, 0];
    const b: Vec2 = [100, 100];
    for (const budget of [45, 20, 10, 5]) {
      const chain = filletCorner2D(a, v, b, 20, budget * DEG);
      const full = [a, ...chain, b];
      expect(maxTurn(full)).toBeLessThanOrEqual(budget * DEG + 1e-9);
      expect(chain.length).toBe(Math.ceil(90 / budget));
    }
  });

  it('is scale-stable: the shape depends on the radius, not on the leg lengths', () => {
    const near = filletCorner2D([90, 0], [100, 0], [100, 10], 4, 15 * DEG);
    const far = filletCorner2D([-900, 0], [100, 0], [100, 1000], 4, 15 * DEG);
    expect(near).toHaveLength(far.length);
    for (let i = 0; i < near.length; i++) {
      expect(near[i][0]).toBeCloseTo(far[i][0], 6);
      expect(near[i][1]).toBeCloseTo(far[i][1], 6);
    }
  });

  it('never eats more than half of the shorter leg', () => {
    // Legs of 10 m with a radius that would otherwise set back 100 m.
    const chain = filletCorner2D([-10, 0], [0, 0], [0, 10], 100, 30 * DEG);
    for (const p of chain) {
      expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(5 * Math.SQRT2 + 1e-6);
    }
  });
});

describe('filletPolyline2D', () => {
  it('pins the endpoints and brings every turn inside the budget', () => {
    const zigzag: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 100],
      [200, 0],
    ];
    const out = filletPolyline2D(zigzag, 15, 12 * DEG);
    expect(out[0]).toEqual(zigzag[0]);
    expect(out[out.length - 1]).toEqual(zigzag[zigzag.length - 1]);
    expect(maxTurn(out)).toBeLessThanOrEqual(12 * DEG + 1e-9);
  });
});

describe('joinByTangents2D', () => {
  it('leaves and arrives on the required headings, within the budget', () => {
    const from: Vec2 = [0, 0];
    const fromDir: Vec2 = [1, 0];
    const to: Vec2 = [500, 400];
    const toDir: Vec2 = [0, 1];
    const out = joinByTangents2D(from, fromDir, to, toDir, 40, 10 * DEG);
    expect(out[0]).toEqual(from);
    expect(out[out.length - 1]).toEqual(to);
    const lead: Vec2 = [out[1][0] - out[0][0], out[1][1] - out[0][1]];
    const ll = Math.hypot(lead[0], lead[1]);
    expect(lead[0] / ll).toBeCloseTo(fromDir[0], 6);
    const tail: Vec2 = [
      out[out.length - 1][0] - out[out.length - 2][0],
      out[out.length - 1][1] - out[out.length - 2][1],
    ];
    const tl = Math.hypot(tail[0], tail[1]);
    expect(tail[1] / tl).toBeCloseTo(toDir[1], 6);
    expect(maxTurn(out)).toBeLessThanOrEqual(10 * DEG + 1e-9);
  });

  it('still holds the budget when the tangents diverge (the dogleg branch)', () => {
    // Both headings point AWAY from each other — the rays never meet ahead.
    const out = joinByTangents2D(
      [0, 0],
      [-1, 0],
      [500, 0],
      [1, 0],
      40,
      10 * DEG,
    );
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([500, 0]);
    expect(maxTurn(out)).toBeLessThanOrEqual(10 * DEG + 1e-9);
  });
});
