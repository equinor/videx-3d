import { describe, expect, it } from 'vitest';
import {
  domeRelief,
  evaluateRelief,
  rampRelief,
  reliefDepth,
} from '../src/sdk/geometries/procedural-relief';

describe('rampRelief', () => {
  // Rising toward +X, over 1000 m about the origin.
  const at = (x: number) => rampRelief(x, 0, 90, 1000);

  it('runs from 0 on the low side to 1 on the high side', () => {
    expect(at(-5000)).toBe(0);
    expect(at(-500)).toBe(0);
    expect(at(0)).toBeCloseTo(0.5, 6);
    expect(at(500)).toBe(1);
    expect(at(5000)).toBe(1);
  });

  it('⭐ is FLAT at both ends — a basin and a shelf, not a tilt', () => {
    // The gradient at the ends is what tells it apart from `dip`: a linear ramp
    // would climb at the same rate there as in the middle.
    const endSlope = at(-480) - at(-500);
    const midSlope = at(10) - at(-10);
    expect(endSlope).toBeLessThan(midSlope / 10);
  });

  it('rises along its azimuth and nowhere else', () => {
    // 90° = +X, so +Z is across the slope and must not change it.
    expect(rampRelief(200, 3000, 90, 1000)).toBeCloseTo(
      rampRelief(200, -3000, 90, 1000),
      6,
    );
  });
});

describe('domeRelief', () => {
  const center: [number, number] = [1000, -500];

  it('is full in the middle and gone at the radius', () => {
    expect(domeRelief(center[0], center[1], center, 800)).toBe(1);
    expect(domeRelief(center[0] + 800, center[1], center, 800)).toBe(0);
    expect(domeRelief(center[0] + 5000, center[1], center, 800)).toBe(0);
  });

  it('⭐ a narrow rim gives a PLATEAU, a wide one a dome', () => {
    // Halfway out: a mesa is still at full height there, a smooth dome is not.
    const mesa = domeRelief(center[0] + 400, center[1], center, 800, 100);
    const dome = domeRelief(center[0] + 400, center[1], center, 800);
    expect(mesa).toBe(1);
    expect(dome).toBeCloseTo(0.5, 6);
  });
});

describe('relief modes', () => {
  const dome = {
    kind: 'dome' as const,
    amplitude: 100,
    center: [0, 0] as [number, number],
    radius: 500,
  };

  it('“above” keeps the base as the low point', () => {
    expect(evaluateRelief({ ...dome, mode: 'above' }, 0, 0)).toBe(100);
    // ⭐ Nothing OUTSIDE it — which is the whole point for a landform, and what
    // the default centring cannot express: it would dig a moat round the island.
    expect(evaluateRelief({ ...dome, mode: 'above' }, 2000, 0)).toBe(0);
    expect(evaluateRelief(dome, 2000, 0)).toBe(-50);
  });

  it('reads the other way round in depth', () => {
    // Positive-down: raising a landform makes its depth smaller.
    expect(reliefDepth({ ...dome, mode: 'above' }, 0, 0)).toBe(-100);
  });
});
