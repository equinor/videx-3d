import { Vec2 } from '../types/common';
import {
  countPolylineLoops,
  cubicBezier2D,
  dedupePolyline2D,
  endTangent2D,
  leftNormal2D,
  nearestOnPolyline,
  offsetPolyline2DDissolved,
  polylineBounds2D,
  polylineLength,
  polylineMaxTurn,
  polylineMinRadius,
  polylineSharpEdges,
  removePolylineLoops,
  repairLoopsOneSided,
  resamplePolyline2D,
  segmentPolylineCrossingParams,
  segmentPolylineCrossings,
  simplifyPolylineClearOf,
  smoothPolyline2DWithinDisc,
} from '../utils/polyline-2d';
import { Curve3D } from './curve/curve-3d';
import { simplifyCurve2D } from '../utils/trajectory';
import {
  buildFenceSegmentIndex,
  FenceSegmentIndex,
  fenceSideAt,
} from './fence-segments';

/**
 * A **fence** is a vertical surface swept along a curve in plan, used to slice a
 * chunk stack in two along a wellbore so the well can be viewed from either half.
 *
 * ⭐ The defining property, and the reason this is cheap: a fence is VERTICAL, so
 * whether a point is removed depends on its XZ alone. The whole cut reduces to one
 * scalar per XZ position, which a shader reads per fragment while the CPU sweeps
 * the same curve into the cut face.
 *
 * ⭐⭐ The curve is built in three parts — the well's own plan trace and a run-out
 * at each end — and the clearance a caller asks for is baked INTO it rather than
 * applied as a threshold afterwards. The field is then a plain signed distance to
 * the finished curve and the shader's test is `< 0`, so the drawn face and the
 * removed block are the SAME OBJECT rather than two evaluations of one surface
 * that have to be reconciled.
 *
 * ⚠️ A wellbore's shallow section is near-vertical, so its plan trace is metres of
 * survey scatter standing in for kilometres of hole. Following it produces folds,
 * hairpins and a cut that pinches to a blade. Nothing here follows it: the trace is
 * straightened inside a tolerance corridor that is wide exactly where the well is
 * vertical, and the head is given up outright where even that is not enough.
 *
 * @module
 */

/** MD spacing the trajectory is sampled at, in metres. */
const DEFAULT_SAMPLE_SPACING = 10;

/** Cap on trajectory samples, including adaptive refinement. */
const MAX_SAMPLES = 4000;

/** Plan turn between consecutive samples that triggers refinement, in radians. */
const REFINE_TURN = (10 * Math.PI) / 180;

/** Plan step below which a turn is scatter rather than shape, in metres. */
const REFINE_MIN_STEP = 0.5;

/** `sin(inclination)` above which a well counts as deviating. */
const KICKOFF_SPEED = 0.15;

/** MD window the kickoff test is averaged over, in metres. */
const KICKOFF_WINDOW = 200;

/** Below this plan extent a well has no direction of its own, in metres. */
const MIN_PLAN_EXTENT = 100;

/** Opening a run-out must keep from the trace it leaves, in radians. */
const RUN_OUT_CLEARANCE = Math.PI / 4;

/**
 * How far a run-out may TURN from the trace's own heading, in radians.
 *
 * ⭐⭐ Past a quarter turn the arm is heading back toward the side it came from, and
 * the well is on that side — so a smooth junction has to sweep ACROSS the trajectory
 * and bury the head. Measured on 15/9-F-1, where both run-outs left the head heading
 * south while the well headed north-east and the cut visibly crossed it. No amount of
 * arm shaping fixes that; the direction has to be admissible in the first place.
 *
 * ⚠️ A preference, not a hard rule: a well that occupies every bearing around its own
 * head may leave nothing admissible, and a cut that turns too far still beats no cut.
 */
const MAX_RUN_OUT_TURN = Math.PI / 2;

/** Radius around a run-out's apex that does not constrain it, in metres. */
const RUN_OUT_NEAR = 50;

/** Run-out directions tried per end. */
const RUN_OUT_CANDIDATES = 5;

/** Metres a run-out clears the footprint by. */
const DEFAULT_RUN_OUT_MARGIN = 500;

/** Divisions the even-split score is measured on, before the size clamp. */
const SHARE_RESOLUTION = 96;

/** Metres per cell the even-split score aims for. */
const SHARE_CELL = 150;

/** Cap on the even-split raster, since it is rebuilt per candidate pair. */
const SHARE_RESOLUTION_MAX = 256;

/** Arc length a junction angle and an end tangent are measured over, in metres. */
const JUNCTION_ARC = 150;

/** Plan spacing the followed path is sampled at, in metres. Fine — performance ignored. */
const FOLLOW_SPACING = 10;

/**
 * MD step the 3D spline is sampled at before projecting to plan, in metres.
 *
 * ⭐⭐ High, because the wellbore is DRAWN along this same spline, which bulges past the
 * straight lines between survey stations. Sampling coarsely — or off the stations — would
 * miss that bulge, and the fence would cut inside the hole it is meant to reveal. We
 * sample dense and simplify after, so the point count is paid back.
 */
const SAMPLE_STEP = 2;

/**
 * Angle a plan sample must turn, past its predecessor, to survive simplification.
 *
 * ⚠️ `simplifyCurve2D` keeps a sample when `1 - dot(tangent, step) > this`, so a small
 * value keeps fine curvature and only drops the samples a straight run made redundant.
 */
const SIMPLIFY_TOLERANCE = 1e-4;

/**
 * Where the two sides' run-outs converge — the shared GATHER point — as a fraction of
 * the distance the run-out has to reach to clear the footprint, clamped to a metre band.
 *
 * ⭐⭐ Both sides bend from their own core end onto this ONE point and then follow the
 * identical straight run to the shared tip, so switching the removed half swaps the cut
 * but not the run-out. It sits far enough out that each side's approach arc has room to
 * turn off the core tangent onto the escape bearing without grazing the well.
 */
const RUN_OUT_GATHER_FRACTION = 0.2;
/** Nearest the gather point may sit to the apex, in metres — clears the well's near field. */
const RUN_OUT_GATHER_MIN = 120;
/** Furthest the gather point may sit from the apex, in metres. */
const RUN_OUT_GATHER_MAX = 1000;

/** Segments a run-out approach arc (the G1 Bézier turn) is sampled into. Fixed — bounded. */
const RUN_OUT_ARC_SAMPLES = 64;

/**
 * Bézier handle length as a fraction of the arm span (core end → gather point).
 *
 * ⭐ Larger keeps the arc hugging the two end tangents longer before it turns, which
 * both smooths the turn and holds the core's clearance further out.
 */
const RUN_OUT_ARC_HANDLE = 1 / 3;

/**
 * Turn beyond which the very last core vertex is treated as offset noise and dropped
 * before the TD run-out attaches, in radians (25°).
 *
 * ⚠️ The TD arm must leave along the core's real tangent; a tiny bend at the final
 * vertex would either define a false tangent or leave a micro-kink at the junction.
 */
const RUN_OUT_SPURIOUS_TURN = (25 * Math.PI) / 180;

/**
 * Most core arc length the flexible HEAD run-out may cut back, in metres, and how many
 * trim points it tries within it.
 *
 * ⭐ The head is negotiable: trimming the near-head core lets the arm leave at a gentler
 * angle (a head that doubles back would otherwise force the run-out to sweep across the
 * well). Over-clearing the head is fine — only the TD end has to hold the margin.
 */
const RUN_OUT_HEAD_TRIM_MAX = 400;
const RUN_OUT_TRIM_STEPS = 8;

/**
 * Junction turn the flexible HEAD arm settles for, in radians (90°).
 *
 * ⭐ The head trims only as much as it NEEDS to bring the junction turn under this — it
 * does not chase the gentlest possible arm. So a head that already leaves smoothly is
 * followed closely (no eager over-clearing), and only a head that doubles back is trimmed
 * back until it leaves cleanly.
 */
const RUN_OUT_HEAD_TURN_OK = (90 * Math.PI) / 180;

/**
 * Score bonus, per unit of `dot(start, -end)`, that pulls a near-vertical well's two
 * arms onto ONE straight axis when the footprint does not force otherwise.
 */
const RUN_OUT_COLLINEAR_BONUS = 0.05;

/** Fallback plan angle for a well with no direction of its own, in degrees (scene XZ). */
const DEFAULT_FALLBACK_ANGLE = 0;

/**
 * Metres of trajectory left in the KEPT block before the well counts as buried.
 *
 * ⭐⭐ THE invariant the old pipeline lacked. The geodesic keeps the whole trace on
 * the removed side by construction, so the only way anything ends up buried is a
 * run-out crossing back at a junction — this catches exactly that, in metres, at the
 * one place a viewer always looks.
 */
const BURIAL_LIMIT = 15;

/**
 * Wellbore render radius the cut is designed against, in metres.
 *
 * ⭐ A cut may leave the well on the KEPT side by at most this without the well
 * vanishing behind the block — it is still half-exposed at the face. The diagnostic
 * scores burial against this rather than against zero.
 */
const MIN_WELL_RADIUS = 0.1;

/**
 * Fraction of the margin used as the corridor-smoothing radius.
 *
 * ⭐ The rest of the margin stays as guaranteed clearance, so smoothing can round the
 * offset's bends and dissolve its tiny reversals without ever moving the cut close
 * enough to the well to bury it.
 */
const SMOOTH_MARGIN_FRACTION = 0.7;

/** Corridor-smoothing iterations applied to the offset cut. */
const SMOOTH_PASSES = 12;

/**
 * Sharp-edge constraint the cut is SIMPLIFIED against — the same arm-weighted rule the
 * diagnostic uses, injected as a construction constraint so coarsening cannot introduce a
 * sharp edge. Relative turn (radians) that is sharp at {@link CONSTRUCT_SHARP_ARM}.
 */
const CONSTRUCT_SHARP_TURN = (30 * Math.PI) / 180;
/** Arm length each side is capped at for the sharp-edge constraint, in metres. */
const CONSTRUCT_SHARP_ARM = 10;
/** Default coarsening deviation, in metres — 0 keeps the cut following the well tightly. */
const DEFAULT_SIMPLIFY = 0;

/** Turn a real direction reversal must exceed to be scored as a wiggle, in radians (30°). */
const DIAGNOSIS_WIGGLE_TURN = (30 * Math.PI) / 180;
/** Turn a near-reversal must exceed to be scored as a pinch, in radians (150°). */
const DIAGNOSIS_PINCH_TURN = (150 * Math.PI) / 180;
/** Both arms of a pinch must be at least this long to be scored, in metres. */
const DIAGNOSIS_PINCH_ARM = 25;
/** Arc length within which two opposite turns are scored as a wiggle, in metres. */
const DIAGNOSIS_WIGGLE_SPAN = 40;
/** Fraction of the core that may bridge rather than follow before it is flagged. */
const DIAGNOSIS_BRIDGED_LIMIT = 0.5;

/** Arc length the largest-turn diagnostic is accumulated over, in metres. */
const FOLD_WINDOW = 200;

/** Share of the block below which a side is treated as unusable. */
const SHARE_FLOOR = 0.1;

/**
 * Metres the cut face may stand off the cut.
 *
 * ⭐ A real bound now, not a fraction of a cell: the face is swept from the curve
 * and the cut reads that same curve back, so the only difference left is float
 * precision. Measured at 2e-5 m across the demo wells.
 */
const RESIDUAL_LIMIT = 0.01;

const DEFAULT_MAX_CELLS = 1 << 20;

/** Trajectory samples, in scene coordinates, with the shape of the hole. */
export type FenceSamples = {
  /** scene XZ per sample */
  plan: Vec2[];
  /** scene Y per sample */
  y: Float64Array;
  /** distance along the trajectory per sample, in metres */
  md: Float64Array;
  /**
   * `sin(inclination)` per sample — how far the hole moves in PLAN per metre
   * drilled.
   *
   * ⭐ The one number that says whether the plan trace here is shape or scatter,
   * and it comes off the 3D tangent rather than being inferred from the
   * projection, which is what makes it reliable in the vertical section where the
   * projection has nothing to say.
   */
  planSpeed: Float64Array;
  /** samples added by the refinement pass */
  inserted: number;
  /** largest plan turn left between consecutive samples, in radians */
  maxTurn: number;
};

/**
 * Sample a trajectory for a fence.
 *
 * ⭐⭐ Sampled by MD off the SPLINE, not off the survey stations. Stations are a
 * polyline, so a curved section is a run of facets with a corner at every one, and
 * a fence built on them inherits each corner as a kink in the cut.
 *
 * ⚠️ The refinement pass exists so a plan EXTREME is never stepped over: a uniform
 * MD sample can pass straight by the outermost point of a tight dogleg, and the
 * fence then runs inside the well and buries it. Refinement is suppressed where the
 * plan step is tiny, because a large turn over half a metre of plan is scatter in
 * the vertical section and would otherwise eat the whole sample budget.
 *
 * @group Geometries
 */
export function sampleTrajectoryPlan(
  curve: Curve3D,
  spacing: number = DEFAULT_SAMPLE_SPACING,
): FenceSamples | null {
  const length = curve.length;
  if (!(length > 0)) return null;

  const count = Math.min(
    MAX_SAMPLES,
    Math.max(8, Math.ceil(length / Math.max(spacing, 1)) + 1),
  );
  let positions: number[] = [];
  for (let i = 0; i < count; i++) positions.push(i / (count - 1));

  const planOf = (u: number): Vec2 => {
    const p = curve.getPointAt(u);
    return [p[0], p[2]];
  };
  const turnAt = (a: Vec2, b: Vec2, c: Vec2): number => {
    const ax = b[0] - a[0];
    const az = b[1] - a[1];
    const bx = c[0] - b[0];
    const bz = c[1] - b[1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < REFINE_MIN_STEP || lb < REFINE_MIN_STEP) return 0;
    const cos = (ax * bx + az * bz) / (la * lb);
    return Math.acos(Math.min(1, Math.max(-1, cos)));
  };

  let inserted = 0;
  for (let round = 0; round < 4; round++) {
    if (positions.length >= MAX_SAMPLES) break;
    const plan = positions.map(planOf);
    const flagged = new Set<number>();
    for (let i = 1; i + 1 < plan.length; i++) {
      if (turnAt(plan[i - 1], plan[i], plan[i + 1]) <= REFINE_TURN) continue;
      flagged.add(i - 1);
      flagged.add(i);
    }
    if (flagged.size === 0) break;
    const next: number[] = [];
    for (let i = 0; i < positions.length; i++) {
      next.push(positions[i]);
      if (flagged.has(i) && i + 1 < positions.length) {
        next.push((positions[i] + positions[i + 1]) * 0.5);
        inserted++;
      }
    }
    positions = next;
  }
  if (positions.length > MAX_SAMPLES) {
    const step = positions.length / MAX_SAMPLES;
    const trimmed: number[] = [];
    for (let i = 0; i < MAX_SAMPLES; i++) {
      trimmed.push(positions[Math.floor(i * step)]);
    }
    trimmed[trimmed.length - 1] = 1;
    positions = trimmed;
  }

  const n = positions.length;
  const plan: Vec2[] = new Array(n);
  const y = new Float64Array(n);
  const md = new Float64Array(n);
  const planSpeed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = positions[i];
    const p = curve.getPointAt(u);
    plan[i] = [p[0], p[2]];
    y[i] = p[1];
    md[i] = u * length;
    const t = curve.getTangentAt(u);
    planSpeed[i] = Math.min(1, Math.hypot(t[0], t[2]));
  }

  let maxTurn = 0;
  for (let i = 1; i + 1 < n; i++) {
    const turn = turnAt(plan[i - 1], plan[i], plan[i + 1]);
    if (turn > maxTurn) maxTurn = turn;
  }

  return { plan, y, md, planSpeed, inserted, maxTurn };
}

