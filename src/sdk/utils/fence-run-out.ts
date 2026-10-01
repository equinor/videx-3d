import { Vec2 } from '../types/common';
import { convexPolygonDistance, marginCrossings } from './margin-zone';
import {
  DEFAULT_OFFSET_TOLERANCE,
  FREE_ROD_STIFFNESS,
  FenceSideName,
  TraceProblemSpan,
  TracePocketSpan,
  hullDiameter,
  isTracePocket,
  pointInConvex,
  ringAtom,
  traceProblemSpans,
  zoneRing,
} from './one-sided-offset';
import {
  PolylineIndex,
  PolylineTurn,
  convexHull2D,
  countPolylineLoops,
  createPolylineIndex,
  distanceToSegment2D,
  indexedClearance,
  indexedCrossings,
  leftNormal2D,
  meanTangent2D,
  pointAtArcLength,
  polylineArcLengths,
  polylineCrossings,
  polylineWorstTurn,
  segmentPolylineCrossingParams,
} from './polyline-2d';
import { settleRodConstrained } from './stiff-rod-constrained';

/**
 * Run-out arms for a wellbore fence — the extrapolated extensions that carry each side's cut
 * out past the field and split the whole column in two.
 *
 * ⭐⭐ The two sides SHARE the arms. Near the well the `left` and `right` cuts hug opposite
 * flanks a `margin` apart; each arm converges both of them onto ONE point and then follows the
 * IDENTICAL straight run out past the field outline, so switching the removed half swaps the
 * near-well cut but not the run-out.
 *
 * ⭐ TD is the DOMINANT end: its arm continues along the trajectory's own end bearing. The head
 * is the flexible end (built later). Both bearings are chosen AFTER the two side cores are built,
 * so the transition is grown against the real cut it has to join.
 *
 * Status: the near-vertical (plan-degenerate) branch is not built yet — a well whose whole
 * footprint fits inside one margin corridor has no core to extend, and is rejected by name.
 */

/** {@link buildFenceArms} options. */
export type FenceArmsOptions = {
  /** the well's segment index, reused when the caller already has one. */
  wellIndex?: PolylineIndex;
  /** metres each arm reaches PAST the outline's extent along its bearing. Default 500. */
  extension?: number;
  /** arc (m) each end bearing is averaged over. Default 50. */
  tangentArc?: number;
  /**
   * plan span (m) an end must cover over `tangentArc` for its OWN bearing to be trusted; below it
   * the end is treated as degenerate and falls back to `fallbackAngle`. Default 10.
   */
  degenerateSpan?: number;
  /**
   * fallback bearing when an end is plan-degenerate, in DEGREES measured like the surface-meta
   * `rot` (UTM reference, the opposite hand of WebGL). Default 0.
   */
  fallbackAngle?: number;
  /**
   * Return a defective arm (flagged on {@link FenceArms.crosses} / {@link FenceArms.selfCrosses} /
   * {@link FenceArms.steep}) instead of throwing — for the prototype view only, so a failing head
   * can be SEEN while its routing is developed. Default false.
   */
  allowDefects?: boolean;
  /**
   * The steepest RELATIVE turn any vertex of a FINISHED side may make, in radians. Default 45°.
   *
   * ⭐ Measured on the ASSEMBLED path, not on any intermediate construct — what ships is what is
   * judged. Raw, not arm-weighted: arm weighting forgives a large turn between short segments,
   * which is exactly the spike this exists to catch (a 162° reversal across 1–2 m segments).
   */
  maxRelativeTurn?: number;
  /** diagnostics sink — one entry per built arm, even when it is degraded. */
  debug?: FenceArmDebug[];
  /** the arm joins' bending length — see `OneSidedOffsetOptions.rodStiffness`. Default 1. */
  rodStiffness?: number;
  /** the planned head arm ({@link planHeadArm}); the cores must be offsets of its `trace` */
  headArm?: HeadArmPlan | null;
  /**
   * The TD end routed round the obstacle over it ({@link planTdArm}); the cores must be offsets of
   * a trace that ends on its guide. Its bearing is also the one the head arm is planned opposite.
   */
  tdPlan?: TdArmPlan | null;
  /**
   * Attach the TD run-out. Default true; false leaves the TD end bare, for a TD outside the outline
   * — the core already leaves the block there. Ignored for a degenerate plan, whose synthesized TD
   * guide the cores follow.
   */
  tdArm?: boolean;
  /**
   * The well the TD bearing is read from, ending where `well` does — `well` with the stretch run on
   * in front of its head, so a short block reads the real well rather than falling back. Default
   * `well`; the gates always judge against `well`.
   */
  bearingWell?: Vec2[];
  /**
   * Metres the head arm's turn reaches out from the head when the arm leaves more than
   * `maxRelativeTurn` off the well's heading (an L or a U): the turn is laid as one arc with a chord
   * this long, never tighter than the head ring it leaves ({@link planHeadArm}). Default {@link DEFAULT_HEAD_TURNOUT}; 0 shifts the arm
   * sideways instead, as for a gentler turn.
   */
  headTurnout?: number;
  /**
   * Which way the head arm leaves: `'opposite-td'` (default), exactly opposite the TD arm, or
   * `'free'` — THROUGH the head, from where the well enters the head frame through its hull's
   * centroid, turned only as far as it takes to stay {@link FenceArmsOptions.headMinTdAngle} off
   * the TD arm. A degenerate well keeps its hull axis.
   */
  headBearing?: 'opposite-td' | 'free';
  /**
   * the least angle between a `'free'` head arm and the TD arm, in DEGREES — off a diverted TD arm
   * ({@link planTdDiversion}) only on the side away from the diversion. Default {@link DEFAULT_HEAD_MIN_TD_ANGLE}.
   */
  headMinTdAngle?: number;
  /**
   * Metres the head axis is moved sideways along `leftNormal2D(dir)`, to widen a corridor it forms
   * with the well ({@link armPocket}); a laid turn takes it as a larger radius. Default 0.
   */
  headOffset?: number;
};

/** One built arm's construction, for the debug view. */
export type FenceArmDebug = {
  end: 'head' | 'td';
  side: FenceSideName;
  /** the outward run-out bearing (unit) */
  dir: Vec2;
  /** the shared convergence point on the arm axis */
  gather: Vec2;
  /** the shared tip, past the outline */
  tip: Vec2;
  /** the relaxed transition window actually produced (per side) */
  seam: Vec2[];
};

/** One end's shared arm geometry — read identically by both sides. */
export type FenceArmEnd = {
  /** outward run-out bearing (unit) */
  dir: Vec2;
  /** the shared convergence point on the axis */
  gather: Vec2;
  /** the shared tip, past the outline */
  tip: Vec2;
};

/** Where a finished side turns most sharply. */
export type TurnReport = PolylineTurn;

/** A pair of fence cuts extended with run-out arms. */
export type FenceArms = {
  /** the left side's cut, HEAD→TD, arms attached */
  left: Vec2[];
  /** the right side's cut, HEAD→TD, arms attached */
  right: Vec2[];
  /** how each finished side is made up, as index ranges — the seams between them ARE the joins */
  pieces: { left: CurvePiece[]; right: CurvePiece[] };
  /** the TD (dominant) end's shared arm */
  td: FenceArmEnd;
  /** the head end — a no-arm end sitting at the apex; the head arm was removed */
  head: FenceArmEnd;
  /** true when an arm still crosses the well (only possible with `allowDefects`) */
  crosses?: boolean;
  /** true when an arm still loops over ITSELF (only possible with `allowDefects`) */
  selfCrosses?: boolean;
  /** true when a finished side still turns more sharply than allowed (only with `allowDefects`) */
  steep?: boolean;
  /** true when assembly cost the core some of its clearance (only possible with `allowDefects`) */
  buries?: boolean;
  /** the worst relative turn on each finished side — the steep-angle gate's evidence, always reported */
  worstTurn: { left: TurnReport; right: TurnReport };
};

/** metres the run-out arms reach past the footprint, unless told otherwise */
export const DEFAULT_EXTENSION = 500;
const DEFAULT_TANGENT_ARC = 50;
const DEFAULT_DEGENERATE_SPAN = 10;

/**
 * How elongated a degenerate well's whole-footprint hull must be (longest axis over its width) for
 * that axis to be the fence's bearing rather than the fallback angle. Dimensionless: a 2:1 hull's
 * long axis is settled to within ~±27°, a round scatter blob (1–1.4) has no direction at all.
 */
const DEGENERATE_HULL_ASPECT = 2;

/** The steepest relative turn a finished side may make at any vertex. */
export const DEFAULT_MAX_RELATIVE_TURN = (45 * Math.PI) / 180;

/** {@link FenceArmsOptions.headTurnout}'s default, in metres. */
export const DEFAULT_HEAD_TURNOUT = 100;

/** {@link FenceArmsOptions.headMinTdAngle}'s default, in degrees. */
export const DEFAULT_HEAD_MIN_TD_ANGLE = 90;

/** Radians per vertex of a laid head turn at most — the same sampling as `biarc2D`. */
const TURN_STEP = Math.PI / 60;

/** Arc (m) over which a cut's own END direction is read, for a kink-free join. */
const EXIT_ARC = 20;

/**
 * An arm's gather distance as a multiple of its shortest taper: every plan feature of the
 * convergence is extruded up the whole fence, so a short one reads as a pencil tip and as noise.
 */
const GATHER_FACTOR = 4;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const along = (p: Vec2, d: Vec2, s: number): Vec2 => [
  p[0] + d[0] * s,
  p[1] + d[1] * s,
];
const negate = (v: Vec2): Vec2 => [-v[0], -v[1]];
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/**
 * An arc leaving `start` along `heading` and turning through `angle` (radians, positive towards
 * `[-heading[1], heading[0]]`) at `radius`, start first.
 */
function turnArc(
  start: Vec2,
  heading: Vec2,
  angle: number,
  radius: number,
  margin: number,
): Vec2[] {
  const side = Math.sign(angle) || 1;
  const centre = along(start, [-side * heading[1], side * heading[0]], radius);
  const r0 = sub(start, centre);
  // ⛔ Fine enough that the inner offset loses at most half the offset's prune slack at a vertex,
  // `margin·(1 − cos δ)`: at 3° it lost 0.013 m at margin 9.4 and the whole inner side was pruned.
  const vertexTurn = Math.min(
    TURN_STEP,
    Math.acos(1 - DEFAULT_OFFSET_TOLERANCE / (2 * margin)),
  );
  const nt = Math.max(2, Math.ceil(Math.abs(angle) / vertexTurn));
  const arc: Vec2[] = [];
  for (let k = 0; k <= nt; k++) {
    const a = (angle * k) / nt;
    const c = Math.cos(a);
    const s = Math.sin(a);
    arc.push([
      centre[0] + r0[0] * c - r0[1] * s,
      centre[1] + r0[0] * s + r0[1] * c,
    ]);
  }
  return arc;
}

/** Of the bulge a laid arc makes off its chord, the share a framed turn keeps ({@link turnTrapezoid}). */
const TURN_FRAME_DEPTH = 0.5;

/** How far a framed turn leans from its head anchor towards the arm, radians. */
const TURN_FRAME_LEAN = (15 * Math.PI) / 180;

/** The widest mouth a framed turn's hairpin may have, in turn widths (`2R`), before the well is left out. */
const HAIRPIN_MOUTH_WIDTHS = 1.5;

/**
 * The TRAPEZOID a laid U-turn is framed as: its long side from the head anchor `p` to the guide's
 * start `q`, legs at 45° and a far side {@link TURN_FRAME_DEPTH} as deep as `arc` bulged, leaning
 * {@link TURN_FRAME_LEAN} about `p` towards the arm — a rod round it runs straight where the arc's
 * D bulged towards the well beyond.
 */
function turnTrapezoid(p: Vec2, q: Vec2, arc: Vec2[]): Vec2[] {
  const base = sub(q, p);
  const length = Math.hypot(base[0], base[1]) || 1;
  const ub: Vec2 = [base[0] / length, base[1] / length];
  let n: Vec2 = [-ub[1], ub[0]];
  const bulge = arc[arc.length >> 1];
  if (dot(sub(bulge, p), n) < 0) n = negate(n);
  let sag = 0;
  for (const a of arc) sag = Math.max(sag, dot(sub(a, p), n));
  const depth = Math.min(TURN_FRAME_DEPTH * sag, length / 2);
  // lean the depth towards the base's guide end, the arm's side
  const t = (Math.sign(n[0] * ub[1] - n[1] * ub[0]) || 1) * TURN_FRAME_LEAN;
  const lean: Vec2 = [
    n[0] * Math.cos(t) - n[1] * Math.sin(t),
    n[0] * Math.sin(t) + n[1] * Math.cos(t),
  ];
  return [
    p,
    along(along(p, lean, depth), ub, depth),
    along(along(q, lean, depth), ub, -depth),
    q,
  ];
}

