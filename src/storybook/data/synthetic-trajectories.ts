/**
 * Synthetic wellbore trajectories with CONTROLLED defects in the plan (XZ) projection.
 *
 * ⭐⭐ Why these exist: every constant in the fence was calibrated on Volve, and a survey of the
 * four datasets we hold says Volve is the least representative of them. Plan-extent ÷ TVD is 0.46
 * on Volve and 2.08 on Troll (max 5.34, min 0.01 across all four) — a 500× spread that no absolute
 * length constant survives. Volve also contains NO plan turn above 120°, so the 150° reversal rule
 * effectively never fires there, and it has none of the deviated-section plan loops that appear in
 * Troll. Calibrating a detector on it over-fits to one field.
 *
 * ⭐ The controls are deliberately ORTHOGONAL rather than a gallery of named shapes: `featureSize`
 * and `mouth` set how deep and how open the defect is, and `at` slides the SAME defect from the
 * head to TD. A fixture set built this way tests the DECISIONS — "is this narrow enough to wrap",
 * "is this in the head or the deviated section" — instead of a handful of pictures.
 *
 * ⚠️ Coordinates are SCENE coordinates with the wellhead at the origin: `[x, y, z]`, y up (so
 * depth is negative), plan is XZ. Nothing here is or becomes a UTM position.
 */

import { Vec2, Vec3 } from '../../sdk';

/**
 * The plan-projection defect a trajectory is built around.
 *
 * ⚠️ A "hook" is not listed: a hook is a {@link SyntheticTrajectoryOptions.at} of ~0 on a `fold`,
 * which is what makes the placement control worth having.
 */
export type TrajectoryDefect =
  | 'none'
  | 'fold'
  | 'double-fold'
  | 'loop'
  | 'zigzag'
  | 'spiral'
  | 'vertical-knot';

/** Every defect, in a stable order — for story controls and test sweeps. */
export const TRAJECTORY_DEFECTS: TrajectoryDefect[] = [
  'none',
  'fold',
  'double-fold',
  'loop',
  'zigzag',
  'spiral',
  'vertical-knot',
];

/** {@link syntheticTrajectory} options. */
export type SyntheticTrajectoryOptions = {
  /** which plan defect to build in. Default `none`. */
  defect?: TrajectoryDefect;
  /** vertical section before the well starts building angle, in metres. Default 600. */
  kickoffDepth?: number;
  /** total vertical drop from the wellhead to TD, in metres. Default 2200. */
  totalDepth?: number;
  /** plan reach of the deviated section, in metres. Default 2500. */
  reach?: number;
  /** the defect's own scale — fold depth, loop diameter, zigzag amplitude — in metres. Default 400. */
  featureSize?: number;
  /**
   * How OPEN the defect is: its mouth as a fraction of {@link featureSize}.
   *
   * ⭐ This is the control that matters. Depth ÷ mouth is the dimensionless ratio that decides
   * whether a fold is a slot the cut must go around or an excursion it can follow, so sweeping
   * this — at a fixed size — is what shows where a detector's decision boundary really sits.
   * 1 is as deep as it is wide; 0.2 is nearly a loop; 3 is a gentle excursion.
   */
  mouth?: number;
  /**
   * Where the defect sits along the deviated section, 0 (at the kickoff) to 1 (at TD). Default 0.5.
   *
   * ⭐ 0 puts it in the head — a hook. Since depth follows plan arc, this also moves the defect
   * up and down the hole, which is what exercises a head-versus-deviated classifier.
   */
  at?: number;
  /**
   * Survey scatter, in metres. Default {@link DEFAULT_NOISE}.
   *
   * ⭐⭐ NOT cosmetic, and 0 is NOT the realistic value for a DRILLED well. A noiseless trajectory
   * is a mathematically smooth curve, so the plan trace — which is simplified by ANGLE — collapses
   * to a handful of vertices: MEASURED 38 vertices over 2510 m against 800–1500 on real wells of
   * the same length.
   *
   * ⚠️ 0 is still the right value for a PLANNED (undrilled) trajectory, which carries no survey
   * scatter at all. Downstream code must cope with both — anything that walks VERTICES rather than
   * arc reads a smooth trace as having no shape.
   */
  noise?: number;
  /** RNG seed — the same seed always gives the same trajectory. Default 1. */
  seed?: number;
  /** station spacing along the hole, in metres. Default 15. */
  spacing?: number;
  /**
   * Corner-cutting passes over the plan waypoints. Default 3.
   *
   * ⚠️ A real hole cannot be drilled with a corner in it, and the trace is splined again
   * downstream, so 0 is a STRESS TEST for a detector rather than a shape any well has. It matters
   * most for the zigzag, whose teeth are the smallest feature here and so the most rounded away.
   */
  smoothing?: number;
  /** plan drift of the vertical section, in metres. Default 8. */
  verticalDrift?: number;
  /**
   * Smooth directional changes the vertical section's drift makes over its whole length.
   * Default {@link DEFAULT_DRIFT_TURNS}.
   */
  driftTurns?: number;
  /** bearing of the deviated section's overall reach, in degrees. Default 0. */
  heading?: number;
  /** which hand the defect turns to. Default 1. */
  side?: 1 | -1;
};

