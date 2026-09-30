import { Vec3 } from '../types/common';

/**
 * One sample taken from a {@link TinSampler}.
 *
 * @group Geometries
 */
export type TinSample = {
  /** interpolated height (scene Y) where the sample landed */
  y: number;
  /**
   * Unit normal of the triangle the sample landed in, always in the +Y
   * hemisphere — a height field is sampled from above, and a cap's winding is not
   * something the caller should have to know about.
   */
  normal: Vec3;
};

/**
 * Options for {@link createTinSampler}.
 *
 * @group Geometries
 */
export type TinSamplerOptions = {
  /**
   * Bucket size of the lookup grid, in world units. Derived from the triangle
   * density when omitted, which is right unless the mesh is very uneven.
   */
  cellSize?: number;
  /** Cap on the number of buckets, so a tiny `cellSize` cannot run away. Default 2^20. */
  maxCells?: number;
};

/**
 * Point queries against a triangle mesh that is single-valued in XZ.
 *
 * @group Geometries
 */
export type TinSampler = {
  /**
   * Height and surface normal at a world X/Z, or `null` where the mesh does not
   * cover that point — outside its boundary, or in a hole.
   *
   * @param out reused to avoid allocating on a per-frame path (e.g. a cursor)
   */
  sampleAt(x: number, z: number, out?: TinSample): TinSample | null;
  /** Just the height, or `null` where the mesh does not cover the point. */
  getHeightAt(x: number, z: number): number | null;
  /** `[minX, minZ, maxX, maxZ]` of the sampled mesh */
  readonly bounds: [number, number, number, number];
  readonly triangles: number;
};

/** Barycentric slack, in unitless weights — enough to catch a shared edge. */
const EPS = 1e-7;

const scratch: TinSample = { y: 0, normal: [0, 1, 0] };

/**
 * Build a point sampler over a triangle mesh that is a height field in XZ — a
 * chunk's surface cap, a draped sheet, any TIN.
 *
 * ⭐ It samples the TRIANGLES, which is the whole point: heights taken from the
 * source grid instead differ from the drawn mesh by up to the tessellation's
 * `maxError`, so an object placed from the grid can float or sink metres away from
 * the surface it is supposed to be resting on. What is sampled here is exactly
 * what is on screen.
 *
 * Triangles are bucketed into a uniform XZ grid (CSR, typed arrays) on
 * construction, so a query touches only the handful of triangles over the point.
 * That is what makes it cheap enough to sample a whole footprint per pointer move.
 *
 * ⚠️ Single-valued in XZ is assumed. Where triangles do overlap vertically the
 * HIGHEST is returned, which is the useful answer for placing something on top and
 * a deterministic one everywhere else.
 *
 * @param positions the mesh's vertex positions, x/y/z interleaved
 * @param indices triangle indices; omit for a non-indexed mesh
 *
 * @group Geometries
 */
export function createTinSampler(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number> | null,
  options: TinSamplerOptions = {},
): TinSampler {
  let index: ArrayLike<number>;
  if (indices) {
    index = indices;
  } else {
    const sequential = new Uint32Array(positions.length / 3);
    for (let i = 0; i < sequential.length; i++) sequential[i] = i;
    index = sequential;
  }
  const triangles = (index.length / 3) | 0;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < triangles * 3; i++) {
    const p = index[i] * 3;
    const x = positions[p];
    const z = positions[p + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const width = maxX - minX;
  const depth = maxZ - minZ;
  let cell = options.cellSize ?? 0;
  if (!(cell > 0)) {
    const area = Math.max(width * depth, 0);
    cell = area > 0 ? Math.sqrt(area / Math.max(triangles, 1)) : 1;
  }
  if (!(cell > 0)) cell = 1;

  let columns = Math.max(1, Math.ceil(width / cell));
  let rows = Math.max(1, Math.ceil(depth / cell));
  const maxCells = options.maxCells ?? 1 << 20;
  if (columns * rows > maxCells) {
    cell *= Math.sqrt((columns * rows) / maxCells);
    columns = Math.max(1, Math.ceil(width / cell));
    rows = Math.max(1, Math.ceil(depth / cell));
  }
  const cells = columns * rows;

  const columnOf = (x: number) =>
    Math.min(columns - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const rowOf = (z: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor((z - minZ) / cell)));

  // CSR: count per bucket, prefix-sum into starts, then fill.
  const starts = new Uint32Array(cells + 1);
  const box = (t: number) => {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const ax = positions[a];
    const bx = positions[b];
    const cx = positions[c];
    const az = positions[a + 2];
    const bz = positions[b + 2];
    const cz = positions[c + 2];
    return [
      columnOf(Math.min(ax, bx, cx)),
      rowOf(Math.min(az, bz, cz)),
      columnOf(Math.max(ax, bx, cx)),
      rowOf(Math.max(az, bz, cz)),
    ];
  };

  for (let t = 0; t < triangles; t++) {
    const [c0, r0, c1, r1] = box(t);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) starts[r * columns + c + 1]++;
    }
  }
  for (let i = 0; i < cells; i++) starts[i + 1] += starts[i];

  const items = new Uint32Array(starts[cells]);
  const cursor = starts.slice(0, cells);
  for (let t = 0; t < triangles; t++) {
    const [c0, r0, c1, r1] = box(t);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) items[cursor[r * columns + c]++] = t;
    }
  }

  const sampleAt = (x: number, z: number, out?: TinSample) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    const bucket = rowOf(z) * columns + columnOf(x);
    let best = -Infinity;
    let hit = -1;
    for (let i = starts[bucket]; i < starts[bucket + 1]; i++) {
      const t = items[i];
      const a = index[t * 3] * 3;
      const b = index[t * 3 + 1] * 3;
      const c = index[t * 3 + 2] * 3;
      const ax = positions[a];
      const az = positions[a + 2];
      const ux = positions[b] - ax;
      const uz = positions[b + 2] - az;
      const vx = positions[c] - ax;
      const vz = positions[c + 2] - az;
      const det = ux * vz - vx * uz;
      if (det === 0) continue;
      const px = x - ax;
      const pz = z - az;
      const wb = (px * vz - vx * pz) / det;
      const wc = (ux * pz - px * uz) / det;
      if (wb < -EPS || wc < -EPS || wb + wc > 1 + EPS) continue;
      const ay = positions[a + 1];
      const y =
        ay + wb * (positions[b + 1] - ay) + wc * (positions[c + 1] - ay);
      if (y > best) {
        best = y;
        hit = t;
      }
    }
    if (hit < 0) return null;

    const result = out ?? { y: 0, normal: [0, 1, 0] as Vec3 };
    result.y = best;
    const a = index[hit * 3] * 3;
    const b = index[hit * 3 + 1] * 3;
    const c = index[hit * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      const sign = ny < 0 ? -1 / length : 1 / length;
      nx *= sign;
      ny *= sign;
      nz *= sign;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    result.normal[0] = nx;
    result.normal[1] = ny;
    result.normal[2] = nz;
    return result;
  };

  return {
    sampleAt,
    getHeightAt: (x, z) => sampleAt(x, z, scratch)?.y ?? null,
    bounds: [minX, minZ, maxX, maxZ],
    triangles,
  };
}
