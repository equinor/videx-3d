import { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { stackIntervalTriangles } from '../src/sdk/geometries/surface-stack';
import { buildStackWalls } from '../src/sdk/geometries/surface-stack-geometry';

const N = 4;

/** `N x N` vertices triangulated into a regular grid. */
const indices = (() => {
  const list: number[] = [];
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const a = r * N + c;
      list.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
    }
  }
  return new Uint32Array(list);
})();

const TRIANGLES = indices.length / 3;
const VERTICES = N * N;

/** The grid's outer boundary, in order. */
const rimRing = (() => {
  const ring: number[] = [];
  for (let c = 0; c < N; c++) ring.push(c);
  for (let r = 1; r < N; r++) ring.push(r * N + N - 1);
  for (let c = N - 2; c >= 0; c--) ring.push((N - 1) * N + c);
  for (let r = N - 2; r >= 1; r--) ring.push(r * N);
  return ring;
})();

const coords = (() => {
  const out = new Float32Array(VERTICES * 2);
  for (let v = 0; v < VERTICES; v++) {
    out[2 * v] = v % N;
    out[2 * v + 1] = Math.floor(v / N);
  }
  return out;
})();

const tessellation = {
  coords,
  indices,
  rimVertices: [rimRing],
  rimDropped: 0,
};

/** Scene XZ, 100 m to the grid cell. */
const positionsXZ = (() => {
  const out = new Float32Array(VERTICES * 2);
  for (let v = 0; v < VERTICES; v++) {
    out[2 * v] = (v % N) * 100;
    out[2 * v + 1] = Math.floor(v / N) * 100;
  }
  return out;
})();

const flat = (y: number) => new Float32Array(VERTICES).fill(y);
const triangleCount = (geometry: BufferGeometry | null) =>
  geometry ? geometry.getIndex()!.count / 3 : 0;
const marks = (geometry: BufferGeometry) =>
  geometry.hasAttribute('inferred')
    ? Array.from(geometry.getAttribute('inferred').array as Float32Array)
    : null;

describe('stackIntervalTriangles', () => {
  it('keeps the volume below a layer that was welded to the one above it', () => {
    // Layer 1 is coincident with layer 0, so the COLLAPSE drops layer 1's own
    // triangles — but the interval between 1 and 2 is 100 m thick and perfectly
    // real. Deriving intervals from the layers' kept sets would delete it.
    const heights = [flat(0), flat(0), flat(-100)];

    const intervals = stackIntervalTriangles(heights, indices, {
      threshold: 0.5,
    });

    expect(intervals).toHaveLength(2);
    expect([...intervals[0]].every(v => v === 0)).toBe(true);
    expect([...intervals[1]].every(v => v === 1)).toBe(true);
  });

  it('drops the interval wherever a bounding surface has no data at a corner', () => {
    const heights = [flat(0), flat(-100)];
    const coverage = [
      new Uint8Array(VERTICES).fill(1),
      new Uint8Array(VERTICES).fill(1),
    ];
    // the corner triangle's three vertices lose their data
    for (const v of [0, 1, N]) coverage[1][v] = 0;

    const [interval] = stackIntervalTriangles(heights, indices, {
      threshold: 0.5,
      coverage,
    });

    // ⭐ Every triangle TOUCHING an uncovered vertex goes, not just the one whose
    // every corner is: coverage is binary and interpolates nothing, so keeping a
    // triangle with one corner on data would draw the unit past its own survey.
    const touching = new Set<number>();
    for (let t = 0; t < TRIANGLES; t++) {
      const corners = [indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]];
      if (corners.some(v => coverage[1][v] === 0)) touching.add(t);
    }
    expect(touching.size).toBeGreaterThan(1);
    expect(TRIANGLES - [...interval].filter(Boolean).length).toBe(
      touching.size,
    );
    expect(interval[0]).toBe(0);
  });
});

