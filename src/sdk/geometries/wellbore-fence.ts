import { Vec2, Vec3 } from '../types/common';
import {
  armPocket,
  buildFenceCut,
  CurvePiece,
  DEFAULT_EXTENSION,
  DEFAULT_MAX_RELATIVE_TURN,
  FenceArmEnd,
  FenceArmsOptions,
  frameArmPocket,
  HeadArmPlan,
  headRouteObstacles,
  headWrapExitAngle,
  headWrapRegion,
  marginFrame,
  planHeadArm,
  planTdArm,
  planTdDiversion,
  rodsCrowd,
  TdArmPlan,
  tdDiversionAngles,
  tdPlanTrace,
} from '../utils/fence-run-out';
import { convexPolygonDistance } from '../utils/margin-zone';
import {
  FenceSideName,
  hullDiameter,
  isTracePocket,
  oneSidedOffset,
  pointInConvex,
  RodOverlapError,
  sideNormalSign,
  TracePocketSpan,
  TraceProblemOptions,
  TraceProblemSpan,
  traceProblemSpans,
  trimFenceCore,
} from '../utils/one-sided-offset';
import {
  convexHull2D,
  countPolylineLoops,
  createPolylineIndex,
  dedupePolyline2D,
  leftNormal2D,
  meanTangent2D,
  nearestOnPolyline,
  polylineArcLengths,
  polylineBounds2D,
  polylineLength,
  polylineSharpEdges,
  PolylineTurn,
  polylineWorstTurn,
  segmentPolylineCrossingParams,
  segmentPolylineCrossings,
} from '../utils/polyline-2d';
import { simplifyCurve2D } from '../utils/trajectory';
import { Curve3D } from './curve/curve-3d';
import {
  buildFenceSegmentIndex,
  FenceSegmentIndex,
  fenceSideAt,
} from './fence-segments';
import { pointInRing, simplifyPolyline } from './polygon-outline';

/**
 * Which half of a wellbore a fence takes away, named for where its cut curve lies walking
 * HEAD→TD in a plan view from above.
 *
 * ⭐ ONE vocabulary for the whole feature — options, results, reports and story controls all
 * say `'left'` / `'right'`. Where a sign is genuinely needed (a normal, a field value) it comes
 * from {@link fenceSideSign}, never from re-deriving the hand at the call site.
 *
 * @group Geometries
 */
export type { FenceSideName };

/**
 * The {@link leftNormal2D} multiplier for a fence side — the one place a side becomes a sign.
 *
 * ⚠️ `'left'` is **−1**. `leftNormal2D` is the quarter turn in +XZ, and a plan view looks down
 * the Y axis (+X right, +Z DOWN the screen), so that normal points to the visual RIGHT.
 *
 * @group Geometries
 */
export const fenceSideSign = sideNormalSign;

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
 * hairpins and a cut that pinches to a blade. The trace is NOT straightened to deal
 * with that — `prepareFenceTrace` keeps it as drilled, and the cut instead ROUTES
 * AROUND the defects: `fenceObstacles` frames each pocket and kink in a convex hull, the head
 * is framed as one more, and `oneSidedOffset` rounds each hull's margin-inflated ring with the
 * stiff rod rather than measuring the degenerate trace inside it. A well with no plan shape at
 * all is framed whole as its head, with guides at both ends.
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

/** Divisions the even-split score is measured on, before the size clamp. */
const SHARE_RESOLUTION = 96;

/** Metres per cell the even-split score aims for. */
const SHARE_CELL = 150;

/** Cap on the even-split raster, since it is rebuilt per candidate pair. */
const SHARE_RESOLUTION_MAX = 256;

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
 *
 * ⚠️⚠️ The threshold is an ANGLE, so the deviation it allows in METRES is about
 * `radius * threshold` — it is loosest exactly where the well bends gently over kilometres.
 * At 1e-4 an R=5000 m plan bend was chorded 0.497 m off the real spline, the size of a whole
 * `margin`, and `fenceBurial` judges the cut against the EXACT spline — so that error is a
 * burial no downstream pass can see or repair. 1e-6 holds the same bend to 0.005 m.
 */
const SIMPLIFY_TOLERANCE = 1e-6;

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
 * Smallest clearance a fence is built at, in metres.
 *
 * ⭐⭐ Margin 0 is a degenerate request: the corridor collapses ONTO the trajectory, so the cut
 * has to reproduce a survey polyline exactly and every pass downstream ends up arguing about
 * sub-millimetre differences from the well itself — a dissolve has nothing to dissolve, a taut
 * string has no room to be taut in, and "is the well buried" stops having a robust answer.
 * Floored at the wellbore's own render radius, which is the smallest clearance that could be
 * seen in any case.
 */
const MIN_FENCE_MARGIN = MIN_WELL_RADIUS;

/**
 * The clearance a fence builds at.
 *
 * ⚠️⚠️ THROWS below {@link MIN_FENCE_MARGIN} rather than clamping. It used to clamp silently,
 * so a caller asking for 0 got 0.1 and no way to tell — the fence's single most-read option
 * did not mean what it said.
 */
const fenceMargin = (requested?: number) => {
  const margin = requested ?? MIN_FENCE_MARGIN;
  if (!(margin >= MIN_FENCE_MARGIN)) {
    throw new Error(
      `fence: margin ${margin} m is below the minimum ${MIN_FENCE_MARGIN} m — the cut is an ` +
        `offset of the trajectory, so it needs room to route past the well's own folds`,
    );
  }
  return margin;
};

/**
 * Default VERIFICATION slack, in metres — the room a finished cut is allowed to fall
 * short of the full margin before it counts as burying the well.
 *
 * ⭐ Kept separate from {@link MIN_WELL_RADIUS} (a geometric epsilon): construction aims
 * for the FULL margin with no slack, so this only softens the acceptance/classification
 * test. Small because the cut now holds the margin to within float noise on a clean follow.
 */
const DEFAULT_TOLERANCE = 0.01;

/**
 * Sharp-edge constraint the cut is SIMPLIFIED against — the same arm-weighted rule the
 * diagnostic uses, injected as a construction constraint so coarsening cannot introduce a
 * sharp edge. Relative turn (radians) that is sharp at {@link CONSTRUCT_SHARP_ARM}.
 */
const CONSTRUCT_SHARP_TURN = (30 * Math.PI) / 180;
/** Arm length each side is capped at for the sharp-edge constraint, in metres. */
const CONSTRUCT_SHARP_ARM = 10;

/**
 * Plan distance within which two NON-adjacent parts of the trace count as folding back on
 * each other — a zig-zag or a loop the cut must route around rather than follow. In metres.
 */
const OBSTACLE_APPROACH = 4;
/**
 * Arc that must separate the two parts for their closeness to be a FOLD rather than plain
 * forward progress, in metres. Kept above {@link OBSTACLE_APPROACH} so a straight (even if
 * slow, near-vertical) drift — where plan distance tracks arc distance — is never flagged.
 */
const OBSTACLE_MIN_ARC = 8;
/**
 * Turn a single vertex must exceed to be a fold on its own — a near-reversal where the trace
 * doubles back (a hook or a zig-zag tip), in radians. Catches tight folds whose whole
 * excursion is shorter than {@link OBSTACLE_MIN_ARC}, which the self-approach test misses.
 *
 * ⛔ TRIED AT 120° AND REVERTED. The threshold itself is safe — the field's trace turns are
 * strongly bimodal, exactly three vertices exceed 100° (F-9's 128° head hook, F-9 A's 154°/127°)
 * and the sharpest anywhere else is F-14's 79°, so any value in 100–125 selects the same three.
 * It is the CONSEQUENCE that fails: framing F-9's hook changes its head geometry and the run-out
 * arm then CROSSES the trajectory at margins 0.1–1, i.e. four new failures in the production
 * range, against the one near-end cusp it fixed. A crossing is worse than a cusp.
 * ⚠️ Do not re-lower this without re-running the arm census — the core census alone looks fine.
 */
const OBSTACLE_REVERSAL = (150 * Math.PI) / 180;
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

/**
 * Ceiling on the cut's deviation thinning, as a fraction of `margin`.
 *
 * ⭐ The thin is `min(tolerance, margin * this)`, so the clearance given up is bounded BOTH by
 * the caller's seam budget and by a fraction of the clearance itself — a fixed 1 cm would be
 * 10% of the margin at the bottom of the production range (0.1 m) and 0.2% at the top.
 */
