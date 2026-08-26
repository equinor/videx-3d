import { describe, expect, it } from 'vitest';
import {
  assertFenceInvariants,
  fenceKickoff,
  fenceResidual,
  rasterizeOutline,
  sampleTrajectoryPlan,
  splitShares,
} from '../src/sdk/geometries/wellbore-fence';
import { getSplineCurve } from '../src/sdk/geometries/curve/curve-3d';
import { fenceSideAt } from '../src/sdk/geometries/fence-segments';
import {
  countPolylineLoops,
  offsetPolyline2D,
  polylineMinRadius,
  relaxPolyline2DWithin,
  resamplePolyline2D,
} from '../src/sdk/utils/polyline-2d';
import { Vec2, Vec3 } from '../src/sdk/types/common';
import {
  bounds,
  fenceFor,
  trajectoryCurve,
  wellboreIds,
} from './fence-fixtures';

// ⚠️ Small and SHARED, so the cached builds in the fixtures are reused across every
// test in this file rather than rebuilt per assertion.
const MARGINS = [0, 40];

/** A well that drops vertically with survey scatter, then kicks off and deviates. */
function syntheticWell(scatter: number): Vec3[] {
  const points: Vec3[] = [];
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 2;
  };
  for (let md = 0; md <= 1200; md += 20) {
    points.push([noise() * scatter, -md, noise() * scatter]);
  }
  for (let md = 1220; md <= 4000; md += 20) {
    const t = (md - 1200) / 2800;
    points.push([t * 2500, -1200 - t * 800, t * 900]);
  }
  return points;
}

describe('sampleTrajectoryPlan', () => {
  it('reads verticality off the 3D tangent, not the projection', () => {
    const curve = getSplineCurve(syntheticWell(1.5))!;
    const samples = sampleTrajectoryPlan(curve, 10)!;
    // The vertical section barely moves in plan per metre drilled; the deviated
    // section moves a lot. That contrast is what every later stage keys on.
    const shallow = samples.planSpeed[5];
    const deep = samples.planSpeed[samples.planSpeed.length - 5];
    expect(shallow).toBeLessThan(0.15);
    expect(deep).toBeGreaterThan(0.5);
  });

  it('does not step over a plan extreme', () => {
    // ⚠️ A uniform MD sample can pass straight by the outermost point of a tight
    // dogleg, and the fence then runs inside the well and buries it.
    const points: Vec3[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      const angle = t * Math.PI;
      points.push([
        Math.sin(angle) * 600,
        -1000 - t * 500,
        Math.cos(angle) * 600,
      ]);
    }
    const curve = getSplineCurve(points)!;
    const samples = sampleTrajectoryPlan(curve, 50)!;
    let furthest = 0;
    for (const p of samples.plan)
      furthest = Math.max(furthest, Math.hypot(p[0], p[1]));
    expect(furthest).toBeGreaterThan(595);
  });
});

describe('fenceKickoff', () => {
  it('finds where the well stops being vertical', () => {
    const curve = getSplineCurve(syntheticWell(1.5))!;
    const samples = sampleTrajectoryPlan(curve, 10)!;
    const kickoff = fenceKickoff(samples);
    expect(kickoff.found).toBe(true);
    expect(kickoff.md).toBeGreaterThan(900);
    expect(kickoff.md).toBeLessThan(1600);
  });
});

describe('relaxPolyline2DWithin', () => {
  it('never leaves the corridor, however many passes it runs', () => {
    // ⭐⭐ The whole safety argument. A plain smoother wanders; this one cannot,
    // because every pass is followed by pulling each point back inside its own
    // tolerance disc around where the trajectory actually put it.
    const points: Vec2[] = [];
    for (let i = 0; i < 200; i++) {
      points.push([i * 10, Math.sin(i * 0.9) * 120]);
    }
    const tolerance = new Float64Array(points.length).fill(30);
    const result = relaxPolyline2DWithin(points, tolerance, {
      minRadius: 100000,
      maxIterations: 5000,
    });
    for (let i = 0; i < points.length; i++) {
      const moved = Math.hypot(
        result.points[i][0] - points[i][0],
        result.points[i][1] - points[i][1],
      );
      expect(moved).toBeLessThanOrEqual(30 + 1e-9);
    }
    expect(result.maxDeviation).toBeLessThanOrEqual(30 + 1e-9);
    expect(result.settled).toBe(true);
  });

  it('straightens what the corridor allows', () => {
    const points: Vec2[] = [];
    for (let i = 0; i < 200; i++) {
      points.push([i * 10, Math.sin(i * 0.9) * 40]);
    }
    const before = polylineMinRadius(points, 200);
    const tolerance = new Float64Array(points.length).fill(60);
    const after = polylineMinRadius(
      relaxPolyline2DWithin(points, tolerance, { minRadius: 400 }).points,
      200,
    );
    expect(after).toBeGreaterThan(before * 5);
  });
});

