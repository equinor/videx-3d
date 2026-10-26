import { describe, expect, it } from 'vitest';
import { geoFrameAt } from '../src/sdk/projection/geo-frame';
import {
  STAGE_GROUND_PREFIX,
  stageGroundHeight,
  stageGroundId,
  stageGroundRelief,
} from '../src/storybook/data/stage-ground';

describe('stageGroundRelief', () => {
  it('reads its place and size back from its id, and nothing from another', () => {
    const id = stageGroundId(1.9, 58.4, 16, 24);
    const ground = stageGroundRelief(id)!;
    expect(ground.meta.id).toBe(id);
    // In the stage's own map, so the scene's X/Z with no projection between.
    expect(ground.meta.crs).toBe(geoFrameAt(1.9, 58.4).projection);
    expect(ground.meta.grid.origin).toEqual([-8000, -12000]);
    expect(stageGroundRelief('etopo-2022-nordic')).toBeNull();
    expect(stageGroundRelief(`${STAGE_GROUND_PREFIX}1:58:wide:16`)).toBeNull();
  });

  it('lays the ground out in the scene: east along X, north along -Z, stretched with the stage', () => {
    // 32 x 16 km: twice the base stage east-west.
    const ground = stageGroundRelief(stageGroundId(2, 58, 32, 16))!;
    const [nx, ny] = ground.meta.grid.size;
    const values = ground.window({ level: 0, first: [0, 0], count: [nx, ny] });
    // Row 0 is the northern row: scene Z -8000.
    for (const [col, row] of [
      [0, 0],
      [100, 37],
      [640, 320],
      [377, 211],
    ]) {
      const x = -16000 + col * 50;
      const z = -8000 + row * 50;
      expect(values[row * nx + col]).toBeCloseTo(
        stageGroundHeight(x / 2, z),
        3,
      );
    }
  });

  it('rolls about the sea 100 m deep, its hills well above it, all below the sea', () => {
    expect(stageGroundHeight(1100, 700)).toBeCloseTo(-20, 0);
    const ground = stageGroundRelief(stageGroundId(2, 58, 16, 16))!;
    expect(ground.meta.max).toBeLessThan(0);
    expect(ground.meta.min).toBeLessThan(-100);
  });
});