const THIN_MARGIN_FRACTION = 0.02;

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
  /** the well is already deviating at its first sample — a head trimmed below the kickoff */
  fromStart: boolean;
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
    return {
      index: i,
      md: samples.md[i],
      y: samples.y[i],
      found: i > 0,
      fromStart: i === 0,
    };
  }
  return {
    index: 0,
    md: samples.md[0] ?? 0,
    y: samples.y[0] ?? 0,
    found: false,
    fromStart: false,
  };
}

/**
 * The spans of the plan trace that FOLD BACK on themselves — the zig-zags and loops the cut
 * must route around rather than follow — as `[first, last]` index ranges into `trace`.
 *
 * ⭐⭐ A near-vertical section is REAL trajectory (the well occupies every plan position), but
 * where its plan footprint doubles back the cut cannot follow it without burying the well, so
 * each side has to bypass it. The signature is geometric, not a plan-speed guess: two parts of
 * the trace within {@link OBSTACLE_APPROACH} of each other while at least {@link OBSTACLE_MIN_ARC}
 * apart in arc (a loop or wide fold), or a near-reversal vertex ({@link OBSTACLE_REVERSAL}) grown
 * through its tight cluster (a hook or zig-zag tip too short in arc for the first test). A curve
 * that keeps making forward progress — even a slow, near-vertical drift — satisfies neither.
 *
 * ⛔ SUPERSEDED by {@link traceProblemSpans}, and kept only so the two can be A/B-ed through
 * {@link FenceObstacleSource}. Both of its rules are a fixed LENGTH (a 4 m self-approach, a 150°
 * reversal), so each sees one size of defect and neither sees a wide fold at all.
 *
 * @param trace the plan trace ({@link FenceBase.points})
 *
 * @group Geometries
 */
export function fenceFoldSpans(trace: Vec2[]): Array<[number, number]> {
  const n = trace.length;
  if (n < 3) return [];
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    arc[i] =
      arc[i - 1] +
      Math.hypot(trace[i][0] - trace[i - 1][0], trace[i][1] - trace[i - 1][1]);
  }
  const d2 = OBSTACLE_APPROACH * OBSTACLE_APPROACH;
  // Each vertex that folds back near a LATER part opens a span covering the excursion between
  // them; the farthest such partner is taken so the span wraps the whole fold.
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = n - 1; j > i; j--) {
      if (arc[j] - arc[i] < OBSTACLE_MIN_ARC) break;
      const dx = trace[i][0] - trace[j][0];
      const dz = trace[i][1] - trace[j][1];
      if (dx * dx + dz * dz <= d2) {
        spans.push([i, j]);
        break;
      }
    }
  }
  // A tight hook or zig-zag tip folds back over too little arc for the test above; a
  // near-reversal at a single vertex seeds it. From that seed the span is grown through the
  // whole tight cluster — while the segments stay short — and stops where the trace departs
  // (a segment longer than the fold's scale), so the hull wraps the fold and not the jump out.
  for (let i = 1; i + 1 < n; i++) {
    const ax = trace[i][0] - trace[i - 1][0];
    const az = trace[i][1] - trace[i - 1][1];
    const bx = trace[i + 1][0] - trace[i][0];
    const bz = trace[i + 1][1] - trace[i][1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = (ax * bx + az * bz) / (la * lb);
    if (Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos) < OBSTACLE_REVERSAL) {
      continue;
    }
    let a = i;
    while (
      a > 0 &&
      Math.hypot(
        trace[a][0] - trace[a - 1][0],
        trace[a][1] - trace[a - 1][1],
      ) <= OBSTACLE_APPROACH
    ) {
      a--;
    }
    let b = i;
    while (
      b + 1 < n &&
      Math.hypot(
        trace[b + 1][0] - trace[b][0],
        trace[b + 1][1] - trace[b][1],
      ) <= OBSTACLE_APPROACH
    ) {
      b++;
    }
    spans.push([a, b]);
  }
  if (spans.length === 0) return [];
  // Merge overlapping spans into maximal folded clusters, one hull each.
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [spans[0]];
  for (let k = 1; k < spans.length; k++) {
    const last = merged[merged.length - 1];
    if (spans[k][0] <= last[1]) last[1] = Math.max(last[1], spans[k][1]);
    else merged.push(spans[k]);
  }
  return merged;
}

/**
 * Which detector frames the stretches a cut must route around.
 *
 * ⛔ `fold-spans` is the LEGACY path ({@link fenceFoldSpans}) and exists only so the two can be
 * compared on the same well; it is retired once the arm census signs the new one off.
 *
 * @group Geometries
 */
export type FenceObstacleSource = 'trace-problems' | 'fold-spans';

/**
 * {@link fenceObstacles} options.
 *
 * @group Geometries
 */
export type FenceObstacleOptions = {
  /** which detector frames the hulls. Default `'trace-problems'`. */
  source?: FenceObstacleSource;
  /** the clearance the cut will hold, in metres — the detector reports `threadable` against it. */
  margin?: number;
  /** detector settings, when the source is `'trace-problems'`. */
  detector?: TraceProblemOptions;
  /** spans already detected on the same trace, when the source is `'trace-problems'` */
  spans?: TraceProblemSpan[];
  /** hulls to fuse with whatever they overlap — pairs whose rods overlapped when laid ({@link RodOverlapError}) */
  fuse?: Vec2[][];
};

/**
 * The stretches of the trace a cut must go AROUND rather than follow, as convex-hull borders.
 *
 * ⛔ The trajectory INSIDE one of these hulls is DEGENERATE — folded, looped, kinked. No
 * measurement taken from it and no decision made on it means anything; the hull stands in for it.
 *
 * ⭐⭐ The hulls come from {@link traceProblemSpans}, which asks two DIMENSIONLESS questions — does
 * the trace double back through a gap narrower than the stretch it traps, and does it turn tighter
 * than the surrounding curve explains — so a 25 m hook and a 900 m loop are caught by the same
 * rule. MEASURED against the legacy {@link fenceFoldSpans} on synthetic shapes whose right answer
 * is known: the legacy path returns exactly ONE hull on EVERY shape, always the same 6–25 m blob
 * over the first ~35 vertices (the vertical section's plan wander), and gives an IDENTICAL verdict
 * for a fold with a quarter-width mouth and one with a triple-width mouth. It carries no
 * information about the folds it exists to frame.
 *
 * ⭐ A KINK is an obstacle on the same footing as a pocket. The cut cannot follow a bend the trace
 * turns through faster than the fence can flow, and there is no separate repair to hand it to —
 * `cutCusps` finds its own targets on the FINISHED offset and takes no list of locations.
 *
 * @param trace the plan trace ({@link FenceBase.points})
 *
 * @group Geometries
 */
export function fenceObstacles(
  trace: Vec2[],
  options: FenceObstacleOptions = {},
): Vec2[][] {
  if ((options.source ?? 'trace-problems') === 'fold-spans') {
    return fenceFoldSpans(trace).map(([a, b]) =>
      convexHull2D(trace.slice(a, b + 1)),
    );
  }
  const spans =
    options.spans ??
    traceProblemSpans(trace, { margin: options.margin, ...options.detector });
  return mergeOverlappingObstacles(
    [...spans.map(span => span.hull), ...(options.fuse ?? [])],
    options.margin ?? 0,
    trace,
  );
}

/**
 * Fuse obstacles whose margin-grown zones would overlap into one convex hull each.
 *
 * ⛔⛔ THE INVARIANT THIS RESTORES: `oneSidedOffset` models a gap as ONE zone. The prune records
 * a single `blocker` index per gap (a majority vote over the swallowed candidates), and `connect`
 * then clips both run ends back out of THAT ring and traces THAT ring's boundary between them.
 * Nothing checks the traced boundary against any other obstacle — so where two zones overlap, the
 * run end can still sit inside the second one and the trace can pass straight through it. Two
 * overlapping obstacles are not two problems; they are one region the cut has to get around.
 *
 * ⭐ The fusion is the CONVEX HULL of the two, never a polygon union: a union of overlapping
 * convex sets is not convex, and every consumer downstream — `pointInConvex`, `dilateConvex`,
 * `ringExitIndex`, `tangentVertex`, the clip-and-trace above — is only defined for a convex ring.
 *
 * ⚠️ Overlap is of the ZONES — the points within `margin` of each hull — so two hulls are one
 * region when they come within `2 · margin` of each other: two features metres apart are separate
 * at margin 0.1 and one region at margin 20. That is why this needs the margin.
 *
 * ⭐ Two zones apart are still ONE region when the trace between them is too short for the rods
 * round both ({@link rodsCrowd}): each rod runs on along it by its anchor, and two that meet cross.
 *
 * Each pass fuses one pair, so it terminates after at most `hulls.length - 1` of them — the count
 * strictly falls and there is no iteration cap standing in for convergence.
 */
