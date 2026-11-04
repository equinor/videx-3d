import type { Camera } from 'three';
import type { Vec3 } from '../../sdk/types/common';

/**
 * A text label glued to the world: painted at `position`, in the plane square to `normal`,
 * as large as its layer's `size` in world units. It never moves, turns or resizes on its
 * own; it fades out as its plane turns edge-on and is hidden from behind.
 */
export type Label = {
  text: string;
  /** its text's centre, in its layer's frame (its parent's) */
  position: Vec3;
  /** the side it is read from, in its layer's frame. Default [0, 1, 0]: lying flat, read from above */
  normal?: Vec3;
  /**
   * the way it reads, in its layer's frame: along a line, say. Left out, level: up ×
   * `normal`, or +X lying flat
   */
  direction?: Vec3;
  /** its size, as a multiple of its layer's `size` (and `scaleRef`). Default 1 */
  size?: number;
  /**
   * who it is, so it keeps its place on screen as its layer's labels are given anew (a
   * provider's, as the view moves). Left out, its text and position
   */
  id?: string | number;
  /** added to its layer's `priority` where labels meet on screen. Default 0 */
  priority?: number;
  /**
   * the room it has, `[width, height]` along the way it reads and across, in its layer's
   * frame's units (as `position`), about its position as aligned (`align`, `baseline`):
   * its text is broken into the fewest lines (up to its layer's `maxLines`) that fit there
   * at the size it is drawn, else into those with the most room and shrunk to fit, again
   * as the view changes its size. Left out, its text is drawn as it is, line breaks (`\n`)
   * and all, and never shrunk.
   */
  bounds?: [number, number];
  /**
   * places it may be drawn at instead of its own, each with its own text (its lines broken a
   * way of its own), middle, frame and room (`bounds`), in order of preference: drawn at the
   * first whose text fits its room at the size it is drawn, else at the one with the most
   * room, shrunk to fit, again as the view changes its size. What a place leaves out, the
   * label gives; it is not wrapped further. For a polygon's name: a place for each way of
   * breaking it into lines, where that shape fits the polygon best (`GeoLabels`).
   */
  places?: LabelPlace[];
};

/**
 * Somewhere a label may be drawn instead of at its own position, and as what
 * (`Label.places`): what it leaves out, its label gives.
 */
export type LabelPlace = {
  /** its text there, its lines broken by `\n` */
  text?: string;
  position?: Vec3;
  normal?: Vec3;
  direction?: Vec3;
  /** its room there, `[width, height]` (see `Label.bounds`) */
  bounds?: [number, number];
};

/**
 * How a label's size follows the view (`LabelStyle.sizing`):
 * - `'world'`: its font `size` world units, glued to the world: it grows and shrinks on
 *   screen with distance (no larger than `maxPixels`);
 * - `'screen'`: its font `size` CSS pixels at any distance;
 * - `'auto'`: its font `size` CSS pixels near, shrinking smoothly with distance once the
 *   view spans more than `distanceFactor` world units where it is, down to `minScale` of it.
 */
export type LabelSizing = 'world' | 'screen' | 'auto';

/** A font size on screen tuned to read well (see {@link LABEL_SIZE_PRESETS}). */
export type LabelSizePreset =
  | 'xsmall'
  | 'small'
  | 'medium'
  | 'large'
  | 'xlarge';

/** Where a label's text lies along the way it reads, from its position. */
export type LabelAlign = 'left' | 'center' | 'right';

/** Where a label's text lies across the way it reads, from its position. */
export type LabelBaseline = 'top' | 'middle' | 'bottom';

/**
 * How a {@link LabelLayer}'s labels are drawn and shown.
 * @expand
 */
