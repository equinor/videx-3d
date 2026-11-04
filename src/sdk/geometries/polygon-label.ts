import type { Vec2 } from '../types/common';
import type { PlanarPolygonCoordinates } from './planar-geometry';

// ⚠️ Free of three.js.

// The signed distance from a point to a polygon's rings (even-odd): positive inside.
function signedDistance(x: number, z: number, rings: Vec2[][]): number {
  let inside = false;
  let least = Infinity;
  for (const ring of rings) {
    for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
      const [ax, az] = ring[k];
      const [bx, bz] = ring[l];
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
        inside = !inside;
      const dx = bx - ax;
      const dz = bz - az;
      const length = dx * dx + dz * dz;
      const t =
        length > 0
          ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / length, 0), 1)
          : 0;
      least = Math.min(least, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
  }
  return inside ? least : -least;
}

type Cell = { x: number; z: number; half: number; d: number; most: number };

const cell = (x: number, z: number, half: number, rings: Vec2[][]): Cell => {
  const d = signedDistance(x, z, rings);
  return { x, z, half, d, most: d + half * Math.SQRT2 };
};

/**
 * Where to put a polygon's label: the point inside it farthest from its boundary (its
 * pole of inaccessibility, found as `polylabel` does, to within `precision`), so it lies
 * inside however concave the polygon is, unlike its centroid. For a multi-part polygon,
 * the point of the part that has the most room. Returns the point and how far it is from
 * the boundary; null for a polygon without area.
 *
 * @param precision how close to the best the answer must be, in the coordinates' units;
 *   default a thousandth of the polygon's larger side
 *
 * @group Geometries
 */
export function polygonLabelPoint(
  polygon: PlanarPolygonCoordinates,
  precision?: number,
): { point: Vec2; distance: number } | null {
  let best: { point: Vec2; distance: number } | null = null;
  for (const rings of polygon) {
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of outer) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
    const width = maxX - minX;
    const height = maxZ - minZ;
    const size = Math.min(width, height);
    if (!(size > 0)) continue;
    const step = precision ?? Math.max(width, height) / 1000;
    const half = size / 2;
    const queue: Cell[] = [];
    for (let x = minX; x < maxX; x += size) {
      for (let z = minZ; z < maxZ; z += size)
        queue.push(cell(x + half, z + half, half, rings));
    }
    // The centre of its bounds as a first guess: the best of it, or nothing.
    let top = cell(minX + width / 2, minZ + height / 2, 0, rings);
    // Cells are few: a sorted array is quick enough as a priority queue.
    queue.sort((a, b) => a.most - b.most);
    let guard = 0;
    while (queue.length && guard++ < 100000) {
      const next = queue.pop()!;
      if (next.d > top.d) top = next;
      if (next.most - top.d <= step) continue;
      const h = next.half / 2;
      for (const [dx, dz] of [
        [-h, -h],
        [h, -h],
        [-h, h],
        [h, h],
      ]) {
        const child = cell(next.x + dx, next.z + dz, h, rings);
        let at = queue.length;
        while (at > 0 && queue[at - 1].most > child.most) at--;
        queue.splice(at, 0, child);
      }
    }
    if (top.d > 0 && (!best || top.d > best.distance))
      best = { point: [top.x, top.z], distance: top.d };
  }
  return best;
}

/**
 * A rectangle inside a polygon (see {@link polygonLabelRect}): its middle, its width along
 * `angle` and its height across it, and `angle`, in radians from the first axis toward the
 * second.
 *
 * @group Geometries
 */
export type PolygonLabelRect = {
  centre: Vec2;
  width: number;
  height: number;
  angle: number;
};

// Floats a segment of a polygon takes, flat (`polygonSegments`): its start, its run, its box.
const SEGMENT = 8;

