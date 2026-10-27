import { Vector3 } from 'three';
import type { Vec3 } from '../../sdk/types/common';
import type { LabelStyle } from './types';

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
  /** the cosine it shows from, and is whole from */
  facing: [number, number];
  /** its font's size on screen, in CSS pixels, it shows from, and is whole from */
  pixels: [number, number];
};

/** Where a style's fades start and end: its `full…` bounds, or their defaults. */
export function labelFadeRanges(
  style: LabelStyle,
  target: LabelFadeRanges = { facing: [0, 0], pixels: [0, 0] },
): LabelFadeRanges {
  const { minFacing, minPixels } = style;
  target.facing[0] = minFacing;
  target.facing[1] = Math.max(style.fullFacing ?? 2 * minFacing, minFacing);
  target.pixels[0] = minPixels;
  target.pixels[1] = Math.max(style.fullPixels ?? 1.5 * minPixels, minPixels);
  return target;
}

/** From 0 at `from` (and below) to 1 at `to` (and above); a step at `from` if they meet. */
export function labelRamp(value: number, from: number, to: number) {
  if (to > from) return Math.min(Math.max((value - from) / (to - from), 0), 1);
  return value >= from ? 1 : 0;
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
 * How much of a label shows, 0 to 1: none from behind or outside its layer's distances,
 * fading out over `fadeDistance` toward them; fading in from `minFacing` to `fullFacing`,
 * and from `minPixels` to `fullPixels`; times its layer's `opacity`. `facing` is the cosine
 * between its normal and the way to the camera; `pixels` its font's size on screen, in CSS
 * pixels.
 *
 * ⚠️ The labels' vertex shader (`shaders/label-vertex.glsl`) does the same: keep them alike.
 */
export function labelFade(
  style: LabelStyle,
  facing: number,
  pixels: number,
  distance: number,
) {
  if (facing <= 0) return 0;
  const { minDistance, maxDistance, fadeDistance } = style;
  if (distance < minDistance || distance > maxDistance) return 0;
  const fade = Math.max(fadeDistance, 0);
  const near =
    minDistance > 0 ? labelRamp(distance, minDistance, minDistance + fade) : 1;
  const far = labelRamp(-distance, -maxDistance, -maxDistance + fade);
  labelFadeRanges(style, ranges);
  return (
    near *
    far *
    labelRamp(facing, ranges.facing[0], ranges.facing[1]) *
    labelRamp(pixels, ranges.pixels[0], ranges.pixels[1]) *
    style.opacity
  );
}
