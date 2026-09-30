import RBush from 'rbush';
import { Vec2 } from '../types/common';
import { distanceVec2 } from './vector-operations';

/**
 * Arc lengths, as a multiple of the push cap, that a clearance lift is blurred over.
 *
 * ⭐ Bounds the turn the lift can introduce: rising by `maxPush` over this much arc is a
 * slope of `1 / PUSH_BLUR_ARCS`, so a larger value is a gentler ramp at the cost of lifting
 * more of the curve than strictly needs it.
 */
const PUSH_BLUR_ARCS = 8;

/**
 * Open polylines in a plane, and the operations a swept vertical surface needs
 * from them: resampling, offsetting, measuring how tightly they turn, and
 * straightening them without letting them wander.
 *
 * ⭐ These are deliberately plain geometry with no knowledge of wellbores or
 * fences. The fence builds a curve out of them; the seismic section could use the
 * same ones.
 *
 * @module
 */

/** The left normal of a direction: the tangent turned a quarter turn in +XZ. */
export function leftNormal2D(tx: number, tz: number): Vec2 {
  const len = Math.hypot(tx, tz) || 1;
  return [-tz / len, tx / len];
}

/**
 * Axis-aligned bounds of a point set, as `[minX, minZ, maxX, maxZ]`.
 *
 * @group Utils
 */
export function polylineBounds2D(
  points: Vec2[],
): [number, number, number, number] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return [minX, minZ, maxX, maxZ];
}

/**
 * The convex hull of a point set, counter-clockwise, as an open ring (the first point is
 * not repeated at the end).
 *
 * ⭐ Andrew's monotone chain — O(n log n). Degenerate inputs (fewer than three unique
 * points, or all collinear) return their extreme points as-is, so a caller can still draw
 * or measure them without special-casing.
 *
 * @group Utils
 */
export function convexHull2D(points: Vec2[]): Vec2[] {
  const pts = points
    .map(p => [p[0], p[1]] as Vec2)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = pts.length;
  if (n < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Whether two CONVEX polygons share any area, boundaries included.
 *
 * ⭐ The separating-axis test: two convex sets are disjoint if and only if some line separates
 * them, and for polygons only the edge normals can be that line. Exact — no sampling, no
 * point-in-polygon loop that misses a crossing with no vertex inside either shape.
 *
 * ⚠️ CONVEX ONLY, and undefined for anything else. Winding does not matter.
 *
 * @param a a convex ring, as {@link convexHull2D} returns
 * @param b a convex ring
 * @param tolerance how far apart they must be to count as separate, in metres; the default 0
 * makes touching count as overlapping
 *
 * @group Utils
 */
export function convexOverlap2D(a: Vec2[], b: Vec2[], tolerance = 0): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const separated = (edges: Vec2[]): boolean => {
    for (let i = 0; i < edges.length; i++) {
      const p = edges[i];
      const q = edges[(i + 1) % edges.length];
      const nx = -(q[1] - p[1]);
      const nz = q[0] - p[0];
      const len = Math.hypot(nx, nz);
      if (len < 1e-12) continue;
      const ax = nx / len;
      const az = nz / len;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const v of a) {
        const t = v[0] * ax + v[1] * az;
        if (t < minA) minA = t;
        if (t > maxA) maxA = t;
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of b) {
        const t = v[0] * ax + v[1] * az;
        if (t < minB) minB = t;
        if (t > maxB) maxB = t;
      }
      if (maxA < minB - tolerance || maxB < minA - tolerance) return true;
    }
    return false;
  };
  return !separated(a) && !separated(b);
}

/**
 * The vertex where a straight approach from an EXTERNAL point touches a convex ring with the whole
 * ring on one side of the chord — `keepLeft` picks which of the two tangents.
 *
 * ⛔ NOT the nearest boundary point. A tangent chord provably cannot enter the ring, and the vertex
 * it touches lies on the side the traveller passes; a nearest-point footing is neither, and can sit
 * BEHIND the direction of travel, which emits the walk backwards as a near-reversal.
 *
 * ⚠️⚠️ UNDEFINED for a point INSIDE the ring — the scan returns an arbitrary vertex and the walk
 * takes the long way round. Callers must establish that `p` is outside.
 *
 * All of a convex ring lies within a cone of less than pi as seen from an external point, so the
 * angular extreme is found by one linear scan.
 *
 * @group Utils
 */
export function convexTangentVertex2D(
  p: Vec2,
  ring: Vec2[],
  keepLeft: boolean,
): number {
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    const turn =
      (ring[best][0] - p[0]) * (ring[i][1] - p[1]) -
      (ring[best][1] - p[1]) * (ring[i][0] - p[0]);
    if (keepLeft ? turn < 0 : turn > 0) best = i;
  }
  return best;
}

/**
 * The ring vertices from `from` to `to` INCLUSIVE, walking in `dir` (+1 = index order).
 *
 * @group Utils
 */
export function convexRingArc2D(
  ring: Vec2[],
  from: number,
  to: number,
  dir: 1 | -1,
): Vec2[] {
  const n = ring.length;
  const out: Vec2[] = [];
  let k = from;
  for (let step = 0; step <= n; step++) {
    out.push(ring[k]);
    if (k === to) return out;
    k = (k + dir + n) % n;
  }
  throw new Error(
    `convexRingArc2D: the walk did not close over ${n} ring vertices`,
  );
}

/**
 * The direction a point cloud is most spread along, as a unit vector.
 *
 * ⭐ The major axis of the covariance, so it is the SPREAD's direction and not the
 * end-to-end chord — a curve that comes back on itself still reports the axis it
 * runs along, which is the one worth looking at it across.
 *
 * ⚠️ An axis has no sign: the result may point either way along it.
 *
 * @group Utils
 */
export function principalDirection2D(points: Vec2[]): Vec2 {
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p[0];
    cz += p[1];
  }
  cx /= points.length;
  cz /= points.length;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of points) {
    const dx = p[0] - cx;
    const dz = p[1] - cz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return [Math.cos(theta), Math.sin(theta)];
}

/**
 * Cumulative length at each vertex, in the polyline's own units.
 *
 * @group Utils
 */
export function polylineArcLengths(points: Vec2[]): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1] + distanceVec2(points[i - 1], points[i]);
  }
  return out;
}

/**
 * Total length of an open polyline.
 *
 * @group Utils
 */
export function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceVec2(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Split any segment longer than `maxSpacing`, KEEPING every original vertex.
 *
 * ⭐ The complement of {@link resamplePolyline2D}: that one imposes a spacing by discarding the
 * input's own vertices, which throws away deliberately placed detail and then approximates it
 * back at high density. This one only ever ADDS points, so a simplified curve can be given a
 * spacing bound without losing the shape the simplification chose to keep.
 *
 * @group Utils
 */
export function subdividePolyline2D(
  points: Vec2[],
  maxSpacing: number,
): Vec2[] {
  if (points.length < 2 || !(maxSpacing > 0)) return points;
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.ceil(distanceVec2(a, b) / maxSpacing);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
  }
  return out;
}

/**
 * Resample an open polyline at a fixed spacing, keeping both endpoints.
 *
 * ⚠️⚠️ The final vertex REPLACES the last emitted one when the leftover is tiny,
 * rather than being appended after it. An appended near-duplicate is invisible in
 * the geometry but leaves the end of the curve with no direction, so anything
 * measured there — a tangent, a junction angle, an end normal — is numerical noise.
 *
 * @group Utils
 */
export function resamplePolyline2D(points: Vec2[], spacing: number): Vec2[] {
  if (points.length < 2 || !(spacing > 0)) return points;
  const out: Vec2[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = distanceVec2(a, b);
    if (len === 0) continue;
    let at = spacing - carry;
    while (at < len) {
      const t = at / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += spacing;
    }
    carry = (carry + len) % spacing;
  }
  const last = points[points.length - 1];
  if (
    out.length > 1 &&
    distanceVec2(out[out.length - 1], last) < spacing * 0.25
  ) {
    out[out.length - 1] = last;
  } else {
    out.push(last);
  }
  return out;
}

/**
 * Drop vertices closer together than `minSpacing`, keeping both endpoints.
 *
 * ⚠️ Coincident vertices have no direction, so they read as perfectly straight to
 * every curvature measure and hide the corner they sit on.
 *
 * @group Utils
 */
export function dedupePolyline2D(points: Vec2[], minSpacing: number): Vec2[] {
  if (points.length < 3) return points;
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distanceVec2(out[out.length - 1], points[i]) >= minSpacing) {
      out.push(points[i]);
    }
  }
  const last = points[points.length - 1];
  // Drop a kept point that the endpoint would sit on top of, but never the first.
  if (out.length > 1 && distanceVec2(out[out.length - 1], last) < minSpacing) {
    out.pop();
  }
  out.push(last);
  return out;
}

/** The nearest point on a polyline to a query point. @group Utils */
export type PolylineHit = {
  /** the closest point on the polyline */
  point: Vec2;
  /** distance to it */
  distance: number;
  /** how far along the polyline it lies */
  along: number;
};

/**
 * Exact nearest point on an open polyline.
 *
 * @param out reused to avoid allocating per query
 *
 * @group Utils
 */
export function nearestOnPolyline(
  points: Vec2[],
  x: number,
  z: number,
  out?: PolylineHit,
): PolylineHit | null {
  if (points.length === 0) return null;
  const result = out ?? { point: [0, 0] as Vec2, distance: 0, along: 0 };
  if (points.length === 1) {
    result.point[0] = points[0][0];
    result.point[1] = points[0][1];
    result.distance = Math.hypot(x - points[0][0], z - points[0][1]);
    result.along = 0;
    return result;
  }
  let best = Infinity;
  let arc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez;
    const len = Math.sqrt(len2);
    let t = 0;
    if (len2 > 0) {
      t = ((x - a[0]) * ex + (z - a[1]) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const qx = a[0] + ex * t;
    const qz = a[1] + ez * t;
    const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
    if (d2 < best) {
      best = d2;
      result.point[0] = qx;
      result.point[1] = qz;
      result.along = arc + t * len;
    }
    arc += len;
  }
  result.distance = Math.sqrt(best);
  return result;
}

/** Interpolate a point at a given arc length along a polyline. @group Utils */
export function pointAtArcLength(
  points: Vec2[],
  arc: Float64Array,
  at: number,
): Vec2 {
  const n = points.length;
  if (n === 0) return [0, 0];
  if (at <= 0) return [points[0][0], points[0][1]];
  const total = arc[n - 1];
  if (at >= total) return [points[n - 1][0], points[n - 1][1]];
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= at) lo = mid;
    else hi = mid;
  }
  const span = arc[hi] - arc[lo];
  const t = span > 1e-12 ? (at - arc[lo]) / span : 0;
  return [
    points[lo][0] + (points[hi][0] - points[lo][0]) * t,
    points[lo][1] + (points[hi][1] - points[lo][1]) * t,
  ];
}

/**
 * Resample an open polyline with a spacing that GROWS geometrically from its start.
 *
 * ⭐⭐ For joining a coarse curve onto a fine one. A long segment meeting a short one is
 * read as a sharp edge by any arm-weighted rule even where the underlying shape is no
 * sharper than the fine curve's own wiggle — the flag is the DENSITY step, not the
 * geometry. Grading the coarse side into the joint removes it honestly: the two curves
 * meet at comparable segment lengths, so the joint is judged on the same scale as the
 * neighbours it sits between.
 *
 * @param points an open polyline
 * @param first metres of the first segment
 * @param last metres the spacing is allowed to grow to
 * @param growth ratio per step. Default 1.3.
 *
 * @group Utils
 */
export function gradePolyline2D(
  points: Vec2[],
  first: number,
  last: number,
  growth = 1.3,
): Vec2[] {
  const copy = () => points.map(p => [p[0], p[1]] as Vec2);
  if (points.length < 2 || !(first > 0) || !(last >= first) || !(growth > 1)) {
    return copy();
  }
  const arc = polylineArcLengths(points);
  const total = arc[points.length - 1];
  if (!(total > 0)) return copy();
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  let at = 0;
  let step = first;
  while (at + step < total) {
    at += step;
    out.push(pointAtArcLength(points, arc, at));
    step = Math.min(last, step * growth);
  }
  const end = points[points.length - 1];
  // Drop a leftover stub rather than emit it: a fraction-of-a-step final segment says more
  // about what the walk had left over than about the shape.
  if (out.length > 1 && total - at < step * 0.5) out.pop();
  out.push([end[0], end[1]]);
  return out;
}

/** Distance between two segments, 0 when they intersect. */
function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (
    orient2D(a[0], a[1], b[0], b[1], c[0], c[1]) *
      orient2D(a[0], a[1], b[0], b[1], d[0], d[1]) <
      0 &&
    orient2D(c[0], c[1], d[0], d[1], a[0], a[1]) *
      orient2D(c[0], c[1], d[0], d[1], b[0], b[1]) <
      0
  ) {
    return 0;
  }
  return Math.min(
    distToSegment(a, c, d),
    distToSegment(b, c, d),
    distToSegment(c, a, b),
    distToSegment(d, a, b),
  );
}

/** One segment of an indexed polyline, as rbush wants it. */
type IndexedSegment = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** segment `points[j - 1] .. points[j]` */
  j: number;
};

/**
 * A polyline's segments in an R-tree — built ONCE, queried many times.
 *
 * ⭐⭐ The well does not change during a fence build, but every clearance, crossing and
 * nearest test was scanning all of its segments: 876 of them, dozens of times per build.
 *
 * ⭐⭐ An R-TREE, not a uniform grid. A grid's cost scales with the DISTANCE SEARCHED — a
 * query point a kilometre off the curve has to expand rings until it reaches it, which
 * measured worse than the linear scan it replaced. A hierarchy prunes on the first descent,
 * so a far query costs the same as a near one.
 *
 * ⚠️ It holds a REFERENCE to `points`. Mutating that array after indexing silently invalidates
 * every query, so build it from a curve that is already final.
 *
 * @group Utils
 */
export type PolylineIndex = {
  /** the indexed polyline, referenced not copied */
  points: Vec2[];
  /** cumulative arc length at each vertex, so a hit can report a real `along` */
  arc: Float64Array;
  tree: RBush<IndexedSegment>;
};

/**
 * Index a polyline for repeated clearance, crossing and nearest queries.
 *
 * ⭐ Bulk-loaded: rbush packs the tree in one pass, which is both faster to build and better
 * balanced than inserting segment by segment.
 *
 * @group Utils
 */
