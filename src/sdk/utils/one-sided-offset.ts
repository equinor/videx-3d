import { Vec2 } from '../types/common';
import {
  convexSignedDistance,
  hullsWithin,
  marginCrossings,
  segmentConvexNearest,
} from './margin-zone';
import {
  convexHull2D,
  countPolylineLoops,
  createPolylineIndex,
  dedupePolyline2D,
  distanceToSegment2D,
  holdPolylineChords2D,
  indexedClearance,
  indexedCrossings,
  leftNormal2D,
  nearestOnIndexedPolyline,
  nearestOnPolyline,
  pointAtArcLength,
  polylineArcLengths,
  PolylineIndex,
  polylineMaxTurn,
  polylineMinRadius,
  polylineSharpEdges,
  PolylineTurn,
  polylineWorstTurn,
  removePolylineLoops,
} from './polyline-2d';
import { seedStiffRod, StiffRodAnchor, StiffRodTurn } from './stiff-rod';
import { settleRodConstrained } from './stiff-rod-constrained';

/**
 * Which side of a wellbore a cut curve lies on, read against the HEAD→TD tangent.
 *
 * ⭐ `'left'` means the curve appears on the LEFT of the direction the well is drilled
 * (head → terminal depth), as seen in a PLAN VIEW FROM ABOVE. One vocabulary, everywhere:
 * never `1 | -1`, never `onePlus` / `oneMinus` — see {@link sideNormalSign} for the one
 * place a side is turned back into a sign.
 */
export type FenceSideName = 'left' | 'right';

/**
 * The {@link leftNormal2D} multiplier for a side, walking HEAD→TD. THE ONE PLACE the
 * side↔sign convention is written down.
 *
 * ⚠️⚠️ `'left'` maps to **−1**, which looks wrong until you place the viewer. `leftNormal2D`
 * is the quarter turn in +XZ, and a plan view looks DOWN the Y axis (+X to the right, +Z
 * DOWN the screen), so that normal comes out on the visual RIGHT. Deriving the hand from the
 * name instead of from this helper is how the prototype ended up mirrored.
 */
export const sideNormalSign = (side: FenceSideName): 1 | -1 =>
  side === 'left' ? -1 : 1;

/** {@link OneSidedOffsetOptions.tolerance}'s default, in metres. */
export const DEFAULT_OFFSET_TOLERANCE = 0.01;

/** {@link oneSidedOffset} options. */
export type OneSidedOffsetOptions = {
  /** the well's segment index, reused when the caller already has one (the well never changes) */
  wellIndex?: PolylineIndex;
  /**
   * render/verification slack in metres — the amount a curve may sit inside `margin` before it
   * counts as buried, and the target chord error for arc tessellation. Default
   * {@link DEFAULT_OFFSET_TOLERANCE}.
   */
  tolerance?: number;
  /**
   * how far a corner vertex may stand out from the clearance circle, as a multiple of the
   * radius, before the corner is split into more straight segments. Default 2.
   *
   * ⭐ Corners are MITERED, never arced — see {@link cornerChain}. Raising this makes spikier,
   * sparser corners; lowering it makes blunter, denser ones. It never relaxes clearance.
   */
  miterLimit?: number;
  /** sharp-edge test angle (rad) for the reported metric only. Default 30°. */
  sharpTurn?: number;
  /** sharp-edge test arm (m) for the reported metric only. Default 10. */
  sharpArm?: number;
  /**
   * the sharpest RELATIVE turn any single vertex of the finished curve may make, in radians.
   * Default 45° — the same limit the run-out arms gate on, so a core that passes here cannot be
   * rejected downstream. Corners above it are cut back out of the fold that caused them
   * ({@link cutCusps}); one that cannot be cut clear THROWS.
   */
  maxRelativeTurn?: number;
  /**
   * radius the cut turns at when it has to come back out of a fold, as a MULTIPLE OF `margin`.
   * Default 3.
   *
   * ⛔ A multiple, not a fixed length, and it must exceed 1. The obstacle such a turn wraps has
   * radius `(factor - 1) · margin`, so at a factor of 1 it vanishes and there is nothing to turn
   * around — MEASURED: a fixed 12 m radius leaves no wall at all once `margin` reaches 12.
   */
  cuspTurnFactor?: number;
  /**
   * Convex obstacle hulls in well space — e.g. `fenceObstacles(well)`, one per self-crossing loop
   * or tight fold. A blocked transition WRAPS the matching hull (grown by `margin`) instead of
   * threading the fold: the well INSIDE a hull is ignored, only the hull shapes the detour.
   */
  obstacles?: Vec2[][];
  /**
   * The stiff rod's BENDING LENGTH as a multiple of the obstacle ring's diameter — the scale
   * below which it behaves as a stiff beam and above which as a taut string. `0` is the taut
   * string (straight chords between contacts); larger leaves the runs earlier and rounds every
   * corner over a longer stretch. Default 1. See `stiff-rod.ts`.
   */
  rodStiffness?: number;
  /**
   * The stiff rod's ANCHOR SCALE: a global multiple on the measured anchor lengths (each clamp
   * sits `max(3, c · φ/θ, 2 · (Ψ − 90°)/θ)` atoms back along its run, `c` by the clamp's
   * convexity, Ψ the well's turn between the runs). 1 = as
   * measured; larger = the rod leaves the runs earlier. See `stiff-rod.ts`.
   */
  rodAnchor?: Partial<StiffRodAnchor>;
  /**
   * The stretch that ships, when the well was run on past it: its first / last point, as
   * {@link trimFenceCore} takes them. A rod lying wholly outside it is never laid, and the curve is
   * cut back to it before the fold repair and the gates — a failure out there cannot reject the cut.
   */
  keep?: { head?: Vec2; td?: Vec2 };
  /** diagnostics sink — the per-transition ring/seed/seam are appended here, even on failure. */
  debug?: TransitionDebug[];
  /** diagnostics: the stiff rod's rounds, one line each — see `ConstrainedRodOptions.trace`. */
  rodTrace?: (line: string) => void;
};

/** What {@link oneSidedOffset} measured about the curve it produced. */
export type OneSidedOffsetMetrics = {
  /** closest approach to the well, in metres (capped) — GATE 1 */
  clearance: number;
  /** self-intersection count — GATE 2 */
  loops: number;
  /** smallest turning radius over a window, in metres — GATE 3 */
  minRadius: number;
  /** largest turn over a 25 m window, in radians — GATE 4 (under-dense / abrupt) */
  maxTurn: number;
  /** the sharpest single corner, and where — GATE 6, the steep-turn gate's evidence */
  worstTurn: PolylineTurn;
  /** sharp-edge vertices by the arm-weighted rule — GATE 3/4 corroboration */
  sharp: number;
  /** vertices in the result — GATE 5 (density) */
  vertices: number;
};

/** The grown obstacle and its connector for one transition — diagnostics only. */
export type TransitionDebug = {
  /** the walk ring of the obstacle the rod rounds — the rounded zone boundary, and the path's source; empty for a join with no obstacle between the runs */
  ring: Vec2[];
  /** the ring PATH between the two clipped run ends — the rod's seed through the ring */
  traced: Vec2[];
  /** the connector actually produced — present even when it failed to clear */
  seam?: Vec2[];
  /** the rod's vertex spacing, in metres — the ring's diameter over {@link RING_ROD_ATOMS} */
  atom?: number;
  /** the anchored span the stiff rod settles from — ring path plus both run stretches, at the atom */
  seed?: Vec2[];
  /** metres of run A and of run B the seed reaches into */
  anchor?: [number, number];
  /** the turn each anchor is set by — see `seedStiffRod` */
  turn?: [StiffRodTurn, StiffRodTurn];
  /** the rod vertices pressed against a ring or the margin at rest */
  contacts?: Vec2[];
  /** every spot where the rod failed its gate, and why — the places to look at */
  failures?: Array<{ point: Vec2; reason: string }>;
};

/** A one-sided offset and what it measured. */
export type OneSidedOffset = {
  /** the offset curve, in the input's HEAD→TD order */
  points: Vec2[];
  /** how many run-to-run transitions were traced */
  bridges: number;
  /** the ring, seed and rod per transition, in build order — diagnostics only */
  transitions: TransitionDebug[];
  metrics: OneSidedOffsetMetrics;
};

/** The pruned boundary before any fold is bridged — the raw "follow" of the well. */
export type OffsetRuns = {
  /** each contiguous stretch of boundary, in TD→head order, ≥ 2 points */
  runs: Vec2[][];
  /**
   * what opened each gap BETWEEN consecutive runs — `runs.length - 1` entries.
   *
   * ⭐⭐ The index into the caller's `obstacles` whose grown hull pruned the missing stretch, or
   * `null` when the gap came from the fold prune with no obstacle involved. Recorded here
   * because only the prune knows it; re-deriving it downstream from the run-end geometry is
   * guesswork that fails on a thin hull.
   */
  gaps: (number | null)[];
  /** the split threshold used, in metres (measured from the local spacing) */
  splitAt: number;
  /** boundary vertices that survived the prune, before splitting */
  boundary: number;
};

const unit = (x: number, z: number): Vec2 => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

/**
 * Whether a point lies inside a convex polygon (either winding).
 *
 * @group Utils
 */
export const pointInConvex = (p: Vec2, hull: Vec2[]): boolean => {
  let pos = false;
  let neg = false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross > 1e-9) pos = true;
    else if (cross < -1e-9) neg = true;
    if (pos && neg) return false;
  }
  return true;
};

/**
 * The straight-segment chain carrying an offset boundary around a corner, at `radius` from
 * `centre`, turning from outward direction `from` to outward direction `to`.
 *
 * ⭐⭐ NEVER AN ARC. A round join forces dense tessellation and reads as an abrupt
 * straight-to-curve break in a fence cut. This is a MITER instead — one vertex, at
 * `radius / cos(θ/2)` — subdivided into `k` equal miters only when that vertex would stand out
 * further than `miterLimit · radius`. Every vertex lies on a tangent polygon OUTSIDE the
 * clearance circle, so subdividing blunts the spike without ever relaxing clearance.
 *
 * @returns the vertices to insert BETWEEN the two offset walls (the walls' own endpoints are
 * the caller's), or `[]` when the directions are collinear
 */
const cornerChain = (
  centre: Vec2,
  from: Vec2,
  to: Vec2,
  radius: number,
  miterLimit: number,
): Vec2[] => {
  const a0 = Math.atan2(from[1], from[0]);
  let delta = Math.atan2(to[1], to[0]) - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const turn = Math.abs(delta);
  if (turn < 1e-9) return [];
  // A half-turn of `maxHalf` is exactly the limit ratio, so k is the fewest miters that respect it.
  const maxHalf = Math.acos(1 / Math.max(1.001, miterLimit));
  const k = Math.max(1, Math.ceil(turn / (2 * maxHalf)));
  const r = radius / Math.cos(turn / (2 * k));
  const out: Vec2[] = [];
  for (let j = 0; j < k; j++) {
    const a = a0 + (delta * (2 * j + 1)) / (2 * k);
    out.push([centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r]);
  }
  return out;
};

/**
 * The point `target` metres along a polyline, and the index of the vertex before it.
 */
const atArc = (
  path: Vec2[],
  arc: ArrayLike<number>,
  target: number,
): { p: Vec2; i: number } => {
  if (target <= 0) return { p: path[0], i: 0 };
  const last = path.length - 1;
  if (target >= arc[last]) return { p: path[last], i: last };
  let i = 0;
  while (i < last && arc[i + 1] <= target) i++;
  const span = arc[i + 1] - arc[i];
  const t = span > 1e-12 ? (target - arc[i]) / span : 0;
  return {
    p: [
      path[i][0] + (path[i + 1][0] - path[i][0]) * t,
      path[i][1] + (path[i + 1][1] - path[i][1]) * t,
    ],
    i,
  };
};

/** What a stretch of trace is common to every problem with it. */
type TraceProblemBase = {
  /** which side is boxed in — the other side passes it trivially */
  side: FenceSideName;
  /** index range into the trace the problem covers */
  span: [number, number];
  /** its convex hull — what a cut goes AROUND instead of following */
  hull: Vec2[];
};

/**
 * A stretch of trace a cut cannot follow, and why.
 *
 * ⭐⭐ TWO MEASUREMENTS, ONE CONTRACT. A `pocket` is the trace doubling back through a gap
 * narrower than what is behind it; a `kink` is the trace turning tighter than the cut can flow.
 * They are genuinely different questions — a shallow zigzag traps nothing yet is unfollowable,
 * and a wide loop is followable everywhere yet traps a kilometre — so one number cannot answer
 * both. What they share is the consequence, and that is what this type is: a hull to go round.
 */
export type TraceProblemSpan = TraceProblemBase &
  (
    | {
        reason: 'pocket';
        /** the gap the trace doubles back through, in metres */
        mouth: number;
        /** trace length caught behind that gap, in metres */
        trappedArc: number;
        /** `trappedArc / mouth` — 1 is a straight line, 1.57 a semicircle, unbounded for a loop */
        ratio: number;
        /**
         * The fraction of the whole trace caught behind the mouth.
         *
         * ⭐⭐ This is what separates a pocket IN the trace from the trace's own SHAPE, and the
         * ratio cannot: the trapped arc grows with the length of the hole while the mouth does
         * not, so a long lazy loop scores the same as a tight hairpin. MEASURED over Volve and the
         * synthetic set, every legitimate pocket traps ≤ 25% — F-12 traps **80% through a 299 m
         * mouth**, which is more than a third of its own footprint and is not something a cut
         * routes around; it is a well whose plan shape is one big loop.
         * ⚠️ Reported, not gated: a genuinely closed loop also covers ~48%, and that one DOES want
         * wrapping. Coverage and mouth width have to be read together.
         */
        coverage: number;
        /** the two points the mouth is measured between */
        bar: [Vec2, Vec2];
        /**
         * Metres of each arm outside the mouth framed with the pocket: its NECK, where the two arms
         * are still no wider apart than the pocket itself. `span` and `hull` include it.
         */
        neck: number;
        /** the pocket framed at its mouth alone, without the neck */
        loop: { span: [number, number]; hull: Vec2[] };
        /**
         * Whether a cut holding `margin` could pass through the mouth at all.
         *
         * ⚠️ REPORTED, never a trigger. An unthreadable pocket is a harder failure than a deep
         * one — the caller decides what to do — but folding it into the detection rule would put
         * a clearance back into a test whose whole value is having no length in it.
         */
        threadable: boolean;
      }
    | {
        reason: 'kink';
        /** the trace's own turn radius here, measured at the FINE scale, in metres */
        radius: number;
        /** the same bend measured over a window {@link KINK_SCALE_STEP}x wider */
        coarseRadius: number;
        /**
         * `coarseRadius / radius` — how much the tightness DISSOLVES when you zoom out.
         *
         * ⭐⭐ This is what separates a defect from a drilled curve, and it is the whole reason
         * the kink test is two-scale. MEASURED on Volve: F-1's tight spot reads 51/44/40/40/45 m
         * at windows of 2/5/10/20/40 m — the SAME radius at every scale, because it is a real
         * ~40 m arc — while 19 A's reads 4/15/40/75/88, dissolving as the window grows, because it
         * is a local kink a few metres across. Ratios of 0.9 against 22. A single-window test
         * cannot tell them apart at ANY threshold: it only trades which one it misses.
         */
        sharpness: number;
        /** the tightest point */
        at: Vec2;
      }
  );

