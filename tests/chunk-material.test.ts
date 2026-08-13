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

  describe('water tint', () => {
    it('compiles the branch out when none is asked for, or it is off', () => {
      expect('CHUNK_WATER_TINT' in defines(new ChunkMaterial())).toBe(false);
      const off = new ChunkMaterial({
        waterTint: { color: '#0a2540', level: 0, strength: 0, depth: 80 },
      });
      expect('CHUNK_WATER_TINT' in defines(off)).toBe(false);
    });

    it('packs the level, strength and depth scale for the shader', () => {
      const material = new ChunkMaterial({
        waterTint: { color: '#0a2540', level: -25, strength: 0.6, depth: 50 },
      });
      expect('CHUNK_WATER_TINT' in defines(material)).toBe(true);
      const params = material.uniforms.waterTintParams.value;
      expect(params.x).toBe(-25);
      expect(params.y).toBe(0.6);
      // The shader multiplies by this, so it is the RECIPROCAL of the depth.
      expect(params.z).toBeCloseTo(1 / 50);
    });
  });
});
