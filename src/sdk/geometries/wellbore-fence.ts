import { Vec2 } from '../types/common';
import {
  countPolylineLoops,
  dedupePolyline2D,
  endTangent2D,
  junctionOpening,
  leftNormal2D,
  nearestOnPolyline,
  polylineArcLengths,
  polylineBounds2D,
  polylineLength,
  polylineMaxTurn,
  polylineMinRadius,
  polylineNormals2D,
  polylineRadiusProfile,
  principalDirection2D,
  relaxPolyline2DClearOf,
  relaxPolyline2DWithin,
  RelaxResult,
  removePolylineLoops,
  repairPolylineWaists,
  resamplePolyline2D,
  spreadAlongPolyline,
} from '../utils/polyline-2d';
import { distanceVec2 } from '../utils/vector-operations';
import { Curve3D } from './curve/curve-3d';
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

/** Corridor half width where the well is vertical, in metres. */
const TOLERANCE_VERTICAL = 150;

/** Corridor half width where the well is deviated, in metres. */
const TOLERANCE_DEVIATED = 5;

/** Turning radius the SHALLOW section is straightened to, in metres. */
const MIN_HEAD_RADIUS = 250;

/** Plan spacing the base curve is resampled to before offsetting, in metres. */
const BASE_SPACING = 25;

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

/** Opening a junction must keep on each side, in radians. */
const MIN_OPENING = (60 * Math.PI) / 180;

/** Arc length a junction angle and an end tangent are measured over, in metres. */
const JUNCTION_ARC = 150;

/** Arc length a junction blend is spread over, in metres. */
const BLEND_LENGTH = 600;

/** Below this turning radius the cut is opened out to round the corner, in metres. */
const HAIRPIN_RADIUS = 200;

/** Cap on the clearance the curve opens for itself, in metres. */
const MAX_LOCAL_CLEARANCE = 250;

/**
 * Slack on the opening the well's own displacement asks for.
 *
 * ⚠️ Opening by EXACTLY the displacement leaves the well on the boundary, where a
 * cell of raster either way decides whether it shows.
 */
const DEVIATION_SAFETY = 1.25;

/** Distance a run-out takes to converge onto the ray both sides share, in metres. */
const RUN_OUT_BLEND = 500;

/** Cap on the steps a run-out's turn may take, so it always terminates. */
const RUN_OUT_MAX_STEPS = 256;

/**
 * How far the cut may turn within {@link DEFAULT_TURN_WINDOW}, in radians, at TD.
 *
 * ⭐⭐ A WINDOW, not an angle between neighbours. A curve turning a few degrees per
 * 25 m step for twenty steps passes every per-vertex test and is a near loop — which
 * is the shape that tears the swept face, and whose right repair is a straight line
 * through it. ⚠️ Must stay well under a right angle: at 90° the two faces of the turn
 * are looking at each other.
 */
const DEFAULT_MAX_TURN = (60 * Math.PI) / 180;

/**
 * The same budget at the WELLHEAD, in radians.
 *
 * ⭐⭐ Deliberately tighter than at TD, which is the same asymmetry `fenceTolerance`
 * gives the corridor. Near TD the trajectory genuinely bends and the cut has to hug
 * it, so it must be allowed to turn; at the head there is nothing to follow but
 * survey scatter, and every degree spent there buys a fold.
 */
const DEFAULT_HEAD_TURN = (25 * Math.PI) / 180;

/** Arc length the turn budget is accumulated over, in metres. */
const DEFAULT_TURN_WINDOW = 300;

/** Arc length a local clearance is spread over, in metres. */
const CLEARANCE_SPREAD = 150;

/**
 * How close the cut may come back to itself before the excursion is repaired.
 *
 * ⚠️ Below this the block between the two passes is a blade thinner than the raster
 * that removes it can resolve, so it tears rather than reading as rock.
 */
const WAIST_CLEARANCE = 120;

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