function mergeOverlappingObstacles(
  hulls: Vec2[][],
  margin: number,
  trace: Vec2[],
): Vec2[][] {
  let current = hulls;
  for (;;) {
    let fused: Vec2[][] | null = null;
    for (let i = 0; i < current.length && !fused; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const gap = convexPolygonDistance(current[i], current[j]);
        if (
          !(gap === 0 || gap < 2 * margin) &&
          !(margin > 0 && rodsCrowd(trace, current[i], current[j], margin))
        ) {
          continue;
        }
        fused = current.filter((_, k) => k !== i && k !== j);
        fused.push(convexHull2D([...current[i], ...current[j]]));
        break;
      }
    }
    if (!fused) return current;
    current = fused;
  }
}

/**
 * The plan-trace vertex the 3D kickoff ({@link fenceKickoff}) maps onto — the head's BASE.
 *
 * The trace is a simplification of the samples, so the kickoff sample is matched by nearest
 * segment and snapped to that segment's nearer end.
 *
 * ⭐ A trace that never kicks off is vertical to its end, so all of it is head — the last index.
 * Based at the apex instead, a head pocket framed 3 m short of X04's TD cut at 1900 m, and the
 * cores followed that scatter into a TD arm read off it (78–173° at margins 0.1–3.3).
 *
 * @group Geometries
 */
export function fenceKickoffIndex(well: Vec2[], samples: FenceSamples): number {
  const kickoff = fenceKickoff(samples);
  if (!kickoff.found && !kickoff.fromStart) return well.length - 1;
  const target = samples.plan[kickoff.index] ?? well[0];
  let kickoffIndex = 0;
  let best = Infinity;
  for (let i = 0; i + 1 < well.length; i++) {
    const a = well[i];
    const b = well[i + 1];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const l2 = ex * ex + ez * ez;
    let t =
      l2 > 0 ? ((target[0] - a[0]) * ex + (target[1] - a[1]) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(
      target[0] - (a[0] + ex * t),
      target[1] - (a[1] + ez * t),
    );
    if (d < best) {
      best = d;
      kickoffIndex = t > 0.5 ? i + 1 : i;
    }
  }
  return kickoffIndex;
}

/**
 * Plan the head arm for a fence: the head framed as ONE obstacle from the apex down to the 3D
 * kickoff (folds near it absorbed, overlapping obstacle hulls merged), then the arm's axis and
 * the VIRTUAL WELL the cores are offset from ({@link planHeadArm}).
 *
 * ⭐ The head base is the KICKOFF read off the 3D samples and mapped onto the plan trace — near the
 * apex the plan is degenerate, so nothing about the head can be settled from its plan shape, while
 * the inclination is a fact about the trajectory.
 *
 * ⭐ A pocket the head absorbs is framed at its MOUTH first, which conserves area, and with its NECK
 * only when that leaves the well a steep concave turn out of the wrap — an exit angle under the
 * 45° turn limit ({@link headWrapExitAngle}). MEASURED exit angles, mouth / neck: F-1 C 73°/132°,
 * F-11 A and T2 41°/87–108°, F-11 B 33°/87°, X07 23°/54°.
 *
 * @param well the plan trace ({@link FenceBase.points})
 * @param samples the 3D samples the trace was prepared from
 * @param obstacles the mid-trace hulls ({@link fenceObstacles}) at the same margin; the plan's
 * `wrap.obstacles` is the list it was framed against, rebuilt when the mouths were kept
 * @param options.problems trace problems already detected on a trace starting where `well` does
 * (the cores' run-on trace), re-indexed onto `well` by arc length instead of detecting again
 * @returns null only for a plan trace of fewer than 2 points. A plan-degenerate well (nothing
 * outside the head ring, or no hull of its own) gets a plan with BOTH arms synthesized, see
 * `HeadArmPlan.degenerate`.
 *
 * @group Geometries
 */
export function planFenceHead(
  well: Vec2[],
  samples: FenceSamples,
  margin: number,
  outline: Vec2[][],
  obstacles: Vec2[][],
  options: Pick<
    FenceArmsOptions,
    | 'fallbackAngle'
    | 'tdPlan'
    | 'headTurnout'
    | 'headBearing'
    | 'headMinTdAngle'
    | 'headOffset'
  > & {
    problems?: { trace: Vec2[]; spans: TraceProblemSpan[] };
    /** see {@link FenceObstacleOptions.fuse} — applied again when the obstacles are rebuilt */
    fuse?: Vec2[][];
  } = {},
): HeadArmPlan | null {
  const kickoffIndex = fenceKickoffIndex(well, samples);
  const spans = options.problems
    ? spansOnto(well, options.problems.trace, options.problems.spans)
    : traceProblemSpans(well, { margin });
  // ⭐ A head already deviating (trimmed below the kickoff) has no vertical stretch to frame, and a
  // hull-less wrap would send a deviated well down the DEGENERATE branch. Frame its apex at the
  // margin instead, so the head arm keeps the opposite-TD rule.
  const apexFrame = fenceKickoff(samples).fromStart
    ? marginFrame(well[0], margin)
    : null;
  const wrapOf = (s: TraceProblemSpan[], o: Vec2[][]) => {
    const wrap = headWrapRegion(well, kickoffIndex, margin, s, o);
    return wrap.hull.length < 3 && apexFrame
      ? headWrapRegion(well, kickoffIndex, margin, s, o, apexFrame)
      : wrap;
  };
  const neck = wrapOf(spans, obstacles);
  const loops = neck.absorbed.filter(
    (s): s is TracePocketSpan => isTracePocket(s) && s.neck > 0,
  );
  if (loops.length > 0) {
    // the neck still decides what is absorbed; only the hull and the head's end come from the loop
    const loopSpans = spans.map(
      (s): TraceProblemSpan =>
        isTracePocket(s) && loops.includes(s)
          ? { ...s, span: [s.span[0], s.loop.span[1]], hull: s.loop.hull }
          : s,
    );
    const loopObstacles = fenceObstacles(well, {
      margin,
      spans: loopSpans,
      fuse: options.fuse,
    });
    const loop = wrapOf(loopSpans, loopObstacles);
    if (headWrapExitAngle(well, loop, margin) >= DEFAULT_MAX_RELATIVE_TURN) {
      const plan = planHeadArm(
        well,
        loop,
        margin,
        outline,
        loopObstacles,
        options,
      );
      return plan && { ...plan, framing: 'loop' };
    }
  }
  const plan = planHeadArm(well, neck, margin, outline, obstacles, options);
  return plan && { ...plan, framing: loops.length > 0 ? 'neck' : undefined };
}

/** `spans` detected on `from`, re-indexed onto `to` by arc length measured from `to`'s start. */
function spansOnto(
  to: Vec2[],
  from: Vec2[],
  spans: TraceProblemSpan[],
): TraceProblemSpan[] {
  if (to === from || spans.length === 0 || to.length < 2) return spans;
  const fromArc = polylineArcLengths(from);
  const toArc = polylineArcLengths(to);
  const offset = nearestOnPolyline(from, to[0][0], to[0][1])?.along ?? 0;
  const onto = (i: number): number => {
    const a = fromArc[i] - offset;
    let lo = 0;
    let hi = toArc.length - 1;
    if (a <= 0) return 0;
    if (a >= toArc[hi]) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (toArc[mid] < a) lo = mid;
      else hi = mid;
    }
    return a - toArc[lo] <= toArc[hi] - a ? lo : hi;
  };
  return spans.map(s => {
    const span: [number, number] = [onto(s.span[0]), onto(s.span[1])];
    return isTracePocket(s)
      ? {
          ...s,
          span,
          loop: {
            span: [onto(s.loop.span[0]), onto(s.loop.span[1])] as [
              number,
              number,
            ],
            hull: s.loop.hull,
          },
        }
      : { ...s, span };
  });
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
   * (scene XZ, 0 = +X). Default 0.
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
 * the path itself.
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
  const points = simplifyCurve2D(
    dedupePolyline2D(dense, 0.25),
    undefined,
    SIMPLIFY_TOLERANCE,
  );
  // ⚠️⚠️ The trace is NEVER fabricated. A near-vertical well used to have its whole plan path
  // REPLACED by a synthetic segment through the CENTROID of its scatter at the fallback angle,
  // which threw away the real head and TD — so both cuts were offset from an invented line and
  // could end up on the SAME side of the actual wellhead, and the debug view's position marker
  // (which samples the real spline) sat off the drawn base. `degenerate` says the well has no
  // bearing of its own; that is a fact about the RUN-OUTS, and only they may act on it.
  const degenerate = planExtent(points) < MIN_PLAN_EXTENT;
  return {
    points,
    kickoff,
    planLength: polylineLength(points),
    degenerate,
  };
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

/** One side's finished curve, ready to be rasterised and swept. */
export type FenceSideCurve = {
  /** which half this curve removes — see {@link FenceSideName} */
  side: FenceSideName;
  /** scene XZ, HEAD→TD: run-out, the one-sided cut, run-out */
  points: Vec2[];
  /**
   * How the curve is made up, as index ranges — the seams between them ARE the joins.
   *
   * ⭐ The only honest way to attribute a defect. A kink reported at vertex 1200 says nothing;
   * "in the `ring-walk`, not the `core`" is what tells you which builder to look at.
   */
  pieces: CurvePiece[];
  /** where the finished curve turns most sharply — the steep gate's evidence, always reported */
  worstTurn: PolylineTurn;
};

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
  side: FenceSideName;
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
  side: FenceSideName;
  vertices: number;
  /** the steepest RELATIVE turn anywhere on the finished cut, in DEGREES */
  worstTurn: number;
  removedShare: number;
  /**
   * Metres of trajectory left in the KEPT block, worst case.
   *
   * ⭐⭐ THE number the old report lacked, and the one check the CUT BUILDER cannot make for
   * itself: its gates compare the cut against the well, while this asks the finished FIELD —
   * the very lookup the shader uses — whether the well came out in the half that goes.
   * Must stay under {@link BURIAL_LIMIT}.
   */
  burial: number;
  field: { nx: number; ny: number; cell: number; separated: boolean };
  /**
   * The exact boundary lookup's shape.
   *
   * ⚠️ `flips` must be 0: a truncated cell whose capped list puts a point on the other side
   * than the full list is a notch in the cut. `truncated` alone only costs distance precision,
   * which nothing reads — every consumer tests the sign.
   */
  index: {
    cells: number;
    entries: number;
    maxCount: number;
    truncated: number;
    flips: number;
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

/** The shared run-out arms a build ended up with. @group Geometries */
export type FenceArmsReport = {
  /** the TD (dominant) end's shared arm */
  td: FenceArmEnd;
  /** the head end — a no-arm end sitting at the apex; the head arm was removed */
  head: FenceArmEnd;
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
    /** near-vertical stretches the cut must bypass, each a convex-hull border (see {@link fenceObstacles}) */
    obstacles: Vec2[][];
  };
  arms: FenceArmsReport;
  /** the stretch of the trajectory the fence was built around — see {@link FenceBlockSpan} */
  block: FenceBlockSpan;
  /** {@link WellboreFenceOptions.verticalRange} as `[lowest, highest]` scene Y; absent when unbounded */
  verticalRange?: [number, number];
  /** metres the cores ran on past the block's head and TD — see {@link fenceCoreTrace} */
  coreReach: [number, number];
  /** each side's report — both are always present, see {@link WellboreFence.left} */
  sides: { left: FenceSideReport; right: FenceSideReport };
  /** milliseconds per stage */
  timings: Record<string, number>;
};

/**
 * The part of a trajectory that passes through the BLOCK — inside the footprint and
 * {@link WellboreFenceOptions.verticalRange} — which is all a fence is built around.
 *
 * ⭐ An end cut off at the footprint is extended until it is clear of it and gets NO run-out: the
 * cut already leaves the block there, and an arm off an outside end is a slit through the block
 * with no well in it.
 *
 * @group Geometries
 */
export type FenceBlockSpan = {
  /** share of the trajectory's MD inside the block, 0..1 */
  inside: number;
  /** the MD range kept, in metres along the whole trajectory */
  md: [number, number];
  /** whether the kept head carries a run-out — false when it lies outside the footprint */
  headArm: boolean;
  /** whether the kept TD carries a run-out — false when it lies outside the footprint */
  tdArm: boolean;
};

/** A finished fence: one curve per side, each with its own field. */
export type WellboreFence = {
  /** the raw plan trace both sides' cuts are built from, without run-outs */
  base: FenceBase;
  /**
   * The removed-half cut for each side.
   *
   * ⭐⭐ BOTH OR NEITHER. The two cuts share their run-out arms, so there is no such thing as
   * one of them succeeding on its own — a build that cannot produce both THROWS, naming the
   * invariant it could not meet.
   */
  left: FenceSide;
  right: FenceSide;
  report: FenceReport;
};

/** {@link buildWellboreFence} options. */
export type WellboreFenceOptions = {
  /** every ring of the footprint, in scene XZ */
  rings: Vec2[][];
  /**
   * Scene-Y interval the block occupies, `[lowest, highest]`. The trajectory above and below it
   * is left out of the fence — see {@link FenceBlockSpan}. Omit for no vertical limit.
   */
  verticalRange?: [number, number];
  /**
   * Metres of clearance kept between the trajectory and the cut. Default
   * {@link MIN_FENCE_MARGIN}.
   *
   * ⚠️ MUST be > 0 — a fence with no clearance has no room to route past the well's own
   * folds, and the cut is built as an offset of the trace. Zero throws by name rather than
   * being quietly raised, which is what used to happen.
   */
  margin?: number;
  /** MD spacing the trajectory is sampled at, in metres. Default 10. */
  sampleSpacing?: number;
  /** metres per cell of the field. Default {@link fenceCellSize}. */
  cellSize?: number;
  /** metres the run-out arms reach PAST the footprint. Default 500. */
  runOutMargin?: number;
  /**
   * Metres the cores run on past an open end of the block, or a TD cut by its bottom, before being
   * cut back to it — see {@link fenceRunOn}. Default `runOutMargin`; 0 stops them at the block.
   */
  coreReach?: number;
  /**
   * Plan angle the fence falls back to for a near-vertical well, in degrees (scene XZ,
   * 0 = +X). Default 0. A deviated well's trajectory overrides it.
   */
  fallbackAngle?: number;
  /** see {@link FenceArmsOptions.headTurnout}. Default 100. */
  headTurnout?: number;
  /** see {@link FenceArmsOptions.headBearing}. Default `'opposite-td'`. */
  headBearing?: 'opposite-td' | 'free';
  /** see {@link FenceArmsOptions.headMinTdAngle}. Default 90°. */
  headMinTdAngle?: number;
  /**
   * Slack the finished cut is VERIFIED against, in metres — never built against. Default
   * {@link DEFAULT_TOLERANCE}.
   *
   * ⭐ The cut holds the FULL margin by construction; this only stops a curve resting exactly
   * on its margin from reading as buried through float noise.
   */
  tolerance?: number;
  /** the stiff rod's bending length as a multiple of the obstacle ring's diameter — see `OneSidedOffsetOptions.rodStiffness`. Default 1. */
  rodStiffness?: number;
  /** the stiff rod's anchor scale — see `OneSidedOffsetOptions.rodAnchor`. */
  rodAnchor?: { scale?: number };
  /** identifier carried into the report */
  wellbore?: string;
};

/** Arc the seed's normal is measured over, in metres. */
const SEED_NORMAL_ARC = 25;

/** Fractions of the well's arc a seed is tried at, centre outward. */
const SEED_POSITIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];

