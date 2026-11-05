/**
 * The noise the 3D clouds are made of (`SceneryCloudVolume`): a small cube of tileable 3D
 * noise, generated once, which the shader samples at several scales, and a procedural value
 * noise for the broad patterns, which a tile a few clouds across would repeat in a grid seen
 * from high up. Free of three.js; the component makes the texture.
 *
 * @module
 */

/**
 * A tileable cube of noise, `size` texels a side, four channels in `[0, 1]`:
 *
 * - `r` the clouds' shape, where they are: billowy cells (inverted Worley) roughened by
 *   gradient noise, 4 cells across the tile;
 * - `g` the puffs that roughen their edges: Worley at 2, 4 and 8 cells, inverted (1 in
 *   the puffs' cores);
 * - `b` wisps: gradient noise at 8 and 16 cells;
 * - `a` broad, smooth gradient noise at 2 and 4 cells: what warps where `r` is read.
 *
 * And how the coverage the shader builds from it (`r`, at two scales, mixed with
 * {@link cloudValueNoise} at a broader one: {@link cloudCoverageOf}) is distributed, so a
 * share of the ground to cover
 * can be turned into the level the coverage must pass ({@link cloudCoverageThreshold}).
 *
 * @group Weather
 */
export type CloudNoise = {
  /** texels along each side */
  size: number;
  /** RGBA bytes, x fastest, then y, then z, as a `Data3DTexture` takes them */
  data: Uint8Array;
  coverage: {
    /** the coverage at each sixteenth of its distribution, from its least (0) to its most (16) */
    quantiles: Float32Array;
    mean: number;
    /** its standard deviation */
    deviation: number;
  };
};

/**
 * How much broader the coverage's second tap of the tile is than its first, read turned as
 * the broad octave is: its period over theirs. Not a whole number, so the two never line up
 * into a repeat seen from high up.
 *
 * @group Weather
 */
export const CLOUD_NOISE_SECOND = 1.618;

/**
 * How much the coverage's shape takes of its second tap, against its first: as much, or the
 * first's period shows in rows seen from high up.
 *
 * @group Weather
 */
export const CLOUD_NOISE_SECOND_WEIGHT = 0.5;

/**
 * How much broader the coverage's second octave is than its first: its period over theirs.
 * Not a whole number, so the two never line up into a repeat.
 *
 * @group Weather
 */
export const CLOUD_NOISE_BROAD = 3.1;

/**
 * How much the coverage takes of its broad octave ({@link cloudValueNoise}), against its
 * first (`r`).
 *
 * @group Weather
 */
export const CLOUD_NOISE_BROAD_WEIGHT = 0.35;

/**
 * The cells after which {@link cloudValueNoise} repeats, along each axis.
 *
 * @group Weather
 */
export const CLOUD_VALUE_NOISE_PERIOD = 289;

// Stefan Gustavson's permutation polynomial modulo 289 (webgl-noise, MIT).
const permute = (x: number) => {
  const y = ((x * 34 + 10) * x) % 289;
  return y < 0 ? y + 289 : y;
};
const mod289 = (x: number) => x - Math.floor(x / 289) * 289;
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise in `[0, 1)` at `x`, `y`, `z` in cells, smooth, and hashed so it repeats only
 * every {@link CLOUD_VALUE_NOISE_PERIOD} cells: the twin of `cloudValueNoise` in
 * `cloud-volume-march.glsl`.
 *
 * @group Weather
 */
export function cloudValueNoise(x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const ix = mod289(fx);
  const iy = mod289(fy);
  const iz = mod289(fz);
  const jx = mod289(ix + 1);
  const jy = mod289(iy + 1);
  const jz = mod289(iz + 1);
  const at = (a: number, b: number, c: number) =>
    permute(permute(permute(c) + b) + a) / 289;
  const u = smooth(x - fx);
  const v = smooth(y - fy);
  const w = smooth(z - fz);
  return lerp(
    lerp(lerp(at(ix, iy, iz), at(jx, iy, iz), u), lerp(at(ix, jy, iz), at(jx, jy, iz), u), v),
    lerp(lerp(at(ix, iy, jz), at(jx, iy, jz), u), lerp(at(ix, jy, jz), at(jx, jy, jz), u), v),
    w,
  );
}