/** Where a well stops being vertical. */
export type FenceKickoff = {
  /** sample index, or 0 when the well deviates from the start */
  index: number;
  md: number;
  y: number;
  /** whether a kickoff was actually found */
  found: boolean;
};

/** `planSpeed` averaged over an MD window, so one noisy station cannot trip it. */
function smoothPlanSpeed(samples: FenceSamples, window: number): Float64Array {
  const { planSpeed, md } = samples;
  const n = planSpeed.length;
  const out = new Float64Array(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const from = md[i] - window * 0.5;
    const to = md[i] + window * 0.5;
    while (hi < n && md[hi] <= to) sum += planSpeed[hi++];
    while (lo < n && md[lo] < from) sum -= planSpeed[lo++];
    out[i] = hi > lo ? sum / (hi - lo) : planSpeed[i];
  }
  return out;
}

/**
 * The deepest point above which the well has not started deviating.
 *
 * ⭐ Everything shallower is a candidate for being dropped from the fence outright,
 * and is in any case given a wide tolerance corridor: there is no plan shape up
 * there to follow, only survey scatter.
 *
 * @group Geometries
 */
export function fenceKickoff(samples: FenceSamples): FenceKickoff {
  const speed = smoothPlanSpeed(samples, KICKOFF_WINDOW);
  const n = speed.length;
  for (let i = 0; i < n; i++) {
    if (speed[i] < KICKOFF_SPEED) continue;
    // Confirm it STAYS deviated, or a single kink in the vertical section reads as
    // the kickoff and nothing above it is ever considered for trimming.
    let confirmed = true;
    for (
      let j = i;
      j < n && samples.md[j] - samples.md[i] < KICKOFF_WINDOW;
      j++
    ) {
      if (speed[j] < KICKOFF_SPEED * 0.75) {
        confirmed = false;
        break;
      }
    }
    if (!confirmed) continue;
    return { index: i, md: samples.md[i], y: samples.y[i], found: i > 0 };
  }
  return {
    index: 0,
    md: samples.md[0] ?? 0,
    y: samples.y[0] ?? 0,
    found: false,
  };
}

/** The plan trace a fence is built around: the well itself, lightly resampled. */
export type FenceBase = {
  /** scene XZ of the trajectory in plan, deduped and resampled at a uniform spacing */
  points: Vec2[];
  /** where the well stops being vertical — a diagnostic; nothing is trimmed on it */
  kickoff: FenceKickoff;
  /** plan length of the raw trace, in metres */
  planLength: number;
  /** a well with no plan direction of its own; the trace came from its spread */
  degenerate: boolean;
};

/** Diagonal of a plan curve's bounding box. */
function planExtent(points: Vec2[]): number {
  const [minX, minZ, maxX, maxZ] = polylineBounds2D(points);
  return Math.hypot(maxX - minX, maxZ - minZ);
}

/** {@link prepareFenceTrace} options. */
export type FenceBaseOptions = {
  /** MD step the 3D spline is sampled at, in metres. Default {@link SAMPLE_STEP}. */
  step?: number;
  /**
   * Plan angle to fall back to when the well has no direction of its own, in degrees
   * (scene XZ, 0 = +X). Default {@link DEFAULT_FALLBACK_ANGLE}.
   *
   * ⭐ Only used for a near-vertical (degenerate) well, whose plan spread is survey
   * scatter with no real bearing; a deviated well's own trajectory always overrides it.
   */
  fallbackAngle?: number;
};

/**
 * The trace a fence is built around: the wellbore's plan path, sampled DENSELY off the
 * 3D spline and then simplified in 2D.
 *
 * ⭐⭐ Sampled in 3D off the INTERPOLATOR, not off the survey stations and not off a 2D
 * projection. The wellbore is rendered along the same spline, which bulges past the
 * straight lines between stations; a fence built on the stations would cut inside the
 * hole it is meant to reveal. Sampling the 3D curve at a high rate and projecting every
 * sample captures the true plan extent, and `simplifyCurve2D` then drops the samples a
 * straight run made redundant — so the trace has the spline's SHAPE without its point
 * count.
 *
 * ⚠️ There is NO straightening and NO tolerance corridor. The old pipeline smoothed the
 * whole trace into one shared curve, which invented plan shape the survey never had (an
 * 8 m scatter came out a 400 m hook). The undesirable shapes are removed downstream, on
 * the path itself — see {@link followTrace}.
 *
 * @group Geometries
 */
export function prepareFenceTrace(
  curve: Curve3D,
  samples: FenceSamples,
  options: FenceBaseOptions = {},
): FenceBase {
  const step = options.step ?? SAMPLE_STEP;
  const kickoff = fenceKickoff(samples);
  const count = Math.max(2, Math.ceil(curve.length / Math.max(step, 0.5)));
  const dense: Vec2[] = new Array(count + 1);
  for (let i = 0; i <= count; i++) {
    const p = curve.getPointAt(i / count);
    dense[i] = [p[0], p[2]];
  }
  let points = simplifyCurve2D(
    dedupePolyline2D(dense, 0.25),
    undefined,
    SIMPLIFY_TOLERANCE,
  );
  let degenerate = false;
  if (planExtent(points) < MIN_PLAN_EXTENT) {
    // No plan direction of its own. The well is near-vertical, so its plan spread is
    // survey scatter with no real bearing — take the caller's fallback angle rather
    // than the scatter's arbitrary principal axis, and let the run-outs carry the cut.
    const angle =
      ((options.fallbackAngle ?? DEFAULT_FALLBACK_ANGLE) * Math.PI) / 180;
    const direction: Vec2 = [Math.cos(angle), Math.sin(angle)];
    let cx = 0;
    let cz = 0;
    for (const p of points) {
      cx += p[0];
      cz += p[1];
    }
    cx /= points.length;
    cz /= points.length;
    const half = Math.max(planExtent(points), MIN_PLAN_EXTENT) * 0.5;
    points = [
      [cx - direction[0] * half, cz - direction[1] * half],
      [cx + direction[0] * half, cz + direction[1] * half],
    ];
    degenerate = true;
  }
  return {
    points,
    kickoff,
    planLength: polylineLength(points),
    degenerate,
  };
}

/** Furthest positive ray/ring crossing, or 0 when the ray never meets one. */
function escapeDistance(
  origin: Vec2,
  direction: Vec2,
  rings: Vec2[][],
): number {
  let furthest = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const denominator = direction[0] * ez - direction[1] * ex;
      if (denominator === 0) continue;
      const dx = a[0] - origin[0];
      const dz = a[1] - origin[1];
      const t = (dx * ez - dz * ex) / denominator;
      const u = (direction[0] * dz - dx * direction[1]) / -denominator;
      if (t > furthest && u >= 0 && u <= 1) furthest = t;
    }
  }
  return furthest;
}

/** The bounds as a ring, so a ray is guaranteed to leave the raster. */
function boundsRing(bounds: [number, number, number, number]): Vec2[] {
  const [minX, minZ, maxX, maxZ] = bounds;
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
}

/** Direction of the last non-degenerate step at either end of a polyline. */
function endDirection(points: Vec2[], fromStart: boolean): Vec2 | null {
  const inward = endTangent2D(points, fromStart, JUNCTION_ARC);
  return inward ? [-inward[0], -inward[1]] : null;
}

/** Bearings from `apex` to every point further off than `near`, sorted. */
function bearingsFrom(points: Vec2[], apex: Vec2, near: number): number[] {
  const bearings: number[] = [];
  for (const p of points) {
    const vx = p[0] - apex[0];
    const vz = p[1] - apex[1];
    if (vx * vx + vz * vz < near * near) continue;
    bearings.push(Math.atan2(vz, vx));
  }
  return bearings.sort((a, b) => a - b);
}

/** Smallest angle between a direction and any occupied bearing. */
function clearanceOf(direction: Vec2, bearings: number[]): number {
  if (bearings.length === 0) return Math.PI;
  const at = Math.atan2(direction[1], direction[0]);
  let closest = Math.PI;
  for (const b of bearings) {
    let d = Math.abs(b - at);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < closest) closest = d;
  }
  return closest;
}

/** Every angular gap between the bearings a trace occupies, widest first. */
function bearingGaps(bearings: number[]): { mid: number; span: number }[] {
  const gaps: { mid: number; span: number }[] = [];
  for (let i = 0; i < bearings.length; i++) {
    const from = bearings[i];
    const to = bearings[(i + 1) % bearings.length];
    const span = i + 1 < bearings.length ? to - from : to + 2 * Math.PI - from;
    gaps.push({ mid: from + span * 0.5, span });
  }
  return gaps.sort((a, b) => b.span - a.span);
}

/**
 * Directions worth trying for a run-out: the end tangent when it clears the trace,
 * plus the middle of every gap wide enough to hold one.
 *
 * ⚠️⚠️ The raw end tangent is NOT seeded unconditionally. On a well that folds back
 * the head tangent points straight down the arm the well returns along, so the
 * run-out ends up beside the trace and the "cut" is a wedge closing to nothing at
 * the wellhead. It earns its place like any other candidate.
 */
function runOutCandidates(
  trace: Vec2[],
  apex: Vec2,
  tangent: Vec2,
  trend: Vec2,
  clearance: number,
  maxTurn: number,
): Vec2[] {
  const bearings = bearingsFrom(trace, apex, RUN_OUT_NEAR);
  if (bearings.length === 0) return [tangent];

  const out: Vec2[] = [];
  // Directions that clear the trace but turn too far to leave the head unburied.
  // Kept, because a well that fills every bearing around its own head would
  // otherwise be left with no run-out at all.
  const turned: Vec2[] = [];
  const turnLimit = Math.cos(maxTurn);
  const offer = (direction: Vec2) => {
    if (clearanceOf(direction, bearings) < clearance) return;
    const list =
      direction[0] * tangent[0] + direction[1] * tangent[1] >= turnLimit
        ? out
        : turned;
    for (const had of list) {
      if (had[0] * direction[0] + had[1] * direction[1] > 0.999) return;
    }
    list.push(direction);
  };
  offer(tangent);
  // ⭐⭐ The overall TREND, not just the local tangent. A well that is small next to
  // its field has an end tangent that says nothing about which way the fence has to
  // run to reach across the block, and a run-out aimed by it can leave the footprint
  // without ever crossing it — which splits the plane but not the block.
  offer(trend);

  const gaps = bearingGaps(bearings);
  for (const gap of gaps) {
    // Both flanks have to clear, so the gap must be twice the clearance wide —
    // the midpoint of a 0.2 rad gap clears less than 6 degrees.
    if (gap.span < 2 * clearance) continue;
    if (out.length >= RUN_OUT_CANDIDATES) break;
    offer([Math.cos(gap.mid), Math.sin(gap.mid)]);
  }

  if (out.length > 0) return out;
  if (turned.length > 0) return turned;

  // A well enclosed by its own trace clears nothing; take the roomiest direction
  // there is rather than leaving the caller with no cut at all.
  if (gaps.length > 0) {
    return [[Math.cos(gaps[0].mid), Math.sin(gaps[0].mid)]];
  }
  return [tangent];
}

/** A rasterised footprint, so a split can be scored against the BLOCK. */
export type OutlineMask = {
  mask: Uint8Array;
  nx: number;
  ny: number;
  cell: number;
  origin: Vec2;
  /** cells inside the footprint */
  area: number;
};

/**
 * Rasterise a footprint's rings, even-odd so holes stay holes.
 *
 * ⚠️⚠️ Scoring a split against the outline's BOUNDING BOX instead measures a
 * rectangle the block only partly fills, and a field footprint is concave enough to
 * fill it badly — an "even" split of the box can leave one half of the actual block
 * nearly empty.
 *
 * @group Geometries
 */
export function rasterizeOutline(
  rings: Vec2[][],
  bounds: [number, number, number, number],
  resolution?: number,
): OutlineMask {
  const [minX, minZ, maxX, maxZ] = bounds;
  // ⚠️ A fixed division count means a metre-sized cell that grows with the field, and
  // the score then cannot resolve a share it is supposed to be maximising.
  const divisions =
    resolution ??
    Math.min(
      SHARE_RESOLUTION_MAX,
      Math.max(
        SHARE_RESOLUTION,
        Math.round(Math.max(maxX - minX, maxZ - minZ) / SHARE_CELL),
      ),
    );
  const cell = Math.max(
    (maxX - minX) / divisions,
    (maxZ - minZ) / divisions,
    1e-6,
  );
  const nx = Math.ceil((maxX - minX) / cell) + 5;
  const ny = Math.ceil((maxZ - minZ) / cell) + 5;
  const origin: Vec2 = [minX - 2 * cell, minZ - 2 * cell];
  const mask = new Uint8Array(nx * ny);
  let area = 0;
  const crossings: number[] = [];
  for (let r = 0; r < ny; r++) {
    const z = origin[1] + r * cell;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a[1] === b[1]) continue;
        if (z < Math.min(a[1], b[1]) || z >= Math.max(a[1], b[1])) continue;
        crossings.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((crossings[k] - origin[0]) / cell));
      const c1 = Math.min(
        nx - 1,
        Math.floor((crossings[k + 1] - origin[0]) / cell),
      );
      for (let c = c0; c <= c1; c++) {
        if (!mask[r * nx + c]) {
          mask[r * nx + c] = 1;
          area++;
        }
      }
    }
  }
  return { mask, nx, ny, cell, origin, area };
}