/** A {@link TraceProblemSpan} that doubles back through a narrow gap. */
export type TracePocketSpan = Extract<TraceProblemSpan, { reason: 'pocket' }>;

/** A {@link TraceProblemSpan} that turns tighter than the cut can flow. */
export type TraceKinkSpan = Extract<TraceProblemSpan, { reason: 'kink' }>;

/** Narrowing helper — `spans.filter(isPocket)` keeps the type. */
export const isTracePocket = (s: TraceProblemSpan): s is TracePocketSpan =>
  s.reason === 'pocket';

/** Narrowing helper — `spans.filter(isKink)` keeps the type. */
export const isTraceKink = (s: TraceProblemSpan): s is TraceKinkSpan =>
  s.reason === 'kink';

/** {@link traceProblemSpans} options. */
export type TraceProblemOptions = {
  /** the arc-to-chord ratio at which a pocket counts as a problem. Default {@link DEFAULT_PROBLEM_RATIO}. */
  minRatio?: number;
  /**
   * How much tighter a bend must read at the fine scale than at the coarse one before it counts
   * as a kink rather than a drilled curve. Default {@link DEFAULT_KINK_SHARPNESS}.
   */
  minSharpness?: number;
  /**
   * The angle a bend must sweep to count at all, in radians.
   * Default {@link DEFAULT_KINK_MIN_TURN}.
   */
  minTurn?: number;
  /**
   * Metres between scan stations for the POCKET pass. Default {@link DEFAULT_PROBLEM_RESOLUTION}.
   *
   * ⛔ This used to be derived from a turn-radius threshold, which made ONE control the threshold, the
   * measurement scale, the station count AND the pocket scan's resolution — four jobs, so tuning
   * it moved the answer in contradictory directions. It is a sampling resolution and nothing else.
   */
  resolution?: number;
  /**
   * Metres between scan stations for the KINK pass. Default {@link DEFAULT_KINK_RESOLUTION}.
   *
   * ⭐ Separate from `resolution` because the two passes have different costs and different
   * targets: the pocket pass is O(stations²) and compares DISTANT passes, so coarse stations are
   * enough; the kink pass is O(stations) and hunts features a few metres across, so it can afford
   * to be far finer — and has to be, or a short feature is hit by too few stations to form a run.
   */
  kinkResolution?: number;
  /**
   * The fine curvature window, in metres. Default {@link DEFAULT_KINK_WINDOW}.
   *
   * ⚠️ Unlike `kinkResolution` this cannot go below the trace's own sampling without measuring
   * the polyline instead of the well.
   */
  kinkWindow?: number;
  /**
   * Above this fraction of the trace, a "pocket" is the well's own SHAPE rather than a feature in
   * it, and is not reported. Default {@link DEFAULT_MAX_COVERAGE}.
   */
  maxCoverage?: number;
  /** the clearance a cut will hold, in metres — only reported, through `threadable`. */
  margin?: number;
  /** hard cap on scan stations, since the pocket pass is O(n²). Default {@link DEFAULT_PROBLEM_STATIONS}. */
  maxStations?: number;
};

/**
 * When a pocket is deep enough to matter, as the ratio of the trace caught behind a gap to the
 * width of that gap.
 *
 * ⭐⭐ THE VALUE IS DERIVED, NOT TUNED. For an excursion of depth `D` returning through a mouth
 * `M`, the trapped arc is about `2D + M`, so the ratio is `2D/M + 1`:
 * ```
 * M = 3D (a gentle excursion)   1.7
 * M = D  (as deep as it is wide) 3.0   <- the default
 * M = D/4 (nearly a loop)        9
 * M -> 0 (closed)                -> infinity
 * ```
 * A semicircle — the worst shape that is not a defect at all — is `pi/2 = 1.57`, so 3 clears it
 * comfortably. Being a RATIO is the whole point: a 25 m hook and a 900 m loop are judged the same
 * way, with no length anywhere. Plan-extent over TVD ranges 0.01 to 5.34 across the fields we
 * hold, which no absolute constant survives.
 */
const DEFAULT_PROBLEM_RATIO = 3;

/** Scan resolution cap. The pocket pass is O(stations²), and this bounds it. */
const DEFAULT_PROBLEM_STATIONS = 1200;

/**
 * Metres between scan stations.
 *
 * ⭐ MEASURED over the 26 Volve wells (warm, so JIT is not in the number): 5 m gives a mean of
 * 4.2 ms and a worst case of 16 ms, against 11.3/19 ms at 2.5 m and 17.8/32 ms at 1.7 m, for 21
 * spans against 23 and 25. Halving it again roughly doubles the cost for one more span, so this
 * is where the curve flattens. It also sets the smallest feature the scan can see.
 */
const DEFAULT_PROBLEM_RESOLUTION = 5;

/**
 * Metres between stations for the kink pass.
 *
 * ⭐ SEPARATE from {@link DEFAULT_KINK_WINDOW}, and the two are floored by different things. The
 * WINDOW cannot go below the trace's own sampling or it measures the polyline; the SPACING can,
 * and has to, because a feature has to be hit by several stations to be framed as a run. MEASURED
 * on 19 A, whose head curl spans arc 1–5 m: at 2.5 m spacing only two stations landed in it, one
 * of those had its backward window inside the curl, and the scan reported the single surviving
 * station out on the shoulder.
 */
const DEFAULT_KINK_RESOLUTION = 1;

/**
 * The fine curvature window, in metres.
 *
 * ⭐⭐ CHOSEN BY SWEEPING IT OVER THE 26 VOLVE WELLS, and it is the one number that decides which
 * hooks are visible at all — a feature smaller than the window is smoothed into a gentler radius
 * and drops under `minSharpness`. F-5's head hook is about a metre across and reads 38 m at a 5 m
 * window (sharpness 2.3, just under the trigger) but 4 m at a 3 m window (sharpness 5).
 * ```
 * window   1.5   2     3     5      totals over the field
 * kinks     11   14    24    29
 * F-5        Y    Y     Y     n
 * F-9 A      Y    Y     Y     n
 * 19 A       Y    n     Y     Y
 * F-1        n    n     n     n     <- its real 40 m arc, correctly ignored throughout
 * ```
 * ⚠️ A previous note here claimed 5 m was the finest usable because "at 2 m every well reported
 * sub-metre kinks". That was measured on the SYNTHETIC set, whose vertical section is an
 * artificial random walk; on real traces a smaller window finds FEWER kinks, not more, because the
 * coarse window shrinks with it and the surroundings stop looking straight.
 * ⚠️ It cannot go far below the trace's own 2 m sampling without measuring the polyline.
 */
const DEFAULT_KINK_WINDOW = 3;

/** How much wider the coarse curvature window is than the fine one. */
const KINK_SCALE_STEP = 5;

/**
 * How much tighter a bend must read at the fine scale than at the coarse one to be a kink.
 *
 * ⭐ A circular arc reads the SAME radius at every scale, so a genuine drilled curve sits at ~1
 * however tight it is; a local kink dissolves as the window grows. Measured on Volve, the two
 * cases the eye separates sit at 0.9 (F-1, a real 40 m arc) and 22 (19 A, a few-metre kink), so
 * anything in 2–5 divides them and 3 is not perched on either.
 */
const DEFAULT_KINK_SHARPNESS = 3;

/**
 * The angle a bend must actually sweep, in radians, before it counts as a kink.
 *
 * ⭐⭐ A bend of radius `R` sweeping `θ` occupies `R·θ` of arc, so requiring `arc / R ≥ θ` is
 * exactly "the trace really turns here" — and it is dimensionless, so it says the same thing for a
 * 1 m kink and a 400 m one. It is what separates a bend from the POLYLINE's own discretisation:
 * the trace is simplified by angle and sampled at metres, so three points a couple of metres apart
 * across one vertex measure that vertex's joint, not the well. MEASURED on the narrow-fold
 * fixture, whose visibly straight run reported radii of 32–40 m over one-station runs — a 3°
 * joint, which this rejects while keeping a 4 m curl that turns through most of a half-circle.
 */
const DEFAULT_KINK_MIN_TURN = 0.5;

/**
 * The share of the trace above which a pocket stops being a feature and becomes the well's shape.
 *
 * ⭐⭐ MEASURED over Volve and the synthetic set: every legitimate pocket traps ≤ 25% of its trace,
 * a genuinely closed loop or spiral traps 44–48%, and F-12 — which is simply a well drilled in a
 * big open curve — traps **80% through a 299 m mouth**, a third of its own footprint. 0.6 sits in
 * the empty band between the loop and F-12.
 *
 * ⚠️ The reason the ratio needs this at all: the trapped arc grows with the LENGTH of the hole
 * while the mouth does not, so a long lazy curve scores like a tight hairpin. F-12 packs 1268 m of
 * arc into an 812 m box.
 */
const DEFAULT_MAX_COVERAGE = 0.6;

/**
 * How far past `minRatio` a high-coverage pocket must be to survive {@link DEFAULT_MAX_COVERAGE}.
 *
 * ⭐ The coverage rule exists to drop a well that is simply drilled in a big open curve, and such
 * a well is MARGINAL on the ratio too — F-12 scores 3.4 against a trigger of 3. A genuinely closed
 * feature is nowhere near the boundary: the loop and spiral fixtures score 2690 and 2917. Testing
 * both keeps a tight fold that happens to span most of a SHORT well, which a coverage rule alone
 * would have thrown away.
 */
const COVERAGE_RATIO_MARGIN = 2;

/**
 * Vertices the rod round an obstacle ring is built from, per ring DIAMETER — the one scale of a
 * ring transition. MEASURED on 26 wells + synthetic presets: 8 gives 4–12 segment connectors that
 * seat at half a diameter of setback; 4 lifts the rod 200–300 m off a big hull (its standoff grows
 * with the atom) and 16 chords the ring on small hulls.
 */
export const RING_ROD_ATOMS = 8;

/** Bending-length multiple of a rod with no ring to round, on top of `rodStiffness`. */
export const FREE_ROD_STIFFNESS = 2;

/**
 * The rod's ATOM for a ring of diameter `D` at `margin`: the vertex spacing the rod rounds the ring
 * at, `D / RING_ROD_ATOMS`, never finer than half a margin or 0.25 m.
 *
 * @group Utils
 */
export const ringAtom = (D: number, margin: number): number =>
  Math.max(Math.max(0.25, margin * 0.5), D / RING_ROD_ATOMS);

/**
 * An obstacle's ZONE as a polygon: its hull grown by `margin` with no corner turning more than
 * `maxRelativeTurn / 2` — the rounded zone boundary to within 2% of the margin, outside it
 * everywhere. The one polygon the zone is drawn and walked as, and read for its extent; whether a
 * point is IN the zone is its distance to the hull ({@link hullsWithin}).
 *
 * @group Utils
 */
export const zoneRing = (
  hull: Vec2[],
  margin: number,
  maxRelativeTurn: number = Math.PI / 4,
): Vec2[] =>
  hull.length >= 3
    ? dilateConvex(hull, margin, 1 / Math.cos(maxRelativeTurn / 4))
    : hull;

/** Metres between the offset candidates a run is built from: half a margin, floored and capped. */
const offsetStep = (margin: number): number =>
  Math.min(4, Math.max(0.5, margin * 0.5));

/**
 * Thrown by {@link oneSidedOffset} when a rod's anchor runs past its run onto the next obstacle's
 * ring, or back into the previous rod: the two need more run than lies between their rings, so
 * the two hulls are ONE obstacle and the trace must be re-planned with them fused.
 *
 * @group Utils
 */
export class RodOverlapError extends Error {
  /** the two obstacle hulls, in walk order, as given in `obstacles` */
  readonly hulls: [Vec2[], Vec2[]];
  constructor(message: string, hulls: [Vec2[], Vec2[]]) {
    super(message);
    this.name = 'RodOverlapError';
    this.hulls = hulls;
  }
}

/**
 * Every pocket in a plan trace a cut must go AROUND rather than follow.
 *
 * ⭐⭐ ONE measurement replaces a family of them. The existing detectors are all the same scan at
 * a different fixed radius — `fenceFoldSpans` at a 4 m self-approach, its reversal rule at 150° —
 * and each therefore sees one size of defect. MEASURED on synthetic shapes whose right answer is
 * known: `fenceFoldSpans` gives an IDENTICAL verdict for a fold with a quarter-width mouth and one
 * with a triple-width mouth (it detects neither, and reports only the vertical section's own
 * wander). It does not catch a 400 m-deep fold with a 200 m mouth.
 *
 * ⭐ What is measured instead is the ARC-TO-CHORD ratio between two passes: how far the trace
 * travels between two points against how far apart they actually are. That is 1 on a straight
 * line whatever its length, and unbounded where the trace closes on itself — so it finds a tiny
 * hook and a kilometre loop by the same rule and needs no length constant at all.
 *
 * ⚠️ One-sided: the pocket is on the side the returning pass lies on,
 * and the other side wraps the outer bulge without difficulty. The hull is still solid for both
 * cuts — that is `oneSidedOffset`'s contract for an obstacle — but only one side was ever boxed in.
 *
 * @param trace the plan trace, head→TD
 *
 * @group Utils
 */
