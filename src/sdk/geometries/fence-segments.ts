import { Vec2 } from '../types/common';
// Type only: the runtime dependency runs the other way, and a value import here
// would close the cycle.
import type { FenceField } from './wellbore-fence';

/**
 * An exact lookup for "which side of the fence is this point on", in a form both
 * the CPU and a fragment shader can read.
 *
 * ⭐⭐ WHY THIS EXISTS. A rasterised signed distance cannot reproduce a polyline.
 * Bilinear interpolation is exact for distance to a straight LINE — which is why a
 * straight fence cuts straight — but at every vertex the true field has a crease,
 * and the interpolant rounds it off. The cut face is swept from the exact polyline
 * while the block is removed at the interpolant's zero set, so the two are different
 * curves: measured on the demo data they differ by up to 0.6 of a cell, which is
 * metres, and reads as gaps and a wavy edge along the seam.
 *
 * ⭐ The fix is to stop reconstructing the curve and just carry it. Segments are
 * bucketed into a coarse grid, duplicated into each bucket that could need them, so
 * a fragment reads ONE cell record and then evaluates exact point-segment distance
 * against a handful of segments. The boundary is then the polyline itself, to float
 * precision — the same polyline the face is swept from.
 *
 * ⚠️ Only the BOUNDARY is exact here. Far from the curve the sign comes from the
 * field's flood fill, which is the only thing that knows the global topology; see
 * {@link FenceSegmentIndex.reach} for why that hand-over is safe.
 *
 * @module
 */

/** Index cells per field cell. */
const CELL_SCALE = 2;

/**
 * Cells a segment is written into, beyond the ones it passes through.
 *
 * ⚠️ Must be enough that every segment within {@link FenceSegmentIndex.reach} of a
 * cell is listed in it. A cell is one `reach` wide, so a segment that close is at
 * most one cell away — two is comfortable.
 */
const DILATION = 2;

/** Safety cap on one cell's list, and on the shader's loop. */
export const FENCE_MAX_SEGMENTS = 48;

/** Segments bucketed so a point can find every one that could be nearest. */
export type FenceSegmentIndex = {
  /** per cell, 4 floats: offset, count, unused, unused */
  cells: Float32Array;
  nx: number;
  ny: number;
  origin: Vec2;
  /**
   * Metres per cell, and also the distance within which the lookup is EXACT.
   *
   * ⭐ The two are the same number on purpose. A cell lists every segment within
   * `reach` of the cell's box, and a point inside that box is at least as close to
   * any segment as the box is — so a point finds every segment within `reach` of
   * ITSELF. Beyond that the point is further than a cell from the curve, its nearest
   * field node is closer than that again, and the flood-fill sign at that node is
   * therefore the point's own side.
   */
  reach: number;
  /** per entry, 4 floats: x0, z0, x1, z1 */
  segments: Float32Array;
  /** texture layout of `segments` */
  width: number;
  height: number;
  /** longest list any cell ended up with */
  maxCount: number;
  /** lists that had to be truncated at {@link FENCE_MAX_SEGMENTS} */
  truncated: number;
};

/** Every index cell a segment must appear in: the ones it crosses, dilated. */
function markCells(
  a: Vec2,
  b: Vec2,
  origin: Vec2,
  cell: number,
  nx: number,
  ny: number,
  visit: (index: number) => void,
) {
  // ⚠⚠ FLOOR, matching how a lookup finds its cell. Rasterising with `round` puts
  // every segment half a cell away from where it will be searched for.
  let c = Math.floor((a[0] - origin[0]) / cell);
  let r = Math.floor((a[1] - origin[1]) / cell);
  const tc = Math.floor((b[0] - origin[0]) / cell);
  const tr = Math.floor((b[1] - origin[1]) / cell);
  const dc = Math.abs(tc - c);
  const dr = -Math.abs(tr - r);
  const sc = c < tc ? 1 : -1;
  const sr = r < tr ? 1 : -1;
  let err = dc + dr;
  const seen = new Set<number>();
  for (;;) {
    for (let jr = -DILATION; jr <= DILATION; jr++) {
      for (let jc = -DILATION; jc <= DILATION; jc++) {
        const cc = c + jc;
        const rr = r + jr;
        if (cc < 0 || cc >= nx || rr < 0 || rr >= ny) continue;
        const key = rr * nx + cc;
        if (seen.has(key)) continue;
        seen.add(key);
        visit(key);
      }
    }
    if (c === tc && r === tr) break;
    const e2 = 2 * err;
    if (e2 >= dr) {
      err += dr;
      c += sc;
    }
    if (e2 <= dc) {
      err += dc;
      r += sr;
    }
  }
}

/**
 * Bucket a fence curve's segments so any point can be classified exactly.
 *
 * ⚠️ Segments are DUPLICATED into every cell that lists them, rather than stored
 * once behind an index list. It costs a few hundred kilobytes on a field-sized
 * curve and saves a texture unit and an indirection per fragment — chunk materials
 * already bind contact map arrays and a bathymetry map, so samplers are the scarcer
 * resource.
 *
 * @param curve the finished fence curve, in scene XZ
 * @param field the coarse field, which supplies the grid and the far-field sign
 *
 * @group Geometries
 */