/** Plan spread of a polyline END over `arc` metres — how much footprint its bearing has to lean on. */
function endSpan(points: Vec2[], fromStart: boolean, arc: number): number {
  const n = points.length;
  if (n < 2) return 0;
  const apex = fromStart ? points[0] : points[n - 1];
  let minX = apex[0];
  let maxX = apex[0];
  let minZ = apex[1];
  let maxZ = apex[1];
  let acc = 0;
  for (let k = 1; k < n; k++) {
    const prev = points[fromStart ? k - 1 : n - k];
    const p = points[fromStart ? k : n - 1 - k];
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
    if (acc >= arc) break;
  }
  return Math.hypot(maxX - minX, maxZ - minZ);
}

/** Bearing at one end of the well — its own tangent, or the fallback axis when degenerate. */
function endBearing(
  well: Vec2[],
  fromStart: boolean,
  tangentArc: number,
  degenerateSpan: number,
  fallbackAngle: number,
): Vec2 {
  const span = endSpan(well, fromStart, tangentArc);
  const tangent = meanTangent2D(well, fromStart, tangentArc);
  if (span < degenerateSpan || !tangent) {
    const a = (fallbackAngle * Math.PI) / 180;
    const axis: Vec2 = [Math.cos(a), Math.sin(a)];
    // At the head the reverse of this axis is what leaves the well; TD leaves along it.
    return fromStart ? negate(axis) : axis;
  }
  // `meanTangent2D` points INTO the curve; the outward run-out leaves the other way.
  return negate(tangent);
}

/** How far past the outline the tip must sit, projected along `dir` from `apex`, plus a pad. */
function reachPastOutline(
  apex: Vec2,
  dir: Vec2,
  outline: Vec2[][],
  pad: number,
): number {
  let maxProj = 0;
  for (const ring of outline) {
    for (const p of ring) {
      const proj = dot(sub(p, apex), dir);
      if (proj > maxProj) maxProj = proj;
    }
  }
  return maxProj + pad;
}

/** The outward direction a cut leaves one of its ends — the continuation PAST that end. */
function coreEndDir(curve: Vec2[], atHead: boolean, arc: number): Vec2 {
  const t = meanTangent2D(curve, atHead, arc);
  // `meanTangent2D` points INTO the curve; the outward continuation is the other way.
  return t ? negate(t) : atHead ? [-1, 0] : [1, 0];
}

/** {@link headWrapRegion} result — the head framed as ONE convex obstacle for the router. */
export type HeadWrap = {
  /** convex hull of the head/vertical stretch plus every defect detected within it */
  hull: Vec2[];
  /** that hull's zone as a polygon ({@link zoneRing}) — the exclusion zone the head arm routes outside of */
  ring: Vec2[];
  /** the last `well` index counted as head/vertical (mapped from the 3D kickoff) */
  headEndIndex: number;
  /** the detector spans absorbed into the wrap */
  absorbed: TraceProblemSpan[];
  /** the caller's obstacle hulls that overlapped the ring and were merged into it — route them no further */
  merged: Vec2[][];
  /** every obstacle hull the wrap was framed against; the cores route round those not merged */
  obstacles: Vec2[][];
  /**
   * Points framed beyond the well itself — the apex frame of an already-deviating head, a shifted
   * exit. ⛔ Every re-wrap must carry them: dropping the apex frame left a 2-point, zero-width hull
   * with no ring at all (F-1 B, F-5, F-15 A/B, F-12 with the top at 808 m).
   */
  extra: Vec2[];
};

/**
 * Frame the head AND the folds that belong with it as ONE large convex obstacle, so the head can
 * be routed around by the same machinery that routes a mid-trace fold (`connect` in
 * `one-sided-offset.ts`) rather than the bespoke flank/mouth/lead construction.
 *
 * ⭐ The head BASE is the 3D KICKOFF (`kickoffIndex`), mapped onto `well` — near the apex the plan
 * trace is degenerate, so a plan-shape settle is unreliable there while the kickoff is a fact about
 * the trajectory's inclination.
 *
 * ⭐⭐ A detected FOLD (a `pocket` — the trace doubling back through a narrow gap) is wrapped WITH
 * the head when the head is CLOSER to it than the fold's own loop is long: `gap < trappedArc`, the
 * clean trace between them shorter than the fold itself. Scale-free — a comparison of two intrinsic
 * arc lengths, no distance constant — so it holds across datasets: a fold hard against the head
 * merges, a genuine mid-trace fold far down the well stays a normal obstacle. Absorbing a fold
 * extends the head out to its far end, so a chain of near folds all come in, each judged against the
 * growing head. Kinks are followable bends and are never wrapped; the head base covers those near
 * the apex.
 *
 * ⭐ Any of `obstacles` (the mid-trace fold hulls) that OVERLAPS the finished ring, or lies too
 * close along the well for the rods round both ({@link rodsCrowd}), is merged into the wrap and
 * listed in {@link HeadWrap.merged}: two frames sharing ground would give the prune two blockers
 * to attribute one gap to, and the well between them is degenerate either way.
 *
 * @param extra points framed with the head — the apex frame of a head that is already deviating
 *
 * @group Utils
 */
export function headWrapRegion(
  well: Vec2[],
  kickoffIndex: number,
  margin: number,
  spans: TraceProblemSpan[],
  obstacles: Vec2[][] = [],
  extra: Vec2[] = [],
): HeadWrap {
  const arc = polylineArcLengths(well);
  const clampIdx = (i: number) => Math.max(0, Math.min(well.length - 1, i));
  let endIdx = clampIdx(kickoffIndex);
  let endArc = arc[endIdx];
  const pockets = spans.filter(isTracePocket);
  const absorbed: TraceProblemSpan[] = [];
  for (;;) {
    let grew = false;
    for (const p of pockets) {
      if (absorbed.includes(p)) continue;
      if (arc[p.span[0]] - endArc < p.trappedArc) {
        absorbed.push(p);
        if (arc[p.span[1]] > endArc) {
          endArc = arc[p.span[1]];
          endIdx = p.span[1];
        }
        grew = true;
      }
    }
    if (!grew) break;
  }
  const headEndIndex = clampIdx(endIdx);
  return wrapHead(well, headEndIndex, margin, absorbed, obstacles, extra);
}

/**
 * Atoms of run each rod round a zone is allowed between two zones before the two are framed as ONE
 * obstacle ({@link rodsCrowd}). The MEDIAN anchor measured — 4.1 atoms over 1064 rods on 12 wells
 * at margins 0.1–1.9 (p25 3.0, p75 6.7, p90 10) — one atom over the floor of 3, since two rods at
 * their floors would still meet. A longer anchor is caught when the rod is laid (`RodOverlapError`).
 */
const ROD_MERGE_ATOMS = 4;

/**
 * The arc length of the shortest stretch of `trace` running from the zone of hull `a` to the zone
 * of hull `b` (the points within `margin` of each) outside both — 0 when the trace passes straight
 * from one into the other, `Infinity` when it never runs between them.
 *
 * @group Utils
 */
export function freeRunBetween(
  trace: Vec2[],
  a: Vec2[],
  b: Vec2[],
  margin: number,
): number {
  if (a.length === 0 || b.length === 0 || trace.length < 2) return Infinity;
  const ca = marginCrossings(trace, a, margin);
  const cb = marginCrossings(trace, b, margin);
  let inA = ca.startsInside;
  let inB = cb.startsInside;
  if (inA && inB) return 0;
  const events = [
    ...ca.crossings.map(c => ({ ...c, zone: 0 })),
    ...cb.crossings.map(c => ({ ...c, zone: 1 })),
  ].sort((p, q) => p.arc - q.arc);
  let best = Infinity;
  let left: { zone: number; at: number } | null = null;
  for (const e of events) {
    const wasFree = !inA && !inB;
    if (e.zone === 0) inA = e.entering;
    else inB = e.entering;
    if (inA && inB) return 0;
    if (!wasFree && !inA && !inB) left = { zone: e.zone, at: e.arc };
    else if (wasFree && left && left.zone !== e.zone) {
      best = Math.min(best, e.arc - left.at);
    }
  }
  return best;
}

/**
 * Whether the stretch of `trace` between two hulls' zones is too short to hold the rods round
 * both — each needs {@link ROD_MERGE_ATOMS} atoms of run off its zone — so the two are ONE obstacle.
 *
 * @group Utils
 */
export function rodsCrowd(
  trace: Vec2[],
  a: Vec2[],
  b: Vec2[],
  margin: number,
): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const reach =
    ROD_MERGE_ATOMS *
    (ringAtom(hullDiameter(a) + 2 * margin, margin) +
      ringAtom(hullDiameter(b) + 2 * margin, margin));
  // the stretch between two zones is at least as long as the gap between them
  if (convexPolygonDistance(a, b) - 2 * margin >= reach) return false;
  return freeRunBetween(trace, a, b, margin) < reach;
}

/** An octagon of radius `margin` about `p` — a frame for a point that has no hull of its own. */
export function marginFrame(p: Vec2, margin: number): Vec2[] {
  const frame: Vec2[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    frame.push([p[0] + Math.cos(a) * margin, p[1] + Math.sin(a) * margin]);
  }
  return frame;
}

/**
 * The head framed up to `endIndex` (plus the absorbed pockets and `extra` points) as one convex
 * obstacle, with every overlapping obstacle hull merged in.
 */
function wrapHead(
  well: Vec2[],
  endIndex: number,
  margin: number,
  absorbed: TraceProblemSpan[],
  obstacles: Vec2[][],
  extra: Vec2[] = [],
): HeadWrap {
  const headEndIndex = Math.max(0, Math.min(well.length - 1, endIndex));
  const pts: Vec2[] = well.slice(0, headEndIndex + 1);
  for (const s of absorbed) for (const p of s.hull) pts.push(p);
  pts.push(...extra);
  const merged: Vec2[][] = [];
  let hull = convexHull2D(pts);
  let ring = zoneRing(hull, margin);
  for (;;) {
    let grew = false;
    for (const h of obstacles) {
      if (merged.includes(h)) continue;
      // within the head's zone, or too near along the well for the rods round both
      if (
        convexPolygonDistance(h, hull) >= margin &&
        !rodsCrowd(well, hull, h, margin)
      ) {
        continue;
      }
      merged.push(h);
      pts.push(...h);
      grew = true;
    }
    if (!grew) break;
    hull = convexHull2D(pts);
    ring = zoneRing(hull, margin);
  }
  return { hull, ring, headEndIndex, absorbed, merged, obstacles, extra };
}

/**
 * The angle, in radians, between the well where it leaves a head wrap and the hull edge beside it —
 * the one that does NOT carry the well in. A cut rounding that corner turns by π minus it, so a
 * small angle is a steep concave turn. Read over one rod atom, the scale the rod rounds the ring at.
 *
 * @returns π when the well never leaves the wrap
 *
 * @group Utils
 */
export function headWrapExitAngle(
  well: Vec2[],
  wrap: HeadWrap,
  margin: number,
): number {
  const hull = wrap.hull;
  const n = hull.length;
  if (n < 3) return Math.PI;
  let k = wrap.headEndIndex + 1;
  while (k < well.length && pointInConvex(well[k], hull)) k++;
  if (k >= well.length || k === 0) return Math.PI;
  const x = well[k - 1];
  const D = hullDiameter(hull);
  const atom = ringAtom(D, margin);
  // the boundary at x: both neighbours of the vertex it sits on, else both ends of the edge nearest it
  let vi = 0;
  let vd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(hull[i][0] - x[0], hull[i][1] - x[1]);
    if (d < vd) {
      vd = d;
      vi = i;
    }
  }
  let ends: [Vec2, Vec2] = [hull[(vi + n - 1) % n], hull[(vi + 1) % n]];
  if (vd > 1e-6 * Math.max(1, D)) {
    let ed = Infinity;
    for (let i = 0; i < n; i++) {
      const d = distanceToSegment2D(x, hull[i], hull[(i + 1) % n]);
      if (d < ed) {
        ed = d;
        ends = [hull[i], hull[(i + 1) % n]];
      }
    }
  }
  const arcs = polylineArcLengths(well);
  const back = unit(sub(pointAtArcLength(well, arcs, arcs[k - 1] - atom), x));
  const out = unit(sub(pointAtArcLength(well, arcs, arcs[k - 1] + atom), x));
  const [e0, e1] = ends.map(e => unit(sub(e, x)));
  // the edge the well came in along is the one closest to its own back direction
  const free = dot(e0, back) >= dot(e1, back) ? e1 : e0;
  return Math.acos(Math.max(-1, Math.min(1, dot(out, free))));
}

