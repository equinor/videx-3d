import type { BufferGeometry } from 'three';

/**
 * Where a flat geometry covers in plan (its X/Z, in its own frame): the water a sea's surface
 * lies over, say. From its triangles, whatever its outline: holes, notches and separate parts
 * alike. {@link geometryFootprint} makes it.
 *
 * @group Geometry
 */
export type GeometryFootprint = {
  /** its box: `[minX, minZ, maxX, maxZ]` */
  readonly box: readonly [number, number, number, number];
  /** whether `(x, z)` lies under one of its triangles: exact, a few triangles tested */
  contains(x: number, z: number): boolean;
};

type Cached = { footprint: GeometryFootprint; version: number };

const CACHE = new WeakMap<BufferGeometry, Cached>();

/**
 * The footprint of a flat `geometry` ({@link GeometryFootprint}): kept with the geometry and
 * made again as its positions change.
 *
 * @group Geometry
 */
export function geometryFootprint(geometry: BufferGeometry): GeometryFootprint {
  const position = geometry.getAttribute('position');
  const version = (position as { version?: number }).version ?? 0;
  const cached = CACHE.get(geometry);
  if (cached && cached.version === version) return cached.footprint;
  if (!cached)
    geometry.addEventListener('dispose', () => CACHE.delete(geometry));
  const footprint = buildFootprint(geometry);
  CACHE.set(geometry, { footprint, version });
  return footprint;
}

function buildFootprint(geometry: BufferGeometry): GeometryFootprint {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  // The triangles in plan, degenerate ones (seen edge on from above) left out.
  const tri: number[] = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = index ? index.getX(t) : t;
    const b = index ? index.getX(t + 1) : t + 1;
    const c = index ? index.getX(t + 2) : t + 2;
    const ax = position.getX(a);
    const az = position.getZ(a);
    const bx = position.getX(b);
    const bz = position.getZ(b);
    const cx = position.getX(c);
    const cz = position.getZ(c);
    if (Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) < 1e-12)
      continue;
    tri.push(ax, az, bx, bz, cx, cz);
    minX = Math.min(minX, ax, bx, cx);
    maxX = Math.max(maxX, ax, bx, cx);
    minZ = Math.min(minZ, az, bz, cz);
    maxZ = Math.max(maxZ, az, bz, cz);
  }
  const triangles = tri.length / 6;
  if (!triangles) {
    return { box: [0, 0, 0, 0], contains: () => false };
  }
  const width = Math.max(maxX - minX, 1e-9);
  const length = Math.max(maxZ - minZ, 1e-9);

  // Inside a triangle, its edges included: by the signs of the three edge functions.
  const inside = (i: number, x: number, z: number) => {
    const o = i * 6;
    const ax = tri[o];
    const az = tri[o + 1];
    const bx = tri[o + 2];
    const bz = tri[o + 3];
    const cx = tri[o + 4];
    const cz = tri[o + 5];
    const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    const d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
    const d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
    const scale = 1e-9 * (width + length) * (width + length);
    const negative = d1 < -scale || d2 < -scale || d3 < -scale;
    const positive = d1 > scale || d2 > scale || d3 > scale;
    return !(negative && positive);
  };

  // A grid of the triangles over each cell, by their boxes: a lookup tests only those.
  const side = Math.min(Math.max(Math.ceil(Math.sqrt(triangles / 2)), 1), 256);
  const gx = Math.max(Math.round(side * Math.sqrt(width / length)), 1);
  const gz = Math.max(Math.round(side * Math.sqrt(length / width)), 1);
  const cellOf = (v: number, min: number, span: number, n: number) =>
    Math.min(Math.max(Math.floor(((v - min) / span) * n), 0), n - 1);
  const cells: number[][] = Array.from({ length: gx * gz }, () => []);
  for (let i = 0; i < triangles; i++) {
    const o = i * 6;
    const x0 = cellOf(
      Math.min(tri[o], tri[o + 2], tri[o + 4]),
      minX,
      width,
      gx,
    );
    const x1 = cellOf(
      Math.max(tri[o], tri[o + 2], tri[o + 4]),
      minX,
      width,
      gx,
    );
    const z0 = cellOf(
      Math.min(tri[o + 1], tri[o + 3], tri[o + 5]),
      minZ,
      length,
      gz,
    );
    const z1 = cellOf(
      Math.max(tri[o + 1], tri[o + 3], tri[o + 5]),
      minZ,
      length,
      gz,
    );
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) cells[z * gx + x].push(i);
  }
  const contains = (x: number, z: number) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
    const list =
      cells[cellOf(z, minZ, length, gz) * gx + cellOf(x, minX, width, gx)];
    for (const i of list) if (inside(i, x, z)) return true;
    return false;
  };

  return { box: [minX, minZ, maxX, maxZ], contains };
}