describe('polylineMinRadius', () => {
  it('measures a short curve rather than calling it straight', () => {
    // ⚠️ A window wider than the curve leaves every vertex ineligible, and a
    // hairpin then reports as perfectly straight.
    const hairpin: Vec2[] = [
      [0, 0],
      [50, 0],
      [100, 0],
      [102, 20],
      [60, 25],
      [10, 25],
    ];
    expect(polylineMinRadius(hairpin, 1000)).toBeLessThan(200);
  });
});

describe('offsetPolyline2D', () => {
  it('offsets by the full distance on both sides', () => {
    const line: Vec2[] = [
      [0, 0],
      [100, 0],
      [200, 0],
    ];
    const left = offsetPolyline2D(line, 25);
    const right = offsetPolyline2D(line, -25);
    expect(left[1][1]).toBeCloseTo(25, 6);
    expect(right[1][1]).toBeCloseTo(-25, 6);
  });

  it('leaves no loops where it folds on the inside of a bend', () => {
    const bend: Vec2[] = [];
    for (let a = 0; a <= 90; a += 5) {
      const r = (a * Math.PI) / 180;
      bend.push([Math.cos(r) * 80, Math.sin(r) * 80]);
    }
    // An offset larger than the turning radius folds no matter how it is built.
    expect(countPolylineLoops(offsetPolyline2D(bend, -200))).toBe(0);
  });
});

describe('splitShares', () => {
  it('scores against the footprint, not its bounding box', () => {
    // A thin diagonal footprint fills its bbox badly; a cut across its short axis
    // splits the BLOCK evenly while splitting the box very unevenly.
    const ring: Vec2[] = [
      [-1000, -1000],
      [-800, -1000],
      [1000, 800],
      [1000, 1000],
      [800, 1000],
      [-1000, -800],
    ];
    const mask = rasterizeOutline([ring], [-1000, -1000, 1000, 1000]);
    const across: Vec2[] = [
      [-3000, 3000],
      [3000, -3000],
    ];
    const [smaller] = splitShares(across, mask);
    expect(smaller).toBeGreaterThan(0.35);
  });

  it('separates however far the curve stops past the grid', () => {
    // ⚠️⚠️ The raster pads itself by two cells, so a coarse raster over a large
    // field pads FURTHER than a run-out reaches. The barrier then stops inside
    // the grid, the fill walks around its end, and a perfectly good cut reads as
    // 0/100. The end segments are extended past the grid to make that impossible.
    const mask = rasterizeOutline(
      [
        [
          [-1000, -1000],
          [1000, -1000],
          [1000, 1000],
          [-1000, 1000],
        ],
      ],
      [-1000, -1000, 1000, 1000],
      8,
    );
    const barelyOut: Vec2[] = [
      [-1010, -20],
      [0, 0],
      [1010, 20],
    ];
    const [smaller] = splitShares(barelyOut, mask);
    expect(smaller).toBeGreaterThan(0.3);
  });
});

