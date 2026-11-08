// The thermals of an atmosphere's clouds (atmosphere.ts) about a square, listed for the clouds'
// bake (CloudAtmosphereVolume, scenery-cloud-atmosphere.ts): every bubble alive at a time, where
// it is, how big and how much of its water it keeps, from its thermal's life read from the
// atmosphere's table as the bake reads it; and binned by where they reach, so the bake looks at
// the few bubbles about each texel instead of every thermal near it. With the patches of moisture
// and heating the air and the thermals have, as a repeating map.

import {
  ATMOSPHERE_LEVELS,
  ATMOSPHERE_MOISTURE,
  ATMOSPHERE_STEP,
  ATMOSPHERE_TIME_STEP,
  bubbleShape,
  settledHeight,
  sheetSpread,
  THERMAL_GROWTH,
  THERMAL_MIXING,
  THERMAL_PULSE,
  THERMAL_PULSES,
  THERMAL_SPREAD,
  THERMAL_TURRET,
  thermalRadius,
} from './atmosphere';

/**
 * The two grids of thermals: their cells' sides (m), the strengths their thermals span, how
 * likely a cell starts one (times the heating), and the period it starts a new one in (s; each
 * lives its life and gives way to its cell's next within two). The small ones many, the large
 * ones few; where the heating is strong, both.
 *
 * @group Weather
 */
export const THERMAL_GRIDS: readonly {
  cell: number;
  strengths: readonly [number, number];
  likely: number;
  period: number;
}[] = [
  { cell: 900, strengths: [0, 0.5], likely: 0.9, period: 2400 },
  { cell: 4000, strengths: [0.45, 1], likely: 0.5, period: 3600 },
];
/** The farthest the shear carries a bubble downwind of its source (m), eased to it. */
export const THERMAL_LEAN_MOST = 6000;
/**
 * A thermal's path: tilted up to this much from straight up (the sideways metres per metre
 * risen: some 15°), and wandering about that by up to this many of its radii, a few radii of
 * rise a swing.
 */
export const THERMAL_TILT = 0.27;
export const THERMAL_WANDER = 0.5;
/**
 * The most sources a thermal rises from: a cluster that merges as it grows, of turrets at most
 * THERMAL_TURRET broad (atmosphere.ts) over its whole breadth; the broader, the more.
 */
export const THERMAL_SOURCES = 12;
// How much of a thermal's breadth its turrets fill, by their area.
const TURRET_FILL = 0.6;
/** How far a bubble reaches, in its radii: its billows move its edge out by 30 % at most (√2.05). */
export const BUBBLE_REACH = Math.sqrt(2.05);
/**
 * A sheet's shape, fully spread (less as far as it has spread): its outline swings out and in by
 * up to this share of its radius across, in two and three broad lobes; its top and base rise and
 * fall by up to this share of its radius up, in cells a few times its thickness across.
 */
export const SHEET_LOBES = 0.35;
export const SHEET_LUMPS = 0.6;

/**
 * How far a bubble of radius `across` and `up` (m) that was `r` (m) before it spread reaches
 * across and up (m): BUBBLE_REACH of its radii, a sheet's widened by its lobes and lumps
 * (SHEET_LOBES, SHEET_LUMPS) as far as it has spread. Where the bake looks for it.
 *
 * @group Weather
 */
export function bubbleReach(across: number, up: number, r: number): [number, number] {
  const sheet = Math.min(Math.max((across / r - 1) / THERMAL_SPREAD, 0), 1);
  return [
    BUBBLE_REACH * across * (1 + SHEET_LOBES * sheet),
    BUBBLE_REACH * up * (1 + SHEET_LUMPS * sheet),
  ];
}
/** Floats a bubble takes in a {@link BubbleField}. */
export const BUBBLE_FLOATS = 12;
/** The patches' broadest (m): the veils' breadth, and the heating's clusters. */
export const PATCHES_SCALE = 8000;
/** The patches' map: its texels each way, and the distance it repeats over (m). */
export const PATCHES_SIZE = 256;
export const PATCHES_PERIOD = 64000;

