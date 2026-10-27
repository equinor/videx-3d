import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  createSceneryStageOutline,
  createSceneryStagePlane,
  SceneryStageBounds,
} from '../src/components/Scenery/scenery-stage';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../src/sdk/geometries/planar-geometry';

const bounds: SceneryStageBounds = [-6000, -6000, 6000, 6000];
const extent: SceneryStageBounds = [-50000, -50000, 50000, 50000];

const key = (x: number, z: number) =>
  `${Math.fround(x).toFixed(3)},${Math.fround(z).toFixed(3)}`;

/** The vertices on edges used by exactly one triangle. */
const boundary = (geometry: BufferGeometry) => {
  const index = geometry.getIndex()!.array;
  const p = geometry.getAttribute('position') as BufferAttribute;
  const counts = new Map<string, number>();
  for (let i = 0; i < index.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[i + e];
      const b = index[i + ((e + 1) % 3)];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const vertices = new Map<string, number>();
  for (const [k, n] of counts) {
    if (n !== 1) continue;
    for (const v of k.split('_').map(Number)) {
      vertices.set(key(p.getX(v), p.getZ(v)), p.getY(v));
    }
  }
  return vertices;
};

const onRectangle = (
  [x, z]: number[],
  [minX, minZ, maxX, maxZ]: SceneryStageBounds,
) => [x - minX, z - minZ, maxX - x, maxZ - z].some(d => Math.abs(d) < 1e-3);

describe('sky stage', () => {
  it('⭐ the plane is one piece: its only edge is the extent', () => {
    const plane = createSceneryStagePlane(bounds, extent);
    const edge = boundary(plane);
    expect(edge.size).toBeGreaterThan(0);
    for (const at of edge.keys()) {
      expect(onRectangle(at.split(',').map(Number), extent)).toBe(true);
    }
  });

  it('outlines every occupant, where its offset puts it', () => {
    const square = (size: number) =>
      [
        [
          [
            [0, 0],
            [size, 0],
            [size, size],
            [0, size],
            [0, 0],
          ],
        ],
      ] as PlanarPolygonCoordinates;
    const a = new PlanarPolygonGeometry(square(100));
    const b = new PlanarPolygonGeometry(square(10), [500, 700]);
    const lines = createSceneryStageOutline(bounds, [a, b], 0, -100);
    const position = lines.getAttribute('position') as BufferAttribute;
    // Each ring twice (at the seabed and at the surface), and the bounds once: as segments.
    expect(position.count).toBe(2 * (4 + 4) * 2 + 4 * 2);
    const points = new Set<string>();
    for (let i = 0; i < position.count; i++)
      points.add(key(position.getX(i), position.getZ(i)));
    expect(points.has(key(100, 100))).toBe(true);
    expect(points.has(key(510, 710))).toBe(true);
    expect(points.has(key(10, 10))).toBe(false);
  });
});
