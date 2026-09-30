import { Vec2 } from '../types/common';
import { convexOverlap2D } from './polyline-2d';

/**
 * Distances to CONVEX polygons — the one measure an obstacle's margin is read with.
 *
 * ⭐ An obstacle is its convex hull and a margin: the points closer to the hull than the margin.
 * Every question asked of it — is this point clear, where does this run leave it, how far apart
 * are two of them — is a distance, exact and continuous in the margin. A polygon grown by the
 * margin only approximates that set: a mitered corner stands up to a whole margin outside it, and
 * jumps as the hull's corner angle crosses the miter limit.
 *
 * Hulls of 1 or 2 points are a point and a segment. The winding does not matter.
 *
 * @module
 */

/** The nearest point of segment `a`–`b` to `p`, its parameter along the segment and distance. */
function nearestOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number; distance: number } {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const len2 = ex * ex + ez * ez;
  let t = len2 > 0 ? ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const point: Vec2 = [a[0] + ex * t, a[1] + ez * t];
  return { point, t, distance: Math.hypot(p[0] - point[0], p[1] - point[1]) };
}

/** Whether `p` lies inside (or on) the convex polygon `hull` of 3 or more points. */
function insideConvex(p: Vec2, hull: Vec2[]): boolean {
  let pos = false;
  let neg = false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c > 1e-12) pos = true;
    else if (c < -1e-12) neg = true;
    if (pos && neg) return false;
  }
  return true;
}

/** The hull's edges, as index pairs — one degenerate edge for a point, one edge for a segment. */
function edgesOf(hull: Vec2[]): Array<[Vec2, Vec2]> {
  if (hull.length === 1) return [[hull[0], hull[0]]];
  if (hull.length === 2) return [[hull[0], hull[1]]];
  return hull.map((a, i) => [a, hull[(i + 1) % hull.length]]);
}

/**
 * The signed distance from `p` to a convex polygon — negative inside, by the depth to its
 * boundary — and the nearest boundary point.
 *
 * @group Utils
 */
export function convexSignedDistance(
  p: Vec2,
  hull: Vec2[],
): { distance: number; point: Vec2 } {
  if (hull.length === 0) return { distance: Infinity, point: p };
  let best = Infinity;
  let point: Vec2 = hull[0];
  for (const [a, b] of edgesOf(hull)) {
    const q = nearestOnSegment(p, a, b);
    if (q.distance < best) {
      best = q.distance;
      point = q.point;
    }
  }
  const inside = hull.length >= 3 && insideConvex(p, hull);
  return { distance: inside ? -best : best, point };
}

/** {@link segmentConvexNearest} result. */
export type SegmentConvexNearest = {
  /** the least distance between the segment and the polygon, 0 when they touch or cross */
  distance: number;
  /** where on the segment it is attained, and the parameter there */
  onSegment: Vec2;
  t: number;
  /** where on the polygon */
  onHull: Vec2;
  /** unit, from the polygon toward the segment; null when they touch or cross */
  normal: Vec2 | null;
};

/** Whether segments `a`–`b` and `c`–`d` share a point, and the parameter along `a`–`b` of one. */
function segmentsMeet(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-15) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * The closest points between segment `a`–`b` and a convex polygon, and the direction that
 * separates them. For two disjoint convex sets the least distance is between a vertex of one and
 * an edge of the other, so this is exact.
 *
 * @group Utils
 */
export function segmentConvexNearest(
  a: Vec2,
  b: Vec2,
  hull: Vec2[],
): SegmentConvexNearest {
  const touch = (t: number): SegmentConvexNearest => {
    const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { distance: 0, onSegment: p, t, onHull: p, normal: null };
  };
  if (hull.length === 0) {
    return { distance: Infinity, onSegment: a, t: 0, onHull: a, normal: null };
  }
  if (hull.length >= 3) {
    if (insideConvex(a, hull)) return touch(0);
    if (insideConvex(b, hull)) return touch(1);
  }
  let best = Infinity;
  let sx = a[0];
  let sz = a[1];
  let hx = hull[0][0];
  let hz = hull[0][1];
  let t = 0;
  const ax = a[0];
  const az = a[1];
  const ex = b[0] - ax;
  const ez = b[1] - az;
  const e2 = ex * ex + ez * ez;
  const n = hull.length;
  const edges = n <= 2 ? 1 : n;
  for (let i = 0; i < edges; i++) {
    const c = hull[i];
    const d = hull[n === 1 ? 0 : (i + 1) % n];
    const meet = segmentsMeet(a, b, c, d);
    if (meet !== null) return touch(meet);
    const fx = d[0] - c[0];
    const fz = d[1] - c[1];
    const f2 = fx * fx + fz * fz;
    // the segment's two ends against this edge
    for (let k = 0; k < 2; k++) {
      const px = k === 0 ? ax : b[0];
      const pz = k === 0 ? az : b[1];
      let u = f2 > 0 ? ((px - c[0]) * fx + (pz - c[1]) * fz) / f2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = c[0] + fx * u;
      const qz = c[1] + fz * u;
      const dist = Math.hypot(px - qx, pz - qz);
      if (dist < best) {
        best = dist;
        sx = px;
        sz = pz;
        hx = qx;
        hz = qz;
        t = k;
      }
    }
    // this edge's two ends against the segment
    for (let k = 0; k < 2; k++) {
      const v = k === 0 ? c : d;
      let u = e2 > 0 ? ((v[0] - ax) * ex + (v[1] - az) * ez) / e2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + ex * u;
      const qz = az + ez * u;
      const dist = Math.hypot(v[0] - qx, v[1] - qz);
      if (dist < best) {
        best = dist;
        sx = qx;
        sz = qz;
        hx = v[0];
        hz = v[1];
        t = u;
      }
    }
  }
  const normal: Vec2 | null =
    best > 1e-12 ? [(sx - hx) / best, (sz - hz) / best] : null;
  return { distance: best, onSegment: [sx, sz], t, onHull: [hx, hz], normal };
}

