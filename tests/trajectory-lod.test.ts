import { describe, expect, it } from 'vitest';
import {
  radialSilhouetteError,
  trajectoryRadialLevels,
} from '../src/components/Wellbores/Trajectory/trajectory-geometry';
import { selectTrajectoryLod } from '../src/components/Wellbores/Trajectory/trajectory-lod';
import { selectLodLevel } from '../src/sdk/utils/lod';

function random(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe('selectTrajectoryLod', () => {
  it('picks what selecting every frame would, re-picking only outside its range', () => {
    const next = random(17);
    const tolerances = [0, 0.25, 1, 4, 16, 64];
    let picks = 0;
    let steps = 0;
    let mismatches = 0;
    for (let run = 0; run < 200; run++) {
      const sideErrors = trajectoryRadialLevels(4, [4, 8, 12, 32][run % 4]).map(
        radialSilhouetteError,
      );
      const perMetre = 300 + 900 * next();
      const radius = 0.1 + 10 * next();
      const floor = 0.25 + next();
      const pixelError = 0.1 + 2 * next();
      const state = new Float64Array([0, 0, 0, NaN, NaN]);
      let curve = 0;
      let radial = 0;
      let caps = 0;
      let distance = 10 ** (1 + 4 * next());
      for (let i = 0; i < 400; i++) {
        distance =
          next() < 0.05
            ? 10 ** (4 * next())
            : Math.max(0, distance * (1 + (next() - 0.5) * 0.2));
        const scale = perMetre / Math.max(distance, 1e-6);
        curve = selectLodLevel(tolerances, scale, pixelError, curve);
        radial = selectLodLevel(
          sideErrors,
          Math.max(radius * scale, floor),
          pixelError,
          radial,
        );
        caps = selectLodLevel([0, 1], radius * scale, pixelError, caps);
        if (!(distance >= state[3] && distance < state[4])) {
          selectTrajectoryLod(
            state,
            distance,
            perMetre,
            false,
            tolerances,
            sideErrors,
            radius,
            floor,
            pixelError,
          );
          picks++;
        }
        steps++;
        if (state[0] !== curve || state[1] !== radial || state[2] !== caps)
          mismatches++;
      }
    }
    expect(mismatches).toBe(0);
    expect(picks).toBeLessThan(steps / 5);
  });

  it('keeps the caps until the radius on screen is within the pixel error', () => {
    const sideErrors = [12, 6, 4].map(radialSilhouetteError);
    const state = new Float64Array([0, 0, 0, NaN, NaN]);
    // radius 1 px: four sides already do (0.29 px), dropping the caps would not (1 px)
    selectTrajectoryLod(state, 1000, 1000, false, [0], sideErrors, 1, 0.5, 0.5);
    expect(state[1]).toBe(2);
    expect(state[2]).toBe(0);
    // radius 0.25 px, drawn at the 0.5 px floor: dropping them is within the error
    selectTrajectoryLod(state, 4000, 1000, false, [0], sideErrors, 1, 0.5, 0.5);
    expect(state[2]).toBe(1);
  });

  it('keeps one pick for an orthographic view at any distance', () => {
    const state = new Float64Array([0, 0, 0, NaN, NaN]);
    selectTrajectoryLod(
      state,
      5,
      0.5,
      true,
      [0, 1, 4],
      [0.03, 0.29],
      2,
      1,
      0.5,
    );
    expect(state[3]).toBe(0);
    expect(state[4]).toBe(Infinity);
    expect(state[0]).toBe(selectLodLevel([0, 1, 4], 0.5, 0.5, 0));
  });
});
