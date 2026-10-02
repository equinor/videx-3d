import { Vec2 } from '../types/common';
import { pointAtArcLength, polylineArcLengths } from '../utils/polyline-2d';
import { pointInRing } from './polygon-outline';

/** Where to sample along a fence side. See {@link sampleFencePath}. */
export type FencePathSamples = {
  /** the positions to sample, evenly spaced along the curve */
  points: Vec2[];
  /** arc length of the first and last position, in the curve's own metres */
  along: Vec2;
};

/**
 * Evenly spaced positions along a fence curve, for sampling data under its cut face.
 *
 * ⭐ Only the span of the curve inside `rings` (even-odd) is sampled, from one vertex before it
 * enters to one after it leaves: the run-outs reach kilometres past the block, where there is no
 * face to draw on.
 *
 * @param curve the side's cut curve, in scene XZ — the arc lengths match the face's `uv.x`
 * @param rings the stack's outline rings; empty samples the whole curve
 * @param step wanted spacing in metres, widened as needed to stay within `maxColumns`
 * @param maxColumns most positions to return, at least 2
 * @returns `null` when the curve never enters `rings`
 *
 * @group Geometries
 */
export function sampleFencePath(
  curve: Vec2[],
  rings: Vec2[][],
  step: number,
  maxColumns: number,
): FencePathSamples | null {
  if (curve.length < 2) return null;
  let first = 0;
  let last = curve.length - 1;
  if (rings.length > 0) {
    const inside = (p: Vec2) => {
      let within = false;
      for (const ring of rings) {
        if (pointInRing(p[0], p[1], ring)) within = !within;
      }
      return within;
    };
    first = curve.findIndex(inside);
    if (first < 0) return null;
    while (!inside(curve[last])) last--;
    first = Math.max(0, first - 1);
    last = Math.min(curve.length - 1, last + 1);
  }
  const arc = polylineArcLengths(curve);
  const start = arc[first];
  const end = arc[last];
  const span = end - start;
  if (!(span > 0)) return null;

  const columns = Math.max(
    2,
    Math.min(
      Math.max(2, maxColumns),
      Math.ceil(span / Math.max(step, 1e-3)) + 1,
    ),
  );
  const spacing = span / (columns - 1);
  const points: Vec2[] = [];
  for (let i = 0; i < columns; i++) {
    points.push(pointAtArcLength(curve, arc, start + i * spacing));
  }
  return { points, along: [start, end] };
}
