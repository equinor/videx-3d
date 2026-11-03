import {
  DataArrayTexture,
  Group,
  IUniform,
  Matrix4,
  Uniform,
  Vector3,
  Vector4,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  SKY_RELIEF_MAX_REGIONS,
  SceneryReliefRegion,
  SceneryReliefRegions,
  setReliefRegions,
} from '../src/components/Scenery/scenery-relief-tiles';
import { Boundary, boundaryContains } from '../src/sdk/geometries/boundary';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { polygonDistanceAt } from '../src/sdk/geometries/polygon-distance-field';
import type { Vec2 } from '../src/sdk/types/common';

// The relief's see-through regions (world.md, step 7e): the anchored stage in world X/Z, and
// each loaded field in its own frame, as relief-tiles.glsl's reliefTileInRegion tests them —
// a box (turned or not), a circle or a polygon.
function uniforms(): Record<string, IUniform> {
  return {
    uReliefRegionCount: new Uniform(0),
    uReliefRegions: new Uniform(
      Array.from({ length: SKY_RELIEF_MAX_REGIONS }, () => new Matrix4()),
    ),
    uReliefRegionKinds: new Uniform(
      Array.from({ length: SKY_RELIEF_MAX_REGIONS }, () => 0),
    ),
    uReliefRegionShapes: new Uniform(
      Array.from({ length: SKY_RELIEF_MAX_REGIONS }, () => new Vector4()),
    ),
    uReliefRegionFields: new Uniform<DataArrayTexture | null>(null),
  };
}

// The shader's test, on the CPU.
function inRegion(u: Record<string, IUniform>, world: Vector3) {
  const count = u.uReliefRegionCount.value as number;
  const matrices = u.uReliefRegions.value as Matrix4[];
  const kinds = u.uReliefRegionKinds.value as number[];
  const shapes = u.uReliefRegionShapes.value as Vector4[];
  const fields = u.uReliefRegionFields.value as DataArrayTexture | null;
  for (let i = 0; i < count; i++) {
    const p = world.clone().applyMatrix4(matrices[i]);
    const s = shapes[i];
    let inside: boolean;
    if (kinds[i] === 1) inside = Math.hypot(p.x - s.x, p.z - s.y) < s.z;
    else if (kinds[i] === 2) {
      const size = fields!.image.width;
      const layer = Math.round(s.w);
      const values = (fields!.image.data as Float32Array).subarray(
        layer * size * size,
        (layer + 1) * size * size,
      );
      inside =
        polygonDistanceAt(
          { values, size, origin: [s.x, s.y], cell: s.z, band: 0 },
          p.x,
          p.z,
        ) > 0;
    } else inside = p.x >= s.x && p.z >= s.y && p.x < s.z && p.z < s.w;
    if (inside) return true;
  }
  return false;
}

const set = (
  u: Record<string, IUniform>,
  regions: SceneryReliefRegion[],
  eye: [number, number] = [0, 0],
  boxes: [number, number, number, number][] = [],
) => setReliefRegions(u, new SceneryReliefRegions(regions), eye, boxes);

// Every point of a grid over `[minX, minZ, maxX, maxZ]` (in the region's own X/Z) further
// than `margin` from the boundary's edge: the shader's test and boundaryContains agree there.
function agrees(
  u: Record<string, IUniform>,
  boundary: Boundary,
  area: [number, number, number, number],
  margin: number,
  object?: Group,
) {
  const [minX, minZ, maxX, maxZ] = area;
  let tested = 0;
  for (let j = 0; j <= 40; j++) {
    for (let i = 0; i <= 40; i++) {
      const x = minX + ((maxX - minX) * (i + 0.37)) / 41;
      const z = minZ + ((maxZ - minZ) * (j + 0.61)) / 41;
      const inside = boundaryContains(boundary, x, z);
      const near = [
        [margin, 0],
        [-margin, 0],
        [0, margin],
        [0, -margin],
      ].some(
        ([dx, dz]) => boundaryContains(boundary, x + dx, z + dz) !== inside,
      );
      if (near) continue;
      const world = new Vector3(x, -150, z);
      if (object) world.applyMatrix4(object.matrixWorld);
      expect(inRegion(u, world), `${x}, ${z}`).toBe(inside);
      tested++;
    }
  }
  expect(tested).toBeGreaterThan(1000);
}

// A field placed 123 km east of the anchor, turned and tilted on the globe.
function placedField() {
  const field = new Group();
  field.position.set(123000, -1178, -4000);
  field.rotation.set(0.0005, 0.016, -0.019);
  field.updateMatrixWorld();
  return field;
}

