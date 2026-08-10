import { Vec2 } from '../types/common';
import { PlanarPolygonCoordinates } from './planar-geometry';

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
