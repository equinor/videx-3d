import type { Vec2 } from '../types/common';
import type { PlanarPolygonCoordinates } from './planar-geometry';

// ⚠️ Free of three.js: it runs where the generators run.

/**
 * A polygon's signed distance on a square grid, for telling inside from outside per pixel
 * (see `polygonDistanceAt`): bilinear between its texels, a straight edge is found
 * exactly.
 *
 * @group Geometries
 */
export type PolygonDistanceField = {
  /**
   * `size` x `size` texels, row by row from min Z: the distance from the texel's middle to
   * the polygon's boundary, positive inside, exact within `band` and clamped to it past it
   */
  values: Float32Array;
  size: number;
  /** X/Z of the grid's min corner */
  origin: Vec2;
  /** a texel's width */
  cell: number;
  /** how far from the boundary the distance is exact */
  band: number;
};

// From point (px, pz) to the segment from (ax, az) to (bx, bz).
function toSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = dx * dx + dz * dz;
  const t =
    length > 0
      ? Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / length, 0), 1)
      : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/**
 * The signed distance to a polygon's boundary (its rings, holes included, even-odd) on a
 * grid of `size` x `size` texels over its bounds, with a margin of `band` + 1 texels of
 * outside all round. Exact within `band` texels of the boundary, and only there: enough
 * to tell inside from outside, and to find a straight edge, by bilinear interpolation.
 *
 * @param offset added to every coordinate (`PlanarPolygonGeometry.offset`)
 * @returns null for a polygon without area
 *
 * @group Geometries
 */
export function polygonDistanceField(
  polygon: PlanarPolygonCoordinates,
  offset: Vec2 = [0, 0],
  size = 256,
  band = 4,
): PolygonDistanceField | null {
  const rings: Vec2[][] = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const component of polygon) {
    for (const ring of component) {
      if (ring.length < 3) continue;
      const placed = ring.map(([x, z]): Vec2 => [x + offset[0], z + offset[1]]);
      rings.push(placed);
      for (const [x, z] of placed) {
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, z);
      }
    }
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  if (rings.length === 0 || !(span > 0)) return null;
  const cell = span / (size - 2 * (band + 1));
  const origin: Vec2 = [
    (minX + maxX) / 2 - (size * cell) / 2,
    (minZ + maxZ) / 2 - (size * cell) / 2,
  ];
  const reach = band * cell;
  const distance = new Float32Array(size * size).fill(reach);

  // Near each edge, the distance to it.
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k];
      const [bx, bz] = ring[(k + 1) % ring.length];
      const i0 = Math.max(
        Math.floor((Math.min(ax, bx) - reach - origin[0]) / cell),
        0,
      );
      const i1 = Math.min(
        Math.ceil((Math.max(ax, bx) + reach - origin[0]) / cell),
        size - 1,
      );
      const j0 = Math.max(
        Math.floor((Math.min(az, bz) - reach - origin[1]) / cell),
        0,
      );
      const j1 = Math.min(
        Math.ceil((Math.max(az, bz) + reach - origin[1]) / cell),
        size - 1,
      );
      for (let j = j0; j <= j1; j++) {
        const pz = origin[1] + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const d = toSegment(origin[0] + (i + 0.5) * cell, pz, ax, az, bx, bz);
          const at = j * size + i;
          if (d < distance[at]) distance[at] = d;
        }
      }
    }
  }

  // Inside, even-odd along each row of texel middles.
  const crossings: number[] = [];
  for (let j = 0; j < size; j++) {
    const pz = origin[1] + (j + 0.5) * cell;
    crossings.length = 0;
    for (const ring of rings) {
      for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
        const [xk, zk] = ring[k];
        const [xl, zl] = ring[l];
        if (zk > pz !== zl > pz)
          crossings.push(((xl - xk) * (pz - zk)) / (zl - zk) + xk);
      }
    }
    crossings.sort((a, b) => a - b);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const i0 = Math.max(
        Math.ceil((crossings[c] - origin[0]) / cell - 0.5),
        0,
      );
      const i1 = Math.min(
        Math.ceil((crossings[c + 1] - origin[0]) / cell - 0.5) - 1,
        size - 1,
      );
      for (let i = i0; i <= i1; i++) distance[j * size + i] *= -1;
    }
  }
  // Positive inside: the rows above flipped the inside to negative.
  for (let k = 0; k < distance.length; k++) distance[k] = -distance[k];
  return { values: distance, size, origin, cell, band };
}

/**
 * A {@link PolygonDistanceField} at X/Z: bilinear between the four texels about it, each
 * clamped to the grid, as `sampleFieldMap` in `shaderLib/depth-map.glsl` reads it.
 * Positive inside.
 *
 * @group Geometries
 */
export function polygonDistanceAt(
  field: PolygonDistanceField,
  x: number,
  z: number,
): number {
  const { values, size, origin, cell } = field;
  const tx = (x - origin[0]) / cell - 0.5;
  const tz = (z - origin[1]) / cell - 0.5;
  const bx = Math.floor(tx);
  const bz = Math.floor(tz);
  const fx = tx - bx;
  const fz = tz - bz;
  const at = (i: number, j: number) =>
    values[
      Math.min(Math.max(j, 0), size - 1) * size +
        Math.min(Math.max(i, 0), size - 1)
    ];
  return (
    (at(bx, bz) * (1 - fx) + at(bx + 1, bz) * fx) * (1 - fz) +
    (at(bx, bz + 1) * (1 - fx) + at(bx + 1, bz + 1) * fx) * fz
  );
}