/**
 * A point clear of the cut, on the half being REMOVED — verified, never assumed.
 *
 * ⭐⭐ The whole field's sign hangs on this ONE point: the flood fill is seeded here, so a
 * seed on the wrong side inverts the cut and the ENTIRE trajectory reads buried. It is
 * settled by the only thing that can settle it — a segment from the well to the seed must
 * not CROSS the cut, which proves the two lie in the same half — and by a MAJORITY of the
 * well rather than a single vertex, because a locally buried vertex would otherwise certify
 * a bad seed.
 *
 * ⚠️⚠️ This used to be `base[base.length >> 1]` pushed along one adjacent-vertex normal.
 * Both are RESOLUTION-DEPENDENT: simplification is deliberately non-uniform, so the INDEX
 * midpoint landed anywhere between 16% and 37% of arc, and an adjacent-vertex baseline on a
 * dense trace is survey scatter rather than a heading. Measured across eight wells, three
 * seeded on the KEPT side with 58/58 well vertices on the far side of the cut from their own
 * seed — a whole-trajectory burial that no downstream pass could have repaired.
 *
 * ⚠️ The step grows with the field's cell, so on a large field it overshot a cut passing 52–117 m
 * beyond the well into the KEPT half. A step that crosses the cut stops halfway to it instead.
 *
 * @param axis the HEAD→TD direction to read the side off, when the trace has none of its own — a
 * plan-degenerate well's trace is survey scatter, and its "tangent" put every seed across the cut
 * @throws when no candidate agrees with the well, which means the cut does not separate it
 */
