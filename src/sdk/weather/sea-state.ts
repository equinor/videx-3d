import { seaHexTiles } from './sea-hex';
import {
  SEA_BREAK_DEPTH,
  seaShallowFactors,
  type SeaShallowLayer,
} from './sea-shallow';
import {
  coxMunkSlopeVariance,
  frictionVelocity,
  SEA_G,
  seaSpectrum,
  type SeaSpectrum,
  type SeaSpectrumInput,
  shortWaveStrength,
} from './sea-spectrum';

/**
 * One layer of the sea's waves: the waves on a square tile `size` metres across, turned by
 * `angle` (radians) in the wave plane, with wavenumbers in [kMin, kMax). Each wave lies on
 * the tile's grid, k = R(angle)·(2π/size)·(n, m), so the layer tiles exactly and can be drawn
 * into a texture `texels` across, at least 4 texels a wavelength.
 *
 * @group Weather
 */
export type SeaLayer = {
  size: number;
  angle: number;
  texels: number;
  kMin: number;
  kMax: number;
  /** how many waves it draws at most */
  waves: number;
};

/** A layer's size and how many waves it draws, before its band is worked out. */
export type SeaLayerSpec = {
  size: number;
  texels: number;
  waves: number;
};

// The long layers every preset draws: tiles of incommensurate sizes, turned apart by the golden
// angle, so no two lattices line up.
const SEA_LAYERS_LONG: readonly SeaLayerSpec[] = [
  { size: 2011, texels: 128, waves: 256 },
  { size: 307, texels: 128, waves: 256 },
  { size: 47, texels: 128, waves: 256 },
];

/**
 * The layers of `medium`: the long layers, and a 7.3 m one for the waves from 1.5 m down to a
 * quarter of a metre, the ripples close up.
 */
const SEA_LAYERS_MEDIUM: readonly SeaLayerSpec[] = [
  ...SEA_LAYERS_LONG,
  { size: 7.3, texels: 128, waves: 256 },
];

/**
 * How much a sea draws of its waves: `low` its long layers on coarser tiles and no ripples,
 * `medium` down to waves a quarter of a metre long, `high` the detail octave below that, for
 * close up (to some 4 cm), `ultra` three times the waves a layer, each band drawn fuller.
 * `medium` is sized for a mid-range laptop's integrated GPU.
 *
 * @group Weather
 */
export type WaterQuality = 'low' | 'medium' | 'high' | 'ultra';

/** What a {@link WaterQuality} draws: its layers, and whether the detail octave below them. */
export type WaterQualitySpec = {
  layers: readonly SeaLayerSpec[];
  /** the finest layer read again {@link SEA_DETAIL_SCALE} times smaller ({@link SeaState.detail}) */
  detail: boolean;
  /**
   * the most the layers' tiles are filtered along a pixel's footprint (anisotropic filtering):
   * sharper waves toward grazing, where a filter over the footprint's longer axis blurs them
   * into a mirror. Default 1: over the longer axis
   */
  anisotropy?: number;
};

