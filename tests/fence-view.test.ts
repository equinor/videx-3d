import { describe, expect, it } from 'vitest';
import { fenceAutoSide, fenceSideAt, fenceViewPose, Vec2 } from '../src/sdk';
import { fenceFor, wellboreIds, wellboreName } from './fence-fixtures';

/**
 * Framing a fence, and choosing the half to remove from where the camera is.
 *
 * ⭐ The one invariant worth asserting is the same for both: a cut face can only be
 * read from the half that was taken away. So the pose must PUT the camera there,
 * and the auto side must FOLLOW it there — and `fenceSideAt`, which the shader and
 * the fog already agree with, is the judge of both.
 */

/**
 * A handful of real wells, at the margin the rest of the suite already builds.
 *
 * ⭐ `FENCE_VIEW=all` sweeps every well instead. Env-guarded because a build is
 * ~250 ms and the invariant is not per-well — the sweep is for when the RULE
 * changes, not for every run.
 */
const wells =
  process.env.FENCE_VIEW === 'all' ? wellboreIds : wellboreIds.slice(0, 3);

/**
 * The first test pays for every fence it touches; the rest read the cache.
 *
 * ⚠️ Generous even for three wells: a build is ~250 ms on an idle machine and
 * several times that when the whole suite is competing for workers.
 */
const SWEEP_TIMEOUT = wells.length > 3 ? 120000 : 30000;

const RANGE = { top: 0, bottom: -3500 };

/**
 * Where a pose actually puts the camera, in plan.
 *
 * ⚠️ Derived the way `CameraManager.orbit` does, from the azimuth and polar — the
 * point of the check is that the two agree on what those mean. The distance is the
 * box's diagonal, which is about what a 60° fov frames it from.
 */
function eyeAt(pose: ReturnType<typeof fenceViewPose>): Vec2 {
  const azimuth = (pose.azimuth * Math.PI) / 180;
  const polar = (pose.polar * Math.PI) / 180;
  const { min, max } = pose.box;
  const distance = Math.hypot(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  );
  const horizontal = distance * Math.sin(polar);
  return [
    pose.target[0] + horizontal * Math.cos(azimuth),
    pose.target[2] + horizontal * Math.sin(azimuth),
  ];
}

describe('fenceViewPose', () => {
  it(
    'stands the camera in the half that was removed',
    () => {
      for (const id of wells) {
        const fence = fenceFor(id);
        if (!fence) continue;
        for (const side of [1, -1] as const) {
          const pose = fenceViewPose(fence, { ...RANGE, side });
          expect(pose.side).toBe(side);
          expect(pose.open, `${wellboreName(id)} side ${side}`).toBe(true);
          const [x, z] = eyeAt(pose);
          const at = side > 0 ? fence.plus : fence.minus;
          expect(
            fenceSideAt(at.index, at.field, x, z),
            `${wellboreName(id)} side ${side}`,
          ).toBeLessThan(0);
        }
      }
    },
    SWEEP_TIMEOUT,
  );

  it('takes the side the view is already coming from', () => {
    for (const id of wells) {
      const fence = fenceFor(id);
      if (!fence) continue;
      // The +1 pose's own offset is the direction that side has to be viewed from,
      // so asking to come from there must give +1 back, and from behind, -1.
      const reference = fenceViewPose(fence, { ...RANGE, side: 1 });
      const azimuth = (reference.azimuth * Math.PI) / 180;
      const from: Vec2 = [Math.cos(azimuth), Math.sin(azimuth)];
      expect(fenceViewPose(fence, { ...RANGE, from }).side).toBe(1);
      expect(
        fenceViewPose(fence, { ...RANGE, from: [-from[0], -from[1]] }).side,
      ).toBe(-1);
    }
  });

  it('frames the trace through the whole depth range', () => {
    const fence = fenceFor(wells[0]);
    if (!fence) return;
    const pose = fenceViewPose(fence, { ...RANGE });
    expect(pose.box.min[1]).toBe(RANGE.bottom);
    expect(pose.box.max[1]).toBe(RANGE.top);
    for (const [x, z] of fence.base.points) {
      expect(x).toBeGreaterThanOrEqual(pose.box.min[0]);
      expect(x).toBeLessThanOrEqual(pose.box.max[0]);
      expect(z).toBeGreaterThanOrEqual(pose.box.min[2]);
      expect(z).toBeLessThanOrEqual(pose.box.max[2]);
    }
  });
});

describe('fenceAutoSide', () => {
  it('follows the camera across the cut', () => {
    for (const id of wells) {
      const fence = fenceFor(id);
      if (!fence) continue;
      const plus = fenceViewPose(fence, { ...RANGE, side: 1 });
      const minus = fenceViewPose(fence, { ...RANGE, side: -1 });
      const { index, field, curve } = fence.plus;
      const [px, pz] = eyeAt(plus);
      const [mx, mz] = eyeAt(minus);
      expect(fenceAutoSide(-1, index, field, curve.points, px, pz)).toBe(1);
      expect(fenceAutoSide(1, index, field, curve.points, mx, mz)).toBe(-1);
    }
  });

  /**
   * ⚠️⚠️ The regression this file exists for. `fenceSideAt`'s MAGNITUDE saturates a
   * few cells from the curve at `12 * field.cell` — a constant, and one that
   * differs per build because the cell size is fitted to a node budget. Deadbanding
   * that value instead of the true distance froze `auto` completely: measured 212.9
   * m on this data, so the story's 250 m deadband was never once exceeded.
   */
  it('is decisive far from the cut whatever the deadband', () => {
    const fence = fenceFor(wells[0]);
    if (!fence) return;
    const plus = fenceViewPose(fence, { ...RANGE, side: 1 });
    const { index, field, curve } = fence.plus;
    const [x, z] = eyeAt(plus);
    for (const deadband of [0, 50, 250, 1000]) {
      expect(
        fenceAutoSide(-1, index, field, curve.points, x, z, deadband),
      ).toBe(1);
    }
  });

  it('holds the side it has while the camera is on the cut', () => {
    const fence = fenceFor(wells[0]);
    if (!fence) return;
    const { index, field, curve } = fence.plus;
    // A vertex of the trace is as close to the cut as it is possible to be.
    const [x, z] = fence.base.points[fence.base.points.length >> 1];
    expect(fenceAutoSide(1, index, field, curve.points, x, z, 500)).toBe(1);
    expect(fenceAutoSide(-1, index, field, curve.points, x, z, 500)).toBe(-1);
    // Without a deadband it has to commit to whichever half it is a hair inside.
    expect([1, -1]).toContain(
      fenceAutoSide(1, index, field, curve.points, x, z),
    );
  });
});