export function traceProblemSpans(
  trace: Vec2[],
  options: TraceProblemOptions = {},
): TraceProblemSpan[] {
  const minRatio = options.minRatio ?? DEFAULT_PROBLEM_RATIO;
  const maxStations = options.maxStations ?? DEFAULT_PROBLEM_STATIONS;
  const minSharpness = options.minSharpness ?? DEFAULT_KINK_SHARPNESS;
  const minTurn = options.minTurn ?? DEFAULT_KINK_MIN_TURN;
  const maxCoverage = options.maxCoverage ?? DEFAULT_MAX_COVERAGE;
  const resolution = Math.max(
    0.1,
    options.resolution ?? DEFAULT_PROBLEM_RESOLUTION,
  );
  const kinkResolution = Math.max(
    0.05,
    options.kinkResolution ?? DEFAULT_KINK_RESOLUTION,
  );
  const kinkWindow = Math.max(0.1, options.kinkWindow ?? DEFAULT_KINK_WINDOW);
  const margin = options.margin ?? 0;
  if (trace.length < 3) return [];
  const arcAll = polylineArcLengths(trace);
  const total = arcAll[trace.length - 1];
  if (!(total > 0)) return [];

  // ⭐ The fine window is the KINK pass's own resolution. Tying it to a radius threshold made one
  // control decide both what counts as too tight AND what size of
  // feature was visible at all, so lowering it found smaller kinks while forgiving tighter ones.
  const fineWindow = kinkWindow;
  const coarseWindow = fineWindow * KINK_SCALE_STEP;

  const count = Math.max(
    16,
    Math.min(
      maxStations,
      // ⛔ NOT `trace.length`. Stations SAMPLE the arc, and the curvature windows are physical
      // lengths — a count tied to the vertex count both misses corners where the trace is sparse
      // (it is simplified by ANGLE, so a straight run survives as two vertices and a whole window
      // lands inside one segment) and costs O(n²) in the pocket pass where it is dense. MEASURED
      // over the 26 Volve wells: tying it to the vertex count gave a 33.6 ms mean and a 70 ms
      // worst case, against 4.2 ms and 16 ms for `total / resolution`, for one span fewer.
      Math.ceil(total / resolution),
    ),
  );
  const pts: Vec2[] = new Array(count);
  const arcs = new Float64Array(count);
  const vertex = new Int32Array(count);
  for (let k = 0; k < count; k++) {
    const a = (total * k) / (count - 1);
    const hit = atArc(trace, arcAll, a);
    pts[k] = hit.p;
    arcs[k] = a;
    vertex[k] = hit.i;
  }

  type Pinch = {
    i: number;
    j: number;
    ratio: number;
    mouth: number;
    bar: [Vec2, Vec2];
  };
  // The WORST pinch each station takes part in. Taking the nearest pass instead would always
  // answer "the next station", which is the straight-line case and hides the fold entirely.
  const found: Pinch[] = [];
  for (let i = 0; i < count; i++) {
    let best: Pinch | null = null;
    for (let j = i + 1; j < count; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < 1e-9) continue;
      const ratio = (arcs[j] - arcs[i]) / d;
      if (ratio < minRatio) continue;
      if (!best || ratio > best.ratio) {
        best = { i, j, ratio, mouth: d, bar: [pts[i], pts[j]] };
      }
    }
    if (best) found.push(best);
  }
  // ⛔ No early return here. It used to bail when no pocket was found, which silently skipped the
  // kink scan below — so a trace with tight corners and nothing trapped reported CLEAN.

  // Neighbouring stations report the SAME pocket, so a contiguous run of them is one span and the
  // strongest pinch in the run describes it.
  // ⛔ NOT merged by overlapping `[i, j]` ranges: a pocket's range reaches all the way to its
  // returning pass, so one tiny pinch at the head whose partner lies near TD absorbs every span
  // between the two. MEASURED on the spiral fixture — a 1 m mouth at station 0 produced a single
  // span covering 1950 of 1955 vertices and hid every real turn of the spiral.
  const merged: Pinch[] = [];
  let run: Pinch | null = null;
  let previous = -2;
  for (const p of found) {
    if (run && p.i === previous + 1) {
      if (p.ratio > run.ratio) run = { ...p };
    } else {
      if (run) merged.push(run);
      run = { ...p };
    }
    previous = p.i;
  }
  if (run) merged.push(run);

  // A pocket inside a stronger pocket is already inside its hull, so reporting both would hand
  // the caller two obstacles for one feature.
  const kept: Pinch[] = [];
  for (const p of [...merged].sort((a, b) => b.ratio - a.ratio)) {
    if (kept.some(k => p.i >= k.i && p.j <= k.j)) continue;
    kept.push(p);
  }
  kept.sort((a, b) => a.i - b.i);

  /** The side a hand belongs to, stated once — the convention has caught this codebase out before. */
  const sideOf = (hand: number): FenceSideName =>
    sideNormalSign('left') === hand ? 'left' : 'right';

  const pockets: TraceProblemSpan[] = [];
  for (const p of kept) {
    const trappedArc = arcs[p.j] - arcs[p.i];
    const coverage = trappedArc / total;
    const threadable = !(margin > 0) || p.mouth >= 2 * margin;
    // ⛔ A pocket that swallows most of the trace is the well's own shape, not something a cut
    // routes around — wrapping it would remove the whole wellbore. Only when the ratio is also
    // marginal, though: a closed loop covers about as much and DOES want wrapping.
    if (coverage > maxCoverage && p.ratio < minRatio * COVERAGE_RATIO_MARGIN) {
      continue;
    }
    const a = Math.max(0, vertex[p.i]);
    const b = Math.min(trace.length - 1, vertex[p.j] + 1);
    // ⭐ THE NECK. Arms that stay closer together than the pocket is wide leave the cut inside the
    // fold a V narrower than a rod scaled by that pocket can turn round in — so they belong to it.
    // Walked by equal arc from the mouth. MEASURED on X07: a 2 m mouth whose arms are 7.6 m apart
    // 20 m out and 18 m at its head, 52 m back — framed at the mouth, the two rods overlapped.
    const loopHull = convexHull2D(trace.slice(a, b + 1));
    const width = hullDiameter(loopHull);
    const a0 = arcAll[a];
    const a1 = arcAll[b];
    let neck = 0;
    for (
      let t = kinkResolution;
      a0 - t >= 0 && a1 + t <= total;
      t += kinkResolution
    ) {
      const u = pointAtArcLength(trace, arcAll, a0 - t);
      const v = pointAtArcLength(trace, arcAll, a1 + t);
      if (Math.hypot(u[0] - v[0], u[1] - v[1]) > width) break;
      neck = t;
    }
    let first = a;
    while (first > 0 && arcAll[first] > a0 - neck) first--;
    let last = b;
    while (last < trace.length - 1 && arcAll[last] < a1 + neck) last++;
    const prev = pts[Math.max(0, p.i - 1)];
    const next = pts[Math.min(count - 1, p.i + 1)];
    const tangent: Vec2 = [next[0] - prev[0], next[1] - prev[1]];
    const to: Vec2 = [p.bar[1][0] - p.bar[0][0], p.bar[1][1] - p.bar[0][1]];
    const hand = Math.sign(tangent[0] * to[1] - tangent[1] * to[0]) || 1;
    pockets.push({
      reason: 'pocket',
      side: sideOf(hand),
      span: [first, last],
      hull: convexHull2D(trace.slice(first, last + 1)),
      mouth: p.mouth,
      trappedArc,
      ratio: p.ratio,
      coverage,
      bar: p.bar,
      neck,
      loop: { span: [a, b], hull: loopHull },
      threadable,
    });
  }

  // --- KINKS: where the trace turns tighter than the cut can flow. -------------------------
  /**
   * A monotonic point-at-arc walker.
   *
   * ⭐ `atArc` rescans from vertex 0 on every call, so the kink pass — six lookups per station over
   * thousands of stations — was O(stations × vertices). Every offset it asks for advances with the
   * station, so one cursor per offset makes the whole pass linear. MEASURED: 10.5 ms mean over the
   * 26 Volve wells before, and it is the difference between a 1 m station spacing being affordable
   * and not.
   */
  const walker = () => {
    let i = 0;
    return (t: number): Vec2 => {
      const last = trace.length - 1;
      if (t <= 0) return trace[0];
      if (t >= total) return trace[last];
      while (i < last - 1 && arcAll[i + 1] <= t) i++;
      while (i > 0 && arcAll[i] > t) i--;
      const span = arcAll[i + 1] - arcAll[i];
      const u = span > 1e-12 ? (t - arcAll[i]) / span : 0;
      return [
        trace[i][0] + (trace[i + 1][0] - trace[i][0]) * u,
        trace[i][1] + (trace[i + 1][1] - trace[i][1]) * u,
      ];
    };
  };
  const walkFineBack = walker();
  const walkCentre = walker();
  const walkFineFwd = walker();
  const walkCoarseBack = walker();
  const walkCoarseFwd = walker();

  /**
   * Circumradius of three points — exact for anything lying on a circle, and it does NOT need the
   * two arc offsets to match.
   *
   * ⚠️ That asymmetry is load-bearing. A kink within one window of the trace's start has no trace
   * behind it to average over, and a symmetric window simply refused to judge it — which is
   * exactly where the head kinks are.
   */
  const radiusOf = (
    p0: Vec2,
    p1: Vec2,
    p2: Vec2,
  ): { radius: number; hand: number } => {
    const cross =
      (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    if (Math.abs(cross) < 1e-9) return { radius: Infinity, hand: 1 };
    return {
      radius:
        (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) *
          Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) *
          Math.hypot(p2[0] - p0[0], p2[1] - p0[1])) /
        (2 * Math.abs(cross)),
      hand: Math.sign(cross) || 1,
    };
  };

  type Bend = {
    k: number;
    radius: number;
    coarseRadius: number;
    sharpness: number;
    at: Vec2;
    hand: number;
  };
  // ⭐ The kink pass walks its OWN stations. Sharing the pocket pass's meant a feature smaller
  // than that spacing fell between samples: 19 A's head curl spans 4 m of plan arc, and at the
  // pocket pass's 5 m stations the scan reported a bend out on the following straight instead.
  const kinkCount = Math.max(16, Math.ceil(total / kinkResolution) + 1);
  // Every station's fine reading is kept, not just the ones that trip a gate: a bend has to be
  // grown out to its own extent afterwards, and that needs the shape either side of the trigger.
  const fineRadius = new Float64Array(kinkCount).fill(Infinity);
  const fineHand = new Int8Array(kinkCount);
  const bends: Bend[] = [];
  for (let k = 0; k < kinkCount; k++) {
    const a = (total * k) / (kinkCount - 1);
    const fineBack = Math.min(fineWindow, a);
    const fineFwd = Math.min(fineWindow, total - a);
    // ⚠️ A quarter of a window, not half: the asymmetric reading already copes with a short reach,
    // and half a window blanks the first 2.5 m of trace — where F-9 A's head feature sits (radius
    // 8 m against a 28 m neighbourhood, well over the trigger, and silently skipped).
    if (fineBack < fineWindow * 0.25 || fineFwd < fineWindow * 0.25) continue;
    const centre = walkCentre(a);
    const fine = radiusOf(
      walkFineBack(a - fineBack),
      centre,
      walkFineFwd(a + fineFwd),
    );
    fineRadius[k] = fine.radius;
    fineHand[k] = fine.hand;
    // a straight stretch has no finite radius
    if (!(fine.radius < Infinity)) continue;
    const coarseBack = Math.min(coarseWindow, a);
    const coarseFwd = Math.min(coarseWindow, total - a);
    // At least one side has to offer a genuinely wider view, or there is no second scale to
    // compare against and `sharpness` would be measuring nothing.
    if (Math.max(coarseBack, coarseFwd) < fineWindow * 2) continue;
    const coarse = radiusOf(
      walkCoarseBack(a - coarseBack),
      centre,
      walkCoarseFwd(a + coarseFwd),
    );
    // ⭐ A drilled arc reads the same radius at both scales; a local kink dissolves at the coarse
    // one. Without this a single threshold can only trade F-1's real 40 m bend against 19 A's
    // few-metre kink — it cannot keep one and drop the other.
    const sharpness = coarse.radius / fine.radius;
    // ⭐ A corner's reading grows with the window, so the most a kink can dissolve is the zoom the
    // windows actually get — clipped near an end. X09's TD corner, 6 m from TD: zoom 3.5 against
    // the full 5, sharpness 2.49 against a trigger of 3. Mid-trace the zoom is 5 and nothing moves.
    const zoom = (coarseBack + coarseFwd) / (fineBack + fineFwd);
    if (!(sharpness >= (minSharpness * zoom) / KINK_SCALE_STEP)) continue;
    bends.push({
      k,
      radius: fine.radius,
      coarseRadius: coarse.radius,
      sharpness,
      at: centre,
      hand: fine.hand,
    });
  }

  /**
   * Grow a trigger out to the extent of the BEND it belongs to.
   *
   * ⭐⭐ A bend is bounded by its inflection points — where the trace stops turning that way — not
   * by wherever the detection thresholds happened to trip. Only the tightest part of a hook clears
   * `minSharpness`, so reporting the trigger alone frames a fragment in the middle of the feature
   * and leaves the approach and the tip outside the hull a cut would have to go around.
   * Growth stops at an inflection (the hand flips) or where the trace is no longer tighter than
   * the neighbourhood the trigger was judged against, so it is bounded by the feature's own scale.
   */
  const grow = (bend: Bend, from: number, to: number): [number, number] => {
    const stillBending = (k: number) =>
      fineHand[k] === bend.hand && fineRadius[k] < bend.coarseRadius;
    let lo = from;
    let hi = to;
    while (lo > 0 && stillBending(lo - 1)) lo--;
    while (hi < kinkCount - 1 && stillBending(hi + 1)) hi++;
    // ⚠️ The first and last window of trace cannot be measured at all — there is no room for a
    // window — so growth there stops for lack of a reading rather than because the bend ended.
    // A feature that is still turning when the trace runs out reaches the end of it. This is what
    // frames 19 A's head curl, which sits inside the first 5 m of a 2 km trace.
    const arcOf = (k: number) => (total * k) / (kinkCount - 1);
    if (arcOf(lo) <= fineWindow) lo = 0;
    if (arcOf(hi) >= total - fineWindow) hi = kinkCount - 1;
    return [lo, hi];
  };

  /** The trace vertex nearest a kink station, so a span can be reported in trace indices. */
  const vertexAtArc = (k: number): number =>
    atArc(trace, arcAll, (total * k) / (kinkCount - 1)).i;

  const kinks: TraceKinkSpan[] = [];
  let bendRun: Bend[] = [];
  const flushBend = () => {
    if (bendRun.length === 0) return;
    const tightest = bendRun.reduce((a, b) => (b.radius < a.radius ? b : a));
    const arcOf = (k: number) => (total * k) / (kinkCount - 1);
    // ⭐ The run has to sweep a real angle. Without this the scan reports the polyline's own
    // joints: a single vertex between two long straight segments reads as a 30–40 m radius.
    const swept =
      (arcOf(bendRun[bendRun.length - 1].k) -
        arcOf(bendRun[0].k) +
        fineWindow) /
      tightest.radius;
    if (swept < minTurn) {
      bendRun = [];
      return;
    }
    const [lo, hi] = grow(
      tightest,
      bendRun[0].k,
      bendRun[bendRun.length - 1].k,
    );
    const from = Math.max(0, vertexAtArc(lo));
    const to = Math.min(trace.length - 1, vertexAtArc(hi) + 1);
    if (to > from) {
      kinks.push({
        reason: 'kink',
        side: sideOf(tightest.hand),
        span: [from, to],
        hull: convexHull2D(trace.slice(from, to + 1)),
        radius: tightest.radius,
        coarseRadius: tightest.coarseRadius,
        sharpness: tightest.sharpness,
        at: tightest.at,
      });
    }
    bendRun = [];
  };
  for (const bend of bends) {
    if (bendRun.length > 0 && bend.k !== bendRun[bendRun.length - 1].k + 1) {
      flushBend();
    }
    bendRun.push(bend);
  }
  flushBend();

  // A kink inside a tighter kink's span is ONE bend reported twice: two triggers separated by a
  // single sub-threshold station form two runs, and `grow` walks both out to the same inflection
  // points. The pocket pass prunes nested spans for the same reason.
  const keptKinks: TraceKinkSpan[] = [];
  for (const k of [...kinks].sort((x, y) => x.radius - y.radius)) {
    if (keptKinks.some(o => k.span[0] >= o.span[0] && k.span[1] <= o.span[1])) {
      continue;
    }
    keptKinks.push(k);
  }

  return [...pockets, ...keptKinks].sort((a, b) => a.span[0] - b.span[0]);
}

