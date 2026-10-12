import { Vec2 } from '../types/common';
import { STACK_NO_DATA } from './surface-stack-candidates';
import type { GridRing } from './triangulate-grid-delaunay';

/**
 * How far a simplified termination line may stray from the traced one, in grid
 * cells.
 *
 * @group Geometries
 */
export const TERMINATION_TOLERANCE = 0.5;

/**
 * Closed termination lines with at most this many vertices (a patch of about 2×2
 * cells or less) are dropped: two surfaces running a hair apart flicker across the
 * threshold, and a constraint around each flicker buys nothing visible.
 *
 * @group Geometries
 */
export const TERMINATION_MIN_VERTICES = 8;

/** The result of {@link traceThicknessLines}. */
export type ThicknessLines = {
  /** closed rings in reference grid `(column, row)` coordinates */
  rings: GridRing[];
  /** closed lines dropped for being at most {@link TERMINATION_MIN_VERTICES} long */
  tiny: number;
  /** lines dropped because even the unsimplified trace crosses itself */
  discarded: number;
};

/** Options for {@link traceThicknessLines}. */
export type ThicknessLineOptions = {
  /**
   * Every layer's heights over the common grid. A traced point is kept wherever
   * dropping it would put any of them more than `maxError` off along the line —
   * the line is shared by the whole stack, so all of them ride on it.
   */
  channels?: Float32Array[];
  /** height tolerance for `channels`, in world units. Default 5. */
  maxError?: number;
  /** default {@link TERMINATION_TOLERANCE} */
  tolerance?: number;
};

const THICK = 1e9;

/**
 * One pair's traced termination loops BEFORE simplification — the part of
 * {@link traceThicknessLines} that needs only the pair's own two channels, so it
 * can run on a worker. All plain typed arrays, so it transfers as is.
 */
export type ThicknessLoops = {
  /** per traced point, its reference grid position */
  xs: Float64Array;
  ys: Float64Array;
  /** per traced point, its grid edge: the two nodes (-1 off the grid) and where along it */
  na: Int32Array;
  nb: Int32Array;
  nt: Float64Array;
  /** closed loops as point indices, concatenated: loop `k` is `loops[offsets[k] .. offsets[k + 1])` */
  loops: Int32Array;
  offsets: Int32Array;
  /** closed lines dropped for being at most {@link TERMINATION_MIN_VERTICES} long */
  tiny: number;
  /** lines that did not close */
  discarded: number;
  /** the thickness threshold the loops were scanned at */
  threshold: number;
};

/**
 * Trace the lines where a pair's thickness crosses `threshold` — where the lower
 * unit wedges out — as closed rings, simplified to within
 * {@link TERMINATION_TOLERANCE} cells in plan and `maxError` in height.
 *
 * Unlike `collectThicknessCrossings`, which brackets the line with grid nodes for
 * the refinement to chase, these are meant to be CONSTRAINED: each vertex lies on
 * the line itself (linear interpolation along a cell edge), so the line costs a
 * vertex wherever it bends rather than one on either side of every cell it
 * crosses.
 *
 * The field is padded with thick nodes, so every line closes; the part running
 * along the padding lies outside the grid.
 *
 * Runs {@link scanThicknessLoops} then {@link simplifyThicknessLoops}; call those
 * separately to put the scan on a worker.
 *
 * @param above the shallower layer's heights over the common grid
 * @param below the deeper layer's heights over the same grid
 * @param nx the common grid's column count
 * @param threshold thickness at and below which the unit counts as absent
 * @param options see {@link ThicknessLineOptions}
 *
 * @group Geometries
 */
export function traceThicknessLines(
  above: Float32Array,
  below: Float32Array,
  nx: number,
  threshold: number,
  options: ThicknessLineOptions = {},
): ThicknessLines {
  return simplifyThicknessLoops(
    scanThicknessLoops(above, below, nx, threshold),
    options,
  );
}

/**
 * The scan half of {@link traceThicknessLines}: marching squares over the pair's
 * thickness, linked into closed loops, with tiny and open ones counted and
 * dropped.
 *
 * @group Geometries
 */
