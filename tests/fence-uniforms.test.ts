import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { Matrix3, Texture, Vector2, Vector4 } from 'three';
import {
  ChunkFenceSideValues,
  applyFenceSide,
  createFenceUniforms,
} from '../src/components/Chunks/chunk-material';
import { applyFenceField } from '../src/sdk/materials/fence-field';

/**
 * The fence's shared uniforms are copied in TWO places — the side swap in `useStackFence`,
 * and `applyFenceField`, which every material binds them with. Nothing typechecks either: a
 * field can be declared, typed and assigned elsewhere and still be missed by the copy,
 * which is exactly what happened to `pages`. It stayed at its neutral value, so the shader's
 * page-bounds test failed for every fragment and the whole cut silently fell back to the
 * coarse flood fill.
 *
 * ⚠️ A CPU simulation of the shader cannot catch this — it would read the value from the
 * source object rather than through the uniform that was never written. These tests read the
 * uniform objects and the binder SOURCE instead.
 */

/** A side whose every field is a distinct, recognisable value. */
function sentinelSide(): ChunkFenceSideValues {
  return {
    texture: new Texture(),
    toUv: new Matrix3().set(2, 3, 4, 5, 6, 7, 8, 9, 10),
    size: new Vector2(11, 12),
    cells: new Texture(),
    segments: new Texture(),
    index: new Vector4(13, 14, 15, 16),
    indexSize: new Vector2(17, 18),
    pages: new Vector4(19, 20, 21, 22),
    segmentsSize: new Vector2(23, 24),
  };
}

/** How each uniform key is fed from a side — `map` is the odd one out. */
const SOURCE: Record<string, keyof ChunkFenceSideValues> = {
  map: 'texture',
  toUv: 'toUv',
  size: 'size',
  cells: 'cells',
  segments: 'segments',
  index: 'index',
  indexSize: 'indexSize',
  pages: 'pages',
  segmentsSize: 'segmentsSize',
};

describe('fence uniforms', () => {
  it('copies EVERY field of a side into the shared uniforms', () => {
    const uniforms = createFenceUniforms({ value: new Vector2(0, 1) });
    const side = sentinelSide();
    applyFenceSide(uniforms, side);

    // ⭐ Driven by the uniform object's OWN keys, so a field added to the type and the factory
    // but not to the copy fails here rather than going quietly neutral on the GPU.
    const keys = Object.keys(uniforms).filter(key => key !== 'params');
    expect(keys.sort()).toEqual(Object.keys(SOURCE).sort());

    const missed: string[] = [];
    for (const key of keys) {
      const got = (uniforms as Record<string, { value: unknown }>)[key].value;
      const want = side[SOURCE[key]];
      const same =
        got instanceof Texture
          ? got === want
          : JSON.stringify((got as { toArray(): number[] }).toArray()) ===
            JSON.stringify((want as { toArray(): number[] }).toArray());
      if (!same) missed.push(key);
    }
    expect(missed, 'uniform fields not written by applyFenceSide').toEqual([]);
  });

  it('clears the textures when there is no side', () => {
    const uniforms = createFenceUniforms({ value: new Vector2(0, 1) });
    applyFenceSide(uniforms, sentinelSide());
    applyFenceSide(uniforms, null);
    expect(uniforms.map.value).toBeNull();
    expect(uniforms.cells.value).toBeNull();
    expect(uniforms.segments.value).toBeNull();
  });

  it('applyFenceField binds every uniform, as the very object', () => {
    const fence = createFenceUniforms({ value: new Vector2(0, 1) });
    const bound: Record<string, unknown> = {};
    applyFenceField(bound as Parameters<typeof applyFenceField>[0], fence);
    const missed = Object.entries(fence)
      .filter(
        ([key, uniform]) =>
          bound[`fence${key[0].toUpperCase()}${key.slice(1)}`] !== uniform,
      )
      .map(([key]) => key);
    expect(missed, 'uniforms not bound by applyFenceField').toEqual([]);
  });

  // ⚠️ A material binding the fence by hand drifts the way the side swap did.
  it.each([
    ['chunk material', 'src/components/Chunks/chunk-material.ts'],
    ['inference material', 'src/components/Chunks/inference-material.ts'],
    [
      'chunk picking material',
      'src/components/Chunks/chunk-picking-material.ts',
    ],
    ['ocean material', 'src/components/Ocean/ocean-material.ts'],
    ['ocean volume material', 'src/components/Ocean/ocean-volume-material.ts'],
    ['sky stage material', 'src/components/Sky/sky-stage.ts'],
  ])('%s binds the fence with applyFenceField', (_name, path) => {
    const source = readFileSync(path, 'utf-8');
    expect(source).toContain('applyFenceField(');
    expect(source).not.toMatch(/\.fence\w+ = /);
  });

  /**
   * ⚠️ The GLSL is split: `fence-field.glsl` declares the index uniforms it reads itself, while
   * `fenceCoarse` takes the sign map as ARGUMENTS, so `fenceParams`/`fenceMap`/`fenceToUv`/
   * `fenceSize` have to be declared by each shader that includes the lib. Either place counts,
   * but a uniform declared in NEITHER is bound from the CPU and never read.
   */
  it('every fence uniform is declared in the shared lib or in every consumer', () => {
    const lib = readFileSync(
      'src/sdk/materials/shaderLib/fence-field.glsl',
      'utf-8',
    );
    const consumers = [
      'src/components/Chunks/shaders/chunk-frag.glsl',
      'src/components/Chunks/shaders/chunk-pick-frag.glsl',
      'src/components/Chunks/inference-material.ts',
      'src/components/Ocean/shaders/fragment.glsl',
      'src/components/Ocean/shaders/volume-fragment.glsl',
      'src/components/Sky/shaders/stage-fragment.glsl',
    ].map(path => [path, readFileSync(path, 'utf-8')] as const);

    const declares = (source: string, key: string) =>
      new RegExp(
        `uniform\\s+\\w+\\s+fence${key[0].toUpperCase()}${key.slice(1)}\\s*;`,
      ).test(source);

    const missing: string[] = [];
    for (const key of ['params', ...Object.keys(SOURCE)]) {
      if (declares(lib, key)) continue;
      for (const [path, source] of consumers) {
        if (!declares(source, key)) missing.push(`${key} in ${path}`);
      }
    }
    expect(missing, 'fence uniform declared nowhere').toEqual([]);
  });
});