export function createPolylineIndex(points: Vec2[]): PolylineIndex {
  const items: IndexedSegment[] = [];
  for (let j = 1; j < points.length; j++) {
    const a = points[j - 1];
    const b = points[j];
    items.push({
      minX: Math.min(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxX: Math.max(a[0], b[0]),
      maxY: Math.max(a[1], b[1]),
      j,
    });
  }
  const tree = new RBush<IndexedSegment>();
  tree.load(items);
  return { points, arc: polylineArcLengths(points), tree };
}

/**
 * Closest approach between `a` and an indexed polyline, CAPPED at `limit`.
 *
 * ⭐⭐ Same answer as {@link polylineMinDistance} wherever the curves are closer than `limit`,
 * and `limit` wherever they are not — all a margin check needs, and what makes an index
 * possible, since distances beyond the margin need no ordering.
 *
 * ⚠️⚠️ The exact O(|a| × |b|) version measured **125 ms** on an 826 × 876 pair and was the
 * ENTIRE cost of `verifyFenceCut` (121 of 121 ms), which the repair and candidate search call
 * dozens of times per build.
 *
 * @returns the true closest approach when below `limit`, otherwise `limit`
 *
 * @group Utils
 */
export function indexedClearance(
  index: PolylineIndex,
  a: Vec2[],
  limit: number,
): number {
  const b = index.points;
  if (a.length < 2 || b.length < 2 || !(limit > 0)) return limit;
  let best = limit;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1];
    const q = a[i];
    // Anything nearer than `best` must have its box within `best` of this segment's box, so
    // the query shrinks as the answer improves.
    const hits = index.tree.search({
      minX: Math.min(p[0], q[0]) - best,
      minY: Math.min(p[1], q[1]) - best,
      maxX: Math.max(p[0], q[0]) + best,
      maxY: Math.max(p[1], q[1]) + best,
    });
    for (const hit of hits) {
      const d = segmentSegmentDistance(p, q, b[hit.j - 1], b[hit.j]);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * Proper crossings between `a` and an indexed polyline.
 *
 * @group Utils
 */
export function indexedCrossings(index: PolylineIndex, a: Vec2[]): number {
  const b = index.points;
  if (a.length < 2 || b.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1];
    const q = a[i];
    const hits = index.tree.search({
      minX: Math.min(p[0], q[0]),
      minY: Math.min(p[1], q[1]),
      maxX: Math.max(p[0], q[0]),
      maxY: Math.max(p[1], q[1]),
    });
    for (const hit of hits) {
      if (properlyCross(p, q, b[hit.j - 1], b[hit.j])) count++;
    }
  }
  return count;
}

/**
 * Nearest point on an indexed polyline, at ANY distance.
 *
 * ⭐⭐ Searches a box that DOUBLES until it contains a segment, then re-queries at the
 * distance actually found so the answer is exact. That is O(log(distance)) box queries rather
 * than a grid's O(distance²) ring walk — the difference between a far query being free and
 * being the slowest thing in the build.
 *
 * @group Utils
 */
export function nearestOnIndexedPolyline(
  index: PolylineIndex,
  x: number,
  z: number,
  out?: PolylineHit,
): PolylineHit | null {
  const b = index.points;
  if (b.length < 2) return null;
  const hit = out ?? { point: [0, 0] as Vec2, distance: 0, along: 0 };
  let best = Infinity;
  let bestJ = -1;
  let bestT = 0;
  const consider = (j: number) => {
    const p = b[j - 1];
    const q = b[j];
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((x - p[0]) * ex + (z - p[1]) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (p[0] + ex * t), z - (p[1] + ez * t));
    if (d < best) {
      best = d;
      bestJ = j;
      bestT = t;
    }
  };
  const sweep = (radius: number) => {
    for (const item of index.tree.search({
      minX: x - radius,
      minY: z - radius,
      maxX: x + radius,
      maxY: z + radius,
    })) {
      consider(item.j);
    }
  };
  // Start at the mean segment length so a query sitting on the curve resolves immediately.
  const total = index.arc[b.length - 1];
  let radius = Math.max(1e-6, total / Math.max(1, b.length - 1));
  const span = Math.max(total, 1);
  while (bestJ < 0 && radius < span * 4) {
    sweep(radius);
    radius *= 2;
  }
  if (bestJ < 0) {
    // Nothing within four curve-lengths: the query is degenerate, not merely far.
    for (let j = 1; j < b.length; j++) consider(j);
  }
  // The first hit is only the nearest WITHIN the box it was found in; re-query at that
  // distance to pick up anything closer just outside it.
  if (bestJ > 0) sweep(best);
  if (bestJ < 0) return null;
  const p = b[bestJ - 1];
  const q = b[bestJ];
  hit.point[0] = p[0] + (q[0] - p[0]) * bestT;
  hit.point[1] = p[1] + (q[1] - p[1]) * bestT;
  hit.distance = best;
  hit.along =
    index.arc[bestJ - 1] + bestT * (index.arc[bestJ] - index.arc[bestJ - 1]);
  return hit;
}

/**
 * Push a path out until its CHORDS hold `margin`, not merely its vertices.
 *
 * ⭐⭐ Clearance is a SEGMENT measure. A path whose vertices all sit at exactly `margin` still
 * dips inside between them by the chord's sagitta — measured at 0.034 m on a 36 m join chord
 * leaving a fence cut at margin 5, and at 0.0125 m at margin 40 from a single corrective pass.
 * Where a segment's true clearance is short, its midpoint is inserted and lifted back onto the
 * margin; each pass quarters the remaining dip, so this converges geometrically.
 *
 * ⭐ Guarded by the EXACT bound `midpoint distance − half the segment length`: no point of a
 * chord is nearer than that, so most segments are proved clear by one lookup and never pay for
 * the exact segment test. Without the guard the full scan cost 46% more.
 *
 * ⛔ NOT a smoother and NOT a resampler — it only ever inserts points, and only where the
 * clearance is genuinely short, so a path that already holds `margin` comes back unchanged.
 *
 * ⚠️⚠️ `tolerance` MUST be > 0 or this cannot terminate. An inserted midpoint is placed at
 * EXACTLY `margin`, so its own two half-chords dip below `margin` again: the dip converges to
 * zero geometrically but never reaches it, and a zero tolerance would insert points until the
 * round budget threw on a path that is in fact fine.
 *
 * @param points the path to correct
 * @param index the curve to hold clear of
 * @param margin metres of clearance the chords must hold
 * @param options `exempt` marks positions on `index` that must not be measured against (a
 * degenerate stretch inside an obstacle frame can never be cleared, so a chord nearest to one
 * would never converge); `blocked` refuses a lift whose two new chords `a→lifted→b` would cross
 * something the path must keep clear of — such a chord is left as it is, pinched, for the caller's
 * gate to judge; `label` names the caller in the throw
 *
 * @throws when a dipping chord ENDS inside the margin — a vertex no midpoint can move — or `rounds`
 * (a safety cap, default 64) run out: the path cannot hold the margin, which must be said rather
 * than returned as if it had succeeded. ⛔ Not a fixed round count: aiming at 1 mm, a 22 m rod
 * chord needed 9 rounds (F-15 D). Nor "the worst dip must shrink every round": a half-chord can
 * come nearer another part of the well than its parent did (F-12, 19 B built within 8 anyway).
 *
 * @group Utils
 */
export function holdPolylineChords2D(
  points: Vec2[],
  index: PolylineIndex,
  margin: number,
  options: {
    tolerance?: number;
    rounds?: number;
    exempt?: (p: Vec2) => boolean;
    blocked?: (a: Vec2, lifted: Vec2, b: Vec2) => boolean;
    label?: string;
  } = {},
): Vec2[] {
  const tolerance = options.tolerance ?? 1e-3;
  if (!(tolerance > 0)) {
    throw new Error(
      `${options.label ?? 'holdPolylineChords2D'}: tolerance must be > 0 — a midpoint lands exactly on the margin, so its own half-chords always dip and a zero tolerance never converges`,
    );
  }
  const rounds = options.rounds ?? 64;
  const required = margin - tolerance;
  const hit = { point: [0, 0] as Vec2, distance: 0, along: 0 };
  const once = (r: Vec2[]): { out: Vec2[]; fixed: number } => {
    if (r.length < 2) return { out: r, fixed: 0 };
    const out: Vec2[] = [r[0]];
    let fixed = 0;
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1];
      const b = r[i];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const near = nearestOnIndexedPolyline(index, mx, mz, hit);
      const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
      if (!near || near.distance - half >= required) {
        out.push([b[0], b[1]]);
        continue;
      }
      // The closest approach of a chord to a curving line is not generally at its midpoint, so
      // the midpoint's distance decides nothing on its own.
      const clearance = indexedClearance(index, [a, b], margin * 3);
      if (clearance >= required) {
        out.push([b[0], b[1]]);
        continue;
      }
      if (!options.exempt?.(near.point) && near.distance > 1e-6) {
        if (
          Math.min(
            indexedClearance(index, [a, a], margin * 3),
            indexedClearance(index, [b, b], margin * 3),
          ) < required
        ) {
          throw new Error(
            `${options.label ?? 'holdPolylineChords2D'}: a chord still dips inside margin ${margin} — one of its ends lies inside it, which no midpoint can fix`,
          );
        }
        const s = margin / near.distance;
        const lifted: Vec2 = [
          near.point[0] + (mx - near.point[0]) * s,
          near.point[1] + (mz - near.point[1]) * s,
        ];
        if (!options.blocked?.(a, lifted, b)) {
          fixed++;
          out.push(lifted);
        }
      }
      out.push([b[0], b[1]]);
    }
    return { out, fixed };
  };
  let current = points;
  for (let round = 0; round < rounds; round++) {
    const { out, fixed } = once(current);
    current = out;
    if (fixed === 0) return current;
  }
  throw new Error(
    `${options.label ?? 'holdPolylineChords2D'}: a chord still dips inside margin ${margin} after ${rounds} rounds`,
  );
}

/**
 * Closest approach between two polylines, measured SEGMENT to SEGMENT.
 *
 * ⚠️⚠️ Not vertex-to-polyline. A clearance check that only tests one curve's VERTICES misses
 * the case both curves pass each other between vertices, which is exactly what a coarse cut
 * and a dense well do — and it is the check a "the cut holds the margin" guarantee rests on.
 *
 * ⚠️ O(|a| × |b|). For a margin check prefer {@link polylineClearance}, which is exact below
 * its limit and two orders of magnitude faster.
 *
 * @group Utils
 */
