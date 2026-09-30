import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { createPolygonCap } from '../src/sdk/geometries/polygon-cap';
import { refineInteriorEdges } from '../src/sdk/geometries/tessellation';

const square = (size: number) =>
  new PlanarPolygonGeometry([
    [
      [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
      ],
    ],
  ]);

/** The boundary vertices, as world XZ, rounded so they can be compared. */
const boundary = (geometry: BufferGeometry) => {
  const index = geometry.getIndex()!.array;
  const counts = new Map<string, number>();
  for (let i = 0; i < index.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[i + e];
      const b = index[i + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const position = geometry.getAttribute('position') as BufferAttribute;
  const points = new Set<string>();
  for (const [key, count] of counts) {
    if (count !== 1) continue;
    for (const v of key.split('_').map(Number)) {
      points.add(
        `${position.getX(v).toFixed(3)},${position.getZ(v).toFixed(3)}`,
      );
    }
  }
  return points;
};

const longestEdge = (geometry: BufferGeometry) => {
  const index = geometry.getIndex()!.array;
  const position = geometry.getAttribute('position') as BufferAttribute;
  let longest = 0;
  for (let i = 0; i < index.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[i + e];
      const b = index[i + ((e + 1) % 3)];
      const dx = position.getX(a) - position.getX(b);
      const dz = position.getZ(a) - position.getZ(b);
      longest = Math.max(longest, Math.hypot(dx, dz));
    }
  }
  return longest;
};

describe('createPolygonCap', () => {
  it('fills the outline flat, at the height given', () => {
    const cap = createPolygonCap(square(1000).toShapes(), { y: -25 });
    const position = cap.getAttribute('position') as BufferAttribute;

    expect(position.count).toBeGreaterThan(2);
    for (let v = 0; v < position.count; v++) {
      expect(position.getY(v)).toBeCloseTo(-25);
    }
  });

  it('takes the outline straight into scene XZ, +Z as given', () => {
    const cap = createPolygonCap(square(1000).toShapes(), {});
    const corners = boundary(cap);

    expect(corners).toContain('1000.000,1000.000');
  });

  it('⭐ keeps the same boundary however finely the interior is filled', () => {
    const coarse = createPolygonCap(square(4000).toShapes(), {});
    const fine = createPolygonCap(square(4000).toShapes(), { resolution: 200 });

    expect(boundary(fine)).toEqual(boundary(coarse));
    // ...while the middle really did get finer
    expect(longestEdge(fine)).toBeLessThan(longestEdge(coarse));
    expect(fine.getIndex()!.count).toBeGreaterThan(
      coarse.getIndex()!.count * 4,
    );
  });

  it('refines toward the target edge length and then stops', () => {
    const cap = createPolygonCap(square(4000).toShapes(), { resolution: 300 });
    const finer = createPolygonCap(square(4000).toShapes(), {
      resolution: 300,
    });

    // the boundary is left alone, so the outline's own 4000 m edges remain the
    // longest — the INTERIOR is what converges
    expect(cap.getIndex()!.count).toBe(finer.getIndex()!.count);
    expect(cap.getIndex()!.count).toBeGreaterThan(
      createPolygonCap(square(4000).toShapes(), {
        resolution: 1500,
      }).getIndex()!.count,
    );
  });

  it('costs nothing when no resolution is asked for', () => {
    const cap = createPolygonCap(square(4000).toShapes(), {});
    // a square is two triangles, and nothing needs to be added to fill it
    expect(cap.getIndex()!.count).toBe(6);
  });
});

describe('refineInteriorEdges with an edge-length floor', () => {
  // Two triangles sharing one interior diagonal.
  const quad = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        Float32Array.from([0, 0, 0, 100, 0, 0, 100, 0, 100, 0, 0, 100]),
        3,
      ),
    );
    geometry.setIndex(
      new BufferAttribute(Uint16Array.from([0, 1, 2, 0, 2, 3]), 1),
    );
    return geometry;
  };

  it('leaves an edge alone once it is short enough', () => {
    const geometry = quad();
    refineInteriorEdges(geometry, 8, 1000);

    expect(geometry.getIndex()!.count).toBe(6);
  });

  it('refines only what is too long, so the cost does not compound', () => {
    const adaptive = quad();
    refineInteriorEdges(adaptive, 4, 40);
    const uniform = quad();
    refineInteriorEdges(uniform, 4);

    expect(adaptive.getIndex()!.count).toBeGreaterThan(6);
    expect(adaptive.getIndex()!.count).toBeLessThan(
      uniform.getIndex()!.count / 4,
    );
    // the outline's own 100 m edges are never split
    expect(longestEdge(adaptive)).toBeLessThan(100.001);
  });
});