/** {@link planHeadArm} result — the head arm's axis, before any routing joins the cores to it. */
export type HeadArmPlan = {
  /** outward run-out bearing (unit) — exactly opposite the TD arm's */
  dir: Vec2;
  /** the head frame the axis was planned against — grown past a crossing and/or extended to a shifted exit */
  wrap: HeadWrap;
  /** the wrap was grown beyond the input frame */
  grown: boolean;
  /**
   * the VIRTUAL WELL the cores are offset from, HEAD→TD: the guide (apex→exit), on to the exit
   * itself, a hop through the hull's centroid, then the real well from the wrap's end. The hop lies
   * strictly inside the hull, so its offsets are swallowed by the ring and the gap they leave is
   * what `oneSidedOffset` wraps.
   */
  trace: Vec2[];
  /** first well vertex past the wrap that lies OUTSIDE its ring — where the cores approach from */
  entryIndex: number;
  /** where the guide starts: level with the hull's exit vertex (see {@link planHeadArm}), on the (shifted) axis */
  exit: Vec2;
  /** the synthesized well continuation, `exit → apex` */
  guide: Vec2[];
  /** the far end of the guide */
  apex: Vec2;
  /** where the two sides converge, on the axis past `apex` */
  gather: Vec2;
  /** the shared tip, past the outline */
  tip: Vec2;
  /** the ring's half-width perpendicular to `dir`, in metres */
  spread: number;
  guideLength: number;
  /** the axis's sideways shift off the direct extension, in metres along `leftNormal2D(dir)`; 0 when the turn is laid */
  shift: number;
  /** why the axis was shifted: a limb inside the taper cone, or the well arriving at an angle */
  shiftReason: 'crowding' | 'approach' | null;
  /** radius of the arc laid from the head onto the guide ({@link FenceArmsOptions.headTurnout}), or 0 */
  turnRadius: number;
  /** angle (rad) between the well's TD→head approach heading and the bearing */
  approachAngle: number;
  /** a limb crowded the direct extension from BOTH sides, so no shift could clear it */
  crowds: boolean;
  /** the final axis still crosses the well outside the ring */
  crosses: boolean;
  /**
   * The whole well lies inside the head ring — a plan-degenerate (near-vertical) well. The wrap is
   * the whole well's hull, the bearing its longest axis (or the fallback), and BOTH ends are
   * synthesized guides: the TD arm's is in {@link HeadArmPlan.td}.
   */
  degenerate: boolean;
  /**
   * Where a degenerate plan's bearing came from: the hull's longest axis when the hull is clearly
   * elongated, else the field's fallback angle. `'well'` for a non-degenerate plan.
   */
  bearingSource: 'well' | 'hull' | 'fallback';
  /** the whole-well hull's elongation (longest axis over its width), degenerate plans only */
  hullAspect: number;
  /** the TD end's synthesized guide, only for a degenerate plan */
  td: { end: FenceArmEnd; exit: Vec2; apex: Vec2; guide: Vec2[] } | null;
  /**
   * How the pockets the head absorbed are framed: at their mouths (`'loop'`), or with their necks
   * when the loop left the well a steep concave turn out of the wrap. Set by `planFenceHead`.
   */
  framing?: 'loop' | 'neck';
  /** the head wrap as framed, before the axis grew it ({@link planTdDiversion} reads it) */
  frame?: HeadWrap;
  /** the mouth of the hairpin a laid U-turn makes with the well, framed into the wrap; 0 when none */
  hairpinMouth?: number;
};

/**
 * Place the head arm's AXIS: a synthesized continuation of the well leaving the head-wrap hull on
 * its far side, opposite the TD arm, plus the gather and tip the two sides converge onto.
 *
 * ⭐ The bearing is `-tdDir` by default — the fence is one straight-through cut with the well in the
 * middle ({@link FenceArmsOptions.headBearing} `'free'` leaves through the head instead, at least
 * `headMinTdAngle` off the TD arm). The direct extension leaves the hull from its forward-facing chain at the vertex that
 * costs the two sides the LEAST TURNING to reach and leave (see the exit search inside), so a hull
 * lying across the bearing is rounded along its elongated side rather than one core doubling back.
 * Two scale-free rules amend it when the well outside the hull is in the way:
 * - it CROSSES the well ⇒ the wrap GROWS to the crossing, so the fold the axis ran into becomes
 *   part of the obstacle the cores route around (F-15 D's hook);
 * - it CROWDS the well — a limb runs on inside the axis's TAPER CONE (the wedge of half-angle θ
 *   the cores converge through) — ⇒ the whole axis is SHIFTED sideways, away from that limb, until
 *   the passage between limb and guide is as wide as the ring itself, so the cut squeezed between
 *   them never gets a corridor narrower than the one it already makes round the hull (F-12's
 *   hook). A limb diverging at more than θ never crowds, however close to the hull it leaves: the
 *   cores follow it out and bend over.
 * - the well ARRIVES at an angle α ≤ `maxRelativeTurn` to the bearing ⇒ the axis is shifted AWAY
 *   from the side the well comes from by `W · (1 - cos α)` (W = ring width), the lateral
 *   displacement of a turn through α at the ring's width, so the near core runs on past the hull and
 *   bends onto the guide instead of cornering at the ring.
 * Growing has no stopping point without a crossing, so a limb merely alongside is never wrapped.
 *
 * ⭐⭐ An arm more than `maxRelativeTurn` off the well's heading (an L or a U) gets its turn LAID
 * instead: an arc leaving the ring's front along the well's own heading and turning through α onto
 * the bearing, its chord `headTurnout` long and its radius no less than the ring's diameter. A shift only moves an L's corner — the turn is still α
 * at one place — and scales with W, which for a head cut below its kickoff is a margin frame: F-15
 * D cut at 1500 m was shifted 0.29 m at margin 0.1 and left a 136° fold the repair could not turn.
 * Laid at 100 m, the head turn's median effective radius over 108 L/U heads went from 1.7 m to ~40 m
 * and no build was lost. Neither shift applies there: the laid axis starts a turnout away from any
 * limb that crowded the old one (none inside its taper cone, measured).
 * ⛔ The arc is part of the VIRTUAL WELL, never folded into the hull: an exit advanced along the
 * bearing and folded in was a spike both cores rounded (F-15 A, F-1 B).
 * ⚠️ On a head cut from above, the arc starts along the well above the cut and runs over it in
 * plan; that well lies above the block, so the cut never meets it.
 *
 * ⭐ Every length derives from ONE angle, `maxRelativeTurn / 2`: a core leaving its flank by that
 * angle and rejoining the guide by the same has spent one gate's worth of turning over the whole
 * taper. The guide runs to where the last core has converged at that taper; the gather sits where a
 * biarc S displacing `margin` peaks at that heading (`margin / tan(θ/2)`).
 *
 * ⭐⭐ NO ROUTING HERE — the plan is a VIRTUAL WELL ({@link HeadArmPlan.trace}) plus its obstacle
 * ({@link HeadArmPlan.wrap}). Feeding those to `oneSidedOffset` makes the head one more fold the
 * cores wrap: each side leaves the follow where its offset enters the ring, walks the ring on its
 * own hand and lands on the guide's offset, eased by the same rod as any mid-trace fold. A SHIFTED
 * exit is folded into the hull so the guide starts on a hull vertex — otherwise the stub from the
 * hull out to the exit would be followed as a spur.
 *
 * @param obstacles the mid-trace fold hulls; those overlapping the head ring are merged into it
 * @returns null only for a well of fewer than 2 points
 *
 * @group Utils
 */
