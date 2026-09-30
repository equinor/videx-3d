import { Vec2 } from '../types/common';
import {
  dedupePolyline2D,
  pointAtArcLength,
  polylineArcLengths,
} from './polyline-2d';

/**
 * The STIFF ROD — a fence transition settled as a beam rather than walked along a ring.
 *
 * ⭐ A cut that follows an obstacle ring turns every corner of it at the ring's own mitre fan, so
 * in 3D it wraps a head like a jigsaw. The rod starts from the ring PATH between the two run ends
 * — on the right flank by construction — extends it by an anchored stretch of each run, clamps both
 * anchors (position AND tangent), and settles the span to the least-bending path that holds the
 * margin from every hull and the well (`stiff-rod-constrained.ts`). It touches them only where it
 * presses and leaves the runs far back at a shallow angle. This file lays the seed and its anchors.
 *
 * ⭐ The anchor is ANALYTIC, never searched: `max(3, c · φ/θ) · atom` of run, where φ is the turn
 * from the run's heading onto the ring path's first atom and θ the per-vertex turn limit — the
 * atoms a rod turning θ per vertex needs to make that turn, times a multiple `c` by the clamp's
 * convexity. MEASURED (1440 clamps × 11 anchor lengths, wedge/sliver 100×20 and 100×8 at well
 * turns 0/45/90°, margins 0.5/2/8, each clamp swept with the other held far back): the shortest
 * anchor that builds is `0.55–0.9 · φ/θ` atoms in every φ bin above 20°, for both convexities,
 * and no other quantity recorded (offset, distance ahead, path length, margin) separates the
 * buckets once φ is known; below 20° it is still 1.5–2 atoms. The floor is 3: at 2, 19 A at margin
 * 0.5 ran away (both clamps on it), and it built at every joint length from 3. The margin
 * enters through the zone — the run end, the path and the atom move with it. A searched
 * setback flipped between neighbouring margins.
 *
 * ⭐ TWO multiples, by the clamp's CONVEXITY. A rod on the OUTSIDE of the well's turn wraps the
 * hull — its first bend off the run, towards the path, is AGAINST the well's own turn between the
 * two runs (or the well runs straight through and both rods wrap). That clamp is CONVEX, and a
 * longer anchor is FREE: measured over the same sweep, its worst turn keeps falling (16° at 3×
 * the minimum, 7° at 4×, 1° at 32 atoms) while the rod's greatest distance from the well stays
 * flat (67 → 51 m). The rod on the INSIDE of the turn bends WITH it, away from the hull, and is
 * CONCAVE: its turn plateaus at ~7° beyond 4× the minimum while that distance BALLOONS
 * (19 → 35 → 70 → 158 m at 1/6/12/32 atoms) — out round the hull and back is an S, and a
 * long anchor only stretches it. Departure and arrival clamps measured alike (34/20/15/12/7/6°
 * at 1/1.5/2/3/4/6× the minimum on both).
 *
 * ⭐ A REVERSAL FLOOR on both clamps: `2 · max(0, Ψ − 90°)/θ` atoms, Ψ the well's turn between
 * the two runs. Past 90° the rod must turn the excess whatever φ says, and φ alone left it too
 * short (F-12 at margin 3.1 below 560 m: 56°, failed). MEASURED over the field census (780 rods):
 * 0 failures either way, p99 worst turn 34 → 26°, rods over 30° 16 → 3, 45 better / 4 worse;
 * F-12 builds at 11°. ⛔ Not c by convexity (4/2): fewer bad turns, but convex rods hugged
 * (X07 right: 2 → 9 contacts).
 * ⛔ Not `W / tan θ` with W the WHOLE ring's offset from the run's line: topology-blind — it
 * charged the sliver's far tips, which the rod never passes (corner sliver at 40°: 29 and 24 m
 * for a flank 14–17 m off), and F-11 B left's far west end 251 m AHEAD of the exit (122 m → a
 * 295 m anchor along a run 0.1 m off the well). ⛔ Nor a fillet `R·tan(φ/2)` floored at one
 * atom (census 26 → 16/26). ⛔ Nor a tangent from the clamp over the path held to an attack
 * angle α: at 3° it was over 4× the measured minimum on 99% of clamps, at 11.25° still >4× on
 * half and too short on 36 — the offset it is built on is not what sets the anchor.
 */

