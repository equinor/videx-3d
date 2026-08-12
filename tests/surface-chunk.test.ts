import { describe, expect, it } from 'vitest';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { densifyPolygon } from '../src/sdk/geometries/surface-chunk';
import { Vec2 } from '../src/sdk/types/common';

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a) / 2;
}

describe('densifyPolygon', () => {
  it('adds vertices along edges without changing the shape', () => {
    const ring: Vec2[] = [
      [0, 0],
      [700, 0],
      [700, 700],
      [0, 700],
    ];
    const poly = new PlanarPolygonGeometry([[ring]]);
    const dense = densifyPolygon(poly, 200);
    const denseRing = (dense.coordinates as number[][][][])[0][0];
    expect(denseRing.length).toBeGreaterThan(ring.length);
    // Area is preserved (points only added along the existing edges).
    expect(ringArea(denseRing)).toBeCloseTo(ringArea(ring), 6);
  });

  it('is a no-op at spacing <= 0', () => {
    const ring: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const poly = new PlanarPolygonGeometry([[ring]]);
    expect(densifyPolygon(poly, 0)).toBe(poly);
  });
});
