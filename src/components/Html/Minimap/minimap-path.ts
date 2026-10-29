import type { MapView } from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';
import {
  clipPolylineToRect,
  clipRingToRect,
  type Rect2,
} from '../../../sdk/utils/clip-2d';

/** Pixels round a minimap that paths are still drawn over, when cut to it: wider than any stroke. */
export const MINIMAP_CLIP_MARGIN = 16;

/** A minimap's view in pixels, `margin` round it: what its paths are cut to. */
export function minimapClipRect(
  view: MapView,
  margin = MINIMAP_CLIP_MARGIN,
): Rect2 {
  return [-margin, -margin, view.size[0] + margin, view.size[1] + margin];
}

/**
 * SVG path data for `pixels` (a line, or a ring when `closed`) on a minimap, only what lies
 * in `clip` (`minimapClipRect`): a browser strokes, dashes and fills a path at its full
 * length, and an outline or a route crossing a map zoomed in reaches a million pixels past
 * it — a hundred milliseconds a frame where the camera moves. A ring is cut as an area
 * (`clipRingToRect`), its cuts along the margin, out of sight; a line into the runs in view.
 */
export function minimapPathData(
  pixels: Vec2[],
  closed: boolean,
  clip: Rect2,
): string {
  const runs = closed
    ? [clipRingToRect(pixels, clip)]
    : clipPolylineToRect(pixels, clip);
  let d = '';
  for (const run of runs) {
    if (run.length < 2) continue;
    for (let k = 0; k < run.length; k++)
      d += `${k === 0 ? 'M' : 'L'}${run[k][0].toFixed(1)} ${run[k][1].toFixed(1)}`;
    if (closed) d += 'Z';
  }
  return d;
}
