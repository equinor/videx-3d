import { describe, expect, it } from 'vitest';
import {
  syntheticTrajectory,
  SyntheticTrajectoryOptions,
  TRAJECTORY_PRESET_NAMES,
  TRAJECTORY_PRESETS,
} from '../src/storybook/data/synthetic-trajectories';
import { getSplineCurve } from '../src/sdk/geometries/curve/curve-3d';
import {
  prepareFenceTrace,
  sampleTrajectoryPlan,
} from '../src/sdk/geometries/wellbore-fence';
import {
  isTraceKink,
  isTracePocket,
  traceProblemSpans,
  TraceProblemOptions,
} from '../src/sdk/utils/one-sided-offset';
import { Vec2 } from '../src/sdk';

/**
 * The plan trace a fence would actually be built from, for a synthetic trajectory.
 *
 * ⚠️ `verticalDrift: 0` unless a case asks otherwise. A real vertical section wanders a few metres
 * and that IS a genuine pocket — a 1 m mouth with 5 m of trace behind it scores well over the
 * threshold — so leaving it in means every assertion is really about the wander rather than about
 * the defect being built. The census below keeps the drift, because there it is the point.
 *
 * ⚠️ `noise: 0` for the same reason, and it is load-bearing WITH the line above: survey scatter is
 * applied per station, so on a section with no drift to shape it the head becomes a scatter blob
 * whose plan features are smaller than anything real — MEASURED a 0.07 m kink radius against a
 * 1.1 m minimum over the 26 Volve wells. These cases test the RULES on clean geometry.
 */
function traceOf(options: SyntheticTrajectoryOptions): Vec2[] {
  const curve = getSplineCurve(
    syntheticTrajectory({ verticalDrift: 0, noise: 0, ...options }),
  );
  if (!curve) throw new Error('no spline');
  const samples = sampleTrajectoryPlan(curve, undefined);
  if (!samples) throw new Error('no samples');
  return prepareFenceTrace(curve, samples, {}).points;
}

const worstRatio = (options: SyntheticTrajectoryOptions): number => {
  const spans = traceProblemSpans(traceOf(options), { minRatio: 1.01 }).filter(
    isTracePocket,
  );
  return spans.reduce((a, s) => Math.max(a, s.ratio), 0);
};

/** Pockets only — the kink test has its own cases and would otherwise mask them. */
const pocketsOf = (
  options: SyntheticTrajectoryOptions,
  detector: TraceProblemOptions = {},
) => traceProblemSpans(traceOf(options), detector).filter(isTracePocket);

describe('traceProblemSpans', () => {
  it('finds nothing on a trace that never doubles back', () => {
    const spans = traceProblemSpans(traceOf({ defect: 'none' }));
    expect(spans).toEqual([]);
  });

  it('separates a narrow fold from an open one at the same size', () => {
    const size = { defect: 'fold' as const, at: 0.5, featureSize: 400 };
    expect(pocketsOf({ ...size, mouth: 0.25 })).not.toEqual([]);
    expect(pocketsOf({ ...size, mouth: 3 })).toEqual([]);
  });

  it('judges a tiny fold and a large one by the same rule', () => {
    // ⭐ The gap a fixed-size detector leaves: `fenceFoldSpans` sees only the 25 m one (its
    // self-approach threshold is 4 m). A ratio has no size to be outside of.
    expect(
      pocketsOf({ defect: 'fold', at: 0.6, featureSize: 25, mouth: 0.25 })
        .length,
    ).toBeGreaterThan(0);
    expect(
      pocketsOf({ defect: 'fold', at: 0.6, featureSize: 800, mouth: 0.25 })
        .length,
    ).toBeGreaterThan(0);
  });

  it('sees the same defect wherever it sits along the trace', () => {
    const shape = { defect: 'fold' as const, featureSize: 400, mouth: 0.25 };
    for (const at of [0, 0.25, 0.5, 0.8]) {
      expect(pocketsOf({ ...shape, at }), `at ${at}`).not.toEqual([]);
    }
  });

  it('rises monotonically as the mouth closes', () => {
    const shape = { defect: 'fold' as const, at: 0.5, featureSize: 400 };
    const ratios = [3, 2, 1, 0.5, 0.25].map(mouth =>
      worstRatio({ ...shape, mouth }),
    );
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `mouth step ${i}: ${ratios.join(' ')}`).toBeGreaterThan(
        ratios[i - 1],
      );
    }
  });

  it('catches a loop, whose mouth has closed entirely', () => {
    const spans = traceProblemSpans(
      traceOf({
        ...TRAJECTORY_PRESETS['deviated loop (troll-like)'],
        verticalDrift: 0,
      }),
    );
    expect(spans.length).toBeGreaterThan(0);
    expect(
      Math.max(...spans.filter(isTracePocket).map(s => s.ratio)),
    ).toBeGreaterThan(6);
  });

  it('reports a mouth narrower than two margins as unthreadable', () => {
    const shape = {
      defect: 'fold' as const,
      at: 0.5,
      featureSize: 400,
      mouth: 0.05,
    };
    const [tight] = pocketsOf(shape, { margin: 40 });
    expect(tight).toBeDefined();
    expect(tight.threadable).toBe(false);
    expect(pocketsOf(shape, { margin: 0.1 })[0].threadable).toBe(true);
  });

  it('names the side the pocket is on, and the mirrored shape gets the other', () => {
    const shape = {
      defect: 'fold' as const,
      at: 0.5,
      featureSize: 400,
      mouth: 0.25,
    };
    expect(pocketsOf({ ...shape, side: 1 })[0].side).not.toBe(
      pocketsOf({ ...shape, side: -1 })[0].side,
    );
  });
});

