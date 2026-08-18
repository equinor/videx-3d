/* oxlint-disable vitest/expect-expect -- a report, not a test: it PRINTS numbers
   for a human. The assertions live in wellbore-fence.test.ts. */
/**
 * Fence measurement harness.
 *
 * Skipped by default so it costs nothing in the normal suite. Run it with:
 *
 * ```
 * FENCE_REPORT=1 npx vitest run tests/fence-report.test.ts --disable-console-intercept
 * ```
 *
 * Set `FENCE_REPORT` to a wellbore id or name fragment to get the full report for
 * one well instead of the sweep table.
 *
 * `FENCE_REPORT=residual` measures WHERE the cut face disagrees with the field's own
 * zero set, and how that disagreement scales with the cell size. ⭐ The scaling
 * exponent is the diagnostic: bilinear reconstruction error over a curve of radius R
 * goes as `cell²/8R`, so an exponent near 2 means the raster is simply doing what a
 * raster does, while an exponent near 1 means something is offset by a fraction of a
 * cell and is a BUG.
 *
 * ⚠️ Vitest 4 hides console output from PASSING tests without
 * `--disable-console-intercept`.
 */
import { describe, it } from 'vitest';
import { fenceSideAt } from '../src/sdk/geometries/fence-segments';
import {
  assertFenceInvariants,
  buildWellboreFence,
  FenceReport,
  sampleFenceField,
  sampleTrajectoryPlan,
} from '../src/sdk/geometries/wellbore-fence';
import { Vec2 } from '../src/sdk/types/common';
import {
  nearestOnPolyline,
  polylineArcLengths,
  resamplePolyline2D,
} from '../src/sdk/utils/polyline-2d';
import {
  bounds,
  rings,
  trajectoryCurve,
  wellboreIds,
  wellboreName,
} from './fence-fixtures';

const FILTER = process.env.FENCE_REPORT ?? '';
const MARGINS = [0, 25, 100];

function pad(value: string | number, width: number, right = true) {
  const text = typeof value === 'number' ? value.toFixed(0) : value;
  return right ? text.padStart(width) : text.padEnd(width);
}

function row(report: FenceReport, margin: number): string {
  const { relax, head, extensions, sides } = report;
  const problems = assertFenceInvariants(report);
  return [
    pad(report.wellbore ?? '', 12, false),
    pad(margin, 4),
    pad(report.sampling.count, 5),
    pad(report.sampling.maxTurn, 5),
    pad(relax.headRadius === Infinity ? 9999 : relax.headRadius, 6),
    relax.headRadius >= relax.requiredHeadRadius ? '  ok' : ' FAIL',
    pad(relax.minRadius === Infinity ? 9999 : relax.minRadius, 6),
    pad(relax.maxDeviation, 6),
    pad(head.trimmedLength, 6),
    pad(extensions.startClearance, 5),
    pad(extensions.endClearance, 5),
    pad(extensions.evenness * 100, 5),
    pad(sides.plus.removedShare * 100, 5),
    pad(sides.minus.removedShare * 100, 5),
    pad(Math.min(...sides.plus.opening, ...sides.minus.opening), 5),
    // How hard the sharpest junction bends, which is what tears the swept face.
    // The opening is 180 - turn, so a straight junction reads 0 here either way.
    pad(
      Math.max(
        ...[...sides.plus.opening, ...sides.minus.opening].map(o =>
          Math.abs(180 - o),
        ),
      ),
      5,
    ),
    pad(sides.plus.loops + sides.minus.loops, 4),
    pad(sides.plus.loopsRemoved + sides.minus.loopsRemoved, 4),
    problems.length === 0 ? '   -' : ` ${problems.length}`,
  ].join(' ');
}

const HEADINGS = [
  pad('well', 12, false),
  pad('marg', 4),
  pad('smpl', 5),
  pad('turn', 5),
  pad('head', 6),
  ' head',
  pad('radius', 6),
  pad('devi', 6),
  pad('trim', 6),
  pad('clr0', 5),
  pad('clr1', 5),
  pad('even', 5),
  pad('rem+', 5),
  pad('rem-', 5),
  pad('open', 5),
  pad('bend', 5),
  pad('loop', 4),
  pad('cut', 4),
  ' bad',
].join(' ');

/** Turn angle at each vertex of a polyline, in degrees. */
function turnAngles(points: Vec2[]): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 1; i + 1 < points.length; i++) {
    const ax = points[i][0] - points[i - 1][0];
    const az = points[i][1] - points[i - 1][1];
    const bx = points[i + 1][0] - points[i][0];
    const bz = points[i + 1][1] - points[i][1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cos = (ax * bx + az * bz) / (la * lb);
    out[i] = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  }
  return out;
}

