import { Color, DataUtils } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createVoidGradientTexture,
  voidGradientColor,
} from '../src/sdk/materials/void-gradient';

const gradient = {
  ceiling: '#ff0000',
  horizon: '#00ff00',
  depth: '#0000ff',
  falloff: 0.5,
};

const rowColor = (data: Uint16Array, row: number) =>
  new Color(
    DataUtils.fromHalfFloat(data[row * 4]),
    DataUtils.fromHalfFloat(data[row * 4 + 1]),
    DataUtils.fromHalfFloat(data[row * 4 + 2]),
  );

describe('createVoidGradientTexture', () => {
  it('runs from the depth colour straight down, through the horizon, to the ceiling straight up', () => {
    const rows = 512;
    const texture = createVoidGradientTexture(gradient, { rows });
    const data = texture.image.data as Uint16Array;
    expect(texture.image.height).toBe(rows);
    const close = (a: Color, b: Color) =>
      Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
    expect(close(rowColor(data, 0), new Color(gradient.depth))).toBeLessThan(
      0.01,
    );
    expect(
      close(rowColor(data, rows - 1), new Color(gradient.ceiling)),
    ).toBeLessThan(0.01);
    // Just over and under the horizon: mostly the horizon's colour.
    expect(rowColor(data, rows / 2).g).toBeGreaterThan(0.85);
    expect(rowColor(data, rows / 2 - 1).g).toBeGreaterThan(0.85);
    texture.dispose();
  });

  it('holds what voidGradientColor gives at each row, as the shader draws it', () => {
    const rows = 64;
    const data = createVoidGradientTexture(gradient, { rows }).image
      .data as Uint16Array;
    let worst = 0;
    let at = -1;
    for (let row = 0; row < rows; row++) {
      const y = Math.sin(Math.PI * ((row + 0.5) / rows - 0.5));
      const expected = voidGradientColor(y, gradient);
      const got = rowColor(data, row);
      const off = Math.max(
        Math.abs(got.r - expected.r),
        Math.abs(got.g - expected.g),
        Math.abs(got.b - expected.b),
      );
      if (off > worst) {
        worst = off;
        at = row;
      }
    }
    expect(worst, `row ${at}`).toBeLessThan(2e-3);
  });

  it('reaches the depth colour sooner with a smaller falloff', () => {
    const y = -0.25;
    const steep = voidGradientColor(y, { ...gradient, falloff: 0.25 });
    const gentle = voidGradientColor(y, { ...gradient, falloff: 2 });
    expect(steep.b).toBeGreaterThan(gentle.b);
  });
});