/**
 * Blunt every corner sharper than `maxTurn` by cutting the curve back OUT of the fold that
 * caused it, until a corner of `radius` fits between the two legs.
 *
 * ⭐⭐ THE CUSP is what this exists for. On the concave side of a fold — or of a bend tighter
 * than the margin — the two offset walls converge and cross. The prune deletes the pinched
 * stretch and the survivors meet nose to nose: MEASURED on F-1 C and the F-11 family, the two run
 * ends sit 0.1–2.1 m apart with 149–171° between their headings, while the chord across them
 * holds the margin exactly. That is a REVERSAL, not a gap, so no join primitive can round it in
 * place and no amount of relaxation will either — the corridor it would have to turn in has
 * closed. The one cure is to stop short of the fold tip, and the setback is the whole answer.
 *
 * ⛔ THE RADIUS IS FIXED. What is solved for is the SETBACK at which a corner of that radius
 * fits, which is a search for a junction, not a relaxed constraint. When no setback clears, this
 * THROWS rather than shipping a curve with a needle in it.
 *
 * ⭐ The cut can only move the curve AWAY from the fold tip — the deepest point of the wedge —
 * so it opens clearance rather than spending it. `verify` still tests, because a hooked fold
 * can put a different part of the well across the new corner.
 */
const cutCusps = (
  path: Vec2[],
  radius: number,
  maxTurn: number,
  tolerance: number,
  lift: (p: Vec2[]) => Vec2[] | null,
  verify: (p: Vec2[]) => { ok: boolean; clearance: number; crossings: number },
  side: FenceSideName,
): Vec2[] => {
  // ⛔ The turn is tessellated by CHORD ERROR, never by `maxTurn`. `maxTurn` is the 45° GATE, so
  // stepping the arc by it gives chords that sag metres inside their own circle — MEASURED as a
  // 0.02–0.03 m clearance shortfall on every well, with zero crossings. A sagitta of `tolerance`
  // needs `2·acos(1 - tolerance/radius)`, which is what `tolerance` is documented to mean.
  const arcStep = Math.min(
    maxTurn,
    2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius))),
  );
  let cur = path;
  // One cusp is removed per pass, and a cut can expose the next one behind it.
  for (let pass = 0; pass < 64; pass++) {
    const worst = polylineWorstTurn(cur);
    if (worst.index < 0 || worst.turn <= maxTurn) return cur;
    const k = worst.index;
    const arc = polylineArcLengths(cur);
    const room = Math.min(arc[k], arc[cur.length - 1] - arc[k]);

    // A spur shorter than the turn it would have to make has no corner to build — the curve ends
    // before the fold instead of poking a needle into it.
    if (room < radius) {
      cur =
        arc[k] <= arc[cur.length - 1] - arc[k]
          ? cur.slice(k)
          : cur.slice(0, k + 1);
      if (cur.length < 2) {
        throw new Error(
          `oneSidedOffset: the ${side} curve is a single cusp with no followable stretch either side of it`,
        );
      }
      continue;
    }

    /**
     * The curve with its cusp replaced by a join that leaves and rejoins `s` metres either side,
     * on the headings it actually travels there — or null when no join can be seated.
     *
     * ⛔ The join is seated ON THE CURVE, never on the chords from the cusp. Chord-seating was
     * MEASURED to fail outright: at a 400 m setback the straight line from the cusp to the
     * retreat point has nothing to do with where the curve went, so the splice cut through the
     * well (clearance 0.00 m, 2–4 crossings, every setback tried).
     */
    const corner = (
      s: number,
    ): { back: number; fwd: number; held: Vec2[]; stretch: Vec2[] } | null => {
      const back = atArc(cur, arc, arc[k] - s);
      const fwd = atArc(cur, arc, arc[k] + s);
      const before = atArc(cur, arc, arc[k] - s - radius).p;
      const after = atArc(cur, arc, arc[k] + s + radius).p;
      const dIn = unit(back.p[0] - before[0], back.p[1] - before[1]);
      const dOut = unit(after[0] - fwd.p[0], after[1] - fwd.p[1]);
      if ((dIn[0] === 0 && dIn[1] === 0) || (dOut[0] === 0 && dOut[1] === 0)) {
        return null;
      }
      // ⛔⛔ The turn's HAND comes from where the far leg LIES, never from `cross(dIn, dOut)`. At a
      // reversal those are anti-parallel, so their cross product is ~0 and its sign is numerical
      // noise — the defect that once sent a 3.2 km run-out leg back over the trajectory.
      const across: Vec2 = [fwd.p[0] - back.p[0], fwd.p[1] - back.p[1]];
      const hand = Math.sign(dIn[0] * across[1] - dIn[1] * across[0]) || 1;
      // ⭐⭐ ARC — STRAIGHT — ARC, both turns the same way round. A single circle tangent to both
      // legs does NOT exist at a reversal: anti-parallel legs give PARALLEL offset lines, meeting
      // only where the legs happen to be exactly `2·radius` apart. Turning out of one leg and into
      // the other along their common tangent is defined at every separation, and at that one
      // separation the straight vanishes and it becomes the pure half-circle U — the deepest a
      // turn of this radius reaches into the fold.
      const c1: Vec2 = [
        back.p[0] - dIn[1] * hand * radius,
        back.p[1] + dIn[0] * hand * radius,
      ];
      const c2: Vec2 = [
        fwd.p[0] - dOut[1] * hand * radius,
        fwd.p[1] + dOut[0] * hand * radius,
      ];
      const span = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
      const angOf = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
      const sweepTo = (a0: number, a1: number): number => {
        let d = a1 - a0;
        while (d * hand < 0) d += hand * 2 * Math.PI;
        while (Math.abs(d) > 2 * Math.PI) d -= hand * 2 * Math.PI;
        return d;
      };
      const arcTo = (c: Vec2, a0: number, sweep: number): Vec2[] => {
        const steps = Math.max(1, Math.ceil(Math.abs(sweep) / arcStep));
        const outPts: Vec2[] = [];
        for (let i = 1; i <= steps; i++) {
          const ang = a0 + (sweep * i) / steps;
          outPts.push([
            c[0] + Math.cos(ang) * radius,
            c[1] + Math.sin(ang) * radius,
          ]);
        }
        return outPts;
      };
      let join: Vec2[];
      // The centres coincide when the legs are exactly `2·radius` apart — the deepest turn, and
      // the case this is aiming for — so `(c2 - c1) / span` is rounding error precisely there.
      if (span < radius * 0.05) {
        const mid: Vec2 = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];
        join = [
          back.p,
          ...arcTo(
            mid,
            angOf(mid, back.p),
            sweepTo(angOf(mid, back.p), angOf(mid, fwd.p)),
          ),
        ];
      } else {
        const dx = (c2[0] - c1[0]) / span;
        const dz = (c2[1] - c1[1]) / span;
        const t1: Vec2 = [
          c1[0] + dz * hand * radius,
          c1[1] - dx * hand * radius,
        ];
        const t2: Vec2 = [
          c2[0] + dz * hand * radius,
          c2[1] - dx * hand * radius,
        ];
        const s1 = sweepTo(angOf(c1, back.p), angOf(c1, t1));
        const s2 = sweepTo(angOf(c2, t2), angOf(c2, fwd.p));
        // ⛔ The centres are `|W - 2·radius|` apart, W being the gap between the legs. Below
        // 2·radius the circles OVERLAP, `c2 - c1` points back the way the path came, and the
        // tangent it yields doubles the path over the well — MEASURED as 4 crossings at every
        // setback. An arc sweeping past a half-turn is that flipped configuration's signature.
        if (Math.abs(s1) > Math.PI || Math.abs(s2) > Math.PI) return null;
        join = [
          back.p,
          ...arcTo(c1, angOf(c1, back.p), s1),
          t2,
          ...arcTo(c2, angOf(c2, t2), s2),
        ];
      }
      join.push(fwd.p);
      // A chain of CHORDS across its own arc leaves vertices sitting exactly at `margin` with
      // every chord sagging inside it — MEASURED as near misses of 0.03–0.28 m with zero
      // crossings. Invariant 8: lift onto the tangent polygon, not the margin circle.
      const held = lift(join);
      if (!held) return null;
      return {
        back: back.i,
        fwd: fwd.i,
        held,
        // Only the join is new; the two stretches it is spliced onto were verified already, so
        // the well tests run over it plus one segment of context at each end.
        stretch: [
          cur[back.i],
          ...held,
          ...(cur[fwd.i + 1] ? [cur[fwd.i + 1]] : []),
        ],
      };
    };

    // ⭐ The setback grows until a turn seats AND clears, then is BISECTED back to the smallest
    // one that still does. Both tests ease as the fold opens, so the boundary is where the legs
    // are just `2·radius` apart — the deepest reach, and where the straight between the two arcs
    // vanishes into a clean U. Stepping alone overshot it badly: ×1.4 steps landed at a 414 m
    // setback where the legs were 310 m apart, leaving a 230 m straight shot across the fold.
    type Seated = { back: number; fwd: number; held: Vec2[]; stretch: Vec2[] };
    let best: Seated | null = null;
    let bestAt = 0;
    let seated = 0;
    let bestClearance = -1;
    let bestCrossings = -1;
    const attempt = (s: number): Seated | null => {
      const c = corner(s);
      if (!c) return null;
      seated++;
      const v = verify(c.stretch);
      if (v.ok) return c;
      if (v.clearance > bestClearance) {
        bestClearance = v.clearance;
        bestCrossings = v.crossings;
      }
      return null;
    };
    let lo = 0;
    for (let s = radius / 2; ; s *= 1.4) {
      if (s > room) s = room;
      const c = attempt(s);
      if (c) {
        best = c;
        bestAt = s;
        break;
      }
      lo = s;
      if (s >= room) break;
    }
    if (best) {
      for (let i = 0; i < 16 && bestAt - lo > Math.max(0.5, radius / 40); i++) {
        const mid = (lo + bestAt) / 2;
        const c = attempt(mid);
        if (c) {
          best = c;
          bestAt = mid;
        } else {
          lo = mid;
        }
      }
    }
    const cut = best
      ? dedupePolyline2D(
          [
            ...cur.slice(0, best.back + 1),
            ...best.held,
            ...cur.slice(best.fwd + 1),
          ],
          1e-6,
        )
      : null;
    if (!cut) {
      // ⛔ A cusp with less leg than the turn needs cannot be repaired in place — the search has
      // just proved it — so the curve ends before it instead of shipping a needle. A U of this
      // radius needs about two radii either side, and `radius` is the CUSP radius (a few tenths of
      // a metre at small margin), so at most that much curve is dropped. ⚠️ The committed code did
      // this far more bluntly, at a fixed 40 m, silently truncating ANY cusp within 40 m of
      // an end. This is the same rule, bounded to the scale of the turn that actually failed.
      if (room < 2 * radius) {
        cur =
          arc[k] <= arc[cur.length - 1] - arc[k]
            ? cur.slice(k)
            : cur.slice(0, k + 1);
        if (cur.length < 2) {
          throw new Error(
            `oneSidedOffset: the ${side} curve is a single cusp with no followable stretch either side of it`,
          );
        }
        continue;
      }
      const why =
        seated === 0
          ? `no turn seats between its legs`
          : `every one of the ${seated} turns that seated hits the well (best clearance ${bestClearance.toFixed(2)} m, ${bestCrossings} crossing(s))`;
      throw new Error(
        `oneSidedOffset: the ${side} curve reverses ${((worst.turn * 180) / Math.PI).toFixed(0)}° at a fold it cannot turn out of at ${radius.toFixed(1)} m — ${why} within ${room.toFixed(0)} m of setback`,
      );
    }
    cur = cut;
  }
  throw new Error(
    `oneSidedOffset: the ${side} curve still kinks after 64 cusp cuts — the fold structure is not resolving`,
  );
};

