import {
  type BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  RedFormat,
} from 'three';

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
  /**
   * The signed distance to its outline over its box, in its units: positive over it, negative
   * beside it (a hole, a notch). One half-float channel, linearly filtered: exact by the
   * edges in the cells next to the outline, carried from cell to cell past them: read at a
   * point, its side tells over or beside, to within a fraction of a cell (a straight edge
   * exactly). `null` where the geometry fills its box, which needs none.
   */
  readonly texture: DataTexture | null;
  /** its X/Z (as `(x, z, 1)`) to the texture's uv */
  readonly toUv: Matrix3;
  /** the texture's cell, in its units (0 without one) */
  readonly cell: number;
};

/** {@link geometryFootprint} options. */
export type GeometryFootprintOptions = {
  /** the texture's cells along the box's longer side. Default 512 */
  resolution?: number;
};

type Cached = { footprint: GeometryFootprint; version: number; key: number };

const CACHE = new WeakMap<BufferGeometry, Cached>();

/**
 * The footprint of a flat `geometry` ({@link GeometryFootprint}): kept with the geometry and
 * made again as its positions change, its texture disposed with it.
 *
 * @group Geometry
 */
export function geometryFootprint(
  geometry: BufferGeometry,
  options: GeometryFootprintOptions = {},
): GeometryFootprint {
  const resolution = Math.max(Math.round(options.resolution ?? 512), 1);
  const position = geometry.getAttribute('position');
  const version = (position as { version?: number }).version ?? 0;
  const cached = CACHE.get(geometry);
  if (cached && cached.version === version && cached.key === resolution)
    return cached.footprint;
  cached?.footprint.texture?.dispose();
  if (!cached)
    geometry.addEventListener('dispose', () => {
      CACHE.get(geometry)?.footprint.texture?.dispose();
      CACHE.delete(geometry);
    });
  const footprint = buildFootprint(geometry, resolution);
  CACHE.set(geometry, { footprint, version, key: resolution });
  return footprint;
}