export function polylineMinDistance(a: Vec2[], b: Vec2[]): number {
  if (a.length < 2 || b.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const d = segmentSegmentDistance(a[i - 1], a[i], b[j - 1], b[j]);
      if (d < best) {
        best = d;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

/**
 * Proper crossings between two polylines — collinear touches do not count.
 *
 * @group Utils
 */
export function polylineCrossings(a: Vec2[], b: Vec2[]): number {
  let count = 0;
  for (let i = 1; i < a.length; i++) {
    count += segmentPolylineCrossings(
      a[i - 1][0],
      a[i - 1][1],
      a[i][0],
      a[i][1],
      b,
    );
  }
  return count;
}

/**
 * Index spans of the sharp-edge regions of a polyline, by the arm-weighted rule.
 *
 * ⭐ The same test as {@link polylineSharpEdges}, but returning WHERE rather than what, so a
 * repair can act on the offending span instead of guessing at it from coordinates.
 *
 * @group Utils
 */
export function polylineSharpSpans(
  points: Vec2[],
  angle: number,
  arm: number,
): Array<[number, number]> {
  const n = points.length;
  if (n < 3) return [];
  const cap = Math.max(1e-6, arm);
  const budget = Math.max(1e-6, angle) * cap;
  const spans: Array<[number, number]> = [];
  let open = -1;
  for (let k = 1; k < n - 1; k++) {
    const sharp = armWeightedSharp(
      points[k - 1],
      points[k],
      points[k + 1],
      budget,
      cap,
    );
    if (sharp && open < 0) open = k;
    else if (!sharp && open >= 0) {
      spans.push([open, k - 1]);
      open = -1;
    }
  }
  if (open >= 0) spans.push([open, n - 2]);
  return spans;
}

/**
 * Per-vertex WIGGLE: how much of the turning inside an arc-length window cancels itself out.
 *
 * ⭐⭐ `Σ|Δθ| − |ΣΔθ|` over the window. A curve that turns 45° one way over ten vertices — a
 * real dogleg — scores ZERO, while ±45° alternating scores the whole lot. This is the
 * distinction a per-vertex angle rule cannot make, and it is the one that matters: a
 * consistent turn reads as shape, a reversal every metre reads as damage.
 *
 * ⚠️ The window is an arc length, so it has to be chosen at the scale the cut will be LOOKED
 * at, not at field scale. A window of tens of metres cannot see the metre-scale chatter a
 * viewer sitting `margin` from the cut sees plainly.
 *
 * @param points an open polyline
 * @param window metres of arc the cancellation is measured over
 * @returns radians of self-cancelling turn per vertex
 *
 * @group Utils
 */
export function polylineWiggle(points: Vec2[], window: number): Float64Array {
  const n = points.length;
  const out = new Float64Array(n);
  if (n < 3 || !(window > 0)) return out;
  const arc = polylineArcLengths(points);
  // Signed turn at each interior vertex.
  const turn = new Float64Array(n);
  for (let i = 1; i + 1 < n; i++) {
    const ax = points[i][0] - points[i - 1][0];
    const az = points[i][1] - points[i - 1][1];
    const bx = points[i + 1][0] - points[i][0];
    const bz = points[i + 1][1] - points[i][1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    turn[i] = Math.atan2(
      (ax * bz - az * bx) / (la * lb),
      (ax * bx + az * bz) / (la * lb),
    );
  }
  const half = window * 0.5;
  for (let i = 1; i + 1 < n; i++) {
    let total = 0;
    let net = 0;
    for (let j = i; j + 1 < n && arc[j] - arc[i] <= half; j++) {
      total += Math.abs(turn[j]);
      net += turn[j];
    }
    for (let j = i - 1; j >= 1 && arc[i] - arc[j] <= half; j--) {
      total += Math.abs(turn[j]);
      net += turn[j];
    }
    out[i] = total - Math.abs(net);
  }
  return out;
}

/** Signed area ×2 of triangle (a,b,c); >0 = c left of a→b, <0 = right, 0 = collinear. */
function orient2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/**
 * How many times the segment `a→b` STRICTLY crosses `polyline`.
 *
 * ⭐⭐ A FULL traversal of every polyline segment — no nearest-segment shortcut — so
 * the answer is a property of the WHOLE border, not of whichever segment happens to
 * be closest. That is what makes it robust where the polyline doubles back on itself
 * or runs through a concavity, exactly the places a single-segment cross product
 * gives a false reading.
 *
 * ⚠️ Only PROPER crossings count: a segment that merely touches a vertex or lies
 * collinear scores 0. Callers that need certainty against such grazing cases test
 * several reference points and take the majority (see the fence burial check).
 *
 * @group Utils
 */
export function segmentPolylineCrossings(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  polyline: Vec2[],
): number {
  let count = 0;
  for (let i = 1; i < polyline.length; i++) {
    const c = polyline[i - 1];
    const d = polyline[i];
    const d1 = orient2D(ax, az, bx, bz, c[0], c[1]);
    const d2 = orient2D(ax, az, bx, bz, d[0], d[1]);
    const d3 = orient2D(c[0], c[1], d[0], d[1], ax, az);
    const d4 = orient2D(c[0], c[1], d[0], d[1], bx, bz);
    if (
      ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    ) {
      count++;
    }
  }
  return count;
}

/**
 * The parameters `t ∈ (0,1)` along `a→b` where it STRICTLY crosses `polyline`, sorted.
 *
 * ⭐⭐ The exact crossing positions, from a full traversal of the whole polyline — so a
 * segment can be split at the precise points where it passes through the border, with
 * no sampling and no rounding to a grid. Companion to {@link segmentPolylineCrossings}
 * (this is its crossings, located rather than merely counted).
 *
 * ⚠️ Proper crossings only, matching {@link segmentPolylineCrossings}: a mere touch of a
 * vertex or a collinear overlap is not reported.
 *
 * @group Utils
 */
export function segmentPolylineCrossingParams(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  polyline: Vec2[],
): number[] {
  const rx = bx - ax;
  const rz = bz - az;
  const out: number[] = [];
  for (let i = 1; i < polyline.length; i++) {
    const c = polyline[i - 1];
    const d = polyline[i];
    const sx = d[0] - c[0];
    const sz = d[1] - c[1];
    const den = rx * sz - rz * sx;
    if (den === 0) continue;
    const t = ((c[0] - ax) * sz - (c[1] - az) * sx) / den;
    const u = ((c[0] - ax) * rz - (c[1] - az) * rx) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) out.push(t);
  }
  out.sort((p, q) => p - q);
  return out;
}

/** Where a polyline crosses itself, and the point it crosses at. */
export type PolylineLoop = { i: number; j: number; at: Vec2 };

/**
 * First self-crossing on an open polyline, taking the LARGEST loop at the
 * earliest vertex.
 *
 * ⚠️ Bucketed by a uniform grid rather than compared pairwise. Pairwise is
 * quadratic in the vertex count and is paid IN FULL on a clean polyline, which is
 * almost all of them.
 */
export function findPolylineLoop(points: Vec2[]): PolylineLoop | null {
  const n = points.length;
  if (n < 4) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const cell = Math.max((maxX - minX) / 128, (maxZ - minZ) / 128, 1e-3);
  const columns = Math.floor((maxX - minX) / cell) + 1;
  const buckets = new Map<number, number[]>();
  const put = (cx: number, cz: number, i: number) => {
    const k = cz * columns + cx;
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  };
  for (let i = 0; i + 1 < n; i++) {
    const a = points[i];
    const b = points[i + 1];
    const c0 = Math.floor((Math.min(a[0], b[0]) - minX) / cell);
    const c1 = Math.floor((Math.max(a[0], b[0]) - minX) / cell);
    const r0 = Math.floor((Math.min(a[1], b[1]) - minZ) / cell);
    const r1 = Math.floor((Math.max(a[1], b[1]) - minZ) / cell);
    for (let cx = c0; cx <= c1; cx++)
      for (let cz = r0; cz <= r1; cz++) put(cx, cz, i);
  }

  for (let i = 0; i + 1 < n; i++) {
    const a = points[i];
    const b = points[i + 1];
    const rx = b[0] - a[0];
    const rz = b[1] - a[1];
    const c0 = Math.floor((Math.min(a[0], b[0]) - minX) / cell);
    const c1 = Math.floor((Math.max(a[0], b[0]) - minX) / cell);
    const r0 = Math.floor((Math.min(a[1], b[1]) - minZ) / cell);
    const r1 = Math.floor((Math.max(a[1], b[1]) - minZ) / cell);
    let best: PolylineLoop | null = null;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const list = buckets.get(cz * columns + cx);
        if (!list) continue;
        for (const j of list) {
          // ⚠️ The largest loop at this vertex first — excising an inner one would
          // leave the outer one still wrapped around it.
          if (j <= i + 1 || (best && j <= best.j)) continue;
          const c = points[j];
          const d = points[j + 1];
          const sx = d[0] - c[0];
          const sz = d[1] - c[1];
          const den = rx * sz - rz * sx;
          if (den === 0) continue;
          const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
          const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
          if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9)
            continue;
          best = { i, j, at: [a[0] + rx * t, a[1] + rz * t] };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Number of self-crossings on an open polyline. @group Utils */
export function countPolylineLoops(points: Vec2[]): number {
  let count = 0;
  let current = points;
  for (let guard = 0; guard < 4096; guard++) {
    const loop = findPolylineLoop(current);
    if (!loop) break;
    count++;
    current = current.slice();
    current.splice(loop.i + 1, loop.j - loop.i, loop.at);
  }
  return count;
}

/**
 * Whether a closed sub-path `from`..`to` winds counter-clockwise, and so encloses
 * its pocket on the LEFT of the walk.
 */
function enclosesOnLeft(points: Vec2[], from: number, to: number): boolean {
  let area = 0;
  for (let k = from; k <= to; k++) {
    const a = points[k];
    const b = points[k === to ? from : k + 1];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area > 0;
}

/**
 * Cut the loops out of an open polyline, replacing each excursion by the point it
 * crosses itself at.
 *
 * ⚠️ Re-found after each splice rather than swept once: excising a loop joins two
 * pieces that were apart, which can put a NEW crossing behind the point a single
 * forward pass has already gone by.
 *
 * ⚠️⚠️ **A splice is a CHORD**, and a chord shrinks whatever the excursion was
 * opened to make room for — the trap {@link repairPolylineWaists} exists to avoid.
 * Making this side-aware, so that a pocket on the removed half is pushed out
 * instead of chorded, was TRIED and REVERTED: the push does not converge, and on
 * a hooked well it replaced a 50 m burial with a 1.5 km excursion that abandoned
 * the trajectory altogether. A self-crossing curve is not a valid cut at any
 * price, so the chord stays; keep the well clear of the cut BEFORE the loop
 * appears, not after.
 *
 * @param points an open polyline
 *
 * @group Utils
 */
export function removePolylineLoops(points: Vec2[]): Vec2[] {
  if (points.length < 4) return points;
  const out = points.slice();
  for (let guard = 0; guard < 4096; guard++) {
    const loop = findPolylineLoop(out);
    if (!loop) break;
    out.splice(loop.i + 1, loop.j - loop.i, loop.at);
  }
  return out;
}

/**
 * The shortest polyline that keeps EVERY vertex of `points` on one side of it — the
 * taut string pulled tight against the trace from the half being removed.
 *
 * ⭐⭐ This is the one primitive a fence side is built on. `side = 1` keeps the whole
 * input on the LEFT of the result (the half the left normal points into); `-1` keeps
 * it on the right. The output is a SUBSEQUENCE of the input vertices: it follows the
 * trace exactly wherever the trace bends toward the KEPT side, and bridges straight
 * across wherever it bends toward the REMOVED side — a loop, a hairpin, the inside of
 * a dogleg. It cannot self-intersect and it cannot fold, because a taut string does
 * neither, which is the whole reason to build the cut this way instead of smoothing
 * and repairing an offset that can do both.
 *
 * ⚠️⚠️ The check is against EVERY skipped vertex of a candidate bridge, not just the
 * turn at its ends. A one-sided hull that pops on the local turn alone (a plain
 * convex-hull scan) drops a vertex a later bridge then passes on the wrong side of,
 * and the cut buries the well there — measured at tens to hundreds of metres on the
 * doubling-back wells. Taking the FURTHEST bridge whose every skipped vertex is on
 * the removed side is what makes one-sidedness exact rather than approximate.
 *
 * ⚠️ The two sides of one trace are genuinely different curves: where one follows
 * tightly the other bridges, so this must be run once per side.
 *
 * ⭐ `tolerance` is metres of slack: a bridge may leave a skipped vertex up to this
 * far on the KEPT side, so survey scatter and small kept-side wiggle are bridged away
 * rather than followed. At 0 the string is pulled fully taut and only removed-side
 * excursions are bridged. Keep it at or below the feature the cut must not bury — the
 * wellbore's render radius.
 *
 * @param points the trace, ordered head to terminal depth
 * @param side which half is REMOVED; the trace is kept on the other one
 * @param tolerance metres a skipped vertex may sit on the kept side. Default 0.
 *
 * @group Utils
 */
export function oneSidedGeodesic(
  points: Vec2[],
  side: 1 | -1,
  tolerance = 0,
): Vec2[] {
  const n = points.length;
  if (n < 3) return points.map(p => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  let i = 0;
  while (i < n - 1) {
    const ax = points[i][0];
    const az = points[i][1];
    // The furthest vertex reachable by a straight bridge that leaves every skipped
    // vertex on the removed side (within `tolerance` of the kept side) — the taut
    // shortcut from here.
    let best = i + 1;
    for (let j = i + 2; j < n; j++) {
      const bx = points[j][0];
      const bz = points[j][1];
      // Cross-products scale with the bridge length, so the metric slack does too.
      const limit = tolerance * (Math.hypot(bx - ax, bz - az) || 1);
      let ok = true;
      for (let k = i + 1; k < j; k++) {
        // cross(b - a, k - a): positive means k is on the LEFT of a -> b.
        const c =
          (bx - ax) * (points[k][1] - az) - (bz - az) * (points[k][0] - ax);
        // side 1 removes the left, so a skipped vertex on the RIGHT is buried.
        if (side > 0 ? c < -limit : c > limit) {
          ok = false;
          break;
        }
      }
      if (ok) best = j;
    }
    out.push([points[best][0], points[best][1]]);
    i = best;
  }
  return out;
}

/**
 * Remove self-intersections from an open polyline ONE-SIDED: each loop is bridged so
 * its excursion falls on the half being REMOVED, rather than chorded through the
 * middle where it would bury the well on the kept side.
 *
 * ⭐ Only the self-crossing span is touched — the taut one-sided string is run over
 * that span alone — so a simple, smoothly bending trajectory (even one that alternates
 * concave and convex) is returned untouched, and the two sides differ ONLY where the
 * well genuinely crosses itself.
 *
 * ⚠️ A loop whose excursion faces the KEPT side is pushed clear of it, which on a hard
 * hook is a long, narrow bridge deep into the column — the price of not burying it.
 * Bounding that is left to the caller.
 *
 * @param points an open polyline, head to terminal depth
 * @param side which half is REMOVED
 * @param tolerance metres a bridged vertex may sit on the kept side. Default 0.
 *
 * @group Utils
 */
export function repairLoopsOneSided(
  points: Vec2[],
  side: 1 | -1,
  tolerance = 0,
): Vec2[] {
  if (points.length < 4) return points;
  const out = points.slice();
  for (let guard = 0; guard < 4096; guard++) {
    const loop = findPolylineLoop(out);
    if (!loop) break;
    // Rework only the self-crossing span, keeping its end anchors on the well.
    const span = out.slice(loop.i, loop.j + 2);
    const fixed = oneSidedGeodesic(span, side, tolerance);
    out.splice(loop.i, loop.j + 2 - loop.i, ...fixed);
  }
  return out;
}

/**
 * Which ends of a {@link offsetPolyline2DDissolved} get the half-disc cap of the swept region.
 *
 * ⭐ A cap is the RIGHT answer where the offset has to get round the end of the source — at a
 * near-vertical wellhead it is the difference between a clean boundary and a chord straight
 * through the head cluster. It is the WRONG answer where something else takes over at that
 * end: a fence's run-out leaves terminal depth on its own bearing, and a `margin`-radius arc
 * there is a tight curl followed by two near-parallel lines, not a transition.
 *
 * @group Utils
 */
export type OffsetCaps = 'both' | 'start' | 'end' | 'none';

/**
 * A one-sided offset together with the parts of it that DO NOT hold the requested clearance.
 *
 * ⭐⭐ `gaps` is the whole point of this type. A one-sided offset is not always feasible, and
 * the honest answer to "offset this by 0.5 m" is sometimes "not here" — silently handing back
 * something nearer than asked is a lie the caller cannot detect and no downstream repair can
 * undo (a taut string only ever shortens, so a bridge that is already too close stays too
 * close).
 *
 * ⚠️ It is a CLEARANCE test, not a coverage test: it says the curve never runs nearer to the
 * source than asked, not that the curve runs the whole length of it. Where no offset exists at
 * all the curve can shrink to a stub around one end and still report no gaps — `points.length`
 * is what tells you that. Same blind spot as `verifyFenceCut`, for the same reason: neither
 * takes a side, so neither can see the ends.
 *
 * @group Utils
 */
export type DissolvedOffset = {
  /** the offset polyline; EMPTY when no part of the source could be offset at all */
  points: Vec2[];
  /** vertex index spans of the SOURCE the offset runs closer to than `margin` */
  gaps: Array<[number, number]>;
};

/**
 * Offset a SIMPLE open polyline to one side by `margin`, DISSOLVING the fold that a
 * bend tighter than the margin would otherwise make.
 *
 * ⭐ The push is toward the KEPT half (opposite the removed side's left normal), so the
 * trajectory ends up `margin` inside the REMOVED half — a clear view of the well from
 * the cut face. `side` = which half is REMOVED.
 *
 * ⭐⭐ ROUND JOINS ARE STRUCTURAL, not a finish. The result is the boundary of the source
 * swept by a disc of radius `margin`, and every point of that boundary is EXACTLY `margin`
 * from the source — which is what makes the dissolve below a sound test. A per-vertex
 * normal offset omits the arc at every convex corner, so the emitted set no longer contains
 * the true boundary; at a tight cluster (a near-vertical wellhead is metres of hole inside a
 * sub-metre plan box) EVERY emitted point is then inside the swept region and the whole
 * cluster dissolves away — measured as the head of the offset simply going missing, which
 * downstream reads as tens of metres of buried well.
 *
 * ⚠️⚠️ A naive per-vertex offset also SELF-CROSSES wherever the bend is tighter than the
 * margin (an S alternates, so both lobes eventually do). Here the offset is DISSOLVED, not
 * kept: a point of the true boundary sits exactly `margin` from the source, so any candidate
 * CLOSER than that has been folded inside and is dropped; the survivors are re-stitched,
 * collapsing a tight concavity to a straight bridge instead of a loop. The distance test is
 * against the WHOLE source, so it is global — one lobe's fold is cut off by another lobe.
 *
 * ⛔ The offset does NOT always exist. Where the source doubles back closer than `2 * margin`
 * the whole offset on the inner hand is swallowed, and there is no curve at that clearance to
 * return. That case is REPORTED in `gaps` rather than papered over — see {@link DissolvedOffset}.
 *
 * @param points a SIMPLE open polyline (no self-crossings), head to terminal depth
 * @param side which half is REMOVED
 * @param margin metres of clearance to keep on the removed side
 * @param caps which ends get the swept region's half-disc. See {@link OffsetCaps}.
 *
 * @group Utils
 */
export function offsetPolyline2DDissolved(
  points: Vec2[],
  side: 1 | -1,
  margin: number,
  caps: OffsetCaps = 'both',
): DissolvedOffset {
  if (points.length < 2 || margin <= 0) return { points, gaps: [] };
  // Unit direction of every segment, degenerate ones inheriting their predecessor.
  const dirs: Vec2[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    const l = Math.hypot(dx, dz);
    if (l > 1e-12) dirs.push([dx / l, dz / l]);
    else dirs.push(dirs.length ? dirs[dirs.length - 1] : [1, 0]);
  }
  const offsetOf = (d: Vec2): Vec2 => {
    const n = leftNormal2D(d[0], d[1]);
    return [-side * n[0], -side * n[1]];
  };
  const ARC_STEP = Math.PI / 36;
  const arc = polylineArcLengths(points);
  // Each candidate remembers WHERE ALONG THE SOURCE it came from, which is what makes the
  // fold test below able to tell a neighbour from a distant part of the same curve.
  const candidates: Array<{ x: number; z: number; at: number; seg: number }> =
    [];
  const fan = (at: number, seg: number, centre: Vec2, from: Vec2, to: Vec2) => {
    const a0 = Math.atan2(from[1], from[0]);
    let delta = Math.atan2(to[1], to[0]) - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / ARC_STEP));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (delta * k) / steps;
      candidates.push({
        x: centre[0] + Math.cos(a) * margin,
        z: centre[1] + Math.sin(a) * margin,
        at,
        seg,
      });
    }
  };
  // ⭐⭐ END CAPS. The swept region has a half-disc at each end and the one-sided boundary
  // gets a QUARTER of each, from the backward tangent round to the offset direction, so the
  // curve starts BEHIND the head and ends BEYOND terminal depth. Not cosmetic: where the plan
  // box of the head is smaller than the margin — a near-vertical top hole is metres of arc
  // inside a sub-metre box — every ordinary candidate there folds away and the stitch chords
  // straight through the cluster, which is the well buried at its own head.
  if (caps === 'both' || caps === 'start')
    fan(arc[0], 0, points[0], [-dirs[0][0], -dirs[0][1]], offsetOf(dirs[0]));
  for (let s = 0; s < dirs.length; s++) {
    const o = offsetOf(dirs[s]);
    if (s > 0) {
      const cross = dirs[s - 1][0] * dirs[s][1] - dirs[s - 1][1] * dirs[s][0];
      // Turning AWAY from the offset side opens a gap the disc rolls round.
      if (side * cross > 0) {
        fan(arc[s], s, points[s], offsetOf(dirs[s - 1]), o);
      }
    }
    candidates.push({
      x: points[s][0] + o[0] * margin,
      z: points[s][1] + o[1] * margin,
      at: arc[s],
      seg: s,
    });
    candidates.push({
      x: points[s + 1][0] + o[0] * margin,
      z: points[s + 1][1] + o[1] * margin,
      at: arc[s + 1],
      seg: s + 1,
    });
  }
  const tail = dirs[dirs.length - 1];
  const last = points.length - 1;
  if (caps === 'both' || caps === 'end')
    fan(arc[last], last, points[last], offsetOf(tail), tail);
  // definition brings together parts that are further apart than that along the curve.
  // ⭐⭐ The slack is the SOURCE'S OWN DISCRETISATION, measured, not a fraction of the margin.
  // A polyline is a chord approximation, so the chord next to a candidate's generator sits a
  // sagitta nearer than `margin` even where nothing is folded — an exact test rejects every
  // valid inner-offset point (the inside of a 100 m arc collapsed to one chord). A fold, by
  // contrast, brings a part nearer by far more than the sagitta, so this separates the two
  // without blinding the test to a bend tighter than the margin.
  const sagitta = new Float64Array(points.length);
  for (let i = 1; i + 1 < points.length; i++) {
    sagitta[i] = Math.max(
      1e-9,
      2 * distToSegment(points[i], points[i - 1], points[i + 1]),
    );
  }
  sagitta[0] = sagitta[1] ?? 1e-9;
  sagitta[points.length - 1] = sagitta[points.length - 2] ?? 1e-9;
  const inside = candidates.map(q => {
    let closest = Infinity;
    for (let s = 1; s < points.length; s++) {
      const d = distToSegment([q.x, q.z], points[s - 1], points[s]);
      if (d < closest) closest = d;
    }
    return closest < margin - sagitta[Math.min(q.seg, sagitta.length - 1)];
  });

  // ⭐⭐ A dissolved fold is closed at its CUSP, not chorded across. The two offset branches
  // that collide there both continue to a single point equidistant from the two parts of the
  // source, and that point is where the boundary actually turns. Joining the surviving ends
  // with a straight chord instead cuts the corner — measured 0.30 m of clearance where 0.50
  // was asked for on a hairpin, which downstream reads as the well buried at its own hook.
  const meet = (a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Vec2 | null => {
    const rx = a1[0] - a0[0];
    const rz = a1[1] - a0[1];
    const sx = b1[0] - b0[0];
    const sz = b1[1] - b0[1];
    const denominator = rx * sz - rz * sx;
    if (Math.abs(denominator) < 1e-12) return null;
    const t = ((b0[0] - a0[0]) * sz - (b0[1] - a0[1]) * sx) / denominator;
    return [a0[0] + rx * t, a0[1] + rz * t];
  };
  const survivors: Vec2[] = [];
  let furthest = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    if (!inside[i]) {
      const q = candidates[i];
      // MONOTONE along the source: the boundary does not run backwards, and a candidate that
      // does is on the far branch of a fold rather than on the boundary being traced.
      if (q.at < furthest) continue;
      furthest = q.at;
      survivors.push([q.x, q.z]);
      continue;
    }
    let j = i;
    while (j + 1 < candidates.length && inside[j + 1]) j++;
    const before = candidates[i - 1];
    const after = candidates[j + 1];
    if (before && after) {
      const cusp = meet(
        [before.x, before.z],
        [candidates[i].x, candidates[i].z],
        [candidates[j].x, candidates[j].z],
        [after.x, after.z],
      );
      // Only when it really is a meeting point of the two branches, not a far extrapolation.
      if (
        cusp &&
        Math.hypot(cusp[0] - before.x, cusp[1] - before.z) <= margin * 4 &&
        Math.hypot(cusp[0] - after.x, cusp[1] - after.z) <= margin * 4
      ) {
        survivors.push(cusp);
      }
    }
    i = j;
  }
  if (survivors.length < 2) {
    // ⛔ NOT the source. Every candidate was folded away, so at this margin the source has no
    // one-sided offset here at all; returning the source would hand back ZERO clearance under
    // the name of `margin`.
    return { points: [], gaps: [[0, points.length - 1]] };
  }
  // Re-stitch and clean any crossing the bridges introduced.
  const out = removePolylineLoops(dedupePolyline2D(survivors, margin * 0.02));

  // ⭐⭐ The result is MEASURED against the source, not asserted from the bookkeeping above. A
  // run that dissolved entirely is re-stitched with a CHORD, and that chord can pass straight
  // through the source; so can a mis-placed cusp or a candidate the monotone filter dropped.
  // Reported against the SOURCE's vertices, because what the caller needs to know is which
  // feature blocked it, not which output vertex noticed.
  // ⚠️ The check must forgive BOTH discretisations: the source's own sagitta, and the dip of
  // this function's arc chords (`margin * (1 - cos(ARC_STEP / 2))`). Charging either as a gap
  // reports every round join and every end cap as a failure.
  const arcSag = margin * (1 - Math.cos(ARC_STEP / 2));
  // Knife-edge guard: a cap chord's dip IS exactly `arcSag`, so without slack of its own the
  // comparison is decided by rounding and flaps open and shut along a single arc.
  const EPS = margin * 1e-4;
  // Source segments bucketed on a `margin`-sized grid: without it this is out x source, which
  // on a 3 km trace deduped at 0.1 m is a billion tests per side.
  const CELL = 1 << 22;
  const HALF = CELL >> 1;
  const buckets = new Map<number, number[]>();
  const keyAt = (x: number, z: number) =>
    (Math.floor(x / margin) + HALF) * CELL + (Math.floor(z / margin) + HALF);
  // ⚠️ Walked ALONG the segment, not over its bounding box: a long bridge is diagonal, and its
  // box covers the SQUARE of the cells it actually touches.
  const walk = (a: Vec2, b: Vec2, visit: (x: number, z: number) => void) => {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / margin) + 1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      visit(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  };
  for (let s = 1; s < points.length; s++) {
    walk(points[s - 1], points[s], (x, z) => {
      const k = keyAt(x, z);
      const b = buckets.get(k);
      if (b) {
        if (b[b.length - 1] !== s) b.push(s);
      } else buckets.set(k, [s]);
    });
  }
  const seen = new Int32Array(points.length);
  const gaps: Array<[number, number]> = [];
  let open = false;
  let from = 0;
  let to = 0;
  for (let i = 1; i < out.length; i++) {
    let closest = Infinity;
    let nearest = 1;
    walk(out[i - 1], out[i], (x, z) => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const b = buckets.get(keyAt(x + dx * margin, z + dz * margin));
          if (!b) continue;
          for (const s of b) {
            if (seen[s] === i) continue;
            seen[s] = i;
            const d = segmentDistance2D(
              out[i - 1],
              out[i],
              points[s - 1],
              points[s],
            );
            if (d < closest) {
              closest = d;
              nearest = s;
            }
          }
        }
      }
    });
    if (closest < margin - Math.max(sagitta[nearest], arcSag) - EPS) {
      if (!open) {
        open = true;
        from = nearest;
        to = nearest;
      } else {
        if (nearest < from) from = nearest;
        if (nearest > to) to = nearest;
      }
    } else if (open) {
      gaps.push([Math.max(0, from - 1), Math.min(points.length - 1, to)]);
      open = false;
    }
  }
  if (open) gaps.push([Math.max(0, from - 1), Math.min(points.length - 1, to)]);

  return { points: out, gaps };
}

/**
 * Smooth a polyline while keeping every vertex within `radius` of where it started —
 * corridor-constrained relaxation.
 *
 * ⭐⭐ Binomial smoothing rounds sharp bends and dissolves the tiny back-and-forth
 * reversals an offset leaves, but on its own it drifts a curve wherever it likes. The
 * per-vertex clamp back inside a disc of `radius` bounds the deviation BY CONSTRUCTION,
 * so the result cannot fold and, when `radius` is the clearance already opened, cannot
 * move the cut close enough to the well to bury it. Endpoints are pinned.
 *
 * @param points an open polyline
 * @param radius metres a vertex may travel from its original position
 * @param passes smoothing iterations. Default 12.
 * @param clearOf keeps every vertex at least `minClearance` from `well`, projecting a
 *   vertex the smoothing pulled inside that back out — so smoothing cannot erode the
 *   clearance the offset established.
 *
 * @group Utils
 */
export function smoothPolyline2DWithinDisc(
  points: Vec2[],
  radius: number,
  passes = 12,
  clearOf?: { well: Vec2[]; minClearance: number },
): Vec2[] {
  if (points.length < 3 || !(radius > 0)) {
    return points.map(p => [p[0], p[1]] as Vec2);
  }
  const origin = points.map(p => [p[0], p[1]] as Vec2);
  let current = points.map(p => [p[0], p[1]] as Vec2);
  const r2 = radius * radius;
  const hit: PolylineHit = { point: [0, 0], distance: 0, along: 0 };
  for (let pass = 0; pass < passes; pass++) {
    const next = current.map(p => [p[0], p[1]] as Vec2);
    for (let i = 1; i + 1 < current.length; i++) {
      let x =
        0.25 * current[i - 1][0] +
        0.5 * current[i][0] +
        0.25 * current[i + 1][0];
      let z =
        0.25 * current[i - 1][1] +
        0.5 * current[i][1] +
        0.25 * current[i + 1][1];
      const dx = x - origin[i][0];
      const dz = z - origin[i][1];
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) {
        const s = radius / Math.sqrt(d2);
        x = origin[i][0] + dx * s;
        z = origin[i][1] + dz * s;
      }
      // ⭐ Clearance floor: if smoothing pulled this vertex inside the margin, push it
      // straight back out to the margin. One-sided — it can only move AWAY from the well.
      if (clearOf) {
        const h = nearestOnPolyline(clearOf.well, x, z, hit);
        if (h && h.distance < clearOf.minClearance && h.distance > 1e-6) {
          const s = clearOf.minClearance / h.distance;
          x = h.point[0] + (x - h.point[0]) * s;
          z = h.point[1] + (z - h.point[1]) * s;
        }
      }
      next[i][0] = x;
      next[i][1] = z;
    }
    current = next;
  }
  return current;
}