export function planHeadArm(
  well: Vec2[],
  headWrap: HeadWrap,
  margin: number,
  outline: Vec2[][],
  obstacles: Vec2[][] = [],
  options: FenceArmsOptions = {},
): HeadArmPlan | null {
  if (well.length < 2) return null;
  // ⛔ A wrap with no hull (the kickoff at the apex of a vertical well) is a DEGENERATE well, not
  // nothing to plan: the degenerate branch frames the whole well. A well that is itself a point or
  // a line in plan has no hull either, so its ends are framed at the margin.
  if (headWrap.hull.length < 3) {
    const extra =
      convexHull2D(well).length >= 3
        ? headWrap.extra
        : [
            ...headWrap.extra,
            ...marginFrame(well[0], margin),
            ...marginFrame(well[well.length - 1], margin),
          ];
    return planDegenerateHead(well, margin, outline, obstacles, options, extra);
  }
  const extension = options.extension ?? DEFAULT_EXTENSION;
  const tangentArc = options.tangentArc ?? DEFAULT_TANGENT_ARC;
  const degenerateSpan = options.degenerateSpan ?? DEFAULT_DEGENERATE_SPAN;
  const fallbackAngle = options.fallbackAngle ?? 0;
  const taper = Math.tan(
    (options.maxRelativeTurn ?? DEFAULT_MAX_RELATIVE_TURN) / 2,
  );
  const tdDir = options.tdPlan
    ? options.tdPlan.end.dir
    : endBearing(well, false, tangentArc, degenerateSpan, fallbackAngle);
  let dir = negate(tdDir);
  let perp = leftNormal2D(dir[0], dir[1]);

  let wrap = headWrap;
  let grown = false;
  let shift = 0;
  let entryIndex = -1;
  let support: Vec2 = wrap.hull[0];
  let spread = 0;
  let outside: Vec2[][] = [];
  let axisEnd: Vec2 = support;

  /** Re-read the frame: entry, support vertex, spread and the reliable well pieces past the wrap. */
  const frame = (): boolean => {
    entryIndex = -1;
    for (let i = wrap.headEndIndex + 1; i < well.length; i++) {
      if (!pointInConvex(well[i], wrap.ring)) {
        entryIndex = i;
        break;
      }
    }
    if (entryIndex < 0) return false;
    // ⭐⭐ THE EXIT IS THE FORWARD-FACING HULL VERTEX THAT COSTS THE LEAST TURNING. Each side reaches
    // the exit by walking the hull from where the well enters it — one clockwise, the other
    // counter-clockwise — then leaves along `dir`; the cost of a candidate is the WORSE side's
    // total absolute heading change over that walk (approach heading → walk → `dir`). The bare
    // support vertex was ill-posed for a hull lying ACROSS the bearing: its whole far edge is
    // equally forward, and picking a corner sent one side round the far tip and back along the
    // face — 270° against the 90° the far tip itself costs. Ties (within θ) go to the most forward
    // candidate, so a hull aligned with the bearing keeps its natural tip.
    const hull = wrap.hull;
    const nh = hull.length;
    let area = 0;
    for (let i = 0; i < nh; i++) {
      const j = (i + 1) % nh;
      area += hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1];
    }
    const ccw = area > 0 ? 1 : -1;
    // outward normal of an edge a→b is (dz, -dx) for a CCW ring
    const faces = (a: Vec2, b: Vec2) =>
      ccw * ((b[1] - a[1]) * dir[0] - (b[0] - a[0]) * dir[1]) > 0;
    const entry = well[entryIndex];
    const approach = unit(sub(well[entryIndex - 1], entry));
    let foot = 0;
    let footD = Infinity;
    for (let i = 0; i < nh; i++) {
      const d = Math.hypot(hull[i][0] - entry[0], hull[i][1] - entry[1]);
      if (d < footD) {
        footD = d;
        foot = i;
      }
    }
    const heading = (a: Vec2, b: Vec2): Vec2 | null => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return l > 1e-9 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
    };
    const angleBetween = (a: Vec2, b: Vec2) =>
      Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b)));
    const walkCost = (to: number, step: 1 | -1, full: boolean): number => {
      let h = approach;
      let cost = 0;
      let k = foot;
      // The two walks are complementary arcs of the ring; when the exit IS the foot one of them is
      // empty and the other goes all the way round.
      let first = full;
      while (first || k !== to) {
        first = false;
        const next = (k + step + nh) % nh;
        const hd = heading(hull[k], hull[next]);
        if (hd) {
          cost += angleBetween(h, hd);
          h = hd;
        }
        k = next;
      }
      return cost + angleBetween(h, dir);
    };
    const tieAngle = Math.atan(taper);
    let bestCost = Infinity;
    let bestForward = -Infinity;
    for (let i = 0; i < nh; i++) {
      const prev = hull[(i - 1 + nh) % nh];
      const cur = hull[i];
      const next = hull[(i + 1) % nh];
      if (!faces(prev, cur) && !faces(cur, next)) continue;
      const cost = Math.max(walkCost(i, 1, false), walkCost(i, -1, i === foot));
      const forward = dot(cur, dir);
      const better =
        cost < bestCost - tieAngle ||
        (cost < bestCost + tieAngle && forward > bestForward);
      if (better) {
        bestCost = Math.min(bestCost, cost);
        bestForward = forward;
        support = cur;
      }
    }
    spread = 0;
    for (const p of wrap.ring) {
      spread = Math.max(spread, Math.abs(dot(sub(p, support), perp)));
    }
    outside = [];
    let piece: Vec2[] = [];
    for (let i = entryIndex; i < well.length; i++) {
      if (pointInConvex(well[i], wrap.ring)) {
        if (piece.length >= 2) outside.push(piece);
        piece = [];
      } else piece.push(well[i]);
    }
    if (piece.length >= 2) outside.push(piece);
    // Far enough to reach past the outline from anywhere the exit may end up.
    axisEnd = along(
      support,
      dir,
      reachPastOutline(support, dir, outline, extension) + extension,
    );
    return true;
  };
  const axisStart = (): Vec2 => along(support, perp, shift);
  /** The well index of the FIRST crossing along the axis, or -1. */
  const firstCrossing = (): number => {
    const a = axisStart();
    const b = along(axisEnd, perp, shift);
    let bestT = Infinity;
    let at = -1;
    for (const piece of outside) {
      const ts = segmentPolylineCrossingParams(a[0], a[1], b[0], b[1], piece);
      if (ts.length === 0 || ts[0] >= bestT) continue;
      bestT = ts[0];
      // Locate the crossed segment: the well vertex just past the crossing point.
      const hit = along(a, sub(b, a), ts[0]);
      let bd = Infinity;
      for (let i = 1; i < piece.length; i++) {
        const d = distanceToSegment2D(hit, piece[i - 1], piece[i]);
        if (d < bd) {
          bd = d;
          at = well.indexOf(piece[i]);
        }
      }
    }
    return at;
  };

  /**
   * How a limb CROWDS the axis from `a`: the nearest lateral offset, per side, of an outside vertex
   * inside the taper cone (lateral < forward · tan θ) within the convergence zone. A limb diverging
   * from the axis at more than θ is clear however close to the hull it leaves — the cores follow it
   * out and bend over.
   */
  const crowding = (a: Vec2, zone: number): { pos: number; neg: number } => {
    let pos = Infinity;
    let neg = Infinity;
    for (const piece of outside) {
      for (const p of piece) {
        const rel = sub(p, a);
        const f = dot(rel, dir);
        if (f <= 0 || f > zone) continue;
        const s = dot(rel, perp);
        if (Math.abs(s) >= f * taper) continue;
        if (s >= 0) pos = Math.min(pos, s);
        else neg = Math.min(neg, -s);
      }
    }
    return { pos, neg };
  };
  /**
   * Guide length for an axis starting at `a`: how far along it the LAST core has converged. A core
   * passing ring vertex `p` (forward `f`, lateral `s`) reaches `guide ± margin` at `f + (|s| -
   * margin) / tan θ`, so the guide runs to the largest of those — a ring vertex AHEAD of the exit
   * (the exit need not be the support vertex) pushes it out by its own lead.
   */
  const guideFrom = (a: Vec2): number => {
    let need = 0;
    for (const p of wrap.ring) {
      const rel = sub(p, a);
      const f = dot(rel, dir);
      const s = Math.abs(dot(rel, perp));
      need = Math.max(need, f + Math.max(0, s - margin) / taper);
    }
    return need;
  };
  // ⭐ The taper is as long as the straight it follows. A biarc S closing `margin` over `L` peaks
  // at heading `2·atan(margin/L)`, so `margin / tan(θ/2)` is the SHORTEST taper that stays under θ —
  // and at a small margin that is a few metres, a pencil tip at the end of a 20–50 m guide. The
  // taper is therefore also no shorter than the guide it comes off: the two cores have run parallel
  // along it, and the convergence reads as a continuation of that run rather than a snip at its end.
  const minGather = margin / Math.tan(Math.atan(taper) / 2);
  /** Convergence zone length for an axis starting at `a`: guide plus gather. */
  const zoneFrom = (a: Vec2): number => {
    const g = guideFrom(a);
    return g + Math.max(minGather, g);
  };

  let hemmed = false;
  let shiftReason: HeadArmPlan['shiftReason'] = null;
  let approachAngle = 0;
  if (options.headBearing === 'free') {
    // ⭐ THROUGH THE HEAD: from where the well enters the head through its hull's area centroid, on
    // the head as the straight-through axis frames it — grown over the fold that axis runs into.
    // Read before growing, F-15 D's head was its kickoff alone and the arm ran NNE into the hook;
    // grown, the well enters it from the hook and the arm leaves SSE.
    for (let round = 0; round < well.length && frame(); round++) {
      const crossAt = firstCrossing();
      if (crossAt <= wrap.headEndIndex) break;
      wrap = wrapHead(
        well,
        crossAt,
        margin,
        wrap.absorbed,
        obstacles,
        wrap.extra,
      );
      grown = true;
    }
    const hull = wrap.hull;
    let area = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i];
      const q = hull[(i + 1) % hull.length];
      const c = p[0] * q[1] - q[0] * p[1];
      area += c;
      cx += (p[0] + q[0]) * c;
      cz += (p[1] + q[1]) * c;
    }
    const through =
      entryIndex > 0 && Math.abs(area) > 1e-9
        ? sub([cx / (3 * area), cz / (3 * area)], well[entryIndex])
        : null;
    const length = through ? Math.hypot(through[0], through[1]) : 0;
    if (through && length > 1e-9) {
      const own: Vec2 = [through[0] / length, through[1] / length];
      const least =
        ((options.headMinTdAngle ?? DEFAULT_HEAD_MIN_TD_ANGLE) * Math.PI) / 180;
      // ⭐ Off a diverted TD arm ({@link planTdDiversion}) only on the side AWAY from the diversion.
      const divert = options.tdPlan?.divert ?? 0;
      const ref = tdDir;
      const across = ref[0] * own[1] - ref[1] * own[0];
      const hand = divert !== 0 ? -Math.sign(divert) : Math.sign(across) || 1;
      const off = hand * Math.atan2(across, dot(own, ref));
      if (off >= least) {
        dir = own;
      } else {
        const a = hand * least;
        dir = [
          ref[0] * Math.cos(a) - ref[1] * Math.sin(a),
          ref[0] * Math.sin(a) + ref[1] * Math.cos(a),
        ];
      }
      perp = leftNormal2D(dir[0], dir[1]);
    }
  }
  let approach: Vec2 = negate(dir);
  let laid = false;
  const turnout = Math.max(0, options.headTurnout ?? DEFAULT_HEAD_TURNOUT);
  const maxTurn = options.maxRelativeTurn ?? DEFAULT_MAX_RELATIVE_TURN;
  const wellArc = polylineArcLengths(well);
  /**
   * Where a hook the well makes just past the wrap ends: its largest turn within 1.5 hull diameters
   * of leaving the ring, when that is over 90° — else -1.
   */
  const hookEnd = (): number => {
    let e = wrap.headEndIndex;
    while (e + 1 < well.length && pointInConvex(well[e], wrap.ring)) e++;
    const reach = 1.5 * hullDiameter(wrap.hull);
    let turned = 0;
    let most = 0;
    let at = -1;
    for (let i = e + 1; i + 1 < well.length && wellArc[i] - wellArc[e] < reach; i++) {
      const a = sub(well[i], well[i - 1]);
      const b = sub(well[i + 1], well[i]);
      turned += Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b));
      if (Math.abs(turned) > Math.abs(most)) {
        most = turned;
        at = i;
      }
    }
    return Math.abs(most) > Math.PI / 2 ? at : -1;
  };
  let hooked = false;
  for (let round = 0; round < well.length; round++) {
    if (!frame()) {
      return planDegenerateHead(
        well,
        margin,
        outline,
        obstacles,
        options,
        wrap.extra,
      );
    }
    const crossAt = firstCrossing();
    if (crossAt > wrap.headEndIndex) {
      wrap = wrapHead(
        well,
        crossAt,
        margin,
        wrap.absorbed,
        obstacles,
        wrap.extra,
      );
      grown = true;
      shift = 0;
      continue;
    }
    // ⭐ A head grown over the well and a well that hooks back right after it: the hook is taken into
    // the wrap, once, so the rods anchor past it rather than bend round it (F-15 D, Z13, Z21).
    if (grown && !hooked) {
      hooked = true;
      const hook = hookEnd();
      if (hook > wrap.headEndIndex) {
        wrap = wrapHead(well, hook, margin, wrap.absorbed, obstacles, wrap.extra);
        shift = 0;
        continue;
      }
    }
    approach = negate(
      meanTangent2D(well.slice(entryIndex), true, tangentArc) ?? negate(dir),
    );
    approachAngle = Math.acos(Math.max(-1, Math.min(1, dot(approach, dir))));
    laid = turnout > 0 && approachAngle > maxTurn;
    if (laid) break;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of wrap.ring) {
      const s = dot(sub(p, support), perp);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    const width = hi - lo;
    // A limb running on alongside the direct extension: move the axis away from it until the
    // passage between limb and guide is as wide as the ring itself — the cut squeezed between them
    // never gets a corridor narrower than the one it already makes round the hull.
    const a = axisStart();
    const crowd = crowding(a, zoneFrom(a));
    const crowdPos = crowd.pos < Infinity;
    const crowdNeg = crowd.neg < Infinity;
    if (crowdPos && crowdNeg) hemmed = true;
    if (crowdPos !== crowdNeg) {
      shift = crowdPos ? crowd.pos - width : width - crowd.neg;
      shiftReason = 'crowding';
    }
    // The well ARRIVES at the hull at an angle to the bearing: the near core would corner at the
    // ring to get onto the guide. Shift the axis AWAY from the side the well comes from by the
    // lateral displacement of a turn through that angle at the ring's width — `W · (1 - cos α)` —
    // so the core runs on past the hull and bends onto the guide instead. Below θ it is negligible;
    // at a right angle it is one ring width, the same passage the crowding rule opens.
    // ⛔ The margin's own width is deducted, not used as a threshold: the core already sits `margin`
    // off the axis. Gating on `lateral > margin` made the exit JUMP by a whole margin — F-4 went
    // from 0 to a 2.4 m shift between margins 2.45 and 2.4, and the guide snapped from the hull's
    // tip onto its flank.
    // ⚠️ Evaluated ALONGSIDE the crowding rule, not instead of it: the same limb can trip either,
    // depending on whether its entry falls inside the taper cone, and taking whichever fired first
    // made F-12 jump from an 18 m to a 54 m shift between margins 12.5 and 12.6. Both push the axis
    // off the same limb, so where they agree on the side the larger wins; a crowding shift is never
    // overridden by an approach shift the other way.
    const lateral =
      Math.min(width, width * (1 - Math.cos(approachAngle))) - margin;
    if (lateral > 0) {
      // `approach` points TD→head, so the limb lies on the `-approach` side; move the other way.
      const proposed = Math.sign(dot(approach, perp)) * lateral;
      if (
        shiftReason === null ||
        (Math.sign(proposed) === Math.sign(shift) &&
          Math.abs(proposed) > Math.abs(shift))
      ) {
        shift = proposed;
        shiftReason = 'approach';
      }
    }
    break;
  }

  const offset = options.headOffset ?? 0;
  if (!laid) shift += offset;
  let exit = axisStart();
  // A shifted exit joins the hull, so the guide leaves from a hull vertex and the chord back into
  // the hull is swallowed whole — the extension only covers ground on the far side from the limb.
  if (shift !== 0) {
    wrap = wrapHead(well, wrap.headEndIndex, margin, wrap.absorbed, obstacles, [
      ...wrap.extra,
      exit,
    ]);
  }
  // The laid turn, HEAD→TD: from the guide's start back to the ring in front of the hull.
  const turn: Vec2[] = [];
  let front = exit;
  let turnRadius = 0;
  let hairpinMouth = 0;
  if (laid) {
    for (const p of wrap.hull) {
      if (dot(p, approach) > dot(front, approach)) front = p;
    }
    // ⛔ From the RING, like the guide below: a turn vertex inside it reads as reliable trace.
    const start = along(front, approach, margin);
    const hand = Math.sign(approach[0] * dir[1] - approach[1] * dir[0]) || 1;
    // ⛔ Never tighter than the ring it leaves: at margin 7.6–20 a 100 m turnout laid R ≈ 52 m off
    // 111–276 m rings and the rods failed (F-12, F-15 D). The width across the bearing was not enough.
    turnRadius = Math.max(
      turnout / (2 * Math.sin(approachAngle / 2)),
      hullDiameter(wrap.ring),
    );
    // HEAD→TD: from the guide's start back to `start`.
    const lay = (side: number, radius = turnRadius): Vec2[] =>
      turnArc(start, approach, side * approachAngle, radius, margin).reverse();
    const clears = (arc: Vec2[]): boolean => {
      const far = along(
        arc[0],
        dir,
        reachPastOutline(arc[0], dir, outline, extension) + extension,
      );
      return outside.every(piece => polylineCrossings([far, ...arc], piece) === 0);
    };
    // ⭐ At a U the hand's sign is noise (Y02 flipped at 179.9° → 180.0°): take the side that clears.
    let arc = lay(hand);
    let side = hand;
    if (!clears(arc)) {
      const other = lay(-hand);
      if (clears(other)) {
        arc = other;
        side = -hand;
      }
    }
    // ⭐ A U-turn (over 90°) is FRAMED, not followed: a trapezoid on the line from the head anchor to
    // the guide's start, so the cuts go round it by the rod; where the well comes back level with
    // the guide's start (a hairpin) the frame takes it too, and the inner cut crosses that mouth.
    if (approachAngle > Math.PI / 2) {
      // ⭐ Nothing follows a framed turn, so the ring floor on its radius does not apply: sized from the
      // ring it framed a 2 km loop head's turn 2 km wide too (Z01 2019 → 4594 m, Z34 1668 → 4078 m).
      turnRadius = turnout / (2 * Math.sin(approachAngle / 2));
      arc = lay(side);
      // a widening only moves the guide's start sideways — the frame gets longer, not deeper
      const exitAt = offset !== 0 ? along(arc[0], perp, offset) : arc[0];
      const framed = turnTrapezoid(start, exitAt, arc);
      const cx = (framed[0][0] + framed[1][0] + framed[2][0] + framed[3][0]) / 4;
      const cz = (framed[0][1] + framed[1][1] + framed[2][1] + framed[3][1]) / 4;
      turn.push(exitAt, [cx, cz]);
      exit = exitAt;
      const level = dot(exit, dir);
      let k = wrap.headEndIndex;
      while (k + 1 < well.length && dot(well[k], dir) < level) k++;
      // ⛔ A well that only comes back level far off is a long run, not a hairpin (1345 m on Z04 at 0.5)
      const near =
        Math.hypot(well[k][0] - arc[0][0], well[k][1] - arc[0][1]) <=
        HAIRPIN_MOUTH_WIDTHS * 2 * turnRadius;
      const end = k < well.length - 1 && near ? k : wrap.headEndIndex;
      if (end > wrap.headEndIndex) {
        hairpinMouth = Math.hypot(well[end][0] - exit[0], well[end][1] - exit[1]);
      }
      wrap = wrapHead(well, end, margin, wrap.absorbed, obstacles, [
        ...wrap.extra,
        ...framed,
      ]);
    } else {
      // A larger radius moves the exit sideways by `R(1 − cos α)` — only ever further to the turn's side.
      const lateral = dot(sub(arc[0], start), perp);
      if (offset !== 0 && Math.sign(lateral) === Math.sign(offset)) {
        turnRadius += Math.abs(offset) / (1 - Math.cos(approachAngle));
        arc = lay(side);
      }
      turn.push(...arc);
      exit = turn[0];
    }
  }
  // ⭐ The guide is as long as the ROD needs to land on it: a rod round a ring of diameter D leaves
  // the ring a fraction of D past its exit and tapers onto `guide ± margin` at θ. `guideFrom` alone
  // is ~0 for a hull aligned with the bearing, and MEASURED the cores were then left a 2 m stub to
  // land on — every landing came out at ~90°. Lengthening to this took the rod census 26/66 → 44/66.
  const ringDiameter = hullDiameter(wrap.ring);
  // `guideFrom` is the ring's convergence onto the axis — behind a laid turn, which the cores follow.
  const guideLength = laid
    ? ringDiameter + margin / taper
    : Math.max(guideFrom(exit), ringDiameter + margin / taper);
  const apex = along(exit, dir, guideLength);
  // ⛔ Densified HERE, not left to `computeOffsetRuns`: `oneSidedOffset` reads its reliable pieces
  // off the trace's own vertices, and a two-point guide whose far end is a hull vertex (inside the
  // ring) leaves a one-vertex piece that is dropped — the cores were never verified against it.
  // ⛔⛔ And it starts ON THE RING, not on the hull vertex. Guide vertices inside the ring are
  // "reliable" trace to the offset, and the ring's own corner at the exit sits within `margin` of
  // them — the walk vertex there was pushed clear, landed back inside the ring, and the join was
  // reported BLOCKED (F-1 B, F-15 D). From the ring outwards every guide vertex is ≥ margin from
  // every ring vertex by construction; the ring corner is exactly `margin` from the first.
  const step = Math.min(4, Math.max(0.5, margin * 0.5));
  const n = Math.max(1, Math.ceil((guideLength - margin) / step));
  const guide: Vec2[] = [];
  for (let k = n; k >= 0; k--) {
    guide.push(along(exit, dir, margin + ((guideLength - margin) * k) / n));
  }
  // ⛔ The chord from the exit to the wrap's end must lie STRICTLY inside the hull, so every offset
  // of it is swallowed by the ring. Both ends are hull vertices, so the direct chord can run ALONG a
  // hull edge and its outer offset then survives as a spur that follows the chord into the hull —
  // MEASURED on F-11 A / F-1 C as a core crossing the degenerate well inside the frame. Via the
  // hull's centroid both legs are interior by convexity.
  const hull = wrap.hull;
  let cx = 0;
  let cz = 0;
  for (const p of hull) {
    cx += p[0];
    cz += p[1];
  }
  const centroid: Vec2 = [cx / hull.length, cz / hull.length];
  // ⛔ Via the EXIT first: turning into the hull at the guide's end put the corner on the ring, and
  // its offset pinch survived as a stub run at some margins (F-15 left, 2.4 / 2.5 / 2.6).
  const trace: Vec2[] = laid
    ? [...guide, ...turn, front, centroid, ...well.slice(wrap.headEndIndex)]
    : [...guide, exit, centroid, ...well.slice(wrap.headEndIndex)];
  const gatherDist = Math.max(minGather, guideLength);
  const gather = along(apex, dir, gatherDist);
  const reach = Math.max(
    reachPastOutline(apex, dir, outline, extension),
    gatherDist + extension,
  );
  const tip = along(apex, dir, reach);

  // Only what the rules could not fix is flagged: hemmed in on both sides, or a shifted axis
  // landing on another limb.
  const crowds = hemmed;
  let crosses = false;
  for (const piece of outside) {
    if (
      segmentPolylineCrossingParams(exit[0], exit[1], tip[0], tip[1], piece)
        .length > 0
    ) {
      crosses = true;
    }
  }

  return {
    dir,
    wrap,
    grown,
    trace,
    entryIndex,
    exit,
    guide,
    apex,
    gather,
    tip,
    spread,
    guideLength,
    shift,
    shiftReason,
    turnRadius,
    approachAngle,
    crowds,
    crosses,
    degenerate: false,
    bearingSource: 'well',
    hullAspect: 0,
    td: null,
    frame: headWrap,
    hairpinMouth,
  };
}

