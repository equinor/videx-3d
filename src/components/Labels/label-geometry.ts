import { Vector3 } from 'three';
import type { Vec3 } from '../../sdk/types/common';
import type { LabelSizing, LabelStyle } from './types';

// ⚠️ Pure: no canvas, no renderer.

const WORLD_UP = new Vector3(0, 1, 0);
const EAST = new Vector3(1, 0, 0);

/**
 * A label's frame in the world: the way it reads (`along`) and the top of its text (`top`),
 * both unit length and square to its unit `normal`. The way it reads is `direction` laid
 * into its plane; without one, or along the normal, level: world up × normal, or east lying
 * flat.
 */
export function labelFrame(
  normal: Vector3,
  direction: Vec3 | undefined,
  along: Vector3,
  top: Vector3,
) {
  if (direction) {
    along.fromArray(direction);
    top.crossVectors(normal, along);
  }
  if (!direction || top.lengthSq() < 1e-12) {
    along.crossVectors(WORLD_UP, normal);
    if (along.lengthSq() < 1e-12) along.copy(EAST);
    top.crossVectors(normal, along);
  }
  top.normalize();
  along.crossVectors(top, normal);
}

/** Where a label's fades start and end (see {@link labelFadeRanges}). */
export type LabelFadeRanges = {
  /** the cosine it is gone at, and is whole from */
  facing: [number, number];
  /** its text's height on screen as seen, CSS pixels, it is gone at, and is whole from */
  pixels: [number, number];
};

/**
 * Where a style's fades start and end: whole from `minFacing` and `minPixels`, what it
 * reads whole at, and gone at `fadeFacing` and `fadePixels` below them (or their defaults,
 * half and 0.6 times them). A label that reads whole never fades.
 */
export function labelFadeRanges(
  style: LabelStyle,
  target: LabelFadeRanges = { facing: [0, 0], pixels: [0, 0] },
): LabelFadeRanges {
  const { minFacing, minPixels } = style;
  target.facing[0] = Math.min(style.fadeFacing ?? 0.5 * minFacing, minFacing);
  target.facing[1] = minFacing;
  target.pixels[0] = Math.min(style.fadePixels ?? 0.6 * minPixels, minPixels);
  target.pixels[1] = minPixels;
  return target;
}

/** From 0 at `from` (and below) to 1 at `to` (and above); a step at `from` if they meet. */
export function labelRamp(value: number, from: number, to: number) {
  if (to > from) return Math.min(Math.max((value - from) / (to - from), 0), 1);
  return value >= from ? 1 : 0;
}

/** About how wide a character is, in ems, for a text not yet measured: a little over most fonts'. */
export const LABEL_CHARACTER_WIDTH = 0.6;

/**
 * About how far a centred label's text reaches from its position, its font's size `size`
 * in world units: half its diagonal, at {@link LABEL_CHARACTER_WIDTH} an em a character, its
 * line and halo included. For what must know before its text is measured (a label lifted
 * over the highest ground under it, say); on the large side.
 */
export function labelReachEstimate(text: string, size: number) {
  const width = LABEL_CHARACTER_WIDTH * text.length + 0.4;
  const height = 1.6;
  return 0.5 * size * Math.sqrt(width * width + height * height);
}

/**
 * How wide the bends of `labelAutoScale` are, on a log scale: about a factor of 1.5 in
 * distance. Outside them it is exact.
 */
export const LABEL_AUTO_KNEE = 0.4;

// The lesser of `a` and `b`, bent over `k` where they meet (a polynomial smooth minimum):
// exactly the lesser once they are `k` apart.
const smoothMin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

/**
 * Drawn `'auto'`, how much of its `size` a label is drawn at, `minScale` to 1, where the view
 * spans `span` world units top to bottom: 1 up to `distanceFactor`, then shrinking as
 * `distanceFactor / span` (as an annotation's `scaleFactor`), no smaller than `minScale`;
 * bent smoothly into both bounds on a log scale ({@link LABEL_AUTO_KNEE}), so its size never
 * turns sharply as the view zooms.
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) does the same: keep them alike.
 */
export function labelAutoScale(
  distanceFactor: number,
  minScale: number,
  span: number,
) {
  const least = Math.min(Math.max(minScale, 1e-6), 1);
  if (least >= 1) return 1;
  const k = LABEL_AUTO_KNEE;
  const x = Math.log(Math.max(distanceFactor, 1e-30) / Math.max(span, 1e-30));
  const low = Math.log(least);
  return Math.exp(smoothMin(-smoothMin(-x, -low, k), 0, k));
}

/**
 * A label's font size on screen face-on, in CSS pixels, as its style's `sizing` draws it,
 * before `maxPixels` shrinks it: `own` its own size (`Label.size` times the layer's
 * `scaleRef`), `perUnit` the CSS pixels a world unit spans face-on where it is, in a view
 * `viewHeight` CSS pixels high, at `facing` (the cosine between its normal and the way to
 * the camera). Sized on screen, a label seen at a slant is drawn larger by one over the
 * square root of its facing, at most `slantGrowth` times (1: never), so it reads as large
 * as asked as seen (`labelSeenPixels`).
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) does the same: keep them alike.
 */
