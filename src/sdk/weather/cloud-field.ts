import { cloudValueNoise } from '../materials/cloud-noise';

// The 3D clouds' field (`SceneryCloudVolume`, documents/clouds.md): where its clouds are and
// what they are like, the twin of the march's (`cloud-field.glsl`). Pure, so the shader's
// statistics can be worked out and tested here.
//
// The field lies on a plane touching the Earth at the weather's middle (gnomonic: metres east
// and north there), drifting with the layer's wind. Cumulus are separate clouds, one at most in
// each cell of CUMULUS_GRIDS grids of growing cells, each grid its own range of sizes; a cloud
// lives a while (forming, building upward, fading) and the next takes its cell. Strato are a
// smooth field over the plane, drawn out along the wind.

/**
 * A 32-bit integer hash of a lattice point and a seed (each an integer, wrapped to 32 bits):
 * the twin of `cloudFieldHash` in `cloud-field.glsl`, bit for bit.
 */
export function cloudFieldHash(
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  let h =
    (Math.imul(x | 0, 0x8da6b343) ^
      Math.imul(y | 0, 0xd8163841) ^
      Math.imul(z | 0, 0xcb1ab31f) ^
      Math.imul(((seed >>> 0) + 0x9e3779b9) | 0, 0x85ebca6b)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Eight bits of `h` from bit `shift`, as a share in (0, 1): the shader's `cloudFieldByte`. */
export function cloudFieldByte(h: number, shift: number): number {
  return (((h >>> shift) & 255) + 0.5) / 256;
}

/** The low sixteen bits of `h`, as a share in [0, 1): the shader's `cloudFieldShort`. */
export function cloudFieldShort(h: number): number {
  return (h & 0xffff) / 65536;
}

/** The grids of cumulus, each a range of sizes (the shader's CLOUD_GRIDS). */
export const CUMULUS_GRIDS = 4;
/** The least and the most radius of a cumulus (metres, at scale 1). */
export const CUMULUS_LEAST = 200;
export const CUMULUS_MOST = 3500;
/** A grid's cells over its largest radius. */
export const CUMULUS_CELL = 2.6;
/**
 * The most a cloud reaches from its middle, over its radius: its body (CUMULUS_BODY), its
 * billows, its detail and its lean. With {@link CUMULUS_MARGIN}, what keeps it in its cell,
 * which the march relies on to skip what lies between clouds.
 */
export const CUMULUS_REACH = 1.2;
/**
 * A cumulus's body, before its billows heap it up and carve it, over its radius: it covers about
 * as much of the ground as that circle (the billows out as far as they cut in).
 */
export const CUMULUS_BODY = 0.8;
/**
 * The share of a cell's side kept clear of its cloud, along each of its edges: room for its
 * soft edge where a footprint widens it.
 */
export const CUMULUS_MARGIN = 0.02;
/**
 * How far each grid is turned from the field's east (radians, the `k`th of them): turned apart,
 * the cells' regular places never line up across the grids.
 */
export function cumulusGridTurn(k: number): number {
  return 0.3 + 0.9 * k;
}
/** Cells along a grid before it repeats: the drift is wrapped to as many. */
export const CUMULUS_WRAP = 1024;
/** How long a cumulus of {@link CUMULUS_LIFE_RADIUS} lives (weather seconds): larger, longer. */
export const CUMULUS_LIFETIME = 900;
export const CUMULUS_LIFE_RADIUS = 400;
/** Lifetimes along a grid before its count of them wraps (the shader's epochs). */
export const CUMULUS_EPOCHS = 1 << 20;

// A cumulus's salts: what each of its hashes is for.
const SALT_PHASE = 1;
const SALT_FORM = 2;
const SALT_PLACE = 3;
const SALT_LOOK = 4;

/**
 * How much taller than broad a cumulus `diameter` across (metres, at scale 1) grows: fair
 * weather humilis are flat (0.45), mediocris about as tall as broad, congestus towers (to 1.9).
 */
export function cumulusAspect(diameter: number): number {
  const a = 0.45 + 0.35 * Math.log2(Math.max(diameter, 1) / 500);
  return Math.min(Math.max(a, 0.45), 1.9);
}

/**
 * The radius (metres, at scale 1) of the largest cumulus a layer `thickness` deep (metres) holds:
 * as tall as the layer and a little over (the tallest are capped, spreading under its top).
 */
export function cumulusTopRadius(thickness: number): number {
  const fits = (r: number) => 2 * r * cumulusAspect(2 * r) <= thickness * 1.15;
  let low = CUMULUS_LEAST;
  let high = CUMULUS_MOST;
  if (fits(high)) return high;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (low + high);
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return Math.max(low, CUMULUS_LEAST * 1.4);
}

/**
 * A cumulus at `age` (0 formed, 1 gone) of its life: how far up it has built (a share of its
 * height), how far out (a share of its radius) and how dense it is (a share of its own). It
 * grows out of nothing, builds upward, and shrinks away as it dissipates — eroded, not thinned,
 * so a dying cloud is a small wisp rather than a see-through ghost of its full size.
 */
export function cumulusLife(age: number): {
  height: number;
  radius: number;
  density: number;
} {
  const fade = 1 - smoothstep(0.7, 1, age);
  return {
    height: smoothstep(0, 0.35, age) * (0.4 + 0.6 * fade),
    radius: (0.6 + 0.4 * smoothstep(0, 0.25, age)) * Math.pow(fade, 0.7),
    density: smoothstep(0, 0.05, age) * (1 - smoothstep(0.92, 1, age)),
  };
}

/** Whether a cumulus at that point of its life shows from above at all (cover's measure). */
const lifeShows = (life: ReturnType<typeof cumulusLife>) =>
  life.density >= 0.1 && life.height >= 0.05 && life.radius >= 0.05;

// The share of a cumulus's footprint at full size it covers, on average over its life, and the
// share of its height it stands at meanwhile.
const LIFE = (() => {
  const steps = 2000;
  let area = 0;
  let height = 0;
  let shown = 0;
  for (let i = 0; i < steps; i++) {
    const life = cumulusLife((i + 0.5) / steps);
    if (!lifeShows(life)) continue;
    area += life.radius * life.radius;
    height += life.height;
    shown++;
  }
  return { area: area / steps, height: height / Math.max(shown, 1) };
})();

/**
 * One grid of cumulus (see {@link cumulusGrids}), in metres and weather seconds.
 */
export type CumulusGrid = {
  /** its cells' side */
  cell: number;
  /** its clouds' least and most radius */
  least: number;
  most: number;
  /** the share of its cells holding a cloud at any time */
  occupancy: number;
  /** how long each of its clouds lives */
  lifetime: number;
  /** the share of the ground its clouds cover, on average */
  cover: number;
  /** its clouds' mean radius and height as they show, on average over their lives */
  meanRadius: number;
  meanHeight: number;
};

/**
 * The cumulus of a layer from `base` to `top` (metres over the sea) covering `cover` of the
 * ground, at `scale`: {@link CUMULUS_GRIDS} grids from the least size to the largest the layer's
 * depth holds (log-spaced), sizes falling off as the radius cubed within each (equal cover in
 * each doubling of size), each grid covering the same share. `cover` is what they reach: the
 * cells hold at most one cloud each, so a layer covers no more than some 0.5–0.6.
 */
export function cumulusGrids(
  layer: { base: number; top: number; cover: number },
  scale = 1,
): { grids: CumulusGrid[]; cover: number } {
  const thickness = Math.max(Math.abs(layer.top - layer.base), 1);
  const cover = Math.min(Math.max(layer.cover, 0), 1);
  const least = CUMULUS_LEAST;
  const most = cumulusTopRadius(thickness / scale);
  const share = 1 - Math.pow(1 - cover, 1 / CUMULUS_GRIDS);
  let clear = 1;
  const grids: CumulusGrid[] = [];
  for (let k = 0; k < CUMULUS_GRIDS; k++) {
    const r0 = least * Math.pow(most / least, k / CUMULUS_GRIDS);
    const r1 = least * Math.pow(most / least, (k + 1) / CUMULUS_GRIDS);
    // Radii falling off as r⁻³ between r0 and r1: E[r²] = c ln(r1 / r0).
    const c = 2 / (r0 ** -2 - r1 ** -2);
    const meanSquare = c * Math.log(r1 / r0);
    const cell = CUMULUS_CELL * r1;
    const footprint =
      (Math.PI * CUMULUS_BODY * CUMULUS_BODY * meanSquare * LIFE.area) / (cell * cell);
    const occupancy = Math.min(share / footprint, 1);
    const covered = occupancy * footprint;
    clear *= 1 - covered;
    const meanRadius = Math.sqrt(meanSquare);
    const meanHeight =
      Math.min(
        2 * meanRadius * cumulusAspect(2 * meanRadius),
        (thickness / scale) * 0.92,
      ) * LIFE.height;
    grids.push({
      cell: cell * scale,
      least: r0 * scale,
      most: r1 * scale,
      occupancy,
      lifetime:
        CUMULUS_LIFETIME * Math.sqrt(Math.sqrt(r0 * r1) / CUMULUS_LIFE_RADIUS),
      cover: covered,
      meanRadius: CUMULUS_BODY * meanRadius * Math.sqrt(LIFE.area) * scale,
      meanHeight: meanHeight * scale,
    });
  }
  return { grids, cover: 1 - clear };
}

/**
 * Where a grid's clock stands at `time` (weather seconds): how many of its clouds' lifetimes
 * have passed (wrapped to {@link CUMULUS_EPOCHS}) and the share of the next. In 64-bit floats,
 * so the shader's single precision holds at any time.
 */
export function cumulusEpoch(
  grid: CumulusGrid,
  time: number,
): { epoch: number; share: number } {
  const lives = time / grid.lifetime;
  const whole = Math.floor(lives);
  return {
    epoch: ((whole % CUMULUS_EPOCHS) + CUMULUS_EPOCHS) % CUMULUS_EPOCHS,
    share: lives - whole,
  };
}

/** A grid's seed: what its hashes start from (the shader's uCloudGridSeeds). */
export function cumulusGridSeed(seed: number, grid: number): number {
  return (Math.imul(seed | 0, 7919) + grid * 104729) & 0xffffff;
}

/**
 * One cumulus, as it is now: in the field's metres (its middle) and metres over the sea (its
 * base).
 */
export type Cumulus = {
  /**
   * its middle in its grid's frame: the field's, drifted with the wind and turned by
   * {@link cumulusGridTurn} (metres along the grid's cells)
   */
  x: number;
  y: number;
  /** its radius and height at full size, and its base */
  radius: number;
  height: number;
  base: number;
  /** how it stands now: a share of its life, and its height, radius and density as they are */
  age: number;
  life: ReturnType<typeof cumulusLife>;
  /** how far it leans downwind by its top, a share of the least of its height and radius */
  lean: number;
  /** where its billows are read in the noise (shares of a tile) */
  noise: [number, number, number];
};

/**
 * The cumulus of `grid` (its index `k`) in cell (`cellX`, `cellY`) at its clock `epoch` and
 * `share` ({@link cumulusEpoch}), in a layer `thickness` deep from `base`, with `seed` (the
 * grid's, {@link cumulusGridSeed}); null where it holds none.
 */
export function cumulusAt(
  grid: CumulusGrid,
  cellX: number,
  cellY: number,
  clock: { epoch: number; share: number },
  layer: { base: number; thickness: number },
  seed: number,
  scale = 1,
): Cumulus | null {
  const cx = cellX & (CUMULUS_WRAP - 1);
  const cy = cellY & (CUMULUS_WRAP - 1);
  const phase = cloudFieldShort(cloudFieldHash(cx, cy, 0, seed + SALT_PHASE));
  const at = clock.share + phase;
  const epoch = clock.epoch + Math.floor(at);
  const age = at - Math.floor(at);
  const form = cloudFieldHash(cx, cy, epoch, seed + SALT_FORM);
  if (cloudFieldShort(form) >= grid.occupancy) return null;
  const place = cloudFieldHash(cx, cy, epoch, seed + SALT_PLACE);
  const look = cloudFieldHash(cx, cy, epoch, seed + SALT_LOOK);
  // Its radius, falling off as r⁻³ across the grid's sizes.
  const r0 = grid.least;
  const r1 = grid.most;
  const u = cloudFieldByte(form, 16);
  const radius = r0 / Math.sqrt(1 - u * (1 - (r0 / r1) ** 2));
  // Its height: taller than broad the larger it is, and capped by the layer's top.
  const tall =
    2 *
    radius *
    cumulusAspect((2 * radius) / scale) *
    (0.85 + 0.3 * cloudFieldByte(form, 24));
  const cap = layer.thickness * (0.85 + 0.15 * cloudFieldByte(place, 16));
  const height = Math.min(tall, cap);
  // Where in its cell: as far from its middle as keeps it clear of the cell's margins.
  const room = Math.max(
    0.5 * grid.cell - CUMULUS_REACH * radius - CUMULUS_MARGIN * grid.cell,
    0,
  );
  return {
    x: (cellX + 0.5) * grid.cell + (2 * cloudFieldByte(place, 0) - 1) * room,
    y: (cellY + 0.5) * grid.cell + (2 * cloudFieldByte(place, 8) - 1) * room,
    radius,
    height,
    base:
      layer.base +
      (cloudFieldByte(place, 24) - 0.5) *
        Math.min(60 * scale, 0.05 * layer.thickness),
    age,
    life: cumulusLife(age),
    lean: 0.1 * cloudFieldByte(look, 0),
    noise: [
      cloudFieldByte(look, 8),
      cloudFieldByte(look, 16),
      cloudFieldByte(look, 24),
    ],
  };
}

/**
 * Whether the ground at (`x`, `y`) on the field lies under `cloud` as {@link cumulusGrids}
 * counts it: within its body ({@link CUMULUS_BODY}) as it is now, while it shows.
 */
export function cumulusCovers(cloud: Cumulus, x: number, y: number): boolean {
  if (!lifeShows(cloud.life)) return false;
  const r = CUMULUS_BODY * cloud.radius * cloud.life.radius;
  const dx = x - cloud.x;
  const dy = y - cloud.y;
  return dx * dx + dy * dy <= r * r;
}

/** The strato field's octaves (the shader's CLOUD_STRATO_OCTAVES). */
export const STRATO_OCTAVES = 5;
/** The broadest octave's period across the wind (metres, at scale 1). */
export const STRATO_PERIOD = 24000;
/** How much longer its veils are along the wind than across it. */
export const STRATO_STRETCH = 3;
/** Each octave's period over the next's, and its weight over the one before's. */
export const STRATO_LACUNARITY = 2;
export const STRATO_GAIN = 0.5;
/** How long its pattern lasts (weather seconds): the broadest octave's, each finer twice as fast. */
export const STRATO_LIFETIME = 7200;
/** How far the warp moves where the field is read (in its broadest octave's periods). */
export const STRATO_WARP = 0.35;
/** The edge's softness, in the field's standard deviations: soft veils. */
export const STRATO_EDGE = 0.45;

// Each octave turned from the one before, so their lattices never line up.
const turnOf = (octave: number) => 1.1 * octave + 0.3;

/**
 * An octave of the strato field (`octave` 0 the broadest; −1 the warp): the matrix taking a
 * point on the field (in the broadest octave's periods, along and across the wind) to its
 * cells (column-major 2 × 2), and its weight.
 */
export function stratoOctave(octave: number): {
  matrix: [number, number, number, number];
  weight: number;
} {
  const scale = octave < 0 ? 0.5 : Math.pow(STRATO_LACUNARITY, octave);
  const turn = turnOf(octave + 1);
  const c = Math.cos(turn) * scale;
  const s = Math.sin(turn) * scale;
  return {
    matrix: [c, s, -s, c],
    weight: octave < 0 ? 1 : Math.pow(STRATO_GAIN, octave),
  };
}

/**
 * Where octave `octave` of the strato field lies at weather `time` as it drifts by
 * (`driftAlong`, `driftAcross`: the wind's run so far along and across itself, in the broadest
 * octave's periods), and changes: what is added to its cells (xy, wrapped to the value noise's
 * period) and its place through the noise (z).
 */
export function stratoOctaveShift(
  octave: number,
  driftAlong: number,
  driftAcross: number,
  time: number,
): [number, number, number] {
  const { matrix } = stratoOctave(octave);
  const offset = 17.31 * (octave + 2);
  const x = matrix[0] * driftAlong + matrix[2] * driftAcross;
  const y = matrix[1] * driftAlong + matrix[3] * driftAcross;
  const speed = octave < 0 ? 0.5 : Math.pow(STRATO_LACUNARITY, octave);
  return [
    wrap289(offset - x),
    wrap289(0.61 * offset - y),
    wrap289((time / STRATO_LIFETIME) * speed + 0.37 * offset),
  ];
}

const wrap289 = (x: number) => x - Math.floor(x / 289) * 289;

/**
 * The strato field at (`along`, `across`) (in its broadest octave's periods) with each octave's
 * shift ({@link stratoOctaveShift}; `shifts[0]` the warp's, then the octaves'), its `octaves`
 * weighed in as far as `kept` (one weight each; default all): about 0.5, its spread
 * {@link stratoStatistics}. The twin of `stratoField` in `cloud-field.glsl`.
 */
export function stratoField(
  along: number,
  across: number,
  shifts: readonly (readonly [number, number, number])[],
  kept?: readonly number[],
): number {
  const warp = stratoOctave(-1).matrix;
  const ws = shifts[0];
  const wx = warp[0] * along + warp[2] * across + ws[0];
  const wy = warp[1] * along + warp[3] * across + ws[1];
  const a = along + STRATO_WARP * (cloudValueNoise(wx, wy, ws[2]) - 0.5);
  const b =
    across + STRATO_WARP * (cloudValueNoise(wy + 31.7, wx + 11.3, ws[2]) - 0.5);
  let sum = 0;
  let total = 0;
  for (let o = 0; o < STRATO_OCTAVES; o++) {
    const { matrix, weight } = stratoOctave(o);
    const s = shifts[o + 1];
    const w = weight * (kept ? kept[o] : 1);
    total += weight;
    if (w <= 0) continue;
    const x = matrix[0] * a + matrix[2] * b + s[0];
    const y = matrix[1] * a + matrix[3] * b + s[1];
    sum += w * (cloudValueNoise(x, y, s[2]) - 0.5);
  }
  return 0.5 + sum / total;
}

/**
 * The strato field's measured distribution: its mean, its standard deviation, the variance of
 * one octave of unit weight (what a footprint loses as it drops octaves), and its quantiles at
 * sixteenths (17, from its least to its most).
 */
export function stratoStatistics(): {
  mean: number;
  deviation: number;
  octaveVariance: number;
  quantiles: number[];
} {
  if (statistics) return statistics;
  const shifts = Array.from({ length: STRATO_OCTAVES + 1 }, (_, o) =>
    stratoOctaveShift(o - 1, 0, 0, 0),
  );
  const values: number[] = [];
  const single: number[] = [];
  const n = 96;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      // A broad stretch of the field, off the lattices.
      const x = (i + 0.37) * 0.53;
      const y = (j + 0.71) * 0.53;
      values.push(stratoField(x, y, shifts));
      single.push(cloudValueNoise(x * 3.1 + 5.3, y * 3.1 + 2.9, 0.5));
    }
  const meanOf = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const varianceOf = (a: number[], m: number) =>
    a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length;
  const mean = meanOf(values);
  const deviation = Math.sqrt(varianceOf(values, mean));
  const octaveVariance = varianceOf(single, meanOf(single));
  values.sort((p, q) => p - q);
  const quantiles = Array.from({ length: 17 }, (_, i) =>
    i === 16
      ? values[values.length - 1]
      : values[Math.floor((i / 16) * values.length)],
  );
  statistics = { mean, deviation, octaveVariance, quantiles };
  return statistics;
}
let statistics: ReturnType<typeof stratoStatistics> | null = null;

/** The level the strato field must pass for `cover` of the ground to lie under it. */
export function stratoThreshold(cover: number): number {
  const { quantiles } = stratoStatistics();
  const c = Math.min(Math.max(cover, 0), 1);
  if (c <= 0) return quantiles[16] + 1;
  if (c >= 1) return quantiles[0] - 1;
  const x = (1 - c) * 16;
  const i = Math.min(Math.floor(x), 15);
  return quantiles[i] + (quantiles[i + 1] - quantiles[i]) * (x - i);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