/** Widest separation between any two hull vertices. */
/**
 * The widest separation between any two vertices of a convex ring.
 *
 * @group Utils
 */
export const hullDiameter = (hull: Vec2[]): number => {
  let d = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      d = Math.max(
        d,
        Math.hypot(hull[j][0] - hull[i][0], hull[j][1] - hull[i][1]),
      );
    }
  }
  return d;
};

/**
 * The widest separation between any two points of a well's plan trace.
 *
 * ⭐ The one number that says whether a trace has a shape to follow at all. Compared against
 * `2 * margin`: below that, no cut holding `margin` can pass between any two parts of the trace,
 * so there is nothing to offset and the whole wellbore is a single obstacle.
 *
 * @group Utils
 */
export const planSpanOf = (well: Vec2[]): number => {
  const hull = convexHull2D(well);
  return hull.length >= 2 ? hullDiameter(hull) : 0;
};

/**
 * A convex polygon inflated by `d` — the boundary a cut wraps to get past an obstacle.
 *
 * ⭐ Inflating a CONVEX ring can never self-cross, so the result is still convex and still a
 * valid exclusion zone. Corners are mitered ({@link cornerChain}), so a near-degenerate sliver
 * hull no longer throws a spike many times `d` out from its sharp apex.
 *
 * @group Utils
 */
export const dilateConvex = (
  hull: Vec2[],
  d: number,
  miterLimit: number,
): Vec2[] => {
  const n = hull.length;
  if (n < 3 || !(d > 0)) return hull;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1];
  }
  const sign = area > 0 ? 1 : -1; // CCW ⇒ the outward normal is the right normal
  const edgeN = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [(sign * dz) / l, (-sign * dx) / l];
  };
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = hull[(i - 1 + n) % n];
    const cur = hull[i];
    const next = hull[(i + 1) % n];
    // Consecutive chains meet ON the translated edge, so the ring closes with no extra vertices.
    out.push(
      ...cornerChain(cur, edgeN(prev, cur), edgeN(cur, next), d, miterLimit),
    );
  }
  if (out.length < 3) {
    throw new Error(
      `dilateConvex: a ${n}-point hull inflated to ${out.length} points — it is degenerate`,
    );
  }
  return out;
};

/**
 * The pruned one-sided boundary of a well, split into the contiguous stretches that FOLLOW the
 * trajectory — before any fold is bridged.
 *
 * ⭐⭐ This is the exact, fast half of the offset: a raw offset (parallel walls + convex round
 * joins) pruned to the true Minkowski boundary with the segment index, then cut into runs
 * wherever a fold removed the middle. The runs hug the well at exactly `margin`; the gaps
 * BETWEEN them are the folds a caller must bridge. Exposed on its own so the follow can be
 * inspected and drawn independently of the (harder) bridging.
 *
 * ⛔ Throws when the well has no offset on this side at all — never returns the source.
 *
 * @group Utils
 */
export function computeOffsetRuns(
  well: Vec2[],
  side: FenceSideName,
  margin: number,
  options: OneSidedOffsetOptions = {},
): OffsetRuns {
  if (well.length < 2)
    throw new Error('computeOffsetRuns: well has < 2 points');
  if (!(margin > 0)) throw new Error('computeOffsetRuns: margin must be > 0');
  const tolerance = options.tolerance ?? DEFAULT_OFFSET_TOLERANCE;
  const miterLimit = options.miterLimit ?? 2;
  // Same guard, same wording as `oneSidedOffset` — otherwise a near-vertical well reports the
  // misleading "every candidate folded away" instead of naming what is actually wrong with it.
  const planSpan = planSpanOf(well);
  if (planSpan <= 2 * margin) {
    throw new Error(
      `computeOffsetRuns: the well is plan-degenerate — its whole footprint spans ${planSpan.toFixed(2)} m, inside a single ${margin} m margin corridor, so it has no boundary to follow`,
    );
  }
  const index = options.wellIndex ?? createPolylineIndex(well);

  // Obstacles (self-crossing loops) are treated as SOLID: the follow may not come within `margin`
  // of a hull, so BOTH sides break at the same boundary the transition wraps. The convex side then
  // wraps the outer bulge and the concave side the inner tangle — neither traces the self-crossing.
  // ⭐ Read as a DISTANCE to the hull, not containment in a grown polygon: a mitered zone stood up
  // to a whole margin outside the true one at a sharp corner, and switched shape as the corner's
  // angle crossed the miter limit (X13 between margins 1.1 and 1.2).
  // ⚠⚠ `oneSidedOffset` reads the SAME list with the same test; the gap indices reported below are
  // indices into it, so the two filters must stay in step.
  const hulls = (options.obstacles ?? []).filter(h => h.length >= 3);
  const zoneOf = hullsWithin(hulls, margin + tolerance);
  const inZone = hullsWithin(hulls, margin);
  const chordEnters = hullsWithin(hulls, margin - tolerance);

  // ⭐⭐ DENSIFY, never resample, TD→head. The trajectory is deliberately dense where it curves
  // and simplified by ANGLE where it is straight; that detail must survive, so every original
  // vertex is kept and intermediate points are added ONLY to segments longer than `step` — which
  // by construction are the straight ones. Without this fill a long straight reads as one huge
  // boundary jump, indistinguishable from a fold; with it, a jump can mean one thing only, a
  // PRUNED stretch. Terminal depth first, so the clean end anchors the walk. `step` is tied to
  // the fold scale (half a margin), floored and capped, never a bare constant.
  const step = offsetStep(margin);
  // ⭐ The well INSIDE an obstacle hull is degenerate and never measured (THE ONE RULE), and every
  // offset of it lands inside the grown hull and is pruned — so its vertices only cost candidates.
  // Each inside stretch is kept as its two end vertices: the chord between them lies inside the
  // convex hull, so its offsets are swallowed exactly as the vertices' were.
  const inside =
    hulls.length > 0
      ? well.map(p => hulls.findIndex(h => pointInConvex(p, h)))
      : null;
  const reversed: Vec2[] = [];
  for (let j = well.length - 1; j >= 0; j--) {
    if (
      inside &&
      inside[j] >= 0 &&
      j > 0 &&
      j < well.length - 1 &&
      inside[j - 1] === inside[j] &&
      inside[j + 1] === inside[j]
    ) {
      continue;
    }
    reversed.push(well[j]);
  }
  const traj: Vec2[] = [[reversed[0][0], reversed[0][1]]];
  for (let i = 1; i < reversed.length; i++) {
    const a = reversed[i - 1];
    const b = reversed[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > step) {
      const n = Math.ceil(len / step);
      for (let k = 1; k < n; k++) {
        traj.push([
          a[0] + ((b[0] - a[0]) * k) / n,
          a[1] + ((b[1] - a[1]) * k) / n,
        ]);
      }
    }
    traj.push([b[0], b[1]]);
  }
  const m = traj.length;
  // A head→TD side lies on the OPPOSITE hand of the reversed tangent, so the sign flips here.
  const sideSign = -sideNormalSign(side);

  const dir: Vec2[] = [];
  for (let k = 0; k + 1 < m; k++) {
    dir.push(unit(traj[k + 1][0] - traj[k][0], traj[k + 1][1] - traj[k][1]));
  }
  const offsetDir = (k: number): Vec2 => {
    const n = leftNormal2D(dir[k][0], dir[k][1]);
    return [sideSign * n[0], sideSign * n[1]];
  };
  const trajArc = polylineArcLengths(traj);
  // ⛔ THE ONE RULE at the source: a candidate offset FROM the degenerate well is never followed,
  // wherever its miter puts it. A corner candidate stands up to `miterLimit · margin` off its vertex,
  // past the rounded zone; kept, it strung a run round X12's TD hook at margin 4 (a 60° reversal).
  const onHull = hullsWithin(hulls, tolerance);
  const sourceHull = traj.map(p => (hulls.length > 0 ? onHull(p) : -1));

  type Cand = { p: Vec2; v: number; arc: number };
  const cands: Cand[] = [];
  for (let k = 0; k + 1 < m; k++) {
    const od = offsetDir(k);
    if (k > 0) {
      const cross = dir[k - 1][0] * dir[k][1] - dir[k - 1][1] * dir[k][0];
      // Turning AWAY from the offset side opens a gap — mitered, never rounded.
      if (cross * sideSign < 0) {
        for (const p of cornerChain(
          traj[k],
          offsetDir(k - 1),
          od,
          margin,
          miterLimit,
        )) {
          cands.push({ p, v: k, arc: trajArc[k] });
        }
      }
    }
    cands.push({
      p: [traj[k][0] + od[0] * margin, traj[k][1] + od[1] * margin],
      v: k,
      arc: trajArc[k],
    });
    cands.push({
      p: [traj[k + 1][0] + od[0] * margin, traj[k + 1][1] + od[1] * margin],
      v: k + 1,
      arc: trajArc[k + 1],
    });
  }

  // Keep only candidates at the TRUE boundary: nothing else of the well is nearer than `margin`.
  const hit = { point: [0, 0] as Vec2, distance: 0, along: 0 };
  const kept: Cand[] = [];
  // ⭐⭐ Which blocker swallowed which stretch. The gap between two runs IS the stretch the
  // blocker removed, so the obstacle a transition must wrap is known HERE and nowhere else.
  const swallowed: Array<{ arc: number; blocker: number }> = [];
  const minSpacing = Math.max(0.02 * margin, 1e-4);
  for (const c of cands) {
    if (hulls.length > 0) {
      const bi = sourceHull[c.v] >= 0 ? sourceHull[c.v] : zoneOf(c.p);
      if (bi >= 0) {
        swallowed.push({ arc: c.arc, blocker: bi });
        continue;
      }
    }
    const near = nearestOnIndexedPolyline(index, c.p[0], c.p[1], hit);
    if (!near) continue;
    // ⭐⭐ STRICT prune. Anything more than `tolerance` inside the margin is NOT on the true
    // boundary — it is either a fold (a distant part of the well is near) or a bend tighter than
    // the margin, and BOTH must break the run so the gap becomes a bridge. A per-vertex sagitta
    // slack here was keeping folded points, which then crossed when snapped out. The densified
    // sampling keeps a genuine concave dip under `tolerance`, so nothing valid is lost.
    if (near.distance < margin - tolerance) continue;
    // ⭐⭐ AT LEAST margin, NEVER less. A surviving point at most `tolerance` inside is snapped
    // radially onto the margin circle of its nearest well point, so the cut buries the well
    // NOWHERE. A convex or straight point already at/beyond margin is left free to stand off more.
    let p = c.p;
    if (near.distance < margin && near.distance > 1e-6) {
      const s = margin / near.distance;
      p = [
        near.point[0] + (c.p[0] - near.point[0]) * s,
        near.point[1] + (c.p[1] - near.point[1]) * s,
      ];
    }
    const last = kept[kept.length - 1];
    if (last && Math.hypot(p[0] - last.p[0], p[1] - last.p[1]) < minSpacing) {
      continue;
    }
    kept.push({ p, v: c.v, arc: c.arc });
  }
  if (kept.length < 2) {
    throw new Error(
      `computeOffsetRuns: the well has no ${side} offset at margin ${margin} — every candidate folded away`,
    );
  }

  // ⭐⭐ Split ONLY where the SOURCE ARC jumps — a stretch of the well was pruned, i.e. a real
  // fold. Because the walk is uniformly sampled, a long straight advances by one `step` per
  // survivor, so it never triggers; only a removed stretch does. Euclidean distance cannot tell
  // the two apart (a long straight and a fold both jump in space), which was the whole bug.
  const splitAt = step * 2.5;
  // ⭐⭐ An arc threshold alone cannot see every fold. `step` is capped at 4 m, so `splitAt`
  // saturates at 10 m and stops tracking the margin: at margin 8 a blocker swallowed a stretch
  // SHORTER than that, no split happened, and the chord across it cut 0.68 m inside the frame —
  // a silently bad cut, which is worse than a throw. A chord that ENTERS A ZONE is a fold by
  // definition, whatever its arc length, so the zone gets the casting vote.
  const blockerFor = (lo: number, hi: number): number | null => {
    const tally = new Map<number, number>();
    for (const s of swallowed) {
      if (s.arc > lo && s.arc < hi) {
        tally.set(s.blocker, (tally.get(s.blocker) ?? 0) + 1);
      }
    }
    let best: number | null = null;
    let bestN = 0;
    for (const [b, n] of tally) {
      if (n > bestN) {
        bestN = n;
        best = b;
      }
    }
    return best;
  };
  const allRuns: Vec2[][] = [];
  const allGaps: (number | null)[] = [];
  let run: Vec2[] = [kept[0].p];
  for (let i = 1; i < kept.length; i++) {
    const jumped = kept[i].arc - kept[i - 1].arc > splitAt;
    const k = hulls.length > 0 ? chordEnters(kept[i - 1].p, kept[i].p) : -1;
    const entered = k >= 0 ? k : null;
    if (jumped || entered !== null) {
      allRuns.push(run);
      allGaps.push(blockerFor(kept[i - 1].arc, kept[i].arc) ?? entered);
      run = [];
    }
    run.push(kept[i].p);
  }
  allRuns.push(run);
  // ⭐⭐ De-loop each run. The prune holds every point ≥ margin from the WELL, but at a concave
  // corner the two offset walls cross each other while both stay clear of the well — a distance
  // test cannot see that. Snipping each such loop to its crossing point (which lies exactly on
  // the margin, so clearance is unharmed) is what keeps the FOLLOW simple. Cross-run and bridge
  // crossings are handled separately; this is the local, within-run cleanup only.
  // ⭐⭐ Then HOLD MARGIN ON THE CHORDS, not just the vertices: a concave chord between two
  // on-margin points dips slightly inside. Where a segment midpoint reads under margin, insert a
  // midpoint snapped back onto the margin. Each pass quarters the remaining dip, so this is
  // repeated until nothing dips — a SINGLE pass was leaving 0.0125 m at margin 40 (candidate
  // spacing 4 m on a radius-40 curve sags 0.05 m), which the final clearance gate then rejected.
  // ⭐⭐ Then HOLD MARGIN ON THE CHORDS, not just the vertices: a concave chord between two
  // on-margin points dips slightly inside. ⛔ The exemption is THE ONE RULE — a chord whose
  // nearest well point lies inside an obstacle frame reads as buried however many midpoints are
  // inserted, because the dip is against the degenerate loop; the grown hull already holds the
  // margin there and the transition wraps it. Left in, this never converged on F-14.
  const holdChords = (r: Vec2[]): Vec2[] =>
    holdPolylineChords2D(r, index, margin, {
      exempt: hulls.length > 0 ? p => zoneOf(p) >= 0 : undefined,
      blocked:
        hulls.length > 0
          ? (a, p, b) => inZone(a, p) >= 0 || inZone(p, b) >= 0
          : undefined,
      label: `computeOffsetRuns: the ${side} run`,
    });
  const runs: Vec2[][] = [];
  const gaps: (number | null)[] = [];
  // A discarded fragment takes its incoming gap with it, so the surviving runs stay paired with
  // the obstacle that actually opened the space between them.
  let carry: number | null = null;
  for (let i = 0; i < allRuns.length; i++) {
    const gapIn = i > 0 ? allGaps[i - 1] : null;
    const gapOut = i < allGaps.length ? allGaps[i] : null;
    // ⛔⛔ A run bracketed by the SAME blocker on both sides lies INSIDE that obstacle's frame:
    // it is offset from the degenerate trajectory (the loop), not from a followable stretch, and
    // it only escaped the grown hull because the hull under-covers the fold. Following it would
    // be reasoning about the one region that must never be reasoned about. The ring stands in
    // for it, so it is discarded and its two gaps become one wrap.
    const insideFrame = gapIn !== null && gapIn === gapOut;
    const cleaned =
      allRuns[i].length >= 3 ? removePolylineLoops(allRuns[i]) : allRuns[i];
    const r = holdChords(cleaned);
    const incoming: number | null = carry !== null ? carry : gapIn;
    if (insideFrame || r.length < 2) {
      carry = incoming;
      continue;
    }
    if (runs.length > 0) gaps.push(incoming);
    runs.push(r);
    carry = null;
  }
  if (runs.length === 0) {
    throw new Error(
      `computeOffsetRuns: the ${side} boundary shattered into single points at margin ${margin}`,
    );
  }
  return { runs, gaps, splitAt, boundary: kept.length };
}

