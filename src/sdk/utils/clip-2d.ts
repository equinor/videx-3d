import type { Vec2 } from '../types/common';

// ⚠️ Free of three.js.

/**
 * An axis-aligned rectangle: `[minX, minY, maxX, maxY]`.
 *
 * @group Utils
 */
export type Rect2 = [number, number, number, number];

/**
 * Where the segment `a`→`b` lies inside `rect` (Liang–Barsky): its parameters along it,
 * `[t0, t1]` within 0…1, or null where none of it does.
 *
 * @group Utils
 */
export function clipSegmentToRect(
  a: Vec2,
  b: Vec2,
  rect: Rect2,
): [number, number] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - rect[0]],
    [dx, rect[2] - a[0]],
    [-dy, a[1] - rect[1]],
    [dy, rect[3] - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [t0, t1];
}

const along = (a: Vec2, b: Vec2, t: number): Vec2 =>
  t === 0
    ? a
    : t === 1
      ? b
      : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * The parts of a polyline inside `rect`: each run of it that stays inside, cut where it
 * crosses the edge. A line that leaves and comes back is two runs; one that never enters,
 * none. For drawing what is in view only: a path whose points lie far off a view costs its
 * full length to draw (a browser strokes an SVG path whole).
 *
 * @group Utils
 */
export function clipPolylineToRect(points: Vec2[], rect: Rect2): Vec2[][] {
  const runs: Vec2[][] = [];
  if (points.length === 1) {
    const [x, y] = points[0];
    if (x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3])
      runs.push([points[0]]);
    return runs;
  }
  let run: Vec2[] | null = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const kept = clipSegmentToRect(a, b, rect);
    if (!kept) {
      run = null;
      continue;
    }
    const [t0, t1] = kept;
    if (!run || t0 > 0) {
      run = [along(a, b, t0)];
      runs.push(run);
    }
    run.push(along(a, b, t1));
    if (t1 < 1) run = null;
  }
  return runs;
}

/**
 * A closed ring clipped to `rect` (Sutherland–Hodgman): the part of its area inside, as a
 * ring, its cuts running along the rectangle's edges; empty where none of it is inside. A
 * concave ring cut in two stays one ring, joined along the edge: draw it with its edge
 * outside the view (a margin wider than its stroke).
 *
 * @group Utils
 */
export function clipRingToRect(points: Vec2[], rect: Rect2): Vec2[] {
  let ring = points;
  const sides: [axis: 0 | 1, bound: number, keepAbove: boolean][] = [
    [0, rect[0], true],
    [0, rect[2], false],
    [1, rect[1], true],
    [1, rect[3], false],
  ];
  for (const [axis, bound, keepAbove] of sides) {
    if (ring.length === 0) break;
    const inside = (p: Vec2) =>
      keepAbove ? p[axis] >= bound : p[axis] <= bound;
    const out: Vec2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const current = ring[i];
      const previous = ring[(i + ring.length - 1) % ring.length];
      const hereIn = inside(current);
      const beforeIn = inside(previous);
      if (hereIn !== beforeIn) {
        const t = (bound - previous[axis]) / (current[axis] - previous[axis]);
        out.push(along(previous, current, t));
      }
      if (hereIn) out.push(current);
    }
    ring = out;
  }
  return ring;
}
