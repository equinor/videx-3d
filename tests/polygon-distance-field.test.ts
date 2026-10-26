import { describe, expect, it } from 'vitest';
import {
  polygonDistanceAt,
  polygonDistanceField,
} from '../src/sdk/geometries/polygon-distance-field';
import type { PlanarPolygonCoordinates } from '../src/sdk/geometries/planar-geometry';

const square = (x0: number, z0: number, x1: number, z1: number) => [
  [x0, z0] as [number, number],
  [x1, z0] as [number, number],
  [x1, z1] as [number, number],
  [x0, z1] as [number, number],
];

describe('polygonDistanceField', () => {
  it('is positive inside, and finds a straight edge exactly', () => {
    const field = polygonDistanceField(
      [[square(0, 0, 1000, 600)]],
      [0, 0],
      64,
    )!;
    expect(field.cell).toBeCloseTo(1000 / (64 - 10));
    expect(polygonDistanceAt(field, 500, 300)).toBeGreaterThan(0);
    expect(polygonDistanceAt(field, -30, 300)).toBeLessThan(0);
    expect(polygonDistanceAt(field, 500, 700)).toBeLessThan(0);
    // Near an edge, between texels too: the distance to it, signed.
    for (const z of [100, 233.3, 451]) {
      expect(polygonDistanceAt(field, 7, z)).toBeCloseTo(7, 1);
      expect(polygonDistanceAt(field, -7, z)).toBeCloseTo(-7, 1);
      expect(polygonDistanceAt(field, 1000 - 5, z)).toBeCloseTo(5, 1);
    }
    // Far off, clamped to the band, and outside past the grid.
    expect(polygonDistanceAt(field, 500, 300)).toBeCloseTo(
      field.band * field.cell,
    );
    expect(polygonDistanceAt(field, 5000, 300)).toBeLessThan(0);
  });

  it('keeps holes out, and takes the offset', () => {
    const polygon: PlanarPolygonCoordinates = [
      [square(0, 0, 1000, 1000), square(400, 400, 600, 600)],
    ];
    const field = polygonDistanceField(polygon, [2000, -500], 128)!;
    expect(polygonDistanceAt(field, 2100, -400)).toBeGreaterThan(0);
    expect(polygonDistanceAt(field, 2500, 0)).toBeLessThan(0);
    expect(polygonDistanceAt(field, 2403, 0)).toBeCloseTo(-3, 0);
    expect(polygonDistanceAt(field, 100, 100)).toBeLessThan(0);
  });

  it('is null without area', () => {
    expect(polygonDistanceField([])).toBeNull();
    expect(
      polygonDistanceField([
        [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      ]),
    ).toBeNull();
  });
});