type Resolved = Required<SyntheticTrajectoryOptions>;

/**
 * How many smooth directional changes the vertical section makes over its WHOLE length.
 *
 * ⭐ This is the shape of a real wandering hole, and it is a very LOW-FREQUENCY signal: it leans
 * one way, corrects once or twice, and that is all. White noise (or a walk advanced every station)
 * has the same footprint but changes direction every `spacing` metres, which gives the vertical
 * section far more curvature than any survey — measured at ~14 detected kinks against about one on
 * a real well. Expressing it as a COUNT rather than a wavelength keeps it right whatever
 * `kickoffDepth` is.
 */
const DEFAULT_DRIFT_TURNS = 2;

/**
 * Survey scatter, in metres — see {@link SyntheticTrajectoryOptions.noise}.
 *
 * ⭐ Chosen by matching REAL wells on two independent measures, not by eye. Over 2510 m, sweeping
 * noise gave trace vertices 38 / 825 / 1107 / 1356 at 0 / 0.25 / 0.5 / 1 m against 800–1500 on the
 * 26 Volve wells, and detected kinks 1.0 / 1.3 / 4.1 per well against a real 0.9.
 *
 * ⚠️ 0.5 and above is TOO MUCH: it drives the tightest kink radius to 0.91 m and then 0.51 m,
 * under the 1.44 m minimum anything real produces, so the fixtures would manufacture defects the
 * detector is supposed to be judged on.
 */
const DEFAULT_NOISE = 0.25;

/**
 * How far the drift's bearing may swing over the whole vertical section, in radians.
 *
 * ⚠️ Under a half turn by design. The bearing is what gets integrated, so a swing of π or more
 * lets the heading reverse and the plan path curls back on itself — which is the artefact this
 * replaced. 60° gives a hole that leans one way and corrects, and cannot double back.
 */
const DRIFT_SWING = (60 * Math.PI) / 180;

/** The same, for the `vertical-knot` defect, which is SUPPOSED to tangle. */
const DRIFT_KNOT_SWING = 6 * Math.PI;

/**
 * Fraction of the vertical section over which the drift's bearing turns into the well's own
 * heading, so the plan direction is CONTINUOUS at the kickoff.
 *
 * ⛔ Without this the two sections are generated independently and simply concatenated, so the
 * plan direction jumps by whatever angle separates them — up to a full reversal, which is a flip
 * no bit could drill. A real hole turns towards its target azimuth while it builds angle, over
 * hundreds of metres, and that is what this spreads the turn across.
 *
 * ⚠️ It does NOT remove the reversal itself, and must not: a vertical section that drifted away
 * from the target genuinely doubles back in plan, and that is a real detectable defect. This only
 * gives the turn a radius instead of a corner.
 */
const KICKOFF_TURN_FRACTION = 0.4;