export function scanThicknessLoops(
  above: Float32Array,
  below: Float32Array,
  nx: number,
  threshold: number,
): ThicknessLoops {
  const ny = above.length / nx;
  const P = nx + 2;
  const Q = ny + 2;
  const value = new Float32Array(P * Q).fill(THICK);
  const thin = new Uint8Array(P * Q);
  let any = false;
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const n = r * nx + c;
      const a = above[n];
      const b = below[n];
      if (a === STACK_NO_DATA || b === STACK_NO_DATA) continue;
      const p = (r + 1) * P + c + 1;
      value[p] = a - b;
      if (a - b <= threshold) {
        thin[p] = 1;
        any = true;
      }
    }
  }
  if (!any) {
    return {
      xs: new Float64Array(0),
      ys: new Float64Array(0),
      na: new Int32Array(0),
      nb: new Int32Array(0),
      nt: new Float64Array(0),
      loops: new Int32Array(0),
      offsets: new Int32Array(1),
      tiny: 0,
      discarded: 0,
      threshold,
    };
  }

  const ids = new Map<number, number>();
  const xs: number[] = [];
  const ys: number[] = [];
  // Each point's grid edge: its two nodes (-1 off the grid) and where along it.
  const na: number[] = [];
  const nb: number[] = [];
  const nt: number[] = [];
  const segA: number[] = [];
  const segB: number[] = [];
  const node = (pc: number, pr: number) =>
    pc >= 1 && pc <= nx && pr >= 1 && pr <= ny ? (pr - 1) * nx + pc - 1 : -1;
  const point = (
    id: number,
    x: number,
    y: number,
    a: number,
    b: number,
    t: number,
  ) => {
    let at = ids.get(id);
    if (at === undefined) {
      at = xs.length;
      ids.set(id, at);
      xs.push(x);
      ys.push(y);
      na.push(a);
      nb.push(b);
      nt.push(t);
    }
    return at;
  };
  const cross = (fa: number, fb: number) => {
    const d = fb - fa;
    if (d === 0) return 0.5;
    const t = (threshold - fa) / d;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
  const vOffset = P * Q;

  for (let pr = 0; pr < Q - 1; pr++) {
    for (let pc = 0; pc < P - 1; pc++) {
      const p = pr * P + pc;
      const idx =
        thin[p] |
        (thin[p + 1] << 1) |
        (thin[p + P + 1] << 2) |
        (thin[p + P] << 3);
      if (idx === 0 || idx === 15) continue;
      const tl = value[p];
      const tr = value[p + 1];
      const br = value[p + P + 1];
      const bl = value[p + P];
      // Grid coordinates: padded index minus one.
      const T = () => {
        const t = cross(tl, tr);
        return point(p, pc - 1 + t, pr - 1, node(pc, pr), node(pc + 1, pr), t);
      };
      const B = () => {
        const t = cross(bl, br);
        return point(
          p + P,
          pc - 1 + t,
          pr,
          node(pc, pr + 1),
          node(pc + 1, pr + 1),
          t,
        );
      };
      const L = () => {
        const t = cross(tl, bl);
        return point(
          vOffset + p,
          pc - 1,
          pr - 1 + t,
          node(pc, pr),
          node(pc, pr + 1),
          t,
        );
      };
      const R = () => {
        const t = cross(tr, br);
        return point(
          vOffset + p + 1,
          pc,
          pr - 1 + t,
          node(pc + 1, pr),
          node(pc + 1, pr + 1),
          t,
        );
      };
      const seg = (a: number, b: number) => {
        segA.push(a);
        segB.push(b);
      };
      switch (idx) {
        case 1:
        case 14:
          seg(L(), T());
          break;
        case 2:
        case 13:
          seg(T(), R());
          break;
        case 3:
        case 12:
          seg(L(), R());
          break;
        case 4:
        case 11:
          seg(R(), B());
          break;
        case 6:
        case 9:
          seg(T(), B());
          break;
        case 7:
        case 8:
          seg(L(), B());
          break;
        case 5:
        case 10: {
          // Saddle: the centre decides which pair of corners is connected.
          const centreThin = (tl + tr + br + bl) / 4 <= threshold;
          if (centreThin === (idx === 5)) {
            seg(T(), R());
            seg(B(), L());
          } else {
            seg(L(), T());
            seg(R(), B());
          }
          break;
        }
      }
    }
  }

  // Every crossing sits on one grid edge, shared by at most two cells, so each
  // point has at most two segments.
  const points = xs.length;
  const adjacent = new Int32Array(2 * points).fill(-1);
  const link = (v: number, s: number) => {
    if (adjacent[2 * v] < 0) adjacent[2 * v] = s;
    else adjacent[2 * v + 1] = s;
  };
  for (let s = 0; s < segA.length; s++) {
    link(segA[s], s);
    link(segB[s], s);
  }

  const used = new Uint8Array(segA.length);
  const order: number[] = [];
  const offsets: number[] = [0];
  let tiny = 0;
  let discarded = 0;
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segA[s];
    const loop: number[] = [start];
    let cur = segB[s];
    let closed = false;
    for (;;) {
      if (cur === start) {
        closed = true;
        break;
      }
      loop.push(cur);
      const e0 = adjacent[2 * cur];
      const e1 = adjacent[2 * cur + 1];
      const next = e0 >= 0 && !used[e0] ? e0 : e1 >= 0 && !used[e1] ? e1 : -1;
      if (next < 0) break;
      used[next] = 1;
      cur = segA[next] === cur ? segB[next] : segA[next];
    }
    if (!closed) {
      discarded++;
      continue;
    }
    if (loop.length <= TERMINATION_MIN_VERTICES) {
      tiny++;
      continue;
    }
    for (const k of loop) order.push(k);
    offsets.push(order.length);
  }
  return {
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    na: Int32Array.from(na),
    nb: Int32Array.from(nb),
    nt: Float64Array.from(nt),
    loops: Int32Array.from(order),
    offsets: Int32Array.from(offsets),
    tiny,
    discarded,
    threshold,
  };
}

