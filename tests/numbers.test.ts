import {
  clamp,
  inverseLerp,
  lerp,
  remap,
  toRGB,
} from '../src/sdk/utils/numbers';

describe('numbers', () => {
  test('should clamp to min max', () => {
    expect(clamp(1.1)).toBe(1);
    expect(clamp(-0.1)).toBe(0);
    expect(clamp(0.1)).toBe(0.1);
    expect(clamp(2.4, 1, 2)).toBe(2);
    expect(clamp(2.4, 1, 3)).toBe(2.4);
    expect(clamp(2.4, 3, 10)).toBe(3);
  });

  test('should linearly interpolate between two numbers', () => {
    expect(lerp(0, 1, 0)).toBe(0);
    expect(lerp(0, 1, 0.5)).toBe(0.5);
    expect(lerp(0, 1, 1)).toBe(1);
    expect(lerp(0, 1, -1)).toBe(0);
    expect(lerp(0, 1, 1.2)).toBe(1);
  });

  test('should find interpolation position (t) given a value along with min and max', () => {
    expect(inverseLerp(0, 0, 1)).toBe(0);
    expect(inverseLerp(0.5, 0, 1)).toBe(0.5);
    expect(inverseLerp(1, 0, 1)).toBe(1);
    expect(inverseLerp(1.5, 0, 1)).toBe(1.5);
    expect(inverseLerp(-1, 0, 1)).toBe(-1);
    expect(inverseLerp(125, 0, 200)).toBe(0.625);
  });

  test('should be able to remap a value from one range to another', () => {
    expect(remap(50, 0, 100, 0, 1)).toBe(0.5);
    expect(remap(0.5, 0, 1, 0, 100)).toBe(50);
  });

  test('should be able to map a positive float value (in the range 0-16777.215) to an array of rgb colors (0-255)', () => {
    expect(toRGB(0)).toEqual([0, 0, 0]);
    expect(toRGB(1000)).toEqual([15, 66, 64]);
    expect(toRGB(1000.21)).toEqual([15, 67, 18]);
    expect(toRGB(16777.215)).toEqual([255, 255, 255]);
    expect(toRGB(-1)).toEqual([0, 0, 0]);
    expect(() => toRGB(16777.216)).toThrowError('Value out of range!');
  });
});
