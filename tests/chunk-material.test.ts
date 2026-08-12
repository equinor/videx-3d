import { describe, expect, it } from 'vitest';
import { ChunkMaterial } from '../src/components/Chunks/chunk-material';

const defines = (material: ChunkMaterial) =>
  material.defines as Record<string, unknown>;

describe('ChunkMaterial', () => {
  it('compiles no detail branch at all when none is asked for', () => {
    const material = new ChunkMaterial({ color: '#4e79a7' });
    expect('CHUNK_DETAIL' in defines(material)).toBe(false);
    expect('CHUNK_DETAIL_GRANULAR' in defines(material)).toBe(false);
  });

  it('treats a zero strength as no detail', () => {
    const material = new ChunkMaterial({
      detail: { preset: 'sand', strength: 0 },
    });
    expect('CHUNK_DETAIL' in defines(material)).toBe(false);
  });

  it('enables only the layers a preset actually uses', () => {
    const sand = new ChunkMaterial({ detail: 'sand' });
    expect('CHUNK_DETAIL' in defines(sand)).toBe(true);
    expect('CHUNK_DETAIL_GRANULAR' in defines(sand)).toBe(true);
    expect('CHUNK_DETAIL_GRAIN' in defines(sand)).toBe(false);
    expect('CHUNK_DETAIL_DUNES' in defines(sand)).toBe(false);

    const seabed = new ChunkMaterial({ detail: 'seabed' });
    expect('CHUNK_DETAIL_DUNES' in defines(seabed)).toBe(true);
    expect(seabed.uniforms.detailDunes.value.y).toBeGreaterThan(0);
  });

  it('anchors bedding to the unit on a wall and not on a cap', () => {
    // `bedding` is the mix toward `wallV`, which only a wall carries; a cap
    // reading a missing attribute would get 0 and lose the pattern's y axis.
    const wall = new ChunkMaterial({ detail: 'shale', wall: true });
    const cap = new ChunkMaterial({ detail: 'shale' });
    expect('CHUNK_WALL' in defines(wall)).toBe(true);
    expect('CHUNK_WALL' in defines(cap)).toBe(false);
    expect(wall.uniforms.detailGrainB.value.z).toBeGreaterThan(0);
    expect(cap.uniforms.detailGrainB.value.z).toBe(0);
  });

  it('scales a preset by the callers one knob', () => {
    const material = new ChunkMaterial({
      detail: { preset: 'basement', strength: 2 },
    });
    expect(material.uniforms.detailStrength.value).toBe(2);
  });

  it('keeps the opacity property and its uniform in step', () => {
    // The OIT pass routes on `material.opacity`, so a disagreement between the
    // property and the uniform would draw a solid surface into a blend pass.
    const material = new ChunkMaterial({ opacity: 0.4, transparent: true });
    expect(material.opacity).toBe(0.4);
    expect(material.uniforms.opacity.value).toBe(0.4);
    material.opacity = 0.8;
    expect(material.uniforms.opacity.value).toBe(0.8);
  });
});