/** What placed one clamp — for drawing and diagnosis. */
export type StiffRodTurn = {
  /** the run's clipped end on the ring */
  runEnd: Vec2;
  /** the run's unit heading INTO the ring */
  runDir: Vec2;
  /** the path's unit heading over its first atom out of the run end */
  flankDir: Vec2;
  /** the turn between them, radians */
  phi: number;
  /** whether the rod wraps the hull on the outside of the well's turn (first bend against it) */
  convex: boolean;
  /** the multiple applied, and the anchor in atoms before the floor */
  multiple: number;
  atoms: number;
};

/** The anchor scale of {@link seedStiffRod} — see the file header. */
export type StiffRodAnchor = {
  /** a global multiple on the measured anchor lengths; 1 = as measured */
  scale: number;
  /** diagnostics: force the anchor LENGTH (metres) of clamp A / clamp B */
  byEnd?: [number | undefined, number | undefined];
  /** diagnostics (candidate): two concave clamps at ONE height along the runs' bisector, the concave rule at the mean φ beyond the farther run end */
  balanced?: boolean;
};

/**
 * Atoms of run per atom of turn (`φ/θ`), by convexity — the measured optimum, not a knob: convex
 * 4× the minimum that builds (turn 7°, no excursion cost), concave 2× (turn 12°, before the
 * excursion balloons). See the file header.
 */
const ANCHOR_MULTIPLE = { convex: 4, concave: 2 } as const;
/** the least anchor that builds, in atoms, whatever the turn */
const ANCHOR_FLOOR = 3;
/** atoms per atom of the well's reversal past 90°, on BOTH clamps — see the file header */
const REVERSAL_MULTIPLE = 2;

/** What {@link seedStiffRod} lays out for the settle. */
export type StiffRodSeed = {
  /** the anchored span, resampled uniformly — its first two and last two vertices are the clamps */
  seed: Vec2[];
  /** the seed's vertex spacing, in metres — the atom, halved where the atom's chords crossed the well */
  spacing: number;
  /** metres of run included before the seam and after it */
  anchor: [number, number];
  /** the turn each anchor is set by */
  turn: [StiffRodTurn, StiffRodTurn];
  /** vertices of the source curve kept BEFORE the seed: `curve.slice(0, head)` */
  head: number;
  /** where the source curve resumes AFTER the seed: `curve.slice(tail)` */
  tail: number;
};

const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];

/** The unit heading of `curve` at vertex `i`, read from the segment on `side` (−1 before, +1 after). */
const headingAt = (curve: Vec2[], i: number, side: -1 | 1): Vec2 | null => {
  const j = i + side;
  const a = side < 0 ? curve[j] : curve[i];
  const b = side < 0 ? curve[i] : curve[j];
  if (!a || !b) return null;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return l > 1e-9 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
};

/**
 * Lay out the span a stiff rod is settled over: the seam `curve[seamStart..seamEnd]` plus, before
 * and after it, `max(3, c · φ/θ, 2 · (Ψ − 90°)/θ)` atoms of run (see the file header),
 * resampled at `atom`.
 *
 * ⭐ φ is read off the SEAM — the ring path, the way round the rod takes — over its first atom out
 * of each run end (`flanks`, read off the ring, when the seam is shorter), against the run's
 * heading over its SECOND atom from the seam (its first when the run is shorter than two). The path moves
 * continuously with the margin; the hugging seam of the old construction did not — its departure
 * vertex and its fillet/walk branch jump — and anchors read off it made the whole rod snap between
 * neighbouring margins. The anchor is measured from the run's CLIPPED end `E`/`S` (where it met
 * the ring), for the same reason.
 *
 * When a run is shorter than its anchor the span runs on STRAIGHT past the curve's end, along the
 * curve's own heading over its last atom there, so the clamp sits where the rule puts it rather
 * than up against the ring. The settled rod ships WHOLE, past the curve's end: an arm attached
 * off that end starts beyond it (see `buildFenceArms`), and an open end is outside the block.
 *
 * @param curve the assembled curve the seam sits in
 * @param seamStart index of the seam's first vertex (on run A)
 * @param seamEnd index of the seam's last vertex (on run B)
 * @param atom the rod's vertex spacing, in metres
 * @param theta the per-vertex turn limit, in radians
 * @param anchor the global anchor scale (and diagnostics overrides)
 * @param ends the clipped run ends `[E, S]` the seam was built between
 * @param clear whether a chord holds the margin from the reliable well — seed chords that do not
 * are split at the run's own points until they do
 * @param flanks the path's unit heading out of `E` / back from `S` over its first atom, for a seam
 * shorter than one atom (whose own chord shows none); `null` reads the seam
 * @param spacing the spacing the resample starts at — the atom, or finer for a rod re-laid because
 * it over-turned; never below a quarter atom
 *
 * @group Utils
 */
