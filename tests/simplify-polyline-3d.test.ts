import { describe, expect, it } from 'vitest';
import { simplifyPolyline3D } from '../src/sdk/geometries/polygon-outline';
import type { Vec3 } from '../src/sdk/types/common';

function toPolyline(line: Vec3[], p: Vec3): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const u = [0, 1, 2].map(k => line[i][k] - a[k]);
    const w = [0, 1, 2].map(k => p[k] - a[k]);
    const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const t =
      uu > 0
        ? Math.max(
            0,
            Math.min(1, (w[0] * u[0] + w[1] * u[1] + w[2] * u[2]) / uu),
          )
        : 0;
    best = Math.min(
      best,
      Math.hypot(w[0] - t * u[0], w[1] - t * u[1], w[2] - t * u[2]),
    );
  }
  return best;
}

describe('simplifyPolyline3D', () => {
  it('reduces a straight line to its ends', () => {
    const line: Vec3[] = [];
    for (let i = 0; i <= 100; i++) line.push([i * 3, -i * 2, i]);
    expect(simplifyPolyline3D(line, 0.01)).toEqual([line[0], line[100]]);
  });

  it('keeps every point within the tolerance, and a corner beyond it', () => {
    const helix: Vec3[] = [];
    for (let i = 0; i <= 400; i++) {
      const a = i * 0.02;
      helix.push([100 * Math.cos(a), -i * 2, 100 * Math.sin(a)]);
    }
    for (const tolerance of [0.5, 5, 20]) {
      const out = simplifyPolyline3D(helix, tolerance);
      expect(out.length).toBeLessThan(helix.length);
      for (const p of helix) {
        expect(toPolyline(out, p)).toBeLessThanOrEqual(tolerance + 1e-9);
      }
    }

    const corner: Vec3[] = [
      [0, 0, 0],
      [50, 0, 0],
      [100, 0, 0],
      [100, 0, 30],
    ];
    expect(simplifyPolyline3D(corner, 10)).toEqual([
      corner[0],
      corner[2],
      corner[3],
    ]);
  });

  it('copies a line too short to simplify', () => {
    const line: Vec3[] = [
      [0, 0, 0],
      [1, 1, 1],
    ];
    const out = simplifyPolyline3D(line, 10);
    expect(out).toEqual(line);
    expect(out).not.toBe(line);
  });
});