function buildFootprint(
  geometry: BufferGeometry,
  resolution: number,
): GeometryFootprint {
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
    return {
      box: [0, 0, 0, 0],
      contains: () => false,
      texture: null,
      toUv: new Matrix3(),
      cell: 0,
    };
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

  // The distance to the outline, cell by cell; none where the triangles' areas add up to the
  // box's (they fill it: a plane, a box).
  let area = 0;
  for (let i = 0; i < triangles; i++) {
    const o = i * 6;
    area +=
      Math.abs(
        (tri[o + 2] - tri[o]) * (tri[o + 5] - tri[o + 1]) -
          (tri[o + 4] - tri[o]) * (tri[o + 3] - tri[o + 1]),
      ) / 2;
  }
  const toUv = new Matrix3().set(
    1 / width,
    0,
    -minX / width,
    0,
    1 / length,
    -minZ / length,
    0,
    0,
    1,
  );
  const box = [minX, minZ, maxX, maxZ] as const;
  if (area >= width * length * (1 - 1e-6))
    return { box, contains, texture: null, toUv, cell: 0 };
  const w = Math.max(
    Math.round(width >= length ? resolution : (resolution * width) / length),
    1,
  );
  const h = Math.max(
    Math.round(length >= width ? resolution : (resolution * length) / width),
    1,
  );
  const cell = Math.max(width / w, length / h);

  // Inside or out, cell by cell at its centre, filled triangle by triangle.
  const covered = new Uint8Array(w * h);
  for (let i = 0; i < triangles; i++) {
    const o = i * 6;
    const i0 = Math.max(
      Math.ceil(
        ((Math.min(tri[o], tri[o + 2], tri[o + 4]) - minX) / width) * w - 0.5,
      ),
      0,
    );
    const i1 = Math.min(
      Math.floor(
        ((Math.max(tri[o], tri[o + 2], tri[o + 4]) - minX) / width) * w - 0.5,
      ),
      w - 1,
    );
    const j0 = Math.max(
      Math.ceil(
        ((Math.min(tri[o + 1], tri[o + 3], tri[o + 5]) - minZ) / length) * h -
          0.5,
      ),
      0,
    );
    const j1 = Math.min(
      Math.floor(
        ((Math.max(tri[o + 1], tri[o + 3], tri[o + 5]) - minZ) / length) * h -
          0.5,
      ),
      h - 1,
    );
    for (let j = j0; j <= j1; j++) {
      const z = minZ + ((j + 0.5) / h) * length;
      for (let k = i0; k <= i1; k++)
        if (!covered[j * w + k] && inside(i, minX + ((k + 0.5) / w) * width, z))
          covered[j * w + k] = 1;
    }
  }

  // The outline: the triangles' edges that only one of them has, and that have water on
  // one side only (an edge split on one side and not the other, inside, is no outline).
  const span = width + length;
  const keyOf = (x: number, z: number) =>
    `${Math.round(((x - minX) / span) * 1e7)},${Math.round(((z - minZ) / span) * 1e7)}`;
  const edgeCount = new Map<string, number[]>();
  for (let i = 0; i < triangles; i++) {
    const o = i * 6;
    for (let e = 0; e < 3; e++) {
      const ax = tri[o + e * 2];
      const az = tri[o + e * 2 + 1];
      const bx = tri[o + ((e + 1) % 3) * 2];
      const bz = tri[o + ((e + 1) % 3) * 2 + 1];
      const ka = keyOf(ax, az);
      const kb = keyOf(bx, bz);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const seen = edgeCount.get(key);
      if (seen) seen[4]++;
      else edgeCount.set(key, [ax, az, bx, bz, 1]);
    }
  }
  const edges: number[] = [];
  const nudge = span * 1e-5;
  for (const [ax, az, bx, bz, n] of edgeCount.values()) {
    if (n !== 1) continue;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const ox = (-(bz - az) / l) * nudge;
    const oz = ((bx - ax) / l) * nudge;
    if (contains(mx + ox, mz + oz) !== contains(mx - ox, mz - oz))
      edges.push(ax, az, bx, bz);
  }

  // The distance to the outline from each cell's centre: exact by the edges near it, then
  // carried out over the grid by the nearest points of the cells about each (dead reckoning,
  // a pass each way).
  const distance = new Float32Array(w * h).fill(Infinity);
  const nearX = new Float32Array(w * h);
  const nearZ = new Float32Array(w * h);
  const centreX = (k: number) => minX + ((k + 0.5) / w) * width;
  const centreZ = (j: number) => minZ + ((j + 0.5) / h) * length;
  for (let e = 0; e < edges.length; e += 4) {
    const ax = edges[e];
    const az = edges[e + 1];
    const bx = edges[e + 2];
    const bz = edges[e + 3];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const k0 = Math.max(
      Math.floor(((Math.min(ax, bx) - minX) / width) * w - 1.5),
      0,
    );
    const k1 = Math.min(
      Math.ceil(((Math.max(ax, bx) - minX) / width) * w + 0.5),
      w - 1,
    );
    const j0 = Math.max(
      Math.floor(((Math.min(az, bz) - minZ) / length) * h - 1.5),
      0,
    );
    const j1 = Math.min(
      Math.ceil(((Math.max(az, bz) - minZ) / length) * h + 0.5),
      h - 1,
    );
    for (let j = j0; j <= j1; j++) {
      const z = centreZ(j);
      for (let k = k0; k <= k1; k++) {
        const x = centreX(k);
        const t = Math.min(
          Math.max(((x - ax) * dx + (z - az) * dz) / l2, 0),
          1,
        );
        const px = ax + t * dx;
        const pz = az + t * dz;
        const d = Math.hypot(x - px, z - pz);
        const c = j * w + k;
        if (d < distance[c]) {
          distance[c] = d;
          nearX[c] = px;
          nearZ[c] = pz;
        }
      }
    }
  }
  const carry = (c: number, from: number, x: number, z: number) => {
    if (distance[from] === Infinity) return;
    const d = Math.hypot(x - nearX[from], z - nearZ[from]);
    if (d < distance[c]) {
      distance[c] = d;
      nearX[c] = nearX[from];
      nearZ[c] = nearZ[from];
    }
  };
  // Twice: a nearest point carried the long way round reaches what one round misses.
  for (let round = 0; round < 2; round++) {
    for (let j = 0; j < h; j++) {
      const z = centreZ(j);
      for (let k = 0; k < w; k++) {
        const x = centreX(k);
        const c = j * w + k;
        if (k > 0) carry(c, c - 1, x, z);
        if (j > 0) {
          carry(c, c - w, x, z);
          if (k > 0) carry(c, c - w - 1, x, z);
          if (k < w - 1) carry(c, c - w + 1, x, z);
        }
      }
    }
    for (let j = h - 1; j >= 0; j--) {
      const z = centreZ(j);
      for (let k = w - 1; k >= 0; k--) {
        const x = centreX(k);
        const c = j * w + k;
        if (k < w - 1) carry(c, c + 1, x, z);
        if (j < h - 1) {
          carry(c, c + w, x, z);
          if (k < w - 1) carry(c, c + w + 1, x, z);
          if (k > 0) carry(c, c + w - 1, x, z);
        }
      }
    }
  }
  const field = new Uint16Array(w * h);
  for (let c = 0; c < w * h; c++) {
    const d = Number.isFinite(distance[c]) ? distance[c] : span;
    field[c] = DataUtils.toHalfFloat(covered[c] ? d : -d);
  }
  const texture = new DataTexture(field, w, h, RedFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { box, contains, texture, toUv, cell };
}