describe('traceProblemSpans kinks', () => {
  it('leaves a gentle bend alone', () => {
    // A 700 m fold turns over hundreds of metres, so nothing in it is sharp enough to be a kink.
    const kinks = traceProblemSpans(
      traceOf({ defect: 'fold', at: 0.5, featureSize: 700, mouth: 2 }),
    ).filter(isTraceKink);
    expect(kinks).toEqual([]);
  });

  it('catches a bend too tight to follow even when nothing is trapped', () => {
    // ⭐ The whole reason the kink test exists. `mouth` above 1 keeps the ratio under the pocket
    // trigger so nothing is trapped, while the excursion's own corners still turn tighter than the
    // cut can flow — the two tests answer different questions about the same stretch.
    // ⚠️ `smoothing: 0` leaves the corners unrounded, which no hole is drilled with; it is the
    // stress shape for this property rather than a realistic trajectory.
    const shape = {
      defect: 'fold' as const,
      at: 0.5,
      featureSize: 200,
      mouth: 1.2,
      smoothing: 0,
    };
    const spans = traceProblemSpans(traceOf(shape));
    expect(spans.filter(isTracePocket)).toEqual([]);
    expect(spans.filter(isTraceKink).length).toBeGreaterThan(0);
  });

  it('reports more of a zigzag as the smoothing is removed', () => {
    const shape = {
      defect: 'zigzag' as const,
      at: 0.4,
      featureSize: 120,
      mouth: 0.6,
    };
    const tightest = (smoothing: number) => {
      const kinks = traceProblemSpans(
        traceOf({ ...shape, smoothing }),
      ).filter(isTraceKink);
      return kinks.length ? Math.min(...kinks.map(k => k.radius)) : Infinity;
    };
    expect(tightest(0)).toBeLessThan(tightest(3));
  });

  it('never calls a constant-radius arc a kink, however tight it is', () => {
    // ⭐ A loop is a circle of `featureSize / 2`, so it reads the SAME radius at both scales — a
    // drilled curve, not a defect. It is caught as a POCKET instead, which is the right answer:
    // the cut can follow it, it just cannot get back out. A single-window test would have to call
    // it a kink at any threshold below its radius.
    const shape = { defect: 'loop' as const, at: 0.5, featureSize: 200 };
    const spans = traceProblemSpans(traceOf(shape));
    expect(spans.filter(isTraceKink)).toEqual([]);
    expect(spans.filter(isTracePocket).length).toBeGreaterThan(0);
  });
});

// ⭐ GROUND TRUTH, not an assertion. Run with `npx vitest run
// tests/trace-defects.test.ts --disable-console-intercept` to read the table.
describe('traceProblemSpans on the synthetic set', () => {
  it('census', () => {
    const rows: string[] = [];
    for (const name of TRAJECTORY_PRESET_NAMES) {
      // The realistic case here: the vertical section's own wander is left IN, so the table shows
      // what a real well's trace would report, not just the constructed defect.
      const curve = getSplineCurve(
        syntheticTrajectory(TRAJECTORY_PRESETS[name]),
      );
      if (!curve) continue;
      const samples = sampleTrajectoryPlan(curve, undefined);
      if (!samples) continue;
      const trace = prepareFenceTrace(curve, samples, {}).points;
      const spans = traceProblemSpans(trace, { margin: 1 });
      rows.push(
        `${name.padEnd(28)} ${String(spans.length).padStart(2)} ${
          spans
            .map(s =>
              s.reason === 'pocket'
                ? `${s.side[0]} pocket ${s.ratio.toFixed(1)}x mouth ${s.mouth.toFixed(0)}m arc ${s.trappedArc.toFixed(0)}m${s.threadable ? '' : ' UNTHREADABLE'}`
                : `${s.side[0]} kink r ${s.radius.toFixed(0)}m`,
            )
            .join(' | ') || '—'
        }`,
      );
    }
    console.log('\n' + rows.join('\n'));
    expect(rows.length).toBe(TRAJECTORY_PRESET_NAMES.length);
  });
});
