import { Vec2 } from '../types/common';
import { segmentConvexNearest } from './margin-zone';
import { PolylineIndex } from './polyline-2d';
import type { StiffRod } from './stiff-rod';

/**
 * The stiff rod settled as a CONSTRAINED MINIMUM — the contacts are the constraints the rod
 * actually presses on, and nothing else.
 *
 * ⭐ The energy is `tension·Σ|Δp|² + bending·Σ|Δ²p|²` with both clamps fixed (position AND tangent),
 * over a FIXED set of vertices at the seed spacing: nothing is inserted, so no contact can make a
 * short chord. Every chord is kept `margin` from every convex piece near it — each obstacle hull
 * and each segment of the reliable well — by the line that separates them: both chord ends on its
 * far side, `margin` out. A chord past that line cannot come nearer than `margin` to the piece
 * anywhere along it, so this is the chord's clearance, exactly, with no ring to lift and no
 * sagitta.
 *
 * ⭐ The lines are re-read from the rod after every solve (sequential convex programming): each
 * round is a quadratic programme with one half-plane per vertex constraint, solved EXACTLY by a
 * dual active set, so a constraint is held only while its multiplier is positive — only where
 * the rod presses. Each line lies in free space (the margin set of a convex piece is convex), and
 * pieces are gathered out to the round's trust radius, so every round is feasible and the rod
 * never jumps across an obstacle: the seed's flank is kept by construction.
 *
 * MEASURED against the pin-and-release settle it replaced, full census (43 wells × 15 margins):
 * 7 → 0 builds throwing, worst turn 293 better / 5 worse by 1–1.3°, core time 40 → 34 s; on 104
 * rods, 223 → 128 contacts and worst rod turn 180° → 25°.
 *
 * @module
 */

/** {@link settleRodConstrained} options. */
export type ConstrainedRodOptions = {
  /** convex hulls the rod keeps `margin` from — every obstacle near it, its own included */
  obstacles: Vec2[][];
  /** the reliable well pieces the rod keeps `margin` from */
  keepOut: PolylineIndex[];
  /**
   * The hand of every keep-out segment the rod lies on: `hand · leftNormal2D` of the segment's own
   * direction. A chord crossing a segment is pushed to that side; without it, to the side of the
   * chord's end further off the line.
   */
  hand?: 1 | -1;
  /** clearance, in metres */
  margin: number;
  /**
   * bending weight against a unit tension, per vertex second difference. For a bending length λ
   * (metres) at vertex spacing `h`, `(λ / h)²` — that keeps λ a physical length whatever the atom.
   *
   * ⚠️ The energy is the uniform `Σ|Δ²p|²`, which assumes roughly equal chords — the remesh keeps
   * them at the seed spacing. Two spacing-aware forms were MEASURED and rejected (on the settle
   * this replaced): weighting by `(h/ℓ)³` (dense stretches turned rigid and the kink moved to the
   * first long chord) and the nonuniform curvature stencil `∫κ² ds` with per-round coefficients
   * (the frozen coefficients never came to rest).
   */
  bending: number;
  /** feasibility slack, in metres. Default 1e-6. */
  tolerance?: number;
  /** round cap. Default 200. */
  maxRounds?: number;
  /** diagnostics: one line per round */
  trace?: (line: string) => void;
};

/** `n · x[v] ≥ c`, from chord `key`'s line against one piece, touching the rod at `touch` */
type Constraint = { v: number; n: Vec2; c: number; key: string; touch: Vec2 };

const TENSION = 1;

/** Remeshes allowed per settle — the length settles, so a few suffice and more would cycle. */
const MAX_REMESH = 4;

/**
 * The rod's free-vertex system, for one vertex count: the pentadiagonal Hessian (the same for
 * both coordinates), its banded Cholesky factor, and the unconstrained rest position.
 */