/**
 * Lift a cut curve off a well so every well point clears the cut's SEGMENTS by
 * `minClearance` — the exact quantity a burial check measures.
 *
 * ⭐⭐ A per-VERTEX clearance floor (push each cut vertex `minClearance` off the well)
 * cannot guarantee this: the straight segment between two floored vertices sags inside
 * toward the well by its sagitta, so the well ends up a few centimetres short of the
 * clearance even though every vertex holds it. This measures the other direction — each
 * well point against the nearest cut SEGMENT — and translates that segment outward until
 * the point clears, closing the sagitta whatever the vertex spacing.
 *
 * ⭐⭐ Both the SIGN and the DIRECTION of the lift come from the WELL's own heading, never
 * from the cut's. A finished cut doubles back on itself where a run-out leaves the head — the
 * arm runs back past the core it just left — so the cut's local left normal FLIPS there, and
 * a lift steered by it drives two neighbouring vertices apart into a near-180° pinch. Measured:
 * every sharp edge left at margin 0.5 was one of these, and all of them vanished when this
 * pass was switched off. The well does not double back, so its normal is stable.
 *
 * ⭐ The lift is only ever toward the KEPT half, so it enlarges the removed region and can
 * never bury the other side. It is bounded by `maxPush` and blurred along the curve, so it
 * cannot fold or leave a kink. A well point that would need more than `maxPush` — a gross
 * head excursion whose cut is tens of metres away — is left untouched rather than dragged,
 * so it stays visibly flagged instead of turning into an artefact.
 *
 * @param cut the finished cut curve, run-outs included; endpoints are pinned
 * @param well the trajectory to clear, used exactly
 * @param minClearance metres the well must stay off the cut's segments
 * @param side which half is REMOVED, by the well's left normal
 * @param maxPush cap on how far any one cut vertex may be lifted, in metres
 * @param passes fixed-point iterations. Default 16.
 *
 * @group Utils
 */
