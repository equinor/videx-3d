import { Vec2 } from '../types/common';
import {
  distanceToSegment2D,
  nearestOnPolyline,
  PolylineHit,
} from '../utils/polyline-2d';
import type { FenceSideName } from '../utils/one-sided-offset';
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

/**
 * How far the EXACT lookup must reach, as a multiple of the field cell.
 *
 * ⚠️⚠️ This is the hand-over radius, NOT the cell size — the two used to be one number and
 * that is what made the index unaffordable. A point further than one field cell from the curve
 * is nearer to a field node than to the curve, so the flood-fill sign there is its own side;
 * inside that distance only the exact lookup can answer, so every cell within it must be
 * populated. Lowering this breaks the hand-over and leaves a band where NEITHER structure is
 * reliable.
 */
const BAND_SCALE = 1;

/**
 * Fine cells across the exactness band — the resolution knob.
 *
 * ⭐ Occupancy per cell falls linearly with the cell size (MEASURED: max 855 → 398 → 166 → 80
 * → 39 as the cell halves), while the number of populated cells only DOUBLES, because the
 * curve is one-dimensional. That asymmetry is the whole reason this is a sparse index.
 */
const BAND_CELLS = 4;

/** Fine cells per side of an allocated tile. */
const FENCE_TILE = 16;

/**
 * Safety cap on one cell's list, and on the shader's loop.
 *
 * ⚠️⚠️ DUPLICATED in `shaderLib/fence-field.glsl`, which cannot import it. They MUST agree —
 * `tests/fence-segments.test.ts` fails if they drift. They were 48 here and 32 there, so every
 * cell holding 33–48 segments had its tail silently ignored by the shader, in exactly the
 * crowded cells where the exact lookup is the whole point, and `truncated` never counted them.
 *
 * ⭐ This IS the shader's per-fragment loop count, so it is a PERFORMANCE number as much as a
 * safety one — raise it only alongside whatever keeps the lists short. 48 was not enough once
 * the cut carried its full construction density (worst list 191); the cut is now thinned by
 * deviation before it gets here, which brings the worst to 54, and 64 clears that with headroom.
 */
export const FENCE_MAX_SEGMENTS = 64;

/**
 * The magnitude a fence field node outside `WellboreFenceOptions.mask` holds: KEPT, and read as such
 * without the exact segment test. Its SIGN is still the node's half, which {@link fenceHalfAt}
 * reads. ⚠️ Must equal `FENCE_MASKED` in `fence-field.glsl`; well inside GLSL ES's guaranteed
 * highp range (±2^62), and far beyond any distance a field holds.
 */
export const FENCE_MASKED = 1e9;

/**
 * Segments bucketed so a point can find every one that could be nearest.
 *
 * ⭐⭐ TWO LEVELS, because a fence is a CURVE in a PLANE. A dense grid fine enough to keep the
 * lists short is 96–99.8% empty (measured), and its cost grows with the field's AREA while the
 * data in it grows only with the hole's LENGTH — 168 MB per side at the resolution needed here,
 * and gigabytes on a production field. A page table over tiles allocated only where the curve
 * passes costs about a megabyte and scales with hole length instead.
 */
export type FenceSegmentIndex = {
  /**
   * The page table followed by the allocated tiles, packed into one RG texture.
   *
   * Page record: `r` = tile index, or −1 where no tile is allocated.
   * Cell record: `r` = offset into {@link FenceSegmentIndex.segments}, `g` = count.
   */
  cells: Float32Array;
  /** cells texture, in texels */
  cellsWidth: number;
  cellsHeight: number;
  /** page grid, in pages */
  pnx: number;
  pny: number;
  /** fine cells per side of a tile */
  tile: number;
  /** records before the first tile — where the page table ends */
  pageCount: number;
  origin: Vec2;
  /**
   * Metres per FINE cell.
   *
   * ⚠️ NOT the exactness radius any more — see {@link BAND_SCALE}. A cell lists every segment
   * within the BAND of it, so a point finds every segment that could be nearest to it; beyond
   * the band the flood-fill sign takes over.
   */
  reach: number;
  /**
   * Metres within which the lookup is EXACT — every cell this close to the curve is populated,
   * so a point inside it finds every segment that could be nearest to it. Beyond it the point
   * is further from the curve than from a field node, and the flood-fill sign there is its own.
   */
  band: number;

  /** per entry, 4 floats: x0, z0, x1, z1 */
  segments: Float32Array;
  /** texture layout of `segments` */
  width: number;
  height: number;
  /** longest list any cell ended up with */
  maxCount: number;
  /** lists that had to be truncated at {@link FENCE_MAX_SEGMENTS} — harmless unless `flips` > 0 */
  truncated: number;
  /**
   * Truncated cells where the capped list puts some point on the other SIDE than the full list —
   * the only thing the shader reads. Sampled on a {@link FLIP_SAMPLES}² grid per truncated cell.
   */
  flips: number;
};

