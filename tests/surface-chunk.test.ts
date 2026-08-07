import { describe, expect, it } from 'vitest';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import {
  createSurfaceChunk,
  densifyPolygon,
  SurfaceChunkLayer,
} from '../src/sdk/geometries/surface-chunk';
import { Vec2 } from '../src/sdk/types/common';

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a) / 2;
}

const flat = (nx: number, ny: number, value: number) =>
  new Float32Array(nx * ny).fill(value);

// Min/max Y of a geometry's position attribute.
function yRange(geometry: {
  getAttribute: (name: string) => {
    count: number;
    getY: (i: number) => number;
  };
}): [number, number] {
  const p = geometry.getAttribute('position');
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return [min, max];
}

describe('densifyPolygon', () => {
  it('adds vertices along edges without changing the shape', () => {
    const ring: Vec2[] = [
      [0, 0],
      [700, 0],
      [700, 700],
      [0, 700],
    ];
    const poly = new PlanarPolygonGeometry([[ring]]);
    const dense = densifyPolygon(poly, 200);
    const denseRing = (dense.coordinates as number[][][][])[0][0];
    expect(denseRing.length).toBeGreaterThan(ring.length);
    // Area is preserved (points only added along the existing edges).
    expect(ringArea(denseRing)).toBeCloseTo(ringArea(ring), 6);
  });

  it('is a no-op at spacing <= 0', () => {
    const ring: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const poly = new PlanarPolygonGeometry([[ring]]);
    expect(densifyPolygon(poly, 0)).toBe(poly);
  });
});

