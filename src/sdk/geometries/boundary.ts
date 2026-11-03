import type { Vec2 } from '../types/common';
import type { PlanarPolygonGeometry } from './planar-geometry';

// ⚠️ Free of three.js: plain math, as the geometries the generators run are.

/** An axis-aligned box, `[minX, minZ, maxX, maxZ]`. */
export type BoundaryBox = [number, number, number, number];

/** A circle about `centre`, `[x, z]`. */
export type BoundaryCircle = { centre: Vec2; radius: number };

/**
 * A box turned about its middle by `rotation`: radians, counter-clockwise seen from above
 * (+X toward −Z), as three.js turns about +Y. `box` is its extent before it is turned.
 */
export type BoundaryRotatedBox = { box: BoundaryBox; rotation: number };

/**
 * Where something lies, in X/Z: a stage's area, a field's. One of
 *
 * - `[minX, minZ, maxX, maxZ]`, an axis-aligned box;
 * - `{ box, rotation }`, a box turned about its middle ({@link BoundaryRotatedBox});
 * - `{ centre, radius }`, a circle;
 * - a polygon: a `PlanarPolygonGeometry` (the outline a chunk stack takes), or one ring of
 *   `[x, z]` points.
 *
 * See {@link boundaryShape} for the one form the helpers work on.
 *
 * @group Geometries
 */
export type Boundary =
  | BoundaryBox
  | BoundaryRotatedBox
  | BoundaryCircle
  | PlanarPolygonGeometry
  | Vec2[];

/**
 * A {@link Boundary} in one form of three: a `box` (axis-aligned at `rotation` 0), a
 * `circle`, or a `polygon` of `rings` (holes too, inside by the even-odd rule), its
 * offset applied.
 *
 * @group Geometries
 */
export type BoundaryShape =
  | { kind: 'box'; box: BoundaryBox; rotation: number }
  | { kind: 'circle'; centre: Vec2; radius: number }
  | { kind: 'polygon'; rings: Vec2[][] };

function isPolygonGeometry(value: Boundary): value is PlanarPolygonGeometry {
  return (
    !Array.isArray(value) &&
    (value as PlanarPolygonGeometry).type === 'polygon2d'
  );
}

/**
 * The one form of a {@link Boundary} the helpers work on.
 *
 * @group Geometries
 */
export function boundaryShape(boundary: Boundary): BoundaryShape {
  if (Array.isArray(boundary)) {
    if (typeof boundary[0] === 'number')
      return { kind: 'box', box: boundary as BoundaryBox, rotation: 0 };
    return { kind: 'polygon', rings: [boundary as Vec2[]] };
  }
  if (isPolygonGeometry(boundary)) {
    const [ox, oz] = boundary.offset;
    const rings: Vec2[][] = [];
    for (const polygon of boundary.coordinates as Vec2[][][])
      for (const ring of polygon)
        if (ring.length >= 3)
          rings.push(ring.map(([x, z]): Vec2 => [x + ox, z + oz]));
    return { kind: 'polygon', rings };
  }
  if ('box' in boundary)
    return { kind: 'box', box: boundary.box, rotation: boundary.rotation };
  return { kind: 'circle', centre: boundary.centre, radius: boundary.radius };
}

/**
 * A key for a {@link Boundary}'s shape: the same for the same shape, however it is given, so
 * a boundary written inline (a new object every render) changes nothing.
 *
 * @group Geometries
 */
export function boundaryKey(boundary: Boundary | null | undefined): string {
  return boundary ? JSON.stringify(boundaryShape(boundary)) : '';
}

// A box's corners, turned about its middle.
function boxCorners([minX, minZ, maxX, maxZ]: BoundaryBox, rotation: number) {
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ].map(([x, z]): Vec2 => {
    const u = x - cx;
    const v = z - cz;
    return [cx + u * c + v * s, cz - u * s + v * c];
  });
}

/**
 * The smallest circle holding a {@link Boundary}: a box's (turned or not) about its middle,
 * half its diagonal across; a circle itself; a polygon's through two or three of its points
 * (Welzl's). Where the globe is cut flat for a stage of that boundary.
 *
 * @group Geometries
 */
export function boundaryDisc(boundary: Boundary): BoundaryCircle {
  const shape = boundaryShape(boundary);
  if (shape.kind === 'circle')
    return { centre: [...shape.centre] as Vec2, radius: shape.radius };
  if (shape.kind === 'box') {
    const [minX, minZ, maxX, maxZ] = shape.box;
    return {
      centre: [(minX + maxX) / 2, (minZ + maxZ) / 2],
      radius: Math.hypot(maxX - minX, maxZ - minZ) / 2,
    };
  }
  return enclosingCircle(shape.rings.flat());
}

/**
 * The axis-aligned box holding a {@link Boundary}, `[minX, minZ, maxX, maxZ]`.
 *
 * @group Geometries
 */
export function boundaryBox(boundary: Boundary): BoundaryBox {
  const shape = boundaryShape(boundary);
  if (shape.kind === 'circle') {
    const [x, z] = shape.centre;
    const r = shape.radius;
    return [x - r, z - r, x + r, z + r];
  }
  if (shape.kind === 'box' && shape.rotation === 0) return [...shape.box];
  const points =
    shape.kind === 'box'
      ? boxCorners(shape.box, shape.rotation)
      : shape.rings.flat();
  const box: BoundaryBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of points) {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], z);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], z);
  }
  return box;
}

/**
 * Whether X/Z lies inside a {@link Boundary}: a polygon's by the even-odd rule over all its
 * rings, so holes are outside.
 *
 * @group Geometries
 */
