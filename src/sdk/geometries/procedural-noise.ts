/**
 * CPU value-noise primitives — the worker-side counterpart of the GLSL
 * `procedural-normal.glsl` library, mirroring its hash, value noise and domain
 * warp so a field generated on the CPU matches the character the ocean bed
 * shader already produces on the GPU.
 *
 * ⭐ Why value noise rather than a sum of sines: a separable `sin(x) * cos(z)`
 * sum is axis-aligned and exactly periodic, so it tiles into a regular square
 * lattice — the "squarey" look. A hashed lattice has neither an axis to align to
 * nor a short period, so the same construction reads as organic terrain.
 *
 * Deliberately free of any three.js import: these run inside the (inlined)
 * workers alongside the rest of the grid maths.
 *
 * @module
 */

const fract = (x: number) => x - Math.floor(x);

/**
 * Precision-robust 2D→1D hash (Dave Hoskins) — the exact form used by
 * `pnHash2` in the GLSL library, with `fract` applied before any multiply so the
 * working values stay in `[0, 1)`.
 *
 * @group Geometries
 */
export function noiseHash2(px: number, py: number): number {
  // GLSL source samples `vec3(p.xyx)`, so the third lane repeats px.
  let x = fract(px * 0.1031);
  let y = fract(py * 0.1031);
  let z = fract(px * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  return fract((x + y) * z);
}

/**
 * 2D value noise (smoothstep-interpolated), in `[0, 1]`. Matches
 * `pnValueNoise2` in the GLSL library.
 *
 * @group Geometries
 */
export function valueNoise2(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = noiseHash2(ix, iy);
  const b = noiseHash2(ix + 1, iy);
  const c = noiseHash2(ix, iy + 1);
  const d = noiseHash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Fractional Brownian motion over {@link valueNoise2}, in `[0, 1]` with mean
 * ≈ 0.5. Lacunarity 2.02 (not exactly 2) so octaves do not re-align into a
 * pattern, mirroring `pnFbm2`.
 *
 * @group Geometries
 */
export function fbm2(px: number, py: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(px, py);
    norm += amp;
    px *= 2.02;
    py *= 2.02;
    amp *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Displace a sample coordinate by a low-frequency value-noise offset so the
 * features built on top of it meander instead of sitting on a grid — the CPU
 * mirror of the domain warp in `pnDunes`. `strength` is in the same units as the
 * input coordinate.
 *
 * @group Geometries
 */
export function warpCoords(
  px: number,
  py: number,
  strength: number,
): [number, number] {
  const wx = valueNoise2(px * 0.5, py * 0.5) - 0.5;
  const wy = valueNoise2(px * 0.5 + 19.3, py * 0.5 - 7.1) - 0.5;
  return [px + wx * strength, py + wy * strength];
}
