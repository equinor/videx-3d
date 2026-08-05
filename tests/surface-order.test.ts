import { describe, expect, it } from 'vitest';
import {
  clampSurfaceUnder,
  DepthOrderLayer,
} from '../src/sdk/geometries/surface-order';

// Samples are stored as `value = referenceDepth - trueDepth`, so scene
// `y = value - referenceDepth` and a LARGER value means SHALLOWER.
const layer = (
  values: number[],
  nx: number,
  ny: number,
  referenceDepth = 0,
  overrides: Partial<DepthOrderLayer> = {},
): DepthOrderLayer => ({
  values: Float32Array.from(values),
  header: { nx, ny, xinc: 10, yinc: 10, rot: 0 },
  referenceDepth,
  ...overrides,
});

describe('clampSurfaceUnder', () => {
  it('pushes crossing nodes down onto the ceiling (same grid)', () => {
    // ceiling at y = -100 everywhere; the layer pokes above it at index 1
    const ceiling = layer([100, 100, 100, 100], 2, 2, 200); // y = -100
    const below = layer([80, 130, 80, 80], 2, 2, 200); // y = -120 / -70 / ...

    const { clamped, referenceDepth } = clampSurfaceUnder(below, ceiling);

    expect(clamped).toBe(1);
    expect(referenceDepth).toBe(200);
    expect(Array.from(below.values)).toEqual([80, 100, 80, 80]);
  });

  it('keeps a minimum separation when minGap is set', () => {
    const ceiling = layer([100, 100], 2, 1, 200);
    const below = layer([100, 90], 2, 1, 200); // coincident, then 10 below

    const { clamped } = clampSurfaceUnder(below, ceiling, { minGap: 5 });

    // the coincident node is pushed 5 below; the one already 10 below is kept
    expect(clamped).toBe(1);
    expect(Array.from(below.values)).toEqual([95, 90]);
  });

  it('honors differing reference depths', () => {
    // ceiling: value 100, ref 200 -> y = -100
    const ceiling = layer([100, 100], 2, 1, 200);
    // below: ref 500, so y = value - 500; value 450 -> y = -50 (above the ceiling)
    const below = layer([450, 300], 2, 1, 500);

    clampSurfaceUnder(below, ceiling);

    // clamped to y = -100 -> value = 400; the second (y = -200) is untouched
    expect(Array.from(below.values)).toEqual([400, 300]);
  });

  it('leaves no-data nodes alone, on either side', () => {
    const ceiling = layer([100, -1], 2, 1, 200);
    const below = layer([-1, 130], 2, 1, 200);

    const { clamped } = clampSurfaceUnder(below, ceiling);

    // node 0: this layer is no-data; node 1: no ceiling -> both untouched
    expect(clamped).toBe(0);
    expect(Array.from(below.values)).toEqual([-1, 130]);
  });

  it('rebases the layer instead of encoding a negative (no-data) value', () => {
    // The ceiling is deeper than this layer's own reference floor, so the clamp
    // cannot be expressed without shifting the layer's reference.
    const ceiling = layer([0, 0], 2, 1, 5000); // y = -5000
    const below = layer([10, 10], 2, 1, 100); // y = -90, must go to -5000

    const { referenceDepth } = clampSurfaceUnder(below, ceiling);

    // samples stay non-negative...
    expect(Array.from(below.values).every(v => v >= 0)).toBe(true);
    // ...and the scene position (value - referenceDepth) is exactly the ceiling's
    expect(below.values[0] - referenceDepth).toBeCloseTo(-5000, 6);
    expect(below.values[1] - referenceDepth).toBeCloseTo(-5000, 6);
  });

  it('resamples a ceiling with a different grid geometry', () => {
    // Ceiling: 3x3 grid of 10m cells, flat at y = -100.
    const ceiling = layer(
      [100, 100, 100, 100, 100, 100, 100, 100, 100],
      3,
      3,
      200,
    );
    // Layer: finer 5x5 grid of 5m cells covering the same extent, poking above.
    const below: DepthOrderLayer = {
      values: new Float32Array(25).fill(150), // y = -50
      header: { nx: 5, ny: 5, xinc: 5, yinc: 5, rot: 0 },
      referenceDepth: 200,
    };

    const { clamped } = clampSurfaceUnder(below, ceiling);

    expect(clamped).toBe(25);
    expect(Array.from(below.values).every(v => v === 100)).toBe(true);
  });

  it('leaves nodes outside the ceiling extent untouched', () => {
    // Ceiling covers only the left half (2 columns of 10m) of the layer's extent.
    const ceiling = layer([100, 100], 2, 1, 200);
    const below: DepthOrderLayer = {
      values: Float32Array.from([150, 150, 150, 150]),
      header: { nx: 4, ny: 1, xinc: 10, yinc: 10, rot: 0 },
      referenceDepth: 200,
    };

    clampSurfaceUnder(below, ceiling, { feather: 0 });

    // only the two nodes inside the ceiling's extent are clamped
    expect(Array.from(below.values)).toEqual([100, 100, 150, 150]);
  });

  it('tapers the clamp towards the edge of the ceiling coverage', () => {
    // Ceiling covers the left 10 columns of a 20-wide layer, flat at y = -100.
    const ceiling: DepthOrderLayer = {
      values: new Float32Array(10).fill(100),
      header: { nx: 10, ny: 1, xinc: 10, yinc: 10, rot: 0 },
      referenceDepth: 200,
    };
    const below: DepthOrderLayer = {
      values: new Float32Array(20).fill(150), // y = -50, above the ceiling
      header: { nx: 20, ny: 1, xinc: 10, yinc: 10, rot: 0 },
      referenceDepth: 200,
    };

    clampSurfaceUnder(below, ceiling, { feather: 4 });
    const v = Array.from(below.values);

    // Uncovered nodes are untouched...
    expect(v.slice(10)).toEqual(new Array(10).fill(150));
    // ...deep inside the coverage the clamp is full...
    expect(v[0]).toBeCloseTo(100, 5);
    // ...and it ramps monotonically out to the coverage edge instead of stepping.
    for (let i = 1; i < 10; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
    expect(v[9]).toBeGreaterThan(100);
    expect(v[9]).toBeLessThanOrEqual(150);
    // no vertical cliff left at the boundary
    expect(150 - v[9]).toBeLessThan(150 - v[0]);
  });

  it('does not taper where the ceiling covers everything', () => {
    const ceiling = layer([100, 100, 100, 100], 2, 2, 200);
    const below = layer([150, 150, 150, 150], 2, 2, 200);

    clampSurfaceUnder(below, ceiling, { feather: 8 });

    // full coverage => no coverage boundary => full clamp everywhere
    expect(Array.from(below.values)).toEqual([100, 100, 100, 100]);
  });
});