export function boundaryContains(
  boundary: Boundary,
  x: number,
  z: number,
): boolean {
  const shape = boundaryShape(boundary);
  if (shape.kind === 'circle')
    return Math.hypot(x - shape.centre[0], z - shape.centre[1]) <= shape.radius;
  if (shape.kind === 'box') {
    const [minX, minZ, maxX, maxZ] = shape.box;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const c = Math.cos(shape.rotation);
    const s = Math.sin(shape.rotation);
    // Back into the box's own axes: the turn undone.
    const u = cx + (x - cx) * c - (z - cz) * s;
    const v = cz + (x - cx) * s + (z - cz) * c;
    return u >= minX && u <= maxX && v >= minZ && v <= maxZ;
  }
  let inside = false;
  for (const ring of shape.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
        inside = !inside;
    }
  }
  return inside;
}

/**
 * A {@link Boundary}'s outline as closed rings of X/Z points, the first not repeated at the
 * end: a box's four corners, a circle's `segments` points, a polygon's own rings.
 *
 * @group Geometries
 */
export function boundaryOutline(boundary: Boundary, segments = 64): Vec2[][] {
  const shape = boundaryShape(boundary);
  if (shape.kind === 'box') return [boxCorners(shape.box, shape.rotation)];
  if (shape.kind === 'circle') {
    const [x, z] = shape.centre;
    return [
      Array.from({ length: segments }, (_, i): Vec2 => {
        const a = (i / segments) * 2 * Math.PI;
        return [x + shape.radius * Math.cos(a), z + shape.radius * Math.sin(a)];
      }),
    ];
  }
  return shape.rings.map(ring => ring.map(([x, z]): Vec2 => [x, z]));
}

// The circle through two points, as its diameter, or three.
function circleOf2([ax, az]: Vec2, [bx, bz]: Vec2): BoundaryCircle {
  return {
    centre: [(ax + bx) / 2, (az + bz) / 2],
    radius: Math.hypot(ax - bx, az - bz) / 2,
  };
}
function circleOf3(a: Vec2, b: Vec2, c: Vec2): BoundaryCircle {
  const [ax, az] = a;
  const bx = b[0] - ax;
  const bz = b[1] - az;
  const cx = c[0] - ax;
  const cz = c[1] - az;
  const d = 2 * (bx * cz - bz * cx);
  // In a line: the widest pair.
  if (Math.abs(d) < 1e-12) {
    const pairs = [circleOf2(a, b), circleOf2(a, c), circleOf2(b, c)];
    return pairs.reduce((p, q) => (q.radius > p.radius ? q : p));
  }
  const b2 = bx * bx + bz * bz;
  const c2 = cx * cx + cz * cz;
  const ux = (cz * b2 - bz * c2) / d;
  const uz = (bx * c2 - cx * b2) / d;
  return { centre: [ax + ux, az + uz], radius: Math.hypot(ux, uz) };
}
const holds = (circle: BoundaryCircle, [x, z]: Vec2) =>
  Math.hypot(x - circle.centre[0], z - circle.centre[1]) <=
  circle.radius * (1 + 1e-12) + 1e-9;

/**
 * The smallest circle holding `points` (Welzl's, iteratively), in expected linear time.
 *
 * @group Geometries
 */
export function enclosingCircle(points: readonly Vec2[]): BoundaryCircle {
  if (points.length === 0) return { centre: [0, 0], radius: 0 };
  // A fixed shuffle, so the same points give the same circle.
  const p = [...points];
  let seed = 1;
  for (let i = p.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  let circle: BoundaryCircle = { centre: [...p[0]] as Vec2, radius: 0 };
  for (let i = 1; i < p.length; i++) {
    if (holds(circle, p[i])) continue;
    circle = { centre: [...p[i]] as Vec2, radius: 0 };
    for (let j = 0; j < i; j++) {
      if (holds(circle, p[j])) continue;
      circle = circleOf2(p[i], p[j]);
      for (let k = 0; k < j; k++)
        if (!holds(circle, p[k])) circle = circleOf3(p[i], p[j], p[k]);
    }
  }
  return circle;
}

// The convex hull of `points`, counter-clockwise in X/Z (Andrew's monotone chain).
function convexHull(points: readonly Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0
    )
      lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0
    )
      upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The smallest turned box holding `points` — a field's outline, its data's footprint — as a
 * {@link BoundaryRotatedBox}: one of its sides lies along an edge of their convex hull, so
 * each edge's direction is tried. Its `rotation` is in (−π/4, π/4], the box's sides then
 * nearest the axes. For a stage that fits a field turned against its grid.
 *
 * @group Geometries
 */
export function orientedBounds(points: readonly Vec2[]): BoundaryRotatedBox {
  const hull = convexHull(points);
  if (hull.length === 0) return { box: [0, 0, 0, 0], rotation: 0 };
  let best: BoundaryRotatedBox | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < Math.max(hull.length, 1); i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    // The edge's angle, as the rotation that lays it along +X; folded to (−π/4, π/4].
    let rotation = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    rotation -= (Math.PI / 2) * Math.round(rotation / (Math.PI / 2));
    if (rotation <= -Math.PI / 4) rotation += Math.PI / 2;
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    // Each point in the box's axes (the turn undone about the origin).
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const [x, z] of hull) {
      const u = x * c - z * s;
      const v = x * s + z * c;
      minU = Math.min(minU, u);
      minV = Math.min(minV, v);
      maxU = Math.max(maxU, u);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      // The box's middle back in X/Z, then its extent about it there.
      const mu = (minU + maxU) / 2;
      const mv = (minV + maxV) / 2;
      const cx = mu * c + mv * s;
      const cz = -mu * s + mv * c;
      const hu = (maxU - minU) / 2;
      const hv = (maxV - minV) / 2;
      best = { box: [cx - hu, cz - hv, cx + hu, cz + hv], rotation };
    }
  }
  return best!;
}
