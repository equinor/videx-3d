import { describe, expect, it } from 'vitest';
import {
  ChunkSurfaceLayer,
  clusterPoints2D,
  collectTrajectoryPoints,
  createSurfaceDepthSampler,
  createWellboreOutline,
  decimatePoints2D,
} from '../src/sdk/geometries/wellbore-outline';
import { pointInRing } from '../src/sdk/geometries/polygon-outline';
import { PlanarPolygonCoordinates } from '../src/sdk/geometries/planar-geometry';
import { Vec2, Vec3 } from '../src/sdk/types/common';

describe('createSurfaceDepthSampler', () => {
  const layer: ChunkSurfaceLayer = {
    values: new Float32Array(25).fill(100),
    header: { nx: 5, ny: 5, xinc: 100, yinc: 100, rot: 0 },
    worldPosition: [0, 0],
    referenceDepth: 100,
  };
  const sample = createSurfaceDepthSampler(layer);

  it('returns scene depth (value - referenceDepth) inside the grid', () => {
    expect(sample(0, 0)).toBeCloseTo(0, 6);
    expect(sample(200, -200)).toBeCloseTo(0, 6);
  });

  it('returns null outside the grid', () => {
    expect(sample(100000, 0)).toBeNull();
  });
});

describe('collectTrajectoryPoints', () => {
  const top = (x: number) => (x > 1000 ? null : -100);
  const base = (x: number) => (x > 1000 ? null : -500);

  it('keeps only samples within the top/base depth window', () => {
    const samples: Vec3[] = [
      [0, -300, 0], // inside window -> kept
      [10, -100, 0], // exactly at the top -> kept
      [20, -50, 0], // above the top -> dropped
      [30, -600, 0], // below the base -> dropped
    ];
    const kept = collectTrajectoryPoints(samples, top, base);
    expect(kept).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it('drops samples where a surface has no data', () => {
    const samples: Vec3[] = [[2000, -300, 0]];
    expect(collectTrajectoryPoints(samples, top, base)).toEqual([]);
  });
});

describe('clusterPoints2D', () => {
  it('separates distant point groups and merges near ones', () => {
    const points: Vec2[] = [
      [0, 0],
      [300, 0],
      [10000, 0],
      [10300, 0],
    ];
    const clusters = clusterPoints2D(points, 1000);
    expect(clusters.length).toBe(2);
    expect(clusters.every(c => c.length === 2)).toBe(true);
  });

  it('merges everything under a large threshold', () => {
    const points: Vec2[] = [
      [0, 0],
      [300, 0],
      [10000, 0],
    ];
    expect(clusterPoints2D(points, 100000).length).toBe(1);
  });

  it('stays fast when many points pile into one cell (O(points))', () => {
    // 40k points all at the platform origin — the pathological dense case that
    // used to blow up pairwise clustering. Grid connected-components handles it.
    const points: Vec2[] = [];
    for (let i = 0; i < 40000; i++) points.push([Math.random() * 5, 0]);
    const t0 = performance.now();
    const clusters = clusterPoints2D(points, 2000);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(clusters.length).toBe(1);
  });
});

describe('decimatePoints2D', () => {
  it('keeps one representative per grid cell', () => {
    const points: Vec2[] = [
      [0, 0],
      [10, 10], // same 100-cell as [0,0]
      [150, 0], // different cell
      [199, 99], // same cell as [150,0]
    ];
    const out = decimatePoints2D(points, 100);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual([0, 0]);
    expect(out[1]).toEqual([150, 0]);
  });

  it('is a no-op at spacing <= 0', () => {
    const points: Vec2[] = [
      [0, 0],
      [1, 1],
    ];
    expect(decimatePoints2D(points, 0)).toBe(points);
  });
});

describe('createWellboreOutline', () => {
  const blob: Vec2[] = [
    [0, 0],
    [100, 0],
    [0, 100],
    [-100, 0],
    [0, -100],
  ];

  it('builds a single-component buffer around one cluster', () => {
    const poly = createWellboreOutline([blob], {
      radius: 500,
      cellSize: 100,
      smoothing: 0,
    });
    expect(poly).not.toBeNull();
    const coords = poly!.coordinates as PlanarPolygonCoordinates;
    expect(coords.length).toBe(1);
    const outer = coords[0][0];
    // The cluster centre is inside the buffer, a far point is outside.
    expect(pointInRing(0, 0, outer)).toBe(true);
    expect(pointInRing(5000, 5000, outer)).toBe(false);
  });

  it('yields separate components for divergent clusters', () => {
    const far: Vec2[] = blob.map(([x, z]) => [x + 10000, z]);
    const poly = createWellboreOutline([blob, far], {
      radius: 500,
      cellSize: 100,
      smoothing: 0,
    });
    expect(poly).not.toBeNull();
    const coords = poly!.coordinates as PlanarPolygonCoordinates;
    expect(coords.length).toBe(2);
  });

  it('returns null with no points', () => {
    expect(createWellboreOutline([])).toBeNull();
    expect(createWellboreOutline([[]])).toBeNull();
  });

  it('produces finite coordinates for far-apart clusters (no NaN)', () => {
    // Distant clusters + large radius leave raster nodes beyond every cluster's
    // prune range; those must be clamped to a finite value so marching-squares
    // interpolation never yields NaN coordinates.
    const far: Vec2[] = blob.map(([x, z]) => [x + 12000, z + 4000]);
    const poly = createWellboreOutline([blob, far], {
      radius: 2000,
      cellSize: 200,
      feather: 3,
      smoothing: 1,
    });
    expect(poly).not.toBeNull();
    const coords = poly!.coordinates as PlanarPolygonCoordinates;
    for (const comp of coords) {
      for (const ring of comp) {
        for (const [x, z] of ring) {
          expect(Number.isFinite(x)).toBe(true);
          expect(Number.isFinite(z)).toBe(true);
        }
      }
    }
  });
});
