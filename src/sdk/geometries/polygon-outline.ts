import { Vec2 } from '../types/common';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';

/** Signed area of a closed ring (positive = CCW in a right-handed XZ frame). */
export function ringSignedArea(ring: Vec2[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[i][1] - ring[j][1]);
  }
  return area / 2;
}

/** Even-odd point-in-ring test (ring treated as closed). */
export function pointInRing(x: number, y: number, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Whether a point is inside a polygon: inside some component's outer ring and
 * outside that component's holes.
 *
 * @group Geometries
 */
export function pointInPolygon(
  x: number,
  y: number,
  polygon: PlanarPolygonCoordinates,
): boolean {
  for (const rings of polygon) {
    if (rings.length === 0 || !pointInRing(x, y, rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(x, y, rings[i])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Total area of a polygon: its outer rings less their holes.
 *
 * @group Geometries
 */
export function polygonArea(polygon: PlanarPolygonGeometry): number {
  let area = 0;
  for (const rings of polygon.coordinates as PlanarPolygonCoordinates) {
    rings.forEach((ring, i) => {
      const a = Math.abs(ringSignedArea(ring));
      area += i === 0 ? a : -a;
    });
  }
  return area;
}

// Whether two closed segments properly cross (endpoints touching does not count —
// two outlines that merely share a boundary point do not overlap).
function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const ON_BOUNDARY_EPS = 1e-6;

// Distance from a point to a ring's nearest edge, squared.
function distanceToRingSq(x: number, y: number, ring: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0];
    const ay = ring[j][1];
    const bx = ring[i][0];
    const by = ring[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t =
      len === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len));
    const px = ax + t * dx - x;
    const py = ay + t * dy - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return best;
}

// Inside, or on the boundary. Two chunks can legitimately share an outline (both
// inheriting the stack's), and a point exactly on a ring is neither reliably in
// nor reliably out of an even-odd test.
function pointInOrOnPolygon(
  x: number,
  y: number,
  polygon: PlanarPolygonCoordinates,
): boolean {
  if (pointInPolygon(x, y, polygon)) return true;
  const eps = ON_BOUNDARY_EPS * ON_BOUNDARY_EPS;
  for (const rings of polygon) {
    for (const ring of rings) {
      if (distanceToRingSq(x, y, ring) <= eps) return true;
    }
  }
  return false;
}

/** How two polygons sit relative to one another, from {@link polygonRelation}. */
export type PolygonRelation =
  /** `a` contains `b` (including two identical outlines) */
  | 'contains'
  /** `b` contains `a` */
  | 'contained'
  /** they share no area */
  | 'disjoint'
  /** their boundaries cross, so each has area the other does not */
  | 'overlap';

/**
 * How two polygons sit relative to one another, in their own coordinate space.
 *
 * ⚠️ Assumes non-self-intersecting rings, which is what the outline pipeline
 * produces. Boundaries that only TOUCH are not an overlap — a proper crossing is
 * what makes each side hold area the other does not — and two identical outlines
 * read as `'contains'`, so a caller ordering its inputs gets a stable answer.
 *
 * @group Geometries
 */
export function polygonRelation(
  polygonA: PlanarPolygonGeometry,
  polygonB: PlanarPolygonGeometry,
): PolygonRelation {
  const a = polygonA.coordinates as PlanarPolygonCoordinates;
  const b = polygonB.coordinates as PlanarPolygonCoordinates;
  for (const ringsA of a) {
    for (const ringA of ringsA) {
      for (const ringsB of b) {
        for (const ringB of ringsB) {
          for (let i = 0; i < ringA.length; i++) {
            const p = ringA[i];
            const q = ringA[(i + 1) % ringA.length];
            for (let j = 0; j < ringB.length; j++) {
              const r = ringB[j];
              const s = ringB[(j + 1) % ringB.length];
              if (
                segmentsCross(p[0], p[1], q[0], q[1], r[0], r[1], s[0], s[1])
              ) {
                return 'overlap';
              }
            }
          }
        }
      }
    }
  }

  // No crossing, so one is wholly inside the other or they are apart.
  const within = (
    inner: PlanarPolygonCoordinates,
    outer: PlanarPolygonCoordinates,
  ) =>
    inner.every(rings =>
      (rings[0] ?? []).every(([x, y]) => pointInOrOnPolygon(x, y, outer)),
    );

  if (within(b, a)) return 'contains';
  if (within(a, b)) return 'contained';
  return 'disjoint';
}

/** Ramer–Douglas–Peucker over an OPEN polyline, iterative (no recursion depth). */
function simplifyPolyline(points: Vec2[], tolerance: number): Vec2[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const sq = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let worst = -1;
    let worstAt = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      // squared perpendicular distance to the segment (to its endpoint when the
      // segment is degenerate, which happens on a closed ring's split points)
      let d: number;
      if (len === 0) {
        d = (px - ax) * (px - ax) + (py - ay) * (py - ay);
      } else {
        const t = Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len),
        );
        const qx = ax + t * dx;
        const qy = ay + t * dy;
        d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      }
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > sq && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([first, worstAt], [worstAt, last]);
    }
  }

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Drop the vertices of a closed ring that carry no shape, keeping every point of
 * the result within `tolerance` of the original (Ramer–Douglas–Peucker).
 *
 * A ring traced off a grid carries one vertex per cell, so a long straight or
 * gently curving run costs hundreds of vertices that say nothing. That matters
 * beyond memory when the ring becomes a triangulation CONSTRAINT: every vertex is
 * inserted and every segment is an edge to enforce, so the cost lands in the mesh.
 *
 * The ring is split at its two most distant points before simplifying, so the
 * result does not depend on where the loop happens to start.
 *
 * @param ring the closed ring (the last point must NOT repeat the first)
 * @param tolerance maximum deviation, in the ring's own units
 *
 * @group Geometries
 */
