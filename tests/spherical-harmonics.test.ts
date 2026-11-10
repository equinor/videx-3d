import { describe, expect, it } from 'vitest';
import { cubeFacesToSphericalHarmonics } from '../src/sdk/utils/spherical-harmonics';

const SIZE = 16;

// Six faces of RGBA floats, `faces[f]` the grey each face is filled with.
function cube(faces: number[]): Float32Array {
  const face = SIZE * SIZE * 4;
  const pixels = new Float32Array(face * 6);
  faces.forEach((value, f) => {
    for (let i = 0; i < face; i += 4) {
      pixels[f * face + i] = value;
      pixels[f * face + i + 1] = value;
      pixels[f * face + i + 2] = value;
      pixels[f * face + i + 3] = 1;
    }
  });
  return pixels;
}

describe('cubeFacesToSphericalHarmonics', () => {
  it('projects a constant sky onto the first band alone', () => {
    const sh = cubeFacesToSphericalHarmonics(cube([2, 2, 2, 2, 2, 2]), SIZE);
    const c = sh.coefficients;
    // ∫ L·Y₀ dΩ = L · 0.282095 · 4π
    expect(c[0].x).toBeCloseTo(2 * 0.282095 * 4 * Math.PI, 4);
    const rest = Math.max(...c.slice(1).map(v => Math.abs(v.x)));
    expect(rest).toBeLessThan(1e-4);
  });

  it('points the second band at a lit face (+X, +Y, +Z), as three lays out a WebGL cube', () => {
    // three's basis: [1] y, [2] z, [3] x.
    const px = cubeFacesToSphericalHarmonics(cube([1, 0, 0, 0, 0, 0]), SIZE);
    const py = cubeFacesToSphericalHarmonics(cube([0, 0, 1, 0, 0, 0]), SIZE);
    const pz = cubeFacesToSphericalHarmonics(cube([0, 0, 0, 0, 1, 0]), SIZE);
    expect(px.coefficients[3].x).toBeGreaterThan(0.1);
    expect(Math.abs(px.coefficients[1].x)).toBeLessThan(1e-4);
    expect(py.coefficients[1].x).toBeGreaterThan(0.1);
    expect(Math.abs(py.coefficients[3].x)).toBeLessThan(1e-4);
    expect(pz.coefficients[2].x).toBeGreaterThan(0.1);
    expect(Math.abs(pz.coefficients[1].x)).toBeLessThan(1e-4);
  });
});
