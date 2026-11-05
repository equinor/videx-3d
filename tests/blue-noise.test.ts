import { describe, expect, it } from 'vitest';
import { createBlueNoise } from '../src/sdk/materials/blue-noise';

const SIZE = 32;
const noise = createBlueNoise(SIZE);

// The mean of each texel's (2 r + 1)² neighbourhood, wrapped, less the tile's mean: what a blur
// leaves of the noise. A 3 × 3 box passes too much of the high frequencies to tell.
function blurredSpread(values: ArrayLike<number>, size: number, r = 2) {
  let mean = 0;
  for (let i = 0; i < values.length; i++) mean += values[i];
  mean /= values.length;
  let sum = 0;
  const area = (2 * r + 1) ** 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let box = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          box += values[((y + dy + size) % size) * size + ((x + dx + size) % size)];
      sum += (box / area - mean) ** 2;
    }
  return Math.sqrt(sum / (size * size));
}

describe('createBlueNoise', () => {
  it('is the same every time', () => {
    expect(createBlueNoise(SIZE)).toEqual(noise);
  });

  it('takes every value equally often', () => {
    const counts = new Array(256).fill(0);
    noise.forEach(value => counts[value]++);
    const each = (SIZE * SIZE) / 256;
    expect(counts.every(count => count === each)).toBe(true);
  });

  it('keeps far less of itself through a blur than white noise does', () => {
    let state = 1;
    const white = Array.from({ length: SIZE * SIZE }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 4294967296) * 256);
    });
    expect(blurredSpread(noise, SIZE)).toBeLessThan(
      0.4 * blurredSpread(white, SIZE),
    );
  });
});