/**
 * The simplify half of {@link traceThicknessLines}. Needs every channel (see
 * {@link ThicknessLineOptions.channels}), which is why it is not part of the scan.
 *
 * @group Geometries
 */
export function simplifyThicknessLoops(
  traced: ThicknessLoops,
  options: ThicknessLineOptions = {},
): ThicknessLines {
  const { xs, ys, loops, offsets } = traced;
  const rings: GridRing[] = [];
  let discarded = traced.discarded;
  const simplify = makeLineSimplifier(traced, options);
  const toRing = (list: ArrayLike<number>) =>
    Array.from(list, (k): Vec2 => [xs[k], ys[k]]);
  for (let l = 0; l + 1 < offsets.length; l++) {
    const loop = Array.from(loops.subarray(offsets[l], offsets[l + 1]));
    const simplified = toRing(simplify(loop));
    if (!ringCrossesItself(simplified)) rings.push(simplified);
    else {
      const raw = toRing(loop);
      if (!ringCrossesItself(raw)) rings.push(raw);
      else discarded++;
    }
  }
  return { rings, tiny: traced.tiny, discarded };
}

/**
 * Ramer–Douglas–Peucker over a closed loop of traced points, with one more
 * reason to keep a point: any layer further than `maxError` from the straight
 * line the segment will be drawn as.
 */