export type LabelStyle = {
  /**
   * CSS font family: one the page has loaded, or a system font. Default the Equinor font,
   * then the system's UI font ({@link LABEL_FONT_FAMILY})
   */
  fontFamily: string;
  /** CSS font weight. Default 400 */
  fontWeight: string | number;
  /** CSS font style: 'normal', 'italic' or 'oblique'. Default 'normal' */
  fontStyle: string;
  /** extra space between letters, in ems. Default 0 */
  letterSpacing: number;
  /** Default '#ffffff' */
  color: string;
  /** the outline drawn round the text, so it reads over anything; its alpha is kept. Default 'rgba(0, 0, 0, 0.85)' */
  haloColor: string;
  /** the outline's width, as a fraction of `size`; 0 for none. Default 0.1 */
  haloWidth: number;
  /**
   * how its size follows the view (see {@link LabelSizing}). A preset `size` is a size on
   * screen: drawn `'screen'` unless `'auto'`. Default 'world'
   */
  sizing: LabelSizing;
  /**
   * its font's size (the em): world units drawn `'world'`, CSS pixels drawn `'screen'` or
   * `'auto'`; or a preset, a size on screen tuned to read well, with its halo and its
   * weight (see {@link LABEL_SIZE_PRESETS}). Drawn `'screen'` or `'auto'` and lying at a
   * slant, it is drawn larger (up to `slantGrowth`) so it reads about as large as seen.
   * Default 10
   */
  size: number | LabelSizePreset;
  /**
   * drawn `'screen'` or `'auto'`: the most it is drawn larger lying at a slant, so it reads
   * about as large as `size` as seen (by one over the square root of its facing); 1 for
   * never. Drawn `'world'`, nothing. Default 2
   */
  slantGrowth: number;
  /**
   * drawn `'auto'`: the view's height in world units, where a label is, up to which it is
   * drawn at its full `size`; past it, it shrinks with distance. Default 1000
   */
  distanceFactor: number;
  /**
   * drawn `'auto'`: the least it shrinks to, as a fraction of its `size`: at 0.6 a `'small'`
   * preset's 12 pixels keep to 7.2, still read whole (`minPixels`). Default 0.6
   */
  minScale: number;
  /**
   * where the text lies along the way it reads from its position: starting there
   * (`'left'`), centred on it, or ending there (`'right'`). Default 'center'
   */
  align: LabelAlign;
  /**
   * where the text lies across the way it reads from its position: below it (`'top'`:
   * its top there), centred on it, or above it (`'bottom'`). Default 'middle'
   */
  baseline: LabelBaseline;
  /** the text moved off its position in its plane, in ems: along the way it reads, and toward its top. Default [0, 0] */
  offset: [number, number];
  /**
   * the most lines a label with room of its own (`Label.bounds`) is broken into to fit it,
   * balanced (its widest line as narrow as it can be). A text with several lines aligns
   * them as `align` says. Default 3
   */
  maxLines: number;
  /**
   * turned to read left to right wherever the camera is: where the way it reads points
   * left on screen, its text is mirrored both ways (turned half round) inside its own quad,
   * so it keeps its place, alignment and offset. Default true
   */
  flip: boolean;
  /** every label's opacity, 0 to 1. Default 1 */
  opacity: number;
  /**
   * the least it reads whole at: its text's height on screen as seen, in CSS pixels — its
   * font's size face-on times the square root of its facing (`labelSeenPixels`), so lying
   * flat at a slant it reads smaller. At or above it, drawn whole; smaller, it fades out,
   * gone at `fadePixels`. Default 7
   */
  minPixels: number;
  /** where it is gone, as `minPixels` measures, CSS pixels. Left out, 0.6 times `minPixels` */
  fadePixels?: number;
  /**
   * the largest it is drawn on screen (its font's size face-on, in CSS pixels): nearer, it
   * is shrunk to this rather than growing; for labels sized for far off. Default Infinity
   */
  maxPixels: number;
  /**
   * how squarely it must face the camera to be drawn whole: the cosine between its normal
   * and the way to the camera. Less, it fades out, gone at `fadeFacing`: only near edge-on,
   * as how small it reads at a slant is `minPixels`'. Never drawn from behind. Default 0.15
   */
  minFacing: number;
  /** the cosine it is gone at. Left out, half `minFacing` */
  fadeFacing?: number;
  /** nearer than this from the camera, in world units, not drawn. Default 0 */
  minDistance: number;
  /** farther than this, not drawn. Default Infinity */
  maxDistance: number;
  /** over how far, in world units, it fades out toward `minDistance` and `maxDistance`; 0 cuts there. Default 0 */
  fadeDistance: number;
  /** hidden behind the scene, where its depth says so. Default true */
  depthTest: boolean;
  /**
   * how far toward the camera it is drawn, in world units, so the surface it lies on does
   * not cut through it. Default 1
   */
  lift: number;
  /**
   * more lift for every world unit of its distance from the camera, so it clears what it
   * lies on far off too, where the depth buffer and the surfaces' own detail grow coarse.
   * A move of the quad itself, not a depth bias: it holds with any depth buffer three.js
   * draws with — linear, logarithmic or reversed. Default 0
   */
  liftPerDistance: number;
};