/**
 * One end's synthesized guide off a hull: from the ring (`margin` along `dir` from the hull's
 * support vertex — its most forward one) out to where a rod round the ring has landed, densified,
 * plus the gather and tip past it. Shared by the degenerate plan's two ends.
 */
function guideOffHull(
  ring: Vec2[],
  hull: Vec2[],
  dir: Vec2,
  margin: number,
  taper: number,
  outline: Vec2[][],
  extension: number,
): { end: FenceArmEnd; exit: Vec2; apex: Vec2; guide: Vec2[] } {
  let support = hull[0];
  for (const p of hull) if (dot(p, dir) > dot(support, dir)) support = p;
  const perp = leftNormal2D(dir[0], dir[1]);
  let need = 0;
  for (const p of ring) {
    const rel = sub(p, support);
    need = Math.max(
      need,
      dot(rel, dir) + Math.max(0, Math.abs(dot(rel, perp)) - margin) / taper,
    );
  }
  const guideLength = Math.max(need, hullDiameter(ring) + margin / taper);
  const step = Math.min(4, Math.max(0.5, margin * 0.5));
  const n = Math.max(1, Math.ceil((guideLength - margin) / step));
  const guide: Vec2[] = [];
  for (let k = n; k >= 0; k--) {
    guide.push(along(support, dir, margin + ((guideLength - margin) * k) / n));
  }
  const apex = along(support, dir, guideLength);
  const gatherDist =
    GATHER_FACTOR *
    Math.max(margin / Math.tan(Math.atan(taper) / 2), guideLength);
  const gather = along(apex, dir, gatherDist);
  const reach = Math.max(
    reachPastOutline(apex, dir, outline, extension),
    gatherDist + extension,
  );
  return {
    end: { dir, gather, tip: along(apex, dir, reach) },
    exit: support,
    apex,
    guide,
  };
}

/**
 * The plan for a PLAN-DEGENERATE well — one whose whole trace fits inside its head ring, so there
 * is no well outside the hull for a cut to follow at all.
 *
 * ⭐ The WHOLE well is the hull, and the fence is a straight-through cut past it: its bearing is the
 * hull's LONGEST axis when the hull is clearly ELONGATED — aspect (longest axis over the width
 * across it) at least {@link DEGENERATE_HULL_ASPECT} — else the field's `fallbackAngle`; TD is the
 * end of that axis nearer the well's own TD. ⛔ Elongation, not size: a near-vertical well's whole
 * footprint is a metre or two (F-11: 1.4 × 0.24 m), so any absolute span threshold would send
 * every well this branch exists for to the fallback. A 6:1 sliver has a direction however small it
 * is; a round scatter blob has none at any size. Both ends get a synthesized guide
 * ({@link guideOffHull}), and the virtual well is `head guide → centroid → TD guide` — the cores
 * are then the two flanks of a rod round one ring, the same construction as any fold.
 *
 * @param extra points framed with the well ({@link HeadWrap.extra})
 */
function planDegenerateHead(
  well: Vec2[],
  margin: number,
  outline: Vec2[][],
  obstacles: Vec2[][],
  options: FenceArmsOptions,
  extra: Vec2[] = [],
): HeadArmPlan {
  const extension = options.extension ?? DEFAULT_EXTENSION;
  const fallbackAngle = options.fallbackAngle ?? 0;
  const taper = Math.tan(
    (options.maxRelativeTurn ?? DEFAULT_MAX_RELATIVE_TURN) / 2,
  );
  const wrap = wrapHead(well, well.length - 1, margin, [], obstacles, extra);
  const hull = wrap.hull;
  // the hull's longest axis, oriented head → TD by the well's own ends
  let a: Vec2 = hull[0];
  let b: Vec2 = hull[0];
  let best = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const d = Math.hypot(hull[j][0] - hull[i][0], hull[j][1] - hull[i][1]);
      if (d > best) {
        best = d;
        a = hull[i];
        b = hull[j];
      }
    }
  }
  const axis = unit(sub(b, a));
  const across = leftNormal2D(axis[0], axis[1]);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of hull) {
    const s = dot(sub(p, a), across);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const hullAspect = hi - lo > 1e-9 ? best / (hi - lo) : Infinity;
  let tdDir: Vec2;
  let bearingSource: HeadArmPlan['bearingSource'];
  if (best > 1e-9 && hullAspect >= DEGENERATE_HULL_ASPECT) {
    const drift = sub(well[well.length - 1], well[0]);
    tdDir = dot(drift, axis) >= 0 ? axis : negate(axis);
    bearingSource = 'hull';
  } else {
    const ang = (fallbackAngle * Math.PI) / 180;
    tdDir = [Math.cos(ang), Math.sin(ang)];
    bearingSource = 'fallback';
  }
  const dir = negate(tdDir);
  const head = guideOffHull(
    wrap.ring,
    hull,
    dir,
    margin,
    taper,
    outline,
    extension,
  );
  const td = guideOffHull(
    wrap.ring,
    hull,
    tdDir,
    margin,
    taper,
    outline,
    extension,
  );
  let cx = 0;
  let cz = 0;
  for (const p of hull) {
    cx += p[0];
    cz += p[1];
  }
  const centroid: Vec2 = [cx / hull.length, cz / hull.length];
  const trace: Vec2[] = [
    ...head.guide,
    head.exit,
    centroid,
    td.exit,
    ...[...td.guide].reverse(),
  ];
  const perp = leftNormal2D(dir[0], dir[1]);
  let spread = 0;
  for (const p of wrap.ring) {
    spread = Math.max(spread, Math.abs(dot(sub(p, head.exit), perp)));
  }
  return {
    dir,
    wrap,
    grown: true,
    trace,
    entryIndex: well.length,
    exit: head.exit,
    guide: head.guide,
    apex: head.apex,
    gather: head.end.gather,
    tip: head.end.tip,
    spread,
    guideLength: Math.hypot(
      head.apex[0] - head.exit[0],
      head.apex[1] - head.exit[1],
    ),
    shift: 0,
    shiftReason: null,
    turnRadius: 0,
    approachAngle: 0,
    crowds: false,
    crosses: false,
    degenerate: true,
    bearingSource,
    hullAspect,
    td,
  };
}