export function clearWellFromCut(
  cut: Vec2[],
  well: Vec2[],
  minClearance: number,
  side: 1 | -1,
  maxPush: number,
  passes = 16,
): Vec2[] {
  const n = cut.length;
  const out = cut.map(p => [p[0], p[1]] as Vec2);
  if (n < 3 || !(minClearance > 0) || !(maxPush > 0)) return out;
  // ⭐⭐ The demand is blurred over ARC LENGTH, not over vertex index. A finished cut mixes
  // sub-decimetre spacing where it follows a scattered wellhead with ten-metre spacing along a
  // run-out, so an index kernel spreads a metre of lift over 30 cm in one place and 30 m in
  // another — the first leaves a near-180° reversal, which is a degenerate quad in the swept
  // face. Over arc length the lift always rises at the same bounded slope.
  const blur = maxPush * PUSH_BLUR_ARCS;
  // The KEPT-half direction at every well vertex, from the well's own heading.
  const kept: Vec2[] = well.map((_, m) => {
    const a = well[Math.max(0, m - 1)];
    const b = well[Math.min(well.length - 1, m + 1)];
    const t = leftNormal2D(b[0] - a[0], b[1] - a[1]);
    return [-side * t[0], -side * t[1]];
  });
  // Cumulative displacement per vertex, so the cap is on the total move.
  const total = new Float64Array(n);
  for (let pass = 0; pass < passes; pass++) {
    // The lift each vertex still needs this pass, as a VECTOR — the demands around a bend
    // point in different directions and averaging their magnitudes alone would over-lift.
    const needX = new Float64Array(n);
    const needZ = new Float64Array(n);
    for (let w = 0; w < well.length; w++) {
      const px = well[w][0];
      const pz = well[w][1];
      // Nearest cut segment to this well point, measured on the current (moving) cut.
      let bestD2 = Infinity;
      let bi = -1;
      let bfx = 0;
      let bfz = 0;
      for (let i = 1; i < n; i++) {
        const ax = out[i - 1][0];
        const az = out[i - 1][1];
        const ex = out[i][0] - ax;
        const ez = out[i][1] - az;
        const len2 = ex * ex + ez * ez;
        let t = len2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const fx = ax + ex * t;
        const fz = az + ez * t;
        const d2 = (px - fx) * (px - fx) + (pz - fz) * (pz - fz);
        if (d2 < bestD2) {
          bestD2 = d2;
          bi = i;
          bfx = fx;
          bfz = fz;
        }
      }
      if (bi < 0) continue;
      // Signed position of the well point along the WELL's kept normal: positive means it
      // sits on the kept side of the cut (poking into the block), negative on the removed.
      const kx = kept[w][0];
      const kz = kept[w][1];
      const s = (px - bfx) * kx + (pz - bfz) * kz;
      // Move the segment out by this to seat the point `minClearance` on the removed side.
      const delta = s + minClearance;
      // Already clear, or a gross excursion beyond the cap — leave it (it stays flagged).
      if (delta <= 1e-6 || delta > maxPush) continue;
      for (const i of [bi - 1, bi]) {
        if (delta * delta > needX[i] * needX[i] + needZ[i] * needZ[i]) {
          needX[i] = delta * kx;
          needZ[i] = delta * kz;
        }
      }
    }
    // Blur the demand over arc length so a single offending point cannot leave a spike, and
    // so the lift's slope — and therefore the turn it introduces — is bounded whatever the
    // local vertex spacing. Tent weights, one pass; the fixed point does the rest.
    const arc = polylineArcLengths(out);
    const smoothX = needX.slice();
    const smoothZ = needZ.slice();
    for (let i = 1; i + 1 < n; i++) {
      let sx = 0;
      let sz = 0;
      let weight = 0;
      for (let j = i; j < n && arc[j] - arc[i] <= blur; j++) {
        const w = 1 - (arc[j] - arc[i]) / blur;
        sx += needX[j] * w;
        sz += needZ[j] * w;
        weight += w;
      }
      for (let j = i - 1; j >= 0 && arc[i] - arc[j] <= blur; j--) {
        const w = 1 - (arc[i] - arc[j]) / blur;
        sx += needX[j] * w;
        sz += needZ[j] * w;
        weight += w;
      }
      smoothX[i] = weight > 0 ? sx / weight : needX[i];
      smoothZ[i] = weight > 0 ? sz / weight : needZ[i];
    }
    let moved = false;
    for (let i = 1; i + 1 < n; i++) {
      let add = Math.hypot(smoothX[i], smoothZ[i]);
      if (add <= 1e-6) continue;
      if (total[i] + add > maxPush) add = maxPush - total[i];
      if (add <= 1e-6) continue;
      const scale = add / Math.hypot(smoothX[i], smoothZ[i]);
      out[i][0] += smoothX[i] * scale;
      out[i][1] += smoothZ[i] * scale;
      total[i] += add;
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/**
 * Sample a cubic Bézier as a polyline of `samples + 1` points, inclusive of both
 * endpoints.
 *
 * ⭐ With `p1 = p0 + tangentOut·k` and `p2 = p3 − tangentIn·k` the curve leaves `p0` along
 * `tangentOut` and arrives at `p3` along `tangentIn`, so both end tangents are pinned. An
 * interpolating spline (Catmull-Rom) cannot do that without phantom points.
 *
 * ⚠️⚠️ Pinned tangents are NOT a smooth turn. When `tangentOut` opposes the chord the
 * control points collapse onto one line and the curve CUSPS — it runs backwards, stops and
 * returns. Measured as a 136-141° corner 50-70 m out in a fence run-out. For a turn of
 * unknown size between two tangents use {@link biarc2D}, which cannot cusp.
 *
 * @param samples segments to divide the curve into; fixed by the caller, so bounded
 *
 * @group Utils
 */
export function cubicBezier2D(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  samples: number,
): Vec2[] {
  const n = Math.max(1, Math.floor(samples));
  const out: Vec2[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out[i] = [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
  }
  return out;
}

/** Sample the circular arc that leaves `a` along `t` and passes through `b`. */
function arcThrough(a: Vec2, t: Vec2, b: Vec2, step: number): Vec2[] {
  const mx = b[0] - a[0];
  const mz = b[1] - a[1];
  const chord = Math.hypot(mx, mz);
  if (chord < 1e-9) return [[a[0], a[1]]];
  const nx = -t[1];
  const nz = t[0];
  const denom = 2 * (nx * mx + nz * mz);
  // The normal is perpendicular to the chord: the "arc" is the straight chord itself.
  if (Math.abs(denom) < 1e-9 * chord) return [[a[0], a[1]]];
  const s = (chord * chord) / denom;
  const cx = a[0] + nx * s;
  const cz = a[1] + nz * s;
  const radius = Math.abs(s);
  const from = Math.atan2(a[1] - cz, a[0] - cx);
  const to = Math.atan2(b[1] - cz, b[0] - cx);
  // Turning sense: the CCW velocity at `a` is the left normal of the radius vector.
  const ccw = -(a[1] - cz) * t[0] + (a[0] - cx) * t[1] > 0;
  let delta = to - from;
  if (ccw) while (delta <= 0) delta += 2 * Math.PI;
  else while (delta >= 0) delta -= 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(delta) / Math.max(1e-6, step)));
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const angle = from + (delta * i) / count;
    out.push([cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius]);
  }
  return out;
}

/** True when two segments cross at points INTERIOR to both — touching at an end does not count. */
function properlyCross(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
  const rx = a1[0] - a0[0];
  const rz = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sz = b1[1] - b0[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-12) return false;
  const dx = b0[0] - a0[0];
  const dz = b0[1] - a0[1];
  const t = (dx * sz - dz * sx) / denominator;
  const u = (dx * rz - dz * rx) / denominator;
  const e = 1e-9;
  return t > e && t < 1 - e && u > e && u < 1 - e;
}

/** True when `p` is inside the closed ring `ring`, by crossing number. */
function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const zi = ring[i][1];
    const zj = ring[j][1];
    if (zi > p[1] !== zj > p[1]) {
      const x =
        ((ring[j][0] - ring[i][0]) * (p[1] - zi)) / (zj - zi) + ring[i][0];
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Shortest paths from `from` to each of `targets`, going AROUND a closed `ring` — a rope
 * pulled taut in a plane with one obstacle in it.
 *
 * ⭐⭐ The primitive for a TRANSITION, as opposed to {@link oneSidedGeodesic}, which is the
 * primitive for FOLLOWING. A one-sided geodesic returns a subsequence of its input and keeps
 * every input vertex on one side of the result — perfect for bridging a trace's excursions,
 * and impossible to satisfy for a rope wrapped round something, since a wrap has the obstacle
 * on BOTH sides of it. Asking it to wrap produces a wide detour escaping the contradiction.
 *
 * ⭐⭐ Every constraint holds BY CONSTRUCTION rather than by being checked afterwards. An
 * edge that would cross the ring is never added to the graph, so the path cannot cross the
 * obstacle; a shortest path is simple, so it cannot cross itself; and it bends only where it
 * touches the ring, so its turns are the obstacle's own, not new ones.
 *
 * ⭐ ONE search answers every target, because Dijkstra from `from` relaxes the whole graph —
 * so "where should the rope land back on the curve" costs nothing extra to ask.
 *
 * ⚠️ Cost is O(n²) in ring vertices for the visibility test and again for the search, so the
 * ring must be DECIMATED by the caller. A few hundred vertices is fine; a raw trace is not.
 *
 * @param from where the rope is anchored
 * @param targets the points to reach
 * @param ring a simple CLOSED obstacle, implicitly closed from last vertex back to first
 * @returns one path per target, inclusive of both ends, or null where none exists
 *
 * @group Utils
 */
export function tautPathsAround(
  from: Vec2,
  targets: Vec2[],
  ring: Vec2[],
): Array<Vec2[] | null> {
  const nodes: Vec2[] = [from, ...ring, ...targets];
  const n = nodes.length;
  const targetAt = 1 + ring.length;
  const visible = (a: Vec2, b: Vec2): boolean => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if (properlyCross(a, b, ring[j], ring[i])) return false;
    }
    // A segment that crosses nothing lies wholly inside the ring or wholly outside it, so one
    // interior sample settles which — this is what rejects a chord through the obstacle.
    return !pointInRing([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ring);
  };

  const distance = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  distance[0] = 0;
  for (let pass = 0; pass < n; pass++) {
    let at = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && distance[i] < best) {
        best = distance[i];
        at = i;
      }
    }
    if (at < 0) break;
    done[at] = 1;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      // Targets are sinks: routing THROUGH one would let the rope cut a corner off the curve.
      if (at >= targetAt) continue;
      const step = Math.hypot(
        nodes[i][0] - nodes[at][0],
        nodes[i][1] - nodes[at][1],
      );
      if (distance[at] + step >= distance[i]) continue;
      if (!visible(nodes[at], nodes[i])) continue;
      distance[i] = distance[at] + step;
      previous[i] = at;
    }
  }

  return targets.map((_, k) => {
    let at = targetAt + k;
    if (!Number.isFinite(distance[at])) return null;
    const path: Vec2[] = [];
    while (at >= 0) {
      path.push([nodes[at][0], nodes[at][1]]);
      at = previous[at];
    }
    return path.reverse();
  });
}

/**
 * The shortest path from one POSE to another whose curvature never exceeds `1 / radius` —
 * a Dubins CSC path, sampled as a polyline.
 *
 * ⭐⭐ The primitive for a TRANSITION with stiffness. Its shape is not chosen: turn, run
 * straight, turn is the provably shortest way to get from one heading to another without ever
 * turning tighter than `radius`, so the result is a C where both turns agree and an S where
 * they oppose — and it can never be a V, an L or a Z, because those require infinite curvature
 * at a vertex. `radius` is the stiffness, and it is the SAME number a minimum-radius check
 * uses, so the builder and the verifier cannot disagree.
 *
 * ⚠️ Obstacle-blind by construction — bounded curvature and obstacle avoidance are separate
 * concerns. Validate the result against whatever it has to clear, and offer several entry
 * poses rather than expecting one to be free.
 *
 * @param p0 start point
 * @param t0 unit heading at `p0`
 * @param p1 end point
 * @param t1 unit heading at `p1`
 * @param radius minimum turn radius at the START, in metres
 * @param step arc length between samples, in metres. Default 5.
 * @param radiusEnd turn radius at the END. Defaults to `radius`, which is symmetric and
 *   therefore a U; a LARGER value here opens the far end out into a teardrop, approaching the
 *   exit heading gradually instead of meeting it head-on.
 * @returns the path, inclusive of both ends, or null when no CSC form connects the poses
 *
 * @group Utils
 */
export function boundedTurnPath2D(
  p0: Vec2,
  t0: Vec2,
  p1: Vec2,
  t1: Vec2,
  radius: number,
  step: number = 5,
  radiusEnd: number = radius,
): Vec2[] | null {
  if (!(radius > 0) || !(radiusEnd > 0)) return null;
  const rot90 = (v: Vec2): Vec2 => [-v[1], v[0]];
  const unit = (v: Vec2): Vec2 => {
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  };
  const sweepOf = (from: Vec2, to: Vec2, turn: number) => {
    let d = Math.atan2(to[1], to[0]) - Math.atan2(from[1], from[0]);
    while (d < 0) d += 2 * Math.PI;
    while (d >= 2 * Math.PI) d -= 2 * Math.PI;
    return turn > 0 ? d : 2 * Math.PI - d;
  };
  let best: Vec2[] | null = null;
  let bestLength = Infinity;
  for (const turn0 of [1, -1]) {
    for (const turn1 of [1, -1]) {
      const n0 = rot90(t0);
      const n1 = rot90(t1);
      const c0: Vec2 = [
        p0[0] + turn0 * radius * n0[0],
        p0[1] + turn0 * radius * n0[1],
      ];
      const c1: Vec2 = [
        p1[0] + turn1 * radiusEnd * n1[0],
        p1[1] + turn1 * radiusEnd * n1[1],
      ];
      const between: Vec2 = [c1[0] - c0[0], c1[1] - c0[1]];
      const span = Math.hypot(between[0], between[1]);
      const u = unit(between);
      // ⭐ One relation covers both tangent families and unequal radii: the tangent normal `n`
      // satisfies `n · (c1 − c0) = r0 ∓ r1`, minus when the two arcs turn the same way (an
      // external tangent) and plus when they oppose (an internal one).
      const reach = turn0 === turn1 ? radius - radiusEnd : radius + radiusEnd;
      if (Math.abs(reach) > span) continue;
      const psi = Math.acos(reach / span);
      const base = Math.atan2(u[1], u[0]);
      for (const sign of [1, -1]) {
        const n: Vec2 = [
          Math.cos(base + sign * psi),
          Math.sin(base + sign * psi),
        ];
        const q0: Vec2 = [c0[0] + radius * n[0], c0[1] + radius * n[1]];
        const far = turn0 === turn1 ? radiusEnd : -radiusEnd;
        const q1: Vec2 = [c1[0] + far * n[0], c1[1] + far * n[1]];
        const run = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
        if (run < 1e-9) continue;
        const runDirection = unit([q1[0] - q0[0], q1[1] - q0[1]]);
        // ⚠️ The sign cases are VERIFIED rather than reasoned about: a candidate whose straight
        // run does not leave along the heading the arc actually ends on is dropped, so a sign
        // error cannot silently produce a path that kinks at the joint.
        const leaving = rot90([n[0] * turn0, n[1] * turn0]);
        if (leaving[0] * runDirection[0] + leaving[1] * runDirection[1] < 0.999)
          continue;
        const sweep0 = sweepOf(
          [p0[0] - c0[0], p0[1] - c0[1]],
          [q0[0] - c0[0], q0[1] - c0[1]],
          turn0,
        );
        const sweep1 = sweepOf(
          [q1[0] - c1[0], q1[1] - c1[1]],
          [p1[0] - c1[0], p1[1] - c1[1]],
          turn1,
        );
        const length = radius * sweep0 + radiusEnd * sweep1 + run;
        if (length >= bestLength) continue;
        const out: Vec2[] = [];
        const arc = (
          centre: Vec2,
          from: Vec2,
          sweep: number,
          turn: number,
          r: number,
        ) => {
          const a0 = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
          const steps = Math.max(1, Math.ceil((r * sweep) / step));
          for (let k = 0; k <= steps; k++) {
            const a = a0 + turn * sweep * (k / steps);
            out.push([
              centre[0] + Math.cos(a) * r,
              centre[1] + Math.sin(a) * r,
            ]);
          }
        };
        arc(c0, p0, sweep0, turn0, radius);
        const runSteps = Math.max(1, Math.ceil(run / step));
        for (let k = 1; k < runSteps; k++) {
          out.push([
            q0[0] + (q1[0] - q0[0]) * (k / runSteps),
            q0[1] + (q1[1] - q0[1]) * (k / runSteps),
          ]);
        }
        arc(c1, q1, sweep1, turn1, radiusEnd);
        best = out;
        bestLength = length;
      }
    }
  }
  return best;
}

/**
 * A BIARC turn: two tangent circular arcs from `p0` leaving along `t0` to `p1` arriving
 * along `t1`, sampled as a polyline.
 *
 * ⭐⭐ The primitive for a turn whose size is not known in advance. A biarc exists for ANY
 * pair of poses and cannot cusp or loop — unlike a cubic with pinned tangents, which
 * degenerates the moment the departure tangent opposes the chord (exactly the case a fence
 * run-out hits when the escape bearing points back over the well). Curvature is bounded by
 * construction and G1 holds at both ends and at the joint, so the swept face has no crease.
 *
 * ⚠️⚠️ An exactly opposed U-turn has NO preferred plane — the equal-chord joint lands on an
 * endpoint and the "turn" collapses to the chord, which is a 180° reversal, not an arc. That
 * is worse than the cusp it replaced, so the tie is broken by `bias`. Pass the direction the
 * turn should bulge toward (for a fence arm: away from the well) rather than leaving it to
 * the default.
 *
 * @param p0 start point
 * @param t0 unit tangent leaving `p0`
 * @param p1 end point
 * @param t1 unit tangent arriving at `p1`
 * @param bias unit direction the turn bulges toward when the pose is degenerate
 * @param step radians per sample along each arc. Default 3°.
 * @returns the turn, inclusive of both endpoints
 *
 * @group Utils
 */
export function biarc2D(
  p0: Vec2,
  t0: Vec2,
  p1: Vec2,
  t1: Vec2,
  bias?: Vec2,
  step: number = Math.PI / 60,
): Vec2[] {
  const vx = p1[0] - p0[0];
  const vz = p1[1] - p0[1];
  const vv = vx * vx + vz * vz;
  if (vv < 1e-18) return [[p0[0], p0[1]]];
  const span = Math.sqrt(vv);
  const tt = t0[0] * t1[0] + t0[1] * t1[1];
  const sx = t0[0] + t1[0];
  const sz = t0[1] + t1[1];
  const vt = vx * sx + vz * sz;
  // Equal-chord biarc: the leg length that puts the joint on both arcs.
  let leg: number;
  const denom = 2 * (1 - tt);
  if (Math.abs(denom) < 1e-9) {
    const vt1 = vx * t1[0] + vz * t1[1];
    leg = Math.abs(vt1) < 1e-9 ? span / 2 : vv / (4 * vt1);
  } else {
    leg = (-vt + Math.sqrt(Math.max(0, vt * vt + denom * vv))) / denom;
  }
  if (!(leg > 0) || !Number.isFinite(leg) || leg > 4 * span) leg = span / 4;
  let joint: Vec2 = [
    (p0[0] + t0[0] * leg + (p1[0] - t1[0] * leg)) * 0.5,
    (p0[1] + t0[1] * leg + (p1[1] - t1[1] * leg)) * 0.5,
  ];
  // The joint landed on an endpoint: the two poses are opposed and the turn has no plane
  // of its own. Take the caller's, or the left of the chord.
  const gap = span * 1e-3;
  if (
    Math.hypot(joint[0] - p0[0], joint[1] - p0[1]) < gap ||
    Math.hypot(joint[0] - p1[0], joint[1] - p1[1]) < gap
  ) {
    const n = bias ?? leftNormal2D(vx, vz);
    joint = [
      (p0[0] + p1[0]) * 0.5 + n[0] * span * 0.5,
      (p0[1] + p1[1]) * 0.5 + n[1] * span * 0.5,
    ];
  }
  // The second arc is built backwards from `p1` so its pinned tangent is the one at `p1`.
  const second = arcThrough(p1, [-t1[0], -t1[1]], joint, step).reverse();
  return [...arcThrough(p0, t0, joint, step), joint, ...second];
}