/**
 * How far the fence may leave the trajectory at each sample, in metres.
 *
 * ⭐⭐ Derived from how VERTICAL the well is, not configured. Where the hole barely
 * moves in plan per metre drilled there is nothing to follow, and the corridor
 * opens to tens of metres; through a deviated section it closes to a few, so the
 * fence hugs the part worth seeing. This is the whole of the "more head room
 * between the wellhead and the kickoff" rule, expressed once.
 *
 * @group Geometries
 */
export function fenceTolerance(samples: FenceSamples): Float64Array {
  const speed = smoothPlanSpeed(samples, KICKOFF_WINDOW);
  const out = new Float64Array(speed.length);
  const lo = KICKOFF_SPEED * 0.7;
  const hi = KICKOFF_SPEED * 2.5;
  for (let i = 0; i < speed.length; i++) {
    const t = Math.min(1, Math.max(0, (speed[i] - lo) / (hi - lo)));
    const eased = t * t * (3 - 2 * t);
    out[i] =
      TOLERANCE_VERTICAL + (TOLERANCE_DEVIATED - TOLERANCE_VERTICAL) * eased;
  }
  return out;
}

/** The straightened plan curve a fence is built around. */
export type FenceBase = {
  /** scene XZ, resampled at a uniform plan spacing */
  points: Vec2[];
  /** first sample kept — everything shallower was dropped */
  from: number;
  /** metres of MD dropped off the head */
  trimmedLength: number;
  kickoff: FenceKickoff;
  relax: RelaxResult;
  /** corridor the relaxation ran inside, per sample */
  tolerance: Float64Array;
  /** turning radius reached over the whole curve, in metres */
  minRadius: number;
  /**
   * Where the WELL sits relative to the curve at each vertex, signed along the left
   * normal: positive means the well is to the left of the fence.
   *
   * ⭐⭐ SIGNED, because the problem is. The smoothing leaves the well on ONE side at
   * any given point, so only the side whose KEPT half contains it has to open up —
   * the other side already has it in the open and opening there just pushes the cut
   * away from the well for nothing. Treating this as a magnitude over-compensates
   * one side and under-compensates the other.
   */
  deviation: Float64Array;
  /**
   * Signed curvature per vertex, in 1/metres: positive where the curve turns left.
   *
   * ⚠️⚠️ What bounds an opening. Offsetting into the CONCAVE side by more than the
   * local radius turns the curve inside out — on a short, tightly curved head that
   * folds it into a hook, which reads as a razor apex at the wellhead.
   */
  curvature: Float64Array;
  /**
   * Metres to open by to round a corner too tight to follow, SIGNED: positive means
   * the sharp wedge is on the left.
   *
   * ⭐⭐ Signed for the same reason {@link FenceBase.deviation} is. A corner turning
   * left leaves a sharp wedge on the left and a reflex one on the right, so only the
   * side that KEEPS the sharp wedge has a blade to carve away — the side that removes
   * it is already smooth. Opening both is what makes the two curves differ everywhere
   * instead of only where there is a problem.
   */
  roundness: Float64Array;
  /**
   * Turning radius reached over the part ABOVE the kickoff, in metres.
   *
   * ⭐⭐ THE number that decides whether the head is usable. A tight bend down in the
   * reservoir is the well and must be followed; a tight bend up in the vertical
   * section is survey scatter and must not be. Judging the whole curve by one radius
   * conflates them, and then either the reservoir gets smoothed away or every well
   * reads as broken.
   */
  headRadius: number;
  /** what `headRadius` had to reach */
  requiredHeadRadius: number;
  /** a well with no plan direction of its own; the curve came from its spread */
  degenerate: boolean;
};

/** Diagonal of a plan curve's bounding box. */
function planExtent(points: Vec2[]): number {
  const [minX, minZ, maxX, maxZ] = polylineBounds2D(points);
  return Math.hypot(maxX - minX, maxZ - minZ);
}

