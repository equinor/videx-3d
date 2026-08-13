import { describe, expect, it } from 'vitest';
import {
  ChunkSurfaceLayer,
  clusterPoints2D,
  collectTrajectoryRuns,
  createSurfaceDepthSampler,
  createWellboreOutline,
  WellboreOutlineMetrics,
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

describe('collectTrajectoryRuns', () => {
  const top = (x: number) => (x > 1000 ? null : -100);
  const base = (x: number) => (x > 1000 ? null : -500);

  it('keeps only samples within the top/base depth window', () => {
    const samples: Vec3[] = [
      [0, -300, 0], // inside window
      [10, -100, 0], // exactly at the top
      [20, -50, 0], // above the top -> ends the run
      [30, -600, 0], // below the base
    ];
    const runs = collectTrajectoryRuns(samples, top, base);
    expect(runs.length).toBe(1);
    // the run holds both inside samples plus the interpolated exit
    expect(runs[0].slice(0, 2)).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it('drops samples where a surface in play has no data', () => {
    const samples: Vec3[] = [[2000, -300, 0]];
    expect(collectTrajectoryRuns(samples, top, base)).toEqual([]);
  });

  it('splits into several runs when a well leaves and re-enters', () => {
    const samples: Vec3[] = [
      [0, -300, 0],
      [10, -50, 0], // out
      [20, -300, 0], // back in
    ];
    const runs = collectTrajectoryRuns(samples, top, base);
    expect(runs.length).toBe(2);
  });

  it('is unbounded above when `top` is null, and below when `base` is null', () => {
    const samples: Vec3[] = [
      [0, 0, 0], // wellhead, far above the top surface
      [0, -300, 0],
      [0, -900, 0], // below the base
    ];
    // 'above' mode: everything down to the base
    expect(collectTrajectoryRuns(samples, null, base)[0].length).toBe(3);
    // 'below' mode: everything from the top down
    expect(collectTrajectoryRuns(samples, top, null)[0].length).toBe(3);
  });

  it('interpolates the crossing, so a run end does not move with the spacing', () => {
    // A well diving through the base at a known XZ, so the crossing has a closed
    // form: y = -400 - x crosses the base (-500) at x = 100.
    const at = (x: number): Vec3 => [x, -400 - x, 0];
    const coarse = collectTrajectoryRuns([at(0), at(200)], top, base);
    const fine = collectTrajectoryRuns(
      [at(0), at(50), at(100), at(150), at(200)],
      top,
      base,
    );
    expect(coarse[0][coarse[0].length - 1][0]).toBeCloseTo(100, 6);
    expect(fine[0][fine[0].length - 1][0]).toBeCloseTo(100, 6);
  });

  it('keeps a sample the OTHER bound allows when unmapped is ignored', () => {
    // The base has no data past x = 1000 (a hole in a deep surface); the top has.
    const base1000 = (x: number) => (x > 1000 ? null : -500);
    const samples: Vec3[] = [
      [900, -300, 0], // both mapped, inside
      [1500, -300, 0], // base unmapped, but below the top
      [1500, -50, 0], // base unmapped, and ABOVE the top
    ];
    // Default: the unmapped base gates the footprint entirely.
    expect(collectTrajectoryRuns(samples, top, base1000)).toEqual([[[900, 0]]]);
    // Ignored: the top still applies, so only the sample above it is dropped.
    const runs = collectTrajectoryRuns(samples, top, base1000, {
      unmapped: 'ignore',
    });
    expect(runs.length).toBe(1);
    expect(runs[0].slice(0, 2)).toEqual([
      [900, 0],
      [1500, 0],
    ]);
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

describe('createWellboreOutline', () => {
  const blob: Vec2[] = [
    [0, 0],
    [100, 0],
    [0, 100],
    [-100, 0],
    [0, -100],
  ];

  it('builds a single-component buffer around one path', () => {
    const poly = createWellboreOutline([blob], {
      radius: 500,
      cellSize: 100,
      smoothing: 0,
    });
    expect(poly).not.toBeNull();
    const coords = poly!.coordinates as PlanarPolygonCoordinates;
    expect(coords.length).toBe(1);
    const outer = coords[0][0];
    // The path is inside the buffer, a far point is outside.
    expect(pointInRing(0, 0, outer)).toBe(true);
    expect(pointInRing(5000, 5000, outer)).toBe(false);
  });

  it('yields separate components for divergent paths', () => {
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

  it('returns null with no paths', () => {
    expect(createWellboreOutline([])).toBeNull();
    expect(createWellboreOutline([[]])).toBeNull();
  });

  it('produces finite coordinates for far-apart paths (no NaN)', () => {
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

  it('buffers the SEGMENTS, not just the sampled points', () => {
    // Two points 4 km apart with a 300 m radius: a point-distance field leaves a
    // 3.4 km gap in the middle, a segment field covers the whole corridor.
    const path: Vec2[] = [
      [0, 0],
      [4000, 0],
    ];
    const poly = createWellboreOutline([path], { radius: 300, smoothing: 0 });
    expect(poly).not.toBeNull();
    const coords = poly!.coordinates as PlanarPolygonCoordinates;
    expect(coords.length).toBe(1);
    const outer = coords[0][0];
    expect(pointInRing(2000, 0, outer)).toBe(true);
    expect(pointInRing(2000, 800, outer)).toBe(false);
  });

  it('resolves a small radius that used to fall between raster nodes', () => {
    // radius 40 against the default cellSize of 100: the buffer is thinner than a
    // cell unless the raster follows the radius.
    const path: Vec2[] = [
      [0, 0],
      [2000, 0],
    ];
    let metrics: WellboreOutlineMetrics | undefined;
    const poly = createWellboreOutline([path], {
      radius: 40,
      smoothing: 0,
      onMetrics: m => (metrics = m),
    });
    expect(poly).not.toBeNull();
    expect(metrics!.requestedCellSize).toBeCloseTo(40 / 3, 6);
    expect(metrics!.coarsened).toBe(false);
    const outer = (poly!.coordinates as PlanarPolygonCoordinates)[0][0];
    expect(pointInRing(1000, 0, outer)).toBe(true);
    expect(pointInRing(1000, 200, outer)).toBe(false);
  });

  it('rasterizes separated paths per group, not over one bounding box', () => {
    const a: Vec2[] = [
      [0, 0],
      [2000, 0],
    ];
    const b: Vec2[] = a.map(([x, z]): Vec2 => [x + 40000, z + 40000]);
    let one: WellboreOutlineMetrics | undefined;
    let two: WellboreOutlineMetrics | undefined;
    const single = createWellboreOutline([a], {
      radius: 200,
      smoothing: 0,
      onMetrics: m => (one = m),
    });
    const pair = createWellboreOutline([a, b], {
      radius: 200,
      smoothing: 0,
      onMetrics: m => (two = m),
    });
    expect(two!.groups).toBe(2);
    // Two groups cost twice one group, NOT the 40 km box between them.
    expect(two!.nodes).toBeLessThan(3 * one!.nodes);
    // ...and the first component is unchanged by the presence of the second.
    const singleOuter = (single!.coordinates as PlanarPolygonCoordinates)[0][0];
    const pairCoords = pair!.coordinates as PlanarPolygonCoordinates;
    expect(pairCoords.length).toBe(2);
    const near = pairCoords.find(c => c[0].some(([x]) => x < 20000))!;
    expect(near[0]).toEqual(singleOuter);
  });

  it('merges paths whose buffers touch into one component', () => {
    const a: Vec2[] = [
      [0, 0],
      [2000, 0],
    ];
    const b: Vec2[] = [
      [0, 900],
      [2000, 900],
    ];
    const apart = createWellboreOutline([a, b], { radius: 300, smoothing: 0 });
    const touching = createWellboreOutline([a, b], {
      radius: 600,
      smoothing: 0,
    });
    expect((apart!.coordinates as PlanarPolygonCoordinates).length).toBe(2);
    expect((touching!.coordinates as PlanarPolygonCoordinates).length).toBe(1);
  });

  it('matches the analytic buffer of crossing diagonal segments', () => {
    // Diagonals are the case a bounding-box prune handles worst and a bucket grid
    // could plausibly miss, so probe the result against ground truth: a point is
    // inside iff its distance to the segment set is <= radius.
    const paths: Vec2[][] = [
      [
        [-3000, -3000],
        [3000, 3000],
      ],
      [
        [-3000, 2500],
        [3000, -2500],
      ],
      [
        [-2800, 0],
        [1200, 2900],
        [2900, -1500],
      ],
    ];
    const radius = 250;
    const cellSize = 50;
    const poly = createWellboreOutline(paths, {
      radius,
      cellSize,
      smoothing: 0,
    });
    expect(poly).not.toBeNull();
    const coords = poly!.coordinates as PlanarPolygonCoordinates;

    const distance = (x: number, z: number) => {
      let best = Infinity;
      for (const path of paths)
        for (let i = 1; i < path.length; i++) {
          const [ax, az] = path[i - 1];
          const dx = path[i][0] - ax;
          const dz = path[i][1] - az;
          const len2 = dx * dx + dz * dz;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2),
          );
          const ex = ax + t * dx - x;
          const ez = az + t * dz - z;
          best = Math.min(best, Math.hypot(ex, ez));
        }
      return best;
    };
    // Even-odd over every component: outer rings add, holes subtract.
    const drawn = (x: number, z: number) =>
      coords.some(
        component =>
          pointInRing(x, z, component[0]) &&
          !component.slice(1).some(hole => pointInRing(x, z, hole)),
      );

    let probed = 0;
    for (let x = -3000; x <= 3000; x += 97) {
      for (let z = -3000; z <= 3000; z += 97) {
        const d = distance(x, z);
        // Skip the band the raster cannot resolve either way.
        if (Math.abs(d - radius) < 2 * cellSize) continue;
        probed++;
        expect(drawn(x, z)).toBe(d < radius);
      }
    }
    expect(probed).toBeGreaterThan(2000);
  });
});