function makeLineSimplifier(
  traced: ThicknessLoops,
  options: ThicknessLineOptions,
) {
  const { xs, ys, na, nb, nt } = traced;
  const tolerance = options.tolerance ?? TERMINATION_TOLERANCE;
  const maxError = options.maxError ?? 5;
  const channels = options.channels ?? [];
  const tolSq = tolerance * tolerance;
  const heightAt = (k: number, channel: Float32Array) => {
    const a = na[k] >= 0 ? channel[na[k]] : STACK_NO_DATA;
    const b = nb[k] >= 0 ? channel[nb[k]] : STACK_NO_DATA;
    if (a === STACK_NO_DATA) return b;
    if (b === STACK_NO_DATA) return a;
    return a + nt[k] * (b - a);
  };
  // Every layer's height at every point of a loop, once — RDP visits a point
  // several times. ⚠️ Filled CHANNEL by channel along the loops: consecutive
  // points read neighbouring nodes of one channel, while point by point every
  // read lands in a different channel and misses the cache.
  const C = channels.length;
  const heights = new Float64Array(C > 0 ? xs.length * C : 0);
  for (let c = 0; c < C; c++) {
    const channel = channels[c];
    for (let l = 0; l < traced.loops.length; l++) {
      const k = traced.loops[l];
      heights[k * C + c] = heightAt(k, channel);
    }
  }
  // Off by more than `maxError` anywhere strictly between seq[i] and seq[j]?
  const heightOff = (seq: number[], i: number, j: number) => {
    if (C === 0) return -1;
    const A = seq[i];
    const B = seq[j];
    const dx = xs[B] - xs[A];
    const dy = ys[B] - ys[A];
    const len = dx * dx + dy * dy;
    const a = A * C;
    const b = B * C;
    let worst = -1;
    let worstAt = -1;
    for (let k = i + 1; k < j; k++) {
      const p = seq[k];
      const s =
        len > 0
          ? Math.max(
              0,
              Math.min(1, ((xs[p] - xs[A]) * dx + (ys[p] - ys[A]) * dy) / len),
            )
          : 0;
      const o = p * C;
      for (let c = 0; c < C; c++) {
        const hA = heights[a + c];
        const e = Math.abs(hA + s * (heights[b + c] - hA) - heights[o + c]);
        if (e > worst) {
          worst = e;
          worstAt = k;
        }
      }
    }
    return worst > maxError ? worstAt : -1;
  };
  const run = (seq: number[]) => {
    const m = seq.length;
    const keep = new Uint8Array(m);
    keep[0] = 1;
    keep[m - 1] = 1;
    const stack: [number, number][] = [[0, m - 1]];
    while (stack.length > 0) {
      const [i, j] = stack.pop()!;
      if (j <= i + 1) continue;
      const A = seq[i];
      const B = seq[j];
      const dx = xs[B] - xs[A];
      const dy = ys[B] - ys[A];
      const len = dx * dx + dy * dy;
      let worst = -1;
      let worstAt = -1;
      for (let k = i + 1; k < j; k++) {
        const p = seq[k];
        const t =
          len > 0
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((xs[p] - xs[A]) * dx + (ys[p] - ys[A]) * dy) / len,
                ),
              )
            : 0;
        const ex = xs[A] + t * dx - xs[p];
        const ey = ys[A] + t * dy - ys[p];
        const d = ex * ex + ey * ey;
        if (d > worst) {
          worst = d;
          worstAt = k;
        }
      }
      // Height is checked last: by then the segment is short, so it costs little.
      const split = worst > tolSq ? worstAt : heightOff(seq, i, j);
      if (split > i && split < j) {
        keep[split] = 1;
        stack.push([i, split], [split, j]);
      }
    }
    return keep;
  };
  return (loop: number[]): number[] => {
    const n = loop.length;
    // Anchored at the point furthest from the first, so the two halves are both
    // real arcs and the result does not depend on where the loop starts.
    let far = 0;
    let farD = -1;
    for (let k = 1; k < n; k++) {
      const d =
        (xs[loop[k]] - xs[loop[0]]) ** 2 + (ys[loop[k]] - ys[loop[0]]) ** 2;
      if (d > farD) {
        farD = d;
        far = k;
      }
    }
    const head = loop.slice(0, far + 1);
    const tail = loop.slice(far).concat(loop[0]);
    const keepHead = run(head);
    const keepTail = run(tail);
    const out: number[] = [];
    for (let k = 0; k < head.length; k++) if (keepHead[k]) out.push(head[k]);
    // the tail starts on `far` (already in) and ends back on loop[0]
    for (let k = 1; k < tail.length - 1; k++)
      if (keepTail[k]) out.push(tail[k]);
    return out;
  };
}

const HASH_CELL = 4;

/**
 * Whether two non-adjacent segments of a closed ring properly cross. A ring that
 * does cannot be constrained: the triangulator does not node a ring against
 * itself, so one of the two edges would silently go unenforced.
 */
function ringCrossesItself(ring: Vec2[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  const orient = (a: Vec2, b: Vec2, c: Vec2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const crosses = (i: number, j: number) => {
    const d = Math.abs(i - j);
    if (d <= 1 || d === n - 1) return false;
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const c = ring[j];
    const e = ring[(j + 1) % n];
    return (
      orient(a, b, c) * orient(a, b, e) < 0 &&
      orient(c, e, a) * orient(c, e, b) < 0
    );
  };
  if (n <= 64) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) if (crosses(i, j)) return true;
    }
    return false;
  }
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const x0 = Math.floor(Math.min(a[0], b[0]) / HASH_CELL);
    const x1 = Math.floor(Math.max(a[0], b[0]) / HASH_CELL);
    const y0 = Math.floor(Math.min(a[1], b[1]) / HASH_CELL);
    const y1 = Math.floor(Math.max(a[1], b[1]) / HASH_CELL);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = (y + 1) * 1e6 + x + 1;
        const list = buckets.get(key);
        if (list) {
          for (const j of list) if (crosses(i, j)) return true;
          list.push(i);
        } else buckets.set(key, [i]);
      }
    }
  }
  return false;
}