/** {@link fenceBaseCurve} options. */
export type FenceBaseOptions = {
  /** turning radius the shallow section must reach, in metres. Default 250. */
  headRadius?: number;
  /** plan spacing of the result, in metres. Default 25. */
  spacing?: number;
};

/**
 * The fence's own curve through the well: the plan trace, straightened as much as
 * its tolerance corridor allows, with the head given up where that is not enough.
 *
 * ⭐⭐ Smoothing FIRST, trimming only on failure. A wide corridor usually turns the
 * shallow scatter into a clean arc, and keeping it means the fence still follows
 * the well right up to the wellhead. Only where the scatter is too violent for the
 * corridor to absorb is the head handed to the run-out — which is a smooth
 * continuation by construction, so nothing is lost but a section nobody looks at.
 *
 * ⚠️ `minRadius` is not a style choice. Offsetting a curve by `m` folds wherever it
 * turns tighter than `m`, so the clearance a caller asks for sets its own
 * smoothness requirement — see {@link buildFenceSideCurve}.
 *
 * @group Geometries
 */
export function fenceBaseCurve(
  samples: FenceSamples,
  options: FenceBaseOptions = {},
): FenceBase {
  const headRadius = options.headRadius ?? MIN_HEAD_RADIUS;
  const spacing = options.spacing ?? BASE_SPACING;
  const tolerance = fenceTolerance(samples);
  const kickoff = fenceKickoff(samples);

  const attempt = (from: number) => {
    const relax = relaxPolyline2DWithin(
      samples.plan.slice(from),
      tolerance.slice(from),
      { minRadius: headRadius, window: headRadius },
    );
    // Only the part above the kickoff is judged: below it a tight bend is the well.
    const arc = polylineArcLengths(relax.points);
    const shallow = kickoff.index - from;
    const until = shallow > 1 ? arc[Math.min(shallow, arc.length - 1)] : 0;
    return {
      relax,
      head:
        until > 0
          ? polylineMinRadius(relax.points, headRadius, 0, until)
          : Infinity,
    };
  };

  let from = 0;
  let tried = attempt(0);
  if (tried.head < headRadius && kickoff.index > 0) {
    // Give the head up in steps rather than all at once, so a well that only needs
    // its top few hundred metres dropped keeps the rest of it.
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const candidate = Math.round((kickoff.index * s) / steps);
      if (candidate <= from) continue;
      from = candidate;
      tried = attempt(candidate);
      if (tried.head >= headRadius) break;
    }
  }
  const relax = tried.relax;

  let points = dedupePolyline2D(relax.points, 1);
  let degenerate = false;
  if (planExtent(points) < MIN_PLAN_EXTENT) {
    // No plan direction of its own. The spread's principal axis is the only
    // non-arbitrary answer, and the run-outs carry the rest of the cut.
    const direction = principalDirection2D(points);
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
  points = resamplePolyline2D(points, spacing);

  // ⭐ Where the well actually ended up relative to the smoothed curve. Signed, so
  // each side can open by exactly what IT needs — see FenceBase.deviation.
  const trace = samples.plan.slice(from);
  const hit: { point: Vec2; distance: number; along: number } = {
    point: [0, 0],
    distance: 0,
    along: 0,
  };
  const normals = polylineNormals2D(points);
  const deviation = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const near = nearestOnPolyline(trace, points[i][0], points[i][1], hit);
    if (!near) continue;
    deviation[i] =
      (near.point[0] - points[i][0]) * normals[i][0] +
      (near.point[1] - points[i][1]) * normals[i][1];
  }

  const radius = polylineRadiusProfile(points, HAIRPIN_RADIUS);
  const curvature = new Float64Array(points.length);
  const wanted = new Float64Array(points.length);
  for (let i = 1; i + 1 < points.length; i++) {
    if (!Number.isFinite(radius[i]) || radius[i] <= 0) continue;
    // Which way the corner turns decides which side is left holding the blade.
    const ax = points[i][0] - points[i - 1][0];
    const az = points[i][1] - points[i - 1][1];
    const bx = points[i + 1][0] - points[i][0];
    const bz = points[i + 1][1] - points[i][1];
    const left = ax * bz - az * bx >= 0;
    curvature[i] = (left ? 1 : -1) / radius[i];
    const magnitude = Math.min(
      MAX_LOCAL_CLEARANCE,
      Math.max(0, HAIRPIN_RADIUS - radius[i]),
    );
    if (magnitude > 0) wanted[i] = left ? magnitude : -magnitude;
  }

  return {
    points,
    from,
    trimmedLength: from > 0 ? samples.md[from] - samples.md[0] : 0,
    kickoff,
    relax,
    tolerance,
    minRadius: polylineMinRadius(points, headRadius),
    deviation,
    curvature,
    roundness: wanted,
    headRadius: tried.head,
    requiredHeadRadius: headRadius,
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

  const candidates: FenceCandidate[] = [];
  let best: FenceExtensions | null = null;
  let scored = 0;
  for (const s of starts) {
    const sReach = reach(first, s);
    const sTip: Vec2 = [first[0] + s[0] * sReach, first[1] + s[1] * sReach];
    for (const e of ends) {
      const eReach = reach(last, e);
      const curve = removePolylineLoops([
        sTip,
        ...base,
        [last[0] + e[0] * eReach, last[1] + e[1] * eReach] as Vec2,
      ]);
      scored++;
      const [smaller] = splitShares(curve, options.outline);
      const startClearance = clearanceOf(s, startBearings);
      const endClearance = clearanceOf(e, endBearings);
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
        scored: 0,
        candidates: [],
        mode: options.mode ?? 'straight',
      };
      const better =
        !best ||
        candidate.evenness > best.evenness + 1e-4 ||
        (Math.abs(candidate.evenness - best.evenness) <= 1e-4 &&
          candidate.startClearance + candidate.endClearance >
            best.startClearance + best.endClearance);
      if (better) best = candidate;
    }
  }

  const result: FenceExtensions = best ?? {
    start: startTangent,
    end: endTangent,
    startClearance: clearanceOf(startTangent, startBearings),
    endClearance: clearanceOf(endTangent, endBearings),
    startTurn: 0,
    endTurn: 0,
    evenness: 0,
    scored: 0,
    candidates: [],
    mode: options.mode ?? 'straight',
  };
  result.scored = scored;
  result.candidates = candidates.sort((a, b) => b.evenness - a.evenness);
  return result;
}

