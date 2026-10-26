import { interpolateHcl, interpolateRgb, piecewise } from 'd3-interpolate';
import {
  Color,
  ColorRepresentation,
  DataTexture,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

/** @deprecated draws a ramp onto a canvas row; see {@link ColorRamp} */
export type RampFunction = (ctx: CanvasRenderingContext2D, y: number) => void;

/**
 * @deprecated a canvas of `ramps`, a row each; the shared {@link colorRampTexture} is built
 * from {@link ColorRamp} data instead, and needs no DOM
 */
export function createColorRamps(
  ramps: RampFunction[],
  width: number,
): HTMLCanvasElement {
  const n = ramps.length;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = n;

  canvas.style.imageRendering = '-moz-crisp-edges';
  canvas.style.imageRendering = 'pixelated';
  const context = canvas.getContext('2d');

  if (context) {
    for (let i = 0; i < ramps.length; i++) {
      ramps[i](context, i);
    }
  }
  return canvas;
}

function canvasRamp(color: (t: number) => string, n?: number): RampFunction {
  return (ctx, y) => {
    const samples = n !== undefined ? n : ctx.canvas.width;
    const w = ctx.canvas.width / (samples - 1);

    for (let i = 0; i < samples; ++i) {
      ctx.fillStyle = color(i / (samples - 1));
      ctx.fillRect(i * w, y, w + 1, 1);
    }
  };
}

const interpolator = (palette: string[]) =>
  Object.assign(
    (t: number) =>
      piecewise(interpolateHcl, palette)(Math.min(Math.max(0, t), 1)),
    { palette },
  );
const rainbow = interpolator([
  '#5d198e',
  '#2319a1',
  '#185db6',
  '#16c1ca',
  '#14e083',
  '#19ef20',
  '#88f427',
  '#f5f835',
  '#fca245',
  '#ff5555',
]);
const jet = interpolator([
  '#000083',
  '#001e97',
  '#003caa',
  '#0163bb',
  '#028acc',
  '#03b1dd',
  '#04d8ee',
  '#05ffff',
  '#37ffcc',
  '#69ff99',
  '#9bff66',
  '#cdff33',
  '#ffff00',
  '#fecc00',
  '#fd9900',
  '#fc6600',
  '#fb3300',
  '#fa0000',
  '#bd0000',
  '#800000',
]);
const portland = interpolator([
  '#0c3383',
  '#0c448e',
  '#0b5599',
  '#0b66a4',
  '#0a77af',
  '#0a88ba',
  '#3897a0',
  '#67a686',
  '#95b56c',
  '#c4c452',
  '#f2d338',
  '#f2c238',
  '#f2b138',
  '#f2a038',
  '#f28f38',
  '#ed7833',
  '#e8622e',
  '#e34b28',
  '#de3523',
  '#d91e1e',
]);
const earth = interpolator([
  '#000082',
  '#005a9b',
  '#00b4b4',
  '#14c36e',
  '#28d228',
  '#58d72b',
  '#87dc2d',
  '#b7e130',
  '#e6e632',
  '#c1b128',
  '#9d7b1e',
  '#784614',
  '#895d31',
  '#9a744f',
  '#ab8b6c',
  '#bca38a',
  '#ccbaa7',
  '#ddd1c4',
  '#eee8e2',
  '#ffffff',
]);
const plasma = interpolator([
  '#0d0887',
  '#2c0694',
  '#4b03a1',
  '#5c03a3',
  '#6c03a6',
  '#7d03a8',
  '#93139f',
  '#a82296',
  '#b42e8c',
  '#bf3a83',
  '#cb4679',
  '#d8596b',
  '#e56b5d',
  '#ef804f',
  '#f89441',
  '#faa439',
  '#fbb330',
  '#fdc328',
  '#f7de25',
  '#f0f921',
]);
const salinity = interpolator([
  '#2a186c',
  '#262587',
  '#2132a2',
  '#1b3f9c',
  '#154d97',
  '#0f5a91',
  '#1c688d',
  '#287689',
  '#2e7f88',
  '#358988',
  '#3b9287',
  '#45a183',
  '#4faf7e',
  '#64bd73',
  '#78cb68',
  '#90d167',
  '#a9d765',
  '#c1dd64',
  '#dfe67f',
  '#fdef9a',
]);
const seismic = interpolator([
  '#ffe700',
  '#ffdf00',
  '#ffd600',
  '#ffce00',
  '#ffc500',
  '#ffbc00',
  '#ffb400',
  '#ffab00',
  '#ffa200',
  '#ff9a00',
  '#ff9100',
  '#ff8900',
  '#ff8000',
  '#ff7700',
  '#ff6f00',
  '#ff6600',
  '#ff5e00',
  '#ff5500',
  '#f55400',
  '#ea5200',
  '#e05100',
  '#d55000',
  '#cb4e00',
  '#c04d00',
  '#b64b00',
  '#ab4a00',
  '#a14900',
  '#964700',
  '#8c4600',
  '#925213',
  '#975d25',
  '#9d6938',
  '#a2744a',
  '#a8805d',
  '#ad8b6f',
  '#b39782',
  '#b8a294',
  '#beaea7',
  '#c3b9b9',
  '#b7aeae',
  '#aaa2a2',
  '#9e9797',
  '#918b8b',
  '#858080',
  '#787474',
  '#6c6969',
  '#5f5d5d',
  '#535252',
  '#464646',
  '#404057',
  '#393968',
  '#333378',
  '#2d2d89',
  '#26269a',
  '#2020ab',
  '#1919bc',
  '#1313cd',
  '#0d0ddd',
  '#0606ee',
  '#0000ff',
  '#000cff',
  '#0018ff',
  '#0024ff',
  '#0030ff',
  '#003cff',
  '#0048ff',
  '#0054ff',
  '#0060ff',
  '#006cff',
  '#0078ff',
  '#0084ff',
  '#0090ff',
  '#009cff',
  '#00a8ff',
  '#00b4ff',
  '#00c0ff',
  '#00ccff',
  '#00d8ff',
  '#00e4ff',
  '#00f0ff',
]);
const seismic2 = interpolator([
  '#00004c',
  '#000092',
  '#0000db',
  '#3131ff',
  '#9999ff',
  '#fdfdff',
  '#ff9999',
  '#ff3535',
  '#e60000',
  '#b30000',
  '#800000',
]);
const spectrum = interpolator([
  '#ffffff',
  '#FFFFBD',
  '#FFFF71',
  '#FFFF24',
  '#FFE300',
  '#FF9100',
  '#F90600',
  '#DB2400',
  '#C03F00',
  '#A45B00',
  '#6D9200',
  '#3AD500',
  '#00FF00',
  '#00EA1E',
  '#00C03F',
  '#009F60',
  '#00AF87',
  '#00CCB3',
  '#00ECD9',
  '#03FBFF',
  '#19F0FF',
  '#2ED1FF',
  '#44BBFF',
  '#4F9EFF',
  '#3870FF',
  '#2143FF',
  '#0B15FF',
  '#180CFF',
  '#4623FF',
  '#7038FF',
  '#A150FF',
  '#BA45FF',
  '#D12EFF',
  '#E817FF',
  '#FF00FF',
  '#CD00D7',
  '#9900AE',
  '#660085',
  '#300059',
  '#0B003C',
]);
const gray = interpolator(['#000', '#fff']);

/** @deprecated the built-in ramps as functions of 0 to 1; see {@link builtInColorRamps} */
export const colorRampInterpolators = [
  (t: number) => rainbow(1 - t),
  (t: number) => jet(1 - t),
  (t: number) => portland(1 - t),
  (t: number) => earth(1 - t),
  (t: number) => plasma(1 - t),
  (t: number) => salinity(1 - t),
  (t: number) => seismic(1 - t),
  (t: number) => seismic2(1 - t),
  (t: number) => spectrum(1 - t),
  (t: number) => gray(1 - t),
];

/** @deprecated the built-in ramps as canvas rows; see {@link builtInColorRamps} */
export const colorRamps = colorRampInterpolators.map(interp =>
  canvasRamp(interp),
);

/**
 * A colour stop of a {@link ColorRamp}: its colour `at` a place along the ramp, from 0 to 1,
 * or with the ramp's `domain` a value in its units (a height in metres, say).
 *
 * @group Utils
 */
export type ColorRampStop = { at: number; color: ColorRepresentation };

/**
 * A colour ramp: colours along a line, for mapping values to colours. Registered
 * ({@link registerColorRamp}) it gets a row of the shared {@link colorRampTexture}, which
 * shaders sample from 0 to 1 along it; built-in ones have rows already
 * ({@link builtInColorRamps}).
 *
 * @group Utils
 */
export type ColorRamp = {
  /** its name, by which it is found ({@link colorRampIndex}); registering a ramp of a name taken replaces that one */
  name: string;
  /** at least one, in any order */
  stops: ColorRampStop[];
  /**
   * the values its stops are in, low and high: the range it is drawn over by default, which a
   * user may stretch (a relief's `min` and `max`, say). Without one, stops are at 0 to 1.
   */
  domain?: [number, number];
  /** how colours blend between stops: perceptually (`'hcl'`), or in sRGB. Default `'hcl'` */
  interpolation?: 'hcl' | 'rgb';
};

/**
 * A colour ramp by its row of the {@link colorRampTexture}, its name, or itself (registered
 * the first time it is used).
 *
 * @group Utils
 */
export type ColorRampRef = number | string | ColorRamp;

/** The {@link colorRampTexture}'s width: samples along a ramp. */
export const COLOR_RAMP_WIDTH = 512;
/** The {@link colorRampTexture}'s height: how many ramps it can hold. */
export const COLOR_RAMP_CAPACITY = 64;

// A built-in ramp of evenly spaced colours, blended in HCL, high to low as they always were.
const paletteRamp = (
  name: string,
  { palette }: { palette: string[] },
): ColorRamp => ({
  name,
  stops: palette.map((color, i) => ({
    at: 1 - i / Math.max(palette.length - 1, 1),
    color,
  })),
});

/**
 * The built-in colour ramps, in the {@link colorRampTexture}'s row order: the ten value
 * ramps (rows 0 to 9, as they have always been), then ramps for the land and the seabed by
 * height in metres:
 * - `terrain`: green lowland, olive and ochre upland, brown mountains, grey rock and snow;
 * - `atlas`: an atlas's tints, green through yellow and brown to white;
 * - `terrain-nordic`: green lowland, umber upland and grey high ground by 1500 m;
 * - `bathymetry`: the seabed, deep blue to pale toward the shore.
 *
 * @group Utils
 */
export const builtInColorRamps: readonly ColorRamp[] = [
  paletteRamp('rainbow', rainbow),
  paletteRamp('jet', jet),
  paletteRamp('portland', portland),
  paletteRamp('earth', earth),
  paletteRamp('plasma', plasma),
  paletteRamp('salinity', salinity),
  paletteRamp('seismic', seismic),
  paletteRamp('seismic2', seismic2),
  paletteRamp('spectrum', spectrum),
  paletteRamp('gray', gray),
  {
    name: 'terrain',
    domain: [0, 6000],
    interpolation: 'rgb',
    stops: [
      { at: 0, color: '#467a40' },
      { at: 200, color: '#6a9749' },
      { at: 600, color: '#a6a25e' },
      { at: 1200, color: '#bb8e56' },
      { at: 2000, color: '#916b4a' },
      { at: 3000, color: '#857b72' },
      { at: 4500, color: '#c2bdb6' },
      { at: 5500, color: '#f2f2f2' },
    ],
  },
  {
    name: 'atlas',
    domain: [0, 5000],
    interpolation: 'rgb',
    stops: [
      { at: 0, color: '#6b9e52' },
      { at: 200, color: '#a3c26a' },
      { at: 500, color: '#e3dc96' },
      { at: 1000, color: '#e2b46a' },
      { at: 2000, color: '#c08650' },
      { at: 3000, color: '#9a6a48' },
      { at: 4000, color: '#c8b8a6' },
      { at: 5000, color: '#ffffff' },
    ],
  },
  {
    name: 'terrain-nordic',
    domain: [0, 1500],
    interpolation: 'rgb',
    stops: [
      { at: 0, color: '#3f5a2e' },
      { at: 600, color: '#776b52' },
      { at: 1500, color: '#b9b7b0' },
    ],
  },
  {
    name: 'bathymetry',
    domain: [-6000, 0],
    interpolation: 'rgb',
    stops: [
      { at: -6000, color: '#0b1d4f' },
      { at: -4000, color: '#13306d' },
      { at: -2000, color: '#1f4f8f' },
      { at: -1000, color: '#2f6ea8' },
      { at: -200, color: '#4f95c2' },
      { at: 0, color: '#8cc4dc' },
    ],
  },
];

const rampData = new Uint8Array(COLOR_RAMP_WIDTH * COLOR_RAMP_CAPACITY * 4);

/**
 * The colour ramps, a row each, {@link COLOR_RAMP_WIDTH} wide and {@link COLOR_RAMP_CAPACITY}
 * high whatever is registered, so a shader's row count never changes. Sample row `i` at
 * `(i + 0.5) / COLOR_RAMP_CAPACITY` ({@link colorRampRow}). sRGB, so it samples linear.
 *
 * @group Utils
 */
export const colorRampTexture = new DataTexture(
  rampData,
  COLOR_RAMP_WIDTH,
  COLOR_RAMP_CAPACITY,
  RGBAFormat,
  UnsignedByteType,
);
colorRampTexture.magFilter = LinearFilter;
colorRampTexture.minFilter = NearestFilter;
colorRampTexture.flipY = false;
colorRampTexture.generateMipmaps = false;
colorRampTexture.colorSpace = SRGBColorSpace;
colorRampTexture.anisotropy = 4;

const registry: ColorRamp[] = [];
const byName = new Map<string, number>();
const byRamp = new WeakMap<ColorRamp, number>();
const palettes = new Map<number, DataTexture>();
const scratch = new Color();

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

// The 8-bit sRGB channels of d3's `rgb(r, g, b)`.
function channels(css: string): [number, number, number] {
  const m = /rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(
    css,
  );
  if (!m) return [0, 0, 0];
  return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
}

// The ramp as a function of 0 to 1 giving 8-bit sRGB: its stops placed and blended once.
function sampler(ramp: ColorRamp): (t: number) => [number, number, number] {
  if (!ramp.stops.length)
    throw new Error(`Colour ramp '${ramp.name}' has no stops`);
  const [low, high] = ramp.domain ?? [0, 1];
  const span = high - low || 1;
  const stops = ramp.stops
    .map(({ at, color }) => ({
      t: clamp01((at - low) / span),
      css: `#${scratch.set(color).getHexString()}`,
    }))
    .sort((a, b) => a.t - b.t);
  const blend = ramp.interpolation === 'rgb' ? interpolateRgb : interpolateHcl;
  const segments = stops
    .slice(1)
    .map((stop, i) => blend(stops[i].css, stop.css));
  const ends = stops.map(stop => channels(blend(stop.css, stop.css)(0)));
  return t => {
    const at = clamp01(t);
    if (at <= stops[0].t) return ends[0];
    for (let i = 1; i < stops.length; i++) {
      if (at <= stops[i].t) {
        const width = stops[i].t - stops[i - 1].t;
        if (width <= 0) return ends[i];
        return channels(segments[i - 1]((at - stops[i - 1].t) / width));
      }
    }
    return ends[stops.length - 1];
  };
}

/**
 * The colour of `ramp` at `t`, from 0 to 1 along it (over its `domain`, with one), as 8-bit
 * sRGB: what its row of the {@link colorRampTexture} holds there.
 *
 * @group Utils
 */
export function sampleColorRamp(
  ramp: ColorRamp,
  t: number,
): [number, number, number] {
  return sampler(ramp)(t);
}

function writeRow(index: number, ramp: ColorRamp) {
  const at = sampler(ramp);
  const row = index * COLOR_RAMP_WIDTH * 4;
  for (let x = 0; x < COLOR_RAMP_WIDTH; x++) {
    const [r, g, b] = at(x / (COLOR_RAMP_WIDTH - 1));
    const i = row + x * 4;
    rampData[i] = r;
    rampData[i + 1] = g;
    rampData[i + 2] = b;
    rampData[i + 3] = 255;
  }
  colorRampTexture.needsUpdate = true;
  const palette = palettes.get(index);
  if (palette) {
    (palette.image.data as Uint8Array).set(
      rampData.subarray(row, row + COLOR_RAMP_WIDTH * 4),
    );
    palette.needsUpdate = true;
  }
}

/**
 * Give `ramp` a row of the {@link colorRampTexture}, or a ramp of its name a new look, and
 * return its row. The same ramp object again returns at once, so a component may call it
 * each render; to change a ramp, register a new object of the same name.
 *
 * @throws once the texture holds {@link COLOR_RAMP_CAPACITY} ramps
 * @group Utils
 */
export function registerColorRamp(ramp: ColorRamp): number {
  const known = byRamp.get(ramp);
  if (known !== undefined && registry[known] === ramp) return known;
  let index = byName.get(ramp.name);
  if (index === undefined) {
    index = registry.length;
    if (index >= COLOR_RAMP_CAPACITY)
      throw new Error(
        `No room for colour ramp '${ramp.name}': the texture holds ${COLOR_RAMP_CAPACITY}`,
      );
    byName.set(ramp.name, index);
  }
  registry[index] = ramp;
  byRamp.set(ramp, index);
  writeRow(index, ramp);
  return index;
}

for (const ramp of builtInColorRamps) registerColorRamp(ramp);

/**
 * The row of the ramp named `name` ({@link builtInColorRamps}, or registered), or -1.
 *
 * @group Utils
 */
export function colorRampIndex(name: string): number {
  return byName.get(name) ?? -1;
}

/**
 * The ramp at row `index`, or undefined.
 *
 * @group Utils
 */
export function colorRampOf(index: number): ColorRamp | undefined {
  return registry[index];
}

const warned = new Set<string>();

/**
 * The row of a ramp given by row, name or itself (registering it): a row out of range is
 * clamped into it, and an unknown name warns once and falls back to row 0.
 *
 * @group Utils
 */
export function resolveColorRamp(ref: ColorRampRef): number {
  if (typeof ref === 'number')
    return Math.min(Math.max(Math.round(ref), 0), registry.length - 1);
  if (typeof ref === 'string') {
    const index = colorRampIndex(ref);
    if (index >= 0) return index;
    if (!warned.has(ref)) {
      warned.add(ref);
      console.warn(`Unknown colour ramp '${ref}'; using '${registry[0].name}'`);
    }
    return 0;
  }
  return registerColorRamp(ref);
}

/**
 * Where row `index` of the {@link colorRampTexture} is sampled, across it: `(index + 0.5) /`
 * {@link COLOR_RAMP_CAPACITY}.
 *
 * @group Utils
 */
export function colorRampRow(index: number): number {
  return (index + 0.5) / COLOR_RAMP_CAPACITY;
}

/**
 * One of the colour ramps (`colorRampTexture`'s rows) as its own 1-row texture — a palette
 * for `ChunkFenceOverlay.palette`, or anything else that maps a value to a colour. Kept in
 * step when its ramp is registered anew.
 *
 * ⚠️ Shared and cached per index: do not dispose it.
 */
export function colorRampPalette(index: number): DataTexture {
  const row = Math.min(Math.max(Math.round(index), 0), registry.length - 1);
  let palette = palettes.get(row);
  if (!palette) {
    const start = row * COLOR_RAMP_WIDTH * 4;
    palette = new DataTexture(
      rampData.slice(start, start + COLOR_RAMP_WIDTH * 4),
      COLOR_RAMP_WIDTH,
      1,
      RGBAFormat,
      UnsignedByteType,
    );
    palette.colorSpace = SRGBColorSpace;
    palette.magFilter = LinearFilter;
    palette.minFilter = LinearFilter;
    palette.needsUpdate = true;
    palettes.set(row, palette);
  }
  return palette;
}
