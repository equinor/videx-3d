import { describe, expect, it } from 'vitest';
import {
  WEATHER_SLICK_MEAN,
  weatherGustsOf,
  weatherWindAt,
} from '../src/sdk/weather/wind-field';

// The field's statistics over points far enough apart to be unrelated, about 300 km square.
function sample(windSpeed: number, pixel = 0) {
  const gusts = weatherGustsOf(windSpeed);
  let sum = 0;
  let sum2 = 0;
  let slick = 0;
  let n = 0;
  for (let i = 0; i < 300; i++)
    for (let j = 0; j < 300; j++) {
      const w = weatherWindAt(
        i * 1031.3,
        j * 977.9,
        [1, 0],
        1234,
        gusts,
        pixel,
      );
      sum += w.factor;
      sum2 += w.factor * w.factor;
      slick += w.slick;
      n++;
    }
  const mean = sum / n;
  return {
    gusts,
    mean,
    spread: Math.sqrt(sum2 / n - mean * mean),
    slick: slick / n,
  };
}

describe('weatherWindAt', () => {
  it('spreads the local wind about the mean by the gusts’ strength', () => {
    const { gusts, mean, spread } = sample(15);
    expect(mean).toBeCloseTo(1, 2);
    expect(spread / gusts.strength).toBeGreaterThan(0.95);
    expect(spread / gusts.strength).toBeLessThan(1.05);
  });

  it('lays slicks in light air over their mean share, none in a fresh breeze', () => {
    expect(Math.abs(sample(2).slick - WEATHER_SLICK_MEAN)).toBeLessThan(0.01);
    expect(weatherGustsOf(12).slicks).toBe(0);
  });

  it('gives way to the mean where its features are under the pixel', () => {
    const w = weatherWindAt(123, 456, [0, 1], 99, weatherGustsOf(3), 1e5);
    expect(w.factor).toBe(1);
    expect(w.slick).toBeCloseTo(WEATHER_SLICK_MEAN, 9);
  });
});