/** Samples per side of a truncated cell when checking it for a side flip. */
const FLIP_SAMPLES = 8;

/** Every index cell a segment must appear in: the ones it crosses, dilated. */
function markCells(
  a: Vec2,
  b: Vec2,
  origin: Vec2,
  cell: number,
  nx: number,
  ny: number,
  dilation: number,
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
    for (let jr = -dilation; jr <= dilation; jr++) {
      for (let jc = -dilation; jc <= dilation; jc++) {
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
  const band = field.cell * BAND_SCALE;
  const reach = band / BAND_CELLS;
  const dilation = Math.max(1, Math.ceil(band / reach));
  const spanX = field.nx * field.cell;
  const spanZ = field.ny * field.cell;
  const nx = Math.max(1, Math.ceil(spanX / reach) + 1);
  const ny = Math.max(1, Math.ceil(spanZ / reach) + 1);
  const origin: Vec2 = [field.origin[0], field.origin[1]];

  // ⚠️ SPARSE from the start. A dense array over the fine grid is 10 M entries on this field
  // and grows with the field's AREA — the very cost this index exists to avoid.
  const buckets = new Map<number, number[]>();
  for (let i = 1; i < curve.length; i++) {
    markCells(curve[i - 1], curve[i], origin, reach, nx, ny, dilation, key => {
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    });
  }

  // ⭐⭐ DOMINANCE PRUNE. A cell used to keep every segment within `reach` of its box, but
  // what a lookup needs is only the segments that could be NEAREST to some point in the cell,
  // and those are far fewer.
  //
  // The bound is exact, not a heuristic. Distance to the curve is 1-Lipschitz, so for any
  // point `p` in a cell whose centre is `c`, `d(p) <= d(c) + half` and `d(p, S) >= d(c, S) -
  // half` with `half` the cell's half-diagonal. A segment can therefore only win somewhere in
  // the cell if `d(c, S) <= d(c) + 2 * half`.
  const half = reach * Math.SQRT1_2;
  const kept = new Map<number, number[]>();
  let maxCount = 0;
  let truncated = 0;
  let flips = 0;
  let total = 0;
  for (const [key, bucket] of buckets) {
    const cx = origin[0] + ((key % nx) + 0.5) * reach;
    const cz = origin[1] + (Math.floor(key / nx) + 0.5) * reach;
    let nearest = Infinity;
    const scored = bucket.map(i => {
      const d = distanceToSegment2D([cx, cz], curve[i - 1], curve[i]);
      if (d < nearest) nearest = d;
      return { i, d };
    });
    const limit = nearest + 2 * half;
    // ⚠️ Sorted by distance so that a cell which STILL overflows keeps the nearest segments.
    // Truncating in insertion order could drop the very segment that wins — measured as ~40%
    // of well vertices reading on the WRONG SIDE, and four sides inverted outright.
    const survivors = scored
      .filter(s => s.d <= limit)
      .sort((a, b) => a.d - b.d);
    if (survivors.length > maxCount) maxCount = survivors.length;
    if (survivors.length > FENCE_MAX_SEGMENTS) {
      truncated++;
      // ⭐ The cap only costs distance precision unless a dropped segment flips a point's SIDE, which
      // is all the shader reads (F-1 at margin 0.1: 11 cells truncated, 0 flips, |d| off by ≤ 7 mm).
      const x0 = origin[0] + (key % nx) * reach;
      const z0 = origin[1] + Math.floor(key / nx) * reach;
      const sideOf = (p: Vec2, list: typeof survivors) => {
        let best = Infinity;
        let cross = 0;
        for (const s of list) {
          const a = curve[s.i - 1];
          const b = curve[s.i];
          const d = distanceToSegment2D(p, a, b);
          if (d < best) {
            best = d;
            cross =
              (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          }
        }
        return { d: best, side: cross >= 0 };
      };
      const capped = survivors.slice(0, FENCE_MAX_SEGMENTS);
      let flipped = false;
      for (let i = 0; i < FLIP_SAMPLES && !flipped; i++) {
        for (let j = 0; j < FLIP_SAMPLES && !flipped; j++) {
          const p: Vec2 = [
            x0 + ((i + 0.5) / FLIP_SAMPLES) * reach,
            z0 + ((j + 0.5) / FLIP_SAMPLES) * reach,
          ];
          const full = sideOf(p, survivors);
          // past the band the shader reads the fill, not this list
          if (full.d > band) continue;
          flipped = sideOf(p, capped).side !== full.side;
        }
      }
      if (flipped) flips++;
      survivors.length = FENCE_MAX_SEGMENTS;
    }
    total += survivors.length;
    kept.set(
      key,
      survivors.map(s => s.i),
    );
  }

  // ⭐ TILE ALLOCATION. Only pages the curve actually reaches get storage; the rest are one
  // −1 in the page table.
  const tile = FENCE_TILE;
  const pnx = Math.max(1, Math.ceil(nx / tile));
  const pny = Math.max(1, Math.ceil(ny / tile));
  const pageCount = pnx * pny;
  const pageOf = new Map<number, number>();
  for (const key of kept.keys()) {
    const page =
      Math.floor(Math.floor(key / nx) / tile) * pnx +
      Math.floor((key % nx) / tile);
    if (!pageOf.has(page)) pageOf.set(page, pageOf.size);
  }

  const records = pageCount + pageOf.size * tile * tile;
  const cellsWidth = Math.min(2048, Math.max(1, records));
  const cellsHeight = Math.max(1, Math.ceil(records / cellsWidth));
  const cells = new Float32Array(cellsWidth * cellsHeight * 2);
  for (let p = 0; p < pageCount; p++) cells[p * 2] = -1;
  for (const [page, at] of pageOf) cells[page * 2] = at;

  const segments = new Float32Array(Math.max(total, 1) * 4);
  let cursor = 0;
  for (const [key, list] of kept) {
    const cellRow = Math.floor(key / nx);
    const cellColumn = key % nx;
    const page =
      Math.floor(cellRow / tile) * pnx + Math.floor(cellColumn / tile);
    const at =
      pageCount +
      pageOf.get(page)! * tile * tile +
      (cellRow % tile) * tile +
      (cellColumn % tile);
    cells[at * 2] = cursor;
    cells[at * 2 + 1] = list.length;
    for (const i of list) {
      const a = curve[i - 1];
      const b = curve[i];
      segments[cursor * 4] = a[0];
      segments[cursor * 4 + 1] = a[1];
      segments[cursor * 4 + 2] = b[0];
      segments[cursor * 4 + 3] = b[1];
      cursor++;
    }
  }

  const width = Math.min(2048, Math.max(1, total));
  const height = Math.max(1, Math.ceil(total / width));
  const padded = new Float32Array(width * height * 4);
  padded.set(segments.subarray(0, Math.min(segments.length, padded.length)));

  return {
    cells,
    cellsWidth,
    cellsHeight,
    pnx,
    pny,
    tile,
    pageCount,
    origin,
    reach,
    band,
    segments: padded,
    width,
    height,
    maxCount,
    truncated,
    flips,
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
  const coarse = (px: number, pz: number) => fieldNodeAt(field, px, pz);

  // ⚠️ A masked node is kept outright: near an arm the segment test below would cut it.
  const far = coarse(x, z);
  if (Math.abs(far) >= FENCE_MASKED) return FENCE_MASKED;

  const c = Math.floor((x - index.origin[0]) / index.reach);
  const r = Math.floor((z - index.origin[1]) / index.reach);
  const pc = Math.floor(c / index.tile);
  const pr = Math.floor(r / index.tile);
  if (pc < 0 || pc >= index.pnx || pr < 0 || pr >= index.pny) {
    return coarse(x, z);
  }
  const tile = index.cells[(pr * index.pnx + pc) * 2];
  if (tile < 0) return coarse(x, z);

  const at =
    index.pageCount +
    tile * index.tile * index.tile +
    (r - pr * index.tile) * index.tile +
    (c - pc * index.tile);
  const offset = index.cells[at * 2];
  const count = index.cells[at * 2 + 1];
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
  // Past the BAND the nearest segment may not be listed, and the point is further from the
  // curve than from a field node anyway, so the fill is both safe and right.
  if (distance > index.band) return coarse(x, z);

  // ⭐ The nearest segment's own side. Inside a hairpin pocket both arms give the
  // SAME answer — they are oppositely oriented, so "left of" one is "left of" the
  // other — which is why the local rule is safe here and reading the fill a couple
  // of cells away is not: that step can land past the opposite arm.
  return bestCross >= 0 === field.removedCross > 0 ? -distance : distance;
}

/** The field node nearest a point, clamped to the grid. */
function fieldNodeAt(field: FenceField, x: number, z: number): number {
  const fc = Math.min(
    Math.max(Math.round((x - field.origin[0]) / field.cell), 0),
    field.nx - 1,
  );
  const fr = Math.min(
    Math.max(Math.round((z - field.origin[1]) / field.cell), 0),
    field.ny - 1,
  );
  return field.values[fr * field.nx + fc];
}

/**
 * As {@link fenceSideAt}, but ignoring a mask: which HALF of the cut a point is in, wherever it is.
 * A masked point returns ±{@link FENCE_MASKED}.
 *
 * ⭐ For choosing a view, not for cutting. The camera can look at a masked fence's face from
 * anywhere in the half it removes, including from over ground the mask leaves whole.
 *
 * @returns negative in the half being removed
 *
 * @group Geometries
 */
export function fenceHalfAt(
  index: FenceSegmentIndex,
  field: FenceField,
  x: number,
  z: number,
): number {
  const far = fieldNodeAt(field, x, z);
  return Math.abs(far) >= FENCE_MASKED ? far : fenceSideAt(index, field, x, z);
}

/** Reused per query — this runs every frame while a fence is on `auto`. */
const autoHit: PolylineHit = { point: [0, 0], distance: 0, along: 0 };

/**
 * Which half a fence should take away so that a point — normally the camera —
 * stands in the OPEN half.
 *
 * ⭐ The cut face is only visible from the half that was removed; from the other
 * one the block itself is in the way. So "which side" is not a preference, it is a
 * function of where you are looking from, and this is that function.
 *
 * ⭐⭐ ONE query answers both sides. The LEFT side's field partitions the whole plan, so a
 * point is either in the half it removes or in the half it keeps — there is no third answer
 * to ask the right side for.
 *
 * ⚠️⚠️ THE SIGN COMES FROM THE FIELD, THE DISTANCE FROM THE CURVE. It is tempting
 * to deadband `fenceSideAt`'s own return value, but that magnitude SATURATES a few
 * cells out at a constant (`12 * field.cell`) — and the cell size is chosen per
 * build to fit a node budget, so the constant differs per well. A deadband compared
 * against it is therefore either always or never satisfied: measured 212.9 m on the
 * demo data, so a 250 m deadband silently froze the side forever.
 *
 * @param current the side in force, held while the point is inside the deadband
 * @param index the LEFT side's segment index
 * @param field the LEFT side's field
 * @param curve the LEFT side's curve, which the deadband is measured from
 * @param deadband metres the point must clear the cut by before the side changes.
 *   Anti-flicker only — it just stops a jitter across the cut toggling the block.
 *
 * @group Geometries
 */
export function fenceAutoSide(
  current: FenceSideName,
  index: FenceSegmentIndex,
  field: FenceField,
  curve: Vec2[],
  x: number,
  z: number,
  deadband = 0,
): FenceSideName {
  const at = fenceHalfAt(index, field, x, z);
  const wants: FenceSideName = at < 0 ? 'left' : 'right';
  // Agreeing costs one field lookup; only a disagreement pays for the curve.
  if (wants === current || deadband <= 0) return wants;
  const near = nearestOnPolyline(curve, x, z, autoHit);
  return !near || near.distance > deadband ? wants : current;
}
