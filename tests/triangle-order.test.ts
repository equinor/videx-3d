import { describe, expect, it } from 'vitest';
import { sortTrianglesSpatially } from '../src/sdk/geometries/triangle-order';

// A 16 x 16 grid of quads, two triangles each, listed in a scrambled order.
const N = 16;
const coords = new Float32Array((N + 1) * (N + 1) * 2);
for (let r = 0; r <= N; r++) {
  for (let c = 0; c <= N; c++) {
    coords[2 * (r * (N + 1) + c)] = c * 25;
    coords[2 * (r * (N + 1) + c) + 1] = r * 25;
  }
}
const triangles: number[][] = [];
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const v = r * (N + 1) + c;
    triangles.push([v, v + 1, v + N + 1], [v + 1, v + N + 2, v + N + 1]);
  }
}
// a fixed shuffle, so the test does not depend on luck
const scrambled = triangles
  .map((t, i) => ({ t, k: (i * 7919) % triangles.length }))
  .sort((a, b) => a.k - b.k)
  .flatMap(({ t }) => t);

const asSet = (indices: ArrayLike<number>) => {
  const set = new Set<string>();
  for (let i = 0; i < indices.length; i += 3) {
    set.add(`${indices[i]}/${indices[i + 1]}/${indices[i + 2]}`);
  }
  return set;
};

describe('sortTrianglesSpatially', () => {
  it('keeps every triangle, with its winding', () => {
    const sorted = sortTrianglesSpatially(scrambled, coords);
    expect(sorted.length).toBe(scrambled.length);
    expect(asSet(sorted)).toEqual(asSet(scrambled));
  });

  it('puts consecutive triangles next to each other', () => {
    const gap = (indices: ArrayLike<number>) => {
      let total = 0;
      for (let i = 3; i < indices.length; i += 3) {
        const centre = (k: number) => [
          (coords[2 * indices[k]] +
            coords[2 * indices[k + 1]] +
            coords[2 * indices[k + 2]]) /
            3,
          (coords[2 * indices[k] + 1] +
            coords[2 * indices[k + 1] + 1] +
            coords[2 * indices[k + 2] + 1]) /
            3,
        ];
        const [ax, ay] = centre(i - 3);
        const [bx, by] = centre(i);
        total += Math.hypot(bx - ax, by - ay);
      }
      return total / (indices.length / 3 - 1);
    };
    // A Z-curve over cells 25 m across steps one or two cells at a time on
    // average; the scrambled list jumps across the grid.
    expect(gap(sortTrianglesSpatially(scrambled, coords))).toBeLessThan(40);
    expect(gap(scrambled)).toBeGreaterThan(100);
  });

  it('is idempotent and does not depend on the input order', () => {
    const sorted = sortTrianglesSpatially(scrambled, coords);
    expect([...sortTrianglesSpatially(sorted, coords)]).toEqual([...sorted]);
    expect([...sortTrianglesSpatially(triangles.flat(), coords)]).toEqual([
      ...sorted,
    ]);
  });

  it('reads coordinates with a stride', () => {
    const xyz = new Float32Array((coords.length / 2) * 3);
    for (let v = 0; v < coords.length / 2; v++) {
      xyz[3 * v] = coords[2 * v];
      xyz[3 * v + 1] = coords[2 * v + 1];
      xyz[3 * v + 2] = -1000;
    }
    expect([...sortTrianglesSpatially(scrambled, xyz, 3)]).toEqual([
      ...sortTrianglesSpatially(scrambled, coords),
    ]);
  });
});
