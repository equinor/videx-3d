import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  createSkyStageBed,
  createSkyStagePlane,
  createSkyStageRelief,
  createSkyStageRings,
  createSkyStageSeabed,
  SkyStageBounds,
  skyStageRim,
} from '../src/components/Sky/sky-stage';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../src/sdk/geometries/planar-geometry';
import type { SeabedMesh } from '../src/sdk/geometries/surface-clip';

const BED_Y = -100;
const near: SkyStageBounds = [-6000, -6000, 6000, 6000];
const extent: SkyStageBounds = [-50000, -50000, 50000, 50000];
const ring: [number, number][] = [];
for (let j = 0; j < 96; j++) {
  const a = (j / 96) * Math.PI * 2;
  const r = 3000 * (1 + 0.2 * Math.sin(3 * a));
  ring.push([r * Math.cos(a), r * Math.sin(a)]);
}
const outline = new PlanarPolygonGeometry([[ring]] as PlanarPolygonCoordinates);
const heightAt = (x: number, z: number) => BED_Y + 0.01 * x - 0.005 * z;
const elevations = [[ring.map(([x, z]) => heightAt(x, z))]];

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
  [minX, minZ, maxX, maxZ]: SkyStageBounds = near,
) => [x - minX, z - minZ, maxX - x, maxZ - z].some(d => Math.abs(d) < 1e-3);

// An occupant's seabed: polar rings from a hole of radius 500 out to the outline, whose
// outer ring IS the outline, at `heightAt`.
const HOLE_RADIUS = 500;
const hole: [number, number][] = ring.map(([x, z]) => {
  const r = Math.hypot(x, z);
  return [(x / r) * HOLE_RADIUS, (z / r) * HOLE_RADIUS];
});
const seabed: SeabedMesh = (() => {
  const RINGS = 8;
  const n = ring.length;
  const positions: number[] = [];
  for (let k = 0; k <= RINGS; k++) {
    const t = k / RINGS;
    for (let j = 0; j < n; j++) {
      const x = hole[j][0] + (ring[j][0] - hole[j][0]) * t;
      const z = hole[j][1] + (ring[j][1] - hole[j][1]) * t;
      positions.push(x, heightAt(x, z), z);
    }
  }
  const at = (k: number, j: number) => k * n + (j % n);
  const indices: number[] = [];
  for (let k = 1; k <= RINGS; k++) {
    for (let j = 0; j < n; j++) {
      indices.push(at(k - 1, j), at(k - 1, j + 1), at(k, j));
      indices.push(at(k, j), at(k - 1, j + 1), at(k, j + 1));
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
})();

const keys = (points: number[][]) => new Set(points.map(([x, z]) => key(x, z)));

describe('sky stage caps', () => {
  it('⭐ the relief meets the walls at the elevations and the far rings at the bed', () => {
    const relief = createSkyStageRelief(near, outline, elevations, BED_Y, 2000);
    const rim = boundary(relief);
    for (const [x, z] of ring) {
      expect(rim.get(key(x, z))).toBeCloseTo(heightAt(x, z), 3);
    }
    for (const [at, y] of rim) {
      const [x, z] = at.split(',').map(Number);
      if (ring.some(p => key(p[0], p[1]) === at)) continue;
      // anything else on its boundary lies on the near rectangle, at the bed
      expect(onRectangle([x, z])).toBe(true);
      expect(y).toBeCloseTo(BED_Y, 3);
    }
  });

  it('the flat bed around an outline keeps the same rim', () => {
    const rim = boundary(createSkyStageBed(near, outline));
    for (const [x, z] of ring) expect(rim.has(key(x, z))).toBe(true);
    for (const at of rim.keys()) {
      if (ring.some(p => key(p[0], p[1]) === at)) continue;
      expect(onRectangle(at.split(',').map(Number))).toBe(true);
    }
  });

  it('⭐ the plane is one piece: its only edge is the extent', () => {
    const plane = createSkyStagePlane(near, extent);
    const edge = boundary(plane);
    expect(edge.size).toBeGreaterThan(0);
    for (const at of edge.keys()) {
      expect(onRectangle(at.split(',').map(Number), extent)).toBe(true);
    }
  });

  it('the rings meet the relief vertex for vertex', () => {
    const relief = createSkyStageRelief(near, outline, elevations, BED_Y, 2000);
    const onNear = (edge: Map<string, number>) =>
      [...edge.keys()].filter(at => onRectangle(at.split(',').map(Number)));
    const inner = onNear(boundary(createSkyStageRings(near, extent)));
    expect(inner.length).toBeGreaterThan(0);
    expect(new Set(inner)).toEqual(new Set(onNear(boundary(relief))));
  });

  it('the rim of a handed seabed: its outer ring and hole as one component, with their heights', () => {
    const rim = skyStageRim(seabed);
    const components = rim.outline.coordinates as PlanarPolygonCoordinates;
    expect(components).toHaveLength(1);
    const [outer, inner] = components[0];
    expect(components[0]).toHaveLength(2);
    expect(keys(outer)).toEqual(keys(ring));
    expect(keys(inner)).toEqual(keys(hole));
    components[0].forEach((r, i) => {
      expect(rim.elevations[0][i]).toHaveLength(r.length);
      r.forEach(([x, z], v) =>
        expect(rim.elevations[0][i][v]).toBeCloseTo(heightAt(x, z), 3),
      );
    });
  });

  it('⭐ a relief on that rim meets the handed seabed vertex for vertex', () => {
    const rim = skyStageRim(seabed);
    const relief = createSkyStageRelief(
      near,
      rim.outline,
      rim.elevations,
      BED_Y,
      2000,
    );
    const around = boundary(relief);
    const bed = boundary(createSkyStageSeabed(seabed));
    const outer = keys(ring);
    for (const [at, y] of bed) {
      if (!outer.has(at)) continue;
      expect(around.get(at)).toBeCloseTo(y, 3);
    }
    // and nowhere else: the rest of its boundary lies on the near rectangle
    for (const at of around.keys()) {
      if (bed.has(at)) continue;
      expect(onRectangle(at.split(',').map(Number))).toBe(true);
    }
  });

  it('the handed seabed is wrapped, not copied, and faces up', () => {
    const geometry = createSkyStageSeabed(seabed);
    expect(geometry.getAttribute('position').array).toBe(seabed.positions);
    expect(geometry.getIndex()!.array).toBe(seabed.indices);
    const normal = geometry.getAttribute('normal') as BufferAttribute;
    for (let v = 0; v < normal.count; v++) {
      expect(normal.getY(v)).toBeGreaterThan(0);
    }
  });
});