/**
 * Unit left normal at every vertex, averaged across the two adjacent segments.
 *
 * @group Utils
 */
export function polylineNormals2D(points: Vec2[]): Vec2[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [[0, 0]];
  const segment: Vec2[] = [];
  for (let i = 1; i < n; i++) {
    segment.push(
      leftNormal2D(
        points[i][0] - points[i - 1][0],
        points[i][1] - points[i - 1][1],
      ),
    );
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = segment[Math.max(0, i - 1)];
    const b = segment[Math.min(segment.length - 1, i)];
    const x = a[0] + b[0];
    const z = a[1] + b[1];
    const len = Math.hypot(x, z);
    out.push(len > 1e-9 ? [x / len, z / len] : [b[0], b[1]]);
  }
  return out;
}

/**
 * Move a polyline `distance` along its left normal — negative for the right.
 *
 * ⭐ Mitred: each vertex is pushed along the AVERAGED normal, lengthened by
 * `1 / cos(θ/2)` so the offset segments still meet. Without that the offset of a
 * bend is short by exactly the amount the corner cuts.
 *
 * ⚠️ The miter is capped, and the result de-looped: an offset larger than the
 * local turning radius folds on the inside of a bend no matter how it is built.
 * That is geometry, not an implementation limit.
 *
 * @group Utils
 */
export function offsetPolyline2D(
  points: Vec2[],
  distance: number | ArrayLike<number>,
  miterLimit: number = 4,
): Vec2[] {
  if (points.length === 0) return points;
  if (typeof distance === 'number' && distance === 0) return points;
  const at = (i: number) =>
    typeof distance === 'number'
      ? distance
      : distance[Math.min(i, distance.length - 1)];
  const normals = polylineNormals2D(points);
  const n = points.length;
  const segment: Vec2[] = [];
  for (let i = 1; i < n; i++) {
    segment.push(
      leftNormal2D(
        points[i][0] - points[i - 1][0],
        points[i][1] - points[i - 1][1],
      ),
    );
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const avg = normals[i];
    const face = segment[Math.min(segment.length - 1, Math.max(0, i - 1))];
    const cos = avg[0] * face[0] + avg[1] * face[1];
    const scale = Math.min(cos > 1e-3 ? 1 / cos : miterLimit, miterLimit);
    out.push([
      points[i][0] + avg[0] * at(i) * scale,
      points[i][1] + avg[1] * at(i) * scale,
    ]);
  }
  return removePolylineLoops(out);
}

/**
 * Smallest turning radius anywhere on a polyline, measured over an arc-length
 * WINDOW.
 *
 * ⚠️⚠️ Not per vertex. A per-vertex turn is measured against the sample spacing,
 * so densely sampled points always report a tight radius and straightening the
 * curve — which shortens its segments — makes the measure worse rather than
 * better. A fixed window in metres is independent of how the curve was sampled.
 *
 * @returns metres, or `Infinity` for a straight polyline
 *
 * @group Utils
 */
export function polylineMinRadius(
  points: Vec2[],
  window: number,
  from: number = 0,
  to: number = Infinity,
): number {
  const n = points.length;
  if (n < 3) return Infinity;
  const arc = polylineArcLengths(points);
  const total = arc[n - 1];
  if (!(total > 0)) return Infinity;
  // ⚠️ A window wider than the curve leaves every vertex ineligible and reports a
  // hairpin as perfectly straight. Short curves get a proportionally short window
  // rather than no measurement at all.
  const half = Math.max(Math.min(window, total / 3) * 0.5, 1e-6);
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const at = arc[i];
    if (at < from || at > to) continue;
    if (at < half || at > total - half) continue;
    const a = pointAtArcLength(points, arc, at - half);
    const b = points[i];
    const c = pointAtArcLength(points, arc, at + half);
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area2 = Math.abs(
      (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]),
    );
    if (area2 < 1e-9) continue;
    const radius = (ab * bc * ca) / (2 * area2);
    if (radius < min) min = radius;
  }
  return min;
}

/** {@link relaxPolyline2DWithin} options. */
export type RelaxOptions = {
  /** stop early once no point turns tighter than this, in metres */
  minRadius: number;
  /** arc length the radius is measured over. Default `minRadius`. */
  window?: number;
  /** cap on smoothing passes. Default 3000. */
  maxIterations?: number;
  /** how often the radius is re-measured, in passes. Default 25. */
  checkEvery?: number;
  /** movement per pass, in metres, below which the curve counts as settled */
  settleAt?: number;
};

/** What {@link relaxPolyline2DWithin} achieved. */
export type RelaxResult = {
  points: Vec2[];
  iterations: number;
  /** the turning radius reached */
  minRadius: number;
  /**
   * Whether the curve reached a FIXED POINT of smooth-then-clamp.
   *
   * ⚠️⚠️ Not "reached `minRadius`". A corridor can make a radius unreachable, and
   * it often should: a genuine dogleg in the reservoir is the well, not noise, and
   * a tight corridor there is what stops it being smoothed away. `minRadius` is an
   * early-out for curves that are already good enough, not a contract.
   */
  settled: boolean;
  /** furthest any point ended up from where it started, in metres */
  maxDeviation: number;
};

/**
 * Straighten a polyline as much as a per-point tolerance corridor allows.
 *
 * ⭐⭐ The corridor is what makes this safe where a plain smoother is not. Every
 * pass is a binomial average — a diffusion, so it cannot fold the curve — and is
 * immediately followed by pulling each point back inside its own tolerance disc
 * around where it started. The deviation is therefore BOUNDED BY CONSTRUCTION at
 * `tolerance[i]`, and the result is the tautest curve the corridor contains
 * rather than whatever a curvature heuristic happened to converge to.
 *
 * ⚠️ `minRadius` may be unreachable inside the corridor. That is reported rather
 * than forced — a caller that cannot accept the result should widen the corridor
 * or drop the offending section, not smooth harder.
 *
 * @param points the polyline to straighten
 * @param tolerance how far each point may move, in metres, one per point
 *
 * @group Utils
 */
export function relaxPolyline2DWithin(
  points: Vec2[],
  tolerance: ArrayLike<number>,
  options: RelaxOptions,
): RelaxResult {
  const n = points.length;
  const window = options.window ?? options.minRadius;
  const maxIterations = options.maxIterations ?? 3000;
  const checkEvery = Math.max(1, options.checkEvery ?? 25);
  const settleAt = options.settleAt ?? 0.02;
  const deviationOf = (current: Vec2[]) => {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const d = distanceVec2(points[i], current[i]);
      if (d > worst) worst = d;
    }
    return worst;
  };
  if (n < 3) {
    return {
      points,
      iterations: 0,
      minRadius: Infinity,
      settled: true,
      maxDeviation: 0,
    };
  }

  let current: Vec2[] = points.map(p => [p[0], p[1]] as Vec2);
  let next: Vec2[] = points.map(p => [p[0], p[1]] as Vec2);
  let radius = polylineMinRadius(current, window);
  let iterations = 0;
  let settled = false;

  while (radius < options.minRadius && iterations < maxIterations && !settled) {
    let moved = 0;
    for (let pass = 0; pass < checkEvery; pass++) {
      moved = 0;
      for (let i = 0; i < n; i++) {
        const a = current[Math.max(0, i - 1)];
        const b = current[i];
        const c = current[Math.min(n - 1, i + 1)];
        let x = 0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0];
        let z = 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1];
        // Back inside the corridor. This is the whole safety argument: however
        // many passes run, no point ever ends up further than its own tolerance
        // from where the trajectory actually put it.
        const limit = tolerance[Math.min(i, tolerance.length - 1)];
        const dx = x - points[i][0];
        const dz = z - points[i][1];
        const away = Math.hypot(dx, dz);
        if (away > limit && away > 1e-12) {
          const k = limit / away;
          x = points[i][0] + dx * k;
          z = points[i][1] + dz * k;
        }
        const step = Math.hypot(x - current[i][0], z - current[i][1]);
        if (step > moved) moved = step;
        next[i][0] = x;
        next[i][1] = z;
      }
      const swap = current;
      current = next;
      next = swap;
      iterations++;
      // Every point is either straightened or pinned against its corridor; once
      // nothing moves there is nothing left to gain from smoothing harder.
      if (moved < settleAt) {
        settled = true;
        break;
      }
    }
    radius = polylineMinRadius(current, window);
  }

  return {
    points: current,
    iterations,
    minRadius: radius,
    settled: settled || radius >= options.minRadius,
    maxDeviation: deviationOf(current),
  };
}

/**
 * The direction a polyline leaves one of its ends in, measured over at least
 * `overArc` of curve.
 *
 * ⚠️ Not the first segment. A resampled curve's end segment can be a fraction of
 * the spacing, so its direction says more about what the resampler had left over
 * than about the shape of the curve.
 *
 * @group Utils
 */
export function endTangent2D(
  points: Vec2[],
  fromStart: boolean,
  overArc: number = 0,
): Vec2 | null {
  const n = points.length;
  if (n < 2) return null;
  const apex = fromStart ? points[0] : points[n - 1];
  let fallback: Vec2 | null = null;
  for (let k = 1; k < n; k++) {
    const p = points[fromStart ? k : n - 1 - k];
    const dx = p[0] - apex[0];
    const dz = p[1] - apex[1];
    const length = Math.hypot(dx, dz);
    if (length <= 1e-6) continue;
    const direction: Vec2 = [dx / length, dz / length];
    if (!fallback) fallback = direction;
    if (length >= overArc) return direction;
  }
  return fallback;
}

/**
 * Unit tangent at one END of a polyline, as the arc-length-weighted MEAN of its segment
 * directions over `overArc` metres.
 *
 * ⚠️⚠️ NOT {@link endTangent2D}. That returns the CHORD to the first vertex past `overArc`,
 * which on a curving end says where the curve GOT TO, not which way it leaves. Joining a
 * smooth arm onto a chord-derived tangent leaves a kink of exactly the angle between the
 * two — measured 62° and 113° at fence run-out junctions, reproducing the reported junction
 * turn to within half a degree. The mean stays local, and unlike a SHORT chord it does not
 * degenerate when the end doubles back inside `overArc`.
 *
 * @param points an open polyline
 * @param fromStart measure at the first vertex rather than the last
 * @param overArc metres of arc to average over; shorter is more local
 * @returns unit direction pointing INTO the curve from that end, or null
 *
 * @group Utils
 */
export function meanTangent2D(
  points: Vec2[],
  fromStart: boolean,
  overArc: number,
): Vec2 | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0;
  let sz = 0;
  let arc = 0;
  for (let k = 0; k + 1 < n; k++) {
    const a = points[fromStart ? k : n - 1 - k];
    const b = points[fromStart ? k + 1 : n - 2 - k];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length <= 1e-9) continue;
    const weight = Math.min(length, Math.max(0, overArc - arc));
    sx += (dx / length) * weight;
    sz += (dz / length) * weight;
    arc += length;
    if (arc >= overArc) break;
  }
  const l = Math.hypot(sx, sz);
  if (l <= 1e-9) return endTangent2D(points, fromStart, overArc);
  return [sx / l, sz / l];
}

/**
 * Turning radius at every vertex, measured over an arc-length WINDOW.
 *
 * ⭐ Per vertex rather than a single minimum, so a caller can open the cut exactly
 * where the curve turns too tightly to be followed rather than everywhere.
 *
 * @returns metres per vertex; `Infinity` where the curve is straight
 *
 * @group Utils
 */
export function polylineRadiusProfile(
  points: Vec2[],
  window: number,
): Float64Array {
  const n = points.length;
  const out = new Float64Array(n).fill(Infinity);
  if (n < 3) return out;
  const arc = polylineArcLengths(points);
  const total = arc[n - 1];
  if (!(total > 0)) return out;
  const half = Math.max(Math.min(window, total / 3) * 0.5, 1e-6);
  for (let i = 0; i < n; i++) {
    const a = pointAtArcLength(points, arc, arc[i] - half);
    const b = points[i];
    const c = pointAtArcLength(points, arc, arc[i] + half);
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area2 = Math.abs(
      (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]),
    );
    if (area2 < 1e-9) continue;
    out[i] = (ab * bc * ca) / (2 * area2);
  }
  return out;
}

/**
 * Unwrapped heading of every segment, so turns accumulate instead of wrapping.
 *
 * @group Utils
 */
export function polylineHeadings2D(points: Vec2[]): Float64Array {
  const out = new Float64Array(Math.max(0, points.length - 1));
  for (let i = 0; i + 1 < points.length; i++) {
    const a = Math.atan2(
      points[i + 1][1] - points[i][1],
      points[i + 1][0] - points[i][0],
    );
    if (i === 0) {
      out[0] = a;
      continue;
    }
    let step = a - out[i - 1];
    while (step > Math.PI) step -= 2 * Math.PI;
    while (step <= -Math.PI) step += 2 * Math.PI;
    out[i] = out[i - 1] + step;
  }
  return out;
}

/**
 * The largest turn a polyline makes within any `window` metres of arc, in radians.
 *
 * ⭐ Density-independent: it is the net heading change over an ARC, so the same shape scores the
 * same however finely it is sampled (measured 7.2° on an R=200 m arc at 1, 5 and 25 m spacing,
 * exactly `window / R`).
 *
 * ⚠️⚠️ The ADJACENT pair is always measured, however long the two segments are. Testing the
 * window first meant a segment longer than `window` broke the scan before its own corner was
 * ever looked at — measured 0.0° for a 90° corner between two 1 km segments, against 90.0° for
 * the identical shape sampled at 25 m. This check is the GLOBAL smoothness constraint, and that
 * made it switch itself off precisely where a cut had been chorded.
 *
 * @group Utils
 */
export function polylineMaxTurn(points: Vec2[], window: number): number {
  if (points.length < 3) return 0;
  const arc = polylineArcLengths(points);
  const heading = polylineHeadings2D(points);
  let worst = 0;
  for (let i = 0; i + 1 < heading.length; i++) {
    for (let j = i + 1; j < heading.length; j++) {
      if (j > i + 1 && arc[j] - arc[i] > window) break;
      const turn = Math.abs(heading[j] - heading[i]);
      if (turn > worst) worst = turn;
    }
  }
  return worst;
}

/** The sharpest single corner on a polyline, and where — see {@link polylineWorstTurn}. */
export type PolylineTurn = {
  /** the relative turn between the two segments meeting at `index`, in RADIANS */
  turn: number;
  /** the vertex index, or -1 when the path is too short to turn anywhere */
  index: number;
  /** that vertex */
  at: Vec2;
};

/**
 * The sharpest RELATIVE turn at any single vertex, and where it is.
 *
 * ⭐ A corner measure, not a curvature one — deliberately complementary to
 * {@link polylineMaxTurn}, which accumulates heading change over an arc `window` and so reports a
 * large number for a long smooth bend (measured 283.6° on a fence cut whose sharpest corner was
 * 177.5°). Use this when the question is "does this path kink anywhere", and `polylineMaxTurn`
 * when it is "how tightly does this path curve".
 *
 * ⚠️ Deliberately NOT arm-weighted like {@link polylineSharpEdges}: arm weighting forgives a large
 * turn taken between two SHORT segments, which is exactly the cusp this is meant to find.
 *
 * @group Utils
 */