/** Mark every cell a segment passes through, 8-connected. */
function rasterizeSegment(
  mask: Uint8Array,
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  let cx = Math.round(x0);
  let cy = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - cx);
  const dy = -Math.abs(ty - cy);
  const sx = cx < tx ? 1 : -1;
  const sy = cy < ty ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (cx >= 0 && cx < nx && cy >= 0 && cy < ny) mask[cy * nx + cx] = 1;
    if (cx === tx && cy === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
}

/** Field cells per bucket of the segment lookup. */
const SEGMENT_BUCKET = 4;

/** Buckets searched around a node before it is treated as far from the curve. */
const SEGMENT_RINGS = 3;

/**
 * Segments bucketed for nearest-point queries.
 *
 * ⚠️⚠️ Without this the distance pass is nodes x segments, which on a field-sized
 * footprint is tens of millions of tests and takes about a second — a visible stall
 * every time a well is selected. Bucketing makes it nodes x a handful.
 *
 * ⚠️ Segments are RASTERISED into bucket space rather than filling their bounding
 * box: a run-out crossing the whole grid diagonally has a bounding box covering
 * everything, and inserting it everywhere would defeat the point.
 */
function bucketSegments(
  positions: Vec2[],
  nx: number,
  ny: number,
  origin: Vec2,
  cell: number,
) {
  const size = SEGMENT_BUCKET * cell;
  const bx = Math.max(1, Math.ceil(nx / SEGMENT_BUCKET));
  const by = Math.max(1, Math.ceil(ny / SEGMENT_BUCKET));
  const counts = new Uint32Array(bx * by + 1);
  const pairs: number[] = [];
  const emit = (c: number, r: number, segment: number) => {
    // Dilated by one bucket, so a segment that only clips a bucket corner is still
    // found by a query from inside it.
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || cc >= bx || rr < 0 || rr >= by) continue;
        const key = rr * bx + cc;
        const at = pairs.length - 2;
        if (at >= 0 && pairs[at] === key && pairs[at + 1] === segment) continue;
        pairs.push(key, segment);
        counts[key + 1]++;
      }
    }
  };
  for (let i = 0; i + 1 < positions.length; i++) {
    const a = positions[i];
    const b = positions[i + 1];
    let c = Math.round((a[0] - origin[0]) / size);
    let r = Math.round((a[1] - origin[1]) / size);
    const tc = Math.round((b[0] - origin[0]) / size);
    const tr = Math.round((b[1] - origin[1]) / size);
    const dc = Math.abs(tc - c);
    const dr = -Math.abs(tr - r);
    const sc = c < tc ? 1 : -1;
    const sr = r < tr ? 1 : -1;
    let err = dc + dr;
    for (;;) {
      emit(c, r, i);
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

  // ⚠️ Flat CSR rather than a Map. Nearly every node of a field-sized grid is far
  // from the curve and probes a few dozen EMPTY buckets, so the lookup itself is
  // the cost of the whole pass — hashing them turned a 20 ms job into a 500 ms one.
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const cursor = counts.slice();
  const items = new Uint32Array(pairs.length / 2);
  for (let p = 0; p < pairs.length; p += 2) {
    items[cursor[pairs[p]]++] = pairs[p + 1];
  }
  // ⭐⭐ Which buckets could find ANYTHING within the search rings. Nearly every node
  // of a field-sized grid is far from the curve, and without this each one still
  // walks all 49 bucket lookups only to conclude there was nothing there — which is
  // the whole cost of the pass.
  const near = new Uint8Array(bx * by);
  for (let r = 0; r < by; r++) {
    for (let c = 0; c < bx; c++) {
      const key = r * bx + c;
      if (counts[key + 1] === counts[key]) continue;
      for (let dr = -SEGMENT_RINGS; dr <= SEGMENT_RINGS; dr++) {
        for (let dc = -SEGMENT_RINGS; dc <= SEGMENT_RINGS; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (cc < 0 || cc >= bx || rr < 0 || rr >= by) continue;
          near[rr * bx + cc] = 1;
        }
      }
    }
  }

  return { starts: counts, items, bx, by, size, near };
}

/**
 * Rasterise a curve into a barrier a flood fill cannot cross.
 *
 * ⚠️⚠️ The two END SEGMENTS are extended past the grid before rasterising. A fence
 * is only a partition if its curve leaves the raster at both ends, and "the run-out
 * is longer than the padding" is not something the curve can know: the padding is
 * two cells, the cell depends on the resolution, and a coarse raster over a large
 * field pads further than the run-out reaches. The fill then walks around the end
 * and calls the whole grid one side — measured as a 0/100 split on fields where the
 * geometry was perfectly good. Extending here makes the guarantee structural rather
 * than a constant the caller has to keep ahead of.
 */
function rasterizeCurve(
  curve: Vec2[],
  nx: number,
  ny: number,
  origin: Vec2,
  cell: number,
): Uint8Array {
  const barrier = new Uint8Array(nx * ny);
  const toC = (p: Vec2) => (p[0] - origin[0]) / cell;
  const toR = (p: Vec2) => (p[1] - origin[1]) / cell;
  if (curve.length === 1) {
    rasterizeSegment(
      barrier,
      nx,
      ny,
      toC(curve[0]),
      toR(curve[0]),
      toC(curve[0]),
      toR(curve[0]),
    );
    return barrier;
  }
  const beyond = (nx + ny) * cell;
  const pushedOut = (from: Vec2, apex: Vec2): Vec2 => {
    const dx = apex[0] - from[0];
    const dz = apex[1] - from[1];
    const length = Math.hypot(dx, dz);
    if (length <= 1e-9) return apex;
    return [apex[0] + (dx / length) * beyond, apex[1] + (dz / length) * beyond];
  };
  const points = curve.slice();
  points[0] = pushedOut(curve[1], curve[0]);
  points[points.length - 1] = pushedOut(
    curve[curve.length - 2],
    curve[curve.length - 1],
  );
  for (let i = 1; i < points.length; i++) {
    rasterizeSegment(
      barrier,
      nx,
      ny,
      toC(points[i - 1]),
      toR(points[i - 1]),
      toC(points[i]),
      toR(points[i]),
    );
  }
  return barrier;
}

/** 4-connected flood from `seed` over cells the barrier does not occupy. */
function floodFrom(
  barrier: Uint8Array,
  nx: number,
  ny: number,
  seed: number,
): Uint8Array {
  const seen = new Uint8Array(nx * ny);
  if (seed < 0 || seed >= barrier.length || barrier[seed]) return seen;
  const stack = [seed];
  seen[seed] = 1;
  while (stack.length > 0) {
    const at = stack.pop()!;
    const c = at % nx;
    const r = (at - c) / nx;
    if (c > 0 && !barrier[at - 1] && !seen[at - 1]) {
      seen[at - 1] = 1;
      stack.push(at - 1);
    }
    if (c < nx - 1 && !barrier[at + 1] && !seen[at + 1]) {
      seen[at + 1] = 1;
      stack.push(at + 1);
    }
    if (r > 0 && !barrier[at - nx] && !seen[at - nx]) {
      seen[at - nx] = 1;
      stack.push(at - nx);
    }
    if (r < ny - 1 && !barrier[at + nx] && !seen[at + nx]) {
      seen[at + nx] = 1;
      stack.push(at + nx);
    }
  }
  return seen;
}

/**
 * What fraction of the FOOTPRINT each half of a curve holds.
 *
 * ⭐ The quantity a run-out pair is judged by. A fence exists to take away what
 * stands between the viewer and the well, so what matters is that each half is a
 * usable piece of the block — a curve that carves a thin lens leaves one side
 * showing nothing and the other showing everything.
 *
 * @returns `[smaller, larger]`, summing to 1
 *
 * @group Geometries
 */
export function splitShares(
  curve: Vec2[],
  outline: OutlineMask,
): [number, number] {
  const { mask, nx, ny, cell, origin, area } = outline;
  if (area === 0) return [0, 1];
  const barrier = rasterizeCurve(curve, nx, ny, origin, cell);
  let seed = -1;
  for (let i = 0; i < barrier.length; i++) {
    if (!barrier[i]) {
      seed = i;
      break;
    }
  }
  if (seed < 0) return [0, 1];
  const seen = floodFrom(barrier, nx, ny, seed);
  let inSeed = 0;
  let other = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || barrier[i]) continue;
    if (seen[i]) inSeed++;
    else other++;
  }
  const total = inSeed + other;
  if (total === 0) return [0, 1];
  const a = inSeed / total;
  return a <= 0.5 ? [a, 1 - a] : [1 - a, a];
}

/** How a fence's run-outs continue past the ends of the well. */
export type FenceExtensionMode = 'straight';

/** One scored run-out pair. @group Geometries */
export type FenceCandidate = {
  start: Vec2;
  end: Vec2;
  /** share of the footprint the smaller half keeps, 0..0.5 */
  evenness: number;
  /** smaller of the two clearances, in radians */
  clearance: number;
};

/** The run-out pair, shared by both sides of a fence. */
export type FenceExtensions = {
  /** unit direction leaving the curve's first vertex */
  start: Vec2;
  /** unit direction leaving its last vertex */
  end: Vec2;
  /** opening the start run-out keeps from the trace, in radians */
  startClearance: number;
  /** opening the end run-out keeps from the trace, in radians */
  endClearance: number;
  /**
   * How far each run-out turns from the trace's own heading, in radians.
   *
   * ⭐ The measure that predicts a buried head: past a quarter turn the arm curves
   * back over the well. ⚠️ NOT `FenceSideReport.opening`, which compares the trace
   * with the run-out as if the junction were a corner — the arm is a spline, so the
   * corner it describes does not exist.
   */
  startTurn: number;
  endTurn: number;
  /** share of the footprint the SMALLER half keeps, 0..0.5 */
  evenness: number;
  /**
   * The SHARED gather point at each end, in scene XZ — where both sides' approach arcs
   * converge before the identical straight run to the tip. Computed here so both sides
   * read one point and cannot diverge.
   */
  startGather: Vec2;
  endGather: Vec2;
  /** the SHARED run-out tip at each end, in scene XZ (past the footprint) */
  startTip: Vec2;
  endTip: Vec2;
  /** metres each run-out reaches from its apex to the tip */
  startReach: number;
  endReach: number;
  /** direction pairs scored */
  scored: number;
  /**
   * Every pair that was scored, best first.
   *
   * ⭐ Kept so a failure can be read as "the search picked badly" or "nothing on
   * offer was any good", which need completely different fixes.
   */
  candidates: FenceCandidate[];
  mode: FenceExtensionMode;
};

/** {@link fenceExtensions} options. */
export type FenceExtensionOptions = {
  rings: Vec2[][];
  bounds: [number, number, number, number];
  outline: OutlineMask;
  /** metres to clear the footprint by. Default 500. */
  runOutMargin?: number;
  /** opening a run-out must keep from the trace, in radians. Default 45°. */
  clearance?: number;
  /** how far a run-out may turn from the trace's heading, in radians. Default 90°. */
  maxTurn?: number;
  /** the CUT clearance (margin), in metres — the floor the TD arm must hold. Default 0. */
  margin?: number;
  /** render-radius slack: arms must clear the well by `margin - tolerance`. Default {@link MIN_WELL_RADIUS}. */
  tolerance?: number;
  /** plan spacing the shared run is resampled to, in metres. Default {@link FOLLOW_SPACING}. */
  spacing?: number;
  /**
   * The two sides' cores (offset+smoothed, no run-outs). When present, each candidate
   * direction is scored on the ACTUAL arms it would grow — the TD arm strictly (it must
   * hold the margin), the head arm loosely (it may over-clear). Absent, only evenness is used.
   */
  cores?: { plus: Vec2[]; minus: Vec2[] };
  /** a near-vertical well, whose two arms are pulled onto one straight axis when possible */
  nearVertical?: boolean;
  mode?: FenceExtensionMode;
};

/**
 * Choose the run-out direction at each end — ONE pair, used by both sides.
 *
 * ⭐⭐ Shared deliberately. The two halves should be flip sides of one section, so
 * that a viewer comparing them is comparing one cut; only the repairs a particular
 * side needs are allowed to differ, and those are local to a junction.
 *
 * ⚠️⚠️ Clearance is a CONSTRAINT and evenness is the OBJECTIVE, and neither
 * subsumes the other. A run-out folded back alongside the well still splits the
 * block evenly, so it scores well while the cut it opens closes to nothing at the
 * wellhead — which is why candidates are filtered by clearance before anything is
 * scored, rather than the two being traded off.
 *
 * ⚠️ Every pair is scored on the curve that would ACTUALLY be built, run-outs
 * attached and de-looped. Scoring an idealised curve and building a different one
 * is how an optimiser ends up optimising something nobody sees.
 *
 * @group Geometries
 */
