import { describe, expect, it } from 'vitest';
import { LOD_COARSEN_MARGIN, selectLodLevel } from '../src/sdk/utils/lod';

describe('selectLodLevel', () => {
  const errors = [0, 1, 4, 16];

  it('takes the coarsest level within the limit', () => {
    expect(selectLodLevel(errors, 0.1, 0.5, 0)).toBe(2);
    expect(selectLodLevel(errors, 0.01, 0.5, 0)).toBe(3);
    expect(selectLodLevel(errors, 1, 0.5, 3)).toBe(0);
  });

  it('draws full detail at a pixel error of 0', () => {
    expect(selectLodLevel(errors, 1e-9, 0, 3)).toBe(0);
  });

  it('goes coarser only once the next level is under the margin', () => {
    // level 1 sits exactly at the limit: kept when drawn, not taken from finer
    const scale = 0.5 / errors[1];
    expect(selectLodLevel(errors, scale, 0.5, 1)).toBe(1);
    expect(selectLodLevel(errors, scale, 0.5, 0)).toBe(0);
    expect(selectLodLevel(errors, scale * LOD_COARSEN_MARGIN, 0.5, 0)).toBe(1);
  });
});