/** One side's finished curve, ready to be rasterised and swept. */
export type FenceSideCurve = {
  /** 1 removes the half the left normal points into, -1 the other */
  side: 1 | -1;
  /** scene XZ: run-out, the offset trace, run-out */
  points: Vec2[];
  /** opening at the start and end junction ON THIS SIDE, in radians */
  opening: [number, number];
  /** whether a junction had to be blended open for this side */
  blended: boolean;
  /** loops the repair had to remove */
  loopsRemoved: number;
  /** near loops the turn budget had to cut straight through */
  chorded: number;
  /** largest turn within the budget window, in radians */
  maxTurn: number;
  /** waists this side had to route around */
  waistRemoved: number;
};

/** {@link buildFenceSideCurve} options. */
export type FenceSideOptions = {
  rings: Vec2[][];
  bounds: [number, number, number, number];
  /** metres of clearance kept between the trajectory and the cut. Default 0. */
  margin?: number;
  /** metres to clear the footprint by. Default 500. */
  runOutMargin?: number;
  /** opening each junction must keep on this side, in radians. Default 60°. */
  minOpening?: number;
  /** how close the curve may come back to itself, in metres. */
  waist?: number;
  /** how far the cut may turn within `turnWindow` at TD, in radians. Default 60°. */
  maxTurn?: number;
  /** the same budget at the wellhead, in radians. Default 25°. */
  headTurn?: number;
  /** arc length the turn budget is accumulated over, in metres. Default 300. */
  turnWindow?: number;
  /** signed offset of the well from the curve per vertex — {@link FenceBase.deviation} */
  deviation?: ArrayLike<number>;
  /** signed corner rounding per vertex — {@link FenceBase.roundness} */
  roundness?: ArrayLike<number>;
  /** the well's own plan trace, which the cut is kept clear of */
  well?: Vec2[];
};