export function polylineWorstTurn(points: Vec2[]): PolylineTurn {
  let worst: PolylineTurn = { turn: 0, index: -1, at: points[0] ?? [0, 0] };
  for (let k = 1; k < points.length - 1; k++) {
    const ax = points[k][0] - points[k - 1][0];
    const az = points[k][1] - points[k - 1][1];
    const bx = points[k + 1][0] - points[k][0];
    const bz = points[k + 1][1] - points[k][1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const c = (ax * bx + az * bz) / (la * lb);
    const turn = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
    if (turn > worst.turn) worst = { turn, index: k, at: points[k] };
  }
  return worst;
}

/**
 * Index spans where a polyline turns more than `budget` radians within `window` metres of
 * arc — WHERE {@link polylineMaxTurn} finds its excess, so a repair can act on it.
 *
 * Overlapping spans are merged, so a long sweeping bend is reported once rather than at
 * every vertex along it.
 *
 * @group Utils
 */
export function polylineTurnSpans(
  points: Vec2[],
  window: number,
  budget: number,
): Array<[number, number]> {
  if (points.length < 3) return [];
  const arc = polylineArcLengths(points);
  const heading = polylineHeadings2D(points);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i + 1 < heading.length; i++) {
    for (let j = i + 1; j < heading.length; j++) {
      // The adjacent pair is always measured, however long the segments — see polylineMaxTurn.
      if (j > i + 1 && arc[j] - arc[i] > window) break;
      if (Math.abs(heading[j] - heading[i]) > budget) {
        spans.push([i, Math.min(points.length - 1, j + 1)]);
        break;
      }
    }
  }
  if (spans.length < 2) return spans;
  const merged: Array<[number, number]> = [spans[0]];
  for (let k = 1; k < spans.length; k++) {
    const last = merged[merged.length - 1];
    if (spans[k][0] <= last[1]) last[1] = Math.max(last[1], spans[k][1]);
    else merged.push(spans[k]);
  }
  return merged;
}

/**
 * The runs of vertices where a polyline turns more than `turn` radians across a `window`
 * of arc CENTRED on the vertex — the genuinely tight bends a smooth cut should not have.
 *
 * ⭐⭐ Local CURVATURE, measured with the window straddling each vertex, so the flag sits
 * on the bend itself. Accumulating forward from an arbitrary start instead makes the region
 * bleed along a gentle continuation and fire wherever the curve happens to keep turning —
 * a per-vertex centred window localises to the actual corner. A tight bend built from many
 * short segments is still caught, because it is the turn over the window that counts, not
 * the turn between two adjacent segments.
 *
 * ⚠️ The heading change is the SIGNED net across the window, so an S that turns one way then
 * back (a wiggle) is not a sharp bend; only sustained one-way curvature is.
 *
 * @param points an open polyline
 * @param turn heading change across the window that counts as sharp, in radians
 * @param window arc length the turn is measured over, in metres
 *
 * @group Utils
 */
export function polylineSharpRegions(
  points: Vec2[],
  turn: number,
  window: number,
): Vec2[][] {
  const n = points.length;
  if (n < 3 || !(window > 0)) return [];
  const arc = polylineArcLengths(points);
  const heading = polylineHeadings2D(points);
  const half = window / 2;
  const sharp = new Array<boolean>(n).fill(false);
  // Two pointers: the segment straddling `window/2` before and after each vertex. Both
  // advance monotonically as the vertex walks forward, so this stays linear.
  let a = 0;
  let b = 0;
  for (let k = 1; k < n - 1; k++) {
    const lo = arc[k] - half;
    const hi = arc[k] + half;
    while (a < heading.length - 1 && arc[a + 1] <= lo) a++;
    while (b < heading.length - 1 && arc[b + 1] <= hi) b++;
    if (Math.abs(heading[b] - heading[a]) >= turn) sharp[k] = true;
  }
  const regions: Vec2[][] = [];
  let k = 1;
  while (k < n - 1) {
    if (!sharp[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < n - 1 && sharp[e + 1]) e++;
    const region: Vec2[] = [];
    for (let m = k; m <= e; m++) region.push([points[m][0], points[m][1]]);
    regions.push(region);
    k = e + 1;
  }
  return regions;
}

/**
 * The runs of vertices that are SHARP EDGES: a large relative turn between two segments,
 * weighted by the length of its arms.
 *
 * ⭐ On a polyline a sharp ANGLE is not always a sharp EDGE. A big turn between two LONG
 * segments is a real corner; the same turn between two SHORT segments is just a densely
 * sampled curve, not an edge. So a corner's strength is its relative turn scaled by arm
 * length — but each arm is CAPPED at `arm` first, so a very long straight run (a run-out to
 * the tip) cannot let a slight turn read as an edge, and the two capped arms are AVERAGED, so
 * a corner needs length on BOTH sides. A right-angle relative turn is always an edge.
 *
 * @param points an open polyline
 * @param angle the relative turn that is sharp when both arms reach `arm`, in radians
 * @param arm the arm length each side is capped at, in metres; the threshold scales with it,
 *   so a LARGER value is STRICTER: a turn then needs longer arms or a bigger angle to flag
 *
 * @group Utils
 */
export function polylineSharpEdges(
  points: Vec2[],
  angle: number,
  arm: number,
): Vec2[][] {
  const n = points.length;
  if (n < 3) return [];
  const HARD_TURN = Math.PI / 2;
  const cap = Math.max(1e-6, arm);
  const budget = Math.max(1e-6, angle) * cap;
  const sharp = new Array<boolean>(n).fill(false);
  for (let k = 1; k < n - 1; k++) {
    const ax = points[k][0] - points[k - 1][0];
    const az = points[k][1] - points[k - 1][1];
    const bx = points[k + 1][0] - points[k][0];
    const bz = points[k + 1][1] - points[k][1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cos = (ax * bx + az * bz) / (la * lb);
    const turn = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
    // Each arm counts for at most `cap`, then the two are averaged, so neither a very long
    // straight nor a single long arm alone can make a turn read as an edge.
    const effArm = (Math.min(la, cap) + Math.min(lb, cap)) / 2;
    if (turn >= HARD_TURN || turn * effArm > budget) sharp[k] = true;
  }
  const regions: Vec2[][] = [];
  let k = 1;
  while (k < n - 1) {
    if (!sharp[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < n - 1 && sharp[e + 1]) e++;
    const region: Vec2[] = [];
    for (let m = k; m <= e; m++) region.push([points[m][0], points[m][1]]);
    regions.push(region);
    k = e + 1;
  }
  return regions;
}

/** The relative turn at `b` (between a→b and b→c), weighted by capped, averaged arms. */
function armWeightedSharp(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  budget: number,
  cap: number,
): boolean {
  const ax = b[0] - a[0];
  const az = b[1] - a[1];
  const bx = c[0] - b[0];
  const bz = c[1] - b[1];
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-9 || lb < 1e-9) return false;
  const cos = (ax * bx + az * bz) / (la * lb);
  const turn = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
  if (turn >= Math.PI / 2) return true;
  const effArm = (Math.min(la, cap) + Math.min(lb, cap)) / 2;
  return turn * effArm > budget;
}

/**
 * Distance from a point to a segment.
 *
 * @group Utils
 */
export function distanceToSegment2D(p: Vec2, a: Vec2, b: Vec2): number {
  return distToSegment(p, a, b);
}

/** Distance from point `p` to segment `a`–`b`. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const len2 = ex * ex + ez * ez;
  let t = 0;
  if (len2 > 0) {
    t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const qx = a[0] + ex * t;
  const qz = a[1] + ez * t;
  return Math.hypot(p[0] - qx, p[1] - qz);
}

/**
 * Distance between two segments, 0 when they cross.
 *
 * ⚠️ The four endpoint-to-segment distances alone are NOT enough: two segments that cross in
 * an X have all four of them positive, and that is exactly the case worth catching.
 */
function segmentDistance2D(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): number {
  const rx = a1[0] - a0[0];
  const rz = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sz = b1[1] - b0[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) > 1e-12) {
    const dx = b0[0] - a0[0];
    const dz = b0[1] - a0[1];
    const t = (dx * sz - dz * sx) / denominator;
    const u = (dx * rz - dz * rx) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    distToSegment(a0, b0, b1),
    distToSegment(a1, b0, b1),
    distToSegment(b0, a0, a1),
    distToSegment(b1, a0, a1),
  );
}

/** Whether segment `a`–`b` stays at least `minClearance` from every vertex of `well`. */
function segmentClearsWell(
  a: Vec2,
  b: Vec2,
  well: Vec2[],
  minClearance: number,
): boolean {
  const loX = Math.min(a[0], b[0]) - minClearance;
  const hiX = Math.max(a[0], b[0]) + minClearance;
  const loZ = Math.min(a[1], b[1]) - minClearance;
  const hiZ = Math.max(a[1], b[1]) + minClearance;
  for (let i = 0; i < well.length; i++) {
    const w = well[i];
    if (w[0] < loX || w[0] > hiX || w[1] < loZ || w[1] > hiZ) continue;
    if (distToSegment(w, a, b) < minClearance) return false;
  }
  return true;
}

/**
 * Simplify a cut curve as far as it can go while keeping every constraint the cut was
 * built to — clearance, smoothness and simplicity — so coarsening cannot undo them.
 *
 * ⭐⭐ A single greedy that JUMPS from each anchor to the furthest point ahead whose chord
 * (1) stays at least `minClearance` from the well — a longer segment only ever leaves a
 * LARGER gap, never a smaller one — and (2) is not a sharp edge at its new joints by the
 * arm-weighted rule ({@link polylineSharpEdges}). A skipped vertex is dropped only if it is
 * ALREADY sharp — a loop, zig-zag or pinch worth bridging across — or lies within
 * `maxDeviation` of the chord. So at `maxDeviation = 0` the cut keeps its dense following of
 * a real bend but bridges the defects, and a larger value coarsens the smooth stretches too.
 *
 * ⚠️ It can BACKTRACK across a whole span, not just drop one vertex, which is what a loop or
 * a run of zig-zags needs. A final {@link removePolylineLoops} guards against any chord that
 * a bridge left crossing another part of the curve.
 *
 * @param points the cut curve, in scene XZ
 * @param well the trajectory the cut must stay clear of
 * @param minClearance metres the cut must stay off the well
 * @param maxDeviation metres a NON-defect vertex may be simplified away by (0 = tightest)
 * @param sharpAngle the arm-weighted sharp turn threshold, in radians
 * @param sharpArm the arm length each side is capped at, in metres
 *
 * @group Utils
 */
export function simplifyPolylineClearOf(
  points: Vec2[],
  well: Vec2[],
  minClearance: number,
  maxDeviation: number,
  sharpAngle: number,
  sharpArm: number,
): Vec2[] {
  const n = points.length;
  if (n < 3) return points.map(p => [p[0], p[1]] as Vec2);
  const cap = Math.max(1e-6, sharpArm);
  const budget = Math.max(1e-6, sharpAngle) * cap;
  // A vertex already sharp on the input is a defect (loop/zig-zag/pinch) — bridgeable even
  // beyond `maxDeviation`.
  const defect = new Array<boolean>(n).fill(false);
  for (let k = 1; k < n - 1; k++) {
    defect[k] = armWeightedSharp(
      points[k - 1],
      points[k],
      points[k + 1],
      budget,
      cap,
    );
  }
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  let i = 0;
  // Bounded so one anchor cannot scan the whole (possibly kilometre-long) curve.
  const MAX_LOOKAHEAD = 200;
  while (i < n - 1) {
    const prev = out.length >= 2 ? out[out.length - 2] : null;
    let best = i + 1;
    const limit = Math.min(n - 1, i + MAX_LOOKAHEAD);
    for (let j = i + 2; j <= limit; j++) {
      // (1) Clearance: once the chord touches the well it only gets worse locally — stop.
      if (!segmentClearsWell(points[i], points[j], well, minClearance)) break;
      // (2) Smoothness: the new joints (at the anchor and at j) must not be sharp.
      if (prev && armWeightedSharp(prev, points[i], points[j], budget, cap))
        continue;
      if (
        j + 1 < n &&
        armWeightedSharp(points[i], points[j], points[j + 1], budget, cap)
      ) {
        continue;
      }
      // (3) Skipped vertices: a defect may go; a good vertex only within maxDeviation.
      let ok = true;
      for (let k = i + 1; k < j; k++) {
        if (
          !defect[k] &&
          distToSegment(points[k], points[i], points[j]) > maxDeviation
        ) {
          ok = false;
          break;
        }
      }
      if (ok) best = j;
    }
    out.push([points[best][0], points[best][1]]);
    i = best;
  }
  return removePolylineLoops(out);
}

/**
 * Cut straight through every stretch that turns more than `maxTurn` within
 * `window` metres of arc.
 *
 * ⭐⭐ Measured over a WINDOW, not between adjacent segments. A per-vertex limit
 * passes a curve that turns a few degrees per step for twenty steps, which is a near
 * loop — the shape that has no business being a cut, and whose ideal repair is a
 * straight line through it. The window is what sees the trend.
 *
 * ⭐ The widest offender first, so one chord takes the whole excursion instead of
 * nibbling at its ends.
 *
 * ⭐ `maxTurn` may be a function of position, because the budget is not uniform along
 * a wellbore: near TD the cut has to hug a trajectory that genuinely bends, while at
 * the head it is following survey scatter and should be straightened instead.
 *
 * ⚠️ A chord MOVES the boundary, so anything that has to stay clear of the curve has
 * to be re-checked afterwards — see {@link pushPolyline2DClearOf}.
 *
 * @param points an open polyline
 * @param maxTurn accumulated turn allowed within the window, in radians, or a
 *   function giving it at a point
 * @param window arc length the turn is accumulated over, in metres
 *
 * @group Utils
 */
export function limitPolylineTurn(
  points: Vec2[],
  maxTurn: number | ((at: Vec2) => number),
  window: number,
): { points: Vec2[]; chorded: number } {
  const budget = typeof maxTurn === 'function' ? maxTurn : () => maxTurn;
  if (points.length < 3 || !(window > 0)) {
    return { points, chorded: 0 };
  }
  let current = points;
  let chorded = 0;
  for (let guard = 0; guard < 256; guard++) {
    const arc = polylineArcLengths(current);
    const heading = polylineHeadings2D(current);
    let found: { i: number; j: number } | null = null;
    for (let i = 0; i + 1 < heading.length && !found; i++) {
      const allowed = budget(current[i]);
      if (!(allowed > 0)) continue;
      let last = -1;
      for (let j = i + 1; j < heading.length; j++) {
        if (arc[j] - arc[i] > window) break;
        if (Math.abs(heading[j] - heading[i]) > allowed) last = j;
      }
      if (last > 0) found = { i, j: last };
    }
    if (!found) break;
    const next = [
      ...current.slice(0, found.i + 1),
      ...current.slice(found.j + 1),
    ];
    if (next.length < 2 || next.length >= current.length) break;
    current = next;
    chorded++;
  }
  return { points: current, chorded };
}

/**
 * Spread a per-vertex quantity along the curve: a moving MAX, then a blur.
 *
 * ⭐ The max is what makes an opening cover the whole feature that caused it rather
 * than just the one vertex; the blur is what stops the resulting offset having a
 * step in it, which would read as a kink in the cut.
 *
 * @group Utils
 */
export function spreadAlongPolyline(
  points: Vec2[],
  values: ArrayLike<number>,
  window: number,
): Float64Array {
  const n = points.length;
  const arc = polylineArcLengths(points);
  const peak = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let j = i; j < n && arc[j] - arc[i] <= window; j++) {
      if (values[j] > best) best = values[j];
    }
    for (let j = i; j >= 0 && arc[i] - arc[j] <= window; j--) {
      if (values[j] > best) best = values[j];
    }
    peak[i] = best;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < n && arc[j] - arc[i] <= window * 0.5; j++) {
      sum += peak[j];
      count++;
    }
    for (let j = i - 1; j >= 0 && arc[i] - arc[j] <= window * 0.5; j--) {
      sum += peak[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : peak[i];
  }
  return out;
}