export function seedStiffRod(
  curve: Vec2[],
  seamStart: number,
  seamEnd: number,
  atom: number,
  theta: number,
  anchor: StiffRodAnchor,
  ends: [Vec2, Vec2],
  clear: (a: Vec2, b: Vec2) => boolean,
  flanks?: [Vec2 | null, Vec2 | null],
  spacing: number = atom,
): StiffRodSeed {
  if (seamEnd <= seamStart || seamEnd >= curve.length) {
    throw new Error(
      'seedStiffRod: the seam must span at least two curve vertices',
    );
  }
  const arc = polylineArcLengths(curve);
  const total = arc[curve.length - 1];
  const P0 = curve[seamStart];
  const P1 = curve[seamEnd];
  // the run's heading over the atom ending at `at`; a seam that starts (ends) the curve reads its
  // own end
  const headingOver = (at: number, back: number): Vec2 | null => {
    const a = pointAtArcLength(curve, arc, at - back);
    const b = pointAtArcLength(curve, arc, at);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return l > 1e-9 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
  };
  // ⛔ not the first atom off the seam: at small margins it can hold a short bend — 19 A left read
  // 20–69° off its straight run at margins 0.25–0.5, and clamp B swung 19 → 8 → 22 m
  const runA = arc[seamStart];
  const runB = total - arc[seamEnd];
  const dirA =
    (runA >= 2 * atom ? headingOver(runA - atom, atom) : null) ??
    (runA > 1e-9 ? headingOver(runA, atom) : null) ??
    headingAt(curve, seamStart, 1);
  const dirB =
    (runB >= 2 * atom ? headingOver(arc[seamEnd] + 2 * atom, atom) : null) ??
    (runB > 1e-9
      ? headingOver(Math.min(total, arc[seamEnd] + atom), atom)
      : null) ??
    headingAt(curve, seamEnd, -1);
  if (!dirA || !dirB) {
    throw new Error('seedStiffRod: the seam has no heading at one of its ends');
  }
  const [E, S] = ends;
  // the well's own turn between the runs, signed; a run reversed (clamp B's view) turns the other way
  const wellTurn = Math.atan2(
    cross(dirA, dirB),
    dirA[0] * dirB[0] + dirA[1] * dirB[1],
  );
  // the flank: the seam's heading over its first atom out of each run end (the whole seam when
  // it is shorter), so an entry-gap wobble at the very first vertex does not set the turn
  const flankOver = (from: number, to: number): Vec2 | null => {
    const a = pointAtArcLength(curve, arc, from);
    const b = pointAtArcLength(curve, arc, to);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return l > 1e-9 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
  };
  const reach = Math.min(atom, arc[seamEnd] - arc[seamStart]);
  /**
   * One clamp: the run heading `dir` INTO the ring at `origin`, the path leaving along `flank`,
   * and the well's turn `turn` as seen travelling in `dir`.
   */
  const turnAt = (
    origin: Vec2,
    dir: Vec2,
    flank: Vec2,
    turn: number,
  ): StiffRodTurn => {
    // the rod's hand: the side of the run's line the path LEAVES on. ⛔ Not the sum over the seam's
    // vertices — that is a centroid test, and with the hull straddling the run's line it flipped
    // between hull angles 7.5° and 10° (wedge 100×25), halving clamp B's multiple: 174 → 95 m.
    const sign = cross(dir, flank) >= 0 ? 1 : -1;
    const convex = sign * turn <= 1e-6;
    const phi = Math.acos(
      Math.max(-1, Math.min(1, dir[0] * flank[0] + dir[1] * flank[1])),
    );
    const c =
      anchor.scale *
      (convex ? ANCHOR_MULTIPLE.convex : ANCHOR_MULTIPLE.concave);
    return {
      runEnd: origin,
      runDir: dir,
      flankDir: flank,
      phi,
      convex,
      multiple: c,
      atoms: (c * phi) / theta,
    };
  };
  const turnA = turnAt(
    E,
    dirA,
    flanks?.[0] ?? flankOver(arc[seamStart], arc[seamStart] + reach) ?? dirA,
    wellTurn,
  );
  // run B's heading is OUT of the seam: read heading back into it
  const flankB = flanks?.[1] ??
    flankOver(arc[seamEnd], arc[seamEnd] - reach) ?? [-dirB[0], -dirB[1]];
  const turnB = turnAt(S, [-dirB[0], -dirB[1]], flankB, -wellTurn);
  const reversal =
    (REVERSAL_MULTIPLE *
      anchor.scale *
      Math.max(0, Math.abs(wellTurn) - Math.PI / 2)) /
    theta;
  let anchorA =
    anchor.byEnd?.[0] ?? Math.max(ANCHOR_FLOOR, turnA.atoms, reversal) * atom;
  let anchorB =
    anchor.byEnd?.[1] ?? Math.max(ANCHOR_FLOOR, turnB.atoms, reversal) * atom;
  if (anchor.balanced && !anchor.byEnd && !turnA.convex && !turnB.convex) {
    // u: the bisector of the two runs' arms, both pointing back out of the ring
    const ux = dirB[0] - dirA[0];
    const uz = dirB[1] - dirA[1];
    const ul = Math.hypot(ux, uz);
    const cosArm = ul > 1e-3 ? (-dirA[0] * ux - dirA[1] * uz) / ul : 0;
    // ⚠ unmeasured cutoff: near-opposite arms barely separate in height
    if (cosArm >= 0.2) {
      const meanPhi = (turnA.phi + turnB.phi) / 2;
      const L =
        Math.max(
          ANCHOR_FLOOR,
          (anchor.scale * ANCHOR_MULTIPLE.concave * meanPhi) / theta,
        ) * atom;
      const hE = (E[0] * ux + E[1] * uz) / ul;
      const hS = (S[0] * ux + S[1] * uz) / ul;
      const top = Math.max(hE, hS) + L * cosArm;
      anchorA = (top - hE) / cosArm;
      anchorB = (top - hS) / cosArm;
    }
  }
  const from =
    arc[seamStart] + Math.hypot(E[0] - P0[0], E[1] - P0[1]) - anchorA;
  const to = arc[seamEnd] - Math.hypot(S[0] - P1[0], S[1] - P1[1]) + anchorB;
  // ⭐ A run shorter than its anchor is continued straight past the curve's end, never clamped
  // there: a clamp held on the run's last vertices pinned the rod against the ring (F-11 A cropped:
  // 8.3 atoms short, 47° over 8 contacts).
  // ⛔ Only where that continuation holds the margin: a 1 m stub's heading over an atom reaches into
  // the ring path, and on F-15 left at margins 1–2 it ran straight across the wellhead.
  const outward = (atStart: boolean, length: number): Vec2 | null => {
    const end = atStart ? curve[0] : curve[curve.length - 1];
    const inner = pointAtArcLength(
      curve,
      arc,
      atStart ? Math.min(total, atom) : Math.max(0, total - atom),
    );
    const dx = end[0] - inner[0];
    const dz = end[1] - inner[1];
    const l = Math.hypot(dx, dz);
    if (!(l > 1e-9)) return null;
    const far: Vec2 = [end[0] + (dx / l) * length, end[1] + (dz / l) * length];
    return clear(end, far) ? far : null;
  };
  const farA = from < 0 ? outward(true, -from) : null;
  const farB = to > total ? outward(false, to - total) : null;
  const lead: Vec2[] = farA ? [farA] : [];
  const trail: Vec2[] = farB ? [farB] : [];
  const on = Math.max(0, from);
  const off = Math.min(total, to);
  // the last vertex at or before each end of the span
  let lo = 0;
  while (lo + 1 < curve.length && arc[lo + 1] <= on) lo++;
  let hi = 0;
  while (hi + 1 < curve.length && arc[hi + 1] <= off) hi++;
  const span = dedupePolyline2D(
    [
      ...lead,
      pointAtArcLength(curve, arc, on),
      ...curve.slice(lo + 1, hi + 1),
      pointAtArcLength(curve, arc, off),
      ...trail,
    ],
    1e-9,
  );
  const { points: seed, spacing: laid } = resampleClear(
    span,
    Math.max(spacing, atom / 4),
    atom / 4,
    clear,
  );
  return {
    seed,
    spacing: laid,
    anchor: [anchorA, anchorB],
    turn: [turnA, turnB],
    head: farA ? 0 : lo + 1,
    tail: farB ? curve.length : hi + 1,
  };
}

