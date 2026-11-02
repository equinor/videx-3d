import { Group, IUniform, Matrix4, Uniform, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  SKY_RELIEF_MAX_REGIONS,
  setReliefRegions,
} from '../src/components/Scenery/scenery-relief-tiles';

// The relief's see-through regions (world.md, step 7e): the anchored stage in world X/Z, and
// each loaded field in its own frame, as relief-tiles.glsl's reliefTileInRegion tests them.
function uniforms(): Record<string, IUniform> {
  return {
    uReliefRegionCount: new Uniform(0),
    uReliefRegions: new Uniform(
      Array.from({ length: SKY_RELIEF_MAX_REGIONS }, () => new Matrix4()),
    ),
    uReliefRegionBounds: new Uniform(
      Array.from({ length: SKY_RELIEF_MAX_REGIONS }, () => new Vector4()),
    ),
  };
}

// The shader's test, on the CPU.
function inRegion(u: Record<string, IUniform>, world: Vector3) {
  const count = u.uReliefRegionCount.value as number;
  const matrices = u.uReliefRegions.value as Matrix4[];
  const areas = u.uReliefRegionBounds.value as Vector4[];
  for (let i = 0; i < count; i++) {
    const p = world.clone().applyMatrix4(matrices[i]);
    const a = areas[i];
    if (p.x >= a.x && p.z >= a.y && p.x < a.z && p.z < a.w) return true;
  }
  return false;
}

describe('setReliefRegions', () => {
  it('tests the anchored stage in world X/Z', () => {
    const u = uniforms();
    const boxes: [number, number, number, number][] = [];
    const count = setReliefRegions(
      u,
      [{ bounds: [-8000, -8000, 8000, 8000] }],
      [0, 0],
      boxes,
    );
    expect(count).toBe(1);
    expect(boxes).toEqual([[-8000, -8000, 8000, 8000]]);
    expect(inRegion(u, new Vector3(7999, -100, -7999))).toBe(true);
    expect(inRegion(u, new Vector3(8001, -100, 0))).toBe(false);
  });

  it('tests a field in its own frame: placed 123 km east, turned and tilted', () => {
    const field = new Group();
    field.position.set(123000, -1178, -4000);
    field.rotation.set(0.0005, 0.016, -0.019);
    const u = uniforms();
    const boxes: [number, number, number, number][] = [];
    setReliefRegions(
      u,
      [{ object: field, bounds: [-13500, -13500, 13500, 13500] }],
      [0, 0],
      boxes,
    );
    // A point of the field's own, near its corner, wherever it now lies in the world.
    const corner = new Vector3(13400, -150, -13400).applyMatrix4(
      field.matrixWorld,
    );
    expect(inRegion(u, corner)).toBe(true);
    const past = new Vector3(13600, -150, -13400).applyMatrix4(
      field.matrixWorld,
    );
    expect(inRegion(u, past)).toBe(false);
    // Its box in world X/Z holds its corners.
    const [minX, minZ, maxX, maxZ] = boxes[0];
    expect(corner.x).toBeGreaterThan(minX);
    expect(corner.x).toBeLessThan(maxX);
    expect(corner.z).toBeGreaterThan(minZ);
    expect(corner.z).toBeLessThan(maxZ);
  });

  it('follows a field as it moves: read through its placement each time', () => {
    const field = new Group();
    const u = uniforms();
    const regions = [
      { object: field, bounds: [-100, -100, 100, 100] as [number, number, number, number] },
    ];
    setReliefRegions(u, regions, [0, 0], []);
    expect(inRegion(u, new Vector3(0, 0, 0))).toBe(true);
    field.position.set(5000, 0, 0);
    setReliefRegions(u, regions, [0, 0], []);
    expect(inRegion(u, new Vector3(0, 0, 0))).toBe(false);
    expect(inRegion(u, new Vector3(5000, 0, 0))).toBe(true);
  });

  it('keeps the nearest when there are more than it tells apart', () => {
    const u = uniforms();
    const boxes: [number, number, number, number][] = [];
    const regions = Array.from({ length: SKY_RELIEF_MAX_REGIONS + 3 }, (_, i) => ({
      bounds: [i * 1000, 0, i * 1000 + 500, 500] as [
        number,
        number,
        number,
        number,
      ],
    }));
    const count = setReliefRegions(u, regions, [100000, 0], boxes);
    expect(count).toBe(SKY_RELIEF_MAX_REGIONS);
    // The farthest from the eye, at the start, are the ones left out.
    expect(boxes.some(([minX]) => minX === 0)).toBe(false);
    expect(boxes.some(([minX]) => minX === (SKY_RELIEF_MAX_REGIONS + 2) * 1000)).toBe(
      true,
    );
  });
});
