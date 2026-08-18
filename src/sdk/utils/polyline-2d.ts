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

/** Where a polyline crosses itself, and the point it crosses at. */
type PolylineLoop = { i: number; j: number; at: Vec2 };

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
 * @group Utils
 */
export function polylineMaxTurn(points: Vec2[], window: number): number {
  if (points.length < 3) return 0;
  const arc = polylineArcLengths(points);
  const heading = polylineHeadings2D(points);
  let worst = 0;
  for (let i = 0; i + 1 < heading.length; i++) {
    for (let j = i + 1; j < heading.length; j++) {
      if (arc[j] - arc[i] > window) break;
      const turn = Math.abs(heading[j] - heading[i]);
      if (turn > worst) worst = turn;
    }
  }
  return worst;
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
export function pushPolyline2DClearOf(
  points: Vec2[],
  obstacle: Vec2[],
  clearance: ArrayLike<number> | number,
  side: 1 | -1,
): Vec2[] {
  if (points.length === 0 || obstacle.length < 2) return points;
  const need = (i: number) =>
    typeof clearance === 'number'
      ? clearance
      : clearance[Math.min(i, clearance.length - 1)];
  const obstacleArc = polylineArcLengths(obstacle);
  const obstacleNormals = polylineNormals2D(obstacle);
  const hit: PolylineHit = { point: [0, 0], distance: 0, along: 0 };
  const normalAt = (along: number): Vec2 => {
    let lo = 0;
    let hi = obstacle.length - 1;
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
    const near = nearestOnPolyline(obstacle, points[i][0], points[i][1], hit);
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
  obstacle: Vec2[],
  clearance: ArrayLike<number> | number,
  side: 1 | -1,
  iterations: number = 60,
): Vec2[] {
  const n = points.length;
  if (n < 3 || obstacle.length < 2) return points;
  const push = (of: Vec2[]) =>
    pushPolyline2DClearOf(of, obstacle, clearance, side);

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
    const swap = current;
    current = next.map(p => [p[0], p[1]] as Vec2);
    swap.length = 0;
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
