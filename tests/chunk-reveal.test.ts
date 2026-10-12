import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  chunkLayerReveal,
  chunkLayers,
} from '../src/components/Chunks/chunk-reveal';
import { SurfaceChunk, SurfaceChunkMesh } from '../src/sdk';

const xz = new BufferAttribute(new Float32Array(8), 2);

const cap = (layer: number, ceiling = false): SurfaceChunkMesh => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('xz', xz);
  geometry.setAttribute('y', new BufferAttribute(new Float32Array(4), 1));
  return { layer, ceiling, geometry } as SurfaceChunkMesh;
};

const wall = (layer: number): SurfaceChunkMesh => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(30), 3),
  );
  return { layer, geometry } as SurfaceChunkMesh;
};

const chunk = (surfaces: SurfaceChunkMesh[], walls: SurfaceChunkMesh[]) =>
  ({ surfaces, walls }) as unknown as SurfaceChunk;

describe('chunkLayerReveal', () => {
  it('reveals a layer as one item, its caps and walls together', () => {
    const c = chunk([cap(0), cap(1), cap(1, true)], [wall(0), wall(1)]);
    const items = chunkLayerReveal(c, [1]);
    expect(items).toEqual([{ key: 1, cost: 16 + 16 + 120 + 32 }]);
  });

  it('keeps the order layers became ready in, not the layer order', () => {
    const c = chunk([cap(0), cap(1), cap(2)], []);
    expect(chunkLayerReveal(c, [2, 0, 1]).map(i => i.key)).toEqual([2, 0, 1]);
  });

  it('charges a shared buffer to the first layer only', () => {
    const c = chunk([cap(0), cap(1)], []);
    const [first, second] = chunkLayerReveal(c, [1, 0]);
    expect(first.cost).toBe(32 + 16);
    expect(second.cost).toBe(16);
  });
});

describe('chunkLayers', () => {
  it('lists every layer with a mesh, including one with a wall and no cap', () => {
    const c = chunk([cap(2), cap(0)], [wall(0), wall(1)]);
    expect(chunkLayers(c)).toEqual([0, 1, 2]);
  });
});