/** The opening a junction leaves on one side of a curve. */
function junctionOpeningOf(
  points: Vec2[],
  arm: Vec2,
  fromStart: boolean,
  side: 1 | -1,
): number {
  const leave = endTangent2D(points, fromStart, JUNCTION_ARC);
  if (!leave) return Math.PI;
  // Arriving along the run-out means arriving along its reverse.
  return junctionOpening([-arm[0], -arm[1]], leave, side);
}

/**
 * Pull the end of a curve toward a straight continuation of its run-out, so the
 * junction opens up on the side that needs it.
 *
 * ⚠️ Weighted to nothing at `length`, so the deviation is bounded and the deep part
 * of the curve — the part worth following — is untouched.
 */
function blendJunction(
  points: Vec2[],
  arm: Vec2,
  fromStart: boolean,
  length: number,
): Vec2[] {
  const n = points.length;
  const out = points.map(p => [p[0], p[1]] as Vec2);
  if (n < 3 || !(length > 0)) return out;
  const apex = points[fromStart ? 0 : n - 1];
  // Widest opening comes from leaving straight back along the run-out.
  const target: Vec2 = [-arm[0], -arm[1]];
  let arc = 0;
  for (let k = 1; k < n; k++) {
    const i = fromStart ? k : n - 1 - k;
    const previous = fromStart ? points[i - 1] : points[i + 1];
    arc += distanceVec2(previous, points[i]);
    if (arc >= length) break;
    const t = arc / length;
    const weight = (1 - t) * (1 - t);
    const wantX = apex[0] + target[0] * arc;
    const wantZ = apex[1] + target[1] * arc;
    out[i] = [
      points[i][0] + (wantX - points[i][0]) * weight,
      points[i][1] + (wantZ - points[i][1]) * weight,
    ];
  }
  return out;
}

/**
 * One side's curve: the base trace moved clear of the well, with a run-out at each
 * end, repaired for THIS side.
 *
 * ⭐⭐ The clearance is baked in HERE rather than applied as a threshold later. The
 * field is then a plain signed distance to this curve and the cut is its zero set,
 * so the face that gets drawn and the block that gets removed are the same object.
 * That is what removes the need for a contour, a root-find, and a pair of sampling
 * functions pinned together by a test.
 *
 * ⭐ The two sides offset in OPPOSITE directions, which is why they need separate
 * curves at all: whichever bend is convex for one is concave for the other, and it
 * is the concave one that folds. The repairs are therefore per side by nature, not
 * by choice — but they are the only thing that differs, so the two remain flip
 * sides of one cut.
 *
 * @group Geometries
 */