export function labelPixels(
  style: {
    sizing: LabelSizing;
    size: number;
    distanceFactor: number;
    minScale: number;
    slantGrowth: number;
  },
  own: number,
  perUnit: number,
  viewHeight: number,
  facing = 1,
) {
  const em = style.size * own;
  if (style.sizing === 'world') return em * perUnit;
  const slant = Math.max(
    Math.sqrt(Math.max(facing, 0)),
    labelSlantLeast(style.slantGrowth),
  );
  if (style.sizing === 'screen') return em / slant;
  return (
    (em *
      labelAutoScale(
        style.distanceFactor,
        style.minScale,
        viewHeight / Math.max(perUnit, 1e-30),
      )) /
    slant
  );
}

/**
 * The least a label sized on screen divides its size by lying at a slant, for growth up to
 * `slantGrowth` times: the square root of its facing, no less than this (1 for none).
 */
export function labelSlantLeast(slantGrowth: number) {
  return 1 / Math.max(slantGrowth, 1);
}

/**
 * How large a label's text reads on screen, as seen, CSS pixels: its font's size face-on
 * (`faceOn`) times the square root of `facing`. Lying flat at a slant its letters are
 * foreshortened across the way it reads but not along it, so they read larger than their
 * height alone; far toward edge-on it still thins to nothing.
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) does the same: keep them alike.
 */
export function labelSeenPixels(faceOn: number, facing: number) {
  return faceOn * Math.sqrt(Math.max(facing, 0));
}

/**
 * Where a label's text lies from its position, in its own size (its quad's width and
 * height): `[x, y]` to move its middle by, along the way it reads and toward its top.
 */
export function labelAnchor(
  align: LabelStyle['align'],
  baseline: LabelStyle['baseline'],
): [number, number] {
  const x = align === 'left' ? 0.5 : align === 'right' ? -0.5 : 0;
  const y = baseline === 'bottom' ? 0.5 : baseline === 'top' ? -0.5 : 0;
  return [x, y];
}

const ranges: LabelFadeRanges = { facing: [0, 0], pixels: [0, 0] };

/**
 * How far the readable way of a label is turned from screen right toward up, in degrees
 * (`LabelStyle.flip`): a label reading within it of straight down is turned to read up,
 * the map maker's way, and one along a line straight up or down the screen does not flip
 * back and forth as the view turns by a hair.
 */
export const LABEL_FLIP_TILT = 10;

const FLIP_COS = Math.cos((LABEL_FLIP_TILT * Math.PI) / 180);
const FLIP_SIN = Math.sin((LABEL_FLIP_TILT * Math.PI) / 180);

/**
 * Whether a label whose way of reading runs `x`, `y` on screen (right and up) reads
 * backward, and is turned half round when its layer flips (`LabelStyle.flip`): pointing
 * away from {@link LABEL_FLIP_TILT} above screen right by more than a right angle.
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) does the same: keep them alike.
 */
export function labelReadsBackward(x: number, y: number) {
  const along = x * FLIP_COS + y * FLIP_SIN;
  return along < 0 || (along === 0 && y * FLIP_COS - x * FLIP_SIN < 0);
}

/**
 * How much of a label shows, 0 to 1: none from behind or outside its layer's distances,
 * fading out over `fadeDistance` toward them; whole while it reads whole — facing at least
 * `minFacing`, and its text's height on screen as seen at least `minPixels`
 * (`labelSeenPixels` of `pixels`, capped at `maxPixels` as the label is shrunk to it) — and
 * fading out below them, gone at `fadeFacing` and `fadePixels`; fading out as `depth` (its
 * farthest corner along the view) nears `far`, the camera's far plane, from 90 % of it to
 * 99 % (none with no `far`); times its layer's `opacity`. `facing` is the cosine between
 * its normal and the way to the camera; `pixels` its font's size on screen face-on, in CSS
 * pixels. So a label lying flat fades out toward the horizon as it thins to slivers, which
 * would only shimmer, however large it is face-on.
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) does the same: keep them alike.
 */
export function labelFade(
  style: LabelStyle,
  facing: number,
  pixels: number,
  distance: number,
  depth = 0,
  far = 0,
) {
  if (facing <= 0) return 0;
  const { minDistance, maxDistance, fadeDistance } = style;
  if (distance < minDistance || distance > maxDistance) return 0;
  const fade = Math.max(fadeDistance, 0);
  const near =
    minDistance > 0 ? labelRamp(distance, minDistance, minDistance + fade) : 1;
  const farthest = labelRamp(-distance, -maxDistance, -maxDistance + fade);
  const beyond = far > 0 ? 1 - labelRamp(depth, 0.9 * far, 0.99 * far) : 1;
  const drawn = Math.min(pixels, style.maxPixels);
  labelFadeRanges(style, ranges);
  return (
    near *
    farthest *
    beyond *
    labelRamp(facing, ranges.facing[0], ranges.facing[1]) *
    labelRamp(
      labelSeenPixels(drawn, facing),
      ranges.pixels[0],
      ranges.pixels[1],
    ) *
    style.opacity
  );
}