/** chord phases a seed spacing is tested at — see {@link resampleClear} */
const RESAMPLE_PHASES = 8;

/**
 * Resample `span` uniformly at `spacing`, halving the spacing (whole span, so it stays uniform)
 * until every chord is `clear` — never below `floor`.
 *
 * ⛔ A plain resample at the atom (37–59 m on a big head) laid straight chords along a follow that
 * holds 0.5 m off a bending well: the very first clamp chord crossed the well twice on F-15 D and
 * F-11 B. Splitting only the offending chords instead gave an irregular density the uniform
 * bending energy then read as shape (census 21/23/23 against 23/25/24). Three halvings built
 * one more well at margin 0.5 and cost 8× the vertices — 7.6 s on F-11 A.
 * ⛔ Judged on the laid chords alone, the halving is decided by where the vertices happen to
 * fall: F-5 left flipped between the atom and half of it on every 0.05 m of margin from 0.3 to
 * 0.8 (3–5 of 8 chord phases dipped at each), and failed 47° at 0.8/0.9 where it stayed coarse.
 * Every spacing is therefore judged on its chords at {@link RESAMPLE_PHASES} phases along the span.
 */
function resampleClear(
  span: Vec2[],
  spacing: number,
  floor: number,
  clear: (a: Vec2, b: Vec2) => boolean,
): { points: Vec2[]; spacing: number } {
  const arc = polylineArcLengths(span);
  const total = arc[span.length - 1];
  let h = spacing;
  for (;;) {
    const count = Math.max(1, Math.round(total / h));
    const step = total / count;
    const points: Vec2[] = [];
    for (let k = 0; k <= count; k++) {
      points.push(pointAtArcLength(span, arc, (total * k) / count));
    }
    let ok = true;
    for (let i = 1; i < points.length && ok; i++) {
      if (!clear(points[i - 1], points[i])) ok = false;
    }
    for (let j = 1; j < RESAMPLE_PHASES && ok; j++) {
      for (
        let s = (step * j) / RESAMPLE_PHASES;
        s + step <= total && ok;
        s += step
      ) {
        if (
          !clear(
            pointAtArcLength(span, arc, s),
            pointAtArcLength(span, arc, s + step),
          )
        )
          ok = false;
      }
    }
    if (ok || h / 2 < floor * (1 - 1e-9)) return { points, spacing: h };
    h /= 2;
  }
}

/** A settled rod — see `settleRodConstrained`. */
export type StiffRod = {
  points: Vec2[];
  /** where the rod presses on a hull or the well at rest, one per chord resting on a piece */
  contacts: Vec2[];
  /** rounds spent */
  rounds: number;
  /** false when the round cap stopped it */
  converged: boolean;
};