/**
 * Radius (m) of the build arc that turns the hole off vertical — about a 3°/30 m dogleg.
 *
 * ⛔ The depth ramp used to be a SMOOTHSTEP in plan arc, whose slope at the kickoff is ZERO: plan
 * distance advanced while depth did not, so the trajectory went from vertical to horizontal in one
 * step. That is backwards — a build LEAVES vertical, where depth-per-plan-distance is infinite —
 * and in the elevation view it read as a flip no bit could drill.
 */
const BUILD_RADIUS = 500;

/**
 * The build arc may use at most this share of the depth, or of the plan length, the well has.
 *
 * ⚠️ Not a fallback: a shallower or shorter well genuinely has to build harder. It also keeps
 * the radius under both `drop` and `planLength`, which is what makes the solve below monotonic.
 */
const BUILD_MAX_SHARE = 0.5;

const DEFAULTS: Resolved = {
  defect: 'none',
  kickoffDepth: 600,
  totalDepth: 2200,
  reach: 2500,
  featureSize: 400,
  mouth: 1,
  at: 0.5,
  noise: DEFAULT_NOISE,
  seed: 1,
  spacing: 15,
  smoothing: 3,
  verticalDrift: 8,
  driftTurns: DEFAULT_DRIFT_TURNS,
  heading: 0,
  side: 1,
};

/** Deterministic RNG, so a seeded fixture is identical across runs and machines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 1D gradient (Perlin) noise over a lattice of unit cells.
 *
 * ⭐ Smooth BY CONSTRUCTION — the value and its slope are continuous at every lattice point — so
 * the feature length is the cell size and nothing finer exists. That is the property white noise
 * lacks: filtering white noise afterwards leaves whatever the filter missed, whereas here the
 * high frequencies were never generated.
 */
function gradientNoise1D(seed: number): (x: number) => number {
  const rng = mulberry32(seed);
  const size = 256;
  const gradients = new Float64Array(size);
  for (let i = 0; i < size; i++) gradients[i] = rng() * 2 - 1;
  // Perlin's quintic fade: zero first AND second derivative at the cell edges, so a curvature
  // measure does not see the lattice itself.
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const wrap = (i: number) => ((i % size) + size) % size;
  return (x: number) => {
    const cell = Math.floor(x);
    const t = x - cell;
    const g0 = gradients[wrap(cell)];
    const g1 = gradients[wrap(cell + 1)];
    const u = fade(t);
    return 2 * (g0 * t + u * (g1 * (t - 1) - g0 * t));
  };
}