/**
 * Where the cut face stands off the field's own zero set, and how that scales.
 *
 * ⭐ Bucketed by the LOCAL TURN of the curve, because bilinear reproduces a straight
 * line exactly — so if the error is flat across the buckets it is not reconstruction
 * error at all.
 */
function residualProfile() {
  const cells = [4, 8, 17.5, 35, 70];
  console.log('\nresidual by cell size (metres), margin 0');
  console.log(
    'cell    n      rms     max   exact   | straight(<1°)  mild(1-5°)  sharp(>5°)',
  );
  const previous: Record<string, number> = {};
  for (const cellSize of cells) {
    let sum = 0;
    let exactSum = 0;
    let count = 0;
    let max = 0;
    const buckets = [
      { label: 'straight', sum: 0, n: 0 },
      { label: 'mild', sum: 0, n: 0 },
      { label: 'sharp', sum: 0, n: 0 },
    ];
    for (const id of wellboreIds) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      const fence = buildWellboreFence(curve, { rings, margin: 0, cellSize });
      if (!fence) continue;
      const side = fence.plus;
      const points = side.curve.points;
      const turns = turnAngles(points);
      const arc = polylineArcLengths(points);
      const sample = sampleFenceField(side.field);
      const exact = (x: number, z: number) =>
        fenceSideAt(side.index, side.field, x, z);
      // Walk the ORIGINAL vertices so each sample has a known local turn.
      for (let i = 1; i + 1 < points.length; i++) {
        const p = points[i];
        if (
          p[0] < bounds[0] ||
          p[0] > bounds[2] ||
          p[1] < bounds[1] ||
          p[1] > bounds[3]
        ) {
          continue;
        }
        // Skip the very first and last spans, which are the run-out junctions.
        if (arc[i] < 50 || arc[i] > arc[arc.length - 1] - 50) continue;
        const value = Math.abs(sample(p[0], p[1]));
        exactSum += Math.abs(exact(p[0], p[1])) ** 2;
        sum += value * value;
        count++;
        if (value > max) max = value;
        const bucket =
          turns[i] < 1 ? buckets[0] : turns[i] < 5 ? buckets[1] : buckets[2];
        bucket.sum += value * value;
        bucket.n++;
      }
    }
    const rms = count > 0 ? Math.sqrt(sum / count) : 0;
    const exactRms = count > 0 ? Math.sqrt(exactSum / count) : 0;
    const per = buckets
      .map(b => `${b.n > 0 ? Math.sqrt(b.sum / b.n).toFixed(2) : '-'} (${b.n})`)
      .join('  ');
    console.log(
      `${pad(cellSize, 5)} ${pad(count, 6)} ${rms.toFixed(3).padStart(8)} ${max.toFixed(2).padStart(7)} ${exactRms.toExponential(1).padStart(9)}   | ${per}`,
    );
    previous[cellSize] = rms;
  }
  // ⭐ THE diagnostic. Reconstruction error over a curve goes as cell², so doubling
  // the cell should quadruple it. An exponent near 1 means a fixed fraction of a
  // cell is being lost somewhere, which is a bug rather than a limit.
  const keys = cells.filter(c => previous[c] > 0);
  for (let i = 1; i < keys.length; i++) {
    const ratio = previous[keys[i]] / previous[keys[i - 1]];
    const exponent = Math.log(ratio) / Math.log(keys[i] / keys[i - 1]);
    console.log(
      `  ${keys[i - 1]} -> ${keys[i]}: x${ratio.toFixed(2)}  exponent ${exponent.toFixed(2)}`,
    );
  }
}

/** Resample the face the way the component does, for a like-for-like residual. */
function faceResidual(
  points: Vec2[],
  sample: (x: number, z: number) => number,
) {
  let max = 0;
  for (const p of resamplePolyline2D(points, 10)) {
    if (
      p[0] < bounds[0] ||
      p[0] > bounds[2] ||
      p[1] < bounds[1] ||
      p[1] > bounds[3]
    ) {
      continue;
    }
    max = Math.max(max, Math.abs(sample(p[0], p[1])));
  }
  return max;
}

/**
 * Does the block actually END at the cut face?
 *
 * ⭐ Steps off the face along its own normal and asks the cut. Removed side must be
 * negative, kept side positive, at every distance. A vertex that fails is a gap (or
 * an overhang) at that point on the seam — which is the artefact, measured directly,
 * rather than inferred from a residual at the face itself where both sides are zero.
 */
