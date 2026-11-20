import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { skyAirFrame } from '../src/components/Scenery/scenery-air-colors';

describe('skyAirFrame', () => {
  const skyEast = new Vector3(1, 0, 0);
  const skyNorth = new Vector3(0, 0, -1);
  const frameAbout = (look: Vector3) => {
    const east = new Vector3();
    const north = new Vector3();
    skyAirFrame(look, skyEast, skyNorth, east, north);
    expect(east.length()).toBeCloseTo(1, 6);
    expect(north.length()).toBeCloseTo(1, 6);
    expect(east.dot(look)).toBeCloseTo(0, 6);
    expect(north.dot(look)).toBeCloseTo(0, 6);
    expect(east.dot(north)).toBeCloseTo(0, 6);
    return { east, north };
  };

  it('is the sky east and north under the scene up', () => {
    const { east, north } = frameAbout(new Vector3(0, 1, 0));
    expect(east.distanceTo(skyEast)).toBeLessThan(1e-6);
    expect(north.distanceTo(skyNorth)).toBeLessThan(1e-6);
  });

  it('stays a frame where the look lies along east, far round the Earth', () => {
    // There east is the sky's north made level.
    expect(
      frameAbout(new Vector3(1, 0, 0)).east.distanceTo(skyNorth),
    ).toBeLessThan(1e-6);
    frameAbout(new Vector3(-1, 0, 0));
    frameAbout(new Vector3(0.95, 0.31, 0).normalize());
  });
});
