import { describe, expect, it } from 'vitest';
import { Delatin } from '../src/sdk/geometries/delatin';
import {
  GridPolygon,
  nodeGridRings,
  smoothRings,
  triangulateGridConstrained,
} from '../src/sdk/geometries/triangulate-grid-delaunay';

// Shoelace area of a ring of [x, y] points.
function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a) / 2;
}

// Sum of triangle areas in the XZ plane (positions are [x, height, z]).
function meshArea(positions: Float32Array, indices: Uint32Array): number {
  let sum = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a];
    const az = positions[a + 2];
    const bx = positions[b];
    const bz = positions[b + 2];
    const cx = positions[c];
    const cz = positions[c + 2];
    sum += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return sum;
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// A flat elevation grid (constant height) of width x height.
function flatGrid(width: number, height: number, value = 10): Float32Array {
  return new Float32Array(width * height).fill(value);
}

describe('triangulateGridConstrained', () => {
  it('clips exactly to a triangular polygon (area matches, no staircase)', () => {
    const width = 5;
    const height = 5;
    const grid = flatGrid(width, height);
    const outer = [
      [1, 1],
      [3.5, 1],
      [1, 3.5],
    ];
    const polygons: GridPolygon[] = [[outer]];

    const { positions, indices } = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      1,
      polygons,
    );

    expect(indices.length).toBeGreaterThan(0);
    // Exact rim => mesh area equals polygon area (a staircase rim would differ).
    expect(meshArea(positions, indices)).toBeCloseTo(ringArea(outer), 6);

    // Every kept triangle lies inside the polygon.
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;
      const cx = (positions[a] + positions[b] + positions[c]) / 3;
      const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
      expect(pointInRing(cx, cz, outer)).toBe(true);
    }
  });

  it('honors the exact rim even with a coarse interior (large maxError)', () => {
    const width = 8;
    const height = 8;
    const grid = flatGrid(width, height);
    const outer = [
      [1.25, 1.25],
      [6.5, 2.0],
      [5.0, 6.75],
      [1.75, 5.5],
    ];
    const polygons: GridPolygon[] = [[outer]];

    const { positions, indices } = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      1000, // effectively no interior refinement
      polygons,
    );

    expect(meshArea(positions, indices)).toBeCloseTo(ringArea(outer), 5);
  });

  it('enforces constraint edges crossing a dense, high-relief interior', () => {
    // A high-relief grid makes the greedy pass keep a dense interior; a slanted
    // polygon then forces rim edges to cross many interior edges. This is the case
    // the walk-based edge insertion must handle (the old brute path was O(T^2) and
    // could stall). Exact-rim area preservation proves every constraint edge was
    // enforced.
    const width = 40;
    const height = 40;
    const grid = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        grid[r * width + c] =
          200 * Math.sin(c * 0.9) * Math.cos(r * 0.7) + (c % 2) * 150;
      }
    }
    const outer = [
      [3.3, 5.7],
      [34.6, 8.2],
      [30.4, 33.9],
      [6.1, 28.4],
    ];
    const polygons: GridPolygon[] = [[outer]];

    const { positions, indices } = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      2,
      polygons,
    );

    expect(indices.length).toBeGreaterThan(0);
    expect(meshArea(positions, indices)).toBeCloseTo(ringArea(outer), 4);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;
      const cx = (positions[a] + positions[b] + positions[c]) / 3;
      const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
      expect(pointInRing(cx, cz, outer)).toBe(true);
    }
  });

  it('removes hole interiors (area = outer - hole)', () => {
    const width = 6;
    const height = 6;
    const grid = flatGrid(width, height);
    const outer = [
      [0.5, 0.5],
      [4.5, 0.5],
      [4.5, 4.5],
      [0.5, 4.5],
    ];
    const hole = [
      [1.75, 1.75],
      [3.25, 1.75],
      [3.25, 3.25],
      [1.75, 3.25],
    ];
    const polygons: GridPolygon[] = [[outer, hole]];

    const { positions, indices } = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      1,
      polygons,
    );

    const expected = ringArea(outer) - ringArea(hole);
    expect(meshArea(positions, indices)).toBeCloseTo(expected, 5);

    // No kept triangle centroid inside the hole.
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;
      const cx = (positions[a] + positions[b] + positions[c]) / 3;
      const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
      expect(pointInRing(cx, cz, hole)).toBe(false);
    }
  });

  it('drapes rim vertices onto elevation at grid-line crossings', () => {
    // A ramp in x so a diagonal rim edge crossing grid columns picks up
    // intermediate heights rather than a straight interpolation.
    const width = 6;
    const height = 6;
    const grid = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        grid[r * width + c] = c * 10; // height increases with column
      }
    }
    const outer = [
      [1, 1],
      [4.5, 1],
      [4.5, 4.5],
      [1, 4.5],
    ];
    const withDrape = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      1,
      [[outer]],
      true,
    );
    const withoutDrape = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      1,
      [[outer]],
      false,
    );
    // Draping inserts additional rim vertices at grid-line crossings.
    expect(withDrape.positions.length).toBeGreaterThan(
      withoutDrape.positions.length,
    );
    // Area is unaffected by draping (rim footprint identical in XZ).
    expect(meshArea(withDrape.positions, withDrape.indices)).toBeCloseTo(
      ringArea(outer),
      5,
    );
  });

  it('cuts no-data holes with a clean rim (cutHoles), and fills them otherwise', () => {
    // 7x7 grid (6x6 = 36 unit cells), all valid except a single interior null
    // vertex at (3,3). That vertex is a corner of 4 cells, so 4 cells become a
    // 2x2 interior hole => 32 present cells.
    const width = 7;
    const height = 7;
    const grid = flatGrid(width, height);
    grid[3 * width + 3] = -1;

    const cut = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      0.5,
      [],
      false,
      true, // cutHoles
    );
    // Kept area == present-cell count (exact cell-boundary rim).
    expect(meshArea(cut.positions, cut.indices)).toBeCloseTo(32, 5);
    // No triangle centroid lies in the 2x2 hole region (x,z in (2, 4)).
    for (let i = 0; i < cut.indices.length; i += 3) {
      const a = cut.indices[i] * 3;
      const b = cut.indices[i + 1] * 3;
      const c = cut.indices[i + 2] * 3;
      const cx = (cut.positions[a] + cut.positions[b] + cut.positions[c]) / 3;
      const cz =
        (cut.positions[a + 2] + cut.positions[b + 2] + cut.positions[c + 2]) /
        3;
      const inHole = cx > 2 && cx < 4 && cz > 2 && cz < 4;
      expect(inHole).toBe(false);
    }

    // With cutHoles off, the hole is filled => full grid area (36).
    const filled = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      0.5,
      [],
      false,
      false, // fill
    );
    expect(meshArea(filled.positions, filled.indices)).toBeCloseTo(36, 5);
  });

  it('edgeSmoothing produces a valid mesh with no null-height leaks', () => {
    // Flat grid (all height 10) with an interior null; smoothing the traced rim
    // may include the null cell, but the output must fill it (never leak the
    // nullHeight sentinel) so all heights stay ~10.
    const width = 7;
    const height = 7;
    const grid = flatGrid(width, height);
    grid[3 * width + 3] = -1;

    const smoothed = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      0.5,
      [],
      false,
      true, // cutHoles
      2, // edgeSmoothing
    );
    expect(smoothed.indices.length).toBeGreaterThan(0);
    for (let i = 1; i < smoothed.positions.length; i += 3) {
      expect(Number.isFinite(smoothed.positions[i])).toBe(true);
      expect(smoothed.positions[i]).toBeCloseTo(10, 6);
    }
  });

  it('does not over-refine holey grids (holes must not force insertion)', () => {
    // A FLAT valid surface needs no interior detail. Punching many no-data holes
    // must NOT make the greedy pass insert a vertex at every hole node — that would
    // explode the mesh on holey surfaces (e.g. "Basement Base"). The border stays
    // valid so the initial corner mesh is valid.
    const width = 41;
    const height = 41;
    const nullValue = -1;
    const grid = flatGrid(width, height, 100);
    let holes = 0;
    for (let r = 1; r < height - 1; r++) {
      for (let c = 1; c < width - 1; c++) {
        if ((r + c) % 2 === 0) {
          grid[r * width + c] = nullValue;
          holes++;
        }
      }
    }
    const { indices } = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      nullValue,
      5,
      [],
      false, // no draping
      false, // fill (cutHoles off)
      0,
    );
    const triCount = indices.length / 3;
    // Flat valid data => a tiny mesh; it must NOT scale with the ~760 holes.
    expect(holes).toBeGreaterThan(500);
    expect(triCount).toBeLessThan(50);
    expect(triCount).toBeGreaterThan(0);
  });

  it('constrains a rim crossing a dense cluster of slivers in linear time', () => {
    // A tall step in the grid makes the greedy pass pack vertices along the cliff,
    // and a constraint edge crossing that cluster meets very many crossings. When
    // the crossing set was re-walked after every flip that cost O(crossings^2) or
    // worse — one real surface took ~50s. Cross the cliff diagonally so the rim
    // cannot align with it.
    const width = 300;
    const height = 300;
    const grid = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        // cliff along a diagonal, 400 units tall
        grid[r * width + c] = c + r < width ? 100 : 500;
      }
    }
    const outer = [
      [20, 150],
      [280, 20],
      [280, 280],
      [20, 280],
    ];
    const polygons: GridPolygon[] = [[outer]];

    const t0 = performance.now();
    const { positions, indices } = triangulateGridConstrained(
      grid,
      width,
      1,
      1,
      -1,
      5,
      polygons,
      false, // no draping
      false,
      0,
    );
    const elapsed = performance.now() - t0;

    expect(indices.length).toBeGreaterThan(0);
    expect(positions.every(v => Number.isFinite(v))).toBe(true);
    // Generous bound: this is ~0.2s with the incremental insertion and minutes
    // without it, so it only fails on a genuine algorithmic regression.
    expect(elapsed).toBeLessThan(10000);
  });
});