function removedSideSeed(
  base: Vec2[],
  cut: Vec2[],
  side: FenceSideName,
  clearance: number,
  axis?: Vec2,
): Vec2 {
  if (base.length < 2 || cut.length < 2) {
    throw new Error('fence: cannot seed a side from a degenerate curve');
  }
  // ⚠️⚠️ AWAY FROM THE CUT, not toward it. `side` names where the CUT lies, the cut sits
  // `margin` off the well and `clearance` is deliberately larger, so stepping along the side's
  // own normal lands PAST the cut — in the half that is KEPT. The removed half is the one the
  // well is in, which is the other way. (Measured: seeding along `+sign` agreed with 0% of the
  // well on every wellbore.) The majority vote below is what actually proves it.
  const sign = -fenceSideSign(side);
  const arc = polylineArcLengths(base);
  const total = arc[base.length - 1];
  let best: Vec2 | null = null;
  let bestAgreement = 0;
  let bestReach = 0;
  // Witnesses for the vote — a spread of the well, not the seed's own neighbourhood.
  const step = Math.max(1, Math.ceil(base.length / 24));
  for (const fraction of SEED_POSITIONS) {
    const target = total * fraction;
    let at = 1;
    while (at + 1 < base.length && arc[at] < target) at++;
    // ⛔ Past the last vertex there is nothing to read: a two-vertex block (19 SR in a 0.8 km crop)
    // skipped every candidate. The segment the seed sits on is its tangent then.
    const tangent =
      axis ??
      meanTangent2D(base.slice(at), true, SEED_NORMAL_ARC) ??
      meanTangent2D(base.slice(at - 1), true, SEED_NORMAL_ARC);
    if (!tangent) continue;
    const n = leftNormal2D(tangent[0], tangent[1]);
    const [px, pz] = base[at];
    const hits = segmentPolylineCrossingParams(
      px,
      pz,
      px + n[0] * sign * clearance,
      pz + n[1] * sign * clearance,
      cut,
    );
    const reach = hits.length > 0 ? (hits[0] * clearance) / 2 : clearance;
    const seed: Vec2 = [px + n[0] * sign * reach, pz + n[1] * sign * reach];
    let same = 0;
    let tested = 0;
    for (let i = 0; i < base.length; i += step) {
      const crossings = segmentPolylineCrossings(
        seed[0],
        seed[1],
        base[i][0],
        base[i][1],
        cut,
      );
      if (crossings % 2 === 0) same++;
      tested++;
    }
    const agreement = tested > 0 ? same / tested : 0;
    if (agreement > 0.9 && hits.length === 0) return seed;
    // ⭐ Among shortened steps the widest corridor wins: the fill starts from the NEAREST NODE.
    const better =
      agreement > 0.9
        ? bestAgreement <= 0.9 || reach > bestReach
        : agreement > bestAgreement;
    if (better) {
      bestAgreement = agreement;
      bestReach = reach;
      best = seed;
    }
  }
  if (!best || bestAgreement <= 0.5) {
    throw new Error(
      `fence: no seed found on the removed side — the best candidate agreed with only ` +
        `${(bestAgreement * 100).toFixed(0)}% of the well, so the cut does not separate it`,
    );
  }
  return best;
}

/** Clearance an end cut off at the footprint is extended to, as a multiple of `margin`. */
const OUTSIDE_CLEARANCE = 2;

/** Bisection steps locating where the trajectory enters or leaves the block. */
const SPAN_BISECTIONS = 24;

/** The stretch `[from, to]` of a curve's normalised arc, as a curve of its own. */
function sliceCurve3D(curve: Curve3D, from: number, to: number): Curve3D {
  const span = to - from;
  const at = (u: number) => from + u * span;
  return {
    getPointAt: u => curve.getPointAt(at(u)),
    getPoints: (count, a = 0, b = 1) => curve.getPoints(count, at(a), at(b)),
    getTangentAt: u => curve.getTangentAt(at(u)),
    getNormalAt: u => curve.getNormalAt(at(u)),
    getBoundingBox: (a = 0, b = 1) => curve.getBoundingBox(at(a), at(b)),
    // The parent's nearest point, clamped into the slice.
    nearest: point => {
      const hit = curve.nearest(point);
      const u = Math.min(1, Math.max(0, (hit.position - from) / span));
      const p = curve.getPointAt(at(u));
      return {
        position: u,
        point: p,
        distance: Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]),
      };
    },
    length: curve.length * span,
    closed: false,
  };
}

/**
 * Where a trajectory passes through the block, read off its MD samples and refined by bisection.
 *
 * @param clearance metres an end cut off at the footprint is walked out past it
 * @returns null when no sample is inside — there is nothing for a fence to reveal
 */
function fenceBlockSpan(
  curve: Curve3D,
  samples: FenceSamples,
  rings: Vec2[][],
  verticalRange: [number, number] | undefined,
  clearance: number,
): (FenceBlockSpan & { from: number; to: number }) | null {
  const boxes = rings.map(ring => polylineBounds2D(ring));
  const inPlan = (x: number, z: number): boolean => {
    let inside = rings.length === 0;
    for (let k = 0; k < rings.length; k++) {
      const [minX, minZ, maxX, maxZ] = boxes[k];
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (pointInRing(x, z, rings[k])) inside = !inside;
    }
    return inside;
  };
  const low = verticalRange
    ? Math.min(verticalRange[0], verticalRange[1])
    : -Infinity;
  const high = verticalRange
    ? Math.max(verticalRange[0], verticalRange[1])
    : Infinity;
  const inBlock = (p: Vec3) =>
    p[1] >= low && p[1] <= high && inPlan(p[0], p[2]);
  const clearOf = (p: Vec2): number => {
    let best = Infinity;
    for (const ring of rings) {
      const near = nearestOnPolyline([...ring, ring[0]], p[0], p[1]);
      if (near && near.distance < best) best = near.distance;
    }
    return best;
  };

  const { plan, y, md } = samples;
  const n = plan.length;
  const length = curve.length;
  const flags = new Uint8Array(n);
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!inBlock([plan[i][0], y[i], plan[i][1]])) continue;
    flags[i] = 1;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return null;
  let insideMd = 0;
  for (let i = 1; i < n; i++) {
    insideMd += ((md[i] - md[i - 1]) * (flags[i - 1] + flags[i])) / 2;
  }
  const total = md[n - 1] - md[0];

  const u = (i: number) => md[i] / length;
  const planIn = (i: number) => inPlan(plan[i][0], plan[i][1]);
  /** One kept end: `edge` is the outermost station inside, `step` walks outward (-1 head, +1 TD). */
  const end = (edge: number, step: -1 | 1): { at: number; arm: boolean } => {
    const beyond = edge + step;
    if (beyond < 0 || beyond >= n) return { at: step < 0 ? 0 : 1, arm: true };
    let outer = u(beyond);
    let inner = u(edge);
    for (let k = 0; k < SPAN_BISECTIONS; k++) {
      const mid = (outer + inner) * 0.5;
      if (inBlock(curve.getPointAt(mid))) inner = mid;
      else outer = mid;
    }
    // Out through the top or bottom of the block, over the footprint: cut there, and run out.
    const exit = curve.getPointAt(outer);
    if (inPlan(exit[0], exit[2]) || planIn(beyond)) {
      return { at: inner, arm: true };
    }
    // Out through the footprint: walk on until clear of it, or until the trace turns back in.
    let j = beyond;
    while (
      j + step >= 0 &&
      j + step < n &&
      clearOf(plan[j]) < clearance &&
      !planIn(j + step)
    ) {
      j += step;
    }
    return { at: u(j), arm: false };
  };
  const head = end(first, -1);
  const td = end(last, 1);
  return {
    inside: total > 0 ? insideMd / total : 1,
    md: [head.at * length, td.at * length],
    headArm: head.arm,
    tdArm: td.arm,
    from: head.at,
    to: td.at,
  };
}

/** {@link fenceBlockTrace} options. @group Geometries */
export type FenceBlockTraceOptions = Pick<
  WellboreFenceOptions,
  'verticalRange' | 'margin' | 'sampleSpacing'
>;

/** A trajectory trimmed to the block — see {@link fenceBlockTrace}. @group Geometries */
export type FenceBlockTrace = {
  /** the trajectory through the block; the input curve itself when nothing was trimmed */
  curve: Curve3D;
  /** `curve`'s MD samples ({@link sampleTrajectoryPlan}) */
  samples: FenceSamples;
  span: FenceBlockSpan;
};