function freeSystem(x: Vec2[], bending: number) {
  const n = x.length;
  const F = n - 4;
  const coef = (d: number) =>
    d === 0
      ? 2 * TENSION + 6 * bending
      : d === 1
        ? -(TENSION + 4 * bending)
        : d === 2
          ? bending
          : 0;
  // L stored by row: L[i*3 + (i - j)] for j = i-2..i
  const L = new Float64Array(F * 3);
  const at = (i: number, j: number) => L[i * 3 + (i - j)];
  for (let i = 0; i < F; i++) {
    for (let j = Math.max(0, i - 2); j <= i; j++) {
      let s = coef(i - j);
      for (let k = Math.max(0, i - 2); k < j; k++) s -= at(i, k) * at(j, k);
      L[i * 3 + (i - j)] =
        i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / at(j, j);
    }
  }
  const solve = (b: Float64Array): Float64Array => {
    const y = new Float64Array(F);
    for (let i = 0; i < F; i++) {
      let s = b[i];
      for (let k = Math.max(0, i - 2); k < i; k++) s -= at(i, k) * y[k];
      y[i] = s / at(i, i);
    }
    const out = new Float64Array(F);
    for (let i = F - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k <= Math.min(F - 1, i + 2); k++)
        s -= at(k, i) * out[k];
      out[i] = s / at(i, i);
    }
    return out;
  };
  // the clamps enter the free rows as constants
  const rest: Vec2[] = [];
  const gx = new Float64Array(F);
  const gz = new Float64Array(F);
  for (let r = 0; r < F; r++) {
    const i = r + 2;
    for (let d = -2; d <= 2; d++) {
      const k = i + d;
      if (k < 2 || k > n - 3) {
        gx[r] -= coef(Math.abs(d)) * x[k][0];
        gz[r] -= coef(Math.abs(d)) * x[k][1];
      }
    }
  }
  const ux = solve(gx);
  const uz = solve(gz);
  for (let r = 0; r < F; r++) rest.push([ux[r], uz[r]]);
  const columns = new Map<number, Float64Array>();
  /** column `r` of the inverse Hessian */
  const column = (r: number): Float64Array => {
    let c = columns.get(r);
    if (!c) {
      const e = new Float64Array(F);
      e[r] = 1;
      c = solve(e);
      columns.set(r, c);
    }
    return c;
  };
  return { F, rest, column };
}

/** Solve the dense `k × k` system `S λ = rhs` in place (partial pivoting); `S` is row-major. */
function solveDense(
  S: Float64Array,
  rhs: Float64Array,
  k: number,
): Float64Array {
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++)
      if (Math.abs(S[r * k + c]) > Math.abs(S[p * k + c])) p = r;
    if (p !== c) {
      for (let j = 0; j < k; j++) {
        const t = S[c * k + j];
        S[c * k + j] = S[p * k + j];
        S[p * k + j] = t;
      }
      const t = rhs[c];
      rhs[c] = rhs[p];
      rhs[p] = t;
    }
    const piv = S[c * k + c];
    if (Math.abs(piv) < 1e-300) continue;
    for (let r = c + 1; r < k; r++) {
      const f = S[r * k + c] / piv;
      if (f === 0) continue;
      for (let j = c; j < k; j++) S[r * k + j] -= f * S[c * k + j];
      rhs[r] -= f * rhs[c];
    }
  }
  const out = new Float64Array(k);
  for (let r = k - 1; r >= 0; r--) {
    let s = rhs[r];
    for (let j = r + 1; j < k; j++) s -= S[r * k + j] * out[j];
    const piv = S[r * k + r];
    out[r] = Math.abs(piv) < 1e-300 ? 0 : s / piv;
  }
  return out;
}

/**
 * The quadratic programme of one round: the rest position of the free vertices subject to `cons`,
 * by the DUAL active set of Goldfarb & Idnani. It starts from the free rod and adds only the most
 * violated constraint at a time, so its work follows the contacts, not the constraint count —
 * a primal active set walked from the seed took 1258 iterations over 1588 constraints (F-11 A).
 * Returns the free vertices' positions and the constraints held (positive multipliers).
 */