/**
 * The outward edge lines of a convex polygon of 3 or more points — `n · p − c` is how far `p`
 * lies beyond edge `i` — or null for a point or a segment.
 */
function edgeLines(hull: Vec2[]): { n: Float64Array; c: Float64Array } | null {
  const k = hull.length;
  if (k < 3) return null;
  let area = 0;
  for (let i = 0; i < k; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % k];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const s = area >= 0 ? 1 : -1;
  const n = new Float64Array(2 * k);
  const c = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % k];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const l = Math.hypot(ex, ez) || 1;
    // CCW: the outward normal is the right normal
    n[2 * i] = (s * ez) / l;
    n[2 * i + 1] = (-s * ex) / l;
    c[i] = n[2 * i] * a[0] + n[2 * i + 1] * a[1];
  }
  return { n, c };
}

/**
 * A test for which of `hulls` a point or a segment comes within `distance` of: the index of the
 * first, or −1. Bounding boxes reject the far hulls, and an edge line with the whole query more
 * than `distance` beyond it rejects the rest before any distance is measured.
 *
 * @group Utils
 */
export function hullsWithin(
  hulls: Vec2[][],
  distance: number,
): (a: Vec2, b?: Vec2) => number {
  const boxes = hulls.map(h => {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of h) {
      x0 = Math.min(x0, p[0]);
      z0 = Math.min(z0, p[1]);
      x1 = Math.max(x1, p[0]);
      z1 = Math.max(z1, p[1]);
    }
    return [x0 - distance, z0 - distance, x1 + distance, z1 + distance];
  });
  const lines = hulls.map(edgeLines);
  return (a, b = a) => {
    for (let k = 0; k < hulls.length; k++) {
      const box = boxes[k];
      if (
        Math.max(a[0], b[0]) < box[0] ||
        Math.min(a[0], b[0]) > box[2] ||
        Math.max(a[1], b[1]) < box[1] ||
        Math.min(a[1], b[1]) > box[3]
      ) {
        continue;
      }
      const edges = lines[k];
      if (edges) {
        let separated = false;
        for (let i = 0; i < edges.c.length && !separated; i++) {
          const nx = edges.n[2 * i];
          const nz = edges.n[2 * i + 1];
          separated =
            nx * a[0] + nz * a[1] - edges.c[i] >= distance &&
            nx * b[0] + nz * b[1] - edges.c[i] >= distance;
        }
        if (separated) continue;
      }
      const d =
        a === b
          ? convexSignedDistance(a, hulls[k]).distance
          : segmentConvexNearest(a, b, hulls[k]).distance;
      if (d < distance) return k;
    }
    return -1;
  };
}

/**
 * The least distance between two convex polygons, 0 when they overlap.
 *
 * @group Utils
 */
export function convexPolygonDistance(p: Vec2[], q: Vec2[]): number {
  if (p.length >= 3 && q.length >= 3 && convexOverlap2D(p, q)) return 0;
  let best = Infinity;
  for (const [a, b] of edgesOf(p)) {
    best = Math.min(best, segmentConvexNearest(a, b, q).distance);
    if (best === 0) return 0;
  }
  return best;
}

/** One place a polyline crosses the margin of a polygon. */
export type MarginCrossing = {
  /** arc length along the polyline */
  arc: number;
  point: Vec2;
  /** entering the margin (else leaving it) */
  entering: boolean;
};

/** Bisection steps to locate a crossing — 2⁻⁴⁸ of a segment. */
const CROSSING_STEPS = 48;

/**
 * Where `polyline` crosses the `margin` of a convex polygon, in order along it, and whether it
 * starts inside.
 *
 * ⭐ Exact to the bisection, and continuous in the margin: along a straight segment the distance
 * to a convex set is a convex function, so the stretch within the margin is ONE interval per
 * segment, bracketed on each side of its closest point.
 *
 * @group Utils
 */
export function marginCrossings(
  polyline: Vec2[],
  hull: Vec2[],
  margin: number,
): { startsInside: boolean; crossings: MarginCrossing[] } {
  const crossings: MarginCrossing[] = [];
  if (polyline.length === 0 || hull.length === 0) {
    return { startsInside: false, crossings };
  }
  const within = (p: Vec2) => convexSignedDistance(p, hull).distance < margin;
  const startsInside = within(polyline[0]);
  let arc = 0;
  for (let i = 0; i + 1 < polyline.length; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const near = segmentConvexNearest(a, b, hull);
    if (near.distance < margin && len > 0) {
      const at = (t: number): Vec2 => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      // the crossing between an outside parameter and an inside one
      const bisect = (out: number, inn: number): number => {
        for (let k = 0; k < CROSSING_STEPS; k++) {
          const mid = (out + inn) / 2;
          if (within(at(mid))) inn = mid;
          else out = mid;
        }
        return (out + inn) / 2;
      };
      if (!within(a)) {
        const t = bisect(0, near.t);
        crossings.push({ arc: arc + t * len, point: at(t), entering: true });
      }
      if (!within(b)) {
        const t = bisect(1, near.t);
        crossings.push({ arc: arc + t * len, point: at(t), entering: false });
      }
    }
    arc += len;
  }
  return { startsInside, crossings };
}