export function buildFenceSegmentIndex(
  curve: Vec2[],
  field: FenceField,
): FenceSegmentIndex {
  const reach = field.cell * CELL_SCALE;
  const spanX = field.nx * field.cell;
  const spanZ = field.ny * field.cell;
  const nx = Math.max(1, Math.ceil(spanX / reach) + 1);
  const ny = Math.max(1, Math.ceil(spanZ / reach) + 1);
  const origin: Vec2 = [field.origin[0], field.origin[1]];

  const counts = new Uint32Array(nx * ny + 1);
  for (let i = 1; i < curve.length; i++) {
    markCells(curve[i - 1], curve[i], origin, reach, nx, ny, key => {
      counts[key + 1]++;
    });
  }
  let maxCount = 0;
  let truncated = 0;
  for (let i = 0; i < nx * ny; i++) {
    if (counts[i + 1] > maxCount) maxCount = counts[i + 1];
    if (counts[i + 1] > FENCE_MAX_SEGMENTS) {
      truncated++;
      counts[i + 1] = FENCE_MAX_SEGMENTS;
    }
  }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];

  const total = counts[nx * ny];
  const cursor = counts.slice();
  const limit = counts.slice();
  const segments = new Float32Array(Math.max(total, 1) * 4);
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    markCells(a, b, origin, reach, nx, ny, key => {
      const at = cursor[key];
      if (at >= limit[key + 1]) return;
      cursor[key] = at + 1;
      segments[at * 4] = a[0];
      segments[at * 4 + 1] = a[1];
      segments[at * 4 + 2] = b[0];
      segments[at * 4 + 3] = b[1];
    });
  }

  const cells = new Float32Array(nx * ny * 4);
  for (let i = 0; i < nx * ny; i++) {
    cells[i * 4] = counts[i];
    cells[i * 4 + 1] = cursor[i] - counts[i];
  }

  const width = Math.min(2048, Math.max(1, total));
  const height = Math.max(1, Math.ceil(total / width));
  const padded = new Float32Array(width * height * 4);
  padded.set(segments.subarray(0, Math.min(segments.length, padded.length)));

  return {
    cells,
    nx,
    ny,
    origin,
    reach,
    segments: padded,
    width,
    height,
    maxCount,
    truncated,
  };
}

/**
 * Signed distance to the fence, EXACT near the curve.
 *
 * ⭐⭐ POSITION comes from the segments, SIDE comes from the flood fill. The boundary
 * is where the distance is zero, so it is the polyline to float precision; but which
 * half a point is in is a question about the whole curve, and only the fill knows the
 * answer.
 *
 * ⚠️⚠️ Taking the side from the nearest segment's cross product instead is wrong
 * wherever the curve comes back on itself. The two arms of a hairpin are oppositely
 * oriented, so inside the pocket the local answer contradicts the topology — and the
 * pocket is near the curve, so the local answer would win. Measured on the demo data
 * that put a sliver of block on the wrong side along every tight hairpin and every
 * sharp trace-to-run-out corner.
 *
 * ⚠️ Must match `fenceSide` in `fence-field.glsl`.
 *
 * @returns metres, negative on the half being removed
 *
 * @group Geometries
 */
export function fenceSideAt(
  index: FenceSegmentIndex,
  field: FenceField,
  x: number,
  z: number,
): number {
  const coarse = (px: number, pz: number) => {
    const fc = Math.min(
      Math.max(Math.round((px - field.origin[0]) / field.cell), 0),
      field.nx - 1,
    );
    const fr = Math.min(
      Math.max(Math.round((pz - field.origin[1]) / field.cell), 0),
      field.ny - 1,
    );
    return field.values[fr * field.nx + fc];
  };

  const c = Math.floor((x - index.origin[0]) / index.reach);
  const r = Math.floor((z - index.origin[1]) / index.reach);
  if (c < 0 || c >= index.nx || r < 0 || r >= index.ny) return coarse(x, z);

  const at = (r * index.nx + c) * 4;
  const offset = index.cells[at];
  const count = index.cells[at + 1];
  if (count === 0) return coarse(x, z);

  let best = Infinity;
  let bestCross = 0;
  for (let i = 0; i < count; i++) {
    const s = (offset + i) * 4;
    const ax = index.segments[s];
    const az = index.segments[s + 1];
    const ex = index.segments[s + 2] - ax;
    const ez = index.segments[s + 3] - az;
    const len2 = ex * ex + ez * ez;
    let t = 0;
    if (len2 > 0) {
      t = ((x - ax) * ex + (z - az) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const qx = ax + ex * t;
    const qz = az + ez * t;
    const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
    if (d2 < best) {
      best = d2;
      bestCross = ex * (z - az) - ez * (x - ax);
    }
  }

  const distance = Math.sqrt(best);
  // Past `reach` the nearest segment may not be listed, and the point is further
  // than a cell from the curve anyway, so the fill is both safe and right.
  if (distance > index.reach) return coarse(x, z);

  // ⭐ The nearest segment's own side. Inside a hairpin pocket both arms give the
  // SAME answer — they are oppositely oriented, so "left of" one is "left of" the
  // other — which is why the local rule is safe here and reading the fill a couple
  // of cells away is not: that step can land past the opposite arm.
  return bestCross >= 0 === field.removedCross > 0 ? -distance : distance;
}