function solveRound(
  cons: Constraint[],
  sys: ReturnType<typeof freeSystem>,
  tol: number,
): { target: Vec2[]; active: number[]; iterations: number } {
  const { F, rest, column } = sys;
  const u: Vec2[] = rest.map(p => [p[0], p[1]] as Vec2);
  const W: number[] = [];
  const held = new Uint8Array(cons.length);
  const lambda: number[] = [];
  const skipped = new Uint8Array(cons.length);
  const slackOf = (j: number) => {
    const c = cons[j];
    const p = u[c.v - 2];
    return c.n[0] * p[0] + c.n[1] * p[1] - c.c;
  };
  /** aᵢᵀ H⁻¹ aⱼ for two single-vertex constraints */
  const cross = (i: number, j: number) => {
    const a = cons[i];
    const b = cons[j];
    return (a.n[0] * b.n[0] + a.n[1] * b.n[1]) * column(b.v - 2)[a.v - 2];
  };
  const cap = 10 * F + 100;
  let it = 0;
  // the constraint being brought in, and its multiplier so far
  let p = -1;
  let lp = 0;
  for (; it < cap; it++) {
    if (p < 0) {
      let worst = -tol;
      for (let j = 0; j < cons.length; j++) {
        if (skipped[j] || held[j]) continue;
        const s = slackOf(j);
        if (s < worst) {
          worst = s;
          p = j;
        }
      }
      if (p < 0) break;
      lp = 0;
    }
    // r = S_W⁻¹ A_W H⁻¹ a_p: how the held multipliers must move to keep their constraints tight
    const k = W.length;
    let r: Float64Array = new Float64Array(0);
    if (k > 0) {
      const S = new Float64Array(k * k);
      const rhs = new Float64Array(k);
      let scale = 0;
      for (let a = 0; a < k; a++) {
        rhs[a] = cross(W[a], p);
        for (let b = 0; b < k; b++) S[a * k + b] = cross(W[a], W[b]);
        scale = Math.max(scale, Math.abs(S[a * k + a]));
      }
      for (let a = 0; a < k; a++) S[a * k + a] += 1e-12 * scale;
      r = solveDense(S, rhs, k);
    }
    // z = H⁻¹ a_p − Σ r_j H⁻¹ a_j, the primal step per unit of λ_p
    const z: Vec2[] = [];
    const cp = cons[p];
    const colP = column(cp.v - 2);
    for (let q = 0; q < F; q++) z.push([colP[q] * cp.n[0], colP[q] * cp.n[1]]);
    for (let a = 0; a < k; a++) {
      const cj = cons[W[a]];
      const col = column(cj.v - 2);
      for (let q = 0; q < F; q++) {
        const w = col[q] * r[a];
        z[q][0] -= w * cj.n[0];
        z[q][1] -= w * cj.n[1];
      }
    }
    const zp = cp.n[0] * z[cp.v - 2][0] + cp.n[1] * z[cp.v - 2][1];
    const full = zp > 1e-14 ? -slackOf(p) / zp : Infinity;
    let partial = Infinity;
    let leave = -1;
    for (let a = 0; a < k; a++) {
      if (r[a] <= 1e-14) continue;
      const t = lambda[a] / r[a];
      if (t < partial) {
        partial = t;
        leave = a;
      }
    }
    const t = Math.min(full, partial);
    if (!Number.isFinite(t)) {
      // dependent on the held set and never reachable — the held set already implies it
      skipped[p] = 1;
      p = -1;
      continue;
    }
    if (Number.isFinite(full)) {
      for (let q = 0; q < F; q++) {
        u[q][0] += t * z[q][0];
        u[q][1] += t * z[q][1];
      }
    }
    for (let a = 0; a < k; a++) lambda[a] -= t * r[a];
    lp += t;
    if (full <= partial) {
      W.push(p);
      held[p] = 1;
      lambda.push(lp);
      p = -1;
    } else {
      // a held multiplier reached zero: let that constraint go and keep raising λ_p
      held[W[leave]] = 0;
      W.splice(leave, 1);
      lambda.splice(leave, 1);
    }
  }
  const active: number[] = [];
  for (let a = 0; a < W.length; a++) if (lambda[a] > tol) active.push(W[a]);
  return { target: u, active, iterations: it };
}

/**
 * Settle a clamped rod to rest outside every convex piece near it — see the module header.
 *
 * `seed` gives the clamps (its first two and last two vertices), the spacing and the starting
 * shape, which must lie on the right flank of every obstacle; its interior is re-solved.
 *
 * @group Utils
 */