/**
 * Repair places where a polyline comes back CLOSE to itself, for ONE side.
 *
 * ⭐⭐ A hairpin encloses a pocket, and that pocket lies wholly on one side. On the
 * side that REMOVES it there is no thin material at all and nothing to repair — so
 * the excursion is left alone, and the trajectory running through it stays in the
 * open. On the other side the pocket is a blade of kept material too thin to draw,
 * and the curve is routed INTO it so that the excursion ends up in the removed half.
 *
 * ⚠️⚠️ NOT a chord across the excursion. A chord SHRINKS the removed half, and the
 * trajectory sits on that half's boundary — so chording buries it, measured at up to
 * 320 m inside solid rock on one side while the other side was fine. The repair must
 * only ever GROW the removed half, which is what routing round the pocket does.
 *
 * @param points an open polyline
 * @param clearance how close two parts may come, in metres
 * @param side which half is being removed, by the left normal
 *
 * @group Utils
 */
export function repairPolylineWaists(
  points: Vec2[],
  clearance: number,
  side: 1 | -1,
): { points: Vec2[]; repaired: number } {
  if (points.length < 4 || !(clearance > 0)) return { points, repaired: 0 };
  // Far enough apart that a merely curving path is never treated as doubling back.
  const minArc = clearance * 3;

  let current = points;
  let repaired = 0;
  const skip = new Set<string>();
  for (let guard = 0; guard < 32; guard++) {
    const arc = polylineArcLengths(current);
    let found: { i: number; j: number } | null = null;
    for (let i = 0; i < current.length && !found; i++) {
      // The furthest partner first, so one repair takes the whole excursion.
      for (let j = current.length - 1; j > i; j--) {
        if (arc[j] - arc[i] < minArc) break;
        if (distanceVec2(current[i], current[j]) > clearance) continue;
        if (skip.has(`${i}:${j}`)) continue;
        found = { i, j };
        break;
      }
    }
    if (!found) break;

    const enclosedOnLeft = enclosesOnLeft(current, found.i, found.j);
    if (enclosedOnLeft === side > 0) {
      // Already open on the side being removed — leave the well its room.
      skip.add(`${found.i}:${found.j}`);
      continue;
    }

    const detour = offsetPolyline2D(
      current.slice(found.i, found.j + 1),
      enclosedOnLeft ? clearance : -clearance,
    );
    const next = current.slice(0, found.i);
    next.push(...detour);
    next.push(...current.slice(found.j + 1));
    current = removePolylineLoops(next);
    repaired++;
    skip.clear();
  }
  return { points: current, repaired };
}

/**
 * Push a polyline out until every vertex is `clearance` clear of another, on the
 * side that keeps the other one in the removed half.
 *
 * ⭐ The guarantee half of {@link relaxPolyline2DClearOf}, on its own — for use
 * after any step that may have moved the curve back over what it has to clear.
 * Vertices already clear are untouched, so it can only ever move the curve away.
 *
 * @param points the curve to push, modified in place
 * @param obstacle the curve to stay clear of, typically the well's own trace
 * @param clearance metres to keep, per `points` vertex or one value for all
 * @param side which half is removed; the curve is kept on the other one
 *
 * @group Utils
 */
/**
 * An obstacle prepared for repeated clearance pushes — index, arc lengths and normals.
 *
 * ⭐⭐ {@link pushPolyline2DClearOf} used to rebuild all three on every call, and
 * {@link relaxPolyline2DClearOf} calls it once per pass (25 times) for every candidate it
 * relaxes. On one wellbore that was ~900 full rebuilds of an 876-point well per build, on top
 * of an O(points × obstacle) nearest search each time.
 *
 * @group Utils
 */
export type ClearanceObstacle = {
  points: Vec2[];
  index: PolylineIndex;
  normals: Vec2[];
};

/**
 * Prepare an obstacle once for many {@link pushPolyline2DClearOf} calls.
 *
 * @group Utils
 */
export function createClearanceObstacle(
  points: Vec2[],
  index?: PolylineIndex,
): ClearanceObstacle {
  if (index && index.points !== points) {
    throw new Error(
      'clearance obstacle: the index does not index the points it was given',
    );
  }
  return {
    points,
    index: index ?? createPolylineIndex(points),
    normals: polylineNormals2D(points),
  };
}

export function pushPolyline2DClearOf(
  points: Vec2[],
  obstacle: Vec2[] | ClearanceObstacle,
  clearance: ArrayLike<number> | number,
  side: 1 | -1,
): Vec2[] {
  const prepared = Array.isArray(obstacle)
    ? createClearanceObstacle(obstacle)
    : obstacle;
  const source = prepared.points;
  if (points.length === 0 || source.length < 2) return points;
  const need = (i: number) =>
    typeof clearance === 'number'
      ? clearance
      : clearance[Math.min(i, clearance.length - 1)];
  const obstacleArc = prepared.index.arc;
  const obstacleNormals = prepared.normals;
  const hit: PolylineHit = { point: [0, 0], distance: 0, along: 0 };
  const normalAt = (along: number): Vec2 => {
    let lo = 0;
    let hi = source.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (obstacleArc[mid] <= along) lo = mid;
      else hi = mid;
    }
    return obstacleNormals[lo];
  };

  for (let i = 0; i < points.length; i++) {
    const wanted = need(i);
    if (wanted <= 0) continue;
    const near = nearestOnIndexedPolyline(
      prepared.index,
      points[i][0],
      points[i][1],
      hit,
    );
    if (!near) continue;
    const normal = normalAt(near.along);
    // Positive means the curve is on the half being KEPT, which is where it has to
    // be for the obstacle to end up in the half being removed.
    const outward: Vec2 = [-side * normal[0], -side * normal[1]];
    const have =
      (points[i][0] - near.point[0]) * outward[0] +
      (points[i][1] - near.point[1]) * outward[1];
    if (have >= wanted) continue;
    const by = wanted - have;
    points[i][0] += outward[0] * by;
    points[i][1] += outward[1] * by;
  }
  return points;
}

/**
 * Smooth a polyline while keeping it a given distance CLEAR of another, on one side.
 *
 * ⭐⭐ A constraint, not a construction. Offsetting a curve inward at a tight bend
 * folds it, and de-looping the fold leaves a corner — so an offset can be smooth or
 * it can open far enough, never both. Alternating a smoothing pass with a push back
 * out converges to a curve that is both: the smoothing removes the corner, the push
 * restores the clearance, and neither undoes the other.
 *
 * ⚠️ The push is the guarantee. However many smoothing passes run, no vertex is left
 * closer to `obstacle` than `clearance` on the side it must stay clear of — which is
 * what stops the well being buried.
 *
 * @param points the curve to relax
 * @param obstacle the curve to stay clear of, typically the well's own trace
 * @param clearance metres to keep, per `points` vertex or one value for all
 * @param side which half is removed; the curve is kept on the other one
 *
 * @group Utils
 */
export function relaxPolyline2DClearOf(
  points: Vec2[],
  obstacle: Vec2[] | ClearanceObstacle,
  clearance: ArrayLike<number> | number,
  side: 1 | -1,
  iterations: number = 60,
): Vec2[] {
  const n = points.length;
  const prepared = Array.isArray(obstacle)
    ? createClearanceObstacle(obstacle)
    : obstacle;
  if (n < 3 || prepared.points.length < 2) return points;
  // Prepared ONCE for all `iterations + 1` pushes — rebuilding the obstacle's index, arc
  // lengths and normals per pass was most of this function's cost.
  const push = (of: Vec2[]) =>
    pushPolyline2DClearOf(of, prepared, clearance, side);

  let current = points.map(p => [p[0], p[1]] as Vec2);
  push(current);
  const next = current.map(p => [p[0], p[1]] as Vec2);
  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 0; i < n; i++) {
      const a = current[Math.max(0, i - 1)];
      const b = current[i];
      const c = current[Math.min(n - 1, i + 1)];
      next[i][0] = 0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0];
      next[i][1] = 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1];
    }
    push(next);
    for (let i = 0; i < n; i++) {
      current[i][0] = next[i][0];
      current[i][1] = next[i][1];
    }
  }
  return current;
}

/**
 * How far a corner opens on ONE side, in radians.
 *
 * ⭐ What decides whether a junction between a trace and its run-out is a cut you
 * can look into or a blade. A corner turning by `t` opens `π − t` on the left and
 * `π + t` on the right, so one side can be unusable while the other is fine —
 * which is the whole reason a fence's two sides sometimes need different curves.
 *
 * @param arrive direction the curve arrives at the corner along
 * @param leave direction it leaves along
 * @param side 1 for the left-normal side, -1 for the other
 *
 * @group Utils
 */
export function junctionOpening(
  arrive: Vec2,
  leave: Vec2,
  side: 1 | -1,
): number {
  let turn = Math.atan2(leave[1], leave[0]) - Math.atan2(arrive[1], arrive[0]);
  while (turn <= -Math.PI) turn += 2 * Math.PI;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  return side > 0 ? Math.PI - turn : Math.PI + turn;
}

/**
 * Replace ONE corner of a polyline with a chain of straight segments, none of which turns by more
 * than `maxTurn`.
 *
 * ⭐⭐ NEVER AN ARC, and never a spline. A Hermite or Bézier through a corner is governed by its
 * HANDLE LENGTHS, so the same corner reads differently at different vertex spacings, exaggerates as
 * the span grows, and leaves a curvature break where two of them meet. This is a MITER chain: the
 * tangent polygon of the corner's inscribed circle, subdivided until every turn fits the budget.
 * It is scale-stable (the radius is a length, not a ratio), it composes across joins because every
 * vertex is angle-bounded by construction, and it adds no vertex the corner did not ask for — a
 * corner already inside the budget comes back untouched.
 *
 * ⚠️ The fillet is clamped so it never consumes more than half of either adjacent leg, so filleting
 * neighbouring corners of the same polyline cannot make them overlap.
 *
 * @param a the vertex before the corner
 * @param v the corner itself
 * @param b the vertex after the corner
 * @param radius the fillet radius in metres — a LENGTH, so the shape does not change with spacing
 * @param maxTurn the most any produced vertex may turn, in radians
 * @returns the vertices REPLACING `v` — `[v]` when the corner already fits
 *
 * @group Utils
 */
export function filletCorner2D(
  a: Vec2,
  v: Vec2,
  b: Vec2,
  radius: number,
  maxTurn: number,
): Vec2[] {
  if (!(radius > 0) || !(maxTurn > 0)) return [v];
  const ax = a[0] - v[0];
  const az = a[1] - v[1];
  const bx = b[0] - v[0];
  const bz = b[1] - v[1];
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-9 || lb < 1e-9) return [v];
  const ua: Vec2 = [ax / la, az / la];
  const ub: Vec2 = [bx / lb, bz / lb];
  const cosPhi = Math.min(1, Math.max(-1, ua[0] * ub[0] + ua[1] * ub[1]));
  const phi = Math.acos(cosPhi); // interior angle at the corner
  const turn = Math.PI - phi;
  if (turn <= maxTurn || phi < 1e-6) return [v];
  const tanHalf = Math.tan(phi / 2);
  if (!(tanHalf > 1e-9)) return [v];
  // Setback along each leg for the asked radius, capped at half the shorter leg.
  const t = Math.min(radius / tanHalf, Math.min(la, lb) * 0.5);
  const r = t * tanHalf;
  if (!(r > 1e-9)) return [v];
  const bisX = ua[0] + ub[0];
  const bisZ = ua[1] + ub[1];
  const bl = Math.hypot(bisX, bisZ);
  if (bl < 1e-9) return [v];
  const d = r / Math.sin(phi / 2); // centre distance along the bisector
  const c: Vec2 = [v[0] + (bisX / bl) * d, v[1] + (bisZ / bl) * d];
  const p: Vec2 = [v[0] + ua[0] * t, v[1] + ua[1] * t];
  const q: Vec2 = [v[0] + ub[0] * t, v[1] + ub[1] * t];
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  let sweep = Math.atan2(q[1] - c[1], q[0] - c[0]) - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  // The epsilon matters: `sweep` comes from atan2 differences, so an exact 90°/45° lands a hair
  // over 2 and would otherwise buy a third segment nobody asked for.
  const k = Math.max(1, Math.ceil(Math.abs(sweep) / maxTurn - 1e-9));
  const step = sweep / k;
  const rr = r / Math.cos(Math.abs(step) / 2);
  const out: Vec2[] = [];
  for (let i = 0; i < k; i++) {
    const ang = a0 + (i + 0.5) * step;
    out.push([c[0] + Math.cos(ang) * rr, c[1] + Math.sin(ang) * rr]);
  }
  return out;
}

/**
 * Fillet every corner of an open polyline that turns more than `maxTurn`, leaving the endpoints
 * where they are. See {@link filletCorner2D} for why this is a miter chain and not a spline.
 *
 * Corners are measured against the ORIGINAL neighbours, so one sharp corner cannot cascade into
 * its neighbours across passes.
 *
 * @group Utils
 */
export function filletPolyline2D(
  points: Vec2[],
  radius: number,
  maxTurn: number,
): Vec2[] {
  if (points.length < 3) return points.map(p => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    out.push(
      ...filletCorner2D(
        points[i - 1],
        points[i],
        points[i + 1],
        radius,
        maxTurn,
      ),
    );
  }
  out.push(points[points.length - 1]);
  return out;
}

/** How far past its endpoints a tangent join may reach before it is built as a dogleg instead. */
const JOIN_MAX_LEAD = 3;

/**
 * A join from `from` heading `fromDir` onto `to` heading `toDir`, made only of straight segments
 * with every turn inside `maxTurn`.
 *
 * ⭐ Where the two tangent rays meet ahead of both ends, the join is that single corner, filleted —
 * the shortest path that leaves and arrives on the required headings. Where they do not meet (they
 * diverge, run parallel, or would meet absurdly far out) it becomes a dogleg: a lead along each
 * heading and a chord between, filleted at both corners. Either way the result is scale-stable and
 * angle-bounded, so joining several of these end to end cannot produce a break at the seams.
 *
 * @group Utils
 */
export function joinByTangents2D(
  from: Vec2,
  fromDir: Vec2,
  to: Vec2,
  toDir: Vec2,
  radius: number,
  maxTurn: number,
): Vec2[] {
  const wx = to[0] - from[0];
  const wz = to[1] - from[1];
  const span = Math.hypot(wx, wz);
  if (span < 1e-9) return [from];
  const denom = fromDir[0] * toDir[1] - fromDir[1] * toDir[0];
  if (Math.abs(denom) > 1e-9) {
    const t1 = (wx * toDir[1] - wz * toDir[0]) / denom;
    const t2 = (wz * fromDir[0] - wx * fromDir[1]) / denom;
    const limit = span * JOIN_MAX_LEAD;
    if (t1 > 0 && t2 > 0 && t1 < limit && t2 < limit) {
      const x: Vec2 = [from[0] + fromDir[0] * t1, from[1] + fromDir[1] * t1];
      return [from, ...filletCorner2D(from, x, to, radius, maxTurn), to];
    }
  }
  const lead = Math.max(radius, span * 0.25);
  const p1: Vec2 = [from[0] + fromDir[0] * lead, from[1] + fromDir[1] * lead];
  const p2: Vec2 = [to[0] - toDir[0] * lead, to[1] - toDir[1] * lead];
  const seed: Vec2[] = [from, p1, p2, to];
  // ⚠️ A REVERSAL has no side of its own — the inputs do not say which way to come about, and a
  // straight-segment join cannot invent one. Swing it toward whichever side `to` already lies on
  // (left normal when even that is symmetric), far enough out that it reads as two gentle corners
  // rather than one spike.
  if (fromDir[0] * toDir[0] + fromDir[1] * toDir[1] < -0.9) {
    let nx = -fromDir[1];
    let nz = fromDir[0];
    if (nx * wx + nz * wz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const off = Math.max(radius * 2, span * 0.5);
    seed.splice(2, 0, [
      (p1[0] + p2[0]) / 2 + nx * off,
      (p1[1] + p2[1]) / 2 + nz * off,
    ]);
  }
  return filletPolyline2D(seed, radius, maxTurn);
}
