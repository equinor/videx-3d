import { describe, expect, it } from 'vitest';
import {
  createGraticuleUniforms,
  graticuleStep,
  setGraticuleUniforms,
} from '../src/sdk/materials/graticule';

describe('setGraticuleUniforms', () => {
  it('sets each kind in its slot, and turns off what is left out or invisible', () => {
    const uniforms = createGraticuleUniforms();
    setGraticuleUniforms(uniforms, {
      latLon: { color: '#ffffff', thickness: 1.5, opacity: 0.8, interval: 5 },
      utm: { color: '#ff0000', thickness: 2, opacity: 1 },
      timeZones: { color: '#00ff00', thickness: 1, opacity: 0 },
    });
    const [latLon, utm, timeZones] = uniforms.uGraticuleLines.value;
    expect(latLon.x).toBe(1.5);
    expect(utm.x).toBe(2);
    // No opacity: off.
    expect(timeZones.x).toBe(0);
    const [white, red] = uniforms.uGraticuleColors.value;
    expect(white.toArray()).toEqual([1, 1, 1, 0.8]);
    expect(red.toArray()).toEqual([1, 0, 0, 1]);

    setGraticuleUniforms(uniforms, { utm: null });
    expect(uniforms.uGraticuleLines.value.map(lines => lines.x)).toEqual([
      0, 0, 0,
    ]);
  });
});

describe('graticuleStep', () => {
  it('takes the finest step at least minSpacing pixels apart, the next fading in', () => {
    // 1° is 100 pixels: under 120, so 5° (500 pixels), with 1° fading in.
    const at = graticuleStep(1 / 100, 120);
    expect(at.step).toBe(5);
    expect(at.finer).toBe(1);
    expect(at.weight).toBeGreaterThan(0);
    expect(at.weight).toBeLessThan(1);
    // 1° at 200 pixels: 1°, with 30′ (100 pixels) fading in; at 240, 30′ is the step.
    const closer = graticuleStep(1 / 200, 120);
    expect(closer.step).toBe(1);
    expect(closer.finer).toBe(0.5);
    expect(graticuleStep(1 / 240, 120).step).toBe(0.5);
    // Under half the spacing the finer step is out.
    expect(graticuleStep(1 / 50, 120).weight).toBe(0);
  });

  it('keeps the coarsest far off and the finest close up', () => {
    expect(graticuleStep(10, 120)).toMatchObject({ step: 30, weight: 0 });
    const close = graticuleStep(1e-7, 120);
    expect(close.step).toBeCloseTo(1 / 60, 12);
    expect(close.weight).toBe(0);
  });

  it('changes step without a jump', () => {
    // Where 1° reaches 120 pixels, it is drawn whole either side.
    const below = graticuleStep(1 / 119.999, 120);
    const above = graticuleStep(1 / 120.001, 120);
    const drawn = (s: ReturnType<typeof graticuleStep>, step: number) =>
      s.step === step ? 1 : s.finer === step ? s.weight : 0;
    expect(drawn(below, 1)).toBeCloseTo(drawn(above, 1), 3);
  });
});