describe('createSurfaceChunk', () => {
  it('stitches layers with a shared rim into surfaces + interval walls', () => {
    // Two flat layers on identical grids: layer 0 at true depth 0, layer 1 at
    // -500. Grid footprint (scene XZ) spans [0, 900] x [-900, 0].
    const header = { nx: 10, ny: 10, xinc: 100, yinc: 100, rot: 0 };
    const layers: SurfaceChunkLayer[] = [
      {
        values: flat(10, 10, 100),
        header,
        referenceDepth: 100, // y = 100 - 100 = 0
        worldPosition: [0, 0],
        color: '#ff0000',
      },
      {
        values: flat(10, 10, 500),
        header,
        referenceDepth: 1000, // y = 500 - 1000 = -500
        worldPosition: [0, 0],
        color: '#00ff00',
      },
    ];
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);

    const chunk = createSurfaceChunk([layers], { polygon, rimSpacing: 200 });

    expect(chunk.groups.length).toBe(1);
    expect(chunk.groups[0].surfaces.length).toBe(2);
    expect(chunk.groups[0].walls.length).toBe(1);
    // The interval wall takes the colour of the surface above it.
    expect(chunk.groups[0].walls[0].color).toBe('#ff0000');

    // Every wall vertex sits on the top depth (0) or the bottom depth (-500).
    const pos = chunk.groups[0].walls[0].geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const onTop = Math.abs(y - 0) < 1e-4;
      const onBottom = Math.abs(y - -500) < 1e-4;
      expect(onTop || onBottom).toBe(true);
    }
  });

  it('leaves a gap between groups (no wall across the boundary)', () => {
    const header = { nx: 10, ny: 10, xinc: 100, yinc: 100, rot: 0 };
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);
    // Four layers descending in depth, split into two groups of two.
    const mkLayer = (depth: number, color: string): SurfaceChunkLayer => ({
      values: flat(10, 10, 100),
      header,
      referenceDepth: 100 + depth, // y = 100 - (100 + depth) = -depth
      worldPosition: [0, 0],
      color,
    });
    const groups: SurfaceChunkLayer[][] = [
      [mkLayer(0, '#f00'), mkLayer(200, '#0f0')],
      [mkLayer(600, '#00f'), mkLayer(800, '#ff0')],
    ];

    const chunk = createSurfaceChunk(groups, { polygon, rimSpacing: 200 });

    expect(chunk.groups.length).toBe(2);
    // Each group keeps its own two surfaces and exactly one interior wall...
    for (const g of chunk.groups) {
      expect(g.surfaces.length).toBe(2);
      expect(g.walls.length).toBe(1);
    }
    // ...so there are 2 walls total, not 3 (no wall bridges the group gap).
    expect(chunk.metrics.walls).toBe(2);
    expect(chunk.groups[0].walls[0].color).toBe('#f00');
    expect(chunk.groups[1].walls[0].color).toBe('#00f');
  });

  it('gives wall vertices horizontal normals, shared top-to-bottom', () => {
    const header = { nx: 10, ny: 10, xinc: 100, yinc: 100, rot: 0 };
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);
    const layers: SurfaceChunkLayer[] = [
      {
        values: flat(10, 10, 100),
        header,
        referenceDepth: 100,
        worldPosition: [0, 0],
        color: '#f00',
      },
      {
        values: flat(10, 10, 100),
        header,
        referenceDepth: 600,
        worldPosition: [0, 0],
        color: '#0f0',
      },
    ];

    const chunk = createSurfaceChunk([layers], { polygon, rimSpacing: 200 });
    const normal = chunk.groups[0].walls[0].geometry.getAttribute('normal');
    expect(normal).toBeTruthy();

    for (let i = 0; i < normal.count; i++) {
      // walls are vertical, so every normal is horizontal and unit length
      expect(Math.abs(normal.getY(i))).toBeLessThan(1e-6);
      expect(Math.hypot(normal.getX(i), normal.getZ(i))).toBeCloseTo(1, 5);
    }
    // A rim point's top (2k) and bottom (2k + 1) vertex must share a normal —
    // a normal varying vertically breaks along each quad's diagonal.
    for (let k = 0; k * 2 + 1 < normal.count; k++) {
      expect(normal.getX(2 * k)).toBeCloseTo(normal.getX(2 * k + 1), 6);
      expect(normal.getZ(2 * k)).toBeCloseTo(normal.getZ(2 * k + 1), 6);
    }
  });

  it('attaches a basement with a flat base below the deepest surface', () => {
    const header = { nx: 10, ny: 10, xinc: 100, yinc: 100, rot: 0 };
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);
    // One group, two flat layers at y = 0 and y = -500 (deepest = -500).
    const groups: SurfaceChunkLayer[][] = [
      [
        {
          values: flat(10, 10, 100),
          header,
          referenceDepth: 100,
          worldPosition: [0, 0],
          color: '#f00',
        },
        {
          values: flat(10, 10, 500),
          header,
          referenceDepth: 1000, // y = -500
          worldPosition: [0, 0],
          color: '#0f0',
        },
      ],
    ];

    // Attached (no `top`): top = deepest surface (-500); flat base 500 below.
    const chunk = createSurfaceChunk(groups, {
      polygon,
      rimSpacing: 200,
      basement: { thickness: 500 },
    });

    expect(chunk.basement).toBeDefined();
    const basement = chunk.basement!;
    // Attached basement has only the flat base cap (the top is the chunk surface).
    expect(basement.surfaces.length).toBe(1);
    expect(basement.walls.length).toBe(1);
    expect(basement.surfaces[0].color).toBe('#4a4a4a'); // default dark gray
    expect(chunk.metrics.basementMs).toBeGreaterThanOrEqual(0);

    // The base cap is FLAT at deepest (-500) - thickness (500) = -1000.
    const [baseMinY, baseMaxY] = yRange(basement.surfaces[0].geometry);
    expect(baseMinY).toBeCloseTo(-1000, 2);
    expect(baseMaxY).toBeCloseTo(-1000, 2);
    // Walls span from the deepest rim (-500) down to the flat base (-1000).
    const [wallMinY, wallMaxY] = yRange(basement.walls[0].geometry);
    expect(wallMaxY).toBeCloseTo(-500, 2);
    expect(wallMinY).toBeCloseTo(-1000, 2);
  });

  it('builds a standalone basement with a procedural rocky top + flat base', () => {
    const header = { nx: 10, ny: 10, xinc: 100, yinc: 100, rot: 0 };
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);
    const groups: SurfaceChunkLayer[][] = [
      [
        {
          values: flat(10, 10, 100),
          header,
          referenceDepth: 100, // y = 0
          worldPosition: [0, 0],
          color: '#f00',
        },
      ],
    ];

    const chunk = createSurfaceChunk(groups, {
      polygon,
      rimSpacing: 200,
      basement: {
        thickness: 300,
        top: {
          procedural: {
            depth: 1000,
            depthMode: 'mean',
            variation: 100,
            seed: 1,
          },
        },
      },
    });

    expect(chunk.basement).toBeDefined();
    const basement = chunk.basement!;
    // Standalone: a top cap + a flat base cap.
    expect(basement.surfaces.length).toBe(2);
    expect(basement.walls.length).toBe(1);

    // Top is rocky around -1000 ± 100; base is flat below the top's deepest point.
    const [topMinY, topMaxY] = yRange(basement.surfaces[0].geometry);
    expect(topMaxY).toBeLessThan(-800);
    expect(topMinY).toBeGreaterThan(-1200);
    const [baseMinY, baseMaxY] = yRange(basement.surfaces[1].geometry);
    expect(baseMinY).toBeCloseTo(baseMaxY, 2); // flat
    expect(baseMaxY).toBeLessThanOrEqual(topMinY + 1e-6); // below the whole top
  });

  it('uses an assigned surface as a standalone basement top', () => {
    const header = { nx: 10, ny: 10, xinc: 100, yinc: 100, rot: 0 };
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);
    const groups: SurfaceChunkLayer[][] = [
      [
        {
          values: flat(10, 10, 100),
          header,
          referenceDepth: 100, // y = 0
          worldPosition: [0, 0],
          color: '#f00',
        },
      ],
    ];

    const chunk = createSurfaceChunk(groups, {
      polygon,
      rimSpacing: 200,
      basement: {
        color: '#123456',
        thickness: 200,
        top: {
          surface: {
            values: flat(10, 10, 300),
            header,
            referenceDepth: 1300, // y = -1000
            worldPosition: [0, 0],
            color: '#000000',
          },
        },
      },
    });

    expect(chunk.basement).toBeDefined();
    const basement = chunk.basement!;
    expect(basement.surfaces.length).toBe(2);
    expect(basement.surfaces[0].color).toBe('#123456'); // basement colour, not layer colour
    // Top cap = the assigned surface at y = -1000; flat base 200 below at -1200.
    const [topMinY, topMaxY] = yRange(basement.surfaces[0].geometry);
    expect(topMinY).toBeCloseTo(-1000, 2);
    expect(topMaxY).toBeCloseTo(-1000, 2);
    const [baseMinY, baseMaxY] = yRange(basement.surfaces[1].geometry);
    expect(baseMinY).toBeCloseTo(-1200, 2);
    expect(baseMaxY).toBeCloseTo(-1200, 2);
  });

  it('builds an ocean top over the shallowest surface (surface mode)', () => {
    const header = { nx: 10, ny: 10, xinc: 100, yinc: 100, rot: 0 };
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);
    const groups: SurfaceChunkLayer[][] = [
      [
        {
          values: flat(10, 10, 500),
          header,
          referenceDepth: 1000, // shallowest surface at y = -500
          worldPosition: [0, 0],
          color: '#0f0',
        },
      ],
    ];

    const chunk = createSurfaceChunk(groups, {
      polygon,
      rimSpacing: 200,
      oceanTop: {},
    });

    expect(chunk.oceanTop).toBeDefined();
    const ocean = chunk.oceanTop!;
    // Water surface caps at sea level (y = 0); no separate bed (the surface is it).
    const [surfMinY, surfMaxY] = yRange(ocean.surface);
    expect(surfMinY).toBeCloseTo(0, 4);
    expect(surfMaxY).toBeCloseTo(0, 4);
    expect(ocean.bed).toBeUndefined();
    // The water body spans from sea level down to the shallowest surface (-500).
    const [bodyMinY, bodyMaxY] = yRange(ocean.body);
    expect(bodyMaxY).toBeCloseTo(0, 3);
    expect(bodyMinY).toBeCloseTo(-500, 3);
  });

  it('builds an ocean top with a procedural sea bed (no layers)', () => {
    const outer: Vec2[] = [
      [100, -100],
      [800, -100],
      [800, -800],
      [100, -800],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);

    const chunk = createSurfaceChunk([], {
      polygon,
      rimSpacing: 200,
      oceanTop: {
        procedural: { depth: 300, variation: 50, seed: 2 },
      },
    });

    expect(chunk.groups.length).toBe(0);
    expect(chunk.oceanTop).toBeDefined();
    const ocean = chunk.oceanTop!;
    expect(ocean.bed).toBeDefined();
    // Surface at sea level; procedural bed around -300 ± 50; body spans between.
    const [surfMinY, surfMaxY] = yRange(ocean.surface);
    expect(surfMinY).toBeCloseTo(0, 4);
    expect(surfMaxY).toBeCloseTo(0, 4);
    const [bedMinY, bedMaxY] = yRange(ocean.bed!);
    expect(bedMaxY).toBeLessThan(0);
    expect(bedMinY).toBeGreaterThan(-400);
    expect(bedMaxY).toBeLessThanOrEqual(-250 + 1e-6);
  });
});