/**
 * Trim a trajectory to where it passes through the block, exactly as {@link buildWellboreFence}
 * does before anything else — see {@link FenceBlockSpan}.
 *
 * @param rings every ring of the footprint, in scene XZ; none means no limit in plan
 * @returns null when the trajectory cannot be sampled or never enters the block
 *
 * @group Geometries
 */
export function fenceBlockTrace(
  curve: Curve3D,
  rings: Vec2[][],
  options: FenceBlockTraceOptions = {},
): FenceBlockTrace | null {
  const full = sampleTrajectoryPlan(curve, options.sampleSpacing);
  if (!full) return null;
  const found = fenceBlockSpan(
    curve,
    full,
    rings,
    options.verticalRange,
    fenceMargin(options.margin) * OUTSIDE_CLEARANCE,
  );
  if (!found) return null;
  const { from, to, ...span } = found;
  if (from <= 0 && to >= 1) return { curve, samples: full, span };
  const sliced = sliceCurve3D(curve, from, to);
  const samples = sampleTrajectoryPlan(sliced, options.sampleSpacing);
  return samples ? { curve: sliced, samples, span } : null;
}

/**
 * Metres the cores run on past a block's head and TD ({@link fenceCoreTrace}).
 *
 * ⭐ An OPEN end runs on, and so does a TD cut by the bottom once the block is past its kickoff. An
 * armed head never does — it is planned, and the cores follow its guide — nor does a TD cut still
 * in the vertical column: run on, it crossed the kickoff (F-14 cut at 2000 m, kickoff at MD 2136).
 * A run-on that ends in the zone over the block's TD is not cut back: that TD is planned instead
 * ({@link fenceCoreInputs}).
 *
 * @param samples the block trajectory's samples ({@link FenceBlockTrace.samples})
 * @param length the WHOLE trajectory's length
 *
 * @group Geometries
 */
export function fenceRunOn(
  span: FenceBlockSpan,
  samples: FenceSamples,
  length: number,
  runOn: number,
): [number, number] {
  const kickoff = fenceKickoff(samples);
  const tdCut =
    span.tdArm &&
    span.md[1] < length - 1e-6 &&
    (kickoff.found || kickoff.fromStart);
  return [span.headArm ? 0 : runOn, !span.tdArm || tdCut ? runOn : 0];
}

/** The plan trace a fence's cores are built on — see {@link fenceCoreTrace}. @group Geometries */
export type FenceCoreTrace = {
  /** the block's plan trace, run on past its ends */
  points: Vec2[];
  /** metres it runs on past the block's head and TD */
  reach: [number, number];
};

/**
 * The plan trace a fence's cores are built on: the block's stretch of `curve` run on `reach`
 * metres past its head and TD, clamped to the trajectory.
 *
 * ⭐ A core cut off at the block's edge left a rod there nothing to anchor on but a straight
 * stand-in, refused where it crossed the well (F-11 B cropped at margin 4.7: 6.5 of 26.3 atoms
 * laid), so the same rod came out differently wherever the block ended. Run on, it settles on the
 * real well; {@link trimFenceCore} cuts it back.
 *
 * @returns null when neither end has anything to add
 *
 * @group Geometries
 */
export function fenceCoreTrace(
  curve: Curve3D,
  span: FenceBlockSpan,
  reach: [number, number],
  options: Pick<WellboreFenceOptions, 'sampleSpacing' | 'fallbackAngle'> = {},
): FenceCoreTrace | null {
  const length = curve.length;
  const from = Math.max(0, span.md[0] - Math.max(0, reach[0]));
  const to = Math.min(length, span.md[1] + Math.max(0, reach[1]));
  const got: [number, number] = [span.md[0] - from, to - span.md[1]];
  if (!(got[0] > 1e-6) && !(got[1] > 1e-6)) return null;
  const sliced =
    from <= 0 && to >= length
      ? curve
      : sliceCurve3D(curve, from / length, to / length);
  const samples = sampleTrajectoryPlan(sliced, options.sampleSpacing);
  if (!samples) return null;
  const { points } = prepareFenceTrace(sliced, samples, {
    fallbackAngle: options.fallbackAngle,
  });
  return { points, reach: got };
}

/**
 * `trace` run on along `longer` past the point of it nearest `trace`'s last vertex — a planned
 * head's virtual well continued onto a {@link fenceCoreTrace} run on past the TD.
 *
 * @group Geometries
 */
export function fenceRunOnTrace(trace: Vec2[], longer: Vec2[]): Vec2[] {
  const end = trace[trace.length - 1];
  const hit = end ? nearestOnPolyline(longer, end[0], end[1]) : null;
  if (!hit) return trace;
  const arcs = polylineArcLengths(longer);
  const out = [...trace];
  for (let i = 0; i < longer.length; i++) {
    if (arcs[i] > hit.along + 1e-9) out.push(longer[i]);
  }
  return dedupePolyline2D(out, 1e-9);
}

export { trimFenceCore };

/** What both cores of a fence are offset from — see {@link fenceCoreInputs}. @group Geometries */
export type FenceCoreInputs = {
  /** the trace the cores are offset from: the head plan's virtual well, run on past the block */
  trace: Vec2[];
  /** the trace problems framed as hulls, detected once on the run-on trace */
  obstacles: Vec2[][];
  /** what the cores route around: `obstacles`, with the head wrap in place of those it merged */
  route: Vec2[][];
  /** the head plan, or null when the head lies outside the footprint */
  headArm: HeadArmPlan | null;
  /**
   * the TD routed round the obstacle over it ({@link planTdArm}), or null when none covers it — or,
   * run on past a bottom cut, when the run-on leaves the zone or the block's TD is outside it
   */
  tdPlan: TdArmPlan | null;
  /** the stretch that ships: the offset's `keep`, cut back to by {@link trimFenceCore}; no TD where a plan owns it */
  trim: { head?: Vec2; td?: Vec2 };
  /** the well the TD bearing is read from ({@link FenceArmsOptions.bearingWell}) */
  bearing: Vec2[];
  /** metres the trace runs on past the block's head and TD */
  reach: [number, number];
};

/** Below this {@link TracePocketSpan.ratio} an arm's corridor is accepted, widened, when no angle avoids one. */
const MILD_ARM_POCKET_RATIO = 10;

/** How much wider an accepted corridor's mouth is made ({@link FenceArmsOptions.headOffset}). */
const ARM_POCKET_WIDENING = 3;

/**
 * The TD arm DIVERTED for a head that grew over the well along the opposite-TD axis, or whose arm
 * forms a corridor with it ({@link armPocket}) — or null to keep the undiverted plan.
 *
 * ⭐ Over the angles that keep the head from growing ({@link tdDiversionAngles}), in order: the first
 * that {@link frameArmPocket} screens as clean AND the planned arm confirms; else the first planned
 * clean one; else the first whose corridor is mild (ratio < {@link MILD_ARM_POCKET_RATIO}), with the
 * head arm moved sideways away from the well until its mouth is {@link ARM_POCKET_WIDENING}× as wide.
 * With no such angle at all, the one meeting the well nearest without a reversal. Kept only when the
 * head hull is no larger than undiverted.
 */