/**
 * The bubbles alive about a square at a time ({@link thermalBubbles}): `count` of them in
 * `bubbles`, BUBBLE_FLOATS each: the middle's east and north (m, about the square's middle) and
 * height (m), the row of its thermal's strength in the atmosphere's table; its radius across
 * and up (m), the share it keeps of its water over the air's about it, and its radius before it
 * spread (m: its billows' scale); where in the shape volume its billows are taken from (three
 * shares of its side, 0 to 8: its own, from its thermal and its place in the train, the same
 * at every time), and how fresh it is (1 while it rises, less as it mixes away).
 *
 * @group Weather
 */
export type BubbleField = { bubbles: Float32Array; count: number };

/** What {@link thermalBubbles} lists the bubbles for. */
export type ThermalFieldSettings = {
  /** half the square's side (m) */
  half: number;
  /** the time (s) */
  time: number;
  seed: number;
  /** how strongly the surface heats the air, and how patchy it is (Atmosphere) */
  heating: number;
  patchiness: number;
  /** the way the mixed layer's wind blows toward (east, north; a unit), and its speed (m/s) */
  east: number;
  north: number;
  speed: number;
  /** the shear over the mixed layer (m/s per m), and the mixed layer's top (m) */
  shear: number;
  mixedTop: number;
};

// An integer hash: each input mixed in after the last (lowbias32's mix), so no two cells share
// one; and a byte of it as a share (0 to 1).
function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function hash(x: number, y: number, z: number, seed: number): number {
  return mix(mix(mix(mix(seed | 0) ^ (x | 0)) ^ (y | 0)) ^ (z | 0));
}

const byte = (h: number, shift: number) => (((h >>> shift) & 255) + 0.5) / 256;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

const seeded = (seed: number) => Math.round(seed * 7919);

/**
 * The patches' map for `seed`: PATCHES_SIZE² texels over PATCHES_PERIOD each way, repeating, RG
 * (row-major, east then north): three octaves of value noise at PATCHES_SCALE, about 0.5 (0 to
 * 1): the air's moister and drier patches (R), and the heating's (G).
 *
 * @group Weather
 */
export function patchesMap(seed: number): Float32Array {
  const n = PATCHES_SIZE;
  const map = new Float32Array(n * n * 2);
  const s = seeded(seed);
  const octaves = [
    [1, 0.5],
    [2, 0.3],
    [4, 0.2],
  ];
  for (let channel = 0; channel < 2; channel++)
    octaves.forEach(([frequency, weight], o) => {
      const lattice = (PATCHES_PERIOD / PATCHES_SCALE) * frequency;
      const at = (i: number, j: number) =>
        byte(hash(((i % lattice) + lattice) % lattice, ((j % lattice) + lattice) % lattice, o + 4 * channel, s), 0);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const u = ((x + 0.5) / n) * lattice;
          const v = ((y + 0.5) / n) * lattice;
          const i = Math.floor(u);
          const j = Math.floor(v);
          const fu = smoothstep(0, 1, u - i);
          const fv = smoothstep(0, 1, v - j);
          const value =
            (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) +
            (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
          map[2 * (y * n + x) + channel] += weight * value;
        }
    });
  return map;
}

/**
 * The patches' map at `east`, `north` (m), channel `channel` (0 the moisture's, 1 the heating's),
 * taken in between its texels as a texture's linear filter does, repeating.
 *
 * @group Weather
 */
