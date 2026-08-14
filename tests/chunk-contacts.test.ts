import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildContactMap } from '../src/components/Chunks/chunk-contacts';
import { surfaceGridToWorld } from '../src/sdk/geometries/surface-clip';
import { SurfaceMeta } from '../src/sdk';

/**
 * The contact texture is sampled from OBJECT XZ, so its affine has to be the exact
 * inverse of the placement the geometry is built with. A sign error here draws the
 * line in the right place on a north-up grid and in the wrong place on a rotated
 * one, which is every real survey.
 */
describe('contact texture', () => {
  const nx = 8;
  const ny = 5;
  const meta = (rot: number): SurfaceMeta => ({
    id: 'contact',
    name: 'OWC',
    projection: '31N',
    min: 100,
    max: 200,
    displayMin: 100,
    displayMax: 200,
    color: 'black',
    visualization: 'depth',
    header: {
      nx,
      ny,
      xinc: 25,
      yinc: 25,
      rot,
      xori: 474000,
      yori: 6522000,
      xmax: 474000 + nx * 25,
      ymax: 6522000 + ny * 25,
    },
  });

  // The grid origin lands at the scene origin, as `UtmArea` would place it.
  const utmToScene = (e: number, n: number): [number, number, number] => [
    e - 474000,
    0,
    n - 6522000,
  ];

  it.each([0, 220])('maps object XZ back to the node it came from (rot %i)', rot => {
    const surface = meta(rot);
    const values = new Float32Array(nx * ny).fill(150);
    const { toUv } = buildContactMap(surface, values, utmToScene);
    const toWorld = surfaceGridToWorld(surface.header, [0, 0]);

    for (const [col, row] of [
      [0, 0],
      [nx - 1, ny - 1],
      [3, 2],
    ]) {
      const [x, z] = toWorld(col, row);
      const uv = new Vector3(x, z, 1).applyMatrix3(toUv);
      expect(uv.x * nx - 0.5).toBeCloseTo(col, 6);
      expect(uv.y * ny - 0.5).toBeCloseTo(row, 6);
    }
  });

  it('carries scene Y and validity, and marks nodata invalid', () => {
    const surface = meta(0);
    const values = new Float32Array(nx * ny).fill(150);
    values[3] = -1;
    const { texture } = buildContactMap(surface, values, utmToScene);
    const data = texture.image.data as Float32Array;

    // Stored as `max - depth`, so a value of 150 is a depth of 50 => scene Y -50.
    expect(data[0]).toBe(-50);
    expect(data[1]).toBe(1);
    expect(data[2 * 3 + 1]).toBe(0);
  });
});