/** Corner cutting — a drilled path has no corners, and a polyline of waypoints does. */
function chaikin(points: Vec2[], passes: number): Vec2[] {
  let out = points;
  for (let k = 0; k < passes; k++) {
    const next: Vec2[] = [out[0]];
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * One excursion off the base line: out `depth` to one side and back, with the two limbs `mouth`
 * apart. Depth ÷ mouth IS the ratio a wrap decision turns on, so both are explicit.
 */
function fold(x: number, depth: number, mouth: number, side: number): Vec2[] {
  const m = Math.max(mouth, 1);
  return [
    [x, 0],
    [x + m * 0.1, side * depth * 0.45],
    [x + m * 0.2, side * depth],
    [x + m * 0.8, side * depth],
    [x + m * 0.9, side * depth * 0.45],
    [x + m, 0],
  ];
}

/**
 * A plan self-crossing: a full turn plus an overlap, so the arc leaving the circle cuts back
 * across the straight run that entered it. A pure 360° arc would only touch itself.
 */
function loop(x: number, radius: number, side: number): Vec2[] {
  const out: Vec2[] = [];
  const cx = x;
  const cy = side * radius;
  const sweep = Math.PI * 2 + 0.7;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + side * sweep * (i / steps);
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return out;
}

/** A run of short alternating excursions — a fold defect at a scale a single vertex can carry. */
function zigzag(
  x: number,
  amplitude: number,
  mouth: number,
  side: number,
): Vec2[] {
  const out: Vec2[] = [[x, 0]];
  const teeth = 5;
  const step = Math.max(mouth, 1);
  for (let i = 0; i < teeth; i++) {
    const s = i % 2 === 0 ? side : -side;
    out.push([x + step * (i + 0.5), s * amplitude]);
    out.push([x + step * (i + 1), 0]);
  }
  return out;
}

/** A plan spiral: the trace keeps turning the same way and closes on itself repeatedly. */
function spiral(x: number, radius: number, side: number): Vec2[] {
  const out: Vec2[] = [];
  const turns = 2.4;
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = side * turns * Math.PI * 2 * u - Math.PI / 2;
    const r = radius * (0.25 + 0.75 * u);
    out.push([x + r * Math.cos(a), side * radius + r * Math.sin(a)]);
  }
  return out;
}

/** The deviated section's plan path, along +X before the heading rotation. */
function planWaypoints(o: Resolved): Vec2[] {
  const { reach, featureSize: F, side } = o;
  const mouth = Math.max(1, o.mouth * F);
  const at = Math.min(0.95, Math.max(0, o.at));
  const x0 = at * Math.max(0, reach - mouth);
  const head: Vec2[] = [
    [0, 0],
    [x0 * 0.5, 0],
  ];
  let feature: Vec2[] = [];
  switch (o.defect) {
    case 'fold':
      feature = fold(x0, F, mouth, side);
      break;
    case 'double-fold':
      feature = [
        ...fold(x0, F, mouth, side),
        ...fold(x0 + mouth * 1.4, F * 0.7, mouth * 0.7, -side),
      ];
      break;
    case 'loop':
      feature = loop(x0, F / 2, side);
      break;
    case 'zigzag':
      feature = zigzag(x0, F, mouth, side);
      break;
    case 'spiral':
      feature = spiral(x0, F / 2, side);
      break;
    default:
      feature = [[x0, 0]];
  }
  const tail = feature[feature.length - 1];
  return [...head, ...feature, [Math.max(tail[0] + F, reach), tail[1] * 0.15]];
}

/** Resample a 3D polyline at a fixed arc spacing — the trajectory's MD stations. */
function resample3(points: Vec3[], step: number): Vec3[] {
  const out: Vec3[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 1e-9) continue;
    let t = step - carry;
    while (t <= len) {
      const u = t / len;
      out.push([
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
      ]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (
    Math.hypot(last[0] - tail[0], last[1] - tail[1], last[2] - tail[2]) > 1e-6
  )
    out.push(last);
  return out;
}

/**
 * Build a trajectory whose PLAN projection carries a chosen defect.
 *
 * ⚠️ The wellhead is the origin and depth is negative Y — the same frame `sampleTrajectoryPlan`
 * reads, so the result can be splined and fed to the fence pipeline exactly like a real position
 * log. It is never a UTM position and needs no CRS.
 *
 * @group Storybook
 */
export function syntheticTrajectory(
  options: SyntheticTrajectoryOptions = {},
): Vec3[] {
  const o: Resolved = { ...DEFAULTS, ...options };
  const rng = mulberry32(o.seed);
  const gauss = () => (rng() + rng() + rng() + rng() - 2) * 0.5;

  // --- The vertical section. Plan is scatter here, not shape: a few metres of drift for an
  // ordinary well, a knot the size of the feature when that is the defect being built.
  const knot = o.defect === 'vertical-knot';
  const driftScale = knot ? o.featureSize : o.verticalDrift;
  const verticalSteps = Math.max(8, Math.round(o.kickoffDepth / o.spacing));
  // ⭐⭐ The noise swings a single BEARING within bounds; the path is that bearing integrated.
  // Integrating a signed noise directly still reverses the heading wherever the signal crosses
  // zero, so the plan trace curled back on itself — measured as an arc-to-chord pocket on a well
  // with no defect in it at all. Holding the bearing inside ±half a swing means the hole can lean
  // and correct but never doubles back, which is what a real vertical section does.
  const bearingNoise = gradientNoise1D(o.seed * 2 + 1);
  const bearing0 = mulberry32(o.seed * 2 + 2)() * Math.PI * 2;
  // A knot is the one case that SHOULD tangle — that is the defect being built — so its bearing is
  // allowed several full turns.
  const swing = knot ? DRIFT_KNOT_SWING : DRIFT_SWING;
  // ⭐ ONE octave, and its wavelength is the whole section divided by the number of turns asked
  // for. A second octave is a second, faster set of direction changes, which is exactly the
  // erratic wander a real hole does not have.
  const turns = Math.max(0.25, o.driftTurns);
  const wavelength = o.kickoffDepth / turns;
  const azimuth = (o.heading * Math.PI) / 180;
  const walk: Vec2[] = [];
  let wx = 0;
  let wz = 0;
  for (let i = 0; i <= verticalSteps; i++) {
    const md = (o.kickoffDepth * i) / verticalSteps;
    walk.push([wx, wz]);
    const step = o.kickoffDepth / verticalSteps;
    const drift = bearing0 + bearingNoise(md / wavelength) * swing * 0.5;
    // Shortest-arc blend into the heading, so the hole eases onto its target azimuth instead of
    // meeting the deviated section at a corner. Signed wrap, or it could turn the long way round.
    const t = Math.min(
      1,
      Math.max(
        0,
        (i / verticalSteps - (1 - KICKOFF_TURN_FRACTION)) /
          KICKOFF_TURN_FRACTION,
      ),
    );
    const lead = t * t * (3 - 2 * t);
    const bearing =
      drift +
      Math.atan2(Math.sin(azimuth - drift), Math.cos(azimuth - drift)) * lead;
    wx += Math.cos(bearing) * step;
    wz += Math.sin(bearing) * step;
  }
  // Normalised so `verticalDrift` is the FOOTPRINT the wander stays inside, which is what the
  // option claims, rather than a rate whose result depends on the section's length.
  let reach = 0;
  for (const p of walk) reach = Math.max(reach, Math.hypot(p[0], p[1]));
  const driftGain = reach > 1e-9 ? driftScale / reach : 0;
  const dense: Vec3[] = [];
  for (let i = 0; i <= verticalSteps; i++) {
    dense.push([
      walk[i][0] * driftGain,
      (-o.kickoffDepth * i) / verticalSteps,
      walk[i][1] * driftGain,
    ]);
  }
  const head: Vec2 = [dense[dense.length - 1][0], dense[dense.length - 1][2]];

  // --- The deviated section. Depth follows PLAN ARC, so `at` moves a defect down the hole as
  // well as along it — which is what makes one control serve both placements.
  const plan = chaikin(planWaypoints(o), Math.max(0, Math.round(o.smoothing)));
  const arc: number[] = [0];
  for (let i = 1; i < plan.length; i++) {
    arc.push(
      arc[i - 1] +
        Math.hypot(plan[i][0] - plan[i - 1][0], plan[i][1] - plan[i - 1][1]),
    );
  }
  const planLength = arc[arc.length - 1] || 1;
  const drop = Math.max(0, o.totalDepth - o.kickoffDepth);
  const buildRadius = Math.min(
    BUILD_RADIUS,
    drop * BUILD_MAX_SHARE,
    planLength * BUILD_MAX_SHARE,
  );
  if (!(buildRadius > 0)) {
    throw new Error(
      `syntheticTrajectory: no room to build angle — totalDepth (${o.totalDepth}) must exceed kickoffDepth (${o.kickoffDepth}) and the plan must have length (${planLength.toFixed(1)} m)`,
    );
  }
  // Inclination from vertical the build reaches, solved so the section drops exactly `drop`:
  // it turns through a circular arc of `buildRadius`, then holds that angle to TD. Strictly
  // decreasing in theta because `buildRadius` is under both drop and planLength, so bisect.
  const dropAt = (t: number) =>
    buildRadius * Math.sin(t) +
    (planLength - buildRadius * (1 - Math.cos(t))) / Math.tan(t);
  let lo = 1e-4;
  let hi = Math.PI / 2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (dropAt(mid) > drop) lo = mid;
    else hi = mid;
  }
  const holdAngle = (lo + hi) / 2;
  const buildPlan = buildRadius * (1 - Math.cos(holdAngle));
  const buildDrop = buildRadius * Math.sin(holdAngle);
  // Depth below the kickoff at a given plan arc. `sqrt(a(2R-a))` IS the circle through the
  // kickoff tangent to vertical, so the hole leaves straight down and turns at a finite rate.
  const depthAt = (a: number) =>
    a <= buildPlan
      ? Math.sqrt(Math.max(0, a * (2 * buildRadius - a)))
      : buildDrop + (a - buildPlan) / Math.tan(holdAngle);
  const cos = Math.cos(azimuth);
  const sin = Math.sin(azimuth);
  for (let i = 0; i < plan.length; i++) {
    const px = plan[i][0];
    const pz = plan[i][1];
    dense.push([
      head[0] + px * cos - pz * sin,
      -(o.kickoffDepth + depthAt(arc[i])),
      head[1] + px * sin + pz * cos,
    ]);
  }

  const stations = resample3(dense, o.spacing);
  if (o.noise > 0) {
    for (let i = 1; i < stations.length; i++) {
      stations[i][0] += gauss() * o.noise;
      stations[i][1] += gauss() * o.noise * 0.25;
      stations[i][2] += gauss() * o.noise;
    }
  }
  return stations;
}

/**
 * Named cases worth keeping fixed — the ones a detector's behaviour is argued about.
 *
 * ⭐ The two `*-envelope` entries are sized from the real datasets (plan-extent ÷ TVD of 0.46 for
 * Volve and 2.08 for Troll) so a rule is never checked against one field's proportions alone.
 */
export const TRAJECTORY_PRESETS: Record<string, SyntheticTrajectoryOptions> = {
  straight: { defect: 'none' },
  // ⚠️ The control case. `straight` is NOT clean in plan: its vertical section wanders a few
  // metres, as every real one does, and that alone is enough for the existing detectors to frame
  // an obstacle. This one removes the wander so the two can be told apart.
  // ⚠️ Survey scatter has to go too, or the "no drift" case still has plan shape in it.
  'straight (no drift)': { defect: 'none', verticalDrift: 0, noise: 0 },
  'head hook (narrow)': {
    defect: 'fold',
    at: 0,
    featureSize: 300,
    mouth: 0.25,
  },
  'head hook (open)': { defect: 'fold', at: 0, featureSize: 300, mouth: 2 },
  'deviated fold (narrow)': { defect: 'fold', at: 0.55, mouth: 0.25 },
  'deviated fold (open)': { defect: 'fold', at: 0.55, mouth: 2.5 },
  'tiny fold': { defect: 'fold', at: 0.6, featureSize: 25, mouth: 0.3 },
  'double fold': { defect: 'double-fold', at: 0.35, mouth: 0.5 },
  zigzag: { defect: 'zigzag', at: 0.4, featureSize: 120, mouth: 0.6 },
  'zigzag (sharp)': {
    defect: 'zigzag',
    at: 0.4,
    featureSize: 120,
    mouth: 0.6,
    smoothing: 1,
  },
  spiral: { defect: 'spiral', at: 0.45, featureSize: 700 },
  // The Troll case: a plan loop over a large XZ displacement with barely any Y between the two
  // passes — exactly one wellbore in 929 looked like this, and nothing public does.
  'deviated loop (troll-like)': {
    defect: 'loop',
    at: 0.5,
    featureSize: 700,
    kickoffDepth: 500,
    totalDepth: 1600,
    reach: 2400,
  },
  'vertical knot (volve-like)': {
    defect: 'vertical-knot',
    featureSize: 12,
    kickoffDepth: 1800,
    totalDepth: 3100,
    reach: 900,
  },
  'troll envelope': {
    defect: 'fold',
    at: 0.5,
    mouth: 0.8,
    featureSize: 500,
    kickoffDepth: 450,
    totalDepth: 1580,
    reach: 3300,
  },
  'volve envelope': {
    defect: 'fold',
    at: 0.5,
    mouth: 0.8,
    featureSize: 250,
    kickoffDepth: 900,
    totalDepth: 3020,
    reach: 1300,
  },
};

/** Preset names, in a stable order. */
export const TRAJECTORY_PRESET_NAMES = Object.keys(TRAJECTORY_PRESETS);