/** {@link planTdArm} result — a TD end routed round the obstacle over it, like the head. */
export type TdArmPlan = {
  end: FenceArmEnd;
  /** the hull vertex the guide leaves from */
  exit: Vec2;
  /** the far end of the guide */
  apex: Vec2;
  /** the synthesized well continuation, `apex → exit` (reversed to follow it HEAD→TD) */
  guide: Vec2[];
  /** the obstacle over the TD — empty for a diverted TD arm */
  hull: Vec2[];
  /** its exclusion zone — the well inside it is not trusted */
  ring: Vec2[];
  /** a diverted TD arm's run on from the TD and its turn, up to `exit` ({@link planTdDiversion}) */
  lead?: Vec2[];
  /** the diversion off the TD bearing, radians, positive towards its left normal */
  divert?: number;
};

/**
 * Plan the TD end when an obstacle covers it: the cores round that hull by the same rod as any
 * fold and land on a synthesized guide past it ({@link guideOffHull}), instead of stopping at its
 * zone and joining the TD arm straight across the hook inside.
 *
 * ⭐ The bearing is read off the well BEFORE the hull — its stretch inside is degenerate and cannot
 * be trusted, and a mean tangent is set by its end point, so the hook would steer it.
 *
 * @param obstacles the hulls the cores route around ({@link fenceObstacles})
 * @returns null when no obstacle's zone contains the TD, or it swallows the whole well
 *
 * @group Utils
 */
export function planTdArm(
  well: Vec2[],
  obstacles: Vec2[][],
  margin: number,
  outline: Vec2[][],
  options: FenceArmsOptions = {},
): TdArmPlan | null {
  if (well.length < 2) return null;
  const last = well[well.length - 1];
  for (const hull of obstacles) {
    if (hull.length < 3) continue;
    const ring = zoneRing(hull, margin);
    if (!pointInConvex(last, ring)) continue;
    let k = well.length - 1;
    while (k > 0 && pointInConvex(well[k], ring)) k--;
    if (k === 0) return null;
    const dir = endBearing(
      well.slice(0, k + 1),
      false,
      options.tangentArc ?? DEFAULT_TANGENT_ARC,
      options.degenerateSpan ?? DEFAULT_DEGENERATE_SPAN,
      options.fallbackAngle ?? 0,
    );
    const taper = Math.tan(
      (options.maxRelativeTurn ?? DEFAULT_MAX_RELATIVE_TURN) / 2,
    );
    const g = guideOffHull(
      ring,
      hull,
      dir,
      margin,
      taper,
      outline,
      options.extension ?? DEFAULT_EXTENSION,
    );
    return { ...g, hull, ring };
  }
  return null;
}

/**
 * `trace` with its TD end routed onto `plan`'s guide: the tail inside the plan's zone replaced by a
 * hop through the hull's centroid to the exit, then the guide — the TD half of a degenerate plan's
 * virtual well.
 *
 * @group Utils
 */
export function tdPlanTrace(trace: Vec2[], plan: TdArmPlan): Vec2[] {
  if (plan.lead) {
    return [...trace, ...plan.lead, ...[...plan.guide].reverse().slice(1)];
  }
  let k = trace.length - 1;
  while (k > 0 && pointInConvex(trace[k], plan.ring)) k--;
  let cx = 0;
  let cz = 0;
  for (const p of plan.hull) {
    cx += p[0];
    cz += p[1];
  }
  const centroid: Vec2 = [cx / plan.hull.length, cz / plan.hull.length];
  return [
    ...trace.slice(0, k + 1),
    centroid,
    plan.exit,
    ...[...plan.guide].reverse(),
  ];
}

/** Diversion steps tried off the TD bearing, radians. */
const DIVERT_STEP = (5 * Math.PI) / 180;
const DIVERT_MAX = Math.PI / 2;

/** The TD bearing, the side a diversion turns to and how far the arm runs on before it turns. */
function tdDiversionBase(
  well: Vec2[],
  margin: number,
  options: FenceArmsOptions,
): { td: Vec2; away: 1 | -1; stretch: number } {
  const tangentArc = options.tangentArc ?? DEFAULT_TANGENT_ARC;
  const maxTurn = options.maxRelativeTurn ?? DEFAULT_MAX_RELATIVE_TURN;
  const td = endBearing(
    well,
    false,
    tangentArc,
    options.degenerateSpan ?? DEFAULT_DEGENERATE_SPAN,
    options.fallbackAngle ?? 0,
  );
  const toHead = sub(well[0], well[well.length - 1]);
  return {
    td,
    away: td[0] * toHead[1] - td[1] * toHead[0] > 0 ? -1 : 1,
    // the TD arm's own gather distance, as `buildFenceArms` lays it
    stretch:
      GATHER_FACTOR * Math.max(margin / Math.tan(maxTurn / 4), tangentArc),
  };
}

const rotate2D = (v: Vec2, a: number): Vec2 => [
  v[0] * Math.cos(a) - v[1] * Math.sin(a),
  v[0] * Math.sin(a) + v[1] * Math.cos(a),
];

/** {@link tdDiversionAngles} result. Angles are signed radians off the TD bearing. */
export type TdDiversionAngles = {
  /** the well's TD bearing */
  td: Vec2;
  /** the angles whose head axis meets the well nowhere outside the frame and obstacles, smallest first */
  clear: number[];
  /** the angle (0 = undiverted) whose head axis meets the well nearest without a reversal, or null */
  nearest: number | null;
};

/**
 * The angles a TD arm may be DIVERTED by so the head arm, planned opposite it, stops growing over the
 * well — for a well whose two ends point the same way (a U), where the opposite-TD axis runs into the
 * well and the head wrap takes everything up to the crossing.
 *
 * ⭐ Always AWAY from the head's side of the TD bearing, in 5° steps to 90°. An angle is `clear` when
 * its head axis meets the well nowhere outside the head frame and the obstacles — a kink on the axis
 * is wrapped, not met. `nearest` is the one meeting it nearest without a reversal: the well there
 * heading back towards the head folds the cut round the grown wrap.
 * ⛔ An angle whose diverted arm ({@link planTdDiversion}) would cross the well is never listed.
 *
 * @param frame the head wrap before it grew ({@link HeadArmPlan.frame})
 * @param obstacles the mid-trace hulls the cores route around
 *
 * @group Utils
 */
export function tdDiversionAngles(
  well: Vec2[],
  frame: HeadWrap,
  obstacles: Vec2[][],
  margin: number,
  outline: Vec2[][],
  options: FenceArmsOptions = {},
): TdDiversionAngles {
  const n = well.length;
  const turnout = options.headTurnout ?? DEFAULT_HEAD_TURNOUT;
  const { td, away, stretch } = tdDiversionBase(well, margin, options);
  if (n < 2 || !(turnout > 0)) return { td, clear: [], nearest: null };
  const extension = options.extension ?? DEFAULT_EXTENSION;
  const head = well[0];
  const last = well[n - 1];
  const bend = along(last, td, stretch);

  const skip = [frame.hull, ...obstacles].filter(h => h.length >= 3);
  const skipped = (p: Vec2) =>
    skip.some(h => {
      if (pointInConvex(p, h)) return true;
      for (let i = 0; i < h.length; i++) {
        if (distanceToSegment2D(p, h[i], h[(i + 1) % h.length]) <= margin) {
          return true;
        }
      }
      return false;
    });
  /** Where the head axis along `dir` first meets the well outside the frame and the obstacles. */
  const meets = (dir: Vec2): { at: number; heading: Vec2 } | null => {
    const reach = reachPastOutline(head, dir, outline, extension) + extension;
    const far = along(head, dir, reach);
    let best = Infinity;
    let heading: Vec2 | null = null;
    for (let i = frame.headEndIndex + 1; i < n; i++) {
      const seg = [well[i - 1], well[i]];
      for (const t of segmentPolylineCrossingParams(head[0], head[1], far[0], far[1], seg)) {
        if (t >= best || skipped(along(head, dir, t * reach))) continue;
        best = t;
        heading = unit(sub(well[i], well[i - 1]));
      }
    }
    return heading ? { at: best * reach, heading } : null;
  };

  const undiverted = meets(negate(td));
  let nearest =
    undiverted && dot(undiverted.heading, negate(td)) >= 0
      ? { angle: 0, at: undiverted.at }
      : null;
  const clear: number[] = [];
  for (let phi = DIVERT_STEP; phi <= DIVERT_MAX + 1e-9; phi += DIVERT_STEP) {
    const angle = away * phi;
    const arc = turnArc(bend, td, angle, turnout / (2 * Math.sin(phi / 2)), margin);
    const exit = arc[arc.length - 1];
    const d = rotate2D(td, angle);
    const far = along(exit, d, reachPastOutline(exit, d, outline, extension) + extension);
    if (polylineCrossings([last, ...arc, far], well) > 0) continue;
    const met = meets(negate(d));
    if (!met) clear.push(angle);
    else if (dot(met.heading, negate(d)) >= 0 && (!nearest || met.at < nearest.at)) {
      nearest = { angle, at: met.at };
    }
  }
  return { td, clear, nearest: nearest?.angle ?? null };
}

/**
 * The TD arm diverted by `angle` ({@link tdDiversionAngles}): it runs on along the TD bearing for its
 * gather distance, turns on an arc whose chord is `headTurnout` and leaves on the new bearing; the
 * cores follow it like any TD guide.
 *
 * @group Utils
 */
export function planTdDiversion(
  well: Vec2[],
  angle: number,
  margin: number,
  outline: Vec2[][],
  options: FenceArmsOptions = {},
): TdArmPlan {
  const extension = options.extension ?? DEFAULT_EXTENSION;
  const tangentArc = options.tangentArc ?? DEFAULT_TANGENT_ARC;
  const turnout = options.headTurnout ?? DEFAULT_HEAD_TURNOUT;
  const { td, stretch } = tdDiversionBase(well, margin, options);
  const last = well[well.length - 1];
  const step = Math.min(4, Math.max(0.5, margin * 0.5));
  const lead: Vec2[] = [];
  const ns = Math.max(1, Math.ceil(stretch / step));
  for (let k = 1; k <= ns; k++) lead.push(along(last, td, (stretch * k) / ns));
  const bend = along(last, td, stretch);
  const arc = turnArc(bend, td, angle, turnout / (2 * Math.sin(Math.abs(angle) / 2)), margin);
  lead.push(...arc.slice(1));
  const exit = arc[arc.length - 1];
  const dir = rotate2D(td, angle);
  const ng = Math.max(1, Math.ceil(tangentArc / step));
  const guide: Vec2[] = [];
  for (let k = ng; k >= 0; k--) guide.push(along(exit, dir, (tangentArc * k) / ng));
  const apex = guide[0];
  const gather = along(apex, dir, stretch);
  const reach = Math.max(
    reachPastOutline(apex, dir, outline, extension),
    stretch + extension,
  );
  return {
    end: { dir, gather, tip: along(apex, dir, reach) },
    exit,
    apex,
    guide,
    hull: [],
    ring: [],
    lead,
    divert: angle,
  };
}

/** Metres between the vertices an arm is laid with for the pocket detector. */
const ARM_POCKET_STEP = 10;

/** The deepest of the detector's pockets that open on the arm — the first `armEnd` vertices of `trace`. */
function pocketsOnArm(
  trace: Vec2[],
  armEnd: number,
  margin: number,
): TracePocketSpan | null {
  let worst: TracePocketSpan | null = null;
  for (const s of traceProblemSpans(trace, { margin })) {
    if (!isTracePocket(s) || s.span[0] >= armEnd) continue;
    if (!worst || s.ratio > worst.ratio) worst = s;
  }
  return worst;
}

