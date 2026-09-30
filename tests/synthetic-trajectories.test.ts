import { describe, expect, it } from 'vitest';
import {
  syntheticTrajectory,
  TRAJECTORY_PRESET_NAMES,
  TRAJECTORY_PRESETS,
} from '../src/storybook/data/synthetic-trajectories';
import { getSplineCurve } from '../src/sdk/geometries/curve/curve-3d';
import {
  fenceFoldSpans,
  fenceObstacles,
  prepareFenceTrace,
  sampleTrajectoryPlan,
} from '../src/sdk/geometries/wellbore-fence';
import { Vec2 } from '../src/sdk';

/** The plan trace a fence would actually be built from, for a synthetic trajectory. */
function traceOf(options: Parameters<typeof syntheticTrajectory>[0]): Vec2[] {
  const curve = getSplineCurve(syntheticTrajectory(options));
  if (!curve) throw new Error('no spline');
  const samples = sampleTrajectoryPlan(curve, undefined);
  if (!samples) throw new Error('no samples');
  return prepareFenceTrace(curve, samples, {}).points;
}

describe('syntheticTrajectory', () => {
  it('starts at the wellhead origin and never emits a UTM-scale coordinate', () => {
    for (const name of TRAJECTORY_PRESET_NAMES) {
      const points = syntheticTrajectory(TRAJECTORY_PRESETS[name]);
      // `+ 0` normalises the -0 a zero-scaled depth produces.
      expect(
        points[0].map(v => v + 0),
        name,
      ).toEqual([0, 0, 0]);
      for (const p of points) {
        expect(Number.isFinite(p[0]) && Number.isFinite(p[1]), name).toBe(true);
        // A relative frame: nothing here is within four orders of magnitude of an easting.
        expect(Math.abs(p[0]), name).toBeLessThan(20000);
        expect(Math.abs(p[2]), name).toBeLessThan(20000);
      }
    }
  });

  it('is deterministic for a seed and responds to it', () => {
    const a = syntheticTrajectory({ defect: 'fold', noise: 2, seed: 7 });
    const b = syntheticTrajectory({ defect: 'fold', noise: 2, seed: 7 });
    const c = syntheticTrajectory({ defect: 'fold', noise: 2, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('descends monotonically and reaches the requested depth', () => {
    const points = syntheticTrajectory({ totalDepth: 2200, kickoffDepth: 600 });
    for (let i = 1; i < points.length; i++) {
      expect(points[i][1]).toBeLessThanOrEqual(points[i - 1][1] + 1e-6);
    }
    expect(points[points.length - 1][1]).toBeCloseTo(-2200, 0);
  });

  it('makes the mouth control change the plan shape, not the size', () => {
    const deep = traceOf({
      defect: 'fold',
      at: 0.5,
      featureSize: 400,
      mouth: 0.2,
    });
    const open = traceOf({
      defect: 'fold',
      at: 0.5,
      featureSize: 400,
      mouth: 3,
    });
    // ⛔ Separation is measured in ARC, never in vertex indices. A plan trace is simplified by
    // angle, so its vertex density varies hugely along one well — the head can hold hundreds of
    // vertices inside 20 m — and an index gap there spans a fraction of a metre, which made this
    // compare the head's own scatter instead of the fold's two limbs.
    const closest = (trace: Vec2[]) => {
      const arc = [0];
      for (let i = 1; i < trace.length; i++) {
        arc.push(
          arc[i - 1] +
            Math.hypot(
              trace[i][0] - trace[i - 1][0],
              trace[i][1] - trace[i - 1][1],
            ),
        );
      }
      let best = Infinity;
      for (let i = 0; i < trace.length; i++) {
        for (let j = i + 1; j < trace.length; j++) {
          if (arc[j] - arc[i] < 100) continue;
          const d = Math.hypot(
            trace[i][0] - trace[j][0],
            trace[i][1] - trace[j][1],
          );
          if (d < best) best = d;
        }
      }
      return best;
    };
    expect(closest(deep)).toBeLessThan(closest(open));
  });
});

// ⭐ GROUND TRUTH, not an assertion: what the EXISTING detectors make of shapes whose right
// answer is known. Run with `npx vitest run tests/synthetic-trajectories.test.ts
// --disable-console-intercept` to read the table.
describe('existing detectors on the synthetic set', () => {
  it('census', () => {
    const rows: string[] = [];
    for (const name of TRAJECTORY_PRESET_NAMES) {
      const trace = traceOf(TRAJECTORY_PRESETS[name]);
      const obstacles = fenceObstacles(trace);
      const spans = fenceFoldSpans(trace);
      const extent = (hull: Vec2[]) => {
        let minX = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxZ = -Infinity;
        for (const p of hull) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minZ) minZ = p[1];
          if (p[1] > maxZ) maxZ = p[1];
        }
        return Math.hypot(maxX - minX, maxZ - minZ);
      };
      rows.push(
        `${name.padEnd(28)} trace ${String(trace.length).padStart(5)}pt · obstacles ${obstacles.length} [${obstacles.map(h => `${extent(h).toFixed(0)}m`).join(' ')}] · foldSpans ${spans.map(s => `${s[0]}..${s[1]}/${trace.length}`).join(' ') || '—'}`,
      );
    }
    console.log('\n' + rows.join('\n'));
    expect(rows.length).toBe(TRAJECTORY_PRESET_NAMES.length);
  });
});