describe('setReliefRegions', () => {
  it('tests the anchored stage in world X/Z', () => {
    const u = uniforms();
    const boxes: [number, number, number, number][] = [];
    const count = set(
      u,
      [{ boundary: [-8000, -8000, 8000, 8000] }],
      [0, 0],
      boxes,
    );
    expect(count).toBe(1);
    expect(boxes).toEqual([[-8000, -8000, 8000, 8000]]);
    expect(inRegion(u, new Vector3(7999, -100, -7999))).toBe(true);
    expect(inRegion(u, new Vector3(8001, -100, 0))).toBe(false);
  });

  it('tests a field in its own frame: placed 123 km east, turned and tilted', () => {
    const field = placedField();
    const u = uniforms();
    const boxes: [number, number, number, number][] = [];
    set(
      u,
      [{ object: field, boundary: [-13500, -13500, 13500, 13500] }],
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
    const regions = new SceneryReliefRegions([
      { object: field, boundary: [-100, -100, 100, 100] },
    ]);
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
    const regions = Array.from(
      { length: SKY_RELIEF_MAX_REGIONS + 3 },
      (_, i): SceneryReliefRegion => ({
        boundary: [i * 1000, 0, i * 1000 + 500, 500],
      }),
    );
    const count = set(u, regions, [100000, 0], boxes);
    expect(count).toBe(SKY_RELIEF_MAX_REGIONS);
    // The farthest from the eye, at the start, are the ones left out.
    expect(boxes.some(([minX]) => minX === 0)).toBe(false);
    expect(
      boxes.some(([minX]) => minX === (SKY_RELIEF_MAX_REGIONS + 2) * 1000),
    ).toBe(true);
  });

  it('leaves out a region of no area', () => {
    const u = uniforms();
    expect(
      set(u, [
        { boundary: [0, 0, 0, 0] },
        { boundary: { centre: [0, 0], radius: 0 } },
        {
          boundary: [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
        },
      ]),
    ).toBe(0);
  });

  it('tests a turned box as boundaryContains does, placed or not', () => {
    const turned: Boundary = {
      box: [-13500, -6500, 13500, 6500],
      rotation: Math.PI / 6,
    };
    const area: [number, number, number, number] = [
      -16000, -16000, 16000, 16000,
    ];
    const u = uniforms();
    const boxes: [number, number, number, number][] = [];
    set(u, [{ boundary: turned }], [0, 0], boxes);
    agrees(u, turned, area, 1);
    // Its box in world X/Z holds the turned corners, not the unturned ones' only.
    const [minX, , maxX] = boxes[0];
    expect(maxX - minX).toBeCloseTo(
      27000 * Math.cos(Math.PI / 6) + 13000 * Math.sin(Math.PI / 6),
      6,
    );
    const field = placedField();
    set(u, [{ object: field, boundary: turned }]);
    agrees(u, turned, area, 1, field);
  });

  it('tests a circle as boundaryContains does', () => {
    const circle: Boundary = { centre: [2000, -1000], radius: 9000 };
    const u = uniforms();
    const boxes: [number, number, number, number][] = [];
    set(u, [{ boundary: circle }], [0, 0], boxes);
    expect(boxes[0]).toEqual([-7000, -10000, 11000, 8000]);
    agrees(u, circle, [-10000, -12000, 14000, 10000], 1);
    const field = placedField();
    set(u, [{ object: field, boundary: circle }]);
    agrees(u, circle, [-10000, -12000, 14000, 10000], 1, field);
  });

  it('tests polygons by their outlines’ fields, each its own layer', () => {
    // An L in world X/Z, and in a placed field a square with a hole in it.
    const ell: Vec2[] = [
      [-8000, -8000],
      [8000, -8000],
      [8000, 0],
      [0, 0],
      [0, 8000],
      [-8000, 8000],
    ];
    const holed = new PlanarPolygonGeometry([
      [
        [
          [0, -5000],
          [10000, -5000],
          [10000, 5000],
          [0, 5000],
        ],
        [
          [3000, -2000],
          [7000, -2000],
          [7000, 2000],
          [3000, 2000],
        ],
      ],
    ]);
    holed.setOffset([-20000, 0]);
    const u = uniforms();
    const field = placedField();
    set(u, [
      { boundary: ell },
      { object: field, boundary: holed },
      { boundary: { centre: [0, 30000], radius: 1000 } },
    ]);
    const fields = u.uReliefRegionFields.value as DataArrayTexture;
    expect(fields.image.depth).toBe(2);
    // Within a texel of the edge the field's corners are rounded: tested past two.
    const shapes = u.uReliefRegionShapes.value as Vector4[];
    agrees(u, ell, [-10000, -10000, 10000, 10000], 2 * shapes[0].z);
    agrees(u, holed, [18000, -7000, 32000, 7000], 2 * shapes[1].z, field);
    expect(
      inRegion(u, new Vector3(25000, -150, 0).applyMatrix4(field.matrixWorld)),
    ).toBe(false);
    expect(inRegion(u, new Vector3(0, 0, 30000))).toBe(true);
  });
});