// A polygon's rings' segments, flat (SEGMENT floats each), turned back by `angle` (cos,
// sin) and narrowed along it by `aspect`; those of no length left out.
function polygonSegments(
  rings: readonly (readonly Vec2[])[],
  aspect: number,
  cos: number,
  sin: number,
) {
  let count = 0;
  for (const ring of rings) count += ring.length;
  const out = new Float64Array(count * SEGMENT);
  let s = 0;
  for (const ring of rings) {
    const n = ring.length;
    for (let k = 0, l = n - 1; k < n; l = k++) {
      const ax = (ring[k][0] * cos + ring[k][1] * sin) / aspect;
      const az = -ring[k][0] * sin + ring[k][1] * cos;
      const bx = (ring[l][0] * cos + ring[l][1] * sin) / aspect;
      const bz = -ring[l][0] * sin + ring[l][1] * cos;
      if (ax === bx && az === bz) continue;
      out[s] = ax;
      out[s + 1] = az;
      out[s + 2] = bx - ax;
      out[s + 3] = bz - az;
      out[s + 4] = Math.min(ax, bx);
      out[s + 5] = Math.max(ax, bx);
      out[s + 6] = Math.min(az, bz);
      out[s + 7] = Math.max(az, bz);
      s += SEGMENT;
    }
  }
  return out.subarray(0, s);
}

// The signed Chebyshev distance (the larger of the two axes') from a point to a polygon's
// segments (`polygonSegments`), even-odd: positive inside. Along a segment it is convex
// and piecewise linear, so least at an end or where an axis's distance turns (0) or the
// two meet (x = ±z). A segment whose box lies farther than the nearest so far is skipped.
function signedChebyshev(x: number, z: number, segments: Float64Array): number {
  let inside = false;
  let least = Infinity;
  for (let s = 0; s < segments.length; s += SEGMENT) {
    const sx = segments[s];
    const sz = segments[s + 1];
    const dx = segments[s + 2];
    const dz = segments[s + 3];
    if (sz > z !== sz + dz > z && x < (dx * (z - sz)) / dz + sx)
      inside = !inside;
    const outX = Math.max(segments[s + 4] - x, x - segments[s + 5], 0);
    const outZ = Math.max(segments[s + 6] - z, z - segments[s + 7], 0);
    if (outX >= least || outZ >= least) continue;
    const ax = sx - x;
    const az = sz - z;
    let d = Math.min(
      Math.max(Math.abs(ax), Math.abs(az)),
      Math.max(Math.abs(ax + dx), Math.abs(az + dz)),
    );
    for (let k = 0; k < 4; k++) {
      const t =
        k === 0
          ? dx !== dz
            ? (az - ax) / (dx - dz)
            : -1
          : k === 1
            ? dx !== -dz
              ? -(ax + az) / (dx + dz)
              : -1
            : k === 2
              ? dx !== 0
                ? -ax / dx
                : -1
              : dz !== 0
                ? -az / dz
                : -1;
      if (t > 0 && t < 1)
        d = Math.min(d, Math.max(Math.abs(ax + t * dx), Math.abs(az + t * dz)));
    }
    if (d < least) least = d;
  }
  return inside ? least : -least;
}

/**
 * The largest rectangle `aspect` times as wide as it is high, turned `angle` radians from
 * the first axis toward the second, that fits inside a polygon: where a label of that
 * shape goes to be as large as it can be. For a multi-part polygon, the largest of its
 * parts'. Null for a polygon without area.
 *
 * Stretched along `angle` by 1 / `aspect`, such a rectangle is a square, and the largest
 * square about a point inside the polygon reaches its Chebyshev (L∞) distance to the
 * boundary: the rectangle's middle is the polygon's pole of inaccessibility in that norm,
 * found as `polylabel` finds the Euclidean one ({@link polygonLabelPoint}), to within
 * `precision` of its half height.
 *
 * Its cost grows with the polygon's vertices: simplify detailed rings first (`simplifyRing`,
 * to a fiftieth of their size, say: about 0.04 ms a rectangle for the discoveries on the
 * Norwegian shelf, 2026-11-03).
 *
 * @param aspect the rectangle's width over its height
 * @param angle radians from the first axis toward the second; default 0
 * @param precision how close to the best its half height must be, in the coordinates'
 *   units; default a twentieth of the stretched polygon's smaller side (its half height is
 *   at most half that side: within 10 % of the best, and never larger than fits)
 *
 * @group Geometries
 */
