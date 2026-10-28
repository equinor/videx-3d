import { Vector3, type Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createOceanContactRegistry,
  type OceanContactSource,
} from '../src/components/Ocean/ocean-contact';
import {
  OceanMaterial,
  type OceanContact,
} from '../src/components/Ocean/ocean-material';
import {
  createOceanSampler,
  toOceanPlane,
  type OceanPlane,
} from '../src/components/Ocean/ocean-sampler';

// A grid turned from true north by `degrees` (a UTM grid's convergence), as Scenery's
// uSkyEast / uSkyNorth hold it: the plane's X true east, its Z true south.
function turned(degrees: number): OceanPlane {
  const a = (degrees * Math.PI) / 180;
  return {
    east: new Vector3(Math.cos(a), 0, Math.sin(a)),
    north: new Vector3(Math.sin(a), 0, -Math.cos(a)),
  };
}

const contact = (x: number, z: number, heading = 0): OceanContact => ({
  x,
  z,
  heading,
  halfLength: 100,
  halfWidth: 20,
  foamWidth: 5,
});

describe('toOceanPlane', () => {
  it('is the frame itself with the default east and north', () => {
    const plane = turned(0);
    expect(toOceanPlane(plane, 120, -340, { x: 0, z: 0 })).toEqual({
      x: 120,
      z: -340,
    });
  });

  it('turns a point by the grid convergence, keeping its distance', () => {
    const plane = turned(0.96);
    const p = toOceanPlane(plane, -750, 2140, { x: 0, z: 0 });
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(Math.hypot(-750, 2140), 6);
    // About 38 m off where the scene's X/Z put it, 2.3 km out.
    expect(Math.hypot(p.x + 750, p.z - 2140)).toBeGreaterThan(30);
  });
});

describe('createOceanSampler in a plane', () => {
  it('samples the waves at the point taken into the plane', () => {
    const m = new OceanMaterial();
    m.windSpeed = 10;
    m.time = 2;
    const plane = turned(0.96);
    const flat = createOceanSampler(m, 5);
    const planed = createOceanSampler(m, 5, plane);
    const p = toOceanPlane(plane, -750, 2140, { x: 0, z: 0 });
    expect(planed.getHeightAt(-750, 2140)).toBeCloseTo(
      flat.getHeightAt(p.x, p.z),
      9,
    );
    m.dispose();
  });
});

describe('createOceanContactRegistry', () => {
  const centres = (m: OceanMaterial) => {
    const a = m.uniforms.uContactA.value as Vector4[];
    const n = m.uniforms.uContactCount.value as number;
    return a.slice(0, n).map(v => [v.x, v.y]);
  };

  it('takes centres and headings into the plane, leaving the sources own', () => {
    const m = new OceanMaterial();
    const registry = createOceanContactRegistry();
    const own = contact(-750, 2140, 1.2);
    registry.register(() => own);
    const plane = turned(0.96);
    registry.upload(m, { plane });
    const p = toOceanPlane(plane, -750, 2140, { x: 0, z: 0 });
    const a = (m.uniforms.uContactA.value as Vector4[])[0];
    expect(a.x).toBeCloseTo(p.x, 9);
    expect(a.y).toBeCloseTo(p.z, 9);
    // The bow's way in the plane: the scene's turned the same way.
    const f = toOceanPlane(plane, Math.cos(1.2), -Math.sin(1.2), {
      x: 0,
      z: 0,
    });
    expect(a.z).toBeCloseTo(f.x, 9);
    expect(a.w).toBeCloseTo(f.z, 9);
    expect(own).toEqual(contact(-750, 2140, 1.2));
    m.dispose();
  });

  it('keeps the nearest the view when there are more than the material draws', () => {
    const m = new OceanMaterial({ contactCount: 3 });
    const registry = createOceanContactRegistry();
    const xs = [900, 100, 700, 300, 500];
    for (const x of xs) registry.register(() => contact(x, 0));
    registry.upload(m, { from: { x: 0, z: 0 } });
    expect(centres(m).map(c => c[0])).toEqual([100, 300, 500]);
    registry.upload(m, { from: { x: 1000, z: 0 } });
    expect(centres(m).map(c => c[0])).toEqual([900, 700, 500]);
    m.dispose();
  });

  it('keeps the first registered without a view, and skips those not touching', () => {
    const m = new OceanMaterial({ contactCount: 2 });
    const registry = createOceanContactRegistry();
    const sources: OceanContactSource[] = [
      () => contact(1, 0),
      () => null,
      () => contact(2, 0),
      () => contact(3, 0),
    ];
    const off = sources.map(s => registry.register(s));
    registry.upload(m);
    expect(centres(m).map(c => c[0])).toEqual([1, 2]);
    for (const unregister of off) unregister();
    registry.upload(m);
    expect(m.uniforms.uContactCount.value).toBe(0);
    m.dispose();
  });
});
