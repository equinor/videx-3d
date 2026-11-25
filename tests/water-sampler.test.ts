import { DataTexture, FloatType, Matrix3, RGFormat } from 'three';
import { describe, expect, it } from 'vitest';
import { WaterMaterial } from '../src/components/Water/water-material';
import { createWaterSampler } from '../src/components/Water/water-sampler';

const g = 9.81;

describe('WaterMaterial spectrum', () => {
  it('derives significant wave height from wind speed (Hs ~ 0.21 U^2 / g)', () => {
    const m = new WaterMaterial();
    m.windSpeed = 10;
    expect(m.significantHeight).toBeCloseTo((0.21 * 100) / g, 2);
    m.windSpeed = 15;
    expect(m.significantHeight).toBeCloseTo((0.21 * 225) / g, 2);
    m.dispose();
  });

  it('scales the significant wave height linearly with amplitude', () => {
    const m = new WaterMaterial();
    m.windSpeed = 10;
    const base = m.significantHeight;
    m.amplitude = 2;
    expect(m.significantHeight).toBeCloseTo(base * 2, 5);
    m.amplitude = 0;
    expect(m.significantHeight).toBe(0);
    m.dispose();
  });

  it('draws the significant wave height it derives', () => {
    const m = new WaterMaterial();
    m.windSpeed = 10;
    const stats = m.seaState.stats();
    expect(stats.significantHeight / m.significantHeight).toBeGreaterThan(0.9);
    expect(stats.significantHeight / m.significantHeight).toBeLessThan(1.1);
    m.dispose();
  });
});

describe('createWaterSampler', () => {
  it('exposes the material significant wave height', () => {
    const m = new WaterMaterial();
    m.windSpeed = 12;
    const sampler = createWaterSampler(m);
    expect(sampler.significantHeight).toBe(m.significantHeight);
    m.dispose();
  });

  it('returns a finite, bounded height: the sea state the surface draws', () => {
    const m = new WaterMaterial();
    m.windSpeed = 10;
    m.time = 3.2;
    const sampler = createWaterSampler(m);
    const h = sampler.getHeightAt(120, -340);
    expect(Number.isFinite(h)).toBe(true);
    // ~3x Hs is plenty of margin for a sea of that height.
    expect(Math.abs(h)).toBeLessThan(m.significantHeight * 3);
    expect(h).toBe(m.seaState.heightAt(120, -340));
    m.dispose();
  });

  it('produces a flat surface when amplitude is zero', () => {
    const m = new WaterMaterial();
    m.amplitude = 0;
    const sampler = createWaterSampler(m);
    expect(sampler.getHeightAt(0, 0)).toBeCloseTo(0, 6);
    expect(sampler.getHeightAt(500, -500)).toBeCloseTo(0, 6);
    m.dispose();
  });

  it('animates with time', () => {
    const m = new WaterMaterial();
    m.windSpeed = 10;
    m.time = 0;
    const sampler = createWaterSampler(m);
    const a = sampler.getHeightAt(50, 50);
    m.time = 5;
    const b = sampler.getHeightAt(50, 50);
    expect(a).not.toBeCloseTo(b, 4);
    m.dispose();
  });

  it('cuts the waves by the depth, as the surface does: to nothing at the shore', () => {
    const m = new WaterMaterial();
    m.windSpeed = 12;
    m.time = 7.5;
    let depth = 1e30;
    const sampler = createWaterSampler(m, 0, undefined, () => depth);
    const rms = () => {
      let sum = 0;
      for (let i = 0; i < 400; i++)
        sum += sampler.getHeightAt(i * 37.3, i * -11.9) ** 2;
      return Math.sqrt(sum / 400);
    };
    const deep = rms();
    depth = 0;
    expect(rms()).toBe(0);
    // In water a metre deep, the sea's height is held under the breaking height there (a
    // margin for estimating it from 400 points).
    depth = 1;
    expect(4 * rms()).toBeLessThan((1.2 * depth) / m.shoreBreakDepth);
    expect(4 * deep).toBeGreaterThan(2);
    m.dispose();
  });

  it('reads the depth under the level from its bathymetry grid, else its flat floor', () => {
    // A 2 × 2 grid, 10 m cells from the origin: the bed at -4 m, one node unmapped.
    const data = new Float32Array([-4, 1, -4, 1, -4, 1, -4, 0]);
    const texture = new DataTexture(data, 2, 2, RGFormat, FloatType);
    const toUv = new Matrix3().set(1 / 20, 0, 0.25, 0, 1 / 20, 0.25, 0, 0, 1);
    const m = new WaterMaterial({
      bathymetry: { texture, toUv, cellSize: 10 },
    });
    m.waterLevel = 1;
    expect(m.depthAt(0, 0)).toBeCloseTo(5, 6);
    // Beyond the grid it is the water's own floor.
    expect(m.depthAt(500, 500)).toBe(m.water.depth);
    m.dispose();
  });
});
