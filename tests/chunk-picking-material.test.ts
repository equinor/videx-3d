import { describe, expect, it } from 'vitest';
import { Vector2, Vector4 } from 'three';
import {
  ChunkMaterial,
  createFenceUniforms,
} from '../src/components/Chunks/chunk-material';
import { ChunkPickingMaterial } from '../src/components/Chunks/chunk-picking-material';
import { createInferenceMaterial } from '../src/components/Chunks/inference-material';
import { getPickingMaterial } from '../src/components/EventEmitter/picking-material';

const cut = () => ({
  sectionPlane: { value: new Vector4(1, 0, 0, -5) },
  fence: createFenceUniforms({ value: new Vector2(1, 1) }),
});

describe('chunk picking material', () => {
  it('gives an uncut material no picking twin', () => {
    expect(getPickingMaterial(new ChunkMaterial())).toBeUndefined();
  });

  // ⭐ By IDENTITY: a copied uniform would freeze at its first value, so a moving plane
  // or a fence side swap would leave picking on the old cut while the drawing follows.
  it('binds every cut uniform of the material it stands in for, by identity', () => {
    const { sectionPlane, fence } = cut();
    const material = new ChunkMaterial({ sectionPlane, fence });
    const picking = getPickingMaterial(material);
    expect(picking).toBeInstanceOf(ChunkPickingMaterial);

    const twin = picking as ChunkPickingMaterial;
    expect(twin.defines).toMatchObject({ CHUNK_SECTION: '', CHUNK_FENCE: '' });
    const keys = Object.keys(material.uniforms).filter(
      key => key === 'sectionPlane' || key.startsWith('fence'),
    );
    expect(keys).toHaveLength(11);
    const copied = keys.filter(
      key => twin.uniforms[key] !== material.uniforms[key],
    );
    expect(copied, 'uniforms not shared with the drawn material').toEqual([]);
  });

  it('carries only the cut the material has', () => {
    const { fence } = cut();
    const twin = getPickingMaterial(new ChunkMaterial({ fence }))!;
    expect((twin as ChunkPickingMaterial).defines).not.toHaveProperty(
      'CHUNK_SECTION',
    );
    expect((twin as ChunkPickingMaterial).defines).toHaveProperty(
      'CHUNK_FENCE',
    );
  });

  it('is disposed and unregistered with its material', () => {
    const material = new ChunkMaterial(cut());
    const twin = getPickingMaterial(material)!;
    let disposed = false;
    twin.addEventListener('dispose', () => {
      disposed = true;
    });
    material.dispose();
    expect(disposed).toBe(true);
    expect(getPickingMaterial(material)).toBeUndefined();
  });

  it('covers the inference overlay drawn over a cut chunk', () => {
    const { sectionPlane } = cut();
    const overlay = createInferenceMaterial('hatched', { sectionPlane })!;
    expect(getPickingMaterial(overlay)).toBeInstanceOf(ChunkPickingMaterial);
    expect(
      getPickingMaterial(createInferenceMaterial('hatched')!),
    ).toBeUndefined();
  });
});
