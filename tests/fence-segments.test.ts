import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  FENCE_MASKED,
  FENCE_MAX_SEGMENTS,
} from '../src/sdk/geometries/fence-segments';

describe('fence segment index', () => {
  /**
   * ⚠️⚠️ The shader cannot import the TypeScript constant, so the cap exists twice. They were
   * 48 (JS) and 32 (GLSL): every cell holding 33–48 segments had its tail silently ignored by
   * the shader — in exactly the crowded cells the exact lookup exists for — and `truncated`
   * never counted them, because it only counts lists that overflow the JS cap.
   */
  it('caps the cell list at the same number the shader loops', () => {
    const glsl = readFileSync(
      'src/sdk/materials/shaderLib/fence-field.glsl',
      'utf-8',
    );
    const match = glsl.match(/#define\s+FENCE_MAX_SEGMENTS\s+(\d+)/);
    expect(match, 'fence-field.glsl defines FENCE_MAX_SEGMENTS').toBeTruthy();
    expect(Number(match![1])).toBe(FENCE_MAX_SEGMENTS);
  });

  it('marks a masked node with the same value the shader tests', () => {
    const glsl = readFileSync(
      'src/sdk/materials/shaderLib/fence-field.glsl',
      'utf-8',
    );
    const match = glsl.match(/#define\s+FENCE_MASKED\s+([\d.e+]+)/);
    expect(match, 'fence-field.glsl defines FENCE_MASKED').toBeTruthy();
    expect(Number(match![1])).toBe(FENCE_MASKED);
  });
});
