import { describe, expect, it } from 'vitest';
import {
  cloudCoverageOf,
  cloudCoverageThreshold,
  cloudValueNoise,
  createCloudNoise,
  curlNoiseMap,
  sampleCloudNoise,
} from '../src/sdk/materials/cloud-noise';

const noise = createCloudNoise(32, 7);

describe('createCloudNoise', () => {
  it('is the same for the same seed, and another for another', () => {
    const again = createCloudNoise(32, 7);
    expect(again.data).toEqual(noise.data);
    const other = createCloudNoise(32, 8);
    expect(other.data).not.toEqual(noise.data);
  });

  it('fills each channel over its whole range', () => {
    for (let c = 0; c < 4; c++) {
      let least = 255;
      let most = 0;
      for (let i = c; i < noise.data.length; i += 4) {
        least = Math.min(least, noise.data[i]);
        most = Math.max(most, noise.data[i]);
      }
      expect(least).toBe(0);
      expect(most).toBe(255);
    }
  });

  it('tiles: no seam where a tile meets the next', () => {
    const { size, data } = noise;
    for (let c = 0; c < 4; c++) {
      let inside = 0;
      let seam = 0;
      for (let z = 0; z < size; z++)
        for (let y = 0; y < size; y++) {
          const at = (x: number) => data[((z * size + y) * size + x) * 4 + c];
          seam = Math.max(seam, Math.abs(at(size - 1) - at(0)));
          for (let x = 1; x < size; x++)
            inside = Math.max(inside, Math.abs(at(x) - at(x - 1)));
        }
      expect(seam).toBeLessThanOrEqual(inside);
    }
    // And sampling repeats every tile.
    expect(sampleCloudNoise(noise, 0, 0.3, 0.6, 0.1)).toBeCloseTo(
      sampleCloudNoise(noise, 0, 1.3, -0.4, 2.1),
      6,
    );
  });
});

describe('cloudValueNoise', () => {
  it('lies in [0, 1), repeats every 289 cells and is smooth', () => {
    let state = 99;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state / 4294967296) * 600 - 300;
    };
    for (let i = 0; i < 500; i++) {
      const [x, y, z] = [next(), next(), next()];
      const value = cloudValueNoise(x, y, z);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(cloudValueNoise(x + 289, y - 289, z + 578)).toBeCloseTo(value, 9);
      expect(Math.abs(cloudValueNoise(x + 1e-3, y, z) - value)).toBeLessThan(
        0.01,
      );
    }
  });
});

describe('cloud coverage', () => {
  it('lays cloud over the share of the ground asked for', () => {
    const { quantiles } = noise.coverage;
    for (let k = 1; k < quantiles.length; k++)
      expect(quantiles[k]).toBeGreaterThanOrEqual(quantiles[k - 1]);

    // Fresh places, not those the distribution was measured at.
    let state = 12345;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const values = Array.from({ length: 8000 }, () =>
      cloudCoverageOf(
        noise,
        [next(), next(), next()],
        [next(), next(), next()],
        [next() * 289, next() * 289, next() * 289],
      ),
    );
    for (const cover of [0.2, 0.45, 0.75]) {
      const threshold = cloudCoverageThreshold(quantiles, cover);
      const share = values.filter(v => v > threshold).length / values.length;
      expect(Math.abs(share - cover)).toBeLessThan(0.04);
    }
  });

  it('knows its mean and spread', () => {
    const { mean, deviation, quantiles } = noise.coverage;
    expect(mean).toBeGreaterThan(quantiles[4]);
    expect(mean).toBeLessThan(quantiles[12]);
    expect(deviation).toBeGreaterThan(0.02);
  });
});

describe('curlNoiseMap', () => {
  const size = 64;
  const map = curlNoiseMap(size, 3);
  const at = (x: number, y: number, c: number) =>
    map[4 * (((y + size) % size) * size + ((x + size) % size)) + c];

  it('swirls within -1 to 1, reaching it', () => {
    let most = 0;
    for (const v of map) most = Math.max(most, Math.abs(v));
    expect(most).toBeCloseTo(1, 6);
  });

  it('neither gathers nor spreads', () => {
    let worst = 0;
    for (let layer = 0; layer < 2; layer++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const divergence =
            at(x + 1, y, 2 * layer) - at(x - 1, y, 2 * layer) +
            at(x, y + 1, 2 * layer + 1) - at(x, y - 1, 2 * layer + 1);
          worst = Math.max(worst, Math.abs(divergence));
        }
    expect(worst).toBeLessThan(1e-5);
  });

  it('tiles without a seam', () => {
    let seam = 0;
    let within = 0;
    for (let y = 0; y < size; y++)
      for (let c = 0; c < 4; c++) {
        seam = Math.max(seam, Math.abs(at(size - 1, y, c) - at(0, y, c)));
        within = Math.max(within, Math.abs(at(size / 2, y, c) - at(size / 2 - 1, y, c)));
      }
    expect(seam).toBeLessThan(2 * within);
  });
});