export function simplifyRing(ring: Vec2[], tolerance: number): Vec2[] {
  const n = ring.length;
  if (n < 4 || tolerance <= 0) return ring;

  // Anchor on the point furthest from the first, so the two halves are both
  // meaningful arcs rather than one arc and one stub.
  let far = 0;
  let farD = -1;
  const [x0, y0] = ring[0];
  for (let i = 1; i < n; i++) {
    const d = (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }

  const head = simplifyPolyline(ring.slice(0, far + 1), tolerance);
  const tail = simplifyPolyline(ring.slice(far), tolerance);
  // `head` ends on `far` and `tail` starts on it; `tail` ends on ring[n-1], which
  // is the neighbour of ring[0] around the loop, so neither is repeated.
  const out = head.concat(tail.slice(1));
  return out.length >= 3 ? out : ring;
}

/**
 * Group a flat list of closed, non-crossing rings (scene XZ) into the
 * `[outer, ...holes]` component structure a {@link PlanarPolygonGeometry}
 * expects. Nesting is resolved by containment: a ring enclosed by an even number
 * of others is an outer ring, an odd number makes it a hole of its immediate
 * (deepest) enclosing outer ring. Winding is ignored — both this helper and the
 * clip machinery classify membership by even-odd crossing, so only the
 * outer/hole grouping matters.
 *
 * Rings must not cross one another (as produced by {@link traceValidBoundary} or
 * {@link marchingSquares}); a single representative vertex per ring then suffices
 * to test containment. Rings with fewer than three points are dropped.
 *
 * @group Geometries
 */
export function ringsToPolygonCoordinates(
  rings: Vec2[][],
): PlanarPolygonCoordinates {
  const valid = rings.filter(r => r.length >= 3);
  const n = valid.length;
  if (n === 0) return [];

  // containedIn[i] = indices of rings that enclose ring i (tested via one vertex,
  // valid because rings do not cross).
  const containedIn: number[][] = valid.map(() => []);
  for (let i = 0; i < n; i++) {
    const [px, py] = valid[i][0];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (pointInRing(px, py, valid[j])) containedIn[i].push(j);
    }
  }

  const depth = containedIn.map(c => c.length);
  const components: PlanarPolygonCoordinates = [];
  const outerToComponent = new Map<number, number>();

  // Outer rings first, so holes can be attached to their parent component.
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) {
      outerToComponent.set(i, components.length);
      components.push([valid[i]]);
    }
  }

  // Attach each hole to its immediate parent (the enclosing ring of depth-1).
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) continue;
    let parent = -1;
    for (const j of containedIn[i]) {
      if (depth[j] === depth[i] - 1) {
        parent = j;
        break;
      }
    }
    const comp = parent >= 0 ? outerToComponent.get(parent) : undefined;
    if (comp !== undefined) components[comp].push(valid[i]);
  }

  return components;
}