export function fenceExtensions(
  base: Vec2[],
  options: FenceExtensionOptions,
): FenceExtensions {
  const clearance = options.clearance ?? RUN_OUT_CLEARANCE;
  const maxTurn = options.maxTurn ?? MAX_RUN_OUT_TURN;
  const margin = options.runOutMargin ?? DEFAULT_RUN_OUT_MARGIN;
  const marginClear = options.margin ?? 0;
  const tolerance = options.tolerance ?? MIN_WELL_RADIUS;
  const spacing = options.spacing ?? FOLLOW_SPACING;
  const cores = options.cores;
  const nearVertical = options.nearVertical ?? false;
  // ⚠️⚠️ The curve has to leave the RASTER, not merely the outline: one that
  // escapes a concave footprint can still stop inside its bounding box, and the
  // flood fill that signs the field then walks around the end of it and calls the
  // whole grid one side.
  const rings = [...options.rings, boundsRing(options.bounds)];

  const first = base[0];
  const last = base[base.length - 1];
  const endTangent = endDirection(base, false) ?? [1, 0];
  const startTangent = endDirection(base, true) ?? [-1, 0];
  // The chord, which for a small well in a large field is far steadier than either
  // end tangent and is the direction that actually reaches across the block.
  const chordX = last[0] - first[0];
  const chordZ = last[1] - first[1];
  const chordLength = Math.hypot(chordX, chordZ) || 1;
  const trend: Vec2 = [chordX / chordLength, chordZ / chordLength];

  const starts = runOutCandidates(
    base,
    first,
    startTangent,
    [-trend[0], -trend[1]],
    clearance,
    maxTurn,
  );
  const ends = runOutCandidates(
    base,
    last,
    endTangent,
    trend,
    clearance,
    maxTurn,
  );
  const startBearings = bearingsFrom(base, first, RUN_OUT_NEAR);
  const endBearings = bearingsFrom(base, last, RUN_OUT_NEAR);
  const turnFrom = (direction: Vec2, heading: Vec2) =>
    Math.acos(
      Math.max(
        -1,
        Math.min(1, direction[0] * heading[0] + direction[1] * heading[1]),
      ),
    );
  const reach = (origin: Vec2, direction: Vec2) =>
    escapeDistance(origin, direction, rings) + margin;

  // Shared per-end geometry: the tip past the footprint and the gather point both sides
  // converge onto. Keyed only on apex + direction, so the two sides read one point.
  const gatherOf = (apex: Vec2, direction: Vec2, r: number): Vec2 => {
    const d = Math.min(
      r * 0.9,
      Math.max(
        RUN_OUT_GATHER_MIN,
        Math.min(RUN_OUT_GATHER_MAX, r * RUN_OUT_GATHER_FRACTION),
      ),
    );
    return [apex[0] + direction[0] * d, apex[1] + direction[1] * d];
  };
  const endGeom = (apex: Vec2, direction: Vec2) => {
    const r = reach(apex, direction);
    const tip: Vec2 = [apex[0] + direction[0] * r, apex[1] + direction[1] * r];
    return { r, tip, gather: gatherOf(apex, direction, r) };
  };

  // ⭐⭐ Score each candidate on the ARMS it would actually grow, against BOTH cores. The
  // TD end is DOMINANT and strict — its arm must hold the margin (less the linear slack) —
  // while the head end may over-clear, so it is rejected only for BURYING (crossing the
  // well or grazing it). This is what lets the chosen bearings keep both sides clear.
  const tdFloor = marginClear - tolerance;
  const scoreEnd = (direction: Vec2) => {
    if (!cores) return { feasible: true, turn: 0 };
    const g = endGeom(last, direction);
    let clear = Infinity;
    let turn = 0;
    let cross = false;
    for (const core of [cores.plus, cores.minus]) {
      const arm = buildRunOutArm(
        core,
        base,
        false,
        direction,
        g.gather,
        g.tip,
        spacing,
        marginClear,
        tolerance,
      );
      clear = Math.min(clear, arm.minClearance);
      turn = Math.max(turn, arm.turn);
      if (arm.crossesWell) cross = true;
    }
    return { feasible: !cross && clear >= tdFloor, turn };
  };
  const scoreStart = (direction: Vec2) => {
    if (!cores) return { feasible: true, turn: 0 };
    const g = endGeom(first, direction);
    let turn = 0;
    let ok = true;
    for (const core of [cores.plus, cores.minus]) {
      const arm = buildRunOutArm(
        core,
        base,
        true,
        direction,
        g.gather,
        g.tip,
        spacing,
        marginClear,
        tolerance,
      );
      turn = Math.max(turn, arm.turn);
      if (arm.crossesWell || arm.minClearance < marginClear - tolerance)
        ok = false;
    }
    return { feasible: ok, turn };
  };

  const endScored = ends.map(e => ({ dir: e, ...scoreEnd(e) }));
  const startScored = starts.map(s => ({ dir: s, ...scoreStart(s) }));
  // Prefer feasible bearings, but never leave the caller with no run-out at all.
  const feasibleEnds = endScored.filter(x => x.feasible);
  const usableEnds = feasibleEnds.length ? feasibleEnds : endScored;
  const feasibleStarts = startScored.filter(x => x.feasible);
  const usableStarts = feasibleStarts.length ? feasibleStarts : startScored;

  const candidates: FenceCandidate[] = [];
  let best: FenceExtensions | null = null;
  let bestScore = -Infinity;
  let bestArmTurn = Infinity;
  let scored = 0;
  for (const sItem of usableStarts) {
    const s = sItem.dir;
    const sGeom = endGeom(first, s);
    for (const eItem of usableEnds) {
      const e = eItem.dir;
      const eGeom = endGeom(last, e);
      const curve = removePolylineLoops([sGeom.tip, ...base, eGeom.tip]);
      scored++;
      const [smaller] = splitShares(curve, options.outline);
      const startClearance = clearanceOf(s, startBearings);
      const endClearance = clearanceOf(e, endBearings);
      // Near-vertical: reward the two arms sharing one straight axis (end ≈ -start).
      const collinear = nearVertical
        ? RUN_OUT_COLLINEAR_BONUS * Math.max(0, -(s[0] * e[0] + s[1] * e[1]))
        : 0;
      const score = smaller + collinear;
      const armTurn = sItem.turn + eItem.turn;
      candidates.push({
        start: s,
        end: e,
        evenness: smaller,
        clearance: Math.min(startClearance, endClearance),
      });
      const candidate: FenceExtensions = {
        start: s,
        end: e,
        startClearance,
        endClearance,
        startTurn: turnFrom(s, startTangent),
        endTurn: turnFrom(e, endTangent),
        evenness: smaller,
        startGather: sGeom.gather,
        endGather: eGeom.gather,
        startTip: sGeom.tip,
        endTip: eGeom.tip,
        startReach: sGeom.r,
        endReach: eGeom.r,
        scored: 0,
        candidates: [],
        mode: options.mode ?? 'straight',
      };
      const clearanceSum = startClearance + endClearance;
      const better =
        !best ||
        score > bestScore + 1e-4 ||
        // Tie on the objective: prefer the smoother arms, then the roomier bearings.
        (Math.abs(score - bestScore) <= 1e-4 && armTurn < bestArmTurn - 1e-3) ||
        (Math.abs(score - bestScore) <= 1e-4 &&
          Math.abs(armTurn - bestArmTurn) <= 1e-3 &&
          clearanceSum > best.startClearance + best.endClearance);
      if (better) {
        best = candidate;
        bestScore = score;
        bestArmTurn = armTurn;
      }
    }
  }

  let result: FenceExtensions;
  if (best) {
    result = best;
  } else {
    const g0 = endGeom(first, startTangent);
    const g1 = endGeom(last, endTangent);
    result = {
      start: startTangent,
      end: endTangent,
      startClearance: clearanceOf(startTangent, startBearings),
      endClearance: clearanceOf(endTangent, endBearings),
      startTurn: 0,
      endTurn: 0,
      evenness: 0,
      startGather: g0.gather,
      endGather: g1.gather,
      startTip: g0.tip,
      endTip: g1.tip,
      startReach: g0.r,
      endReach: g1.r,
      scored: 0,
      candidates: [],
      mode: options.mode ?? 'straight',
    };
  }
  result.scored = scored;
  result.candidates = candidates.sort((a, b) => b.evenness - a.evenness);
  return result;
}

/** One side's finished curve, ready to be rasterised and swept. */
export type FenceSideCurve = {
  /** 1 removes the half the left normal points into, -1 the other */
  side: 1 | -1;
  /** scene XZ: run-out, the one-sided cut, run-out */
  points: Vec2[];
  /**
   * The followed path WITHOUT run-outs — the part of the cut that traces the well.
   *
   * ⭐ This is what the path work is judged on: the one-sided geodesic of the trace,
   * keeping the whole well on the removed side. It is genuinely different per side —
   * one follows a bend, the other bridges it. The run-outs are a separate concern.
   */
  core: Vec2[];
  /** turn where each run-out joins the followed trace, in radians (0 = smooth) */
  opening: [number, number];
  /**
   * Bridges the geodesic made across the removed side.
   *
   * ⭐0 means the cut followed the trace the whole way (this is the tight-follow
   * side); more means it had to cut across loops or the inside of doglegs (the
   * bridging side). It is the honest measure of how much this side gives up.
   */
  bridges: number;
  /** loops the safety de-loop had to remove — should be 0 */
  loopsRemoved: number;
  /** largest turn within the fold window, in radians */
  maxTurn: number;
};

/** {@link buildFenceSideCurve} options. */
export type FenceSideOptions = {
  rings: Vec2[][];
  bounds: [number, number, number, number];
  /** metres of clearance kept between the trajectory and the cut. Default 0. */
  margin?: number;
  /** metres to clear the footprint by. Default 500. */
  runOutMargin?: number;
  /** plan spacing the cut is resampled to, in metres. Default 25. */
  spacing?: number;
  /** the well's own plan trace, which the cut is kept clear of */
  well?: Vec2[];
  /**
   * The precomputed core for this side (offset+smoothed, no run-outs). When supplied it
   * is reused rather than rebuilt — the same core {@link fenceExtensions} scored against.
   */
  core?: Vec2[];
  /**
   * metres a NON-defect vertex may be simplified away by. 0 (default) keeps the cut
   * hugging real bends and only bridges defects; larger coarsens smooth stretches too.
   */
  simplify?: number;
  /** the simplify's arm-weighted sharp-turn threshold, in radians. Default 30°. */
  sharpTurn?: number;
  /** the simplify's per-side arm cap, in metres. Default 10. */
  sharpArm?: number;
  /** render-radius slack: the cut aims to clear the well by `margin - tolerance`. Default 0.1. */
  tolerance?: number;
};

/**
 * The trajectory as the fence follows it: the dense spline path with only its
 * coincident points removed, and NOTHING else moved.
 *
 * ⚠️⚠️ At margin 0 the cut must hug the trajectory to within the wellbore's own radius
 * (down to 0.1 m) or the hole is buried in the block it is meant to reveal. So this does
 * NOT smooth and does NOT simplify: any move off the well toward the KEPT side buries it.
 * Convex, concave and alternating sections are all FOLLOWED exactly.
 *
 * ⚠️ Self-crossings are NOT removed here — that is the one place the two sides must
 * differ, so it is done per side by {@link repairLoopsOneSided}, which bridges each loop
 * onto the half being removed rather than chording through the middle.
 */
function followTrace(trace: Vec2[]): Vec2[] {
  return dedupePolyline2D(trace, 0.5);
}

