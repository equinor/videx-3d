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
import type { LabelBaseline } from '../Labels/types';

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
  /**
   * their heights written along them, on the ground (see {@link ReliefContourLabels});
   * `true` for the defaults. Default none
   */
  labels?: boolean | ReliefContourLabels;
};

/**
 * Labels on a relief's contour lines: each line's height in metres, written along it on
 * the ground on the line as the relief draws it, turned to read left to right on screen
 * (or, without `flip`, the top of its text uphill, the map maker's way). Barely there by
 * default, as part of the lines: small monospace numbers in the lines' own colour and
 * strength (black as they darken the ground, their colour as they mix toward it, white
 * where they lighten it), with a hair of a faint halo; only where their lines are well
 * apart on screen, never grown at a slant, and gone where seen nearly edge-on. Found on
 * each relief tile drawn, from its own heights, each on the triangle it lies on as the
 * tile is drawn, about `spacing` apart along their line on screen at any distance: more
 * come in between as the camera nears, so higher, shorter and curvier lines are labelled
 * once near enough for a label to fit along them. Kept apart on screen from every label in
 * the scene, below data labels. Not on the coastline (0 m); under the sea's level only
 * with seabed lines, and not while a `Scenery`'s sea has water over them.
 *
 * @group Components
 */
export type ReliefContourLabels = {
  /** the lines labelled: the major ones (default), or all */
  lines?: 'major' | 'all';
  /**
   * where the text lies by its line: across it (`'middle'`, default), hanging from it by
   * its top on the downhill side (`'top'`), or standing on it on the uphill side
   * (`'bottom'`)
   */
  baseline?: LabelBaseline;
  /**
   * turned to read left to right on screen wherever the camera is, rather than always with
   * its top uphill as on a paper map (`LabelStyle.flip`): turned in its own place, so it
   * keeps its side of the line. Default true
   */
  flip?: boolean;
  /**
   * the distance between a line's labels along it on screen, CSS pixels: at any distance
   * they are kept between this and twice it, those coming in fading in as they grow from
   * 60 % of it (see `GeoRelief`). Default 320
   */
  spacing?: number;
  /** the text's size on screen, CSS pixels. Default 9 */
  size?: number;
  /** Default monospace ({@link RELIEF_CONTOUR_LABEL_FONT}) */
  fontFamily?: string;
  /** Default 400 */
  fontWeight?: string | number;
  /** Default the lines' own: black darkening, white lightening, their `color` mixed */
  color?: string;
  /**
   * how much they show, 0 to 1: the ground through them. Default as strongly as the lines
   * shade it (their `factor`), so the text is the lines' own colour on any ground; a
   * quarter of it lightening, as near as see-through white comes to the lines' brightening
   */
  opacity?: number;
  /**
   * Default the tone opposite the text's, faint: a light grey at 30 % under dark text (15 %
   * as drawn at the lines' default strength), a dark grey under light
   */
  haloColor?: string;
  /** a fraction of the text's size; 0 for none. Default 0.015: a hair, just apart from the line it sits on */
  haloWidth?: number;
  /**
   * farther from the camera than this, in metres, none: fading out over its last quarter.
   * Default none: each label shows only where its line's labels are `spacing` apart on
   * screen and the next line labelled is far enough off to tell them apart (see
   * `GeoRelief`), whatever the data's resolution
   */
  maxDistance?: number;
  /** above this camera height over the sea, in metres, none. Default none */
  maxHeight?: number;
};

/** Contour labels' default font: the system's monospace, numbers of one width. */
export const RELIEF_CONTOUR_LABEL_FONT =
  'ui-monospace, "SF Mono", Menlo, "Consolas Bold", "Liberation Mono", monospace';

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

/**
 * How a relief looks, as both a `GeoRelief` and a `GeoMap` take it: give one object to both
 * and the map is coloured as the scene is.
 *
 * @group Components
 */
export type ReliefLookProps = {
  /** how the land and seabed are coloured (see {@link ReliefColor}) */
  color?: ReliefColor;
  /** contour lines over it (see {@link ReliefContours}); `true` for the defaults */
  contours?: boolean | ReliefContours;
  /**
   * a look of its own for a layer, by its id: its `color` and `contours` where it gave the
   * ground, over the relief's
   */
  layerLooks?: Record<string, ReliefLook>;
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
  labels: false,
};

/** {@link ReliefContourLabels} with its defaults filled in (see {@link resolveReliefContourLabels}). */
export type ResolvedReliefContourLabels = Required<
  Omit<ReliefContourLabels, 'maxDistance' | 'maxHeight'>
> &
  Pick<ReliefContourLabels, 'maxDistance' | 'maxHeight'>;

/** The defaults of {@link ReliefContourLabels}, but those its lines give and its caps (`maxDistance`, `maxHeight`). */
export const RELIEF_CONTOUR_LABEL_DEFAULTS: Omit<
  ResolvedReliefContourLabels,
  'color' | 'opacity' | 'haloColor'
> = {
  lines: 'major',
  baseline: 'middle',
  flip: true,
  spacing: 320,
  size: 16,
  fontFamily: RELIEF_CONTOUR_LABEL_FONT,
  fontWeight: 500,
  haloWidth: 0.025,
};

/**
 * A relief's (or layer's) contours with their defaults filled in, or null for none:
 * `true` the defaults, `false` or nothing none.
 */
export function resolveReliefContours(
  contours: boolean | ReliefContours | undefined,
): Required<ReliefContours> | null {
  if (contours === true) return DEFAULT_CONTOURS;
  return contours ? { ...DEFAULT_CONTOURS, ...contours } : null;
}

/**
 * The labels of contours resolved by {@link resolveReliefContours}, with their defaults, or
 * null for none: their text the lines' own colour — black as strongly as they darken the
 * ground, their `color` as strongly as they mix toward it, the same over the ground as the
 * lines are (both blend alike); white a quarter as strongly where they lighten it — with
 * a faint halo of the other tone.
 */
export function resolveReliefContourLabels(
  contours: Required<ReliefContours> | null,
): ResolvedReliefContourLabels | null {
  if (!contours?.labels) return null;
  const given = contours.labels === true ? {} : contours.labels;
  const strength = Math.min(Math.max(contours.factor, 0), 1);
  let tone = '#000000';
  let opacity = strength;
  if (contours.colorMode === ContourColorMode.lighten) {
    tone = '#ffffff';
    opacity = strength / 4;
  } else if (contours.colorMode === ContourColorMode.mixed)
    tone = `#${color.set(contours.color).getHexString()}`;
  // Light text (by its luminance, linear: past a mid grey's), a dark grey halo; dark text,
  // a light grey one.
  color.set(tone);
  const light = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b > 0.2;
  return {
    ...RELIEF_CONTOUR_LABEL_DEFAULTS,
    color: tone,
    opacity,
    haloColor: light ? 'rgba(45, 45, 45, 0.3)' : 'rgba(210, 210, 210, 0.3)',
    ...Object.fromEntries(
      Object.entries(given).filter(([, value]) => value != null),
    ),
  };
}

const isRamp = (color: ReliefColor | undefined): color is ReliefColorRamp =>
  typeof color === 'object' && color !== null && 'ramp' in color;

const color = new Color();

/**
 * The looks of a relief and of its layers, as the relief's shaders read them: a column per
 * look (0 the relief's, 1 + i its layer i's, as the tiles mark their nodes), five rows of
 * four floats each (relief-fragment.glsl). Every setting is a texel, so changing one is a
 * texture upload, never a new program.
 */
export class SceneryReliefLooks {
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
    const lines = resolveReliefContours(look.contours);
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