/** What a {@link LabelsProvider} is given: the view the labels are drawn for. */
export type LabelsView = {
  camera: Camera;
  /** the view's size, in CSS pixels */
  width: number;
  height: number;
};

/**
 * Labels for a view, asked for each time the view changes: for what depends on where the
 * camera is, such as which of a grid's crossings to label.
 */
export type LabelsProvider = (view: LabelsView) => Label[];

/**
 * The labels' default font: the Equinor font where the page has loaded it (from
 * `https://cdn.eds.equinor.com/font/equinor-font.css`), else the system's UI font.
 */
export const LABEL_FONT_FAMILY =
  'Equinor, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** The default {@link LabelStyle}. */
export const LABEL_STYLE_DEFAULTS: LabelStyle = {
  fontFamily: LABEL_FONT_FAMILY,
  fontWeight: 400,
  fontStyle: 'normal',
  letterSpacing: 0,
  color: '#ffffff',
  haloColor: 'rgba(0, 0, 0, 0.85)',
  haloWidth: 0.1,
  sizing: 'world',
  size: 10,
  slantGrowth: 2,
  distanceFactor: 1000,
  minScale: 0.6,
  align: 'center',
  baseline: 'middle',
  offset: [0, 0],
  maxLines: 3,
  flip: true,
  opacity: 1,
  minPixels: 7,
  maxPixels: Infinity,
  minFacing: 0.15,
  minDistance: 0,
  maxDistance: Infinity,
  fadeDistance: 0,
  depthTest: true,
  lift: 1,
  liftPerDistance: 0,
};

/** What a {@link LabelSizePreset} sets: its font's size on screen and how it reads best there. */
export type LabelSizePresetStyle = Pick<LabelStyle, 'haloWidth'> &
  Partial<Pick<LabelStyle, 'fontWeight' | 'letterSpacing'>> & {
    /** its font's size (the em), in CSS pixels */
    size: number;
  };

/**
 * The size presets: each a font size on screen, with a halo about 1.5 to 2 pixels wide
 * (thin, but enough to read over anything), and for the smallest a heavier weight and
 * wider spacing. All read whole (`minPixels`, 7) as they are, and drawn `'auto'` down to
 * `minScale` (0.6) all but `xsmall`. What a style gives itself wins over its preset.
 */
export const LABEL_SIZE_PRESETS: Record<LabelSizePreset, LabelSizePresetStyle> =
  {
    xsmall: {
      size: 10,
      haloWidth: 0.16,
      fontWeight: 500,
      letterSpacing: 0.02,
    },
    small: { size: 12, haloWidth: 0.13, letterSpacing: 0.01 },
    medium: { size: 14, haloWidth: 0.11 },
    large: { size: 18, haloWidth: 0.09 },
    xlarge: { size: 24, haloWidth: 0.08 },
  };

/** A {@link LabelStyle} with its size a number: a preset resolved. */
export type ResolvedLabelStyle = Omit<LabelStyle, 'size'> & { size: number };

/**
 * A full style from `style`: its defaults filled in (`LABEL_STYLE_DEFAULTS`), and a preset
 * `size` resolved to its pixels and look (`LABEL_SIZE_PRESETS`), drawn `'screen'` unless
 * `'auto'`. Null and undefined values are left out, as not given.
 */
export function resolveLabelStyle(
  style: Partial<LabelStyle> = {},
): ResolvedLabelStyle {
  const given: Partial<LabelStyle> = {};
  for (const key of Object.keys(style) as (keyof LabelStyle)[]) {
    if (style[key] != null)
      (given as Record<string, unknown>)[key] = style[key];
  }
  const size = given.size ?? LABEL_STYLE_DEFAULTS.size;
  if (typeof size === 'string') {
    const { size: pixels, ...look } =
      LABEL_SIZE_PRESETS[size] ?? LABEL_SIZE_PRESETS.medium;
    return {
      ...LABEL_STYLE_DEFAULTS,
      ...look,
      ...given,
      size: pixels,
      sizing: given.sizing === 'auto' ? 'auto' : 'screen',
    };
  }
  return { ...LABEL_STYLE_DEFAULTS, ...given, size };
}