/** The turn a polyline makes at the vertex nearest a point, in radians. */
function turnNear(points: Vec2[], at: Vec2): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 1; i + 1 < points.length; i++) {
    const d = (points[i][0] - at[0]) ** 2 + (points[i][1] - at[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 1) return 0;
  const ax = points[best][0] - points[best - 1][0];
  const az = points[best][1] - points[best - 1][1];
  const bx = points[best + 1][0] - points[best][0];
  const bz = points[best + 1][1] - points[best][1];
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const cos = (ax * bx + az * bz) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/**
 * One side's cut CORE — the followed, one-sided-repaired, offset-and-smoothed plan path
 * WITHOUT run-outs.
 *
 * ⭐ Built once per side up front and shared with {@link fenceExtensions}, so the run-out
 * bearings are chosen against the very geometry their arms will attach to.
 *
 * @group Geometries
 */
export function buildFenceCore(
  well: Vec2[],
  side: 1 | -1,
  margin: number,
  tolerance = MIN_WELL_RADIUS,
): Vec2[] {
  const clearance = margin;
  // FOLLOW the trajectory, then repair only its self-crossings, one-sided.
  const follow = followTrace(well);
  const repaired = repairLoopsOneSided(follow, side, MIN_WELL_RADIUS);
  // A positive margin pushes the cut toward the KEPT half so the well sits `margin` inside
  // the REMOVED half, dissolving any fold a bend tighter than the margin would make.
  const offsetCore =
    clearance > 0
      ? offsetPolyline2DDissolved(repaired, side, clearance)
      : repaired;
  // Round the offset's bends within a fraction of the margin so it cannot bury the well —
  // but never let the rounding pull a vertex back inside the margin it just established.
  return clearance > 0
    ? smoothPolyline2DWithinDisc(
        offsetCore,
        clearance * SMOOTH_MARGIN_FRACTION,
        SMOOTH_PASSES,
        { well, minClearance: clearance - tolerance },
      )
    : offsetCore;
}

/** One end's run-out arm and how well its turn clears the well. */
type RunOutArm = {
  /** the arm polyline, oriented from the core junction OUT to the shared tip */
  points: Vec2[];
  /** the core index the arm leaves from: the head trim, or the TD end past any noise */
  coreIndex: number;
  /** smallest distance from the arm's turn to the well, in metres */
  minClearance: number;
  /** whether the arm's turn crosses the well — a burial */
  crossesWell: boolean;
  /** turn from the core's exit tangent onto the escape bearing, in radians */
  turn: number;
};

/**
 * Unit OUTWARD tangent where a run-out leaves the core at `index`, averaged over an arc
 * so a single noisy segment cannot define it.
 */
function coreExitTangent(core: Vec2[], index: number, isHead: boolean): Vec2 {
  const sub = isHead ? core.slice(index) : core.slice(0, index + 1);
  const inward = endTangent2D(sub, isHead, JUNCTION_ARC);
  if (inward) return [-inward[0], -inward[1]];
  // Degenerate stub: fall back to the chord to the adjacent vertex.
  const other =
    core[
      isHead ? Math.min(core.length - 1, index + 1) : Math.max(0, index - 1)
    ];
  const dx = core[index][0] - other[0];
  const dz = core[index][1] - other[1];
  const l = Math.hypot(dx, dz) || 1;
  return isHead ? [dx / l, dz / l] : [-dx / l, -dz / l];
}

/**
 * Build one end's arm from a specific core vertex: a G1 cubic Bézier from `core[index]`
 * (leaving along the core's exit tangent) onto the shared gather point (arriving along the
 * escape bearing), then the identical straight run to the shared tip.
 */
function buildArmAt(
  core: Vec2[],
  well: Vec2[],
  index: number,
  isHead: boolean,
  direction: Vec2,
  gather: Vec2,
  tip: Vec2,
  spacing: number,
): RunOutArm {
  const start = core[index];
  const outward = coreExitTangent(core, index, isHead);
  const span = Math.hypot(gather[0] - start[0], gather[1] - start[1]) || 1;
  const k = RUN_OUT_ARC_HANDLE * span;
  const p1: Vec2 = [start[0] + outward[0] * k, start[1] + outward[1] * k];
  const p2: Vec2 = [gather[0] - direction[0] * k, gather[1] - direction[1] * k];
  const arc = cubicBezier2D(start, p1, p2, gather, RUN_OUT_ARC_SAMPLES);
  const run = resamplePolyline2D([gather, tip], spacing);
  const points = run.length > 1 ? [...arc, ...run.slice(1)] : arc;
  // ⭐ Clearance and crossing are tested on the ARC alone — the straight run leaves along
  // the escape bearing and only gets further from the well.
  let minClearance = Infinity;
  const hit = { point: [0, 0] as Vec2, distance: 0, along: 0 };
  for (const p of arc) {
    const h = nearestOnPolyline(well, p[0], p[1], hit);
    if (h && h.distance < minClearance) minClearance = h.distance;
  }
  let crosses = false;
  for (let i = 1; i < arc.length && !crosses; i++) {
    if (
      segmentPolylineCrossings(
        arc[i - 1][0],
        arc[i - 1][1],
        arc[i][0],
        arc[i][1],
        well,
      ) > 0
    ) {
      crosses = true;
    }
  }
  const dot = outward[0] * direction[0] + outward[1] * direction[1];
  const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
  return {
    points,
    coreIndex: index,
    minClearance,
    crossesWell: crosses,
    turn,
  };
}

/**
 * Build one end's run-out arm.
 *
 * ⭐⭐ The two ends are NOT symmetric. The TD end (`isHead` false) is DOMINANT: it leaves
 * exactly along the core's tangent and does not trim, and a spurious final vertex is
 * dropped so a tiny bend cannot kink the junction. The HEAD end is flexible but not eager:
 * it trims the near-head core back only as much as it takes to leave cleanly, since
 * over-clearing the head is fine but not wanted where the head already leaves smoothly.
 */
function buildRunOutArm(
  core: Vec2[],
  well: Vec2[],
  isHead: boolean,
  direction: Vec2,
  gather: Vec2,
  tip: Vec2,
  spacing: number,
  margin: number,
  tolerance: number,
): RunOutArm {
  const n = core.length;
  if (!isHead) {
    let end = n - 1;
    for (let drop = 0; drop < 3 && end > 1; drop++) {
      const robust = coreExitTangent(core, end, false);
      let sx = core[end][0] - core[end - 1][0];
      let sz = core[end][1] - core[end - 1][1];
      const l = Math.hypot(sx, sz) || 1;
      sx /= l;
      sz /= l;
      const dot = sx * robust[0] + sz * robust[1];
      if (Math.acos(Math.max(-1, Math.min(1, dot))) <= RUN_OUT_SPURIOUS_TURN)
        break;
      end--;
    }
    return buildArmAt(core, well, end, false, direction, gather, tip, spacing);
  }
  // Head: trim only as much as NEEDED. Walk from no trim outward and take the FIRST arm
  // that leaves cleanly (does not cross or graze the well) with a junction turn already
  // under RUN_OUT_HEAD_TURN_OK — so a head that leaves smoothly is followed closely rather
  // than over-cleared. Fall back to the gentlest clean arm, then to the least-bad one.
  const maxIndex = Math.max(0, n - 3);
  const step = RUN_OUT_HEAD_TRIM_MAX / RUN_OUT_TRIM_STEPS;
  let idx = 0;
  let arc = 0;
  let firstClean: RunOutArm | null = null;
  let gentlestClean: RunOutArm | null = null;
  let bestAny: RunOutArm | null = null;
  for (let s = 0; s <= RUN_OUT_TRIM_STEPS; s++) {
    const target = s * step;
    while (idx < maxIndex && arc < target) {
      arc += Math.hypot(
        core[idx + 1][0] - core[idx][0],
        core[idx + 1][1] - core[idx][1],
      );
      idx++;
    }
    const arm = buildArmAt(
      core,
      well,
      Math.min(idx, maxIndex),
      true,
      direction,
      gather,
      tip,
      spacing,
    );
    if (!bestAny || arm.turn < bestAny.turn) bestAny = arm;
    if (!arm.crossesWell && arm.minClearance >= margin - tolerance) {
      if (!gentlestClean || arm.turn < gentlestClean.turn) gentlestClean = arm;
      if (!firstClean && arm.turn <= RUN_OUT_HEAD_TURN_OK) firstClean = arm;
    }
    if (idx >= maxIndex) break;
  }
  return (
    firstClean ??
    gentlestClean ??
    bestAny ??
    buildArmAt(core, well, 0, true, direction, gather, tip, spacing)
  );
}

/**
 * Attach the two run-outs to a core, converging on the shared gather points and running
 * to the shared tips.
 *
 * ⚠️ ONE place builds both ends, so the head bearing can never be paired with the TD apex
 * or the tips swapped — a mismatch that has happened before. The head arm is reversed onto
 * the front; the middle is the core between the two junctions; the TD arm runs off the back.
 */
function attachRunOuts(
  core: Vec2[],
  well: Vec2[],
  extensions: FenceExtensions,
  spacing: number,
  margin: number,
  tolerance: number,
): { points: Vec2[]; headArm: RunOutArm; tdArm: RunOutArm } {
  const headArm = buildRunOutArm(
    core,
    well,
    true,
    extensions.start,
    extensions.startGather,
    extensions.startTip,
    spacing,
    margin,
    tolerance,
  );
  const tdArm = buildRunOutArm(
    core,
    well,
    false,
    extensions.end,
    extensions.endGather,
    extensions.endTip,
    spacing,
    margin,
    tolerance,
  );
  let headStart = headArm.coreIndex;
  let tdEnd = tdArm.coreIndex;
  let head = headArm;
  let td = tdArm;
  if (headStart >= tdEnd) {
    // The trims met — the core is too short to carry both arms. Fall back to the untrimmed
    // ends so the two run-outs cannot cross inside the core.
    head = buildArmAt(
      core,
      well,
      0,
      true,
      extensions.start,
      extensions.startGather,
      extensions.startTip,
      spacing,
    );
    td = buildArmAt(
      core,
      well,
      core.length - 1,
      false,
      extensions.end,
      extensions.endGather,
      extensions.endTip,
      spacing,
    );
    headStart = 0;
    tdEnd = core.length - 1;
  }
  const midCore = core.slice(headStart, tdEnd + 1);
  const points = [
    ...[...head.points].reverse().slice(0, -1),
    ...midCore,
    ...td.points.slice(1),
  ];
  return { points, headArm: head, tdArm: td };
}

/**
 * One side's finished cut: the well's plan trace offset to the KEPT side, smoothed,
 * with a straight run-out to a SHARED tip at each end.
 *
 * ⭐⭐ The core is the one-sided geodesic of the well's own plan trace: a taut string
 * pulled against the trace from the half being REMOVED. It follows the well where the
 * well bends toward the KEPT side and bridges across loops, cusps and the inside of
 * doglegs on the removed side, so the whole well stays on the removed side and cannot
 * be buried. A small tolerance lets it bridge kept-side survey scatter up to one
 * render radius too, cleaning the noise without burying more than the well's radius.
 * There is no shared straightened base curve — each side is built from the raw trace.
 *
 * ⭐ The clearance is baked into the curve, so the field is a plain signed distance to
 * it and the drawn face and the removed block are one object. `-side` ties the offset
 * to the same `leftNormal2D` the field seed uses, so the two agree on which half is
 * removed. Because the cut follows the well their normals agree, which is why the
 * offset direction is unambiguous on BOTH sides — the failure mode of a curve that
 * crosses the well at a right angle.
 *
 * ⭐⭐ The run-outs converge to a gate SHARED by both sides and then run the identical
 * straight line to the SAME tip, so swapping which half is removed swaps the cut but
 * not the run-outs — the viewer reads one section from two sides, not two unrelated
 * cuts. A final push clear of the well guarantees no run-out can bury the head.
 *
 * ⭐ The two sides are genuinely different curves — one follows the outside of a bend,
 * the other the inside — so the offset is built once per side. With no clearance and a
 * straight well they coincide, and {@link FenceReport.shared} says so.
 *
 * @param well the well's plan trajectory, head to TD
 * @param extensions the run-out directions, shared by both sides
 * @param side which half is REMOVED
 * @param options see {@link FenceSideOptions}
 *
 * @group Geometries
 */
export function buildFenceSideCurve(
  well: Vec2[],
  extensions: FenceExtensions,
  side: 1 | -1,
  options: FenceSideOptions,
): FenceSideCurve {
  const margin = options.margin ?? 0;
  const spacing = options.spacing ?? FOLLOW_SPACING;
  const tolerance = options.tolerance ?? MIN_WELL_RADIUS;

  // The core is the followed, one-sided-repaired, offset+smoothed path — reused from the
  // extension scoring when supplied so the arms attach to the very geometry that was scored.
  const core = options.core ?? buildFenceCore(well, side, margin, tolerance);

  // Bridges: the long spans where the cut had to leave the trace to stay simple.
  let bridges = 0;
  for (let i = 0; i + 1 < core.length; i++) {
    const span = Math.hypot(
      core[i + 1][0] - core[i][0],
      core[i + 1][1] - core[i][1],
    );
    if (span > 3 * spacing) bridges++;
  }

  // ⭐⭐ SHARED run-outs: both sides bend from their own core end onto the SAME gather
  // point and then follow the identical straight run to the SAME tip. The TD arm holds the
  // core tangent (dominant); the head arm may trim and over-clear. G1 by construction, so
  // there is no junction corner to smooth away afterwards.
  const {
    points: raw,
    headArm,
    tdArm,
  } = attachRunOuts(core, well, extensions, spacing, margin, tolerance);

  const loopsRemoved = countPolylineLoops(raw);
  const deLooped = removePolylineLoops(raw);
  // ⭐⭐ CLEARANCE-CONSTRAINED simplify — replaces the flat 2 m dedup that coarsened the
  // cut through every bend and let the well poke across into the block. A longer segment
  // only ever leaves a LARGER clearance gap, never a smaller one, and a skipped vertex is
  // dropped only where it is already sharp (a loop/zig-zag/pinch worth bridging across) or
  // within `simplify` metres of the chord. At simplify 0 the cut keeps hugging real bends.
  const simplify = options.simplify ?? DEFAULT_SIMPLIFY;
  const simplified = simplifyPolylineClearOf(
    deLooped,
    well,
    Math.max(0, margin - tolerance),
    simplify,
    options.sharpTurn ?? CONSTRUCT_SHARP_TURN,
    options.sharpArm ?? CONSTRUCT_SHARP_ARM,
  );
  // Only exact coincidences remain to remove — the density is now the simplify's business.
  const points = dedupePolyline2D(simplified, 0.1);

  // ⚠️ MATCHING GUARD: the assembled cut must terminate on the SHARED tips. A head bearing
  // paired with the TD apex, or a swapped gather/tip, lands it elsewhere and throws here
  // rather than silently building a mismatched pair of sides.
  const startMiss = Math.hypot(
    points[0][0] - extensions.startTip[0],
    points[0][1] - extensions.startTip[1],
  );
  const endMiss = Math.hypot(
    points[points.length - 1][0] - extensions.endTip[0],
    points[points.length - 1][1] - extensions.endTip[1],
  );
  if (startMiss > 1e-3 || endMiss > 1e-3) {
    throw new Error(
      'buildFenceSideCurve: assembled cut does not terminate on the shared run-out tips',
    );
  }

  return {
    side,
    points,
    core: dedupePolyline2D(core, 0.25),
    bridges,
    loopsRemoved,
    maxTurn: polylineMaxTurn(core, FOLD_WINDOW),
    // The turn the assembled cut actually makes at each junction — ~0 when the arm is G1.
    opening: [
      turnNear(points, core[headArm.coreIndex]),
      turnNear(points, core[tdArm.coreIndex]),
    ],
  };
}

/** A rasterised signed distance to a fence curve. */
export type FenceField = {
  /**
   * Signed distance in METRES, NEGATIVE on the half being REMOVED.
   *
   * ⚠️⚠️ The SIGN is exact everywhere; the MAGNITUDE only near the curve. Beyond the
   * search band it saturates, because nothing reads it there — the boundary itself
   * is evaluated from the segments (see `fence-segments.ts`) rather than from this
   * raster, which cannot reproduce a polyline however finely it is sampled.
   */
  values: Float32Array;
  /** the curve it was built from */
  positions: Vec2[];
  nx: number;
  ny: number;
  /** scene XZ of node (0, 0) */
  origin: Vec2;
  /** metres per cell */
  cell: number;
  min: number;
  max: number;
  /**
   * Cross-product sign, against the nearest segment, that means REMOVED.
   *
   * ⭐ Derived here by majority vote against the flood fill, and exported so an
   * exact per-point lookup can orient itself the same way rather than re-deriving
   * an orientation that might disagree.
   */
  removedCross: 1 | -1;
  /**
   * Whether the curve actually cut the grid in two.
   *
   * ⚠️ False means the flood fill walked around an end of the curve and the whole
   * field took one sign — the cut would then remove everything or nothing.
   */
  separated: boolean;
};

/** {@link createFenceField} options. */
export type FenceFieldOptions = {
  /** minX, minZ, maxX, maxZ in scene XZ — the area the field must cover */
  bounds: [number, number, number, number];
  /** target metres per cell. Default {@link fenceCellSize}. */
  cellSize?: number;
  /** node budget; the cell is coarsened to stay inside it. Default 2^20. */
  maxCells?: number;
  /**
   * A point known to lie on the half being REMOVED.
   *
   * ⚠️⚠️ This is what gives `side` a meaning. Signing the field by which half holds
   * an arbitrary grid corner makes the label depend on where the run-outs happen to
   * exit, so it silently swaps when an unrelated parameter moves — and then the
   * same `side` value shows opposite halves of two different wells.
   */
  seed: Vec2;
};

/** Metres per cell for a footprint, when the caller has no opinion. */
export function fenceCellSize(
  bounds: [number, number, number, number],
): number {
  const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  return Math.min(50, Math.max(10, span / 400));
}

/**
 * Rasterise the signed distance to a fence curve.
 *
 * The magnitude is the EXACT distance from each node to the polyline; the sign is a
 * 4-connected flood fill from a node on the half being removed, so that half is
 * negative and everything else positive.
 *
 * ⭐⭐ Exact distance node by node, NOT a chamfer transform. A chamfer is off by a
 * few percent and ANISOTROPICALLY so — the error depends on direction — and the cut
 * is an isocontour of this field, so that error would be the feature's precision.
 * Cost is nodes x segments with a bounding-box reject, paid once per fence.
 *
 * ⚠️ The curve must LEAVE the grid at both ends or the fill walks around it; see
 * {@link FenceField.separated}.
 *
 * @group Geometries
 */
export function createFenceField(
  positions: Vec2[],
  options: FenceFieldOptions,
): FenceField | null {
  if (positions.length === 0) return null;
  const [minX, minZ, maxX, maxZ] = options.bounds;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (!(width > 0) || !(depth > 0)) return null;

  let cell = options.cellSize ?? fenceCellSize(options.bounds);
  const budget = options.maxCells ?? DEFAULT_MAX_CELLS;
  // Two cells of margin keeps the rasterised curve off the border.
  let nx = Math.ceil(width / cell) + 5;
  let ny = Math.ceil(depth / cell) + 5;
  if (nx * ny > budget) {
    const scale = Math.sqrt((nx * ny) / budget);
    cell *= scale;
    nx = Math.ceil(width / cell) + 5;
    ny = Math.ceil(depth / cell) + 5;
  }
  const origin: Vec2 = [minX - 2 * cell, minZ - 2 * cell];
  const barrier = rasterizeCurve(positions, nx, ny, origin, cell);

  const dist = new Float32Array(nx * ny);
  // Which side of the NEAREST SEGMENT a node falls on, and 0 where that was not
  // resolved exactly. ⚠️ Speckles wherever the curve doubles back, so it does not
  // decide the sign on its own — but it is the only thing that can sign the band
  // the flood fill cannot enter.
  const geo = new Int8Array(nx * ny);
  const grid = bucketSegments(positions, nx, ny, origin, cell);
  // ⭐ Beyond the search rings nothing reads the MAGNITUDE any more — the boundary
  // is evaluated exactly from the segments themselves, and out here only the sign
  // matters. Scanning the curve for a distance nobody uses was the single most
  // expensive thing this function did.
  const far = SEGMENT_RINGS * grid.size;

  const distanceTo = (i: number, px: number, pz: number) => {
    const a = positions[i];
    const b = positions[Math.min(i + 1, positions.length - 1)];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez;
    let t = 0;
    if (len2 > 0) {
      t = ((px - a[0]) * ex + (pz - a[1]) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const qx = a[0] + ex * t;
    const qz = a[1] + ez * t;
    return {
      d2: (px - qx) * (px - qx) + (pz - qz) * (pz - qz),
      cross: ex * (pz - a[1]) - ez * (px - a[0]),
    };
  };

  for (let r = 0; r < ny; r++) {
    const pz = origin[1] + r * cell;
    const br = Math.floor((pz - origin[1]) / grid.size);
    for (let c = 0; c < nx; c++) {
      const px = origin[0] + c * cell;
      const bc = Math.floor((px - origin[0]) / grid.size);
      const at = r * nx + c;
      if (!grid.near[br * grid.bx + bc]) {
        dist[at] = far;
        geo[at] = 0;
        continue;
      }
      let best = Infinity;
      let bestCross = 0;
      for (let ring = 0; ring <= SEGMENT_RINGS; ring++) {
        // Nothing in this ring can be nearer than the gap the previous ring left.
        const lower = (ring - 1) * grid.size;
        if (best < Infinity && lower * lower > best) break;
        for (let rr = br - ring; rr <= br + ring; rr++) {
          if (rr < 0 || rr >= grid.by) continue;
          const edge = rr === br - ring || rr === br + ring;
          for (let cc = bc - ring; cc <= bc + ring; cc++) {
            if (cc < 0 || cc >= grid.bx) continue;
            if (!edge && cc !== bc - ring && cc !== bc + ring) continue;
            const key = rr * grid.bx + cc;
            for (let k = grid.starts[key]; k < grid.starts[key + 1]; k++) {
              const hit = distanceTo(grid.items[k], px, pz);
              if (hit.d2 < best) {
                best = hit.d2;
                bestCross = hit.cross;
              }
            }
          }
        }
      }
      if (best === Infinity) {
        dist[at] = far;
        geo[at] = 0;
      } else {
        dist[at] = Math.sqrt(best);
        geo[at] = bestCross >= 0 ? 1 : -1;
      }
    }
  }

  const seedC = Math.round((options.seed[0] - origin[0]) / cell);
  const seedR = Math.round((options.seed[1] - origin[1]) / cell);
  let seed = -1;
  if (seedC >= 0 && seedC < nx && seedR >= 0 && seedR < ny) {
    const at = seedR * nx + seedC;
    if (!barrier[at]) seed = at;
  }
  if (seed < 0) {
    // The seed landed on the barrier or off the grid; take the nearest free node,
    // which is still on the removed half for any sane probe distance.
    let bestD = Infinity;
    for (let i = 0; i < barrier.length; i++) {
      if (barrier[i]) continue;
      const c = i % nx;
      const r = (i - c) / nx;
      const d = (c - seedC) * (c - seedC) + (r - seedR) * (r - seedR);
      if (d < bestD) {
        bestD = d;
        seed = i;
      }
    }
  }
  const removed = floodFrom(barrier, nx, ny, seed);

  let free = 0;
  let inRemoved = 0;
  for (let i = 0; i < barrier.length; i++) {
    if (barrier[i]) continue;
    free++;
    if (removed[i]) inRemoved++;
  }

  // ⚠️⚠️ The fill CANNOT enter the barrier, so every cell the curve passes through
  // would keep no sign at all and be forced onto one side whichever side it really
  // lies on. That is a one-cell band of wrong-signed values straddling the curve,
  // each wrong by its own distance, so the ZERO contour wiggles at cell period even
  // where the curve is dead straight — invisible at a large offset, ruinous at
  // zero. ⇒ Sign the band geometrically, with the polarity that agrees with the
  // fill.
  let agree = 0;
  let disagree = 0;
  for (let i = 0; i < barrier.length; i++) {
    // ⚠️⚠️ Only nodes that actually RESOLVED a nearest segment may vote. A far node
    // carries `geo = 0`, which reads as "right side" and turns the tally into "is
    // the kept half bigger than the removed half" — a question with nothing to do
    // with orientation, decided by whichever half happens to be larger.
    if (barrier[i] || geo[i] === 0) continue;
    if (geo[i] > 0 === !!removed[i]) agree++;
    else disagree++;
  }
  const geoRemoved: 1 | -1 = agree >= disagree ? 1 : -1;

  const values = new Float32Array(nx * ny);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const isRemoved = barrier[i] ? geo[i] === geoRemoved : !!removed[i];
    const v = isRemoved ? -dist[i] : dist[i];
    values[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return {
    values,
    positions,
    nx,
    ny,
    origin,
    cell,
    min,
    max,
    removedCross: geoRemoved,
    separated: inRemoved > 0 && inRemoved < free,
  };
}

/** Where a field sits, in the form the shader reads it. */
export type FencePlacement = {
  /** row-major 3x3, object XZ -> uv */
  toUv: number[];
  /** grid size in texels */
  size: Vec2;
};

/**
 * Place a field for the shader.
 *
 * ⚠️⚠️ The `+0.5 / size` is load-bearing: the shader recovers the node index as
 * `uv * size - 0.5`, so without it the GPU reads HALF A CELL away from the CPU.
 * ONE definition, used by the uniform and by {@link sampleFenceField} alike.
 *
 * @group Geometries
 */
export function fenceFieldPlacement(field: FenceField): FencePlacement {
  const { nx, ny, origin, cell } = field;
  return {
    toUv: [
      1 / (nx * cell),
      0,
      -origin[0] / (nx * cell) + 0.5 / nx,
      0,
      1 / (ny * cell),
      -origin[1] / (ny * cell) + 0.5 / ny,
      0,
      0,
      1,
    ],
    size: [nx, ny],
  };
}

/**
 * Read a field the way the GPU does.
 *
 * ⚠️⚠️ Must match `sampleFieldMap` in `depth-map.glsl` — same placement, same
 * weights, same clamping. There is exactly ONE CPU implementation and it goes
 * through {@link fenceFieldPlacement} rather than repeating the convention.
 *
 * @group Geometries
 */
export function sampleFenceField(
  field: FenceField,
): (x: number, z: number) => number {
  const { toUv, size } = fenceFieldPlacement(field);
  const { values } = field;
  const [nx, ny] = size;
  const clampC = (c: number) => (c < 0 ? 0 : c > nx - 1 ? nx - 1 : c);
  const clampR = (r: number) => (r < 0 ? 0 : r > ny - 1 ? ny - 1 : r);
  return (x: number, z: number) => {
    const u = toUv[0] * x + toUv[1] * z + toUv[2];
    const v = toUv[3] * x + toUv[4] * z + toUv[5];
    const tx = u * nx - 0.5;
    const tz = v * ny - 0.5;
    const bx = Math.floor(tx);
    const bz = Math.floor(tz);
    const fx = tx - bx;
    const fz = tz - bz;
    let sum = 0;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const w = (i === 0 ? 1 - fx : fx) * (j === 0 ? 1 - fz : fz);
        sum += values[clampR(bz + j) * nx + clampC(bx + i)] * w;
      }
    }
    return sum;
  };
}

/**
 * Share of the footprint a field takes AWAY, read off the field's own signs.
 *
 * ⚠️⚠️ Not "which of the two components is the seed in" — the field is SEEDED on the
 * removed side, so asking it that returns yes by construction, and both sides then
 * report the same half. Counting signed cells is the only answer that cannot be
 * circular.
 *
 * @group Geometries
 */
export function fieldRemovedShare(
  field: FenceField,
  outline: OutlineMask,
): number {
  const { mask, nx, ny, cell, origin } = outline;
  let removed = 0;
  let total = 0;
  for (let r = 0; r < ny; r++) {
    const z = origin[1] + r * cell;
    for (let c = 0; c < nx; c++) {
      if (!mask[r * nx + c]) continue;
      const x = origin[0] + c * cell;
      const fc = Math.round((x - field.origin[0]) / field.cell);
      const fr = Math.round((z - field.origin[1]) / field.cell);
      if (fc < 0 || fc >= field.nx || fr < 0 || fr >= field.ny) continue;
      total++;
      if (field.values[fr * field.nx + fc] < 0) removed++;
    }
  }
  return total > 0 ? removed / total : 0;
}

/** One side of a finished fence. */
export type FenceSide = {
  side: 1 | -1;
  curve: FenceSideCurve;
  field: FenceField;
  /**
   * The exact boundary lookup, which is what the shader and the immersion fog read.
   *
   * ⭐ The field beside it supplies the far-field SIGN only. Reconstructing the
   * boundary from a raster cannot reproduce a polyline, so it is carried instead of
   * interpolated — see `fence-segments.ts`.
   */
  index: FenceSegmentIndex;
  /** share of the footprint this side takes away, 0..1 */
  removedShare: number;
};

/** What one side of a fence ended up as. @group Geometries */
export type FenceSideReport = {
  side: 1 | -1;
  vertices: number;
  /** turn where each run-out joins the followed trace, in DEGREES (0 = smooth) */
  opening: [number, number];
  /**
   * Bridges the geodesic made across the removed side.
   *
   * ⭐0 is the tight-follow side; a larger number is the side that had to cut across
   * a loop or the inside of a dogleg. See {@link FenceSideCurve.bridges}.
   */
  bridges: number;
  /** loops the safety de-loop had to remove */
  loopsRemoved: number;
  /** largest turn within the fold window, in DEGREES */
  maxTurn: number;
  /** loops LEFT after the de-loop — must be 0 */
  loops: number;
  removedShare: number;
  /**
   * Metres of trajectory left in the KEPT block, worst case.
   *
   * ⭐⭐ THE number the old report lacked. The geodesic keeps the whole well on the
   * removed side by construction, so this reads ~0 unless a run-out crosses back at a
   * junction — which is the one failure a viewer always notices. Measured directly
   * off the shader's own lookup, at the trajectory, not at the curve standing in for
   * it. Must stay under {@link BURIAL_LIMIT}.
   */
  burial: number;
  minRadius: number;
  /** how the finished curve scored against intent — see {@link diagnoseFenceSide} */
  diagnosis: FenceSideDiagnosis;
  field: { nx: number; ny: number; cell: number; separated: boolean };
  /**
   * The exact boundary lookup's shape.
   *
   * ⚠️ `truncated` must be 0. A cell whose list overflowed cannot see every segment
   * that could be nearest, so the cut silently reverts to the coarse sign there — a
   * notch, in the one place the exactness was the point.
   */
  index: {
    cells: number;
    entries: number;
    maxCount: number;
    truncated: number;
    reach: number;
  };
  /**
   * Largest and RMS `|field|` at the cut face's own vertices, filled in by the face
   * builder.
   *
   * ⭐ The invariant that replaces every "these two functions must match" contract.
   * The face IS the curve and the curve is the field's zero set, so this must be
   * zero; anything else is a sliver of block standing proud of the face or a gap
   * behind it.
   */
  residual?: { max: number; rms: number };
};

/** Everything a fence build learned about itself. @group Geometries */
export type FenceReport = {
  wellbore?: string;
  sampling: {
    count: number;
    inserted: number;
    /** largest plan turn left between consecutive samples, in DEGREES */
    maxTurn: number;
    mdLength: number;
    planLength: number;
  };
  kickoff: { index: number; md: number; y: number; found: boolean };
  /** metres of clearance baked into the cut */
  clearance: number;
  /** a well with no plan direction of its own; the cut came from its spread */
  degenerate: boolean;
  /**
   * Diagnostics of the SPLINE itself (the well's plan path), independent of the cut — so a
   * sharp bend seen on a cut can be attributed to the trajectory rather than the run-out.
   */
  trace: {
    /** sharp bends on the well's own plan path (real doglegs) */
    sharpBends: number;
    /** self-crossings in the plan trace */
    loops: number;
    /** the sharp regions, in scene XZ, for the debug overlay */
    defects: FenceDefect[];
  };
  extensions: {
    start: Vec2;
    end: Vec2;
    /** DEGREES */
    startClearance: number;
    /** DEGREES */
    endClearance: number;
    /** DEGREES the run-out turns from the trace's heading — see {@link FenceExtensions.startTurn} */
    startTurn: number;
    /** DEGREES */
    endTurn: number;
    evenness: number;
    scored: number;
  };
  sides: { plus: FenceSideReport; minus: FenceSideReport };
  shared: boolean;
  /** milliseconds per stage */
  timings: Record<string, number>;
};

/** A finished fence: one curve per side, each with its own field. */
export type WellboreFence = {
  /** the raw plan trace both sides' geodesics are built from, without run-outs */
  base: FenceBase;
  extensions: FenceExtensions;
  plus: FenceSide;
  minus: FenceSide;
  /** whether the two sides ended up with the same curve */
  shared: boolean;
  report: FenceReport;
};

/** {@link buildWellboreFence} options. */
export type WellboreFenceOptions = {
  /** every ring of the footprint, in scene XZ */
  rings: Vec2[][];
  /** metres of clearance kept between the trajectory and the cut. Default 0. */
  margin?: number;
  /** MD spacing the trajectory is sampled at, in metres. Default 10. */
  sampleSpacing?: number;
  /** metres per cell of the field. Default {@link fenceCellSize}. */
  cellSize?: number;
  /** metres the run-outs clear the footprint by. Default 500. */
  runOutMargin?: number;
  /** how the run-outs continue. Default 'straight'. */
  extension?: FenceExtensionMode;
  /**
   * Plan angle the fence falls back to for a near-vertical well, in degrees (scene XZ,
   * 0 = +X). Default {@link DEFAULT_FALLBACK_ANGLE}. A deviated well's trajectory overrides it.
   */
  fallbackAngle?: number;
  /**
   * metres a NON-defect cut vertex may be simplified away by. 0 (default) keeps the cut
   * hugging real bends and only bridges defects; larger coarsens smooth stretches too.
   */
  simplify?: number;
  /** arm-weighted sharp-edge threshold the cut is built and diagnosed against, in radians. Default 30°. */
  sharpTurn?: number;
  /** per-side arm cap for the sharp-edge test, in metres. Default 10. */
  sharpArm?: number;
  /** render-radius slack: the cut aims to clear the well by `margin - tolerance`, and the well is buried below it. Default 0.1. */
  tolerance?: number;
  /** identifier carried into the report */
  wellbore?: string;
};

/** A point clear of the curve, on the half being removed. */
function removedSideSeed(base: Vec2[], side: 1 | -1, clearance: number): Vec2 {
  const at = base.length >> 1;
  const mid = base[at];
  const previous = base[Math.max(0, at - 1)];
  const next = base[Math.min(base.length - 1, at + 1)];
  const n = leftNormal2D(next[0] - previous[0], next[1] - previous[1]);
  return [mid[0] + n[0] * side * clearance, mid[1] + n[1] * side * clearance];
}

/**
 * Build a fence through a wellbore: one curve per side, each with the field the
 * shader cuts by.
 *
 * ⭐⭐ Both sides are built up front. Flipping which half is removed is then a
 * texture swap rather than a rebuild, which is what lets it be driven from a
 * selection or a camera move without a stall — and removes the window in which the
 * shader would be cutting the old field with the new side.
 *
 * @param curve the trajectory in scene coordinates
 * @param options see {@link WellboreFenceOptions}
 *
 * @group Geometries
 */
export function buildWellboreFence(
  curve: Curve3D,
  options: WellboreFenceOptions,
): WellboreFence | null {
  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const timings: Record<string, number> = {};

  let mark = now();
  const samples = sampleTrajectoryPlan(curve, options.sampleSpacing);
  if (!samples) return null;
  timings.sample = now() - mark;

  const margin = options.margin ?? 0;
  // ⚠️ Clearance is the MARGIN only — the room for a clear view of the well from the
  // cut. At margin 0 the cut follows the path exactly.
  const clearance = margin;
  const tolerance = options.tolerance ?? MIN_WELL_RADIUS;
  const sharpTurn = options.sharpTurn ?? CONSTRUCT_SHARP_TURN;
  const sharpArm = options.sharpArm ?? CONSTRUCT_SHARP_ARM;

  mark = now();
  const base = prepareFenceTrace(curve, samples, {
    fallbackAngle: options.fallbackAngle,
  });
  // The dense, simplified plan path off the 3D spline — the wellbore's true footprint,
  // not the straight lines between survey stations.
  const well = base.points;
  timings.base = now() - mark;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const take = (p: Vec2) => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  };
  for (const ring of options.rings) for (const p of ring) take(p);
  for (const p of base.points) take(p);
  if (!(maxX > minX) || !(maxZ > minZ)) return null;
  const bounds: [number, number, number, number] = [minX, minZ, maxX, maxZ];

  const cellSize = options.cellSize ?? fenceCellSize(bounds);
  const sideOptions: FenceSideOptions = {
    rings: options.rings,
    bounds,
    margin,
    runOutMargin: options.runOutMargin,
    // The clearance obstacle is the well itself (the spline, `base.points`).
    well,
    simplify: options.simplify,
    sharpTurn,
    sharpArm,
    tolerance,
  };

  // ⭐⭐ CORES FIRST. Each side's core (offset+smoothed, no run-outs) is independent of the
  // run-out bearings, so it is built up front and handed to `fenceExtensions` — the
  // bearings are then chosen against the ACTUAL arms they will grow, and the same cores are
  // reused to assemble the sides so scoring and building never diverge.
  mark = now();
  const plusCore = buildFenceCore(well, 1, margin, tolerance);
  const minusCore = buildFenceCore(well, -1, margin, tolerance);
  timings.curves = now() - mark;

  mark = now();
  const footprint =
    options.rings.length > 0 ? options.rings : [boundsRing(bounds)];
  const outline = rasterizeOutline(footprint, bounds);
  // ⭐ The candidate search only has to RANK, and it rebuilds this raster once per
  // pair, so it gets a coarse one; the share that is reported comes off the
  // accurate one above.
  const searchOutline = rasterizeOutline(footprint, bounds, SHARE_RESOLUTION);
  const extensions = fenceExtensions(base.points, {
    rings: options.rings,
    bounds,
    outline: searchOutline,
    runOutMargin: options.runOutMargin,
    margin,
    tolerance,
    spacing: sideOptions.spacing,
    cores: { plus: plusCore, minus: minusCore },
    // A near-vertical well has no bearing of its own — pull its two arms onto one axis.
    nearVertical: base.degenerate,
    mode: options.extension,
  });
  timings.extensions = now() - mark;

  mark = now();
  const plusCurve = buildFenceSideCurve(well, extensions, 1, {
    ...sideOptions,
    core: plusCore,
  });
  const minusCurve = buildFenceSideCurve(well, extensions, -1, {
    ...sideOptions,
    core: minusCore,
  });
  timings.curves += now() - mark;
  mark = now();
  const probeAt = clearance + cellSize * 4;
  const buildSide = (sideCurve: FenceSideCurve): FenceSide | null => {
    const seed = removedSideSeed(base.points, sideCurve.side, probeAt);
    const field = createFenceField(sideCurve.points, {
      bounds,
      cellSize,
      seed,
    });
    if (!field) return null;
    const indexMark = now();
    const index = buildFenceSegmentIndex(sideCurve.points, field);
    timings.index = (timings.index ?? 0) + (now() - indexMark);
    return {
      side: sideCurve.side,
      curve: sideCurve,
      field,
      index,
      removedShare: fieldRemovedShare(field, outline),
    };
  };
  const plus = buildSide(plusCurve);
  const minus = buildSide(minusCurve);
  timings.field = now() - mark;
  if (!plus || !minus) return null;

  // ⭐⭐ Burial: is the WELL less than `margin` clear of the cut? Measured on the well
  // (base.points) EXACTLY — the very curve that is drawn — with NO resampling, so the
  // measurement, the highlight and the drawn path are one and the same. {@link fenceBurial}
  // works in signed depth and bounds the runs exactly where the clearance meets the margin.
  //
  // ⭐⭐ Side is decided by crossing parity to LOCAL, OMNIDIRECTIONAL references — probe
  // outward in eight directions and keep the ones the field confirms are on the removed
  // side (its far-field sign is reliable past the curve), then majority-vote. The
  // references are NOT aimed by the well tangent: inside a loop the tangent reverses and
  // would point the wrong way. A far/global seed is wrong too — the segment to it threads
  // the loop and run-outs and miscounts.
  const dirs: Vec2[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  const keptSideFor =
    (s: FenceSide) =>
    (x: number, z: number): boolean => {
      const refs: Vec2[] = [];
      for (const d of dirs) {
        for (const reach of [probeAt, probeAt * 2]) {
          const rx = x + d[0] * reach;
          const rz = z + d[1] * reach;
          if (fenceSideAt(s.index, s.field, rx, rz) < 0) {
            refs.push([rx, rz]);
            break;
          }
        }
      }
      if (refs.length === 0) return false;
      let odd = 0;
      for (const ref of refs) {
        if (
          segmentPolylineCrossings(x, z, ref[0], ref[1], s.curve.points) % 2 ===
          1
        ) {
          odd++;
        }
      }
      return odd * 2 > refs.length;
    };
  const burialOf = (s: FenceSide): FenceBurial =>
    fenceBurial(s.curve.points, well, keptSideFor(s), tolerance, clearance);

  const degrees = (r: number) => (r * 180) / Math.PI;
  // Diagnose the SPLINE itself (the well), independent of the cut, so a sharp bend can be
  // attributed to the trajectory rather than the run-out.
  const traceSharp = polylineSharpEdges(base.points, sharpTurn, sharpArm);
  const sideReport = (s: FenceSide, burial: FenceBurial): FenceSideReport => ({
    side: s.side,
    vertices: s.curve.points.length,
    opening: [degrees(s.curve.opening[0]), degrees(s.curve.opening[1])],
    bridges: s.curve.bridges,
    loopsRemoved: s.curve.loopsRemoved,
    maxTurn: degrees(s.curve.maxTurn),
    loops: countPolylineLoops(s.curve.points),
    removedShare: s.removedShare,
    burial: burial.worst,
    // A diagnostic window, not a target: how tightly the cut hugs the well.
    minRadius: polylineMinRadius(s.curve.points, 300),
    // ⭐ Diagnose the GENERATED cut (run-outs included), so a tight run-out junction is
    // seen; `core` is passed only for the bridged metric.
    diagnosis: diagnoseFenceSide(s.curve.points, base.points, s.side, {
      tolerance,
      margin: clearance,
      sharpTurn,
      sharpArm,
      core: s.curve.core,
      burial: burial.worst,
      burialDefects: burial.runs,
    }),
    field: {
      nx: s.field.nx,
      ny: s.field.ny,
      cell: s.field.cell,
      separated: s.field.separated,
    },
    index: {
      cells: s.index.nx * s.index.ny,
      entries: s.index.width * s.index.height,
      maxCount: s.index.maxCount,
      truncated: s.index.truncated,
      reach: s.index.reach,
    },
  });

  const report: FenceReport = {
    wellbore: options.wellbore,
    sampling: {
      count: samples.plan.length,
      inserted: samples.inserted,
      maxTurn: degrees(samples.maxTurn),
      mdLength: samples.md[samples.md.length - 1] ?? 0,
      planLength: polylineLength(samples.plan),
    },
    kickoff: {
      index: base.kickoff.index,
      md: base.kickoff.md,
      y: base.kickoff.y,
      found: base.kickoff.found,
    },
    clearance,
    degenerate: base.degenerate,
    // Diagnose the SPLINE itself (the well), independent of the cut, so a sharp bend can
    // be attributed to the trajectory rather than the run-out.
    trace: {
      sharpBends: traceSharp.length,
      loops: countPolylineLoops(base.points),
      defects: traceSharp.map(points => ({ kind: 'sharp' as const, points })),
    },
    extensions: {
      start: extensions.start,
      end: extensions.end,
      startClearance: degrees(extensions.startClearance),
      endClearance: degrees(extensions.endClearance),
      startTurn: degrees(extensions.startTurn),
      endTurn: degrees(extensions.endTurn),
      evenness: extensions.evenness,
      scored: extensions.scored,
    },
    sides: {
      plus: sideReport(plus, burialOf(plus)),
      minus: sideReport(minus, burialOf(minus)),
    },
    // ⚠️ Compared rather than inferred: the two geodesics coincide only when the well
    // is straight and no clearance separates them, and that is worth reporting exactly
    // rather than guessing from whether a repair fired.
    shared:
      plusCurve.points.length === minusCurve.points.length &&
      plusCurve.points.every(
        (p, i) =>
          Math.abs(p[0] - minusCurve.points[i][0]) < 1e-6 &&
          Math.abs(p[1] - minusCurve.points[i][1]) < 1e-6,
      ),
    timings,
  };

  return {
    base,
    extensions,
    plus,
    minus,
    shared: report.shared,
    report,
  };
}

/** What one side of a fence buries, from the exact whole-border measurement. @group Geometries */
export type FenceBurial = {
  /** worst SIGNED depth in metres: positive = into the KEPT block, negative = clear on the removed side */
  worst: number;
  /** the buried stretches of the well (clearance below the margin), bounded EXACTLY, for the overlay */
  runs: Vec2[][];
};

/**
 * Where the finished cut BURIES the well — EXACTLY, from the whole cut border.
 *
 * ⭐⭐ A well point is buried when it is LESS THAN `margin` clear of the cut. Working
 * with the SIGNED depth `d` (positive on the KEPT side, negative on the removed side),
 * the well is clear at `d <= tolerance - margin` — the render radius `tolerance` is slack
 * so a well resting exactly at its margin is not flagged. At margin 0 this is `d > tolerance`:
 * the well may lie in the cut but not poke a render radius onto the kept side.
 *
 * ⭐⭐ No sampling rate. Evaluation points are the well's own vertices plus the EXACT
 * points where it crosses the cut ({@link segmentPolylineCrossingParams}, where the
 * signed depth is 0). Runs begin and end exactly where the signed depth meets the
 * threshold, found by interpolating between adjacent evaluation points — no overshoot,
 * no short stop, and a burial is caught however the well is sampled.
 *
 * ⭐ Side ({@link keptSide}) is decided by crossing parity against the whole cut, never a
 * single nearest segment. Magnitude is the exact distance from the well to the cut.
 *
 * @param cutCurve the side's full cut curve, run-outs included
 * @param well the spline to test, used EXACTLY — never a resampled proxy
 * @param keptSide true when a point sits on the KEPT side of the cut (robust, full-border)
 * @param tolerance the well's render radius, in metres — the slack allowed at margin 0
 * @param margin the clearance the cut was offset by; the well must stay this far clear
 *
 * @group Geometries
 */
export function fenceBurial(
  cutCurve: Vec2[],
  well: Vec2[],
  keptSide: (x: number, z: number) => boolean,
  tolerance: number,
  margin: number,
): FenceBurial {
  // Buried when the well is not `margin` clear of the cut on the removed side. Signed
  // depth d must sit at or below −margin to be clear; the `tolerance` (render radius) is
  // slack so a well resting exactly at its margin does not flicker as buried. At margin 0
  // the well is MEANT to lie in the cut, so the only fault there is poking a render radius
  // onto the kept side (d above `tolerance`).
  const threshold = tolerance - margin;

  const signedDepth = (x: number, z: number): number => {
    const near = nearestOnPolyline(cutCurve, x, z);
    const d = near ? near.distance : 0;
    return keptSide(x, z) ? d : -d;
  };

  // Evaluation points along the well: every vertex, plus the EXACT cut crossings (signed
  // depth 0). Driven by the geometry, not a step size.
  type Eval = { x: number; z: number; sd: number };
  const evals: Eval[] = [];
  for (let i = 0; i + 1 < well.length; i++) {
    const a = well[i];
    const b = well[i + 1];
    if (i === 0) evals.push({ x: a[0], z: a[1], sd: signedDepth(a[0], a[1]) });
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    for (const t of segmentPolylineCrossingParams(
      a[0],
      a[1],
      b[0],
      b[1],
      cutCurve,
    )) {
      evals.push({ x: a[0] + dx * t, z: a[1] + dz * t, sd: 0 });
    }
    evals.push({ x: b[0], z: b[1], sd: signedDepth(b[0], b[1]) });
  }

  // Where the signed depth meets the threshold between two evaluation points.
  const cross = (p: Eval, q: Eval): Vec2 => {
    const denom = q.sd - p.sd;
    const f = Math.abs(denom) < 1e-12 ? 0 : (threshold - p.sd) / denom;
    const g = f < 0 ? 0 : f > 1 ? 1 : f;
    return [p.x + (q.x - p.x) * g, p.z + (q.z - p.z) * g];
  };

  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  let worst = -Infinity;
  for (let i = 0; i < evals.length; i++) {
    const e = evals[i];
    if (e.sd > worst) worst = e.sd;
    if (e.sd > threshold) {
      if (run.length === 0 && i > 0) run.push(cross(evals[i - 1], e));
      run.push([e.x, e.z]);
    } else if (run.length > 0) {
      run.push(cross(evals[i - 1], e));
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return { worst: worst === -Infinity ? 0 : worst, runs };
}

/** Thresholds {@link diagnoseFenceSide} scores a side against. @group Geometries */
export type FenceDiagnosisOptions = {
  /** metres of well allowed on the kept side before it counts as buried. Default {@link MIN_WELL_RADIUS}. */
  tolerance?: number;
  /** arm-weighted relative turn that is a sharp edge at {@link FenceDiagnosisOptions.sharpArm}, in radians. Default 30°. */
  sharpTurn?: number;
  /** per-side arm cap for the sharp-edge test, in metres. Default 10. */
  sharpArm?: number;
  /** turn a near-reversal must exceed to be scored as a pinch, in radians. Default 150°. */
  pinchTurn?: number;
  /** both arms of a pinch must be at least this long, in metres. Default 25. */
  pinchArm?: number;
  /** arc length within which two opposite turns count as a wiggle, in metres. Default 40. */
  wiggleSpan?: number;
  /** fraction of the core that may bridge before it is flagged. Default 0.5. */
  bridgedLimit?: number;
  /** the clearance the cut was offset by, in metres — bridging is measured beyond it. Default 0. */
  margin?: number;
  /**
   * The well-following core (no run-outs), for the bridged metric only. The run-outs
   * leave the well by design, so bridging is measured on the core; corners are scored on
   * the generated curve passed as the first argument. Defaults to that curve.
   */
  core?: Vec2[];
  /**
   * Worst kept-side burial in metres, measured ROBUSTLY by the caller from the whole
   * cut border (see {@link fenceBurial}). The diagnosis never signs geometry itself;
   * defaults to 0 when not supplied.
   */
  burial?: number;
  /** the buried spans of the well for the overlay, from the same robust measurement */
  burialDefects?: Vec2[][];
};

/**
 * A flagged region of a finished side-curve, for the debug overlay.
 *
 * ⭐ `burial` points are on the WELL (the stretch left in the kept block); the turn
 * kinds are the three core vertices around the offending corner.
 *
 * @group Geometries
 */
export type FenceDefect = {
  kind: 'burial' | 'sharp' | 'pinch' | 'wiggle';
  points: Vec2[];
};

/** How a finished side-curve scored against what the fence intended. @group Geometries */
export type FenceSideDiagnosis = {
  side: 1 | -1;
  /** worst metres of well left on the KEPT side of the cut; should be <= {@link FenceSideDiagnosis.tolerance} */
  burial: number;
  /** the burial tolerance it was judged against, in metres */
  tolerance: number;
  /** self-intersections left in the core — should be 0 */
  loops: number;
  /** sharp corners sitting on two long segments */
  sharpTurns: number;
  /** narrow-V pinches: a near-reversal with two long arms */
  pinches: number;
  /** opposite turns packed within {@link FenceDiagnosisOptions.wiggleSpan} of each other */
  wiggle: number;
  /**
   * Fraction of the core that leaves the well by more than the tolerance, 0..1.
   *
   * ⭐ One side of a genuine bend is expected to bridge somewhat, but a curve that
   * bridges most of its length has stopped following the well — flagged past
   * {@link FenceDiagnosisOptions.bridgedLimit}.
   */
  bridged: number;
  /** every way the curve fell short of intent, human-readable */
  issues: string[];
  /** true when {@link FenceSideDiagnosis.issues} is empty */
  clean: boolean;
  /** the flagged regions, in scene XZ, for the debug overlay */
  defects: FenceDefect[];
};

/**
 * Score a finished side-curve against what the fence set out to do — READ-ONLY.
 *
 * ⭐ Not a repair: it reasons about the result and reports how it turned out, so the
 * generation passes can be judged against intent. Burial is the check that must come
 * back clean — the well may sit at most a render radius on the KEPT side — while
 * sharp turns, pinches, wiggle and loops are the undesirable plan shapes. `bridged`
 * is reported but never a fault, since one side of every bend is expected to bridge.
 *
 * ⚠️ Corners (sharp/pinch/wiggle) are scored on the GENERATED cut passed as `curve` —
 * run-outs and all — so a tight run-out junction is seen. `bridged` is measured on the
 * well-following `core` (via options), since the run-outs leave the well by design.
 *
 * @param curve the finished, generated side-curve (with run-outs) — what the shader cuts by
 * @param well the plan trace the cut is meant to reveal
 * @param side which half this curve removes
 * @param options see {@link FenceDiagnosisOptions}
 *
 * @group Geometries
 */
export function diagnoseFenceSide(
  curve: Vec2[],
  well: Vec2[],
  side: 1 | -1,
  options: FenceDiagnosisOptions = {},
): FenceSideDiagnosis {
  const tolerance = options.tolerance ?? MIN_WELL_RADIUS;
  const sharpTurn = options.sharpTurn ?? CONSTRUCT_SHARP_TURN;
  const sharpArm = options.sharpArm ?? CONSTRUCT_SHARP_ARM;
  const pinchTurn = options.pinchTurn ?? DIAGNOSIS_PINCH_TURN;
  const pinchArm = options.pinchArm ?? DIAGNOSIS_PINCH_ARM;
  const wiggleSpan = options.wiggleSpan ?? DIAGNOSIS_WIGGLE_SPAN;
  const bridgedLimit = options.bridgedLimit ?? DIAGNOSIS_BRIDGED_LIMIT;
  const margin = options.margin ?? 0;
  // The well-following part, for the bridged metric only (run-outs leave the well by design).
  const core = options.core ?? curve;

  // ⭐⭐ Burial is measured by the caller against the whole cut border, margin-aware, and
  // handed in — the diagnosis only consumes it, so it never signs geometry from a single
  // nearest segment (the naive rule that gave false side readings). `burial` is the worst
  // SIGNED depth; the runs are the stretches short of the margin clearance.
  const burial = options.burial ?? 0;
  const defects: FenceDefect[] = [];
  for (const run of options.burialDefects ?? []) {
    if (run.length > 0) defects.push({ kind: 'burial', points: run });
  }

  // ⭐ Sharp: the arm-weighted edges of the WHOLE generated curve — the SAME rule the cut
  // was built against, so a residual the construction could not bridge shows here and not
  // where the construction already avoided one.
  const sharpRegions = polylineSharpEdges(curve, sharpTurn, sharpArm);
  const sharpTurns = sharpRegions.length;
  for (const region of sharpRegions) {
    defects.push({ kind: 'sharp', points: region });
  }

  // Pinch (a single-vertex near-reversal) and wiggle (two real opposite turns packed
  // closer than `wiggleSpan`), scored on the generated curve.
  let pinches = 0;
  let wiggle = 0;
  let lastSign = 0;
  let lastArc = -Infinity;
  let arc = 0;
  for (let i = 1; i + 1 < curve.length; i++) {
    const ax = curve[i][0] - curve[i - 1][0];
    const az = curve[i][1] - curve[i - 1][1];
    const bx = curve[i + 1][0] - curve[i][0];
    const bz = curve[i + 1][1] - curve[i][1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    arc += la;
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = (ax * bx + az * bz) / (la * lb);
    const turn = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
    const corner: Vec2[] = [
      [curve[i - 1][0], curve[i - 1][1]],
      [curve[i][0], curve[i][1]],
      [curve[i + 1][0], curve[i + 1][1]],
    ];
    if (turn >= pinchTurn && la >= pinchArm && lb >= pinchArm) {
      pinches++;
      defects.push({ kind: 'pinch', points: corner });
    }
    // Wiggle: a real turn that reverses the previous real turn within a short span.
    if (turn >= DIAGNOSIS_WIGGLE_TURN) {
      const sign = ax * bz - az * bx > 0 ? 1 : -1;
      if (lastSign !== 0 && sign !== lastSign && arc - lastArc <= wiggleSpan) {
        wiggle++;
        defects.push({ kind: 'wiggle', points: corner });
      }
      lastSign = sign;
      lastArc = arc;
    }
  }

  // Bridged: the share of the core whose midpoint leaves the well by more than the
  // intended offset (margin) plus the tolerance — where the cut is bridging a concavity
  // rather than tracking the well at the offset distance.
  let bridgedLen = 0;
  let totalLen = 0;
  for (let i = 1; i < core.length; i++) {
    const l = Math.hypot(
      core[i][0] - core[i - 1][0],
      core[i][1] - core[i - 1][1],
    );
    totalLen += l;
    const mx = (core[i - 1][0] + core[i][0]) * 0.5;
    const mz = (core[i - 1][1] + core[i][1]) * 0.5;
    const hit = nearestOnPolyline(well, mx, mz);
    if (hit && hit.distance > margin + tolerance) bridgedLen += l;
  }
  const bridged = totalLen > 0 ? bridgedLen / totalLen : 0;

  const loops = countPolylineLoops(core);

  const issues: string[] = [];
  // Buried = the caller's margin-aware measurement found any run (see fenceBurial).
  if ((options.burialDefects ?? []).length > 0) {
    if (burial > tolerance) {
      issues.push(`buries the well ${burial.toFixed(1)} m into the kept block`);
    } else {
      issues.push(`well short of the ${margin.toFixed(2)} m clearance`);
    }
  }
  if (loops > 0)
    issues.push(`${loops} loop${loops > 1 ? 's' : ''} in the curve`);
  if (sharpTurns > 0) {
    issues.push(`${sharpTurns} sharp bend${sharpTurns > 1 ? 's' : ''}`);
  }
  if (pinches > 0) issues.push(`${pinches} pinch${pinches > 1 ? 'es' : ''}`);
  if (wiggle > 0) {
    issues.push(`${wiggle} tight direction reversal${wiggle > 1 ? 's' : ''}`);
  }
  if (bridged > bridgedLimit) {
    issues.push(
      `bridges ${(bridged * 100).toFixed(0)}% of its length instead of following`,
    );
  }

  return {
    side,
    burial,
    tolerance,
    loops,
    sharpTurns,
    pinches,
    wiggle,
    bridged,
    issues,
    clean: issues.length === 0,
    defects,
  };
}

/**
 * Everything a fence build got wrong, as a list of readable strings.
 *
 * ⭐ ONE definition, read by the tests, by the debug overlay and by the development
 * warning alike, so they cannot drift into disagreeing about what "broken" means.
 *
 * @returns an empty array when the fence is sound
 *
 * @group Geometries
 */
export function assertFenceInvariants(report: FenceReport): string[] {
  const problems: string[] = [];
  if (report.extensions.evenness < SHARE_FLOOR) {
    problems.push(
      `run-outs split the block ${(report.extensions.evenness * 100).toFixed(0)}/${((1 - report.extensions.evenness) * 100).toFixed(0)}`,
    );
  }
  for (const side of [report.sides.plus, report.sides.minus]) {
    const name = side.side > 0 ? 'plus' : 'minus';
    if (side.loops > 0) {
      problems.push(`${name}: ${side.loops} loops left in the curve`);
    }
    if (!side.field.separated) {
      problems.push(`${name}: the curve does not separate the field`);
    }
    if (side.index.truncated > 0) {
      problems.push(
        `${name}: ${side.index.truncated} index cells overflowed at ${side.index.maxCount} segments`,
      );
    }
    if (side.removedShare < SHARE_FLOOR) {
      problems.push(
        `${name}: removes only ${(side.removedShare * 100).toFixed(0)}% of the block`,
      );
    }
    // ⭐⭐ The check the old report lacked: the trajectory must end up in the half that
    // goes, or whatever is drawn in the hole is buried by the block meant to reveal it.
    if (side.burial > BURIAL_LIMIT) {
      problems.push(
        `${name}: buries the well ${side.burial.toFixed(0)} m into the kept block`,
      );
    }
    // The turn where the run-out joins the followed trace. The geodesic makes it a
    // convex corner the smoothing rounds, so a large one is a genuinely awkward
    // junction — the folds the old invariants passed silently now show up here.
    const junction = Math.max(side.opening[0], side.opening[1]);
    if (junction > 120) {
      problems.push(
        `${name}: run-out joins the trace at a ${junction.toFixed(0)}° turn`,
      );
    }
    if (side.residual && side.residual.max > RESIDUAL_LIMIT) {
      problems.push(
        `${name}: face stands ${side.residual.max.toFixed(1)} m off the cut`,
      );
    }
  }
  return problems;
}

/**
 * Largest and RMS `|side|` over a set of positions.
 *
 * ⭐ Run over the cut face's own vertices this is THE correctness check for the
 * whole feature: the face is swept from the curve and the block is removed by the
 * shader reading that same curve back, so anything but zero is a sliver of block
 * standing proud of the face, or a gap behind it.
 *
 * @param side the fence side to measure against
 * @param points interleaved positions
 * @param stride elements per position; x is at `i`, z at `i + stride - 1`
 *
 * @group Geometries
 */
export function fenceResidual(
  side: FenceSide,
  points: ArrayLike<number>,
  stride: number = 3,
): { max: number; rms: number } {
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i + stride - 1 < points.length; i += stride) {
    const value = Math.abs(
      fenceSideAt(side.index, side.field, points[i], points[i + stride - 1]),
    );
    if (value > max) max = value;
    sum += value * value;
    count++;
  }
  return { max, rms: count > 0 ? Math.sqrt(sum / count) : 0 };
}
