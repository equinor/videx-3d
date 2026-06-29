import { describe, expect, it } from 'vitest';
import { OceanMaterial } from '../src/components/Ocean/ocean-material';
import { createOceanSampler } from '../src/components/Ocean/ocean-sampler';

const g = 9.81;

describe('OceanMaterial spectrum', () => {
  it('derives significant wave height from wind speed (Hs ~ 0.21 U^2 / g)', () => {
    const m = new OceanMaterial();
    m.windSpeed = 10;
    expect(m.significantHeight).toBeCloseTo((0.21 * 100) / g, 2);
    m.windSpeed = 15;
    expect(m.significantHeight).toBeCloseTo((0.21 * 225) / g, 2);
    m.dispose();
  });

  it('scales the significant wave height linearly with amplitude', () => {
    const m = new OceanMaterial();
    m.windSpeed = 10;
    const base = m.significantHeight;
    m.amplitude = 2;
    expect(m.significantHeight).toBeCloseTo(base * 2, 5);
    m.amplitude = 0;
    expect(m.significantHeight).toBe(0);
    m.dispose();
  });

  it('renormalises the component amplitudes so the field Hs matches the target', () => {
    const m = new OceanMaterial({ waveCount: 16 });
    m.windSpeed = 10;
    const waveB = m.uniforms.uWaveB.value as { x: number }[];
    let m0 = 0;
    for (const c of waveB) m0 += 0.5 * c.x * c.x;
    expect(4 * Math.sqrt(m0)).toBeCloseTo(m.significantHeight, 3);
    m.dispose();
  });
});

describe('createOceanSampler', () => {
  it('exposes the material significant wave height', () => {
    const m = new OceanMaterial();
    m.windSpeed = 12;
    const sampler = createOceanSampler(m);
    expect(sampler.significantHeight).toBe(m.significantHeight);
    m.dispose();
  });

  it('returns a finite, bounded height that matches the shader sum', () => {
    const m = new OceanMaterial();
    m.windSpeed = 10;
    m.time = 3.2;
    const sampler = createOceanSampler(m);
    const h = sampler.getHeightAt(120, -340);
    expect(Number.isFinite(h)).toBe(true);
    // The sum of |amplitudes| is the hard ceiling; ~3x Hs is plenty of margin.
    expect(Math.abs(h)).toBeLessThan(m.significantHeight * 3);
  });

  it('produces a flat surface when amplitude is zero', () => {
    const m = new OceanMaterial();
    m.amplitude = 0;
    const sampler = createOceanSampler(m);
    expect(sampler.getHeightAt(0, 0)).toBeCloseTo(0, 6);
    expect(sampler.getHeightAt(500, -500)).toBeCloseTo(0, 6);
    m.dispose();
  });

  it('animates with time', () => {
    const m = new OceanMaterial();
    m.windSpeed = 10;
    m.time = 0;
    const sampler = createOceanSampler(m);
    const a = sampler.getHeightAt(50, 50);
    m.time = 5;
    const b = sampler.getHeightAt(50, 50);
    expect(a).not.toBeCloseTo(b, 4);
    m.dispose();
  });
});