function divertTdArm(
  well: Vec2[],
  base: HeadArmPlan,
  obstacles: Vec2[][],
  margin: number,
  footprint: Vec2[][],
  planHead: (td: TdArmPlan, headOffset?: number) => HeadArmPlan | null,
  options: Pick<FenceArmsOptions, 'fallbackAngle' | 'headTurnout'>,
): { td: TdArmPlan; plan: HeadArmPlan } | null {
  const frame = base.frame;
  if (!frame || (!base.grown && !armPocket(base, well, margin))) return null;
  const angles = tdDiversionAngles(well, frame, obstacles, margin, footprint, options);
  type Tried = { td: TdArmPlan; plan: HeadArmPlan; pocket: TracePocketSpan | null };
  const tried = new Map<number, Tried | null>();
  const attempt = (angle: number): Tried | null => {
    if (!tried.has(angle)) {
      const td = planTdDiversion(well, angle, margin, footprint, options);
      const plan = planHead(td);
      tried.set(
        angle,
        plan && !plan.degenerate ? { td, plan, pocket: armPocket(plan, well, margin) } : null,
      );
    }
    return tried.get(angle)!;
  };
  const axis = (angle: number): Vec2 => [
    -(angles.td[0] * Math.cos(angle) - angles.td[1] * Math.sin(angle)),
    -(angles.td[0] * Math.sin(angle) + angles.td[1] * Math.cos(angle)),
  ];
  let chosen: Tried | null = null;
  for (const angle of angles.clear) {
    if (frameArmPocket(well, frame, axis(angle), margin, footprint)) continue;
    const t = attempt(angle);
    if (t && !t.pocket) {
      chosen = t;
      break;
    }
  }
  let mild: Tried | null = null;
  for (const angle of chosen ? [] : angles.clear) {
    const t = attempt(angle);
    if (!t?.pocket) {
      chosen = t;
      if (t) break;
    } else if (!mild && t.pocket.ratio < MILD_ARM_POCKET_RATIO) mild = t;
  }
  if (!chosen && mild?.pocket) {
    // the bar end further off the arm's axis is the well's side of the corridor
    const perp = leftNormal2D(mild.plan.dir[0], mild.plan.dir[1]);
    const side = (p: Vec2) =>
      (p[0] - mild!.plan.exit[0]) * perp[0] + (p[1] - mild!.plan.exit[1]) * perp[1];
    const [a, b] = mild.pocket.bar.map(side);
    const wellSide = Math.abs(a) > Math.abs(b) ? a : b;
    const offset = -Math.sign(wellSide) * (ARM_POCKET_WIDENING - 1) * mild.pocket.mouth;
    const widened = planHead(mild.td, offset);
    const opened = widened && !widened.degenerate ? armPocket(widened, well, margin) : null;
    chosen =
      widened &&
      !widened.degenerate &&
      !(widened.grown && !mild.plan.grown) &&
      (!opened || opened.mouth > mild.pocket.mouth)
        ? { td: mild.td, plan: widened, pocket: opened }
        : mild;
  }
  if (!chosen && angles.clear.length === 0 && angles.nearest) {
    chosen = attempt(angles.nearest);
  }
  // a hairpin framed into the wrap enlarges it, so only GROWTH over the well counts against a diversion
  const keep =
    chosen &&
    (!chosen.plan.grown ||
      (base.grown && hullDiameter(chosen.plan.wrap.hull) < hullDiameter(base.wrap.hull)));
  return keep ? chosen : null;
}

/**
 * Everything the two cores of a fence are built from, exactly as {@link buildWellboreFence}
 * builds them: the run-on trace ({@link fenceRunOn}), its trace problems detected ONCE and
 * shared by the obstacles and the head plan, the head plan, and the trace and obstacles the
 * cores are offset around.
 *
 * ⛔ NO FALLBACK. A head inside the footprint that cannot be planned throws by name — a fence
 * with a bare head end does not separate the well and must not ship.
 *
 * @param curve the WHOLE trajectory, which the run-on is taken from
 * @param block the trajectory trimmed to the block ({@link fenceBlockTrace})
 * @param well the block's plan trace ({@link prepareFenceTrace} of `block`)
 * @param footprint the footprint rings the head arm reaches past
 *
 * @group Geometries
 */