export function patchesAt(map: Float32Array, east: number, north: number, channel: number): number {
  const n = PATCHES_SIZE;
  const u = (east / PATCHES_PERIOD) * n - 0.5;
  const v = (north / PATCHES_PERIOD) * n - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const wrap = (k: number) => ((k % n) + n) % n;
  const at = (x: number, y: number) => map[2 * (wrap(y) * n + wrap(x)) + channel];
  return (
    (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) +
    (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv
  );
}

/**
 * The atmosphere's table (atmosphereTable, `rows` thermals) at `row` and `column`, channel
 * `channel`: taken in between its texels as a texture's linear filter does, clamped to its edges.
 * Thermals' rows are 0 to `rows` − 1, by height (a level a column); the air's `rows`; the
 * thermals' courses `rows` + 1 on, by time (ATMOSPHERE_TIME_STEP a column).
 *
 * @group Weather
 */
export function tableAt(
  table: Float32Array,
  rows: number,
  row: number,
  column: number,
  channel: number,
): number {
  const width = ATMOSPHERE_LEVELS;
  const height = 2 * rows + 1;
  const x = Math.min(Math.max(column, 0), width - 1);
  const y = Math.min(Math.max(row, 0), height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (i: number, j: number) => table[4 * (j * width + i) + channel];
  return (
    (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) +
    (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
  );
}

// The heights each thermal row of `table` holds cloud between (m), widened a level either way:
// [low, high] per row, low > high for none.
function cloudRanges(table: Float32Array, rows: number): Float64Array {
  const ranges = new Float64Array(2 * rows);
  for (let r = 0; r < rows; r++) {
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < ATMOSPHERE_LEVELS; i++)
      if (table[4 * (r * ATMOSPHERE_LEVELS + i)] > 0) {
        low = Math.min(low, (i - 1) * ATMOSPHERE_STEP);
        high = Math.max(high, (i + 1) * ATMOSPHERE_STEP);
      }
    ranges[2 * r] = low;
    ranges[2 * r + 1] = high;
  }
  return ranges;
}

// How far each thermal row of `table` spreads its stopped bubbles into sheets (sheetSpread,
// atmosphere.ts), from the air's stability the table holds by height.
function sheetSpreads(table: Float32Array, rows: number): Float64Array {
  const spreads = new Float64Array(rows);
  const stability = (level: number) => table[4 * (rows * ATMOSPHERE_LEVELS + level) + 2];
  for (let r = 0; r < rows; r++) {
    const neutral = table[4 * r * ATMOSPHERE_LEVELS + 3];
    const top = table[4 * (rows + 1 + r) * ATMOSPHERE_LEVELS + 3];
    spreads[r] = sheetSpread(neutral, top, stability);
  }
  return spreads;
}

/**
 * The bubbles alive at `settings.time` that may hold cloud within the square: of each thermal of
 * each grid (THERMAL_GRIDS) about it, from `table` (atmosphereTable, `rows` thermals) and the
 * patches' `map` (patchesMap). Each cell starts a thermal every period at a phase of its own, as
 * likely and as strong as the heating where it rises; its sources (one to THERMAL_SOURCES, the
 * stronger it is the more, about its middle, starting one after another) drift with the mixed
 * layer's wind; their bubbles, released one a pulse, rise on their course along a path of their
 * own (tilted, and wandering about as it rises), widen, stop, spread into a sheet as far as the
 * air they stop in is stable (sheetSpread) and mix away,
 * and lean downwind with the shear (thermalBubble, atmosphere.ts). Those that can hold no cloud
 * anywhere (mixed away into air too dry, even in its moistest patches) left out. At most `most`.
 *
 * @group Weather
 */
export function thermalBubbles(
  table: Float32Array,
  rows: number,
  map: Float32Array,
  settings: ThermalFieldSettings,
  most = 8192,
): BubbleField {
  const { half, time, heating, patchiness, east, north, speed, shear, mixedTop } = settings;
  const s = seeded(settings.seed);
  const ranges = cloudRanges(table, rows);
  const spreads = sheetSpreads(table, rows);
  // The highest any thermal holds cloud (m).
  let cloudTop = 0;
  for (let r = 0; r < rows; r++) cloudTop = Math.max(cloudTop, ranges[2 * r + 1]);
  const bubbles = new Float32Array(most * BUBBLE_FLOATS);
  const tableEnd = (ATMOSPHERE_LEVELS - 1) * ATMOSPHERE_TIME_STEP;
  // The sources' frame, carried by the mixed layer's wind: where the square's middle has gone.
  const driftE = east * speed * time;
  const driftN = north * speed * time;
  // The air's own condensate (g/kg, negative under saturation) in its moistest patches `z` up.
  const moistest = (z: number) =>
    tableAt(table, rows, rows, z / ATMOSPHERE_STEP, 0) +
    ATMOSPHERE_MOISTURE * patchiness * tableAt(table, rows, rows, z / ATMOSPHERE_STEP, 1);
  let count = 0;
  THERMAL_GRIDS.forEach(({ cell, strengths, likely, period }, g) => {
    // The cells whose bubbles may reach the square: their reach and paths, their sources about
    // them, and the shear's carrying.
    const widest = thermalRadius(strengths[1]);
    const margin =
      1.1 * cell +
      (2 + 1.2 + 1.5) * widest +
      THERMAL_TILT * cloudTop +
      (shear > 0 ? THERMAL_LEAN_MOST : 0);
    const x0 = Math.floor((-half - margin - driftE) / cell);
    const x1 = Math.floor((half + margin - driftE) / cell);
    const y0 = Math.floor((-half - margin - driftN) / cell);
    const y1 = Math.floor((half + margin - driftN) / cell);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const phase = time / period + byte(hash(cx, cy, g, s), 0);
        const current = Math.floor(phase);
        for (let k = 0; k < 2; k++) {
          const generation = current - k;
          const age = (phase - generation) * period;
          const h = hash(cx, cy, 4 + g + 2 * generation, s);
          if (byte(h, 16) >= 2 * heating * likely) continue;
          const middleE = (cx + 0.5 + (byte(h, 0) - 0.5) * 0.8) * cell;
          const middleN = (cy + 0.5 + (byte(h, 8) - 0.5) * 0.8) * cell;
          const forcing = 1 + (2 * patchesAt(map, middleE, middleN, 1) - 1) * patchiness;
          if (byte(h, 16) >= heating * forcing * likely) continue;
          const strength = Math.min(
            (strengths[0] + (strengths[1] - strengths[0]) * Math.pow(byte(h, 24), 1.5)) *
              (0.6 + 0.4 * forcing),
            strengths[1],
          );
          const radius = thermalRadius(strength);
          const pulses = Math.min(1 + Math.floor(byte(h, 4) * (1 + 5 * strength) + 0.5), THERMAL_PULSES);
          // A thermal two periods old gives way to its cell's next.
          const fade = 1 - smoothstep(1.5 * period, 2 * period, age);
          // Its path: tilted up to THERMAL_TILT, and wandering about it with height.
          const hp = hash(h >>> 8, 0, 16 + g, s);
          const hq = hash(h >>> 8, 1, 16 + g, s);
          const tilt = THERMAL_TILT * byte(hp, 8);
          const tiltE = tilt * Math.cos(2 * Math.PI * byte(hp, 0));
          const tiltN = tilt * Math.sin(2 * Math.PI * byte(hp, 0));
          const wander = THERMAL_WANDER * radius * (0.5 + byte(hp, 16));
          const wavelength = (3 + 2 * byte(hp, 24)) * radius;
          const phaseE = 2 * Math.PI * byte(hq, 0);
          const phaseN = 2 * Math.PI * byte(hq, 8);
          // Its sources: a few at any strength, and turrets enough to fill its breadth.
          const turret = Math.min(radius, THERMAL_TURRET);
          const fill = Math.round(TURRET_FILL * ((radius / turret) ** 2 - 1));
          const sources = Math.min(
            1 + Math.floor(byte(hq, 16) * (1 + 3 * strength)) + fill,
            THERMAL_SOURCES,
          );
          for (let src = 0; src < sources; src++) {
            // Its sources about its middle, a little weaker than the first, one after another.
            const hs0 = hash(h >>> 8, src, 20 + g, s);
            const away = src === 0 ? 0 : 1.2 * radius * Math.sqrt(byte(hs0, 8));
            const sourceE = middleE + away * Math.cos(2 * Math.PI * byte(hs0, 0));
            const sourceN = middleN + away * Math.sin(2 * Math.PI * byte(hs0, 0));
            const own = src === 0 ? strength : strength * (1 - 0.25 * byte(hs0, 24));
            const row = own * (rows - 1);
            const r0 = Math.floor(row);
            const r1 = Math.min(r0 + 1, rows - 1);
            const low = Math.min(ranges[2 * r0], ranges[2 * r1]);
            const high = Math.max(ranges[2 * r0 + 1], ranges[2 * r1 + 1]);
            if (low > high) continue;
            const whole = thermalRadius(own);
            const ownRadius = Math.min(whole, THERMAL_TURRET);
            const strongest = tableAt(table, rows, row, 0, 2);
            const topTime = tableAt(table, rows, rows + 1 + row, 0, 2);
            const top = tableAt(table, rows, rows + 1 + row, 0, 3);
            const pulse = (THERMAL_PULSE * ownRadius) / Math.max(strongest, 0.5);
            const mixing = (whole + THERMAL_GROWTH * top) / THERMAL_MIXING;
            const neutral = tableAt(table, rows, row, 0, 3);
            const spread = spreads[r0] + (spreads[r1] - spreads[r0]) * (row - r0);
            const delay = src === 0 ? 0 : src * pulse * (0.5 + byte(hs0, 16));
            const trains = src === 0 ? pulses : Math.max(pulses - src, 1);
            for (let b = 0; b < trains; b++) {
              const since = age - delay - b * pulse;
              if (since < 0) break;
              const column = since / ATMOSPHERE_TIME_STEP;
              const stopped = Math.max(since - topTime, 0);
              const height =
                stopped > 0
                  ? settledHeight(top, neutral, stopped, mixing)
                  : tableAt(table, rows, rows + 1 + row, column, 0);
              const aloft = tableAt(table, rows, rows + 1 + row, column, 1);
              const r = ownRadius + THERMAL_GROWTH * (stopped > 0 ? top : height);
              const shape = bubbleShape(r, stopped, mixing, spread);
              const keep = shape.kept * shape.dilution * fade;
              if (keep < 1e-3) continue;
              const { across, up } = shape;
              const [reach, reachUp] = bubbleReach(across, up, r);
              if (height + reachUp < low || height - reachUp > high) continue;
              // Could it hold cloud anywhere? Within it, in the air's moistest patches.
              let cloudy = false;
              for (const share of [-0.7, 0, 0.7]) {
                const z = Math.min(Math.max(height + share * up, low), high);
                const parcel = tableAt(table, rows, row, z / ATMOSPHERE_STEP, 0);
                const air = moistest(z);
                if (parcel > 0 && air + Math.max(parcel - air, 0) * keep > 0) cloudy = true;
              }
              if (!cloudy) continue;
              let lean = shear * (aloft + Math.max(since - tableEnd, 0) * Math.max(top - mixedTop, 0));
              lean = shear > 0 ? THERMAL_LEAN_MOST * (1 - Math.exp(-lean / THERMAL_LEAN_MOST)) : 0;
              const hb = hash(h >>> 8, b + 8 * src, 8 + g, s);
              const angle = (2 * Math.PI * height) / wavelength;
              const e =
                sourceE +
                (byte(hb, 0) - 0.5) * 0.6 * ownRadius +
                tiltE * height +
                wander * (Math.sin(angle + phaseE) - Math.sin(phaseE)) +
                east * lean +
                driftE;
              const n =
                sourceN +
                (byte(hb, 8) - 0.5) * 0.6 * ownRadius +
                tiltN * height +
                wander * (Math.sin(angle + phaseN) - Math.sin(phaseN)) +
                north * lean +
                driftN;
              if (Math.abs(e) - reach > half || Math.abs(n) - reach > half) continue;
              if (count >= most) return;
              // Its billows' own: from its thermal and its place in the train, so the same each time.
              const hs = hash(h >>> 8, b + 8 * src, 12 + g, s);
              const o = count * BUBBLE_FLOATS;
              bubbles[o] = e;
              bubbles[o + 1] = n;
              bubbles[o + 2] = height;
              bubbles[o + 3] = row;
              bubbles[o + 4] = across;
              bubbles[o + 5] = up;
              bubbles[o + 6] = keep;
              bubbles[o + 7] = r;
              bubbles[o + 8] = 8 * byte(hs, 0);
              bubbles[o + 9] = 8 * byte(hs, 8);
              bubbles[o + 10] = 8 * byte(hs, 16);
              bubbles[o + 11] = shape.kept;
              count++;
            }
          }
        }
      }
  });
  return { bubbles, count };
}

/**
 * Bubbles binned by where they reach ({@link binBubbles}): for each bin, where its list starts
 * in `indices` and how long it is (`bins`, two floats a bin: east fastest, then up, then north),
 * `entries` indices in all, and the longest list.
 *
 * @group Weather
 */
export type BubbleBins = {
  bins: Float32Array;
  indices: Float32Array;
  entries: number;
  longest: number;
};

/**
 * `field`'s bubbles binned over the square `half` each way from its middle and the heights
 * `extent` (m), in `across` × `across` × `up` bins: each bubble in every bin its reach
 * ({@link bubbleReach}) touches. At most `most` entries: past them, the bins'
 * lists are cut short.
 *
 * @group Weather
 */
export function binBubbles(
  field: BubbleField,
  half: number,
  extent: readonly [number, number],
  across: number,
  up: number,
  most = 1 << 20,
): BubbleBins {
  const size = (2 * half) / across;
  const depth = (extent[1] - extent[0]) / up;
  const { bubbles, count } = field;
  const binCount = across * across * up;
  const bins = new Float32Array(binCount * 2);
  const clampBin = (v: number, n: number) => Math.min(Math.max(Math.floor(v), 0), n - 1);
  // Each bubble's bins: x0, x1, y0, y1, z0, z1 (x1 < x0 where it misses).
  const spans = new Int32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const o = i * BUBBLE_FLOATS;
    const [r, v] = bubbleReach(bubbles[o + 4], bubbles[o + 5], bubbles[o + 7]);
    const zLow = (bubbles[o + 2] - v - extent[0]) / depth;
    const zHigh = (bubbles[o + 2] + v - extent[0]) / depth;
    const s = i * 6;
    if (zHigh < 0 || zLow >= up) {
      spans[s] = 1;
      spans[s + 1] = 0;
      continue;
    }
    spans[s] = clampBin((bubbles[o] - r + half) / size, across);
    spans[s + 1] = clampBin((bubbles[o] + r + half) / size, across);
    spans[s + 2] = clampBin((bubbles[o + 1] - r + half) / size, across);
    spans[s + 3] = clampBin((bubbles[o + 1] + r + half) / size, across);
    spans[s + 4] = clampBin(zLow, up);
    spans[s + 5] = clampBin(zHigh, up);
  }
  // Bins lie east fastest, then up, then north.
  const counts = new Int32Array(binCount);
  for (let i = 0; i < count; i++) {
    const s = i * 6;
    for (let y = spans[s + 2]; y <= spans[s + 3]; y++)
      for (let z = spans[s + 4]; z <= spans[s + 5]; z++) {
        const row = (y * up + z) * across;
        for (let x = spans[s]; x <= spans[s + 1]; x++) counts[row + x]++;
      }
  }
  let entries = 0;
  let longest = 0;
  const starts = new Int32Array(binCount);
  for (let bin = 0; bin < binCount; bin++) {
    const length = Math.min(counts[bin], Math.max(most - entries, 0));
    starts[bin] = entries;
    bins[2 * bin] = entries;
    bins[2 * bin + 1] = length;
    counts[bin] = length;
    entries += length;
    longest = Math.max(longest, length);
  }
  const indices = new Float32Array(Math.max(entries, 1));
  for (let i = 0; i < count; i++) {
    const s = i * 6;
    for (let y = spans[s + 2]; y <= spans[s + 3]; y++)
      for (let z = spans[s + 4]; z <= spans[s + 5]; z++) {
        const row = (y * up + z) * across;
        for (let x = spans[s]; x <= spans[s + 1]; x++) {
          const bin = row + x;
          if (counts[bin] > 0) {
            indices[starts[bin]++] = i;
            counts[bin]--;
          }
        }
      }
  }
  return { bins, indices, entries, longest };
}
