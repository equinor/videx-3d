import { BufferGeometry } from 'three';
import { createIndexedGeometry } from './geometry-attributes';

/**
 * Flag the invalid samples of a row-major grid that are connected (4-neighbour)
 * to the grid border, returning a mask where `1` marks a border-connected
 * ("external") invalid sample. Invalid samples fully enclosed by valid data
 * (internal holes) are left as `0`, so the caller can distinguish the outer rim
 * of a footprint from holes punched inside it (e.g. to fill the latter while
 * keeping the former as the true outline).
 *
 * @param values row-major grid of length `nx * ny`
 * @param nx number of columns
 * @param ny number of rows
 * @param isInvalid predicate marking a sample value as missing/hole
 *
 * @group Geometries
 */
export function floodFillExternalHoles(
  values: ArrayLike<number>,
  nx: number,
  ny: number,
  isInvalid: (v: number) => boolean,
): Uint8Array {
  const external = new Uint8Array(nx * ny);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (!external[i] && isInvalid(values[i])) {
      external[i] = 1;
      stack.push(i);
    }
  };
  for (let c = 0; c < nx; c++) {
    visit(c); // top row
    visit((ny - 1) * nx + c); // bottom row
  }
  for (let r = 0; r < ny; r++) {
    visit(r * nx); // left column
    visit(r * nx + nx - 1); // right column
  }
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % nx;
    const r = (i - c) / nx;
    if (c > 0) visit(i - 1);
    if (c < nx - 1) visit(i + 1);
    if (r > 0) visit(i - nx);
    if (r < ny - 1) visit(i + nx);
  }
  return external;
}

/**
 * Bilinear sample of a row-major grid that ignores hole/invalid samples: only
 * the valid corners contribute (re-normalised by their weights). Sampling on or
 * just outside a footprint outline therefore returns the true edge value instead
 * of blending in a far-away `fallback`. When all four corners are invalid the
 * nearest valid sample (within a small search radius) is used, falling back to
 * `fallback` only if none is found nearby.
 *
 * @param fx fractional column coordinate (`worldX / cellW`)
 * @param fz fractional row coordinate (`worldZ / cellH`)
 *
 * @group Geometries
 */
export function sampleValidGrid(
  values: ArrayLike<number>,
  nx: number,
  ny: number,
  fx: number,
  fz: number,
  isInvalid: (v: number) => boolean,
  fallback: number,
): number {
  const x = Math.min(Math.max(fx, 0), nx - 1);
  const z = Math.min(Math.max(fz, 0), ny - 1);
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, nx - 1);
  const z1 = Math.min(z0 + 1, ny - 1);
  const tx = x - x0;
  const tz = z - z0;
  let sum = 0;
  let wsum = 0;
  const add = (c: number, r: number, w: number) => {
    const v = values[r * nx + c];
    if (!isInvalid(v)) {
      sum += v * w;
      wsum += w;
    }
  };
  add(x0, z0, (1 - tx) * (1 - tz));
  add(x1, z0, tx * (1 - tz));
  add(x0, z1, (1 - tx) * tz);
  add(x1, z1, tx * tz);
  if (wsum > 0) return sum / wsum;

  // All corners are holes: spiral out to the nearest valid sample.
  const cx = Math.min(Math.max(Math.round(x), 0), nx - 1);
  const cz = Math.min(Math.max(Math.round(z), 0), ny - 1);
  const maxR = 8;
  for (let r = 1; r <= maxR; r++) {
    let best = NaN;
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
        const c = cx + dx;
        const rr = cz + dz;
        if (c < 0 || rr < 0 || c >= nx || rr >= ny) continue;
        const v = values[rr * nx + c];
        if (isInvalid(v)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
    }
    if (!Number.isNaN(best)) return best;
  }
  return fallback;
}

/**
 * Build a flat plane at `y = 0` covering the cells of a regular grid for which a
 * `present` predicate holds at all four corners, so the plane follows the
 * outline of an arbitrary (possibly holed) footprint rather than a plain
 * rectangle. Unused grid vertices are dropped (compacted) so the result can be
 * cheaply subdivided afterwards. UVs span `[0, 1]` across the full grid extent.
 *
 * @param nx number of columns of grid vertices
 * @param ny number of rows of grid vertices
 * @param cellW column spacing in world units
 * @param cellH row spacing in world units
 * @param present `(c, r) => boolean`, whether the grid vertex at column `c`,
 *   row `r` lies inside the footprint
 * @param originX world X of column 0 (default 0)
 * @param originZ world Z of row 0 (default 0)
 *
 * @group Geometries
 */
export function buildMaskedGridPlane(
  nx: number,
  ny: number,
  cellW: number,
  cellH: number,
  present: (c: number, r: number) => boolean,
  originX = 0,
  originZ = 0,
): BufferGeometry {
  const quad = (c: number, r: number) =>
    present(c, r) &&
    present(c + 1, r) &&
    present(c, r + 1) &&
    present(c + 1, r + 1);
  const W = (nx - 1) * cellW || 1;
  const L = (ny - 1) * cellH || 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const remap = new Int32Array(nx * ny).fill(-1);
  const vertexOf = (c: number, r: number) => {
    const gi = r * nx + c;
    let vi = remap[gi];
    if (vi === -1) {
      vi = positions.length / 3;
      remap[gi] = vi;
      positions.push(originX + c * cellW, 0, originZ + r * cellH);
      normals.push(0, 1, 0);
      uvs.push((c * cellW) / W, (r * cellH) / L);
    }
    return vi;
  };
  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      if (!quad(c, r)) continue;
      const a = vertexOf(c, r);
      const b = vertexOf(c + 1, r);
      const cc = vertexOf(c, r + 1);
      const d = vertexOf(c + 1, r + 1);
      indices.push(a, cc, b, b, cc, d); // CCW => normal +Y
    }
  }
  return createIndexedGeometry(positions, normals, uvs, indices, null);
}