/**
 * Cut a core built on a run-on trace back to the block: at the point nearest each given
 * block end, moved OUTWARD past any rod straddling it (at the TD, inward past one bending back).
 *
 * ⛔ Never through a rod: cut back mid-span, F-11 A's cropped rod ended 114 m off the axis.
 * ⭐ At the TD, a rod that bends back — its far end not ahead of the block end along its own start —
 * is cut BEFORE instead: kept whole round F-12's hook at 2000 m (margins 18–20), the core ended
 * 47–92 m off the TD on the returning leg and the TD arm turned 53–75° to leave it.
 *
 * @param ends the block trace's first / last point, for each end that was run on
 * @param rods the connectors spliced into the core (`OneSidedOffset.transitions[].seam`)
 *
 * @group Geometries
 */
export function trimFenceCore(
  core: Vec2[],
  ends: { head?: Vec2; td?: Vec2 },
  rods: Vec2[][] = [],
): Vec2[] {
  if (core.length < 2 || (!ends.head && !ends.td)) return core;
  const arcs = polylineArcLengths(core);
  const along = (p: Vec2) => nearestOnPolyline(core, p[0], p[1])?.along ?? 0;
  const spans = rods
    .filter(r => r.length >= 2)
    .map(r => {
      const a = along(r[0]);
      const b = along(r[r.length - 1]);
      return { from: Math.min(a, b), to: Math.max(a, b), rod: r };
    });
  const bendsBack = (r: Vec2[], p: Vec2) => {
    const z = r[r.length - 1];
    return (
      (r[1][0] - r[0][0]) * (z[0] - p[0]) + (r[1][1] - r[0][1]) * (z[1] - p[1]) <=
      0
    );
  };
  // rods can abut, so step on until none straddles the cut
  const clearOfRods = (at: number, end: Vec2, head: boolean): number => {
    const done = new Set<number>();
    for (let moved = true; moved; ) {
      moved = false;
      spans.forEach((s, k) => {
        if (done.has(k) || !(s.from < at - 1e-9 && at < s.to - 1e-9)) return;
        done.add(k);
        at = head || bendsBack(s.rod, end) ? s.from : s.to;
        moved = true;
      });
    }
    return at;
  };
  const from = ends.head ? clearOfRods(along(ends.head), ends.head, true) : 0;
  const to = ends.td
    ? clearOfRods(along(ends.td), ends.td, false)
    : arcs[arcs.length - 1];
  if (!(to > from)) return core;
  const out: Vec2[] = [pointAtArcLength(core, arcs, from)];
  for (let i = 0; i < core.length; i++) {
    if (arcs[i] > from && arcs[i] < to) out.push(core[i]);
  }
  out.push(pointAtArcLength(core, arcs, to));
  return dedupePolyline2D(out, 1e-9);
}

/**
 * The one-sided offset of an open polyline at a fixed clearance — the corridor boundary a
 * fence cut follows.
 *
 * ⭐⭐ THE APPROACH: a raw offset (parallel walls + round joins at convex corners) is generated,
 * then every candidate whose TRUE nearest-well distance is less than `margin` is pruned with the
 * segment index — the exact Minkowski boundary, in O(n log n), never O(n²). Where a concave fold
 * is narrower than `2·margin` the walls prune away and leave a gap; the gap is closed by a STIFF
 * ROD (`stiff-rod.ts`) settled round the fold's grown convex hull, or straight across when nothing
 * lies between the runs. Never a fitted arc the path must conform to.
 *
 * ⭐⭐ It is NOT a shortest path. The boundary is defined locally, at exactly `margin` from the
 * well, so it follows the trajectory everywhere hugging is possible and bridges ONLY the folds
 * too narrow to enter. It can never wrap the well inside a fold, which a length-minimising
 * geodesic can.
 *
 * ⭐ Traversed TD→head internally: terminal depth is near-planar and clean, the head carries the
 * zig-zags, folds and loops, so anchors form in the clean region and the residual lands at the head.
 *
 * ⛔ NO SILENT FALLBACK. If a fold cannot be bridged clear of the well, or the finished curve
 * fails the clearance or simplicity gate, this THROWS naming the failure — it never returns a
 * degraded curve the caller cannot distinguish from a good one.
 *
 * @param well the wellbore footprint in plan, HEAD→TD order
 * @param side which side of the HEAD→TD tangent the offset lies on
 * @param margin the clearance to hold, in metres
 *
 * @group Utils
 */
