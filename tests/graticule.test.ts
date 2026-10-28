import { Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createGraticuleUniforms,
  graticuleStep,
  GRATICULE_CELL_ASPECT,
  GRATICULE_MIN_MERIDIANS,
  GRATICULE_STEPS,
  GRATICULE_THINNING_MAX,
  graticuleMeridianChain,
  graticuleMeridianThinning,
  setGraticuleOrigin,
  setGraticuleUniforms,
} from '../src/sdk/materials/graticule';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import { Globe } from '../src/sdk/projection/globe';

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

describe('setGraticuleOrigin', () => {
  // The demo field's frame (UTM 31N, ED50), the stage's disc 8 km across about its origin.
  const globe = () => {
    const g = new Globe();
    g.setDisc([-4000, -4000, 4000, 4000]);
    g.setFrame({
      projection: getProjectionDefFromUtmZone('31N'),
      origin: [434500, 6478000],
    });
    return g;
  };
  const f = Math.fround;

  it('measures the lines from under the camera to a centimetre, in 32-bit floats', () => {
    const g = globe();
    const uniforms = createGraticuleUniforms();
    const offset = new Vector2();
    const point = new Vector3();
    // Over the field, and 150 km off it.
    for (const [x, z] of [
      [0, 0],
      [150000, -40000],
    ]) {
      setGraticuleOrigin(uniforms, g, g.place(x, z, 40, point));
      const base = uniforms.uGraticuleBase.value;
      const origin = uniforms.uGraticuleOrigin.value;
      const [a1, a2, a3] = uniforms.uGraticuleSeries.value.toArray().map(f);
      expect(origin.w).toBe(1);
      // Points up to 0.03 rad (~190 km) away on the sphere, as the shader's near path.
      for (const dx of [-0.03, -0.01, -1e-4, 0, 3e-6, 0.002, 0.029])
        for (const dy of [-0.02, 0, 0.0007, 0.025]) {
          offset.set(origin.x + dx, origin.y + dy);
          const latitude = g.sphereGeographicLatitude(offset.x);
          // As the shader has it: the offset's difference, then the series, in fp32.
          const d = f(f(offset.x) - f(origin.x));
          const lat = f(d * f(a1 + f(d * f(a2 + f(d * a3)))));
          const local = f(f(base.w) + lat);
          // A centimetre is 9e-8° of latitude.
          expect(Math.abs(base.y + local - latitude)).toBeLessThan(3e-7);
        }
    }
  });

  it('leaves the lines to latitude and longitude themselves without a frame', () => {
    const uniforms = createGraticuleUniforms();
    setGraticuleOrigin(uniforms, new Globe(), new Vector3());
    expect(uniforms.uGraticuleOrigin.value.w).toBe(0);
  });
});

describe('graticuleMeridianChain', () => {
  it('thins by twos and threes, each dividing the meridians round the Earth, four at least', () => {
    for (const step of GRATICULE_STEPS) {
      const chain = graticuleMeridianChain(step);
      const around = Math.round(360 / step);
      expect(chain[0]).toBe(1);
      expect(chain.length).toBeLessThanOrEqual(GRATICULE_THINNING_MAX);
      for (let i = 1; i < chain.length; i++)
        expect([2, 3]).toContain(chain[i] / chain[i - 1]);
      for (const m of chain) {
        expect(around % m, `${step}°, every ${m}`).toBe(0);
        expect(around / m).toBeGreaterThanOrEqual(GRATICULE_MIN_MERIDIANS);
      }
    }
    // 0.5°: 720 round the Earth, down to every 144th, five of them.
    expect(graticuleMeridianChain(0.5)).toEqual([1, 2, 4, 8, 16, 48, 144]);
  });
});

describe('graticuleMeridianThinning', () => {
  const DEG = Math.PI / 180;

  it('keeps cells at least half as wide as tall, thinning only at a parallel', () => {
    for (const step of GRATICULE_STEPS) {
      const bands = Math.ceil(90 / step - 1e-9);
      let previous = 1;
      let stopped = false;
      for (let band = 0; band < bands; band++) {
        const m = graticuleMeridianThinning(step, band);
        // The same south of the equator.
        expect(graticuleMeridianThinning(step, -band - 1)).toBe(m);
        // Once stopped, stopped all the way to the pole; else among the last band's.
        expect(stopped && m !== 0, `${step}°, band ${band}`).toBe(false);
        expect(m === 0 || m % previous === 0).toBe(true);
        stopped ||= m === 0;
        previous = m || previous;
        const poleward = Math.min((band + 1) * step, 90);
        const narrowest = poleward < 90 ? Math.cos(poleward * DEG) : 1;
        expect(m === 0 || m * narrowest >= GRATICULE_CELL_ASPECT - 1e-9).toBe(
          true,
        );
      }
    }
  });

  it('runs 30° to the pole, and caps finer steps where they would crowd', () => {
    expect(graticuleMeridianThinning(30, 2)).toBe(1);
    // 10°: every 2nd from 60°, 4th from 70°, none past 80°.
    expect([5, 6, 7, 8].map(b => graticuleMeridianThinning(10, b))).toEqual([
      1, 2, 4, 0,
    ]);
    // 0.5° about 89°N (the view from 174 km): every 24°, then 72°, not 720 of them; none
    // past 89.5°.
    expect(graticuleMeridianThinning(0.5, 177)).toBe(48);
    expect(graticuleMeridianThinning(0.5, 178)).toBe(144);
    expect(graticuleMeridianThinning(0.5, 179)).toBe(0);
    expect(graticuleMeridianThinning(0, 0)).toBe(0);
  });
});
