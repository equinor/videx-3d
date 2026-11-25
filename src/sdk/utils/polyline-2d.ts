import RBush from 'rbush';
import { Vec2 } from '../types/common';
import { distanceVec2 } from './vector-operations';

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
 * A convex ring with fewer vertices that still CONTAINS it: runs of edges are replaced by extending
 * the edges either side of them to where they meet, while that corner stays within `tolerance` of
 * the ring. Convex, at most `tolerance` larger, and unchanged where no run can be dropped.
 *
 * @param hull a convex ring, as {@link convexHull2D} returns; either winding
 * @param tolerance metres the result may stand outside `hull`
 *
 * @group Utils
 */
export function coarsenConvexHull(hull: Vec2[], tolerance: number): Vec2[] {
  const n = hull.length;
  if (n < 4 || !(tolerance > 0)) return hull;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area >= 0 ? 1 : -1;
  const at = (k: number) => hull[k % n];
  /** where the lines of edges `i` and `k` meet beyond the chain between them, or null */
  const corner = (i: number, k: number): Vec2 | null => {
    const p = at(i + 1);
    const q = at(k);
    const dx = p[0] - at(i)[0];
    const dz = p[1] - at(i)[1];
    const ex = at(k + 1)[0] - q[0];
    const ez = at(k + 1)[1] - q[1];
    const den = dx * ez - dz * ex;
    if (!(den * ccw > 0)) return null;
    const t = ((q[0] - p[0]) * ez - (q[1] - p[1]) * ex) / den;
    const u = ((q[0] - p[0]) * dz - (q[1] - p[1]) * dx) / den;
    // past the end of edge i, before the start of edge k
    return t >= 0 && u <= 0 ? [p[0] + dx * t, p[1] + dz * t] : null;
  };
  // the nearest point of the ring to a corner beyond it lies on the chain the corner replaces
  const within = (c: Vec2, i: number, k: number) => {
    for (let j = i + 1; j < k; j++) {
      if (distanceToSegment2D(c, at(j), at(j + 1)) <= tolerance) return true;
    }
    return false;
  };
  const kept = [0];
  for (let i = 0; ; ) {
    let k = i + 1;
    while (k < n) {
      const c = corner(i, k + 1);
      if (!c || !within(c, i, k + 1)) break;
      k++;
    }
    if (k >= n) break;
    kept.push(k);
    i = k;
  }
  if (kept.length === n) return hull;
  const out: Vec2[] = [];
  for (let m = 0; m < kept.length; m++) {
    const i = kept[m];
    const k = m + 1 < kept.length ? kept[m + 1] : n;
    out.push(k === i + 1 ? at(k) : corner(i, k)!);
  }
  return out;
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
  while (radius < span * 4) {
    sweep(radius);
    radius *= 2;
    if (bestJ >= 0) break;
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
 * than returned as if it had succeeded. ⛔ Not a fixed round count: aiming at 1 mm, a 22 m batten
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
function findPolylineLoop(points: Vec2[]): PolylineLoop | null {
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

/** Radians per vertex an arc is laid with, 3° — {@link biarc2D}'s default and the fence's turns. */
export const ARC_TURN_STEP = Math.PI / 60;

/**
 * Unit left normal at every vertex, averaged across the two adjacent segments.
 *
 * @group Utils
 */
function polylineNormals2D(points: Vec2[]): Vec2[] {
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

/** Options for {@link polylineTangents2D}. */
export type PolylineTangentOptions = {
  /** the last point joins the first. Default false. */
  closed?: boolean;
  /**
   * Turn, in degrees, beyond which a point is a CORNER and keeps both directions.
   * Default 180: never.
   */
  smoothAngle?: number;
  /**
   * How far a point may lie from the segment between its neighbours and still be
   * left out of the shape. Default 1e-4 × the mean segment length.
   */
  tolerance?: number;
};

/** Unit tangents per point, as `[x0, z0, x1, z1, ...]` (see {@link polylineTangents2D}). */
export type PolylineTangents = {
  /** the direction arriving at each point */
  before: Float64Array;
  /** the direction leaving it — `before`'s, except at a corner */
  after: Float64Array;
  /** per point: 1 at a corner */
  corner: Uint8Array;
};

/**
 * Unit tangents along a polyline, from its SHAPE rather than its sampling.
 *
 * ⭐ A point within `tolerance` of the segment between its neighbours is a sample,
 * not a bend, so it takes no part: it gets the tangent interpolated along the arc
 * between the points either side. Adding points on a straight run — a crossing
 * noded into a rim, the boundary a ribbon is cut at — then moves no tangent. The
 * rest average their two segment directions, which is what a vertex normal is.
 * Averaging over whatever neighbours the sampling provides instead let a 1 cm
 * segment, pointing wherever millimetre noise sent it, band a wall.
 *
 * @group Utils
 */
export function polylineTangents2D(
  points: ArrayLike<ArrayLike<number>>,
  options: PolylineTangentOptions = {},
): PolylineTangents {
  const m = points.length;
  const before = new Float64Array(2 * m);
  const after = new Float64Array(2 * m);
  const corner = new Uint8Array(m);
  if (m < 2) return { before, after, corner };
  const closed = !!options.closed && m > 2;
  const at = (k: number) => points[((k % m) + m) % m];

  let total = 0;
  const segments = closed ? m : m - 1;
  for (let k = 0; k < segments; k++) {
    const a = at(k);
    const b = at(k + 1);
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const tolerance = options.tolerance ?? (total / segments) * 1e-4;
  const minDot = Math.cos(((options.smoothAngle ?? 180) * Math.PI) / 180);

  // Distance from point k to the SEGMENT a-b: a hairpin's tip is collinear with
  // its neighbours but far from the segment between them.
  const off = (k: number, a: number, b: number) => {
    const p = at(k);
    const pa = at(a);
    const pb = at(b);
    const dx = pb[0] - pa[0];
    const dz = pb[1] - pa[1];
    const len2 = dx * dx + dz * dz;
    const t =
      len2 > 0
        ? Math.max(
            0,
            Math.min(1, ((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dz) / len2),
          )
        : 0;
    return Math.hypot(p[0] - pa[0] - t * dx, p[1] - pa[1] - t * dz);
  };

  // Walk order, so a closed ring starts on a point that is surely kept.
  let start = 0;
  if (closed) {
    let worst = -1;
    for (let k = 0; k < m; k++) {
      const d = off(k, k - 1, k + 1);
      if (d > worst) {
        worst = d;
        start = k;
      }
    }
  }
  const order = new Int32Array(m);
  for (let s = 0; s < m; s++) order[s] = (start + s) % m;
  const arc = new Float64Array(m + 1);
  for (let s = 1; s <= m; s++) {
    if (s === m && !closed) break;
    const a = at(order[s - 1]);
    const b = at(s === m ? order[0] : order[s]);
    arc[s] = arc[s - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  // Positions in `order` of the points that shape the line.
  const kept: number[] = [0];
  const last = closed ? m : m - 1;
  for (let s = 1; s < last; s++) {
    const next = s + 1 === m ? order[0] : order[s + 1];
    if (off(order[s], order[kept[kept.length - 1]], next) > tolerance) {
      kept.push(s);
    }
  }
  if (!closed) kept.push(m - 1);
  const n = kept.length;
  if (n < 2) {
    // A ring with no bend at all: nothing to take a direction from but itself.
    for (let s = 1; s < m; s++) kept.push(s);
  }

  const count = kept.length;
  const chords = closed ? count : count - 1;
  const dir = new Float64Array(2 * chords);
  for (let j = 0; j < chords; j++) {
    const a = at(order[kept[j]]);
    const b = at(order[kept[(j + 1) % count]]);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dir[2 * j] = dx / len;
      dir[2 * j + 1] = dz / len;
    } else if (j > 0) {
      dir[2 * j] = dir[2 * j - 2];
      dir[2 * j + 1] = dir[2 * j - 1];
    }
  }

  for (let j = 0; j < count; j++) {
    const k = order[kept[j]];
    const i = closed ? (j - 1 + chords) % chords : Math.max(0, j - 1);
    const o = closed ? j : Math.min(chords - 1, j);
    const ix = dir[2 * i];
    const iz = dir[2 * i + 1];
    const ox = dir[2 * o];
    const oz = dir[2 * o + 1];
    if (ix * ox + iz * oz >= minDot) {
      let x = ix + ox;
      let z = iz + oz;
      const len = Math.hypot(x, z);
      // A 180° turn back on itself has no average; take the leaving direction.
      if (len > 1e-12) {
        x /= len;
        z /= len;
      } else {
        x = ox;
        z = oz;
      }
      before[2 * k] = after[2 * k] = x;
      before[2 * k + 1] = after[2 * k + 1] = z;
    } else {
      before[2 * k] = ix;
      before[2 * k + 1] = iz;
      after[2 * k] = ox;
      after[2 * k + 1] = oz;
      corner[k] = 1;
    }
  }

  // Everything left out lies on a chord: interpolate along it, as a vertex normal
  // is interpolated across the face it no longer bends.
  for (let j = 0; j < chords; j++) {
    const s0 = kept[j];
    const s1 = j + 1 < count ? kept[j + 1] : m;
    const a = order[s0];
    const b = order[s1 % m];
    const span = arc[s1] - arc[s0];
    for (let s = s0 + 1; s < s1; s++) {
      const f = span > 0 ? (arc[s] - arc[s0]) / span : 0;
      let x = (1 - f) * after[2 * a] + f * before[2 * b];
      let z = (1 - f) * after[2 * a + 1] + f * before[2 * b + 1];
      const len = Math.hypot(x, z);
      if (len > 1e-12) {
        x /= len;
        z /= len;
      } else {
        x = after[2 * a];
        z = after[2 * a + 1];
      }
      const k = order[s];
      before[2 * k] = after[2 * k] = x;
      before[2 * k + 1] = after[2 * k + 1] = z;
    }
  }
  return { before, after, corner };
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
function endTangent2D(
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