function seamProbe(ids: string[]) {
  const offsets = [0.25, 1, 5, 20, 60];
  console.log(
    '\nseam: fraction of face vertices where the cut is on the wrong side',
  );
  console.log(
    'well          side   ' + offsets.map(d => `${d}m`.padStart(8)).join(''),
  );
  for (const id of ids) {
    const curve = trajectoryCurve(id);
    if (!curve) continue;
    const fence = buildWellboreFence(curve, { rings, margin: 0 });
    if (!fence) continue;
    for (const side of [fence.plus, fence.minus]) {
      const points = resamplePolyline2D(side.curve.points, 5);
      const bad = offsets.map(() => 0);
      let n = 0;
      for (let i = 1; i + 1 < points.length; i++) {
        const p = points[i];
        if (
          p[0] < bounds[0] ||
          p[0] > bounds[2] ||
          p[1] < bounds[1] ||
          p[1] > bounds[3]
        ) {
          continue;
        }
        const tx = points[i + 1][0] - points[i - 1][0];
        const tz = points[i + 1][1] - points[i - 1][1];
        const len = Math.hypot(tx, tz) || 1;
        // Left normal, then oriented so it points into the half being removed.
        const nx = (-tz / len) * side.side;
        const nz = (tx / len) * side.side;
        n++;
        offsets.forEach((d, k) => {
          const inside = fenceSideAt(
            side.index,
            side.field,
            p[0] + nx * d,
            p[1] + nz * d,
          );
          const outside = fenceSideAt(
            side.index,
            side.field,
            p[0] - nx * d,
            p[1] - nz * d,
          );
          if (inside >= 0 || outside <= 0) bad[k]++;
        });
      }
      if (n === 0) continue;
      console.log(
        `${pad(wellboreName(id), 13, false)} ${pad(side.side, 4)}   ` +
          bad.map(b => `${((b / n) * 100).toFixed(1)}%`.padStart(8)).join(''),
      );
    }
  }
}

/**
 * Where the two sides diverge, and why.
 *
 * ⭐ At `margin` 0 the ONLY thing that can differ is the junction blend: the two
 * sides see openings of `180 - turn` and `180 + turn`, so one can be too tight to
 * look into while the other is wide open. Loop and waist repair are pure geometry
 * and give the same answer whichever half is being removed.
 *
 * ⚠️ If nothing here diverges, the per-side path is UNEXERCISED on this data and
 * should not be claimed as working.
 */
function sidesProbe(ids: string[]) {
  console.log('\nper-side tailoring at margin 0');
  console.log(
    'well           shared  blend+/-   open+ (deg)      open- (deg)   maxSep  verts+/-',
  );
  let diverged = 0;
  for (const id of ids) {
    const curve = trajectoryCurve(id);
    if (!curve) continue;
    const fence = buildWellboreFence(curve, { rings, margin: 0 });
    if (!fence) continue;
    const plus = fence.plus.curve;
    const minus = fence.minus.curve;
    const hit = { point: [0, 0] as Vec2, distance: 0, along: 0 };
    let maxSep = 0;
    for (const p of plus.points) {
      const near = nearestOnPolyline(minus.points, p[0], p[1], hit);
      if (near) maxSep = Math.max(maxSep, near.distance);
    }
    if (!fence.report.shared) diverged++;
    console.log(
      `${pad(wellboreName(id), 14, false)} ${pad(fence.report.shared ? 'yes' : 'NO', 6)}  ` +
        `${pad(plus.blended ? 'y' : '.', 3)}${pad(minus.blended ? 'y' : '.', 2)}  ` +
        `w${pad(plus.waistRemoved, 2)}/${pad(minus.waistRemoved, 1)}  ` +
        `${plus.opening.map(v => ((v * 180) / Math.PI).toFixed(0).padStart(6)).join('')}  ` +
        `${minus.opening.map(v => ((v * 180) / Math.PI).toFixed(0).padStart(6)).join('')}  ` +
        `${pad(maxSep, 7)}  ${plus.points.length}/${minus.points.length}`,
    );
  }
  console.log(
    `\n${diverged} of ${ids.length} wellbores take a per-side curve.`,
  );
}

/**
 * How much of the TRAJECTORY each side actually reveals.
 *
 * ⭐⭐ The quantity the feature exists for. A cut that does not put the well in the
 * half it removes has buried the thing it was opened to show — and a shared curve
 * cannot do that on both sides wherever a repair excised an excursion, because the
 * chord puts that excursion wholly on one side.
 *
 * ⚠️ Burial ABOVE the kickoff is by design: the corridor deliberately leaves the
 * near-vertical trace, which is why depth is reported alongside.
 */