export function polygonLabelRect(
  polygon: PlanarPolygonCoordinates,
  aspect: number,
  angle = 0,
  precision?: number,
): PolygonLabelRect | null {
  if (!(aspect > 0)) return null;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let best: PolygonLabelRect | null = null;
  for (const part of polygon) {
    if (!part[0] || part[0].length < 3) continue;
    // Turned back by `angle`, and narrowed along it by `aspect`.
    const segments = polygonSegments(part, aspect, cos, sin);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [px, pz] of part[0]) {
      const x = (px * cos + pz * sin) / aspect;
      const z = -px * sin + pz * cos;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const width = maxX - minX;
    const height = maxZ - minZ;
    const size = Math.min(width, height);
    if (!(size > 0)) continue;
    const step = precision ?? size / 20;
    const half = size / 2;
    const cellOf = (x: number, z: number, h: number): Cell => {
      const d = signedChebyshev(x, z, segments);
      // A square cell's farthest point from its middle in L∞ is its half side.
      return { x, z, half: h, d, most: d + h };
    };
    let top = cellOf(minX + width / 2, minZ + height / 2, 0);
    // A binary heap, most promising first: along a ridge of equal room (a long band) cells
    // pile up, which a sorted array would insert into one by one.
    const heap: Cell[] = [];
    const push = (added: Cell) => {
      let at = heap.push(added) - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (heap[parent].most >= added.most) break;
        heap[at] = heap[parent];
        at = parent;
      }
      heap[at] = added;
    };
    const pop = () => {
      const first = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        let at = 0;
        for (;;) {
          let child = at * 2 + 1;
          if (child >= heap.length) break;
          if (
            child + 1 < heap.length &&
            heap[child + 1].most > heap[child].most
          )
            child++;
          if (heap[child].most <= last.most) break;
          heap[at] = heap[child];
          at = child;
        }
        heap[at] = last;
      }
      return first;
    };
    for (let x = minX; x < maxX; x += size) {
      for (let z = minZ; z < maxZ; z += size)
        push(cellOf(x + half, z + half, half));
    }
    let guard = 0;
    while (heap.length && guard++ < 100000) {
      const next = pop();
      if (next.d > top.d) top = next;
      if (next.most - top.d <= step) continue;
      const h = next.half / 2;
      for (let q = 0; q < 4; q++) {
        const child = cellOf(
          next.x + (q & 1 ? h : -h),
          next.z + (q & 2 ? h : -h),
          h,
        );
        if (child.d > top.d) top = child;
        if (child.most - top.d > step) push(child);
      }
    }
    if (!(top.d > 0) || (best && top.d * 2 <= best.height)) continue;
    const u = top.x * aspect;
    const v = top.z;
    best = {
      centre: [u * cos - v * sin, u * sin + v * cos],
      width: 2 * top.d * aspect,
      height: 2 * top.d,
      angle,
    };
  }
  return best;
}

/**
 * How much more room a label turned along a polygon's main axis must have than one
 * reading level for it to turn (see {@link polygonLabelPlaces}): text reads best level.
 */
export const POLYGON_LABEL_TURN_GAIN = 1.25;

/**
 * Where a label goes inside a polygon in each of the shapes it may take — its text broken
 * into one, two or three lines, say: `shapes` each a width and height (any units: only
 * their ratio counts). For each, the largest rectangle of its shape that fits
 * ({@link polygonLabelRect}): reading level (angle 0), or, with `turn`, along the
 * polygon's main axis ({@link polygonMainAxis}) where it is elongated (1.5 or more) and
 * that gives {@link POLYGON_LABEL_TURN_GAIN} times the room. Null for a shape that fits
 * nowhere (a polygon without area).
 *
 * Simplify detailed rings first (see {@link polygonLabelRect}).
 *
 * @group Geometries
 */