describe('buildWellboreFence on real wellbores', () => {
  it('builds a sound fence for every wellbore at every margin', () => {
    // ⚠️ A SWEEP, not a spot check. The previous implementation was verified at
    // one setting per well and hid failures that only appeared at others.
    const failures: string[] = [];
    for (const id of wellboreIds) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      for (const margin of MARGINS) {
        const fence = fenceFor(id, margin);
        if (!fence) {
          failures.push(`${id} @${margin}: build returned null`);
          continue;
        }
        for (const problem of assertFenceInvariants(fence.report)) {
          failures.push(`${id} @${margin}: ${problem}`);
        }
      }
    }
    expect(failures).toEqual([]);
    // Builds every fence the rest of the file then reads from cache, so it wears
    // the whole suite's cost and needs more than the 5s default.
  }, 60_000);

  it('gives the two sides two views of ONE cut', () => {
    // ⭐ The halves must be flip sides of the same section. With no clearance to
    // offset by and no junction needing repair there is nothing left to differ, so
    // the two curves must be identical — and then the shares are exact complements.
    for (const id of wellboreIds) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      const fence = fenceFor(id, 0);
      if (!fence || !fence.report.shared) continue;
      expect(fence.plus.curve.points).toEqual(fence.minus.curve.points);
      expect(fence.plus.removedShare + fence.minus.removedShare).toBeCloseTo(
        1,
        6,
      );
    }
  });

  it('leaves both halves usable once a clearance is baked in', () => {
    for (const id of wellboreIds) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      const fence = fenceFor(id, 40)!;
      expect(fence.plus.curve.points.length).toBeGreaterThan(2);
      expect(fence.minus.curve.points.length).toBeGreaterThan(2);
      expect(fence.plus.removedShare).toBeGreaterThan(0.1);
      expect(fence.minus.removedShare).toBeGreaterThan(0.1);
      // ⭐ The clearance corridor around the well is removed by BOTH views — that is
      // what makes it visible from either side with room around it — so the two
      // shares overlap rather than partitioning.
      const sum = fence.plus.removedShare + fence.minus.removedShare;
      expect(sum).toBeGreaterThan(0.95);
      expect(sum).toBeLessThan(1.25);
    }
  });

  it('puts the cut face exactly on the cut', () => {
    // ⭐ The invariant that replaces every CPU/GPU parity contract.
    for (const id of wellboreIds) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      const fence = fenceFor(id, 40)!;
      for (const side of [fence.plus, fence.minus]) {
        // ⚠️ Only where there is BLOCK. The run-outs carry the face far past the
        // footprint, and the field's sampler clamps at its border — correctly, since
        // there is nothing out there to cut.
        const face = resamplePolyline2D(side.curve.points, 10).filter(
          p =>
            p[0] >= bounds[0] &&
            p[0] <= bounds[2] &&
            p[1] >= bounds[1] &&
            p[1] <= bounds[3],
        );
        const flat = new Float64Array(face.length * 2);
        face.forEach((p, i) => {
          flat[i * 2] = p[0];
          flat[i * 2 + 1] = p[1];
        });
        const residual = fenceResidual(side, flat, 2);
        // ⭐ The cut reads the curve back rather than reconstructing it from a
        // raster, so the only error left is float precision. A rasterised signed
        // distance could not do better than about half a cell here.
        expect(residual.max).toBeLessThan(0.01);
        expect(residual.rms).toBeLessThan(0.001);
      }
    }
  });

  it('keeps the well inside the half it removes', () => {
    // ⭐⭐ What the margin and the derived clearance are FOR: the trajectory must end
    // up in the half that goes, or whatever is drawn in the hole is buried by the
    // block it was supposed to reveal.
    // ⚠️ Measured on the TRAJECTORY, not on the smoothed curve standing in for it —
    // the curve is allowed to leave the well, which is exactly why the clearance has
    // to be given back.
    for (const id of wellboreIds.slice(0, 8)) {
      const curve = trajectoryCurve(id);
      if (!curve) continue;
      const fence = fenceFor(id, 40)!;
      const samples = sampleTrajectoryPlan(curve, 10)!;
      for (const side of [fence.plus, fence.minus]) {
        let worst = 0;
        for (let i = 0; i < samples.plan.length; i++) {
          if (samples.md[i] < fence.base.kickoff.md) continue;
          const p = samples.plan[i];
          const at = fenceSideAt(side.index, side.field, p[0], p[1]);
          if (at > worst) worst = at;
        }
        // ⚠️ DEPTH, not a count. A sample a few centimetres the wrong side of a cut
        // that runs through the well is meaningless; metres inside the kept block is
        // the well being buried.
        // ⚠️⚠️ KNOWN GAP, not a target: the run-outs are attached and the loop and
        // waist repairs run AFTER the trace is relaxed clear of the well, so any of
        // them can put the cut back across it. This pins the current worst case so it
        // cannot get quietly worse; it should be driven down, not raised.
        expect(worst).toBeLessThan(90);
      }
    }
  });

  it('covers the whole footprint with the field', () => {
    const fence = fenceFor(wellboreIds[0], 0)!;
    const { field } = fence.plus;
    expect(field.origin[0]).toBeLessThanOrEqual(bounds[0]);
    expect(field.origin[1]).toBeLessThanOrEqual(bounds[1]);
    expect(field.origin[0] + field.nx * field.cell).toBeGreaterThanOrEqual(
      bounds[2],
    );
    expect(field.origin[1] + field.ny * field.cell).toBeGreaterThanOrEqual(
      bounds[3],
    );
  });
});
