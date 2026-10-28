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