/** What each {@link WaterQuality} draws. */
export const WATER_QUALITY: Readonly<Record<WaterQuality, WaterQualitySpec>> = {
  low: {
    layers: SEA_LAYERS_LONG.map(({ size }) => ({
      size,
      texels: 64,
      waves: 128,
    })),
    detail: false,
  },
  medium: { layers: SEA_LAYERS_MEDIUM, detail: false },
  high: { layers: SEA_LAYERS_MEDIUM, detail: true, anisotropy: 4 },
  // High's bands with three times the waves: a band's spectrum sampled more finely. Its tiles
  // at 256 texels (384 waves) widened each band fourfold for 1.5 times the waves, which left
  // a missing octave between the layers and fewer, stronger waves (2026-11-18).
  ultra: {
    layers: SEA_LAYERS_MEDIUM.map(({ size, texels }) => ({
      size,
      texels,
      waves: 768,
    })),
    detail: true,
    anisotropy: 8,
  },
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * The detail octave: the finest layer's tile read this many times smaller (about the ratio of
 * one layer's size to the next), for the ripples below its band, at no bake of its own.
 */
const SEA_DETAIL_SCALE = 6.4;
// The detail octave's slope variance over its finest layer's, at most.
const DETAIL_RATIO_LIMIT = 4;
// The shortest waves reckoned with (rad/m): about a millimetre.
const SHORT_WAVE_K_MAX = 6000;

/** The layers `specs` make: each one's band from the last's top to its own 4-texel limit. */
function seaLayers(specs: readonly SeaLayerSpec[]): SeaLayer[] {
  let kMin = 0;
  return specs.map((spec, i) => {
    const kMax = (2 * Math.PI * (spec.texels / 4)) / spec.size;
    const layer = {
      size: spec.size,
      angle: (i * GOLDEN_ANGLE) % (2 * Math.PI),
      texels: spec.texels,
      kMin,
      kMax,
      waves: spec.waves,
    };
    kMin = kMax;
    return layer;
  });
}

/**
 * How the sea answers a change: each wave's amplitude eases toward the spectrum's over
 * `response` of its own periods (e-folding). 3: a new wind sea in a minute or two (the
 * default); some 900: as at sea, hours for its longest waves. A swell's waves, long, follow
 * slowest.
 */
const SEA_RESPONSE_ACCELERATED = 3;

export type SeaStateOptions = {
  layers?: readonly SeaLayerSpec[];
  /** the detail octave below the finest layer ({@link SeaState.detail}). Default false */
  detail?: boolean;
  response?: number;
  /** another seed is another sea: other phases and amplitudes on the same grids */
  seed?: number;
  /** read each layer's tile hex-tiled (`sea-hex.ts`), so it never repeats. Default true */
  hex?: boolean;
};

// A wave that has eased out below this share of its layer's strongest target leaves the pool.
const GONE = 1e-3;
// Waves leaving ease out this much faster than the sea answers otherwise.
const LEAVE_RATE = 2;

// A deterministic hash of three integers to [0, 1).
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

type Candidates = {
  kx: Float64Array;
  kz: Float64Array;
  // the wavenumber, |(kx, kz)|
  k: Float64Array;
  omega: Float64Array;
  // amplitude factor: Rayleigh, mean square 1, so the sea is not a regular sum
  rayleigh: Float64Array;
  phase: Float64Array;
  target: Float64Array;
};

type Pool = {
  // index into the candidates, −1 for a free slot
  index: Int32Array;
  amplitude: Float64Array;
  leaving: Uint8Array;
};

/**
 * Per layer, the waves to draw this frame: four floats each, (kx, kz, a·cos φ, a·sin φ), the
 * height they add at x being a·cos(k·x + φ). `count` of them are in use.
 *
 * @group Weather
 */
export type SeaLayerTable = {
  layer: SeaLayer;
  data: Float32Array;
  count: number;
};

/** What a sea state holds now: its waves' statistics, kept and left out. */
export type SeaStateStats = {
  /** 4·√(height variance) of the waves drawn, metres */
  significantHeight: number;
  /** of the spectrum asked for */
  targetHeight: number;
  /** per layer: height variance and slope variance (both axes summed) of its waves drawn */
  layers: { variance: number; slopeVariance: number }[];
  /**
   * The detail octave ({@link SeaState.detail}): the gain on the finest layer's slopes as it
   * reads them, the slope variance that gives, and its tile point's shift now, [0, 1) — its
   * ripples drifting downwind at their own speed. All 0 where it is not drawn.
   */
  detail: { gain: number; slopeVariance: number; offset: [number, number] };
  /** slope variance no wave stands for, the smallest waves' included (Cox and Munk) */
  residualSlopeVariance: number;
};

/**
 * The sea's waves as they develop: the spectrum the wind and swells ask for, drawn as a few
 * hundred waves on each layer's fixed grid. A wave's length and direction never change, so
 * neither do its speed and phase: the wind only eases amplitudes toward its spectrum, waves
 * growing where it now blows and dying away where it no longer does. Phases follow the clock
 * alone, φ = φ₀ − ω·t, so two seas on the same clock and seed are the same sea.
 *
 * The pool of waves a layer draws is the steepest its spectrum asks for (and has): those with
 * the most slope (amplitude × wavenumber), so each layer is drawn to its band's short end; a
 * wave leaves only once it has eased out, and one asked for joins at no amplitude, so nothing
 * pops.
 *
 * @group Weather
 */
export class SeaState {
  readonly layers: SeaLayer[];
  /**
   * The detail octave, where drawn (`SeaStateOptions.detail`): the finest layer's tile
   * {@link SEA_DETAIL_SCALE} times smaller, turned apart from it, standing for the ripples in
   * the band below it (`kMin` to `kMax`). It draws no waves of its own (`waves` 0): the
   * surface reads the finest layer's texture again, scaled by the gain {@link SeaState.stats}
   * gives. Null where not drawn.
   */
  readonly detail: SeaLayer | null;
  readonly response: number;
  readonly seed: number;
  /** each layer's tile read hex-tiled, as the surface reads it */
  readonly hex: boolean;
  /** seconds on the sea's clock */
  time = 0;

  private spectrum: SeaSpectrum | null = null;
  // the detail octave's slope variance over its finest layer's: as drawn, easing toward the
  // spectrum's as the waves do
  private detailRatio = 0;
  private detailTarget = 0;
  private readonly candidates: Candidates[];
  private readonly pools: Pool[];
  private readonly tables: SeaLayerTable[];
  // per layer: the gain on its targets keeping its band's height variance
  private readonly gains: number[];
  private readonly strongest: number[];
  private readonly orders: number[][];
  // Counts the changes to the waves' amplitudes, so their statistics are worked out once a
  // change (heightAtDepth's, per point).
  private revision = 0;
  private statsRevision = -1;
  private layerStats: SeaShallowLayer[] = [];
  private readonly shallow: number[] = [];

  constructor(input: SeaSpectrumInput, options: SeaStateOptions = {}) {
    this.layers = seaLayers(options.layers ?? SEA_LAYERS_MEDIUM);
    const finest = this.layers[this.layers.length - 1];
    this.detail = options.detail
      ? {
          size: finest.size / SEA_DETAIL_SCALE,
          angle: (finest.angle + GOLDEN_ANGLE) % (2 * Math.PI),
          texels: finest.texels,
          kMin: finest.kMax,
          kMax: finest.kMax * SEA_DETAIL_SCALE,
          waves: 0,
        }
      : null;
    this.response = options.response ?? SEA_RESPONSE_ACCELERATED;
    this.seed = options.seed ?? 0;
    this.hex = options.hex ?? true;
    this.candidates = this.layers.map((layer, i) => this.grid(layer, i));
    this.pools = this.layers.map(layer => ({
      index: new Int32Array(layer.waves).fill(-1),
      amplitude: new Float64Array(layer.waves),
      leaving: new Uint8Array(layer.waves),
    }));
    this.tables = this.layers.map(layer => ({
      layer,
      data: new Float32Array(layer.waves * 4),
      count: 0,
    }));
    this.gains = this.layers.map(() => 1);
    this.strongest = this.layers.map(() => 0);
    this.orders = this.layers.map(() => []);
    this.setInput(input);
    this.settle();
  }

  /**
   * Every wave at its target at once, as if the wind had blown so all along: for a sea first
   * drawn, or a clock set rather than run.
   */
  settle(): void {
    this.revision++;
    this.detailRatio = this.detailTarget;
    this.layers.forEach((_, l) => {
      const cand = this.candidates[l];
      const pool = this.pools[l];
      for (let s = 0; s < pool.index.length; s++) {
        if (pool.leaving[s]) {
          pool.index[s] = -1;
          pool.leaving[s] = 0;
        }
        pool.amplitude[s] = 0;
      }
      const inPool = new Set<number>();
      for (const i of pool.index) if (i >= 0) inPool.add(i);
      this.fill(l, this.wanted(l), inPool);
      for (let s = 0; s < pool.index.length; s++) {
        const i = pool.index[s];
        if (i >= 0) pool.amplitude[s] = cand.target[i] * this.gains[l];
      }
    });
  }

  // Every grid point in a layer's band, with its fixed random amplitude factor and phase.
  private grid(layer: SeaLayer, layerIndex: number): Candidates {
    const dk = (2 * Math.PI) / layer.size;
    const reach = Math.ceil(layer.kMax / dk);
    const c = Math.cos(layer.angle);
    const s = Math.sin(layer.angle);
    const kx: number[] = [];
    const kz: number[] = [];
    const ks: number[] = [];
    const rayleigh: number[] = [];
    const phase: number[] = [];
    for (let n = -reach; n <= reach; n++)
      for (let m = -reach; m <= reach; m++) {
        const k = dk * Math.hypot(n, m);
        if (k < layer.kMin || k >= layer.kMax || k === 0) continue;
        kx.push(dk * (c * n - s * m));
        kz.push(dk * (s * n + c * m));
        ks.push(k);
        const u = Math.max(hash3(layerIndex * 7919 + n, m, this.seed), 1e-12);
        // |a| of a complex Gaussian: Rayleigh, E[r²] = 1.
        rayleigh.push(Math.sqrt(-Math.log(u)));
        phase.push(
          2 * Math.PI * hash3(n, layerIndex * 104729 + m, this.seed + 1),
        );
      }
    const count = kx.length;
    const omega = new Float64Array(count);
    for (let i = 0; i < count; i++) omega[i] = Math.sqrt(SEA_G * ks[i]);
    return {
      kx: Float64Array.from(kx),
      kz: Float64Array.from(kz),
      k: Float64Array.from(ks),
      omega,
      rayleigh: Float64Array.from(rayleigh),
      phase: Float64Array.from(phase),
      target: new Float64Array(count),
    };
  }

  /** What the sea develops toward from now on: the wind and swells. */
  setInput(input: SeaSpectrumInput): void {
    this.revision++;
    const spectrum = seaSpectrum(input);
    this.spectrum = spectrum;
    this.layers.forEach((layer, l) => {
      const cand = this.candidates[l];
      const dk = (2 * Math.PI) / layer.size;
      const cell = dk * dk;
      let strongest = 0;
      for (let i = 0; i < cand.kx.length; i++) {
        const variance = spectrum.density(cand.kx[i], cand.kz[i]) * cell;
        // a²/2 = variance, times the wave's own Rayleigh factor.
        const a = Math.sqrt(2 * variance) * cand.rayleigh[i];
        cand.target[i] = a;
        if (a > strongest) strongest = a;
      }
      this.strongest[l] = strongest;
      this.select(l, spectrum);
    });
    // The detail octave's band, over the slope variance its finest layer draws once eased.
    const detail = this.detail;
    if (!detail) {
      this.detailTarget = 0;
      return;
    }
    const l = this.layers.length - 1;
    const cand = this.candidates[l];
    let drawn = 0;
    for (const i of this.orders[l]) {
      const a = cand.target[i] * this.gains[l];
      drawn +=
        0.5 * a * a * (cand.kx[i] * cand.kx[i] + cand.kz[i] * cand.kz[i]);
    }
    this.detailTarget =
      drawn > 0
        ? Math.min(
            spectrum.slopeVariance(detail.kMin, detail.kMax) / drawn,
            DETAIL_RATIO_LIMIT,
          )
        : 0;
  }

  // The steepest targets this layer has room for, steepest first: sorted as the targets change.
  private wanted(l: number): number[] {
    return this.orders[l];
  }

  // The steepest targets this layer has room for join (amplitude × wavenumber, their slope);
  // those no longer among them ease out. Chosen by height, the strongest were the band's
  // longest, and its short end went undrawn: no wave in the top third of an octave or more of
  // each layer's band (2026-11-18), which slopes show.
  private select(l: number, spectrum: SeaSpectrum): void {
    const layer = this.layers[l];
    const cand = this.candidates[l];
    const pool = this.pools[l];
    const order = Array.from(cand.target.keys())
      .filter(i => cand.target[i] > 0)
      .sort((a, b) => cand.target[b] * cand.k[b] - cand.target[a] * cand.k[a])
      .slice(0, layer.waves);
    this.orders[l] = order;
    const wanted = new Set(order);
    // The band's height variance kept by the waves wanted, against the spectrum's own: their
    // targets are scaled to it, so the sea is as high as asked however few waves draw it.
    let kept = 0;
    for (const i of order) kept += 0.5 * cand.target[i] * cand.target[i];
    const band = spectrum.variance(layer.kMin, layer.kMax);
    this.gains[l] = kept > 0 ? Math.min(Math.sqrt(band / kept), 1.5) : 1;

    const inPool = new Set<number>();
    for (let s = 0; s < layer.waves; s++) {
      const i = pool.index[s];
      if (i < 0) continue;
      inPool.add(i);
      pool.leaving[s] = wanted.has(i) ? 0 : 1;
    }
    this.fill(l, order, inPool);
  }

  // Free slots taken by wanted waves not yet drawn, strongest first, at no amplitude.
  private fill(l: number, order: number[], inPool: Set<number>): void {
    const pool = this.pools[l];
    let next = 0;
    for (let s = 0; s < pool.index.length; s++) {
      if (pool.index[s] >= 0) continue;
      while (next < order.length && inPool.has(order[next])) next++;
      if (next >= order.length) break;
      pool.index[s] = order[next];
      pool.amplitude[s] = 0;
      pool.leaving[s] = 0;
      inPool.add(order[next]);
    }
  }

  /** Run the sea's clock `dt` seconds on: amplitudes ease toward their targets. */
  update(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    this.revision++;
    // The detail octave eases as its band's waves would, over `response` of their periods.
    if (this.detail) {
      const k = Math.sqrt(this.detail.kMin * this.detail.kMax);
      const tau = (this.response * 2 * Math.PI) / Math.sqrt(SEA_G * k);
      this.detailRatio +=
        (this.detailTarget - this.detailRatio) * (1 - Math.exp(-dt / tau));
    }
    let freed = false;
    this.layers.forEach((_, l) => {
      const cand = this.candidates[l];
      const pool = this.pools[l];
      const gain = this.gains[l];
      const gone = GONE * this.strongest[l] * gain;
      for (let s = 0; s < pool.index.length; s++) {
        const i = pool.index[s];
        if (i < 0) continue;
        const leaving = pool.leaving[s] === 1;
        const target = leaving ? 0 : cand.target[i] * gain;
        const period = (2 * Math.PI) / cand.omega[i];
        const tau = (this.response * period) / (leaving ? LEAVE_RATE : 1);
        pool.amplitude[s] +=
          (target - pool.amplitude[s]) * (1 - Math.exp(-dt / tau));
        if (leaving && pool.amplitude[s] <= gone) {
          pool.index[s] = -1;
          pool.amplitude[s] = 0;
          pool.leaving[s] = 0;
          freed = true;
        }
      }
    });
    // Slots freed: the waves still waiting join.
    if (freed)
      this.layers.forEach((_, l) => {
        const pool = this.pools[l];
        const inPool = new Set<number>();
        for (const i of pool.index) if (i >= 0) inPool.add(i);
        this.fill(l, this.wanted(l), inPool);
      });
  }

  /**
   * Each layer's waves now, for the GPU: (kx, kz, a·cos φ, a·sin φ) per wave, φ = φ₀ − ω·t.
   * Reused between calls.
   */
  layerTables(): readonly SeaLayerTable[] {
    this.layers.forEach((_, l) => {
      const cand = this.candidates[l];
      const pool = this.pools[l];
      const table = this.tables[l];
      let n = 0;
      for (let s = 0; s < pool.index.length; s++) {
        const i = pool.index[s];
        if (i < 0 || pool.amplitude[s] <= 0) continue;
        const phi = cand.phase[i] - cand.omega[i] * this.time;
        const a = pool.amplitude[s];
        table.data[n * 4] = cand.kx[i];
        table.data[n * 4 + 1] = cand.kz[i];
        table.data[n * 4 + 2] = a * Math.cos(phi);
        table.data[n * 4 + 3] = a * Math.sin(phi);
        n++;
      }
      table.data.fill(0, n * 4);
      table.count = n;
    });
    return this.tables;
  }

  /**
   * The sea's height at (x, z) of the wave plane now, as it is drawn, metres; or only layer
   * `layer`'s. Each layer's tile is read as the surface reads it: hex-tiled
   * ({@link seaHexTiles}) unless `hex` is off. In double precision.
   */
  heightAt(x: number, z: number, layer?: number): number {
    let h = 0;
    this.layers.forEach((tile, l) => {
      if (layer !== undefined && l !== layer) return;
      if (!this.hex) {
        h += this.tileHeightAt(l, x, z);
        return;
      }
      const c = Math.cos(tile.angle);
      const s = Math.sin(tile.angle);
      const u = (c * x + s * z) / tile.size;
      const v = (-s * x + c * z) / tile.size;
      const { offsets, weights } = seaHexTiles(u, v, l);
      let sum = 0;
      let w2 = 0;
      for (let i = 0; i < 3; i++) {
        const [ou, ov] = offsets[i];
        // The copy's shift, from tile units back into the wave plane.
        const dx = (c * ou - s * ov) * tile.size;
        const dz = (s * ou + c * ov) * tile.size;
        sum += weights[i] * this.tileHeightAt(l, x + dx, z + dz);
        w2 += weights[i] * weights[i];
      }
      h += sum / Math.sqrt(w2);
    });
    return h;
  }

  /**
   * The sea's height at (x, z) of the wave plane now over water `depth` deep (m), as it is
   * drawn: each layer's waves by their share left there ({@link seaShallowFactors}: shoaled,
   * and held under the depth over `breakDepth`), as the surface's shaders cut them. 0 at no
   * depth; {@link SeaState.heightAt} in deep water.
   */
  heightAtDepth(
    x: number,
    z: number,
    depth: number,
    breakDepth = SEA_BREAK_DEPTH,
  ): number {
    if (this.statsRevision !== this.revision) {
      this.layerStats = this.stats().layers;
      this.statsRevision = this.revision;
    }
    const f = seaShallowFactors(
      depth,
      this.layerStats,
      breakDepth,
      this.shallow,
    );
    let h = 0;
    for (let l = 0; l < f.length; l++) {
      if (f[l] > 0) h += f[l] * this.heightAt(x, z, l);
    }
    return h;
  }

  /**
   * Layer `layer`'s tile at (x, z) of the wave plane now, metres: its waves summed as the bake
   * sums them, repeating with the tile.
   */
  tileHeightAt(layer: number, x: number, z: number): number {
    let h = 0;
    const cand = this.candidates[layer];
    const pool = this.pools[layer];
    for (let s = 0; s < pool.index.length; s++) {
      const i = pool.index[s];
      if (i < 0) continue;
      const a = pool.amplitude[s];
      if (a <= 0) continue;
      h +=
        a *
        Math.cos(
          cand.kx[i] * x +
            cand.kz[i] * z +
            cand.phase[i] -
            cand.omega[i] * this.time,
        );
    }
    return h;
  }

  /**
   * How the short waves answer a local wind (a gust, a lull): per wind `factors` on the mean,
   * the slope variance of the waves from `kMin` (rad/m) up over the mean wind's. Only the short
   * waves' strength follows the local wind's friction velocity; the long waves stay as the
   * mean wind raised them. All 1 in a calm.
   */
  shortWaveRatios(factors: readonly number[], kMin: number): number[] {
    const spectrum = this.spectrum;
    const windSpeed = spectrum?.input.windSpeed ?? 0;
    const total = spectrum?.slopeVariance(kMin, SHORT_WAVE_K_MAX) ?? 0;
    if (!spectrum || !(windSpeed > 0) || !(total > 0))
      return factors.map(() => 1);
    const short = spectrum.shortSlopeVariance(kMin, SHORT_WAVE_K_MAX);
    const alpha = shortWaveStrength(frictionVelocity(windSpeed));
    return factors.map(g => {
      const local = shortWaveStrength(frictionVelocity(windSpeed * g));
      return Math.max(total + short * (local - alpha), 0) / total;
    });
  }

  /** The waves' statistics now: what is drawn, and what no wave stands for. */
  stats(): SeaStateStats {
    let variance = 0;
    let drawnSlope = 0;
    const layers = this.layers.map((_, l) => {
      const cand = this.candidates[l];
      const pool = this.pools[l];
      let v = 0;
      let sv = 0;
      for (let s = 0; s < pool.index.length; s++) {
        const i = pool.index[s];
        if (i < 0) continue;
        const a = pool.amplitude[s];
        const k2 = cand.kx[i] * cand.kx[i] + cand.kz[i] * cand.kz[i];
        v += 0.5 * a * a;
        sv += 0.5 * a * a * k2;
      }
      variance += v;
      drawnSlope += sv;
      return { variance: v, slopeVariance: sv };
    });
    const input = this.spectrum?.input;
    // The detail octave follows its finest layer as that eases, at the spectrum's ratio.
    const finest = layers[layers.length - 1];
    const detailSlope = this.detailRatio * finest.slopeVariance;
    drawnSlope += detailSlope;
    return {
      significantHeight: 4 * Math.sqrt(variance),
      targetHeight: this.spectrum?.significantHeight ?? 0,
      layers,
      detail: {
        gain: Math.sqrt(this.detailRatio),
        slopeVariance: detailSlope,
        offset: this.detailOffset(),
      },
      residualSlopeVariance: Math.max(
        coxMunkSlopeVariance(input?.windSpeed ?? 0) - drawnSlope,
        0,
      ),
    };
  }

  // Ripples drift downwind at their phase speed (in the middle of their band), as the detail
  // octave's tile point shifts: back along that, in its turned tile, wrapped.
  private detailOffset(): [number, number] {
    const input = this.spectrum?.input;
    if (!input || !this.detail) return [0, 0];
    const [wx, wz] = input.windDirection;
    const length = Math.hypot(wx, wz);
    if (!(length > 0)) return [0, 0];
    const { size, angle, kMin, kMax } = this.detail;
    const speed = Math.sqrt(SEA_G / Math.sqrt(kMin * kMax));
    const dx = ((wx / length) * speed * this.time) / size;
    const dz = ((wz / length) * speed * this.time) / size;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const u = -(c * dx + s * dz);
    const v = -(-s * dx + c * dz);
    return [u - Math.floor(u), v - Math.floor(v)];
  }
}