describe('buildStackWalls', () => {
  const heights = [flat(0), flat(-100)];

  it('walls a fully present interval around the chunk rim', () => {
    const { walls } = buildStackWalls(tessellation, positionsXZ, heights, {
      fills: [true, false],
      threshold: 0.5,
    });

    expect(walls[1]).toBeNull();
    const wall = walls[0]!;
    // one quad per rim segment
    expect(triangleCount(wall)).toBe(rimRing.length * 2);
    // nothing was inferred, so there is nothing to mark — and the ABSENCE of the
    // attribute is what tells the appearance layer to skip the overlay
    expect(marks(wall)).toBeNull();
  });

  it('builds no wall for an interval that is not filled', () => {
    const { walls } = buildStackWalls(tessellation, positionsXZ, heights, {
      fills: [false, false],
    });
    expect(walls.every(w => w === null)).toBe(true);
  });

  it('walls around a hole in the interval, not just the chunk rim', () => {
    // the unit pinches out over the middle cell: zero thickness there
    const top = flat(0);
    const bottom = flat(-100);
    for (const v of [5, 6, 9, 10]) bottom[v] = 0;

    const { walls } = buildStackWalls(
      tessellation,
      positionsXZ,
      [top, bottom],
      {
        fills: [true, false],
        threshold: 0.5,
      },
    );

    const wall = walls[0]!;
    // the rim, plus a ring of 4 around the pinch-out
    expect(triangleCount(wall)).toBe((rimRing.length + 4) * 2);
    // ⭐ A pinch-out is real geology, so nothing here is marked. The wall exists
    // because the unit ends, not because anything was invented.
    expect(marks(wall)).toBeNull();
  });

  it('leaves the wall out entirely where the interval has no thickness at all', () => {
    const { walls } = buildStackWalls(
      tessellation,
      positionsXZ,
      [flat(0), flat(0)],
      {
        fills: [true, false],
        threshold: 0.5,
      },
    );
    expect(walls[0]).toBeNull();
  });

  it('marks on ONE mesh, so the strip keeps its vertices', () => {
    const top = flat(0);
    const bottom = flat(-100);
    for (const v of [5, 6, 9, 10]) bottom[v] = 0;
    const weights = new Float32Array(VERTICES).fill(1);

    const wall = buildStackWalls(tessellation, positionsXZ, [top, bottom], {
      fills: [true, false],
      threshold: 0.5,
      inferred: [weights, new Float32Array(VERTICES)],
    }).walls[0]!;

    // ⭐ One index range and no groups: the marking is a per-vertex attribute, so
    // it indexes the SAME vertices the wall already has and no seam is introduced.
    // Splitting the wall into two meshes would duplicate a vertex at every
    // junction and bring back the diagonal shading seam.
    expect(wall.groups).toHaveLength(0);
    const corners = 4 + 4; // the square rim's, and the square hole's
    expect(wall.getAttribute('position').count).toBe(
      (rimRing.length + 4 + corners) * 2,
    );
    expect(wall.getAttribute('inferred').count).toBe(
      wall.getAttribute('position').count,
    );
  });

  it('splits a ring point only where it CREASES, so corners stay sharp', () => {
    const wall = buildStackWalls(
      tessellation,
      positionsXZ,
      [flat(0), flat(-100)],
      { fills: [true, false], threshold: 0.5 },
    ).walls[0]!;

    // The rim is a square: 4 corners split, the collinear points in between do
    // not. Splitting every point would give (12 + 12) * 2.
    expect(wall.getAttribute('position').count).toBe((rimRing.length + 4) * 2);

    // At a corner the two copies carry the two walls' own face normals, not the
    // 45° average that made the corner look rounded.
    const normal = wall.getAttribute('normal');
    const seen = new Set<string>();
    for (let i = 0; i < normal.count; i++) {
      seen.add(
        `${normal.getX(i).toFixed(3)},${normal.getY(i).toFixed(3)},${normal
          .getZ(i)
          .toFixed(3)}`,
      );
    }
    // exactly the four axis-aligned face normals, and nothing in between
    expect([...seen].sort()).toEqual([
      '-1.000,0.000,0.000',
      '0.000,0.000,-1.000',
      '0.000,0.000,1.000',
      '1.000,0.000,0.000',
    ]);
  });

  it('smooths a point whose turn is gentle, so a curved rim has no facets', () => {
    const wall = buildStackWalls(
      tessellation,
      positionsXZ,
      [flat(0), flat(-100)],
      { fills: [true, false], threshold: 0.5, smoothAngle: 180 },
    ).walls[0]!;

    // 180° treats every point as smooth: back to one vertex pair per point
    expect(wall.getAttribute('position').count).toBe(rimRing.length * 2);
  });

  it('leaves a wall unmarked when nothing was inferred', () => {
    const wall = buildStackWalls(
      tessellation,
      positionsXZ,
      [flat(0), flat(-100)],
      { fills: [true, false], threshold: 0.5 },
    ).walls[0]!;

    expect(wall.groups).toHaveLength(0);
    expect(wall.hasAttribute('inferred')).toBe(false);
  });

  it('carries the bounding layers’ inferred weight, so the marking can FADE', () => {
    // The upper surface was reconstructed over the right-hand half, with the
    // seal's own weight rising away from the data edge.
    const weights = new Float32Array(VERTICES);
    for (let v = 0; v < VERTICES; v++)
      weights[v] = Math.max(0, (v % N) - 1) / 2;

    const wall = buildStackWalls(
      tessellation,
      positionsXZ,
      [flat(0), flat(-100)],
      {
        fills: [true, false],
        threshold: 0.5,
        inferred: [weights, new Float32Array(VERTICES)],
      },
    ).walls[0]!;

    const values = marks(wall)!;
    // ⭐ A continuum, not two states — which is the whole reason this is an
    // interpolated attribute rather than a second material.
    expect(new Set(values).size).toBeGreaterThan(2);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBeCloseTo(Math.max(...weights), 5);
  });

  it('gives the wall metric UVs, so a pattern keeps its world scale', () => {
    const wall = buildStackWalls(
      tessellation,
      positionsXZ,
      [flat(0), flat(-100)],
      { fills: [true, false], threshold: 0.5 },
    ).walls[0]!;

    const uv = wall.getAttribute('uv');
    // u = arc length along the ring: starts at 0 and reaches the last point, which
    // is one segment short of the perimeter (the closing segment's far end IS
    // point 0, at u = 0 — the seam a repeating pattern has to live with).
    expect(uv.getX(0)).toBe(0);
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.max(...us)).toBeCloseTo((rimRing.length - 1) * 100, 3);
    // v = the vertex's own height, top and bottom of the same point
    expect(uv.getY(0)).toBe(0);
    expect(uv.getY(1)).toBe(-100);
  });
});