// Integer hash of a lattice point (32 bits, well mixed).
function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x, 0x8da6b343) ^
    Math.imul(y, 0xd8163841) ^
    Math.imul(z, 0xcb1ab31f) ^
    Math.imul(seed + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const wrap = (i: number, period: number) => ((i % period) + period) % period;

// The cube's 12 edge directions, Perlin's gradients.
const GRADIENTS = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

// A lattice repeating every `period` cells: each point's gradient (Perlin) or feature point
// within its cell (Worley), and each index from -1 to `period` wrapped into it (at i + 1).
type Lattice = { period: number; points: Float32Array; wrapped: Int32Array };

function lattice(
  period: number,
  point: (x: number, y: number, z: number, out: Float32Array, i: number) => void,
): Lattice {
  const points = new Float32Array(period * period * period * 3);
  for (let z = 0, i = 0; z < period; z++)
    for (let y = 0; y < period; y++)
      for (let x = 0; x < period; x++, i += 3) point(x, y, z, points, i);
  const wrapped = new Int32Array(period + 2);
  for (let i = -1; i <= period; i++) wrapped[i + 1] = wrap(i, period);
  return { period, points, wrapped };
}

const gradients = (period: number, seed: number) =>
  lattice(period, (x, y, z, out, i) => {
    const g = GRADIENTS[hash3(x, y, z, seed) % 12];
    out[i] = g[0];
    out[i + 1] = g[1];
    out[i + 2] = g[2];
  });

const features = (cells: number, seed: number) =>
  lattice(cells, (x, y, z, out, i) => {
    out[i] = hash3(x, y, z, seed) / 4294967296;
    out[i + 1] = hash3(x, y, z, seed + 1) / 4294967296;
    out[i + 2] = hash3(x, y, z, seed + 2) / 4294967296;
  });

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const gradientDot = (
  g: Float32Array,
  i: number,
  dx: number,
  dy: number,
  dz: number,
) => g[i * 3] * dx + g[i * 3 + 1] * dy + g[i * 3 + 2] * dz;

// Gradient noise over `lattice`, about [-1, 1], at `x`, `y`, `z` in [0, period).
function perlin(x: number, y: number, z: number, { period, points, wrapped }: Lattice) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const x0 = wrapped[ix + 1];
  const x1 = wrapped[ix + 2];
  const y0 = wrapped[iy + 1] * period;
  const y1 = wrapped[iy + 2] * period;
  const z0 = wrapped[iz + 1] * period * period;
  const z1 = wrapped[iz + 2] * period * period;
  const g = points;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const gx = fx - 1;
  const gy = fy - 1;
  const gz = fz - 1;
  return lerp(
    lerp(
      lerp(
        gradientDot(g, z0 + y0 + x0, fx, fy, fz),
        gradientDot(g, z0 + y0 + x1, gx, fy, fz),
        u,
      ),
      lerp(
        gradientDot(g, z0 + y1 + x0, fx, gy, fz),
        gradientDot(g, z0 + y1 + x1, gx, gy, fz),
        u,
      ),
      v,
    ),
    lerp(
      lerp(
        gradientDot(g, z1 + y0 + x0, fx, fy, gz),
        gradientDot(g, z1 + y0 + x1, gx, fy, gz),
        u,
      ),
      lerp(
        gradientDot(g, z1 + y1 + x0, fx, gy, gz),
        gradientDot(g, z1 + y1 + x1, gx, gy, gz),
        u,
      ),
      v,
    ),
    w,
  );
}

// Distance to the nearest of one feature point per cell of `lattice`, in cells (0 to about
// 1), at `x`, `y`, `z` in [0, period).
function worley(x: number, y: number, z: number, { period, points, wrapped }: Lattice) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let nearest = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    const cz = iz + dz;
    const rz = wrapped[cz + 1] * period * period;
    for (let dy = -1; dy <= 1; dy++) {
      const cy = iy + dy;
      const ry = rz + wrapped[cy + 1] * period;
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const i = (ry + wrapped[cx + 1]) * 3;
        const ox = cx + points[i] - x;
        const oy = cy + points[i + 1] - y;
        const oz = cz + points[i + 2] - z;
        const d = ox * ox + oy * oy + oz * oz;
        if (d < nearest) nearest = d;
      }
    }
  }
  return Math.sqrt(nearest);
}

// A deterministic stream of numbers in [0, 1) (mulberry32).
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Channel `channel` (0 r, 1 g, 2 b, 3 a) of `noise` at `x`, `y`, `z` in tiles (1 is one
 * tile; it repeats), interpolated between texel centres as a GPU samples it, in `[0, 1]`.
 *
 * @group Weather
 */
export function sampleCloudNoise(
  noise: CloudNoise,
  channel: number,
  x: number,
  y: number,
  z: number,
): number {
  const { size, data } = noise;
  const fx = x * size - 0.5;
  const fy = y * size - 0.5;
  const fz = z * size - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const ty = fy - iy;
  const tz = fz - iz;
  const x0 = wrap(ix, size);
  const x1 = wrap(ix + 1, size);
  const y0 = wrap(iy, size) * size;
  const y1 = wrap(iy + 1, size) * size;
  const z0 = wrap(iz, size) * size * size;
  const z1 = wrap(iz + 1, size) * size * size;
  const c = channel;
  const value = lerp(
    lerp(
      lerp(data[(z0 + y0 + x0) * 4 + c], data[(z0 + y0 + x1) * 4 + c], tx),
      lerp(data[(z0 + y1 + x0) * 4 + c], data[(z0 + y1 + x1) * 4 + c], tx),
      ty,
    ),
    lerp(
      lerp(data[(z1 + y0 + x0) * 4 + c], data[(z1 + y0 + x1) * 4 + c], tx),
      lerp(data[(z1 + y1 + x0) * 4 + c], data[(z1 + y1 + x1) * 4 + c], tx),
      ty,
    ),
    tz,
  );
  return value / 255;
}

