import { describe, expect, it } from 'vitest';
import { createTinSampler } from '../src/sdk/geometries/tin-sampler';

/** A tilted plane over [0, size]², as two triangles. */
function plane(size = 10, f = (x: number, z: number) => 2 * x + 3 * z) {
  const positions = [
    0,
    f(0, 0),
    0,
    size,
    f(size, 0),
    0,
    size,
    f(size, size),
    size,
    0,
    f(0, size),
    size,
  ];
  return { positions, indices: [0, 1, 2, 0, 2, 3] };
}

/** A `cells`² grid over [0, cells], with the listed cells left out. */
function grid(cells: number, skip: [number, number][] = []) {
  const positions: number[] = [];
  const indices: number[] = [];
  const at = (c: number, r: number) => r * (cells + 1) + c;
  for (let r = 0; r <= cells; r++) {
    for (let c = 0; c <= cells; c++) positions.push(c, 0, r);
  }
  const missing = new Set(skip.map(([c, r]) => `${c}:${r}`));
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (missing.has(`${c}:${r}`)) continue;
      indices.push(at(c, r), at(c + 1, r), at(c + 1, r + 1));
      indices.push(at(c, r), at(c + 1, r + 1), at(c, r + 1));
    }
  }
  return { positions, indices };
}

describe('createTinSampler', () => {
  it('interpolates the plane exactly, inside every triangle', () => {
    const { positions, indices } = plane();
    const sampler = createTinSampler(positions, indices);

    let worst = 0;
    for (let x = 0.05; x < 10; x += 0.37) {
      for (let z = 0.05; z < 10; z += 0.41) {
        const y = sampler.getHeightAt(x, z);
        expect(y).not.toBeNull();
        worst = Math.max(worst, Math.abs(y! - (2 * x + 3 * z)));
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('reports the plane normal, always facing up', () => {
    const { positions, indices } = plane();
    const sampler = createTinSampler(positions, indices);
    const sample = sampler.sampleAt(4, 6)!;

    // y = 2x + 3z  =>  normal along (-2, 1, -3)
    const length = Math.hypot(2, 1, 3);
    expect(sample.normal[0]).toBeCloseTo(-2 / length, 6);
    expect(sample.normal[1]).toBeCloseTo(1 / length, 6);
    expect(sample.normal[2]).toBeCloseTo(-3 / length, 6);
  });

  it('returns null outside the mesh and inside a hole', () => {
    const { positions, indices } = grid(6, [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ]);
    const sampler = createTinSampler(positions, indices);

    expect(sampler.getHeightAt(0.5, 0.5)).toBe(0);
    expect(sampler.getHeightAt(3, 3)).toBeNull();
    expect(sampler.getHeightAt(-1, 3)).toBeNull();
    expect(sampler.getHeightAt(3, 7)).toBeNull();
  });

  it('samples a non-indexed mesh', () => {
    const { positions, indices } = plane();
    const soup: number[] = [];
    for (const i of indices) soup.push(...positions.slice(i * 3, i * 3 + 3));

    const sampler = createTinSampler(soup);
    expect(sampler.triangles).toBe(2);
    expect(sampler.getHeightAt(3, 4)).toBeCloseTo(18, 6);
  });

  it('takes the highest where triangles overlap in XZ', () => {
    const { positions, indices } = plane(10, () => 0);
    const raised = [...positions];
    for (let i = 1; i < positions.length; i += 3) raised[i] = 5;
    const sampler = createTinSampler(
      [...positions, ...raised],
      [...indices, ...indices.map(i => i + 4)],
    );
    expect(sampler.getHeightAt(4, 4)).toBe(5);
  });

  it('covers the whole mesh whatever the bucket size', () => {
    const { positions, indices } = grid(8);
    const coarse = createTinSampler(positions, indices, { cellSize: 100 });
    const fine = createTinSampler(positions, indices, { cellSize: 0.1 });

    let hits = 0;
    for (let x = 0.5; x < 8; x++) {
      for (let z = 0.5; z < 8; z++) {
        if (coarse.getHeightAt(x, z) !== null) hits++;
        expect(fine.getHeightAt(x, z)).toBe(coarse.getHeightAt(x, z));
      }
    }
    expect(hits).toBe(64);
  });
});