/** `from` → `to`, `to` excluded, at {@link ARM_POCKET_STEP}. */
function armLine(from: Vec2, to: Vec2): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / ARM_POCKET_STEP));
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    out.push([from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n]);
  }
  return out;
}

/**
 * The corridor a planned head arm forms with its own well: the trace problem detector run over the
 * arm (tip to apex) in front of the plan's virtual well, and the deepest pocket opening on the arm.
 *
 * @group Utils
 */
export function armPocket(
  plan: HeadArmPlan,
  well: Vec2[],
  margin: number,
): TracePocketSpan | null {
  const arm = armLine(plan.tip, plan.trace[0]);
  const ownWell = well.length - plan.wrap.headEndIndex;
  const head = plan.trace.slice(0, plan.trace.length - ownWell);
  // ⛔ What lies inside the head ring (a hairpin's turn, the hop through the hull) is not trace.
  const outside = head.filter(p => !pointInConvex(p, plan.wrap.ring));
  const trace = [...arm, ...outside, ...well.slice(plan.wrap.headEndIndex)];
  return pocketsOnArm(trace, arm.length + outside.length, margin);
}

/**
 * {@link armPocket} without a plan: a straight arm along `axis` from the frame's far edge, joined to
 * the well where the frame ends. A cheap screen only — it reads neither a laid turn nor a grown wrap.
 *
 * @group Utils
 */
export function frameArmPocket(
  well: Vec2[],
  frame: HeadWrap,
  axis: Vec2,
  margin: number,
  outline: Vec2[][],
  options: FenceArmsOptions = {},
): TracePocketSpan | null {
  let front = frame.hull[0] ?? well[0];
  for (const p of frame.hull) if (dot(p, axis) > dot(front, axis)) front = p;
  const start = along(front, axis, margin);
  const reach =
    reachPastOutline(start, axis, outline, 0) + (options.extension ?? DEFAULT_EXTENSION);
  const arm = [...armLine(along(start, axis, reach), start), start];
  return pocketsOnArm([...arm, ...well.slice(frame.headEndIndex)], arm.length, margin);
}

/**
 * The obstacles the cores route around once a head arm is planned: the wrap's hull in place of
 * every mid-trace hull it merged, with the rest unchanged.
 *
 * ⛔ A merged hull must NOT stay in the list alongside the wrap — the prune attributes a gap to
 * ONE blocker, and two frames sharing ground would split one gap between them.
 *
 * @group Utils
 */
export function headRouteObstacles(
  plan: HeadArmPlan,
  obstacles: Vec2[][],
): Vec2[][] {
  return [
    plan.wrap.hull,
    ...obstacles.filter(h => !plan.wrap.merged.includes(h)),
  ];
}

/** How close two vertices must be to count as the SAME point when stretches are concatenated. */
const SEAM_EPSILON = 1e-6;

/** One labelled stretch of a finished side curve, as an index range into it. */
export type CurvePiece = {
  kind: 'core' | 'ring-walk' | 'lead' | 'route' | 'join' | 'run-out';
  /** first index in the side curve */
  start: number;
  /** last index in the side curve */
  end: number;
};

/**
 * Concatenate labelled stretches into one curve, dropping the duplicate vertex at every seam and
 * reporting where each stretch ended up. The seams ARE the joins, so a view can mark them.
 *
 * ⛔⛔ `tol` is a COINCIDENT-POINT epsilon, NOT a resampling spacing. It used to be 0.5 m, which
 * silently THINNED every part it concatenated — including the verified core. MEASURED on the F-11
 * family: ~15% of core vertices dropped (1749 of 2070 kept at margin 2), which chorded across the
 * midpoints `holdChords` had inserted to hold the margin on the CHORDS (offset invariant 10) and
 * buried the well by 13–27 mm at EVERY margin, on every well sampled. It also steepened corners —
 * the core's own worst turn 33° came out of assembly at 47°. Assembly must not alter geometry.
 */
function assemblePieces(
  parts: { kind: CurvePiece['kind']; points: Vec2[] }[],
  tol: number = SEAM_EPSILON,
): { points: Vec2[]; pieces: CurvePiece[] } {
  const points: Vec2[] = [];
  const pieces: CurvePiece[] = [];
  for (const part of parts) {
    const start = Math.max(0, points.length - 1);
    for (const p of part.points) {
      const last = points[points.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < tol) continue;
      points.push([p[0], p[1]]);
    }
    if (points.length - 1 > start) {
      pieces.push({ kind: part.kind, start, end: points.length - 1 });
    }
  }
  return { points, pieces };
}

/**
 * The free stiff rod joining a core end onto an arm axis: leaving `from` along `fromDir` and arriving
 * at `gather` along `dir`, clamped at both so the core is untouched, with no ring and no well to keep
 * off — the assembled side's gates judge it. Scaled by its own span, as a ring rod by its ring.
 */
function rodJoin(
  from: Vec2,
  fromDir: Vec2,
  gather: Vec2,
  dir: Vec2,
  margin: number,
  rodStiffness: number,
): Vec2[] {
  const D = Math.hypot(gather[0] - from[0], gather[1] - from[1]);
  if (!(D > 1e-6)) return [from, gather];
  const atom = ringAtom(D, margin);
  const count = Math.max(4, Math.round(D / atom));
  const seed: Vec2[] = [along(from, fromDir, -atom)];
  for (let k = 0; k <= count; k++) {
    const t = k / count;
    seed.push([
      from[0] + (gather[0] - from[0]) * t,
      from[1] + (gather[1] - from[1]) * t,
    ]);
  }
  seed.push(along(gather, dir, atom));
  const rod = settleRodConstrained(seed, {
    obstacles: [],
    keepOut: [],
    margin,
    bending: ((FREE_ROD_STIFFNESS * rodStiffness * D) / (D / count)) ** 2,
  });
  return rod.points.slice(1, -1);
}

/**
 * Attach the TD run-out to one side's cut: an eased join off the cut onto the shared axis, then
 * the identical straight run to the shared tip.
 */
function attachTdArm(
  curve: Vec2[],
  end: FenceArmEnd,
  side: FenceSideName,
  rodStiffness: number,
  margin: number,
  leadPast: Vec2 | null,
  onGuide: boolean,
  debug?: FenceArmDebug[],
): { points: Vec2[]; pieces: CurvePiece[] } {
  // Leave the cut's OWN TD end along its OWN direction and arrive at the gather along the axis, so
  // the core is untouched — a real bend near TD is never straightened into a cut corner it lacks.
  // ⛔ Except a core landed on a guide, which leaves along the arm as at the head: cut at its landing
  // it still converges by up to 8°, and over a 700 m join the two sides crossed (F-11 A at 1900 m: 5.3 m).
  const fromDir = onGuide ? end.dir : coreEndDir(curve, false, EXIT_ARC);
  // ⭐ The core first runs on straight until it is `margin` past the TD, so the join cannot cut the
  // corner round it: from a core end level with the TD it dipped inside the margin (F-1 B at
  // margin 5, biarc 0.034 m, rod 0.102 m).
  // ⛔ Holding it off the whole well does not fix that: MEASURED, contacts piled up round the well's
  // TD end (0.09 m chords, 129°) and broke F-1 B / F-7 / F-9 / F-11 T2 at margin 5.
  // ⛔ Nor `holdPolylineChords2D`: over 26 wells × margins 0.1/0.5/1/5/20 it traded the dip for
  // EIGHT new 48–87° corners against the 45° gate.
  // ⛔ Not `joinByTangents2D`: one corner at the rays' intersection sent the arm OUT and back
  // (F-9 at margin 1.2: 1.20 → 2.40 m off the axis for 20 m).
  const coreEnd = curve[curve.length - 1];
  const lead = leadPast
    ? Math.max(0, margin - dot(sub(coreEnd, leadPast), fromDir))
    : 0;
  const start = lead > 1e-9 ? along(coreEnd, fromDir, lead) : coreEnd;
  const join = rodJoin(
    start,
    fromDir,
    end.gather,
    end.dir,
    margin,
    rodStiffness,
  );
  if (start !== coreEnd) join.unshift(coreEnd);
  if (debug) {
    debug.push({
      end: 'td',
      side,
      dir: end.dir,
      gather: end.gather,
      tip: end.tip,
      seam: join,
    });
  }
  return assemblePieces([
    { kind: 'core', points: curve },
    { kind: 'join', points: join },
    { kind: 'run-out', points: [end.gather, end.tip] },
  ]);
}

/**
 * Attach the head run-out to one side's cut — {@link attachTdArm} mirrored onto the core's head,
 * which already follows the planned guide, so the join is the same rod off the core's own end.
 */
function attachHeadArm(
  curve: Vec2[],
  end: FenceArmEnd,
  side: FenceSideName,
  rodStiffness: number,
  margin: number,
  debug?: FenceArmDebug[],
): { points: Vec2[]; pieces: CurvePiece[] } {
  // The core's head end sits ON the guide (trimmed there by the caller), so it leaves along the
  // arm's own bearing — an averaged end direction would reach back into the rod's curl.
  const join = rodJoin(
    curve[0],
    end.dir,
    end.gather,
    end.dir,
    margin,
    rodStiffness,
  );
  if (debug) {
    debug.push({
      end: 'head',
      side,
      dir: end.dir,
      gather: end.gather,
      tip: end.tip,
      seam: join,
    });
  }
  return assemblePieces([
    { kind: 'run-out', points: [end.tip, end.gather] },
    { kind: 'join', points: join.slice().reverse() },
    { kind: 'core', points: curve },
  ]);
}

/**
 * Build the shared run-out arms and attach them to both side cuts.
 *
 * ⚠️ The two cores must be the FINISHED `oneSidedOffset` points for the same margin, both HEAD→TD.
 * With {@link FenceArmsOptions.headArm} they are offsets of the plan's VIRTUAL well (guide + real
 * well past the head wrap) and already follow the guide at the head; the head arm is then attached
 * off their head ends exactly as the TD arm is off their TD ends. Without a plan the head end is
 * left bare. The gates always judge against the REAL `well`.
 *
 * @param well the fence's plan trace, HEAD→TD
 * @param cores the two finished side cuts, HEAD→TD
 * @param margin the cut clearance, in metres
 * @param outline the field outline rings in scene XZ — the arms reach out PAST it
 *
 * @group Utils
 */
