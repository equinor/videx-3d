import { describe, expect, it } from 'vitest';
import { marchingSquares } from '../src/sdk/geometries/marching-squares';
import {
  pointInRing,
  ringsToPolygonCoordinates,
} from '../src/sdk/geometries/polygon-outline';
import { Vec2 } from '../src/sdk/types/common';

// Build a cols x rows field from a predicate marking "inside" nodes as 1, else 0.
function field(
  cols: number,
  rows: number,
  inside: (c: number, r: number) => boolean,
): Float32Array {
  const f = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) f[r * cols + c] = inside(c, r) ? 1 : 0;
  }
  return f;
}

describe('marchingSquares', () => {
  it('traces a single closed ring around a central blob', () => {
    const cols = 7;
    const rows = 7;
    // 3x3 inside block, kept away from the border so the contour closes.
    const f = field(cols, rows, (c, r) => c >= 2 && c <= 4 && r >= 2 && r <= 4);
    const rings = marchingSquares(f, cols, rows, 0.5);
    expect(rings.length).toBe(1);
    // The block centre is inside the traced ring; a far corner is not.
    expect(pointInRing(3, 3, rings[0])).toBe(true);
    expect(pointInRing(0, 0, rings[0])).toBe(false);
  });

  it('traces outer + hole rings for an annulus', () => {
    const cols = 9;
    const rows = 9;
    // Inside everywhere except the border (so the outer contour closes) and a
    // single-node hole in the centre.
    const f = field(cols, rows, (c, r) => {
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) return false;
      if (c === 4 && r === 4) return false;
      return true;
    });
    const rings = marchingSquares(f, cols, rows, 0.5);
    expect(rings.length).toBe(2);

    // Grouped: one component (outer ring) with one hole.
    const coords = ringsToPolygonCoordinates(rings as Vec2[][]);
    expect(coords.length).toBe(1);
    expect(coords[0].length).toBe(2);
  });

  it('returns nothing for a uniform field (no crossings)', () => {
    const f = new Float32Array(16).fill(1);
    expect(marchingSquares(f, 4, 4, 0.5)).toEqual([]);
  });
});

describe('ringsToPolygonCoordinates', () => {
  it('nests a hole inside its enclosing outer ring', () => {
    const outer: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const hole: Vec2[] = [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
    ];
    const coords = ringsToPolygonCoordinates([outer, hole]);
    expect(coords.length).toBe(1);
    expect(coords[0].length).toBe(2);
    expect(coords[0][0]).toBe(outer);
    expect(coords[0][1]).toBe(hole);
  });

  it('keeps two disjoint outers as separate components', () => {
    const a: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const b: Vec2[] = [
      [100, 100],
      [110, 100],
      [110, 110],
      [100, 110],
    ];
    const coords = ringsToPolygonCoordinates([a, b]);
    expect(coords.length).toBe(2);
  });
});
