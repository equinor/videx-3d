import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { createDelaunayCap } from '../src/sdk/geometries/delaunay-cap';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { createPolygonCap } from '../src/sdk/geometries/polygon-cap';
import { Vec2 } from '../src/sdk/types/common';

const square = (min: number, max: number): Vec2[] => [
  [min, min],
  [max, min],
  [max, max],
  [min, max],
];

const key = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`;

/** Edges used by exactly one triangle, as unordered keys of their end points. */
const boundaryEdges = (geometry: BufferGeometry) => {
  const index = geometry.getIndex()!.array;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const at = (v: number) => key(position.getX(v), position.getZ(v));
  const counts = new Map<string, number>();
  for (let i = 0; i < index.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = at(index[i + e]);
      const b = at(index[i + ((e + 1) % 3)]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, n]) => n === 1).map(([k]) => k));
};

const ringEdges = (rings: Vec2[][]) => {
  const edges = new Set<string>();
  for (const ring of rings) {
    ring.forEach(([x, z], i) => {
      const [nx, nz] = ring[(i + 1) % ring.length];
      const a = key(x, z);
      const b = key(nx, nz);
      edges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    });
  }
  return edges;
};

const area = (geometry: BufferGeometry) => {
  const index = geometry.getIndex()!.array;
  const p = geometry.getAttribute('position') as BufferAttribute;
  let sum = 0;
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
    sum +=
      Math.abs(
        (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) -
          (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)),
      ) / 2;
  }
  return sum;
};

const grid = (min: number, max: number, step: number): Vec2[] => {
  const points: Vec2[] = [];
  for (let x = min; x <= max; x += step) {
    for (let z = min; z <= max; z += step) points.push([x, z]);
  }
  return points;
};

describe('createDelaunayCap', () => {
  const outer = square(0, 1000);
  const hole = square(300, 600);
  const island = square(400, 500);

  it('⭐ keeps every ring edge as the boundary, and nothing else', () => {
    const cap = createDelaunayCap([outer, hole], {
      points: grid(50, 950, 100),
    });
    expect(boundaryEdges(cap)).toEqual(ringEdges([outer, hole]));

    // Concave: a Delaunay triangulation left to itself would span the notches.
    const star: Vec2[] = [];
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 200 : 1000;
      star.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    const starCap = createDelaunayCap([star], { points: grid(-950, 950, 100) });
    expect(boundaryEdges(starCap)).toEqual(ringEdges([star]));
  });

  it('fills the region by even-odd: holes empty, islands in them filled', () => {
    expect(area(createDelaunayCap([outer, hole]))).toBeCloseTo(
      1000 * 1000 - 300 * 300,
    );
    expect(area(createDelaunayCap([outer, hole, island]))).toBeCloseTo(
      1000 * 1000 - 300 * 300 + 100 * 100,
    );
  });

  it('runs through the interior points, and skips the rest', () => {
    const inside: Vec2[] = [
      [100, 100],
      [800, 200],
    ];
    const skipped: Vec2[] = [
      [450, 450], // in the hole
      [2000, 0], // outside
      [500, 0.5], // on a ring edge, within its clearance
    ];
    const cap = createDelaunayCap([outer, hole], {
      points: [...inside, ...skipped],
    });
    const position = cap.getAttribute('position') as BufferAttribute;
    const vertices = new Set<string>();
    for (let v = 0; v < position.count; v++) {
      vertices.add(key(position.getX(v), position.getZ(v)));
    }
    for (const [x, z] of inside) expect(vertices).toContain(key(x, z));
    // the ring vertices, plus the two inside
    expect(position.count).toBe(8 + inside.length);
  });

  it('keeps the coordinates it was given, at the height asked for', () => {
    const odd: Vec2[] = [
      [1234.5678, -98.7654],
      [5432.1, -98.7654],
      [5432.1, 3210.9],
    ];
    const cap = createDelaunayCap([odd], { y: -25 });
    const position = cap.getAttribute('position') as BufferAttribute;
    const vertices = new Set<string>();
    for (let v = 0; v < position.count; v++) {
      expect(position.getY(v)).toBe(-25);
      vertices.add(`${position.getX(v)},${position.getZ(v)}`);
    }
    for (const [x, z] of odd) {
      expect(vertices).toContain(`${Math.fround(x)},${Math.fround(z)}`);
    }
  });

  it('winds its triangles as createPolygonCap does', () => {
    const winding = (geometry: BufferGeometry) => {
      const index = geometry.getIndex()!.array;
      const p = geometry.getAttribute('position') as BufferAttribute;
      const [a, b, c] = [index[0], index[1], index[2]];
      return Math.sign(
        (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) -
          (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)),
      );
    };
    const polygon = createPolygonCap(
      new PlanarPolygonGeometry([[outer.map(([x, z]) => [x, z])]]).toShapes(),
    );
    expect(winding(createDelaunayCap([outer]))).toBe(winding(polygon));
  });

  it('keeps its triangles well shaped through points as fine as its boundary', () => {
    const ring: Vec2[] = [];
    for (let s = 0; s < 1000; s += 100) ring.push([s, 0]);
    for (let s = 0; s < 1000; s += 100) ring.push([1000, s]);
    for (let s = 1000; s > 0; s -= 100) ring.push([s, 1000]);
    for (let s = 1000; s > 0; s -= 100) ring.push([0, s]);
    const cap = createDelaunayCap([ring], { points: grid(50, 950, 100) });
    const index = cap.getIndex()!.array;
    const p = cap.getAttribute('position') as BufferAttribute;
    let worst = 0;
    for (let i = 0; i < index.length; i += 3) {
      const v = [index[i], index[i + 1], index[i + 2]];
      const edges = v.map((a, k) => {
        const b = v[(k + 1) % 3];
        return Math.hypot(p.getX(b) - p.getX(a), p.getZ(b) - p.getZ(a));
      });
      const doubled = Math.abs(
        (p.getX(v[1]) - p.getX(v[0])) * (p.getZ(v[2]) - p.getZ(v[0])) -
          (p.getZ(v[1]) - p.getZ(v[0])) * (p.getX(v[2]) - p.getX(v[0])),
      );
      worst = Math.max(worst, Math.max(...edges) ** 2 / doubled);
    }
    // longest edge² / (2 · area): 1 for a right isosceles triangle
    expect(worst).toBeLessThan(4);
  });
});