export function oneSidedOffset(
  well: Vec2[],
  side: FenceSideName,
  margin: number,
  options: OneSidedOffsetOptions = {},
): OneSidedOffset {
  if (well.length < 2) throw new Error('oneSidedOffset: well has < 2 points');
  if (!(margin > 0)) throw new Error('oneSidedOffset: margin must be > 0');

  const tolerance = options.tolerance ?? DEFAULT_OFFSET_TOLERANCE;
  const sharpTurn = options.sharpTurn ?? (30 * Math.PI) / 180;
  const sharpArm = options.sharpArm ?? 10;
  const maxRelativeTurn = options.maxRelativeTurn ?? (45 * Math.PI) / 180;
  const rodStiffness = Math.max(0, options.rodStiffness ?? 1);
  const cuspRadius = Math.max(1.0001, options.cuspTurnFactor ?? 3) * margin;
  const index = options.wellIndex ?? createPolylineIndex(well);
  const obstacles = options.obstacles ?? [];

  // ⭐⭐ PLAN-DEGENERATE WELL — the whole trace fits inside ONE margin corridor. A near-vertical
  // hole moves a metre or two in XZ over a kilometre of hole, so its projection carries no
  // reliable direction at all: there is no stretch to follow and no meaningful two sides. The
  // whole wellbore is then one obstacle, and the cut is a walk round its inflated hull — but
  // WHERE that walk starts and ends is set by the run-out arms reaching in from the field
  // boundary, which do not exist yet. Refuse, by name, rather than invent an axis.
  // ⛔ `2 * margin` is not a tuned constant: below it no cut holding `margin` can pass between
  // any two parts of the trace, so nothing can be followed. It predicts the observed failures
  // exactly — F-11 (hull 1.4 m) from margin 0.7 up, F-7 (hull 79 m) at margin 40.
  const wholeSpan = planSpanOf(well);
  if (wholeSpan <= 2 * margin) {
    throw new Error(
      `oneSidedOffset: the well is plan-degenerate — its whole footprint spans ${wholeSpan.toFixed(2)} m, inside a single ${margin} m margin corridor. The entire wellbore is one obstacle, to be framed whole as its head (\`planFenceHead\`).`,
    );
  }

  const { runs: solid, gaps } = computeOffsetRuns(well, side, margin, {
    ...options,
    wellIndex: index,
  });
  const hit = { point: [0, 0] as Vec2, distance: 0, along: 0 };

  // ⭐⭐ The exclusion ZONES: the points within `margin` of each obstacle hull. Whatever the well
  // does INSIDE a zone is DEGENERATE — folded, looped, self-crossing — and no distance to it is a
  // fact about where the cut may go. The zone boundary stands in for it: it already holds the
  // margin, so keeping off the hull IS the constraint there. Every measurement and every gate below
  // therefore reads the well OUTSIDE the zones, kept as the contiguous pieces between them.
  // ⭐ A zone is a DISTANCE, never a polygon: the one definition the prune, the run ends, the rod
  // and the gates all read. ⚠⚠ Same filter and test as `computeOffsetRuns`, so `gaps` indexes it.
  const solidHulls = obstacles.filter(h => h.length >= 3);
  const zoneOf = hullsWithin(solidHulls, margin + tolerance);
  /** strictly inside a zone — where no construction may put a point */
  const inZone = hullsWithin(solidHulls, margin);
  /** the signed distance from `p` to the hull's margin — negative inside its zone */
  const beyond = (p: Vec2, hull: Vec2[]) =>
    convexSignedDistance(p, hull).distance - margin;
  // ⭐⭐ The PATH a rod is seeded along: each hull grown by `margin` with no corner turning more than
  // θ = maxRelativeTurn / 2 — the rounded zone boundary to within 2% of the margin. It is also what
  // the story draws as the zone, and its diameter sets the rod's atom.
  const theta = maxRelativeTurn / 2;
  const rodAnchor: StiffRodAnchor = {
    scale: Math.max(0, options.rodAnchor?.scale ?? 1),
    byEnd: options.rodAnchor?.byEnd,
    balanced: options.rodAnchor?.balanced,
  };
  const walkZones = solidHulls.map(h => zoneRing(h, margin, maxRelativeTurn));
  // Each reliable piece keeps the arc it started at, so an arc along the whole well is still
  // addressable without ever asking the degenerate stretch where it is.
  // ⭐ A piece runs right up to the zone, ending where the well enters it: cut at its last vertex
  // outside, the segment on into the zone was nobody's, and a rod slipped between a stub of well
  // outside a hull corner and the hull itself (X07 left at margin 1: 6 contacts, 32°).
  const outside: Array<{ index: PolylineIndex; arc0: number }> = [];
  if (solidHulls.length > 0) {
    const cross = (p: Vec2, q: Vec2, k: number, entering: boolean) =>
      marginCrossings([p, q], solidHulls[k], margin + tolerance).crossings.find(
        c => c.entering === entering,
      );
    let piece: Vec2[] = [];
    let start = 0;
    let prevZone = -1;
    for (let j = 0; j < well.length; j++) {
      const k = zoneOf(well[j]);
      if (k >= 0) {
        if (piece.length > 0) {
          const c = cross(well[j - 1], well[j], k, true);
          if (c) piece.push(c.point);
        }
        if (piece.length >= 2) {
          outside.push({ index: createPolylineIndex(piece), arc0: start });
        }
        piece = [];
      } else {
        if (piece.length === 0) {
          const c =
            j > 0 && prevZone >= 0
              ? cross(well[j - 1], well[j], prevZone, false)
              : undefined;
          if (c) piece.push(c.point);
          start = c ? index.arc[j - 1] + c.arc : index.arc[j];
        }
        piece.push(well[j]);
      }
      prevZone = k;
    }
    if (piece.length >= 2) {
      outside.push({ index: createPolylineIndex(piece), arc0: start });
    }
    if (outside.length === 0) {
      throw new Error(
        `oneSidedOffset: every well vertex on the ${side} side lies inside an obstacle zone at margin ${margin} — nothing reliable is left to measure against`,
      );
    }
  }
  // The indices a gate may read: the reliable pieces, or the whole well when nothing is excluded.
  const reliable: PolylineIndex[] =
    outside.length > 0 ? outside.map(o => o.index) : [index];

  /**
   * Whether a path ENTERS a zone: any point of it nearer a hull than `margin - slack`. ⛔ THE ONE
   * RULE, applied to verification: the zone stands in for the degenerate well inside it, so a path
   * through the zone is a path through the well — measuring only against the reliable pieces let
   * `cutCusps` splice a repair straight across a head hull.
   *
   * ⛔ Chords, not only vertices: two feasible vertices on opposite flanks of a hull have a chord
   * straight through it, and a rod round an 85 m wedge at 90° shipped exactly that.
   */
  const entersZone = (path: Vec2[], slack: number = tolerance): boolean =>
    zoneEntries(path, slack, true).length > 0;
  /**
   * The nearest point of every chord of `path` that comes nearer a hull than `margin - slack`, or
   * just the first when `firstOnly`.
   */
  const zoneEntries = (
    path: Vec2[],
    slack: number = tolerance,
    firstOnly = false,
  ): Vec2[] => {
    const out: Vec2[] = [];
    const near = hullsWithin(solidHulls, margin - slack);
    // a chord is never nearer the hull than its ends, so the chords cover the vertices
    const chords: Array<[Vec2, Vec2]> =
      path.length === 1
        ? [[path[0], path[0]]]
        : path.slice(1).map((b, i) => [path[i], b]);
    for (const [a, b] of chords) {
      const k = near(a, b);
      if (k < 0) continue;
      out.push(segmentConvexNearest(a, b, solidHulls[k]).onSegment);
      if (firstOnly) return out;
    }
    return out;
  };

  /** Closest approach to the RELIABLE well, and where — whole-well arc and the point itself. */
  const outsideNearest = (
    p: Vec2,
  ): { distance: number; arc: number; point: Vec2 } => {
    let best = { distance: Infinity, arc: 0, point: p };
    if (outside.length === 0) {
      const n = nearestOnIndexedPolyline(index, p[0], p[1], hit);
      return n
        ? { distance: n.distance, arc: n.along, point: [...n.point] as Vec2 }
        : best;
    }
    for (const o of outside) {
      const n = nearestOnIndexedPolyline(o.index, p[0], p[1], hit);
      if (n && n.distance < best.distance) {
        best = {
          distance: n.distance,
          arc: o.arc0 + n.along,
          point: [...n.point] as Vec2,
        };
      }
    }
    return best;
  };
  const outsideClearance = (path: Vec2[]): number => {
    let d = Infinity;
    for (const oi of reliable) {
      d = Math.min(d, indexedClearance(oi, path, margin * 3));
    }
    return d;
  };
  /**
   * A constructed path with its interior vertices lifted onto the tangent polygon at `margin`,
   * or null when a vertex sits on the well itself and has no direction to be lifted along.
   *
   * ⭐ The lift is sized by the path's OWN longest segment: a chord subtending `seg / margin`
   * sags by the sagitta, so `1 / cos(θ/2)` is exactly what the CHORDS need to hold `margin`.
   */
  const liftOntoTangent = (path: Vec2[]): Vec2[] | null => {
    let maxSeg = 0;
    for (let i = 1; i < path.length; i++) {
      maxSeg = Math.max(
        maxSeg,
        Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]),
      );
    }
    const subtend = Math.min(Math.PI / 3, maxSeg / margin);
    const chordLift = 1 / Math.cos(subtend / 2);
    const out: Vec2[] = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      // The ends belong to the curve being joined; they already hold the margin.
      if (i === 0 || i === path.length - 1) {
        out.push(p);
        continue;
      }
      const near = outsideNearest(p);
      if (near.distance >= margin) {
        out.push(p);
        continue;
      }
      if (near.distance <= 1e-6) return null;
      const s = (margin * chordLift) / near.distance;
      out.push([
        near.point[0] + (p[0] - near.point[0]) * s,
        near.point[1] + (p[1] - near.point[1]) * s,
      ]);
    }
    return out;
  };

  /** The same test as the gates below, but reporting WHY so a failure can name itself. */
  const verifyOutside = (
    path: Vec2[],
    zoneSlack: number = tolerance,
  ): { ok: boolean; clearance: number; crossings: number } => {
    let clearance = Infinity;
    let crossings = 0;
    for (const oi of reliable) {
      clearance = Math.min(clearance, indexedClearance(oi, path, margin * 3));
      crossings += indexedCrossings(oi, path);
    }
    // A zone entry reads as a crossing: the ring stands in for the well it frames.
    if (entersZone(path, zoneSlack)) crossings++;
    return {
      ok: clearance >= margin - tolerance && crossings === 0,
      clearance,
      crossings,
    };
  };

  const transitions: TransitionDebug[] = options.debug ?? [];
  const firstTransition = transitions.length;
  // the obstacle the last rod rounded, and the arc along the curve where that rod ends
  let lastRod: { hull: Vec2[] | null; end: number } | null = null;
  // set once a rod lies wholly before `keep.head`: nothing further toward the head ships
  let stop = false;
  const arcOn = (p: Vec2) =>
    nearestOnIndexedPolyline(index, p[0], p[1], hit)?.along ?? 0;
  const keepHead = options.keep?.head ? arcOn(options.keep.head) : -Infinity;
  const keepTd = options.keep?.td ? arcOn(options.keep.td) : Infinity;

  /**
   * Settle the stiff rod for one transition and splice it into `merged`, whose seam — the ring
   * path from run A's clipped end to run B's, or just the two ends when nothing lies between the
   * runs — spans `seamStart..seamEnd`; `scale` is the ring the seam rounds (`lifted` empty and `D`
   * the gap for a join with no obstacle), `hull` the obstacle behind it and `next` the one behind
   * the next gap.
   */
  const finish = (
    merged: Vec2[],
    seamStart: number,
    seamEnd: number,
    scale: {
      atom: number;
      D: number;
      ends: [Vec2, Vec2];
      /** each clamp's path heading, read off the ring when the seam is too short to show it */
      flanks?: [Vec2 | null, Vec2 | null];
      hull: Vec2[] | null;
      next: Vec2[] | null;
      /** the hull this rod rounds — an obstacle's, or a fold's own local hull; none across a gap */
      own?: Vec2[];
    },
    entry: TransitionDebug,
    spacing: number = scale.atom,
  ): Vec2[] => {
    const what = scale.own
      ? `round a ${scale.D.toFixed(0)} m obstacle ring`
      : `across a ${scale.D.toFixed(1)} m gap`;
    const laid = seedStiffRod(
      merged,
      seamStart,
      seamEnd,
      scale.atom,
      theta,
      rodAnchor,
      scale.ends,
      (a, b) => outsideClearance([a, b]) >= margin - tolerance,
      scale.flanks,
      spacing,
    );
    entry.seed = laid.seed;
    entry.anchor = laid.anchor;
    entry.turn = laid.turn;
    // ⭐ A rod wholly outside the stretch that ships is never laid: the curve beyond it is dropped
    // instead (the walk is TD→head, so everything laid before it at the TD, everything after at the head).
    if (laid.seed.every(p => arcOn(p) > keepTd)) {
      transitions.length = firstTransition;
      lastRod = null;
      return merged.slice(seamEnd);
    }
    if (laid.seed.every(p => arcOn(p) < keepHead)) {
      transitions.pop();
      stop = true;
      return merged.slice(0, seamStart + 1);
    }
    const arcs = polylineArcLengths(merged);
    const overlap: [Vec2[], Vec2[]] | null =
      scale.hull &&
      scale.next &&
      laid.anchor[1] > arcs[merged.length - 1] - arcs[seamEnd]
        ? [scale.hull, scale.next]
        : scale.hull &&
            lastRod?.hull &&
            laid.anchor[0] > arcs[seamStart] - lastRod.end
          ? [lastRod.hull, scale.hull]
          : null;
    if (overlap) {
      throw new RodOverlapError(
        `oneSidedOffset: the ${side} stiff rod ${what} needs more run than lies between its ring and the ${overlap[0] === scale.hull ? 'next' : 'last'} one (anchors ${laid.anchor[0].toFixed(1)}/${laid.anchor[1].toFixed(1)} m)`,
        overlap,
      );
    }
    // ⭐ Held `margin` off every hull and every reliable well segment by distance — see
    // `stiff-rod-constrained.ts`. It touches them only where the rod presses.
    // ⭐ The bending length is never below the rod's own 8 atoms: a free rod across a 0.4 m gap at
    // margin 20 had λ = 0.8 m on 10 m chords, a taut string that put its whole turn on one vertex
    // (F-1/F-1 A/F-1 B/F-12, 57–95°).
    const bending =
      (((scale.own ? 1 : FREE_ROD_STIFFNESS) *
        rodStiffness *
        Math.max(scale.D, RING_ROD_ATOMS * scale.atom)) /
        laid.spacing) **
      2;
    const settled = settleRodConstrained(laid.seed, {
      obstacles:
        scale.own && !solidHulls.includes(scale.own)
          ? [...solidHulls, scale.own]
          : solidHulls,
      keepOut: reliable,
      hand: sideNormalSign(side),
      margin,
      bending,
      tolerance,
      trace: options.rodTrace,
    });
    let rod = settled.points;
    // recorded before the hold so a throwing build still shows the rod it settled
    entry.seam = rod;
    entry.contacts = settled.contacts;
    if (settled.contacts.length > laid.seed.length) {
      entry.failures = settled.contacts.map(c => ({
        point: c,
        reason: 'runaway',
      }));
      throw new Error(
        `oneSidedOffset: the ${side} stiff rod ${what} ran away: ${settled.contacts.length} contacts on ${laid.seed.length} seed vertices`,
      );
    }
    // ⛔ The settle holds LINEARISED lines, so a free vertex can rest a few mm inside the margin (F-4,
    // 19 B/S/BT2: 1.4–7.3 mm), which the chord hold — it only inserts midpoints — can never fix.
    rod = rod.map((p, i) => {
      if (i < 2 || i > rod.length - 3) return p;
      const near = outsideNearest(p);
      if (near.distance >= margin || near.distance <= 1e-6) return p;
      const s = margin / near.distance;
      return [
        near.point[0] + (p[0] - near.point[0]) * s,
        near.point[1] + (p[1] - near.point[1]) * s,
      ];
    });
    for (const index of reliable) {
      rod = holdPolylineChords2D(rod, index, margin, {
        // ⛔ Between the well and a ring the lift can cut into the ring: X08 at margin 1.9–2.1, 2 cm.
        blocked: (a, p, b) => inZone(a, p) >= 0 || inZone(p, b) >= 0,
        label: 'oneSidedOffset: stiff rod',
      });
    }
    rod = dedupePolyline2D(rod, tolerance);
    entry.seam = rod;
    const v = verifyOutside(rod);
    const failures: Array<{ point: Vec2; reason: string }> = [];
    for (let i = 1; i < rod.length; i++) {
      const chord = [rod[i - 1], rod[i]];
      const mid: Vec2 = [
        (rod[i - 1][0] + rod[i][0]) / 2,
        (rod[i - 1][1] + rod[i][1]) / 2,
      ];
      if (outsideClearance(chord) < margin - tolerance) {
        failures.push({ point: mid, reason: 'chord dips inside the margin' });
      }
      if (reliable.some(oi => indexedCrossings(oi, chord) > 0)) {
        failures.push({ point: mid, reason: 'crosses the well' });
      }
    }
    for (const p of zoneEntries(rod)) {
      failures.push({ point: p, reason: 'inside the ring' });
    }
    for (let i = 1; i + 1 < rod.length; i++) {
      const ux = rod[i][0] - rod[i - 1][0];
      const uz = rod[i][1] - rod[i - 1][1];
      const vx = rod[i + 1][0] - rod[i][0];
      const vz = rod[i + 1][1] - rod[i][1];
      const turn = Math.abs(Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz));
      if (turn > maxRelativeTurn) {
        failures.push({
          point: rod[i],
          reason: `turn ${((turn * 180) / Math.PI).toFixed(0)}°`,
        });
      }
    }
    const worst = polylineWorstTurn(rod);
    if (!v.ok || failures.length > 0) {
      // ⭐ A rod that only over-turns is re-laid finer, down to the seed's floor: F-15 D's head rod
      // wrapped 126° round the wellhead corner on 28 vertices at margin 0.1 (57°), 16° on 110.
      const finer = laid.spacing / 2;
      if (
        v.ok &&
        failures.every(f => f.reason.startsWith('turn ')) &&
        finer >= (scale.atom / 4) * (1 - 1e-9)
      ) {
        return finish(merged, seamStart, seamEnd, scale, entry, finer);
      }
      entry.failures = failures;
      const dips = failures.some(f => f.reason.startsWith('chord dips'));
      throw new Error(
        `oneSidedOffset: the ${side} stiff rod ${what} fails: clr ${v.clearance.toFixed(2)} x${v.crossings}${dips ? ' dips' : ''} turn ${((worst.turn * 180) / Math.PI).toFixed(0)}°${settled.converged ? '' : ' (not at rest)'}`,
      );
    }
    const upTo = polylineArcLengths([...merged.slice(0, laid.head), ...rod]);
    lastRod = { hull: scale.hull, end: upTo[upTo.length - 1] };
    return dedupePolyline2D(
      [...merged.slice(0, laid.head), ...rod, ...merged.slice(laid.tail)],
      tolerance,
    );
  };

  const connect = (
    a: Vec2[],
    b: Vec2[],
    blocker: number | null,
    nextBlocker: number | null,
  ): Vec2[] => {
    let A = a;
    let B = b;
    let E = A[A.length - 1];
    let S = B[0];
    // ⭐⭐ The hull is the one the PRUNE recorded for this gap — never re-derived from the run-end
    // geometry, which is guesswork a thin hull defeats. A blocked fold with no obstacle behind it
    // (`blocker === null`) frames its own local hull; an unobstructed fold that already clears
    // is joined by the same rod with no ring.
    let hull: Vec2[] | null = blocker !== null ? solidHulls[blocker] : null;
    let ring: Vec2[] | null = blocker !== null ? walkZones[blocker] : null;
    if (!hull) {
      // No obstacle behind this gap, so the well here is trustworthy — but a neighbouring zone's
      // interior still is not, so the frame is hulled from RELIABLE vertices only.
      const arcE = outsideNearest(E).arc;
      const arcS = outsideNearest(S).arc;
      if (outsideClearance([E, S]) < margin - tolerance) {
        const lo = Math.min(arcE, arcS) - margin;
        const hiArc = Math.max(arcE, arcS) + margin;
        const stretch: Vec2[] = [];
        for (let j = 0; j < well.length; j++) {
          if (
            index.arc[j] >= lo &&
            index.arc[j] <= hiArc &&
            zoneOf(well[j]) < 0
          ) {
            stretch.push(well[j]);
          }
        }
        if (stretch.length >= 3) {
          hull = convexHull2D(stretch);
          ring = zoneRing(hull, margin, maxRelativeTurn);
        }
      }
    }
    if (hull && ring && ring.length >= 3) {
      const nr = ring.length;
      // ⭐⭐ WHICH WAY ROUND THE RING. Derived, not searched: this file walks TD→head, while a
      // side is named for the HEAD→TD tangent, so a cut lies on the OPPOSITE hand of the TD→head
      // walk — which puts the well, and therefore the obstacle, on the other side of it. The
      // ring's interior must stay on that same hand, and a CCW walk keeps a convex interior on
      // the left. The run's own heading at `E` cannot be used — it points INTO the ring (that is
      // why the run ended there), so dotting it against a ring edge is ill-conditioned and picks
      // the long way round about half the time.
      let ringArea = 0;
      for (let i = 0; i < nr; i++) {
        const j = (i + 1) % nr;
        ringArea += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
      }
      const ccwDir = ringArea > 0 ? 1 : -1;
      const walkDir: 1 | -1 =
        sideNormalSign(side) > 0 ? ccwDir : ((-ccwDir | 0) as 1 | -1);
      // ⭐⭐ THE ROD. The transition is a STIFF ROD settled round the hull: its seed is the ring's
      // own boundary between the two run ends plus an anchored stretch of each run, and the settle
      // finds the least-bending path that holds the margin from the hull and the well, CHORDS
      // included (`stiff-rod-constrained.ts`). Only the ATOM `D / RING_ROD_ATOMS` carries a scale,
      // so a 3 m fold and a 500 m head get the same construction.
      // ⛔⛔ NO FILLETS, NO WALK. The hugging construction that preceded this — a departure fillet,
      // a one-vertex-per-atom walk, a landing fillet — failed on 17 of 36 corner-wedge cases:
      // its "small ring" shortcut joined two fillet ends straight through the hull (a chord from
      // boundary to boundary has no proper crossing), and a fillet whose tangent point fell on a
      // mitre fan turned by the hull's whole corner at the junction. Non-monotone in margin, and
      // every one of those failures was a rod that never got built.
      const D = hullDiameter(ring);
      const atom = ringAtom(D, margin);
      const own = hull;
      // ⭐ Each run is clipped to where it enters the zone — the point `margin` from the hull, exact
      // and continuous in the margin. The well INSIDE the hull is ignored entirely; the zone holds
      // the margin there, so the rod is judged only against the well OUTSIDE the zones.
      const edge = margin + tolerance;
      const within = (p: Vec2) => beyond(p, own) < tolerance;
      /** where the chord from `kept` (outside) to `dropped` (inside) enters the zone */
      const crossing = (kept: Vec2, dropped: Vec2): Vec2 | null => {
        const c = marginCrossings([kept, dropped], own, edge).crossings.find(
          x => x.entering,
        );
        return c && c.arc > tolerance ? c.point : null;
      };
      let droppedA: Vec2 | null = null;
      while (A.length > 2 && within(A[A.length - 1])) {
        droppedA = A[A.length - 1];
        A = A.slice(0, -1);
      }
      let droppedB: Vec2 | null = null;
      while (B.length > 2 && within(B[0])) {
        droppedB = B[0];
        B = B.slice(1);
      }
      // ⭐ The run ends ON the zone, not at its last vertex outside it: snapped to a vertex, the end
      // moved by a whole guide step when the trace's sampling changed (19 S at margin 0.1: 0.5 m)
      // and the anchors read off it tipped the rod past 45°.
      if (droppedA && !within(A[A.length - 1])) {
        const c = crossing(A[A.length - 1], droppedA);
        if (c) A = [...A, c];
      }
      if (droppedB && !within(B[0])) {
        const c = crossing(B[0], droppedB);
        if (c) B = [c, ...B];
      }
      E = A[A.length - 1];
      S = B[0];
      // ⭐ A run that stops SHORT of the zone — its last offset candidate fell just outside it — is
      // landed on it along its own heading. Only across a sampling gap: one candidate step.
      const reach = offsetStep(margin);
      const landOnZone = (end: Vec2, from: Vec2): Vec2 | null => {
        if (within(end)) return null;
        const dx = end[0] - from[0];
        const dz = end[1] - from[1];
        const len = Math.hypot(dx, dz);
        if (!(len > 1e-9)) return null;
        const far: Vec2 = [
          end[0] + (dx / len) * reach,
          end[1] + (dz / len) * reach,
        ];
        const c = marginCrossings([end, far], own, edge).crossings.find(
          x => x.entering,
        );
        return c && c.arc > tolerance ? c.point : null;
      };
      const landE = landOnZone(E, A[A.length - 2]);
      if (landE) {
        A = [...A, landE];
        E = landE;
      }
      const landS = landOnZone(S, B[1]);
      if (landS) {
        B = [landS, ...B];
        S = landS;
      }
      // Where each run end FOOTS on the walk ring: the edge nearest it — the ring stands within 2%
      // of the margin off the zone, so its edges are all short near a corner and none is a spike.
      const footEdge = (p: Vec2): number => {
        let bEdge = 0;
        let bd = Infinity;
        for (let k = 0; k < nr; k++) {
          const d = distanceToSegment2D(p, ring[k], ring[(k + 1) % nr]);
          if (d < bd) {
            bd = d;
            bEdge = k;
          }
        }
        return bEdge;
      };
      const eEdge = footEdge(E);
      const sEdge = footEdge(S);
      const edgeArc = [0];
      for (let k = 0; k < nr; k++) {
        const q0 = ring[k];
        const q1 = ring[(k + 1) % nr];
        edgeArc.push(edgeArc[k] + Math.hypot(q1[0] - q0[0], q1[1] - q0[1]));
      }
      const perimeter = edgeArc[nr];
      const arcOf = (p: Vec2, k: number) => {
        const q0 = ring[k];
        const q1 = ring[(k + 1) % nr];
        const ex = q1[0] - q0[0];
        const ez = q1[1] - q0[1];
        const l2 = ex * ex + ez * ez;
        const t = l2 > 0 ? ((p[0] - q0[0]) * ex + (p[1] - q0[1]) * ez) / l2 : 0;
        return edgeArc[k] + Math.max(0, Math.min(1, t)) * Math.sqrt(l2);
      };
      const ringAt = (s: number): Vec2 => {
        const u = ((s % perimeter) + perimeter) % perimeter;
        let k = 0;
        while (k + 1 < nr && edgeArc[k + 1] <= u) k++;
        const q0 = ring[k];
        const q1 = ring[(k + 1) % nr];
        const l = edgeArc[k + 1] - edgeArc[k];
        const t = l > 0 ? (u - edgeArc[k]) / l : 0;
        return [q0[0] + (q1[0] - q0[0]) * t, q0[1] + (q1[1] - q0[1]) * t];
      };
      const arcE = arcOf(E, eEdge);
      const arcS = arcOf(S, sEdge);
      // ⭐ The ring PATH: every walk-ring vertex strictly between the two footings in the walk
      // direction — the seed the rod settles from, on the right flank by construction. A vertex
      // within `margin` of the reliable well (an entry gap, where the well leaves the hull alongside
      // the ring) is pushed out onto the margin's tangent polygon; one that would land back inside
      // the zone marks a corridor narrower than the margin and is left out.
      const path: Vec2[] = [];
      {
        const first = walkDir > 0 ? (eEdge + 1) % nr : eEdge;
        const last = walkDir > 0 ? sEdge : (sEdge + 1) % nr;
        let count = (((((last - first) * walkDir) % nr) + nr) % nr) + 1;
        // how far round the ring S lies from E in the walk direction
        const ahead =
          ((((arcS - arcE) * walkDir) % perimeter) + perimeter) % perimeter;
        if (perimeter - ahead < atom) {
          // ⭐ S under one atom BEHIND E is the same point to the rod, and the step back is clear of
          // the zone; read as a lap round the ring it ran F-5 right away at margin 19.2 (0 → 36
          // path vertices, 179°) while both ends moved 0.1 m.
          count = 0;
        } else if (eEdge === sEdge) {
          // both feet on one edge: nothing between them, or the whole ring
          const p0 = ring[eEdge];
          const p1 = ring[(eEdge + 1) % nr];
          const ex = p1[0] - p0[0];
          const ez = p1[1] - p0[1];
          const tE = (E[0] - p0[0]) * ex + (E[1] - p0[1]) * ez;
          const tS = (S[0] - p0[0]) * ex + (S[1] - p0[1]) * ez;
          count = (tS - tE) * walkDir >= 0 ? 0 : nr;
        }
        const lift = 1 / Math.cos(Math.min(Math.PI / 3, atom / margin) / 2);
        for (let i = 0; i < count; i++) {
          const k = (((first + i * walkDir) % nr) + nr) % nr;
          const v = ring[k];
          const near = outsideNearest(v);
          if (near.distance >= margin) {
            path.push(v);
            continue;
          }
          if (near.distance <= 1e-6) continue;
          const s = (margin * lift) / near.distance;
          const pushed: Vec2 = [
            near.point[0] + (v[0] - near.point[0]) * s,
            near.point[1] + (v[1] - near.point[1]) * s,
          ];
          if (!within(pushed)) path.push(pushed);
        }
      }
      const traced = [E, ...path, S];
      let seamLength = 0;
      for (let i = 1; i < traced.length; i++) {
        seamLength += Math.hypot(
          traced[i][0] - traced[i - 1][0],
          traced[i][1] - traced[i - 1][1],
        );
      }
      const unitTo = (from: Vec2, to: Vec2): Vec2 | null => {
        const l = Math.hypot(to[0] - from[0], to[1] - from[1]);
        return l > 1e-9 ? [(to[0] - from[0]) / l, (to[1] - from[1]) / l] : null;
      };
      // ⭐ A seam under one atom shows no heading: its E→S chord reversed when S passed E and
      // mirrored φ (F-5 at margin 19.2: 37°/112° → 143°/68°, anchor A 50 → 244 m).
      const flanks: [Vec2 | null, Vec2 | null] | undefined =
        seamLength < atom
          ? [
              unitTo(E, ringAt(arcE + walkDir * atom)),
              unitTo(S, ringAt(arcS - walkDir * atom)),
            ]
          : undefined;
      const merged = [...A, ...path, ...B];
      const entry: TransitionDebug = {
        ring,
        traced,
        atom,
      };
      transitions.push(entry);
      return finish(
        merged,
        A.length - 1,
        A.length + path.length,
        {
          atom,
          D,
          ends: [E, S],
          flanks,
          hull: blocker !== null ? own : null,
          next: nextBlocker !== null ? solidHulls[nextBlocker] : null,
          own,
        },
        entry,
      );
    }
    // Nothing lies between the runs: the same rod with no ring, scaled by the gap it closes.
    const gap = Math.hypot(S[0] - E[0], S[1] - E[1]);
    const atom = ringAtom(gap, margin);
    const entry: TransitionDebug = { ring: [], traced: [E, S], atom };
    transitions.push(entry);
    return finish(
      [...A, ...B],
      A.length - 1,
      A.length,
      {
        atom,
        D: gap,
        ends: [E, S],
        hull: null,
        next: null,
      },
      entry,
    );
  };

  let curve = solid[0];
  let bridges = 0;
  for (let i = 1; i < solid.length; i++) {
    curve = connect(
      curve,
      solid[i],
      gaps[i - 1],
      i + 1 < solid.length ? gaps[i] : null,
    );
    bridges++;
    if (stop) break;
  }

  const joined = dedupePolyline2D(curve.reverse(), margin * 0.02);
  // ⭐ Only what ships is repaired and gated: a fold past the block's TD rejected F-1 C cut at
  // 1900 m (margins 2, 2.2), though the core was cut back before it.
  const kept = options.keep
    ? trimFenceCore(
        joined,
        options.keep,
        transitions.slice(firstTransition).map(t => t.seam ?? []),
      )
    : joined;

  // ⭐⭐ Cut the concave-side cusps out. This is the only stage that can: a cusp is created by two
  // runs meeting nose to nose across a pinched fold, and only the finished curve sees it.
  const points = cutCusps(
    kept,
    cuspRadius,
    maxRelativeTurn,
    tolerance,
    liftOntoTangent,
    verifyOutside,
    side,
  );

  // Gates. Clearance and simplicity are HARD — a breach throws. The smoothness metrics are
  // reported for the caller to judge; the following curvature legitimately tracks the well.
  // Clearance is measured against the RELIABLE well only — inside a zone the cut hugs the grown
  // hull boundary and the trajectory cannot be reasoned about.
  let clearance = Infinity;
  for (const oi of reliable) {
    clearance = Math.min(clearance, indexedClearance(oi, points, margin * 4));
  }
  if (clearance < margin - tolerance) {
    throw new Error(
      `oneSidedOffset: finished ${side} curve buries the well — clearance ${clearance.toFixed(3)} m < margin ${margin}`,
    );
  }
  const loops = countPolylineLoops(points);
  if (loops > 0) {
    throw new Error(
      `oneSidedOffset: finished ${side} curve self-intersects (${loops} loop(s))`,
    );
  }
  // ⛔ The ring stands in for the well inside it — a finished curve inside a zone has cut the well.
  if (entersZone(points)) {
    throw new Error(
      `oneSidedOffset: finished ${side} curve enters an obstacle zone at margin ${margin}`,
    );
  }
  // ⛔ `cutCusps` is supposed to have removed every one of these. Re-measuring here is what makes
  // that a guarantee rather than a hope — a cut that reintroduced a kink must not ship silently.
  const worstTurn = polylineWorstTurn(points);
  if (worstTurn.turn > maxRelativeTurn) {
    throw new Error(
      `oneSidedOffset: finished ${side} curve turns ${((worstTurn.turn * 180) / Math.PI).toFixed(1)}° at vertex ${worstTurn.index}, over the ${((maxRelativeTurn * 180) / Math.PI).toFixed(0)}° limit`,
    );
  }
  const metrics: OneSidedOffsetMetrics = {
    clearance,
    loops,
    minRadius: polylineMinRadius(points, 25),
    maxTurn: polylineMaxTurn(points, 25),
    worstTurn,
    sharp: polylineSharpEdges(points, sharpTurn, sharpArm).length,
    vertices: points.length,
  };
  return { points, bridges, transitions, metrics };
}
