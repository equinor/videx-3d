import { describe, expect, it } from 'vitest';
import {
  skyStarFrame,
  skySunColor,
  skyTwilight,
  skyWaterDimming,
  skyZone,
  SkyZoneLevels,
} from '../src/components/Sky/sky-model';
import type { Vec3 } from '../src/sdk/types/common';
import { directionFromCompass } from '../src/sdk/utils/vector-operations';

const sea: SkyZoneLevels = {
  ocean: true,
  oceanLevel: 0,
  oceanDepth: 100,
  oceanWater: true,
  // As Sky sets it: the ocean turns the abyss on at its seabed.
  abyss: true,
  abyssLevel: -100,
  background: true,
};

describe('skyZone', () => {
  it('is air over the sea, water in it and the subsurface below its seabed', () => {
    expect(skyZone(500, sea)).toBe('air');
    expect(skyZone(-50, sea)).toBe('water');
    expect(skyZone(-150, sea)).toBe('subsurface');
  });

  it('is air down to the seabed where the sea is dry', () => {
    expect(skyZone(-50, { ...sea, oceanWater: false })).toBe('air');
    expect(skyZone(-150, { ...sea, oceanWater: false })).toBe('subsurface');
  });

  it('never puts the camera in the water with a cutaway', () => {
    const cut = { ...sea, cutaway: true };
    expect(skyZone(500, cut)).toBe('air');
    expect(skyZone(-50, cut)).toBe('air');
    expect(skyZone(-150, cut)).toBe('subsurface');
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

  it('is all subsurface when the sky is not drawn', () => {
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

describe('skyTwilight', () => {
  it('glows about sunrise and sunset only, most with the sun near the horizon', () => {
    expect(skyTwilight(35)).toBe(0);
    expect(skyTwilight(-25)).toBe(0);
    expect(skyTwilight(0)).toBe(1);
    expect(skyTwilight(-2)).toBe(1);
    expect(skyTwilight(-8)).toBeGreaterThan(0);
    expect(skyTwilight(-8)).toBeLessThan(1);
    expect(skyTwilight(6)).toBeGreaterThan(0);
    expect(skyTwilight(6)).toBeLessThan(skyTwilight(0));
  });
});

describe('skySunColor', () => {
  it('runs from red-orange on the horizon to near white high up, without a jump', () => {
    const low = skySunColor(-2);
    const high = skySunColor(40);
    expect(low.r / low.b).toBeGreaterThan(high.r / high.b);
    expect(high.equals(skySunColor(25))).toBe(true);
    const below = skySunColor(5.999);
    const above = skySunColor(6.001);
    expect(Math.abs(below.g - above.g)).toBeLessThan(1e-3);
  });
});

describe('skyStarFrame', () => {
  const apply = (rows: Vec3[], dir: Vec3) =>
    rows.map(r => r[0] * dir[0] + r[1] * dir[1] + r[2] * dir[2]);
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // A day's suns at 58° N, by azimuth and elevation.
  const suns: [number, number][] = [
    [90, 5],
    [135, 25],
    [180, 32],
    [225, 25],
    [270, 5],
    [0, -10],
  ];

  it('is a rotation', () => {
    for (const [az, el] of suns) {
      const rows = skyStarFrame(az, el, 58);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++)
          expect(dot(rows[i], rows[j])).toBeCloseTo(i === j ? 1 : 0, 9);
      }
    }
  });

  it('keeps the sun on one meridian of the star sphere', () => {
    for (const [az, el] of suns) {
      const [x, y] = apply(
        skyStarFrame(az, el, 58),
        directionFromCompass(az, el),
      );
      expect(y).toBeCloseTo(0, 9);
      expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it('turns about the celestial pole, which stays put', () => {
    const pole = directionFromCompass(0, 58);
    for (const [az, el] of suns)
      expect(apply(skyStarFrame(az, el, 58), pole)[2]).toBeCloseTo(1, 9);
    // The zenith is a different place on the sphere morning and evening.
    const zenith: Vec3 = [0, 1, 0];
    const morning = apply(skyStarFrame(90, 5, 58), zenith);
    const evening = apply(skyStarFrame(270, 5, 58), zenith);
    expect(
      Math.hypot(morning[0] - evening[0], morning[1] - evening[1]),
    ).toBeGreaterThan(1);
  });
});
