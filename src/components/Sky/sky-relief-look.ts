import {
  Color,
  ColorRepresentation,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from 'three';
import {
  ColorRampRef,
  colorRampOf,
  colorRampRow,
  resolveColorRamp,
} from '../../common/color-ramps';
import { ContourColorMode } from '../../common/types';

/**
 * A relief coloured by height through a colour ramp: a terrain ramp (`'terrain'`,
 * `'atlas'`, `'terrain-nordic'`), or any other (`'rainbow'`, your own; see
 * `builtInColorRamps` and `registerColorRamp`).
 *
 * @group Components
 */
export type ReliefColorRamp = {
  /** the ramp: its row of `colorRampTexture`, its name, or itself */
  ramp: ColorRampRef;
  /**
   * the height, in metres from the sea's level, at the ramp's low end. Default the ramp's
   * own `domain`'s; without one 0, or -3000 with the seabed on the ramp (`seabed: 'ramp'`)
   */
  min?: number;
  /** the height at its high end. Default the ramp's `domain`'s; without one 2000 */
  max?: number;
  /** run it the other way: from high to low, or for a value ramp (no `domain`), low to high */
  reverse?: boolean;
  /**
   * the seabed: `'sea'` the sea's seabed colour, darker with depth; `'ramp'` this ramp too,
   * across land and seabed alike; or a ramp of its own (`'bathymetry'`, say), over its
   * own range (default its `domain`, without one -3000 to 0). Default `'sea'`
   */
  seabed?: 'sea' | 'ramp' | ReliefSeabedRamp;
};

/**
 * The seabed's own ramp ({@link ReliefColorRamp.seabed}).
 *
 * @group Components
 */
export type ReliefSeabedRamp = Omit<ReliefColorRamp, 'seabed'>;

/**
 * How a relief is coloured: one colour for the land (the seabed taking the sea's), a ramp
 * by height ({@link ReliefColorRamp}), or `'ramp'` for `{ ramp: 'terrain' }`.
 *
 * @group Components
 */
export type ReliefColor = 'ramp' | ColorRepresentation | ReliefColorRamp;

/**
 * Contour lines over a relief: every `interval` metres from the sea's level, a heavier
 * one every `major`-th. They fade out where they come closer than a few pixels apart.
 *
 * @group Components
 */
export type ReliefContours = {
  /** metres between lines. Default 100 */
  interval?: number;
  /** their width, about pixels each side. Default 0.8 */
  thickness?: number;
  /** every how many a major line, twice as wide; 0 or 1 for none. Default 5 */
  major?: number;
  /** how a line shades what it crosses. Default darken */
  colorMode?: ContourColorMode;
  /** how strongly. Default 0.5 */
  factor?: number;
  /** the line's colour, for `ContourColorMode.mixed`. Default black */
  color?: ColorRepresentation;
  /** on the seabed too. Default true */
  seabed?: boolean;
};

/**
 * How a relief, or one of its layers, looks.
 *
 * @group Components
 */
export type ReliefLook = {
  color?: ReliefColor;
  /** `true` for the defaults ({@link ReliefContours}) */
  contours?: boolean | ReliefContours;
};

/** Looks the table holds: the relief's own (0), then one per layer by its place (1 + i). */
export const RELIEF_LOOKS = 32;
// A relief's flat land by default, a dark green-grey, which keeps its colour through the air.
const RELIEF_LAND_COLOR = '#34433b';
const ROWS = 5;
// Row 0 (and 2) with no ramp: the land a flat colour; the seabed the sea's darkened with
// depth, or plain.
const NO_RAMP = -1;
const SEA_PLAIN = -2;

const DEFAULT_CONTOURS: Required<ReliefContours> = {
  interval: 100,
  thickness: 0.8,
  major: 5,
  colorMode: ContourColorMode.darken,
  factor: 0.5,
  color: '#000000',
  seabed: true,
};

const isRamp = (color: ReliefColor | undefined): color is ReliefColorRamp =>
  typeof color === 'object' && color !== null && 'ramp' in color;

const color = new Color();

/**
 * The looks of a relief and of its layers, as the relief's shaders read them: a column per
 * look (0 the relief's, 1 + i its layer i's, as the tiles mark their nodes), five rows of
 * four floats each (relief-fragment.glsl). Every setting is a texel, so changing one is a
 * texture upload, never a new program.
 */
export class SkyReliefLooks {
  private readonly data = new Float32Array(RELIEF_LOOKS * ROWS * 4);
  readonly texture = new DataTexture(
    this.data,
    RELIEF_LOOKS,
    ROWS,
    RGBAFormat,
    FloatType,
  );

  constructor() {
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.update({});
  }

  /**
   * The relief's look, `base`, and its layers' over it, `layers[i]` for its layer i: a
   * layer takes the relief's colour or contours where it has none of its own.
   */
  update(base: ReliefLook, layers: (ReliefLook | undefined)[] = []) {
    this.write(0, base);
    for (let i = 1; i < RELIEF_LOOKS; i++) {
      const own = layers[i - 1];
      this.write(
        i,
        own
          ? {
              color: own.color ?? base.color,
              contours: own.contours ?? base.contours,
            }
          : base,
      );
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }

  private set(
    column: number,
    row: number,
    a: number,
    b: number,
    c: number,
    d: number,
  ) {
    const i = (row * RELIEF_LOOKS + column) * 4;
    this.data[i] = a;
    this.data[i + 1] = b;
    this.data[i + 2] = c;
    this.data[i + 3] = d;
  }

  private write(column: number, look: ReliefLook) {
    const lines =
      look.contours === true
        ? DEFAULT_CONTOURS
        : look.contours
          ? { ...DEFAULT_CONTOURS, ...look.contours }
          : null;
    const paint = look.color === 'ramp' ? { ramp: 'terrain' } : look.color;

    if (isRamp(paint)) {
      const seabed = paint.seabed ?? 'sea';
      const across = seabed === 'ramp';
      const land = rampRow(paint, across ? [-3000, 2000] : [0, 2000]);
      this.set(column, 0, ...land);
      color.set(0, 0, 0);
      const bed: [number, number, number, number] =
        seabed === 'sea'
          ? [NO_RAMP, 0, 0, 0]
          : across
            ? land
            : rampRow(seabed, [-3000, 0]);
      this.set(column, 2, ...bed);
    } else {
      color.set(paint ?? RELIEF_LAND_COLOR);
      this.set(column, 0, NO_RAMP, 0, 0, 0);
      this.set(column, 2, SEA_PLAIN, 0, 0, 0);
    }
    this.set(column, 1, color.r, color.g, color.b, lines?.colorMode ?? 0);

    if (lines) {
      this.set(
        column,
        3,
        Math.max(lines.interval, 1e-3),
        Math.max(lines.thickness, 0),
        lines.major,
        lines.seabed ? 1 : 0,
      );
      color.set(lines.color);
      this.set(column, 4, color.r, color.g, color.b, lines.factor);
    } else {
      this.set(column, 3, 0, 0, 0, 0);
      this.set(column, 4, 0, 0, 0, 0);
    }
  }
}

// A ramp's row, its low and high heights and whether it runs backwards, as the shader
// takes them (colorRampAt). A ramp with no `domain` of its own (the value ramps) runs as on
// a Surface, which takes depths: its start at the top of the range, so a ground looks the
// same as a relief as as a Surface.
function rampRow(
  ramp: ReliefSeabedRamp,
  fallback: [number, number],
): [number, number, number, number] {
  const index = resolveColorRamp(ramp.ramp);
  const domain = colorRampOf(index)?.domain;
  const [low, high] = domain ?? fallback;
  const reverse = !!ramp.reverse !== !domain;
  return [
    colorRampRow(index),
    ramp.min ?? low,
    ramp.max ?? high,
    reverse ? 1 : 0,
  ];
}
