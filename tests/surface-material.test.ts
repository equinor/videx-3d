import { describe, expect, it } from 'vitest';
import { SurfaceMaterial } from '../src/components/Surfaces/SurfaceMaterial';

describe('SurfaceMaterial detail', () => {
  it('compiles a preset in, and out again', () => {
    const material = new SurfaceMaterial({ detail: 'sand' });
    expect(material.defines).toHaveProperty('SURFACE_DETAIL');
    expect(material.defines).toHaveProperty('SURFACE_DETAIL_GRANULAR');
    const version = material.version;
    material.detail = null;
    expect(material.defines).not.toHaveProperty('SURFACE_DETAIL');
    expect(material.version).toBeGreaterThan(version);
  });

  it('recompiles for a new preset, not for a new strength or scale', () => {
    const material = new SurfaceMaterial({ detail: 'sand' });
    const version = material.version;
    material.detail = { preset: 'sand', strength: 0.5, scale: 2 };
    expect(material.version).toBe(version);
    expect(material.uniforms.detailStrength.value).toBe(0.5);
    // the granular frequency, divided by the scale
    expect(material.uniforms.detailGranular.value.y).toBeCloseTo(0.0625);
    material.detail = 'shale';
    expect(material.version).toBeGreaterThan(version);
    expect(material.defines).toHaveProperty('SURFACE_DETAIL_GRAIN');
  });
});
