import { describe, expect, it } from 'vitest';
import {
  skyWaterDimming,
  skyZone,
  SkyZoneLevels,
} from '../src/components/Sky/sky-model';

const sea: SkyZoneLevels = {
  ocean: true,
  oceanLevel: 0,
  oceanDepth: 100,
  oceanWater: true,
  oceanDrained: false,
  // As Sky sets it: the ocean turns the abyss on at its seabed.
  abyss: true,
  abyssLevel: -100,
  background: true,
};

describe('skyZone', () => {
  it('is air over the sea, water in it and the studio below its seabed', () => {
    expect(skyZone(500, sea)).toBe('air');
    expect(skyZone(-50, sea)).toBe('water');
    expect(skyZone(-150, sea)).toBe('subsurface');
  });

  it('is air down to the seabed where the sea is dry or drained', () => {
    expect(skyZone(-50, { ...sea, oceanWater: false })).toBe('air');
    expect(skyZone(-50, { ...sea, oceanDrained: true })).toBe('air');
    expect(skyZone(-150, { ...sea, oceanDrained: true })).toBe('subsurface');
  });

  it('follows the abyss level without a sea', () => {
    const abyss = { ...sea, ocean: false, abyssLevel: 20 };
    expect(skyZone(30, abyss)).toBe('air');
    expect(skyZone(10, abyss)).toBe('subsurface');
    expect(skyZone(-1e6, { ...abyss, abyss: false })).toBe('air');
  });

  it("takes an occupant's seabed under the camera for the sea's", () => {
    // Inside a hill rising above the sea's seabed: in the ground.
    expect(skyZone(-60, { ...sea, oceanGround: -20 })).toBe('subsurface');
    // In a valley sunk below it: in the water.
    expect(skyZone(-120, { ...sea, oceanGround: -150 })).toBe('water');
    expect(skyZone(-60, { ...sea, oceanGround: null })).toBe('water');
  });

  it('is all studio when the sky is not drawn', () => {
    expect(skyZone(500, { ...sea, background: false })).toBe('subsurface');
  });
});

describe('skyWaterDimming', () => {
  it('is 1 down to the water bake and dims as the sea dims its seabed', () => {
    expect(skyWaterDimming(0.5, 0.004)).toBe(1);
    expect(skyWaterDimming(101, 0.004)).toBeCloseTo(Math.exp(-100 * 0.002));
    expect(skyWaterDimming(101, 0)).toBe(1);
  });
});
