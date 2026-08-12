import { Vec3 } from '../src/sdk/types/common';
import { distanceToBounds } from '../src/sdk/utils/vector-operations';

describe('distanceToBounds', () => {
  test('returns Infinity when no shape is provided', () => {
    expect(distanceToBounds([0, 0, 0], {})).toBe(Infinity);
  });

  describe('sphere', () => {
    const sphere: { center: Vec3; radius: number } = {
      center: [0, 0, 0],
      radius: 5,
    };

    test('is 0 inside or on the surface', () => {
      expect(distanceToBounds([0, 0, 0], { sphere })).toBe(0); // centre
      expect(distanceToBounds([3, 0, 0], { sphere })).toBe(0); // inside
      expect(distanceToBounds([5, 0, 0], { sphere })).toBe(0); // on surface
    });

    test('is the distance to the surface when outside', () => {
      expect(distanceToBounds([10, 0, 0], { sphere })).toBe(5); // 10 - r5
      expect(distanceToBounds([0, 0, 8], { sphere })).toBe(3); // 8 - r5
    });

    test('respects a non-origin centre', () => {
      const s: { center: Vec3; radius: number } = {
        center: [10, 0, 0],
        radius: 2,
      };
      expect(distanceToBounds([16, 0, 0], { sphere: s })).toBe(4); // 6 - r2
    });
  });

  describe('box', () => {
    const box: [Vec3, Vec3] = [
      [-1, -1, -1],
      [1, 1, 1],
    ];

    test('is 0 inside or on the box', () => {
      expect(distanceToBounds([0, 0, 0], { box })).toBe(0);
      expect(distanceToBounds([1, 1, 1], { box })).toBe(0); // corner
    });

    test('is the axis-aligned gap when offset along one axis', () => {
      expect(distanceToBounds([4, 0, 0], { box })).toBe(3); // 4 - max 1
      expect(distanceToBounds([0, -6, 0], { box })).toBe(5); // min -1 - (-6)
    });

    test('is the euclidean distance to the nearest corner', () => {
      // nearest point is corner (1,1,1); gap (3,3,3) -> length sqrt(27)
      expect(distanceToBounds([4, 4, 4], { box })).toBeCloseTo(Math.sqrt(27));
    });
  });

  describe('position', () => {
    test('is the euclidean point-to-point distance', () => {
      expect(distanceToBounds([0, 0, 0], { position: [3, 4, 0] })).toBe(5);
    });
  });

  describe('precedence (sphere > box > position)', () => {
    test('sphere is used when all are provided', () => {
      const bounds = {
        sphere: { center: [0, 0, 0] as Vec3, radius: 5 },
        box: [
          [-100, -100, -100],
          [100, 100, 100],
        ] as [Vec3, Vec3],
        position: [0, 0, 0] as Vec3,
      };
      // sphere -> 10 - 5 = 5 (box would be 0 inside; position 10)
      expect(distanceToBounds([10, 0, 0], bounds)).toBe(5);
    });

    test('box is used over position when no sphere', () => {
      const bounds = {
        box: [
          [-1, -1, -1],
          [1, 1, 1],
        ] as [Vec3, Vec3],
        position: [100, 0, 0] as Vec3,
      };
      // box -> 4 - 1 = 3 (position would be 96)
      expect(distanceToBounds([4, 0, 0], bounds)).toBe(3);
    });
  });
});