export function polygonLabelPlaces(
  polygon: PlanarPolygonCoordinates,
  shapes: readonly { width: number; height: number }[],
  turn = true,
): (PolygonLabelRect | null)[] {
  const axis = turn ? polygonMainAxis(polygon) : null;
  const turned =
    axis && axis.elongation >= 1.5 && Math.abs(axis.angle) > 0.05
      ? axis.angle
      : null;
  return shapes.map(({ width, height }) => {
    const aspect = width / height;
    const level = polygonLabelRect(polygon, aspect, 0);
    if (turned === null) return level;
    const along = polygonLabelRect(polygon, aspect, turned);
    if (
      along &&
      (!level || along.height >= POLYGON_LABEL_TURN_GAIN * level.height)
    )
      return along;
    return level;
  });
}

/**
 * A polygon's main axis: the way its largest part is longest, from its area's second
 * moments (its principal axis), in radians from the first axis toward the second, in
 * (−π/2, π/2]; and how elongated it is that way, the square root of the moments' ratio (1
 * for a disc or a square, 3 for a 3 × 1 rectangle). Null for a polygon without area.
 *
 * @group Geometries
 */
export function polygonMainAxis(
  polygon: PlanarPolygonCoordinates,
): { angle: number; elongation: number } | null {
  let found: { area: number; mxx: number; myy: number; mxy: number } | null =
    null;
  for (const part of polygon) {
    const outer = part[0];
    if (!outer || outer.length < 3) continue;
    // About its first vertex, for precision far from the origin.
    const [x0, z0] = outer[0];
    let area = 0;
    let sx = 0;
    let sz = 0;
    let sxx = 0;
    let szz = 0;
    let sxz = 0;
    part.forEach((ring, r) => {
      let a = 0;
      let cx = 0;
      let cz = 0;
      let xx = 0;
      let zz = 0;
      let xz = 0;
      for (let k = 0, n = ring.length; k < n; k++) {
        const xi = ring[k][0] - x0;
        const zi = ring[k][1] - z0;
        const xj = ring[(k + 1) % n][0] - x0;
        const zj = ring[(k + 1) % n][1] - z0;
        const cross = xi * zj - xj * zi;
        a += cross;
        cx += (xi + xj) * cross;
        cz += (zi + zj) * cross;
        xx += (xi * xi + xi * xj + xj * xj) * cross;
        zz += (zi * zi + zi * zj + zj * zj) * cross;
        xz += (xi * zj + 2 * xi * zi + 2 * xj * zj + xj * zi) * cross;
      }
      // Each ring counted by its own winding: the outer adds, the holes take away.
      const sign = (a < 0 ? -1 : 1) * (r === 0 ? 1 : -1);
      area += (sign * a) / 2;
      sx += (sign * cx) / 6;
      sz += (sign * cz) / 6;
      sxx += (sign * xx) / 12;
      szz += (sign * zz) / 12;
      sxz += (sign * xz) / 24;
    });
    if (!(area > 0) || (found && area <= found.area)) continue;
    const mx = sx / area;
    const mz = sz / area;
    found = {
      area,
      mxx: sxx - area * mx * mx,
      myy: szz - area * mz * mz,
      mxy: sxz - area * mx * mz,
    };
  }
  if (!found) return null;
  const { mxx, myy, mxy } = found;
  let angle = 0.5 * Math.atan2(2 * mxy, mxx - myy);
  if (angle <= -Math.PI / 2) angle += Math.PI;
  const mean = (mxx + myy) / 2;
  const spread = Math.hypot((mxx - myy) / 2, mxy);
  const least = mean - spread;
  return {
    angle,
    elongation: least > 0 ? Math.sqrt((mean + spread) / least) : Infinity,
  };
}
