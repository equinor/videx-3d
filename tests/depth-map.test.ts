import { DataTexture, FloatType, Matrix3, RGFormat } from 'three';
import { describe, expect, it } from 'vitest';
import { depthMapHeightAt } from '../src/sdk/materials/depth-map';

// 3 × 2 texels, 1 m cells, X/Z straight onto uv: (R height, G validity).
const map = (valid = [1, 1, 1, 1, 1, 1]) => {
  const heights = [0, 6, 12, 3, 9, 15];
  const data = new Float32Array(12);
  heights.forEach((h, i) => {
    data[2 * i] = h;
    data[2 * i + 1] = valid[i];
  });
  return {
    texture: new DataTexture(data, 3, 2, RGFormat, FloatType),
    toUv: new Matrix3().set(1 / 3, 0, 0, 0, 1 / 2, 0, 0, 0, 1),
  };
};

describe('depthMapHeightAt', () => {
  it('reads texel centres exactly and halfway between them as their mean', () => {
    expect(depthMapHeightAt(map(), 0.5, 0.5)).toBeCloseTo(0, 6);
    expect(depthMapHeightAt(map(), 2.5, 1.5)).toBeCloseTo(15, 6);
    expect(depthMapHeightAt(map(), 1, 0.5)).toBeCloseTo(3, 6);
    // Hermite weights, as depth-map.glsl: a quarter of the way is 0.15625 of it.
    expect(depthMapHeightAt(map(), 0.75, 0.5)).toBeCloseTo(6 * 0.15625, 6);
  });

  it('is null where the grid holds no data, as the shader falls back there', () => {
    expect(depthMapHeightAt(map([1, 0, 0, 1, 0, 0]), 1.5, 1)).toBeNull();
    expect(depthMapHeightAt(map(), 50, 50)).toBeNull();
  });
});