export function buildFenceSideCurve(
  base: Vec2[],
  extensions: FenceExtensions,
  side: 1 | -1,
  options: FenceSideOptions,
): FenceSideCurve {
  const margin = options.margin ?? 0;
  const runOutMargin = options.runOutMargin ?? DEFAULT_RUN_OUT_MARGIN;
  const minOpening = options.minOpening ?? MIN_OPENING;
  const maxTurn = options.maxTurn ?? DEFAULT_MAX_TURN;
  const headTurn = options.headTurn ?? DEFAULT_HEAD_TURN;
  const turnWindow = options.turnWindow ?? DEFAULT_TURN_WINDOW;
  const rings = [...options.rings, boundsRing(options.bounds)];

  // The face must sit clear of the well on the half being KEPT, so that the well and
  // the room around it both end up in the half being removed.
  // ⭐ Only what THIS side needs: where the well already lies in the half this side
  // removes, the deviation is the wrong sign and asks for nothing.
  const need = new Float64Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const at = (a: ArrayLike<number> | undefined) =>
      a ? a[Math.min(i, a.length - 1)] : 0;
    const buried =
      Math.max(0, -side * at(options.deviation)) * DEVIATION_SAFETY;
    // Only the side left HOLDING the sharp wedge has anything to carve away.
    const blade = Math.max(0, -side * at(options.roundness));
    need[i] = Math.max(margin, buried, blade);
  }
  // ⚠️ Spread to soften the opening, but never BELOW what a vertex asked for — a blur
  // that dips at the peak is exactly where the well would still be buried.
  const spread = spreadAlongPolyline(base, need, CLEARANCE_SPREAD);
  const opening = new Float64Array(base.length);
  let widest = 0;
  for (let i = 0; i < base.length; i++) {
    opening[i] = Math.max(need[i], spread[i]);
    widest = Math.max(widest, opening[i]);
  }
  // ⭐⭐ RELAXED against the well, not offset from the curve. An offset at a tight bend
  // either folds — leaving a corner where the fold is spliced out — or has to be
  // clamped short of the clearance the well needs. Smoothing with a push back out
  // gives both: smooth, and provably clear.
  let trace =
    widest > 0
      ? relaxPolyline2DClearOf(base, options.well ?? base, opening, side)
      : base.map(p => [p[0], p[1]] as Vec2);

  let blended = false;
  for (let pass = 0; pass < 2; pass++) {
    const openStart = junctionOpeningOf(trace, extensions.start, true, side);
    const openEnd = junctionOpeningOf(trace, extensions.end, false, side);
    if (openStart >= minOpening && openEnd >= minOpening) break;
    const length = BLEND_LENGTH * (pass + 1);
    if (openStart < minOpening) {
      trace = blendJunction(trace, extensions.start, true, length);
      blended = true;
    }
    if (openEnd < minOpening) {
      trace = blendJunction(trace, extensions.end, false, length);
      blended = true;
    }
  }

  // ⭐⭐ A run-out leaves this side's own endpoint heading the way the TRACE heads,
  // and turns onto the ray both sides share. Linear segments, with the turn spread
  // over as many of them as the angle budget needs — the output has to be a polyline
  // either way, and building it as one is what keeps every angle under control.
  //
  // ⚠️⚠️ It steers at the KNEE, not at the far tip. Aiming both sides at the same tip
  // is not enough: they start from different points and reach it along different
  // paths, so the wedge between them is removed by NEITHER half — measured as the two
  // removed shares summing to 0.92 instead of 1. Converging onto the ray at a fixed
  // distance makes the two arms one line from there out, which is the majority of a
  // run-out that is kilometres long.
  const arm = (
    from: Vec2,
    tangent: Vec2,
    direction: Vec2,
    apex: Vec2,
    reach: number,
    stepTurn: number,
  ): Vec2[] => {
    const converge = Math.min(RUN_OUT_BLEND, reach);
    const knee: Vec2 = [
      apex[0] + direction[0] * converge,
      apex[1] + direction[1] * converge,
    ];
    const out: Vec2[] = [[from[0], from[1]]];
    let heading = Math.atan2(tangent[1], tangent[0]);
    let x = from[0];
    let z = from[1];
    for (let k = 0; k < RUN_OUT_MAX_STEPS; k++) {
      const remaining = Math.hypot(knee[0] - x, knee[1] - z);
      if (remaining <= BASE_SPACING) break;
      let delta = Math.atan2(knee[1] - z, knee[0] - x) - heading;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      // Pointing at the knee and free to turn no further: the rest is a straight run.
      if (Math.abs(delta) <= 1e-9) break;
      heading += Math.max(-stepTurn, Math.min(stepTurn, delta));
      x += Math.cos(heading) * BASE_SPACING;
      z += Math.sin(heading) * BASE_SPACING;
      out.push([x, z]);
    }
    out.push(knee);
    if (reach > converge) {
      out.push([apex[0] + direction[0] * reach, apex[1] + direction[1] * reach]);
    }
    return out;
  };

  const startReach =
    escapeDistance(base[0], extensions.start, rings) + runOutMargin;
  const endReach =
    escapeDistance(base[base.length - 1], extensions.end, rings) + runOutMargin;
  // The direction the trace LEAVES each junction in. `endTangent2D` points from the
  // end into the curve, so the outward heading is its reverse.
  const leaving = (fromStart: boolean): Vec2 => {
    const into = endTangent2D(trace, fromStart, JUNCTION_ARC);
    if (into) return [-into[0], -into[1]];
    return fromStart ? extensions.start : extensions.end;
  };
  // Derived, not a second knob: an arm stepping at `BASE_SPACING` must not be able
  // to use up the whole windowed budget on its own.
  // ⭐ Tighter at the head than at TD. Near TD the trajectory genuinely bends and the
  // run-out has to leave along it; at the head there is nothing but survey scatter,
  // and every degree of turn spent there buys a fold.
  const stepTurnFor = (budget: number) => (budget * BASE_SPACING) / turnWindow;
  const startArm = arm(
    trace[0],
    leaving(true),
    extensions.start,
    base[0],
    startReach,
    stepTurnFor(headTurn),
  );
  const endArm = arm(
    trace[trace.length - 1],
    leaving(false),
    extensions.end,
    base[base.length - 1],
    endReach,
    stepTurnFor(maxTurn),
  );
  const raw: Vec2[] = [
    // ⚠️ The junction point belongs to the trace, and both arms start there.
    ...startArm.reverse().slice(0, -1),
    ...trace,
    ...endArm.slice(1),
  ];
  // ⚠️⚠️ The turn budget is MEASURED here, not enforced. Chording every stretch that
  // turned more than the budget was tried and reverted: accumulated angle cannot tell
  // a near loop from a real bend — a 180° turn at 400 m radius is a reservoir dogleg
  // the cut has to follow, and cutting through one abandoned the well (F-12 +1 went
  // from 0 to 310 m buried). The shape that needs a chord is one that comes back near
  // ITSELF, which is a distance test — `repairPolylineWaists`, below.
  const chorded = 0;
  const loopsRemoved = countPolylineLoops(raw);
  // ⭐⭐ Loops, then waists PER SIDE. A hairpin's pocket lies wholly on one side: the
  // side that removes it has nothing thin to fix, and repairing there would only
  // bury the well running through it.
  const deLooped = removePolylineLoops(raw);
  const waist = repairPolylineWaists(
    deLooped,
    options.waist ?? WAIST_CLEARANCE,
    side,
  );

  return {
    side,
    // ⚠️ Deduped: relaxation and waist repair can leave vertices bunched, and a
    // cluster of them in one index cell overflows its list.
    points: dedupePolyline2D(waist.points, 2),
    waistRemoved: waist.repaired,
    chorded,
    maxTurn: polylineMaxTurn(dedupePolyline2D(waist.points, 2), turnWindow),
    opening: [
      junctionOpeningOf(trace, extensions.start, true, side),
      junctionOpeningOf(trace, extensions.end, false, side),
    ],
    blended,
    loopsRemoved,
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
  /** junction openings in DEGREES */
  opening: [number, number];
  blended: boolean;
  loopsRemoved: number;
  /** excursions the waist repair had to route around on this side */
  waistRemoved: number;
  /** near loops the turn budget had to cut straight through */
  chorded: number;
  /** largest turn within the budget window, in DEGREES */
  maxTurn: number;
  /** loops LEFT after the repair — must be 0 */
  loops: number;
  removedShare: number;
  minRadius: number;
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
  relax: {
    toleranceMin: number;
    toleranceMax: number;
    iterations: number;
    /** reached a fixed point of smooth-then-clamp */
    settled: boolean;
    /** turning radius over the WHOLE curve, in metres — a diagnostic, not a target */
    minRadius: number;
    /** turning radius over the shallow section, in metres */
    headRadius: number;
    /** what `headRadius` had to reach */
    requiredHeadRadius: number;
    maxDeviation: number;
  };
  head: { trimmedLength: number; from: number; degenerate: boolean };
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
  /** the straightened trace both sides are built from, without run-outs */
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
  /** how far the cut may turn within `turnWindow` at TD, in radians. Default 60°. */
  maxTurn?: number;
  /** the same budget at the wellhead, in radians. Default 25°. */
  headTurn?: number;
  /** arc length the turn budget is accumulated over, in metres. Default 300. */
  turnWindow?: number;
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
  // Offsetting by `margin` folds wherever the curve turns tighter than it, so the
  // clearance a caller asks for sets its own smoothness requirement.
  const headRadius = Math.max(MIN_HEAD_RADIUS, margin * 2);

  mark = now();
  const base = fenceBaseCurve(samples, { headRadius });
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
    mode: options.extension,
  });
  timings.extensions = now() - mark;

  const cellSize = options.cellSize ?? fenceCellSize(bounds);
  const sideOptions: FenceSideOptions = {
    rings: options.rings,
    bounds,
    margin,
    runOutMargin: options.runOutMargin,
    maxTurn: options.maxTurn,
    headTurn: options.headTurn,
    turnWindow: options.turnWindow,
    deviation: base.deviation,
    // The cut is kept clear of the WELL, not of the smoothed curve standing in for it.
    well: samples.plan.slice(base.from),
    roundness: base.roundness,
  };

  mark = now();
  const plusCurve = buildFenceSideCurve(
    base.points,
    extensions,
    1,
    sideOptions,
  );
  const minusCurve = buildFenceSideCurve(
    base.points,
    extensions,
    -1,
    sideOptions,
  );
  timings.curves = now() - mark;

  mark = now();
  const probeAt = margin + cellSize * 4;
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

  const degrees = (r: number) => (r * 180) / Math.PI;
  const sideReport = (s: FenceSide): FenceSideReport => ({
    side: s.side,
    vertices: s.curve.points.length,
    opening: [degrees(s.curve.opening[0]), degrees(s.curve.opening[1])],
    blended: s.curve.blended,
    loopsRemoved: s.curve.loopsRemoved,
    waistRemoved: s.curve.waistRemoved,
    chorded: s.curve.chorded,
    maxTurn: degrees(s.curve.maxTurn),
    loops: countPolylineLoops(s.curve.points),
    removedShare: s.removedShare,
    minRadius: polylineMinRadius(s.curve.points, headRadius),
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

  let toleranceMin = Infinity;
  let toleranceMax = -Infinity;
  for (const t of base.tolerance) {
    if (t < toleranceMin) toleranceMin = t;
    if (t > toleranceMax) toleranceMax = t;
  }

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
    relax: {
      toleranceMin,
      toleranceMax,
      iterations: base.relax.iterations,
      settled: base.relax.settled,
      minRadius: base.minRadius,
      headRadius: base.headRadius,
      requiredHeadRadius: base.requiredHeadRadius,
      maxDeviation: base.relax.maxDeviation,
    },
    head: {
      trimmedLength: base.trimmedLength,
      from: base.from,
      degenerate: base.degenerate,
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
    sides: { plus: sideReport(plus), minus: sideReport(minus) },
    // ⚠️ Compared rather than inferred: the per-vertex clearance means the sides can
    // diverge without any of the discrete repairs having fired, so a flag assembled
    // from those alone claims they agree when the debug view plainly shows they do
    // not.
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
  if (report.relax.headRadius < report.relax.requiredHeadRadius) {
    problems.push(
      `shallow section still turns at ${report.relax.headRadius.toFixed(0)} m, wanted ${report.relax.requiredHeadRadius.toFixed(0)} m`,
    );
  }
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
    const opening = Math.min(side.opening[0], side.opening[1]);
    if (opening < 30) {
      problems.push(`${name}: junction opens only ${opening.toFixed(0)}°`);
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
