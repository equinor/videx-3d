import { describe, expect, it } from 'vitest';
import {
  SEA_BREAK_DEPTH,
  seaDeepDepth,
  seaShallowFactors,
  seaShoaling,
} from '../src/sdk/weather/sea-shallow';

describe('seaShoaling', () => {
  // A deep-water wavelength L0 at depth h, by h / L0: linear theory's tabulated coefficient.
  const at = (hOverL0: number) => seaShoaling(2 * Math.PI, hOverL0);

  it('leaves deep water alone and follows linear theory toward the shore', () => {
    expect(at(1)).toBe(1);
    expect(at(0.1)).toBeCloseTo(0.933, 2);
    expect(at(0.01)).toBeCloseTo(1.42, 1);
    // the dip at middling depths
    expect(at(0.15)).toBeLessThan(0.93);
  });
});

describe('seaShallowFactors', () => {
  // Hs = 4·√0.25 = 2 m on the long layer, a shorter one under it.
  const layers = [
    { variance: 0.2, slopeVariance: 0.2 * 0.01 ** 2 * 4 },
    { variance: 0.05, slopeVariance: 0.05 * 0.2 ** 2 },
  ];

  it('is 1 in deep water and 0 at the shore or on land', () => {
    for (const f of seaShallowFactors(5000, layers))
      expect(f).toBeCloseTo(1, 3);
    expect(seaShallowFactors(0, layers)).toEqual([0, 0]);
    expect(seaShallowFactors(-3, layers)).toEqual([0, 0]);
  });

  it('keeps the waves under the breaking height, and fades them out smoothly', () => {
    let previous = Infinity;
    let worst = 0;
    let at = 0;
    let rising = 0;
    for (let depth = 30; depth > 0.01; depth *= 0.97) {
      const f = seaShallowFactors(depth, layers);
      const variance = layers.reduce(
        (s, l, i) => s + f[i] ** 2 * l.variance,
        0,
      );
      const hs = 4 * Math.sqrt(variance);
      // At most the breaking height, depth over the break depth.
      const over = hs - depth / SEA_BREAK_DEPTH;
      if (over > worst) {
        worst = over;
        at = depth;
      }
      if (depth < 2 && hs >= previous) rising = depth;
      previous = hs;
    }
    expect(worst, `at ${at} m`).toBeLessThanOrEqual(1e-9);
    expect(rising, 'the height grows again toward the shore').toBe(0);
  });

  it('skips only where the bottom changes the waves by under 0.1 %', () => {
    const deep = seaDeepDepth(layers);
    // Just short of it, the full rule: every factor already within 0.1 % of 1.
    for (const f of seaShallowFactors(deep * 0.999, layers))
      expect(Math.abs(f - 1)).toBeLessThan(1e-3);
    expect(seaShallowFactors(deep, layers)).toEqual([1, 1]);
  });
});