export function fenceCoreInputs(
  curve: Curve3D,
  block: FenceBlockTrace,
  well: Vec2[],
  margin: number,
  footprint: Vec2[][],
  options: Pick<
    WellboreFenceOptions,
    | 'coreReach'
    | 'runOutMargin'
    | 'sampleSpacing'
    | 'fallbackAngle'
    | 'headTurnout'
    | 'headBearing'
    | 'headMinTdAngle'
  > & { fuse?: Vec2[][] } = {},
): FenceCoreInputs {
  const { samples, span } = block;
  const runOn = Math.max(
    0,
    options.coreReach ?? options.runOutMargin ?? DEFAULT_EXTENSION,
  );
  const core = fenceCoreTrace(
    curve,
    span,
    fenceRunOn(span, samples, curve.length, runOn),
    options,
  );
  const coreWell = core?.points ?? well;
  const spans = traceProblemSpans(coreWell, { margin });
  const obstacles = fenceObstacles(coreWell, {
    margin,
    spans,
    fuse: options.fuse,
  });
  // ⭐ An obstacle over the TD is routed like the head, and planned FIRST: its bearing, read off the
  // well before the hull, is the one the head arm is planned opposite.
  // ⭐ Run on, the plan stands only where the block's TD is in its zone too — the core then never
  // reaches the block TD (F-11 A cut at 1900 m hooks back into a 149 m hull and stays there).
  const tdRunOn = !!core && core.reach[1] > 0;
  let tdPlan = span.tdArm
    ? planTdArm(coreWell, obstacles, margin, footprint, {
        fallbackAngle: options.fallbackAngle,
      })
    : null;
  if (tdPlan && tdRunOn && !pointInConvex(well[well.length - 1], tdPlan.ring)) {
    tdPlan = null;
  }
  // The head is one more obstacle: planned first, so each core rounds its ring by the same rod
  // as any mid-trace fold and lands on the guide the head arm leaves from.
  const planHead = (td: TdArmPlan | null, headOffset?: number) =>
    span.headArm
      ? planFenceHead(well, samples, margin, footprint, obstacles, {
          fallbackAngle: options.fallbackAngle,
          headTurnout: options.headTurnout,
          headBearing: options.headBearing,
          headMinTdAngle: options.headMinTdAngle,
          headOffset,
          problems: { trace: coreWell, spans },
          tdPlan: td,
          fuse: options.fuse,
        })
      : null;
  let headArm = planHead(tdPlan);
  // A degenerate plan synthesizes its own TD guide; a head wrap that swallowed the TD hull owns it.
  if (tdPlan && headArm?.degenerate) tdPlan = null;
  if (tdPlan && headArm?.wrap.merged.includes(tdPlan.hull)) {
    tdPlan = null;
    headArm = planHead(null);
  }
  // ⭐ A head grown over the well along the opposite-TD axis, or whose arm forms a corridor (a
  // pocket) with the well: divert the TD arm — see {@link divertTdArm}.
  if (headArm?.frame && !headArm.degenerate && !tdPlan && span.tdArm && !tdRunOn) {
    const diverted = divertTdArm(well, headArm, obstacles, margin, footprint, planHead, {
      fallbackAngle: options.fallbackAngle,
      headTurnout: options.headTurnout,
    });
    if (diverted) {
      tdPlan = diverted.td;
      headArm = diverted.plan;
    }
  }
  if (span.headArm && !headArm) {
    throw new Error(
      'fence: the head cannot be planned — the plan trace has fewer than 2 points',
    );
  }
  // ⛔ A plan that owns the TD replaced the run-on tail: run on past a degenerate plan's TD guide,
  // the trace doubled back from its apex (F-11 A cut at 2000 m).
  const ownsTd = !!tdPlan || !!headArm?.degenerate;
  const trace = headArm
    ? core && !headArm.degenerate
      ? fenceRunOnTrace(headArm.trace, coreWell)
      : headArm.trace
    : coreWell;
  // ⭐ A block cut short at an open head reads its TD bearing on the run-on: X13 entering a 1.5 km
  // crop for its last 10 m fell back to +X against a well heading −X, and the arm turned 88–90°.
  let bearing = well;
  if (core && core.reach[0] > 0) {
    const arcs = polylineArcLengths(coreWell);
    const at = nearestOnPolyline(coreWell, well[0][0], well[0][1])?.along ?? 0;
    bearing = [...coreWell.filter((_, i) => arcs[i] < at - 1e-6), ...well];
  }
  return {
    trace: tdPlan ? tdPlanTrace(trace, tdPlan) : trace,
    obstacles: headArm ? headArm.wrap.obstacles : obstacles,
    route: headArm
      ? headRouteObstacles(headArm, headArm.wrap.obstacles)
      : obstacles,
    headArm,
    tdPlan,
    trim: {
      head: core && core.reach[0] > 0 ? well[0] : undefined,
      td: tdRunOn && !ownsTd ? well[well.length - 1] : undefined,
    },
    bearing,
    reach: core ? core.reach : [0, 0],
  };
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
 * @returns null when the trajectory is degenerate or never passes through the block
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
  const margin = fenceMargin(options.margin);
  // ⭐ Only the stretch through the block is followed — see {@link FenceBlockSpan}. A well kept
  // whole runs on the ORIGINAL curve and samples, so its fence is exactly what it was before.
  const block = fenceBlockTrace(curve, options.rings, options);
  if (!block) return null;
  const { curve: blockCurve, samples, span } = block;
  timings.sample = now() - mark;

  // ⚠️ Clearance is the MARGIN only — the room for a clear view of the well from the
  // cut face.
  const clearance = margin;
  // ⭐⭐ THE CUT IS BUILT STRICT: it holds the FULL margin, with no slack. `tolerance` is a
  // VERIFICATION concept only (see {@link fenceBurial}) and deliberately never reaches the
  // builder — a cut built against a looser clearance can pass construction and still read as
  // short of its margin, which is a fault the caller cannot see.
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;

  mark = now();
  const base = prepareFenceTrace(blockCurve, samples, {
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
  // ⭐⭐ ONE index for the whole build. The well is final from here on, and every clearance
  // and crossing test hits it — rebuilding the grid per call was most of the cost of a verify.
  const wellIndex = createPolylineIndex(well);
  const footprint =
    options.rings.length > 0 ? options.rings : [boundsRing(bounds)];
  const outline = rasterizeOutline(footprint, bounds);

  // The stretches the cut must route AROUND rather than follow — see THE ONE RULE in
  // `one-sided-offset.ts`: the trace inside one of these is degenerate and cannot be measured.
  // ⭐ The cores run on past an open end or a cut — see {@link fenceRunOn} — and are cut back to
  // the block after, so a rod near its edge settles on the real well wherever the block ends.
  mark = now();
  const plan = (fuse?: Vec2[][]) =>
    fenceCoreInputs(curve, block, well, margin, footprint, {
      ...options,
      fuse,
    });
  let inputs = plan();
  timings.head = now() - mark;
  // ⭐⭐ CORES FIRST, then the shared arms. Each side's core is the one-sided offset of the
  // VIRTUAL well; the arms are decided from BOTH cores together, so they cannot diverge.
  // ⚠️ `wellIndex` is NOT handed to the offset: it indexes the real well, and the offset's
  // clearance reference is the virtual trace.
  mark = now();
  const coreOf = (side: FenceSideName): Vec2[] =>
    oneSidedOffset(inputs.trace, side, margin, {
      obstacles: inputs.route,
      rodStiffness: options.rodStiffness,
      rodAnchor: options.rodAnchor,
      keep: inputs.trim,
    }).points;
  // ⭐ Two rods that need more run than lies between their rings: the pair is re-planned as ONE
  // obstacle, for both sides. Each round routes one hull fewer, so it ends.
  const fuse: Vec2[][] = [];
  const cores = (): { left: Vec2[]; right: Vec2[] } => {
    for (;;) {
      try {
        return { left: coreOf('left'), right: coreOf('right') };
      } catch (e) {
        if (!(e instanceof RodOverlapError)) throw e;
        fuse.push(convexHull2D([...e.hulls[0], ...e.hulls[1]]));
        const next = plan([...fuse]);
        if (next.route.length >= inputs.route.length) throw e;
        inputs = next;
      }
    }
  };
  const { left: leftCore, right: rightCore } = cores();
  const { headArm, obstacles } = inputs;
  timings.cores = now() - mark;

  mark = now();
  const arms = buildFenceCut(
    well,
    { left: leftCore, right: rightCore },
    margin,
    footprint,
    {
      wellIndex,
      extension: options.runOutMargin,
      fallbackAngle: options.fallbackAngle,
      headArm,
      tdPlan: inputs.tdPlan,
      tdArm: span.tdArm,
      bearingWell: inputs.bearing,
      rodStiffness: options.rodStiffness,
    },
  );
  timings.arms = now() - mark;

  mark = now();
  const probeAt = clearance + cellSize * 4;
  const buildSide = (sideCurve: FenceSideCurve): FenceSide => {
    const seed = removedSideSeed(
      base.points,
      sideCurve.points,
      sideCurve.side,
      probeAt,
      headArm?.degenerate ? [-headArm.dir[0], -headArm.dir[1]] : undefined,
    );
    const field = createFenceField(sideCurve.points, {
      bounds,
      cellSize,
      seed,
    });
    if (!field) {
      throw new Error(
        `fence: no field could be rasterised for side ${sideCurve.side}`,
      );
    }
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
  // ⭐⭐ BOTH SIDES OR NEITHER. The two cuts share their run-out arms, so a side cannot
  // succeed on its own — `buildFenceCut` has already thrown if either is unbuildable, and
  // what is left here is the field stage, which either works for both or is a bug.
  //
  // ⭐⭐ ONE CURVE FROM HERE ON. The field, the segment index and the drawn cut face are all
  // built from THIS polyline, so the boundary the shader tests and the face that is swept are
  // the same object rather than two thinnings of a third curve.
  // ⭐ Thinned BY DEVIATION, never by spacing — a spacing thin drops the midpoints `holdChords`
  // inserts to hold the margin on the chords, which is what once buried the well by 13–27 mm.
  // The construction leaves ~75% of its vertices within 0.1 mm of collinear (chord-hold
  // midpoints on straight runs, fillet chains, resampling); carrying them costs the segment
  // index dearly — MEASURED over the field, cell lists of up to 191 against a cap of 48, and
  // 187k points per margin-0.5 sweep against 15k once thinned.
  // ⚠️ PER PIECE, so every seam stays a vertex and the ranges a defect is attributed with
  // survive. Refining the index instead does NOT work: `BAND_CELLS` 4→16 moves the worst list
  // only 132→92 while costing 5→42 MB a side, because the cut folds back on itself at the head
  // and those segments are genuinely equidistant.
  const thin = Math.min(tolerance, margin * THIN_MARGIN_FRACTION);
  const sideCurve = (side: FenceSideName): FenceSideCurve => {
    const raw = arms[side];
    const points: Vec2[] = [];
    const pieces: CurvePiece[] = [];
    for (const piece of arms.pieces[side]) {
      const part = simplifyPolyline(
        raw.slice(piece.start, piece.end + 1),
        thin,
      );
      // Pieces share their boundary vertex, so all but the first contribute from index 1.
      const start = points.length > 0 ? points.length - 1 : 0;
      for (let i = points.length > 0 ? 1 : 0; i < part.length; i++) {
        points.push(part[i]);
      }
      pieces.push({ kind: piece.kind, start, end: points.length - 1 });
    }
    // Re-measured, not carried over: thinning can only steepen a corner, so the reported turn
    // has to describe the curve that actually ships.
    return { side, points, pieces, worstTurn: polylineWorstTurn(points) };
  };
  const left = buildSide(sideCurve('left'));
  const right = buildSide(sideCurve('right'));
  timings.field = now() - mark;

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
  const traceSharp = polylineSharpEdges(
    base.points,
    CONSTRUCT_SHARP_TURN,
    CONSTRUCT_SHARP_ARM,
  );
  const sideReport = (s: FenceSide, burial: FenceBurial): FenceSideReport => ({
    side: s.side,
    vertices: s.curve.points.length,
    worstTurn: degrees(s.curve.worstTurn.turn),
    removedShare: s.removedShare,
    burial: burial.worst,
    field: {
      nx: s.field.nx,
      ny: s.field.ny,
      cell: s.field.cell,
      separated: s.field.separated,
    },
    index: {
      cells: s.index.cellsWidth * s.index.cellsHeight,
      entries: s.index.width * s.index.height,
      maxCount: s.index.maxCount,
      truncated: s.index.truncated,
      flips: s.index.flips,
      reach: s.index.band,
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
      obstacles,
    },
    arms: {
      td: arms.td,
      head: arms.head,
    },
    block: span,
    verticalRange: options.verticalRange && [
      Math.min(...options.verticalRange),
      Math.max(...options.verticalRange),
    ],
    coreReach: inputs.reach,
    sides: {
      left: sideReport(left, burialOf(left)),
      right: sideReport(right, burialOf(right)),
    },
    timings,
  };

  return { base, left, right, report };
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

/**
 * A flagged region of a finished side-curve, for the debug overlay.
 *
 * ⭐ `burial` points are on the WELL (the stretch left in the kept block); the turn
 * kinds are the three core vertices around the offending corner.
 *
 * @group Geometries
 */
export type FenceDefect = {
  kind: 'burial' | 'sharp' | 'obstacle';
  points: Vec2[];
};

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
  for (const [name, side] of [
    ['left', report.sides.left],
    ['right', report.sides.right],
  ] as const) {
    if (!side.field.separated) {
      problems.push(`${name}: the curve does not separate the field`);
    }
    if (side.index.flips > 0) {
      problems.push(
        `${name}: ${side.index.flips} overflowed index cells read the wrong side (lists capped at ${side.index.maxCount} segments)`,
      );
    }
    if (side.removedShare < SHARE_FLOOR) {
      problems.push(
        `${name}: removes only ${(side.removedShare * 100).toFixed(0)}% of the block`,
      );
    }
    // ⭐⭐ The trajectory must end up in the half that goes, or whatever is drawn in the hole
    // is buried by the block meant to reveal it. The cut builder's own gates cannot see this
    // — they compare the cut with the well, this asks the finished FIELD.
    if (side.burial > BURIAL_LIMIT) {
      problems.push(
        `${name}: buries the well ${side.burial.toFixed(0)} m into the kept block`,
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
