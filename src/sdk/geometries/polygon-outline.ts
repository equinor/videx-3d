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