describe('smoothRings', () => {
  const perimeter = (ring: number[][]) => {
    let p = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      p += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
    }
    return p;
  };

  it('is a no-op at strength 0 and shortens a staircase otherwise', () => {
    const staircase = [
      [0, 0],
      [2, 0],
      [2, 1],
      [4, 1],
      [4, 2],
      [6, 2],
      [6, 4],
      [4, 4],
      [4, 3],
      [2, 3],
      [2, 4],
      [0, 4],
    ];

    // strength 0 -> unchanged reference
    const [same] = smoothRings([staircase], 0);
    expect(same).toBe(staircase);

    const [smoothed] = smoothRings([staircase], 2);
    expect(smoothed.length).toBe(staircase.length);
    for (const [x, y] of smoothed) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    // A moving average collapses the staircase toward its centre line, so the
    // perimeter shrinks.
    expect(perimeter(smoothed)).toBeLessThan(perimeter(staircase));
  });
});

describe('nodeGridRings', () => {
  const square = (x0: number, y0: number, x1: number, y1: number) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  it('returns the input by identity when nothing crosses', () => {
    const rings = [square(0, 0, 4, 4), square(10, 10, 14, 14)];
    expect(nodeGridRings(rings)).toBe(rings);
  });

  it('leaves a ring nested inside another untouched', () => {
    const rings = [square(0, 0, 10, 10), square(2, 2, 8, 8)];
    expect(nodeGridRings(rings)).toBe(rings);
  });

  it('splits both partners at a crossing, with identical coordinates', () => {
    const a = square(0, 0, 10, 10);
    const b = square(5, 5, 15, 15);
    const [na, nb] = nodeGridRings([a, b]);

    // Two edges of each square cross two edges of the other.
    expect(na.length).toBe(a.length + 2);
    expect(nb.length).toBe(b.length + 2);

    const key = (p: number[]) => `${p[0]}:${p[1]}`;
    const shared = new Set(na.map(key));
    const crossings = nb.filter(p => shared.has(key(p)));
    // The two crossings are bit-identical points in BOTH rings, which is what
    // makes them resolve to one vertex.
    expect(crossings.map(key).sort()).toEqual(['10:5', '5:10']);
  });

  it('lets a triangulator enforce two crossing rims once they are noded', () => {
    const size = 33;
    const grid = new Float32Array(size * size);
    const a = square(4, 4, 24, 24);
    const b = square(14, 14, 30, 30);

    const constrain = (rings: number[][][]) => {
      const d = new Delatin(grid, size);
      d.run(5);
      d.beginConstraints();
      for (const ring of rings) {
        const verts = ring.map(([x, y]) => d.insertPoint(x, y, 0));
        for (let i = 0; i < verts.length; i++) {
          d.constrainEdge(verts[i], verts[(i + 1) % verts.length]);
        }
      }
      return d.constraintFailures;
    };

    // Crossing constraint edges can only both follow mesh edges if the crossing
    // is itself a vertex, so the raw rims are unenforceable and the noded ones
    // are not.
    expect(constrain([a, b])).toBeGreaterThan(0);
    expect(constrain(nodeGridRings([a, b]))).toBe(0);
  });
});