/**
 * The coverage the shader builds from `noise`: its shape (`r`) at `shape` and at `second`, in
 * tiles ({@link CLOUD_NOISE_SECOND_WEIGHT}), mixed with its broad octave
 * ({@link cloudValueNoise}) at `broad`, in its cells ({@link CLOUD_NOISE_BROAD_WEIGHT}).
 *
 * @group Weather
 */
export function cloudCoverageOf(
  noise: CloudNoise,
  shape: [number, number, number],
  second: [number, number, number],
  broad: [number, number, number],
): number {
  const first = sampleCloudNoise(noise, 0, shape[0], shape[1], shape[2]);
  const other = sampleCloudNoise(noise, 0, second[0], second[1], second[2]);
  const r = first + (other - first) * CLOUD_NOISE_SECOND_WEIGHT;
  const a = cloudValueNoise(broad[0], broad[1], broad[2]);
  return r + (a - r) * CLOUD_NOISE_BROAD_WEIGHT;
}

/**
 * The level the coverage must pass for cloud to lie over `cover` of the ground (0 to 1): its
 * distribution's quantile at `1 - cover`, between the sixteenths of `quantiles`. The
 * shader's twin.
 *
 * @group Weather
 */
export function cloudCoverageThreshold(
  quantiles: ArrayLike<number>,
  cover: number,
): number {
  const x = Math.min(Math.max(1 - cover, 0), 1) * (quantiles.length - 1);
  const i = Math.min(Math.floor(x), quantiles.length - 2);
  return lerp(quantiles[i], quantiles[i + 1], x - i);
}

/**
 * Make the clouds' noise ({@link CloudNoise}): `size` texels a side (a power of two; 32
 * takes some tens of milliseconds), the same for the same `seed`.
 *
 * @group Weather
 */
export function createCloudNoise(size = 32, seed = 0): CloudNoise {
  const count = size * size * size;
  const channels = [0, 1, 2, 3].map(() => new Float32Array(count));
  const rough = [gradients(4, seed), gradients(8, seed + 1)];
  const shapeCells = features(4, seed + 11);
  const detail = [2, 4, 8].map((cells, i) => features(cells, seed + 23 + i));
  const wisps = [gradients(8, seed + 2), gradients(16, seed + 3)];
  const broad = [gradients(2, seed + 4), gradients(4, seed + 5)];

  for (let z = 0, i = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++, i++) {
        // The texel's centre, in tiles.
        const px = (x + 0.5) / size;
        const py = (y + 0.5) / size;
        const pz = (z + 0.5) / size;

        const shape =
          0.7 * perlin(px * 4, py * 4, pz * 4, rough[0]) +
          0.3 * perlin(px * 8, py * 8, pz * 8, rough[1]);
        const cells = 1 - worley(px * 4, py * 4, pz * 4, shapeCells);
        channels[0][i] = 0.5 * (0.5 + 0.5 * shape) + 0.5 * cells;

        channels[1][i] =
          1 -
          0.625 * worley(px * 2, py * 2, pz * 2, detail[0]) -
          0.25 * worley(px * 4, py * 4, pz * 4, detail[1]) -
          0.125 * worley(px * 8, py * 8, pz * 8, detail[2]);

        channels[2][i] =
          0.65 * perlin(px * 8, py * 8, pz * 8, wisps[0]) +
          0.35 * perlin(px * 16, py * 16, pz * 16, wisps[1]);

        channels[3][i] =
          0.7 * perlin(px * 2, py * 2, pz * 2, broad[0]) +
          0.3 * perlin(px * 4, py * 4, pz * 4, broad[1]);
      }

  // Each channel stretched over [0, 1].
  const data = new Uint8Array(count * 4);
  for (let c = 0; c < 4; c++) {
    const values = channels[c];
    let least = Infinity;
    let most = -Infinity;
    for (let i = 0; i < count; i++) {
      least = Math.min(least, values[i]);
      most = Math.max(most, values[i]);
    }
    const span = most - least || 1;
    for (let i = 0; i < count; i++)
      data[i * 4 + c] = Math.round(((values[i] - least) / span) * 255);
  }

  const noise: CloudNoise = {
    size,
    data,
    coverage: { quantiles: new Float32Array(17), mean: 0, deviation: 0 },
  };

  // The coverage's distribution, sampled as the shader reads it: its taps and its broad octave
  // at unrelated places, the broad one anywhere over its period.
  const next = random(seed + 101);
  const cells = () => next() * CLOUD_VALUE_NOISE_PERIOD;
  const samples = new Float32Array(16384);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = cloudCoverageOf(
      noise,
      [next(), next(), next()],
      [next(), next(), next()],
      [cells(), cells(), cells()],
    );
    samples[i] = value;
    sum += value;
  }
  samples.sort();
  const mean = sum / samples.length;
  let variance = 0;
  for (const value of samples) variance += (value - mean) * (value - mean);
  const { quantiles } = noise.coverage;
  for (let k = 0; k <= 16; k++)
    quantiles[k] = samples[Math.round((k / 16) * (samples.length - 1))];
  noise.coverage.mean = mean;
  noise.coverage.deviation = Math.sqrt(variance / samples.length);
  return noise;
}
