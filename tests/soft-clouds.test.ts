import { describe, expect, it } from 'vitest';
import {
  SOFT_COVER_QUANTILES,
  softCoverLevel,
  softCoverShare,
  softCoverStatistics,
  softCoverTexel,
} from '../src/sdk/weather/soft-clouds';

// Evenly spread values over [0, 1), shuffled, every fourth one of an RGBA buffer.
const even = (count: number) => {
  const values = Array.from({ length: count }, (_, i) => (i + 0.5) / count);
  for (let i = count - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  const rgba = new Float32Array(count * 4);
  values.forEach((v, i) => (rgba[i * 4] = v));
  return rgba;
};

describe('softCoverStatistics', () => {
  const stats = softCoverStatistics(even(4096), 4);

  it('reads one channel of a pixel buffer, sorted into quantiles', () => {
    expect(stats.quantiles.length).toBe(SOFT_COVER_QUANTILES + 1);
    expect(stats.quantiles[0]).toBeCloseTo(0, 3);
    expect(stats.quantiles[SOFT_COVER_QUANTILES]).toBeCloseTo(1, 3);
    expect(stats.quantiles[SOFT_COVER_QUANTILES / 2]).toBeCloseTo(0.5, 2);
  });

  it('knows its mean and spread', () => {
    expect(stats.mean).toBeCloseTo(0.5, 3);
    expect(stats.deviation).toBeCloseTo(Math.sqrt(1 / 12), 3);
  });
});

describe('softCoverLevel', () => {
  const stats = softCoverStatistics(even(4096), 4);

  it('picks the level the share of the ground under cloud passes', () => {
    for (const share of [0.1, 0.3, 0.5, 0.8])
      expect(softCoverLevel(stats, share)).toBeCloseTo(1 - share, 2);
  });

  it('falls as the share rises, nothing passing it for none and all for all', () => {
    let before = Infinity;
    for (let share = 0; share <= 1; share += 0.05) {
      const level = softCoverLevel(stats, share);
      expect(level).toBeLessThan(before);
      before = level;
    }
    expect(softCoverLevel(stats, 0)).toBeGreaterThan(
      stats.quantiles[SOFT_COVER_QUANTILES],
    );
    expect(softCoverLevel(stats, 1)).toBe(stats.quantiles[0]);
  });

  it('is undone by softCoverShare', () => {
    // A skewed distribution: the squares of evenly spread values.
    const skewed = even(4096).map(v => v * v);
    const s = softCoverStatistics(skewed, 4);
    let worst = 0;
    for (let share = 0.05; share < 1; share += 0.05)
      worst = Math.max(
        worst,
        Math.abs(softCoverShare(s, softCoverLevel(s, share)) - share),
      );
    expect(worst).toBeLessThan(1e-3);
  });
});

describe('softCoverTexel', () => {
  it('reads softCoverLevel from a row of the quantiles, filtered linearly', () => {
    const skewed = even(4096).map(v => v * v);
    const s = softCoverStatistics(skewed, 4);
    const row = s.quantiles;
    // A texture's linear filter across `row`, at coordinate `u`.
    const filtered = (u: number) => {
      const x = Math.min(Math.max(u * row.length - 0.5, 0), row.length - 1);
      const i = Math.min(Math.floor(x), row.length - 2);
      return row[i] + (row[i + 1] - row[i]) * (x - i);
    };
    let worst = 0;
    let where = 0;
    for (let share = 0.01; share <= 1; share += 0.01) {
      const error = Math.abs(
        filtered(softCoverTexel(share)) - softCoverLevel(s, share),
      );
      if (error > worst) [worst, where] = [error, share];
    }
    expect(worst, `at share ${where}`).toBeLessThan(1e-6);
  });
});
