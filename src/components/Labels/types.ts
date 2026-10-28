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
};

/** Where a label's text lies along the way it reads, from its position. */
export type LabelAlign = 'left' | 'center' | 'right';

/** Where a label's text lies across the way it reads, from its position. */
export type LabelBaseline = 'top' | 'middle' | 'bottom';

/**
 * How a {@link LabelLayer}'s labels are drawn and shown.
 * @expand
 */
export type LabelStyle = {
  /** CSS font family. Default 'sans-serif' */
  fontFamily: string;
  /** CSS font weight. Default 600 */
  fontWeight: string | number;
  /** CSS font style: 'normal', 'italic' or 'oblique'. Default 'normal' */
  fontStyle: string;
  /** extra space between letters, in ems. Default 0 */
  letterSpacing: number;
  /** Default '#ffffff' */
  color: string;
  /** the outline drawn round the text, so it reads over anything; its alpha is kept. Default 'rgba(0, 0, 0, 0.75)' */
  haloColor: string;
  /** the outline's width, as a fraction of `size`; 0 for none. Default 0.15 */
  haloWidth: number;
  /** its font's size (the em), in world units. Default 10 */
  size: number;
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
   * turned to read left to right wherever the camera is: where the way it reads points
   * left on screen, its text is mirrored both ways (turned half round) inside its own quad,
   * so it keeps its place, alignment and offset. Default false
   */
  flip: boolean;
  /** every label's opacity, 0 to 1. Default 1 */
  opacity: number;
  /** smaller than this on screen (its text's height as seen, its slant included, in CSS pixels), not drawn. Default 6 */
  minPixels: number;
  /** from this size on screen, in CSS pixels, drawn fully; it fades in from `minPixels`. Left out, 1.5 times `minPixels` */
  fullPixels?: number;
  /**
   * the largest it is drawn on screen (its font's size face-on, in CSS pixels): nearer, it
   * is shrunk to this rather than growing; for labels sized for far off. Default Infinity
   */
  maxPixels: number;
  /**
   * how squarely it must face the camera to be drawn: the cosine between its normal and the
   * way to the camera. Never drawn from behind. Default 0.2
   */
  minFacing: number;
  /** from this cosine on, drawn fully; it fades in from `minFacing`. Left out, twice `minFacing` */
  fullFacing?: number;
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

/** The default {@link LabelStyle}. */
export const LABEL_STYLE_DEFAULTS: LabelStyle = {
  fontFamily: 'sans-serif',
  fontWeight: 600,
  fontStyle: 'normal',
  letterSpacing: 0,
  color: '#ffffff',
  haloColor: 'rgba(0, 0, 0, 0.75)',
  haloWidth: 0.15,
  size: 10,
  align: 'center',
  baseline: 'middle',
  offset: [0, 0],
  flip: false,
  opacity: 1,
  minPixels: 6,
  maxPixels: Infinity,
  minFacing: 0.2,
  minDistance: 0,
  maxDistance: Infinity,
  fadeDistance: 0,
  depthTest: true,
  lift: 1,
  liftPerDistance: 0,
};
