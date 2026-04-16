import { Vec3 } from '../src/sdk/types/common';
import {
  addVec2,
  addVec3,
  angleVec3,
  copyVec3,
  crossVec3,
  dotVec3,
  getVec2,
  getVec3,
  lengthVec2,
  lengthVec3,
  mixVec2,
  mixVec3,
  negateVec2,
  negateVec3,
  normalizeVec2,
  normalizeVec3,
  rotateVec3,
  scaleVec2,
  scaleVec3,
  setVec2,
  setVec3,
  subVec2,
  subVec3,
} from '../src/sdk/utils/vector-operations';

describe('vector operations', () => {
  test('should negate vectors', () => {
    expect(negateVec2([1, -2])).toEqual([-1, 2]);
    expect(negateVec3([1, -2, 3])).toEqual([-1, 2, -3]);
    expect(negateVec2([0, 0])).toEqual([-0, -0]);
  });

  test('should get vector from an array of numbers starting from specified index', () => {
    const buffer = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(getVec3(buffer, 0)).toEqual([0, 1, 2]);
    expect(getVec3(buffer, 1)).toEqual([1, 2, 3]);
    expect(getVec3(buffer, 9)).toEqual([9, 10, undefined]);
    expect(getVec2(buffer, 9)).toEqual([9, 10]);
  });

  test('should be able to update values of an array of numbers using vectors', () => {
    const buffer = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    setVec3(buffer, 3, [1, 1, 1]);
    expect(buffer).toEqual([0, 1, 2, 1, 1, 1, 6, 7, 8, 9, 10]);

    setVec2(buffer, 9, [0, 0]);
    expect(buffer).toEqual([0, 1, 2, 1, 1, 1, 6, 7, 8, 0, 0]);
  });

  test('should be able to add vectors', () => {
    expect(addVec2([1, 2], [-2, 0])).toEqual([-1, 2]);
    expect(addVec3([2, 1, 2], [3, -2, 0])).toEqual([5, -1, 2]);
    expect(addVec2([0, 0], [0, 0])).toEqual([0, 0]);
    expect(addVec2([1, 0], [0, 0])).toEqual([1, 0]);
  });

  test('should be able to subtract vectors', () => {
    expect(subVec2([1, 2], [-2, 0])).toEqual([3, 2]);
    expect(subVec3([2, 1, 2], [3, -2, 0])).toEqual([-1, 3, 2]);
    expect(subVec2([0, 0], [0, 0])).toEqual([0, 0]);
    expect(subVec2([1, 0], [0, 0])).toEqual([1, 0]);
  });

  test('should be able to scale vectors', () => {
    expect(scaleVec2([1, 2], 3)).toEqual([3, 6]);
    expect(scaleVec3([1, 2, 3], -1)).toEqual([-1, -2, -3]);
    expect(scaleVec3([1, 2, 3], 0)).toEqual([0, 0, 0]);
  });

  test('should be able to calculate length of vectors', () => {
    expect(lengthVec2([1, 0])).toBe(1);
    expect(lengthVec2([0, 0])).toBe(0);
    expect(lengthVec3([1, 0, 0])).toBe(1);
    expect(lengthVec3([0, 0, 0])).toBe(0);
  });

  test('should be able to calculate cross product', () => {
    expect(crossVec3([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(crossVec3([0, 1, 0], [0, 1, 0])).toEqual([0, 0, 0]);
  });

  test('should be able to calculate dot product', () => {
    expect(dotVec3([1, 2, 0], [-1, 1, 0])).toEqual(1);
    expect(dotVec3([0, 1, 0], [0, 1, 0])).toEqual(1);
    expect(dotVec3([15, 2, -3], [1, 2, 5])).toEqual(4);
    expect(dotVec3([1, 2, 5], [15, 2, -3])).toEqual(4);
  });

  test('should be able to normalize vectors', () => {
    expect(normalizeVec2([10, 0])).toEqual([1, 0]);
    expect(normalizeVec2([0.1, 0])).toEqual([1, 0]);
    expect(normalizeVec3([10, 0, 0])).toEqual([1, 0, 0]);
    expect(normalizeVec3([0.1, 0, 0])).toEqual([1, 0, 0]);
  });

  test('should be able to linearly mix vectors', () => {
    expect(mixVec2([0, 1], [1, 0], 0)).toEqual([0, 1]);
    expect(mixVec2([0, 1], [1, 0], 1)).toEqual([1, 0]);
    expect(mixVec2([0, 1], [1, 0])).toEqual([0.5, 0.5]);

    expect(mixVec3([0, 1, 0], [1, 0, 10], 0)).toEqual([0, 1, 0]);
    expect(mixVec3([0, 1, 0], [1, 0, 10], 1)).toEqual([1, 0, 10]);
    expect(mixVec3([0, 1, 0], [1, 0, 10])).toEqual([0.5, 0.5, 5]);
  });

  test('should be able to determine angle between vectors', () => {
    expect(angleVec3([0, 1, 0], [1, 0, 0])).toBeCloseTo(Math.PI / 2, 7);
    expect(angleVec3([0, 1, 0], [-1, 0, 0])).toBeCloseTo(Math.PI / 2, 7);
    expect(angleVec3([1, 0, 0], [-1, 0, 0])).toBeCloseTo(Math.PI, 7);
    expect(angleVec3([1, 0, 0], [0, 0, 0])).toBeCloseTo(Math.PI / 2);
  });

  test('should be able to rotate a vector around an axis', () => {
    expect(rotateVec3([1, 0, 0])).toEqual([1, 0, 0]);
    expect(rotateVec3([1, 0, 0], [1, 0, 0], Math.PI / 4)).toEqual([1, 0, 0]);
    expect(rotateVec3([1, 0, 0], [0, 1, 0], Math.PI / 4)).toEqual([
      0.7071067811865476, 0, -0.7071067811865475,
    ]);
  });

  test('should be able to copy a vector', () => {
    const v: Vec3 = [1, 2, 3];
    const copy = copyVec3(v);
    expect(v).toEqual(copy);
    expect(v).not.toBe(copy);
  });
});
