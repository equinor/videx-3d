import { describe, expect, it } from 'vitest';
import {
  buildWellboreFence,
  fenceCoreTrace,
  fenceKickoff,
  fenceObstacles,
  getSplineCurve,
  planFenceHead,
  prepareFenceTrace,
  sampleTrajectoryPlan,
  trimFenceCore,
  Vec2,
} from '../src/sdk';
import { syntheticTrajectory } from '../src/storybook/data/synthetic-trajectories';

const MARGIN = 0.5;

// ⚠️ A real-looking well, drift and survey noise included: a noiseless one is collinear in plan and
// has no head hull at all. Vertical to 600 m, then heading +X to 2500 m of reach at 2200 m TVD.
const curve = getSplineCurve(syntheticTrajectory({ defect: 'none' }))!;
const depthAt = (md: number) => -curve.getPointAt(md / curve.length)[1];
const square = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const build = (rings: Vec2[][], verticalRange?: [number, number]) =>
  buildWellboreFence(curve, { rings, margin: MARGIN, verticalRange });
const field = [square(-5000, -5000, 5000, 5000)];

describe('fence block span', { timeout: 30_000 }, () => {
  it('builds no fence for a well that never enters the block', () => {
    expect(build([square(9000, 9000, 10000, 10000)])).toBeNull();
    expect(build(field, [-5000, -4000])).toBeNull();
  });

  it('builds a well kept whole exactly as without a span', () => {
    const plain = build(field)!;
    const ranged = build(field, [-1e6, 1e6])!;
    expect(ranged.report.block).toEqual({
      inside: 1,
      md: [0, curve.length],
      headArm: true,
      tdArm: true,
    });
    expect(ranged.left.curve.points).toEqual(plain.left.curve.points);
    expect(ranged.right.curve.points).toEqual(plain.right.curve.points);
  });

  it('leaves the TD bare where the well leaves through the footprint', () => {
    const f = build([square(-1000, -1000, 1000, 1000)])!;
    const { block } = f.report;
    expect(block.headArm).toBe(true);
    expect(block.tdArm).toBe(false);
    expect(block.inside).toBeGreaterThan(0.3);
    expect(block.inside).toBeLessThan(0.8);
    const last = f.base.points[f.base.points.length - 1];
    expect(last[0] - 1000).toBeGreaterThanOrEqual(2 * MARGIN);
    expect(last[0] - 1000).toBeLessThan(20);
    for (const side of [f.left, f.right]) {
      expect(side.curve.pieces[0].kind).toBe('run-out');
      expect(side.curve.pieces[side.curve.pieces.length - 1].kind).not.toBe(
        'run-out',
      );
    }
  });

  it('leaves the head bare where the well enters through the footprint', () => {
    const f = build([square(800, -1000, 4000, 1000)])!;
    const { block } = f.report;
    expect(block.headArm).toBe(false);
    expect(block.tdArm).toBe(true);
    expect(800 - f.base.points[0][0]).toBeGreaterThanOrEqual(2 * MARGIN);
    for (const side of [f.left, f.right]) {
      expect(side.curve.pieces[0].kind).not.toBe('run-out');
      expect(side.curve.pieces[side.curve.pieces.length - 1].kind).toBe(
        'run-out',
      );
    }
  });

  it('cuts a head above the block at its top, and arms it opposite the TD', () => {
    // 900 m is well past the kickoff, so the kept head is already deviating.
    const f = build(field, [-5000, -900])!;
    const { block } = f.report;
    expect(block.headArm).toBe(true);
    expect(Math.abs(depthAt(block.md[0]) - 900)).toBeLessThan(0.5);
    expect(f.report.coreReach[0]).toBe(0);
    const head = f.report.arms.head.dir;
    const td = f.report.arms.td.dir;
    expect(head[0] * td[0] + head[1] * td[1]).toBeLessThan(-0.999);
    expect(f.report.degenerate).toBe(false);
    for (const side of [f.left, f.right]) {
      expect(side.curve.pieces[0].kind).toBe('run-out');
    }
  });

  it('frames an already-deviating head at the margin, not as a degenerate well', () => {
    const deep = getSplineCurve(
      syntheticTrajectory({ defect: 'none' }).filter(p => p[1] <= -900),
    )!;
    const samples = sampleTrajectoryPlan(deep)!;
    expect(fenceKickoff(samples).fromStart).toBe(true);
    const well = prepareFenceTrace(deep, samples).points;
    const obstacles = fenceObstacles(well, { margin: MARGIN });
    const plan = planFenceHead(well, samples, MARGIN, field, obstacles)!;
    expect(plan.degenerate).toBe(false);
    expect(plan.bearingSource).toBe('well');
  });

  it('cuts a TD below the block at its base, and still runs it out', () => {
    const f = build(field, [-1500, 0])!;
    const { block } = f.report;
    expect(block.tdArm).toBe(true);
    expect(Math.abs(depthAt(block.md[1]) - 1500)).toBeLessThan(0.5);
    expect(f.report.coreReach[1]).toBeCloseTo(500, 6);
    for (const side of [f.left, f.right]) {
      expect(side.curve.pieces[side.curve.pieces.length - 1].kind).toBe(
        'run-out',
      );
    }
  });

  it('runs the cores on past an open TD, then cuts them back to the block', () => {
    const f = build([square(-1000, -1000, 1000, 1000)])!;
    expect(f.report.coreReach[0]).toBe(0);
    expect(f.report.coreReach[1]).toBeCloseTo(500, 6);
    const last = f.base.points[f.base.points.length - 1];
    for (const side of [f.left, f.right]) {
      const reach = Math.max(...side.curve.points.map(p => p[0]));
      expect(reach).toBeLessThan(last[0] + MARGIN);
    }
    const stopped = buildWellboreFence(curve, {
      rings: [square(-1000, -1000, 1000, 1000)],
      margin: MARGIN,
      coreReach: 0,
    })!;
    expect(stopped.report.coreReach).toEqual([0, 0]);
  });

  it('clamps a core run-on to the trajectory', () => {
    const span = { inside: 1, md: [0, curve.length - 100] as [number, number], headArm: false, tdArm: false };
    const core = fenceCoreTrace(curve, span, [500, 500])!;
    expect(core.reach[0]).toBe(0);
    expect(core.reach[1]).toBeCloseTo(100, 6);
    expect(fenceCoreTrace(curve, span, [0, 0])).toBeNull();
  });

  it('cuts a core back at the block end, never through a rod', () => {
    const core: Vec2[] = Array.from({ length: 11 }, (_, i) => [i * 10, 0]);
    const endOf = (c: Vec2[]) => c[c.length - 1][0];
    expect(endOf(trimFenceCore(core, { td: [60, 1] }))).toBeCloseTo(60, 9);
    expect(endOf(trimFenceCore(core, { td: [60, 1] }, [[[50, 0], [70, 0]]]))).toBeCloseTo(70, 9);
    // overlapping rods are stepped out of one after the other
    const head = trimFenceCore(core, { head: [42, -1] }, [
      [[20, 0], [41, 0]],
      [[45, 0], [40, 0]],
    ]);
    expect(head[0][0]).toBeCloseTo(20, 9);
    expect(endOf(head)).toBe(100);
  });
});