export function buildFenceArms(
  well: Vec2[],
  cores: { left: Vec2[]; right: Vec2[] },
  margin: number,
  outline: Vec2[][],
  options: FenceArmsOptions = {},
): FenceArms {
  if (well.length < 2) throw new Error('buildFenceArms: well has < 2 points');
  if (!(margin > 0)) throw new Error('buildFenceArms: margin must be > 0');
  if (cores.left.length < 2 || cores.right.length < 2) {
    throw new Error(
      'buildFenceArms: a side core has < 2 points — a plan-degenerate well has no core to extend, and that branch is not implemented yet',
    );
  }

  const extension = options.extension ?? DEFAULT_EXTENSION;
  const tangentArc = options.tangentArc ?? DEFAULT_TANGENT_ARC;
  const degenerateSpan = options.degenerateSpan ?? DEFAULT_DEGENERATE_SPAN;
  const fallbackAngle = options.fallbackAngle ?? 0;
  const maxRelativeTurn = options.maxRelativeTurn ?? DEFAULT_MAX_RELATIVE_TURN;
  const rodStiffness = Math.max(0, options.rodStiffness ?? 1);
  const wellIndex = options.wellIndex ?? createPolylineIndex(well);
  const plan = options.headArm;

  // ⭐ The taper STARTS where the rod lands on the guide, and still ENDS at the plan's gather. The
  // guide is sized for the worst rod (one arriving across the hull's full width); a core that has
  // landed metres past the exit would otherwise run parallel to the axis for the rest of the guide
  // and then converge over the gather alone — F-10 at margin 5 ran 40 m straight and pinched. Each
  // core is trimmed back to its landing (both to the later of the two, so the taper is symmetric),
  // and the whole remaining axis is the convergence. Cores are given GUIDE END FIRST.
  // ⛔ "On the guide" is BOTH at `±margin` laterally AND heading along it: the rod's own vertices
  // pass through `±margin` while still curling off the hull flank, and a lateral test alone took
  // the rod's start for its landing — the whole rod was trimmed and the taper launched from the
  // hull. The landing is the LAST guide-following vertex before the core departs, found by walking
  // from the guide end (on the guide by construction) until either test fails.
  const trimToGuide = (
    a: Vec2[],
    b: Vec2[],
    exit: Vec2,
    dir: Vec2,
    apex: Vec2,
  ): { cores: [Vec2[], Vec2[]]; beyond: number } => {
    const perp = leftNormal2D(dir[0], dir[1]);
    const fwd = (p: Vec2) => dot(sub(p, exit), dir);
    const landingOf = (core: Vec2[]): number => {
      const lateralOk = (p: Vec2) =>
        Math.abs(Math.abs(dot(sub(p, exit), perp)) - margin) <=
        margin * 0.1 + 0.01;
      const headingOk = (i: number) => {
        const p = core[i];
        const q = core[Math.min(core.length - 1, i + 1)];
        const h = unit(sub(p, q)); // guide-ward heading, along `dir`
        return dot(h, dir) >= Math.cos(maxRelativeTurn / 4);
      };
      for (let i = 0; i < core.length - 1; i++) {
        // ⛔ Never behind the exit: with both guides on one line (a degenerate plan) the core follows
        // the axis through the hull, and the TD landing ran on to the HEAD side (F-7 cut at 808 m).
        if (!lateralOk(core[i]) || !headingOk(i) || fwd(core[i]) < 0)
          return Math.max(0, i - 1);
      }
      return core.length - 1;
    };
    // The taper starts at the LATER of the two landings: the earlier core runs on along its dashed
    // line until the other has landed too, so both leave the guide from the same station. Bounded
    // by the guide, whose far end is the apex — unless a core runs on past it: a rod anchored beyond
    // the guide's end ships whole and lands out there (an offset of the apex ends within `margin`).
    const reach = Math.max(fwd(a[0]), fwd(b[0]));
    const bound = reach > fwd(apex) + margin ? reach : fwd(apex);
    const landFwd = Math.min(
      bound,
      Math.max(fwd(a[landingOf(a)]), fwd(b[landingOf(b)])),
    );
    const beyond = Math.max(0, landFwd - fwd(apex));
    const trim = (core: Vec2[]): Vec2[] => {
      let k = 0;
      while (k < core.length - 1 && fwd(core[k]) > landFwd) k++;
      const kept = core.slice(Math.max(0, k - 1));
      const short = landFwd - fwd(kept[0]);
      return beyond > 0 && short > 0
        ? [along(kept[0], dir, short), ...kept]
        : kept;
    };
    return { cores: [trim(a), trim(b)], beyond };
  };

  // --- TD (dominant) end: bearing from the trajectory, shared gather + tip, both sides — or, for a
  // degenerate well, the plan's synthesized TD guide, landed on exactly like the head's.
  let td: FenceArmEnd;
  let tdLeft = cores.left;
  let tdRight = cores.right;
  // the TD apex a core must run on past before its join converges; none where it lands on a guide
  let leadPast: Vec2 | null = null;
  const tdGuide = plan?.td ?? options.tdPlan ?? null;
  const tdArmed = options.tdArm !== false || !!tdGuide;
  if (tdGuide) {
    const landed = trimToGuide(
      [...cores.left].reverse(),
      [...cores.right].reverse(),
      tdGuide.exit,
      tdGuide.end.dir,
      tdGuide.apex,
    );
    const [l, r] = landed.cores;
    tdLeft = l.reverse();
    tdRight = r.reverse();
    const d = tdGuide.end.dir;
    td = {
      dir: d,
      gather: along(tdGuide.end.gather, d, landed.beyond),
      tip: along(tdGuide.end.tip, d, landed.beyond),
    };
  } else {
    const tdApex = well[well.length - 1];
    const tdDir = endBearing(
      options.bearingWell ?? well,
      false,
      tangentArc,
      degenerateSpan,
      fallbackAngle,
    );
    if (!tdArmed) {
      td = { dir: tdDir, gather: tdApex, tip: tdApex };
    } else {
      // ⭐ The taper is as long as the straight it follows — here the TD tangent arc the bearing was
      // read over — and never shorter than the S needs to stay under θ/2 per side (`margin /
      // tan(θ/2)`), the same rule as the head arm. ⚠️ `GATHER_MIN = 120` used to pin this at 120 m for
      // every margin below 15: two cores 2 m apart were aimed at a point 120 m away, ran parallel, and
      // the whole convergence was compressed into the fillet — the pencil the user described.
      // ⭐ Then {@link GATHER_FACTOR} times that, and never shorter than the head arm's own gather.
      const theta = maxRelativeTurn / 2;
      const headGather = plan
        ? Math.hypot(
            plan.gather[0] - plan.apex[0],
            plan.gather[1] - plan.apex[1],
          )
        : 0;
      const gatherDist = Math.max(
        GATHER_FACTOR * Math.max(margin / Math.tan(theta / 2), tangentArc),
        headGather,
      );
      // A rod anchored past the TD ships whole, so the arm starts beyond the cores' ends (an offset
      // of the TD itself ends within `margin` of it).
      const past = Math.max(
        dot(sub(tdLeft[tdLeft.length - 1], tdApex), tdDir),
        dot(sub(tdRight[tdRight.length - 1], tdApex), tdDir),
      );
      const from = past > margin ? along(tdApex, tdDir, past) : tdApex;
      const reach = Math.max(
        reachPastOutline(from, tdDir, outline, extension),
        gatherDist + extension,
      );
      td = {
        dir: tdDir,
        gather: along(from, tdDir, gatherDist),
        tip: along(from, tdDir, reach),
      };
      leadPast = tdApex;
    }
  }

  const armTd = (curve: Vec2[], side: FenceSideName) =>
    tdArmed
      ? attachTdArm(
          curve,
          td,
          side,
          rodStiffness,
          margin,
          leadPast,
          !!tdGuide,
          options.debug,
        )
      : assemblePieces([{ kind: 'core', points: curve }]);
  const tdArmedLeft = armTd(tdLeft, 'left');
  const tdArmedRight = armTd(tdRight, 'right');

  // --- HEAD end: the planned arm, off the cores' guide-following head ends; or a no-arm end at the
  // apex (opposite-TD bearing) so consumers that read a head bearing/tip still have one.
  let head: FenceArmEnd = plan
    ? { dir: plan.dir, gather: plan.gather, tip: plan.tip }
    : { dir: negate(td.dir), gather: well[0], tip: well[0] };
  let headLeft = tdArmedLeft.points;
  let headRight = tdArmedRight.points;
  if (plan) {
    const landed = trimToGuide(
      headLeft,
      headRight,
      plan.exit,
      plan.dir,
      plan.apex,
    );
    [headLeft, headRight] = landed.cores;
    if (landed.beyond > 0) {
      head = {
        dir: plan.dir,
        gather: along(plan.gather, plan.dir, landed.beyond),
        tip: along(plan.tip, plan.dir, landed.beyond),
      };
    }
  }
  const sideLeft = plan
    ? attachHeadArm(headLeft, head, 'left', rodStiffness, margin, options.debug)
    : tdArmedLeft;
  const sideRight = plan
    ? attachHeadArm(
        headRight,
        head,
        'right',
        rodStiffness,
        margin,
        options.debug,
      )
    : tdArmedRight;
  if (plan) {
    // Re-label the TD pieces after the head pieces were prepended and the core's head trimmed.
    // ⛔ Clamped to the CORE'S START in the assembled side, never to 0: the trimmed head vertices
    // pushed the core's armed start negative, and a clamp at 0 labelled the core as beginning at
    // the tip — the per-piece thinning downstream then re-emitted the whole head arm after the
    // landing, a 900 m slit back to the gather (F-15 D at margin 4).
    for (const s of [
      { armed: tdArmedLeft, side: sideLeft, kept: headLeft.length },
      { armed: tdArmedRight, side: sideRight, kept: headRight.length },
    ]) {
      const coreStart = s.side.pieces.find(p => p.kind === 'core')!.start;
      const trimmed = s.armed.points.length - s.kept;
      const offset = s.side.points.length - s.kept - trimmed;
      s.side.pieces = [
        ...s.side.pieces.filter(p => p.kind !== 'core'),
        ...s.armed.pieces.map(p => ({
          kind: p.kind,
          start: Math.max(coreStart, p.start + offset),
          end: p.end + offset,
        })),
      ];
    }
  }

  const left = sideLeft.points;
  const right = sideRight.points;

  // ⛔ Hard gates on the ASSEMBLED sides — what ships is what is judged, never an intermediate.
  // An arm may not cross the well, loop over itself, or kink. Reject rather than ship a bad cut,
  // unless `allowDefects` (prototype view), which flags each so the failure can be seen.
  // ⚠⚠ The self-crossing half used to be missing. `unusable()` measured it when CHOOSING a rung,
  // but when no rung was clean the ladder shipped `firstBuilt` and only the well-crossing was
  // re-tested here — so a self-crossing arm was built silently and not even flagged (F-15 D at
  // margin 52.4). A verdict that is computed must be read at the call site.
  const crosses =
    indexedCrossings(wellIndex, left) > 0 ||
    indexedCrossings(wellIndex, right) > 0;
  const selfCrosses =
    countPolylineLoops(left) > 0 || countPolylineLoops(right) > 0;
  const worstTurn = {
    left: polylineWorstTurn(left),
    right: polylineWorstTurn(right),
  };
  const steep =
    worstTurn.left.turn > maxRelativeTurn ||
    worstTurn.right.turn > maxRelativeTurn;
  // ⛔⛔ Assembly may not DEGRADE the core. `oneSidedOffset` holds the margin on the core's CHORDS,
  // not merely at its vertices (its invariant 10 inserts midpoints to do so), so anything that
  // drops a vertex re-opens the sag those midpoints closed. Judged against the input core rather
  // than against `margin`: the assembled core is a sub-stretch of it, so with nothing dropped its
  // clearance can only be EQUAL OR GREATER — which makes this fire exactly when geometry was lost,
  // and keeps it correct for wells where part of the trace is inside an obstacle frame and the
  // absolute distance is (rightly) not the offset's own reference. A 0.5 m seam tolerance used to
  // trip this on every well at every margin, by 13–27 mm.
  const coreClearance = (pts: Vec2[], pieces: CurvePiece[]): number => {
    let d = Infinity;
    for (const piece of pieces) {
      if (piece.kind !== 'core') continue;
      const seg = pts.slice(piece.start, piece.end + 1);
      if (seg.length >= 2) {
        d = Math.min(d, indexedClearance(wellIndex, seg, margin * 4));
      }
    }
    return d;
  };
  let buries = false;
  for (const side of ['left', 'right'] as const) {
    const built = side === 'left' ? sideLeft : sideRight;
    const was = indexedClearance(wellIndex, cores[side], margin * 4);
    if (coreClearance(built.points, built.pieces) < was - 1e-6) buries = true;
  }
  if ((crosses || selfCrosses || steep || buries) && !options.allowDefects) {
    const faults: string[] = [];
    if (crosses) faults.push('crosses the well path');
    if (selfCrosses) faults.push('loops over itself');
    if (buries) {
      faults.push('lost core clearance in assembly (a vertex was dropped)');
    }
    if (steep) {
      const w =
        worstTurn.left.turn >= worstTurn.right.turn
          ? worstTurn.left
          : worstTurn.right;
      faults.push(
        `turns ${((w.turn * 180) / Math.PI).toFixed(0)}° at one vertex, past the ${((maxRelativeTurn * 180) / Math.PI).toFixed(0)}° limit`,
      );
    }
    throw new Error(`buildFenceArms: a cut ${faults.join(' and ')}`);
  }

  return {
    left,
    right,
    pieces: { left: sideLeft.pieces, right: sideRight.pieces },
    td,
    head,
    crosses,
    selfCrosses,
    steep,
    buries,
    worstTurn,
  };
}

/**
 * The fence's two cuts — the TD-armed {@link oneSidedOffset} cores.
 *
 * ⛔ Each side's core is required: the head-arm and near-vertical (blob) branches were removed, so
 * a well with no offsettable core is a named failure rather than a different construction.
 *
 * @param well the fence's plan trace, HEAD→TD
 * @param cores the two finished {@link oneSidedOffset} cuts, or null when neither could be built
 *
 * @group Utils
 */
export function buildFenceCut(
  well: Vec2[],
  cores: { left: Vec2[]; right: Vec2[] } | null,
  margin: number,
  outline: Vec2[][],
  options: FenceArmsOptions = {},
): FenceArms {
  if (!cores) {
    throw new Error('buildFenceCut: both cores are needed to build the arms');
  }
  return buildFenceArms(well, cores, margin, outline, options);
}
