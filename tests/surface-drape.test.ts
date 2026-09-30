import { describe, expect, it } from 'vitest';
import { drapePolyline } from '../src/sdk/geometries/surface-drape';
import { Vec2 } from '../src/sdk/types/common';

const straight: Vec2[] = [
  [0, 0],
  [1000, 0],
];

/** Flat ground at -100 m with a 100 m wide trench 20 m deep, centred at x 500. */
const trench = (x: number) => (Math.abs(x - 500) < 50 ? -120 : -100);

describe('drapePolyline', () => {
  it('samples the route at the requested spacing', () => {
    const draped = drapePolyline(straight, () => -100, { spacing: 25 })!;

    expect(draped.points.length).toBe(41);
    expect(draped.points[0]).toEqual([0, -100, 0]);
    expect(draped.points[40]).toEqual([1000, -100, 0]);
    expect(draped.length).toBeCloseTo(1000, 6);
    expect(draped.gaps).toBe(0);
  });

  it('follows the ground, and measures the extra length that costs', () => {
    const draped = drapePolyline(straight, x => -100 + x / 10, {
      spacing: 25,
    })!;

    expect(draped.points[20][1]).toBeCloseTo(-50, 6);
    // 1000 m across the map, 100 m of climb.
    expect(draped.length).toBeCloseTo(Math.hypot(1000, 100), 4);
    expect(draped.lifted).toBe(0);
  });

  it('rests on the ground at the clearance it was given', () => {
    const draped = drapePolyline(straight, () => -100, {
      spacing: 25,
      clearance: 0.3,
    })!;

    expect(draped.points.every(p => p[1] === -99.7)).toBe(true);
  });

  it('spans a hollow narrower than `span` instead of diving into it', () => {
    const exact = drapePolyline(straight, trench, { spacing: 10 })!;
    const spanned = drapePolyline(straight, trench, {
      spacing: 10,
      span: 200,
    })!;

    expect(Math.min(...exact.points.map(p => p[1]))).toBe(-120);
    expect(Math.min(...spanned.points.map(p => p[1]))).toBe(-100);
    expect(spanned.lifted).toBeCloseTo(20, 6);
  });

  it('never lowers the line, whatever the span or smoothing', () => {
    const bumpy = (x: number) => -100 + 8 * Math.sin(x / 40);
    const exact = drapePolyline(straight, bumpy, { spacing: 10 })!;
    const shaped = drapePolyline(straight, bumpy, {
      spacing: 10,
      span: 150,
      smoothing: 150,
    })!;

    const below = shaped.points.filter(
      (p, i) => p[1] < exact.points[i][1] - 1e-9,
    );
    expect(below).toHaveLength(0);
  });

  it('carries the line across a stretch with no surface, and says how far', () => {
    const draped = drapePolyline(
      straight,
      (x: number) => (x > 400 && x < 600 ? null : -100 + x / 10),
      { spacing: 25 },
    )!;

    expect(draped.gaps).toBe(7);
    // Interpolated between the last and first known heights, not dropped.
    expect(draped.points[20][1]).toBeCloseTo(-50, 6);
    expect(draped.points.every(p => Number.isFinite(p[1]))).toBe(true);
  });

  it('builds nothing where the route finds no surface at all', () => {
    expect(drapePolyline(straight, () => null)).toBeNull();
    expect(drapePolyline([[0, 0]], () => -100)).toBeNull();
  });
});
