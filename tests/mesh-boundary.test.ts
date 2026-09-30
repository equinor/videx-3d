import { describe, expect, it } from 'vitest';
import {
  buildEdgeOpposites,
  traceBoundaryRings,
} from '../src/sdk/geometries/mesh-boundary';
import { ringSignedArea } from '../src/sdk/geometries/polygon-outline';
import { Vec2 } from '../src/sdk/types/common';

/** `n x n` vertices triangulated into a regular grid, consistently wound. */
const gridMesh = (n: number) => {
  const indices: number[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c;
      const b = a + 1;
      const d = a + n;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  return new Uint32Array(indices);
};

/** Triangle index of the lower/upper half of cell `(col, row)`. */
const cellTriangles = (n: number, col: number, row: number) => {
  const first = 2 * (row * (n - 1) + col);
  return [first, first + 1];
};

const point = (n: number) => (v: number) => [v % n, Math.floor(v / n)] as Vec2;

describe('buildEdgeOpposites', () => {
  it('pairs interior edges and leaves the boundary unpaired', () => {
    const n = 3;
    const indices = gridMesh(n);
    const opposite = buildEdgeOpposites(indices, n * n);

    let paired = 0;
    for (let he = 0; he < indices.length; he++) {
      if (opposite[he] >= 0) {
        paired++;
        // the pairing is symmetric...
        expect(opposite[opposite[he]]).toBe(he);
        // ...and joins two DIFFERENT triangles
        expect((opposite[he] / 3) | 0).not.toBe((he / 3) | 0);
      }
    }
    // 8 triangles = 24 sides; a 2x2 quad grid has 8 sides on its outer boundary.
    expect(indices.length).toBe(24);
    expect(paired).toBe(24 - 8);
  });
});

describe('traceBoundaryRings', () => {
  const n = 4;
  const indices = gridMesh(n);
  const opposite = buildEdgeOpposites(indices, n * n);
  const triangles = indices.length / 3;

  it('traces the outline of the whole mesh', () => {
    const { rings } = traceBoundaryRings(
      indices,
      opposite,
      new Uint8Array(triangles).fill(1),
    );

    expect(rings).toHaveLength(1);
    // 3 cells a side -> 3 vertices per side, 4 sides
    expect(rings[0]).toHaveLength(4 * (n - 1));
    // every vertex is on the outer edge of the grid
    for (const v of rings[0]) {
      const [col, row] = point(n)(v);
      expect(col === 0 || col === n - 1 || row === 0 || row === n - 1).toBe(
        true,
      );
    }
  });

  it('traces a hole as a SEPARATE ring, wound the other way', () => {
    const member = new Uint8Array(triangles).fill(1);
    for (const t of cellTriangles(n, 1, 1)) member[t] = 0;

    const { rings } = traceBoundaryRings(indices, opposite, member);

    expect(rings).toHaveLength(2);
    const inner = rings.find(r => r.length === 4)!;
    const outer = rings.find(r => r.length === 4 * (n - 1))!;
    expect(inner).toBeDefined();
    expect(outer).toBeDefined();
    // ⭐ opposite winding is what makes a wall on the inner ring face INTO the
    // hole while the outer one faces away from the material
    const areas = [outer, inner].map(r => ringSignedArea(r.map(point(n))));
    expect(Math.sign(areas[0])).toBe(-Math.sign(areas[1]));
    // the hole's ring is exactly the four corners of the removed cell
    expect([...inner].sort((a, b) => a - b)).toEqual([5, 6, 9, 10]);
  });

  it('returns nothing for an empty subset', () => {
    expect(
      traceBoundaryRings(indices, opposite, new Uint8Array(triangles)).rings,
    ).toEqual([]);
  });

  it('traces two disjoint patches as two rings', () => {
    const member = new Uint8Array(triangles);
    for (const t of cellTriangles(n, 0, 0)) member[t] = 1;
    for (const t of cellTriangles(n, 2, 2)) member[t] = 1;

    const { rings } = traceBoundaryRings(indices, opposite, member);

    expect(rings).toHaveLength(2);
    expect(rings.map(r => r.length)).toEqual([4, 4]);
  });
});