export function settleRodConstrained(
  seed: Vec2[],
  opts: ConstrainedRodOptions,
): StiffRod {
  let x = seed.map(p => [p[0], p[1]] as Vec2);
  if (x.length < 5)
    return { points: x, contacts: [], rounds: 0, converged: true };
  const tol = opts.tolerance ?? 1e-6;
  const margin = opts.margin;
  const bending = Math.max(0, opts.bending);
  const hulls = opts.obstacles.filter(h => h.length >= 1);
  let h0 = 0;
  for (let i = 1; i < x.length; i++)
    h0 += Math.hypot(x[i][0] - x[i - 1][0], x[i][1] - x[i - 1][1]);
  h0 /= x.length - 1;
  // ⭐ The trust radius doubles while steps keep reaching it: F-15 D's rod travelled ~230 m from its
  // seed at a fixed half spacing, 71 rounds. Pieces are gathered out to it, so every step is safe.
  let trust = 0.5 * h0;
  const maxTrust = 8 * h0;
  let reach = margin + trust;
  const centroid = hulls.map(h => {
    let cx = 0;
    let cz = 0;
    for (const p of h) {
      cx += p[0];
      cz += p[1];
    }
    return [cx / h.length, cz / h.length] as Vec2;
  });
  const boxes = hulls.map(h => {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of h) {
      x0 = Math.min(x0, p[0]);
      z0 = Math.min(z0, p[1]);
      x1 = Math.max(x1, p[0]);
      z1 = Math.max(z1, p[1]);
    }
    return [x0, z0, x1, z1];
  });

  /** every vertex constraint of `x`: both ends of each chord beyond each nearby piece's line */
  const constraints = (): Constraint[] => {
    const out: Constraint[] = [];
    const n = x.length;
    const add = (
      i: number,
      piece: Vec2[],
      id: string,
      fallback: () => Vec2,
      near = segmentConvexNearest(x[i], x[i + 1], piece),
    ) => {
      if (near.distance > reach) return;
      const nrm = near.normal ?? fallback();
      const c = nrm[0] * near.onHull[0] + nrm[1] * near.onHull[1] + margin;
      const key = `${i}:${id}`;
      const touch = near.onSegment;
      if (i >= 2 && i <= n - 3) out.push({ v: i, n: nrm, c, key, touch });
      if (i + 1 >= 2 && i + 1 <= n - 3)
        out.push({ v: i + 1, n: nrm, c, key, touch });
    };
    for (let i = 0; i + 1 < n; i++) {
      if (i + 1 < 2 || i > n - 3) continue;
      const a = x[i];
      const b = x[i + 1];
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      hulls.forEach((h, k) => {
        const box = boxes[k];
        if (
          Math.max(a[0], b[0]) < box[0] - reach ||
          Math.min(a[0], b[0]) > box[2] + reach ||
          Math.max(a[1], b[1]) < box[1] - reach ||
          Math.min(a[1], b[1]) > box[3] + reach
        ) {
          return;
        }
        add(i, h, `h${k}`, () => {
          const dx = mid[0] - centroid[k][0];
          const dz = mid[1] - centroid[k][1];
          const l = Math.hypot(dx, dz) || 1;
          return [dx / l, dz / l];
        });
      });
      opts.keepOut.forEach((index, w) => {
        const pts = index.points;
        const near = new Map<number, ReturnType<typeof segmentConvexNearest>>();
        for (const hit of index.tree.search({
          minX: Math.min(a[0], b[0]) - reach,
          minY: Math.min(a[1], b[1]) - reach,
          maxX: Math.max(a[0], b[0]) + reach,
          maxY: Math.max(a[1], b[1]) + reach,
        })) {
          near.set(
            hit.j,
            segmentConvexNearest(a, b, [pts[hit.j - 1], pts[hit.j]]),
          );
        }
        // ⭐ Only the segments nearest the chord along each limb of the well: a straight run held
        // one near-identical line per segment, ~15 per chord along a 500 m anchor.
        for (const [j, nj] of near) {
          const prev = near.get(j - 1)?.distance ?? Infinity;
          const next = near.get(j + 1)?.distance ?? Infinity;
          if (nj.distance > prev || nj.distance > next) continue;
          const p = pts[j - 1];
          const q = pts[j];
          add(
            i,
            [p, q],
            `w${w}.${j}`,
            () => {
              // a chord ON the well: its normal, toward the chord end further off the line
              const ex = q[0] - p[0];
              const ez = q[1] - p[1];
              const l = Math.hypot(ex, ez) || 1;
              const nrm: Vec2 = [-ez / l, ex / l];
              if (opts.hand) return [opts.hand * nrm[0], opts.hand * nrm[1]];
              const sa = (a[0] - p[0]) * nrm[0] + (a[1] - p[1]) * nrm[1];
              const sb = (b[0] - p[0]) * nrm[0] + (b[1] - p[1]) * nrm[1];
              const far = Math.abs(sa) >= Math.abs(sb) ? sa : sb;
              return far >= 0 ? nrm : [-nrm[0], -nrm[1]];
            },
            nj,
          );
        }
      });
    }
    return out;
  };
  /** push each free vertex onto its constraints' side — the round must start feasible */
  const project = (cons: Constraint[]) => {
    for (let pass = 0; pass < 20; pass++) {
      let worst = 0;
      for (const c of cons) {
        const p = x[c.v];
        const s = c.c - (c.n[0] * p[0] + c.n[1] * p[1]);
        if (s <= 0) continue;
        worst = Math.max(worst, s);
        x[c.v] = [p[0] + c.n[0] * s, p[1] + c.n[1] * s];
      }
      if (worst <= tol) break;
    }
  };
  /** re-space the free vertices at the seed spacing along the current shape */
  const remesh = (): boolean => {
    const n = x.length;
    let len = 0;
    for (let i = 2; i < n - 1; i++)
      len += Math.hypot(x[i][0] - x[i - 1][0], x[i][1] - x[i - 1][1]);
    const want = Math.max(1, Math.round(len / h0) - 1);
    const free = n - 4;
    if (Math.abs(want - free) <= 1) return false;
    const arc = [0];
    for (let i = 2; i < n - 1; i++)
      arc.push(
        arc[arc.length - 1] +
          Math.hypot(x[i][0] - x[i - 1][0], x[i][1] - x[i - 1][1]),
      );
    const fresh: Vec2[] = [];
    for (let k = 1; k <= want; k++) {
      const s = (len * k) / (want + 1);
      let j = 1;
      while (j < arc.length - 1 && arc[j] < s) j++;
      const u = (s - arc[j - 1]) / (arc[j] - arc[j - 1] || 1);
      const a = x[j];
      const b = x[j + 1];
      fresh.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    x = [x[0], x[1], ...fresh, x[n - 2], x[n - 1]];
    return true;
  };

  let sys = freeSystem(x, bending);
  let remeshes = 0;
  let rounds = 0;
  let converged = false;
  let active: Constraint[] = [];
  const maxRounds = opts.maxRounds ?? 200;
  while (rounds < maxRounds) {
    rounds++;
    const t0 = opts.trace ? performance.now() : 0;
    // ⭐ The lines held last round stay in unless this round re-read the same chord and piece: each
    // is still a line in free space, and without them two linearisations took turns — F-1 C right
    // at margin 0.3 moved 0.0117 m every round, to the cap. Carried alongside their own re-reading,
    // they piled up: F-5 right at margin 20 held 335 lines on 167 vertices.
    const fresh = constraints();
    const read = new Set(fresh.map(c => `${c.key}@${c.v}`));
    const cons = [
      ...fresh,
      ...active.filter(c => !read.has(`${c.key}@${c.v}`)),
    ];
    project(cons);
    const t1 = opts.trace ? performance.now() : 0;
    const round = solveRound(cons, sys, tol);
    const t2 = opts.trace ? performance.now() : 0;
    active = round.active.map(j => cons[j]);
    let move = 0;
    for (let r = 0; r < sys.F; r++) {
      const p = x[r + 2];
      move = Math.max(
        move,
        Math.hypot(round.target[r][0] - p[0], round.target[r][1] - p[1]),
      );
    }
    const alpha = move > trust ? trust / move : 1;
    for (let r = 0; r < sys.F; r++) {
      const p = x[r + 2];
      const t = round.target[r];
      x[r + 2] = [p[0] + (t[0] - p[0]) * alpha, p[1] + (t[1] - p[1]) * alpha];
    }
    opts.trace?.(
      `round ${rounds}: ${cons.length} constraints · ${active.length} held · ${round.iterations} iterations · moved ${(move * alpha).toFixed(4)} m · trust ${trust.toFixed(2)} m · ${x.length}v · gather ${(t1 - t0).toFixed(1)} ms · solve ${(t2 - t1).toFixed(1)} ms`,
    );
    trust =
      alpha < 1
        ? Math.min(maxTrust, 2 * trust)
        : Math.max(0.5 * h0, Math.min(trust, 2 * move));
    reach = margin + trust;
    if (alpha === 1 && move <= Math.max(tol, 1e-4 * h0)) {
      if (remeshes < MAX_REMESH && remesh()) {
        remeshes++;
        sys = freeSystem(x, bending);
        // the vertices were renumbered, so the held lines no longer name them
        active = [];
        continue;
      }
      converged = true;
      break;
    }
  }
  // one contact per chord resting on a piece, where it touches
  const touches = new Map<string, Vec2>();
  for (const c of active) touches.set(c.key, c.touch);
  opts.trace?.(`contacts: ${[...touches.keys()].join(' ')}`);
  return { points: x, contacts: [...touches.values()], rounds, converged };
}
