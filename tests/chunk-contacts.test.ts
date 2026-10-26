import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  buildChannelDepthMap,
  buildSurfaceDepthMap,
  sameStackBedGrid,
} from '../src/components/Chunks/chunk-depth-map';
import type { StackBedGrid } from '../src/components/Chunks/chunk-defs';
import { surfaceGridToWorld } from '../src/sdk/geometries/surface-clip';
import { SurfaceMeta } from '../src/sdk';

/**
 * A depth map is sampled from OBJECT XZ, so its affine has to be the exact inverse
 * of the placement the geometry is built with. A sign error here draws a contact
 * line (or reads a bathymetry depth) in the right place on a north-up grid and in
 * the wrong place on a rotated one, which is every real survey.
 */
describe('surface depth map', () => {
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

  it.each([0, 220])(
    'maps object XZ back to the node it came from (rot %i)',
    rot => {
      const surface = meta(rot);
      const values = new Float32Array(nx * ny).fill(150);
      const { toUv } = buildSurfaceDepthMap(surface, values, utmToScene);
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
    },
  );

  it('carries scene Y and validity, and marks nodata invalid', () => {
    const surface = meta(0);
    const values = new Float32Array(nx * ny).fill(150);
    values[3] = -1;
    const { texture } = buildSurfaceDepthMap(surface, values, utmToScene);
    const data = texture.image.data as Float32Array;

    // Stored as `max - depth`, so a value of 150 is a depth of 50 => scene Y -50.
    expect(data[0]).toBe(-50);
    expect(data[1]).toBe(1);
    expect(data[2 * 3 + 1]).toBe(0);
  });
});

/**
 * The bed tint reads the column's bed CHANNEL (from `stackWater`), so it sits on the
 * bed the sea and the chunks are built on — the relief, on a relief column — instead of
 * the raw bed surface a few metres off it.
 */
describe('channel depth map', () => {
  const nx = 6;
  const ny = 4;
  const bed = (rot: number, origin: [number, number]): StackBedGrid => {
    const heights = new Float32Array(nx * ny);
    const valid = new Uint8Array(nx * ny).fill(1);
    for (let i = 0; i < heights.length; i++) heights[i] = -80 - i;
    valid[5] = 0;
    return {
      header: { nx, ny, xinc: 50, yinc: 50, rot },
      worldPosition: origin,
      heights,
      valid,
    };
  };

  it.each([0, 220])(
    'maps a node scene position to its texel centre (rot %i)',
    rot => {
      const grid = bed(rot, [-1200, 340]);
      const { toUv, cellSize } = buildChannelDepthMap(grid);
      const toWorld = surfaceGridToWorld(grid.header, grid.worldPosition);
      expect(cellSize).toBe(50);

      for (const [col, row] of [
        [0, 0],
        [nx - 1, ny - 1],
        [2, 3],
      ]) {
        const [x, z] = toWorld(col, row);
        const uv = new Vector3(x, z, 1).applyMatrix3(toUv);
        expect(uv.x * nx - 0.5).toBeCloseTo(col, 6);
        expect(uv.y * ny - 0.5).toBeCloseTo(row, 6);
      }
    },
  );

  it('carries the channel heights as they are, and its validity', () => {
    const { texture } = buildChannelDepthMap(bed(0, [0, 0]));
    const data = texture.image.data as Float32Array;
    expect(data[0]).toBe(-80);
    expect(data[1]).toBe(1);
    // An unmapped node keeps its filled height: the shader rejects it by G alone.
    expect(data[2 * 5]).toBe(-85);
    expect(data[2 * 5 + 1]).toBe(0);
  });

  it('tells the same bed from a changed one', () => {
    const a = bed(0, [0, 0]);
    expect(sameStackBedGrid(a, bed(0, [0, 0]))).toBe(true);
    expect(sameStackBedGrid(a, bed(0, [10, 0]))).toBe(false);
    expect(sameStackBedGrid(a, bed(90, [0, 0]))).toBe(false);
    const moved = bed(0, [0, 0]);
    moved.heights[7] += 0.5;
    expect(sameStackBedGrid(a, moved)).toBe(false);
    const unmapped = bed(0, [0, 0]);
    unmapped.valid[0] = 0;
    expect(sameStackBedGrid(a, unmapped)).toBe(false);
  });
});