function buriedProbe(ids: string[]) {
  console.log('\ntrajectory buried inside the KEPT half (margin 0)');
  console.log(
    'well            side  buried%  worst m   at head m   deepest buried (m TVD)',
  );
  for (const id of ids) {
    const curve = trajectoryCurve(id);
    if (!curve) continue;
    const fence = buildWellboreFence(curve, { rings, margin: 0 });
    if (!fence) continue;
    const samples = sampleTrajectoryPlan(curve, 10)!;
    for (const side of [fence.plus, fence.minus]) {
      let buried = 0;
      let worst = 0;
      let deepest = 0;
      let head = 0;
      for (let i = 0; i < samples.plan.length; i++) {
        const p = samples.plan[i];
        const value = fenceSideAt(side.index, side.field, p[0], p[1]);
        // ⭐ The head on its own. It is the one place a viewer always looks, and a
        // whole-trajectory average hides it completely.
        if (samples.md[i] - samples.md[0] < 200 && value > head) head = value;
        if (value <= 0) continue;
        buried++;
        if (value > worst) worst = value;
        if (-samples.y[i] > deepest) deepest = -samples.y[i];
      }
      console.log(
        `${pad(wellboreName(id), 15, false)} ${pad(side.side, 4)}  ` +
          `${pad(((buried / samples.plan.length) * 100).toFixed(0) + '%', 7)}  ` +
          `${pad(worst, 7)}  ${pad(head, 9)}  ${pad(deepest, 22)}`,
      );
    }
  }
}

describe.skipIf(!FILTER)('fence report', () => {
  it('sweeps every wellbore and margin', () => {
    if (FILTER === 'residual') {
      residualProfile();
      const curve = trajectoryCurve(wellboreIds[0])!;
      const fence = buildWellboreFence(curve, { rings, margin: 0 })!;
      console.log(
        `\nface residual at default cell (${fence.plus.field.cell.toFixed(1)} m): ` +
          `${faceResidual(fence.plus.curve.points, sampleFenceField(fence.plus.field)).toFixed(2)} m`,
      );
      return;
    }

    if (FILTER === 'seam') {
      seamProbe(wellboreIds);
      return;
    }

    if (FILTER === 'sides') {
      sidesProbe(wellboreIds);
      return;
    }

    if (FILTER === 'buried') {
      buriedProbe(wellboreIds);
      return;
    }

    const ids =
      FILTER === '1'
        ? wellboreIds
        : wellboreIds.filter(
            id => id === FILTER || wellboreName(id).includes(FILTER),
          );

    if (ids.length === 1) {
      const curve = trajectoryCurve(ids[0]);
      if (!curve) return;
      for (const margin of MARGINS) {
        const fence = buildWellboreFence(curve, {
          rings,
          margin,
          wellbore: wellboreName(ids[0]),
        });
        console.log(`\n=== ${wellboreName(ids[0])} margin ${margin} ===`);
        console.log(JSON.stringify(fence?.report, null, 2));
        console.log(
          'problems:',
          fence ? assertFenceInvariants(fence.report) : ['build returned null'],
        );
      }
      return;
    }

    console.log(`\nbounds ${bounds.map(v => v.toFixed(0)).join(', ')}`);
    console.log(HEADINGS);
    let failures = 0;
    let worst = 0;
    for (const id of ids) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      for (const margin of MARGINS) {
        const started = performance.now();
        const fence = buildWellboreFence(curve, {
          rings,
          margin,
          wellbore: wellboreName(id),
        });
        worst = Math.max(worst, performance.now() - started);
        if (!fence) {
          console.log(
            `${pad(wellboreName(id), 12, false)} BUILD RETURNED NULL`,
          );
          failures++;
          continue;
        }
        const problems = assertFenceInvariants(fence.report);
        failures += problems.length > 0 ? 1 : 0;
        console.log(row(fence.report, margin));
        for (const problem of problems)
          console.log(`             ! ${problem}`);
      }
    }
    console.log(
      `\n${ids.length} wellbores x ${MARGINS.length} margins, ${failures} with problems, worst build ${worst.toFixed(0)} ms`,
    );
    const stages: Record<string, number> = {};
    for (const id of ids.slice(0, 6)) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      const fence = buildWellboreFence(curve, { rings });
      if (!fence) continue;
      for (const [stage, ms] of Object.entries(fence.report.timings)) {
        stages[stage] = (stages[stage] ?? 0) + ms;
      }
    }
    console.log(
      'stage totals over 6 wells: ' +
        Object.entries(stages)
          .sort((a, b) => b[1] - a[1])
          .map(([stage, ms]) => `${stage} ${ms.toFixed(0)} ms`)
          .join(', '),
    );
  });
});
