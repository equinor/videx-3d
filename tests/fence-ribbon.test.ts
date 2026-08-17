import { describe, expect, it } from 'vitest';
import {
  createFenceField,
  fenceContour,
  nearestOnPolyline,
  sampleFenceField,
} from '../src/sdk/geometries/wellbore-fence';
import {
  buildFenceRibbons,
  createStackLocator,
} from '../src/sdk/geometries/fence-ribbon';
import { StackSectionSource } from '../src/sdk/geometries/surface-section';
import { Vec2 } from '../src/sdk/types/common';

const bounds: [number, number, number, number] = [-1000, -1000, 1000, 1000];

/** A grid of `n` x `n` quads over [0, n] in XZ, with two flat layers. */
function flatStack(n: number, topY: number, thickness: number) {
  const side = n + 1;
  const positionsXZ = new Float32Array(side * side * 2);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      positionsXZ[2 * (r * side + c)] = c;
      positionsXZ[2 * (r * side + c) + 1] = r;
    }
  }
  const tris: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * side + c;
      tris.push(a, a + 1, a + side + 1, a, a + side + 1, a + side);
    }
  }
  const indices = new Uint32Array(tris);
  const count = side * side;
  const source: StackSectionSource = {
    positionsXZ,
    indices,
    heights: [
      new Float32Array(count).fill(topY),
      new Float32Array(count).fill(topY - thickness),
    ],
    intervals: [new Uint8Array(indices.length / 3).fill(1)],
  };
  return source;
}

describe('nearestOnPolyline', () => {
  it('projects onto the nearest segment and reports the arc length', () => {
    const line: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    const a = nearestOnPolyline(line, 50, 30)!;
    expect(a.point).toEqual([50, 0]);
    expect(a.distance).toBeCloseTo(30, 6);
    expect(a.along).toBeCloseTo(50, 6);

    const b = nearestOnPolyline(line, 130, 60)!;
    expect(b.point[0]).toBeCloseTo(100, 6);
    expect(b.distance).toBeCloseTo(30, 6);
    expect(b.along).toBeCloseTo(160, 6);
  });
});

describe('fenceContour', () => {
  it('cuts a STRAIGHT line where the fence is straight', () => {
    // ⭐⭐ The guard for the wave. Near its own curve a signed distance is linear,
    // and bilinear reproduces a linear function exactly — so a straight fence must
    // contour to a straight line whatever the cell size. Smoothed (Hermite)
    // weights are exact only AT the nodes and bow between them, which put a
    // one-cell-period wave in the cut and, against a sloping surface, a row of
    // teeth along its top edge.
    // ⚠️ Diagonal on purpose: axis-aligned is the one case a bowed interpolation
    // also gets right, so it would not catch the regression.
    const positions: Vec2[] = [
      [-1500, -1500],
      [1500, 1500],
    ];
    const field = createFenceField(positions, { bounds, cellSize: 50 })!;
    const points = fenceContour(field, { width: 0, resolution: 7 }).flat();
    expect(points.length).toBeGreaterThan(50);
    let worst = 0;
    for (const p of points) {
      // Perpendicular distance from the line z = x.
      worst = Math.max(worst, Math.abs(p[0] - p[1]) / Math.SQRT2);
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('follows the SAMPLED iso, which is where the block actually ends', () => {
    // A diagonal, so nothing is aligned with the raster.
    const positions: Vec2[] = [
      [-1500, -1500],
      [1500, 1500],
    ];
    const field = createFenceField(positions, { bounds, cellSize: 50 })!;
    const at = sampleFenceField(field);
    const chains = fenceContour(field, { width: 0, resolution: 25 });
    expect(chains.length).toBeGreaterThan(0);
    const points = chains.flat();
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) {
      // ⭐⭐ THE contract. The face is drawn here while the GPU removes the block
      // by sampling the same field, so what must agree is the SAMPLED value — not
      // the analytic distance. Asserting the latter is what let a half-texel
      // offset hide, and it showed up as slivers of cap standing proud of the face.
      expect(Math.abs(at(p[0], p[1]))).toBeLessThan(0.01);
      // And it is still the right curve: within a cell of the true one.
      expect(nearestOnPolyline(positions, p[0], p[1])!.distance).toBeLessThan(
        50,
      );
    }
  });

  it('stands the requested distance off at a width', () => {
    const positions: Vec2[] = [
      [-1500, 0],
      [1500, 0],
    ];
    const field = createFenceField(positions, { bounds, cellSize: 50 })!;
    const at = sampleFenceField(field);
    const points = fenceContour(field, { width: 300, resolution: 25 }).flat();
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Math.abs(Math.abs(at(p[0], p[1])) - 300)).toBeLessThan(0.01);
      expect(nearestOnPolyline(positions, p[0], p[1])!.distance).toBeCloseTo(
        300,
        0,
      );
    }
  });
  it('does not double back where an offset curve would self-intersect', () => {
    // A hairpin far tighter than the offset: naively offsetting this produces a
    // loop, which is the whole reason the topology comes from the raster.
    const positions: Vec2[] = [
      [-800, -60],
      [400, -60],
      [400, 60],
      [-800, 60],
    ];
    const cellSize = 25;
    const field = createFenceField(positions, { bounds, cellSize })!;
    const chains = fenceContour(field, { width: 300, resolution: 25 });
    const points = chains.flat();
    expect(points.length).toBeGreaterThan(0);
    // Every point is at the offset, to within a cell — a self-intersected loop
    // would collapse some of them right onto the curve instead.
    for (const p of points) {
      const d = nearestOnPolyline(positions, p[0], p[1])!.distance;
      expect(d).toBeGreaterThan(300 - cellSize);
      expect(d).toBeLessThan(300 + cellSize);
    }
  });
});

describe('createStackLocator', () => {
  it('locates a point and interpolates any per-vertex channel', () => {
    const source = flatStack(4, -100, 40);
    const locator = createStackLocator(source.positionsXZ, source.indices);
    const at = locator.locate(1.25, 2.5);
    expect(at).not.toBeNull();
    expect(locator.valueAt(at!, source.heights[0])).toBeCloseTo(-100, 6);
    // A channel that varies linearly must come back interpolated, not snapped.
    const ramp = new Float32Array(source.positionsXZ.length / 2);
    for (let v = 0; v < ramp.length; v++) ramp[v] = source.positionsXZ[2 * v];
    expect(locator.valueAt(at!, ramp)).toBeCloseTo(1.25, 5);
  });

  it('returns null outside the mesh', () => {
    const source = flatStack(4, -100, 40);
    const locator = createStackLocator(source.positionsXZ, source.indices);
    expect(locator.locate(-5, 2)).toBeNull();
    expect(locator.locate(2, 99)).toBeNull();
  });
});

describe('buildFenceRibbons', () => {
  const path: Vec2[] = Array.from(
    { length: 21 },
    (_, i) => [0.5 + i * 0.15, 2] as Vec2,
  );

  it('spans the interval and follows the path, not the triangles', () => {
    const source = flatStack(4, -100, 40);
    const ribbons = buildFenceRibbons(source, path, { offset: 0 });
    expect(ribbons.length).toBe(1);
    const position = ribbons[0].geometry.getAttribute('position');
    // ⭐ One quad per path step, regardless of how few triangles it crosses —
    // this is the whole point of a ribbon over a cut through the cells.
    expect(position.count).toBe((path.length - 1) * 6);
    for (let v = 0; v < position.count; v++) {
      const y = position.getY(v);
      expect(y === -100 || y === -140).toBe(true);
    }
  });

  it('is vertical, and smooth along its length', () => {
    const source = flatStack(4, -100, 40);
    const normal = buildFenceRibbons(source, path, {
      offset: 0,
    })[0].geometry.getAttribute('normal');
    for (let v = 0; v < normal.count; v++) {
      expect(normal.getY(v)).toBe(0);
      // A straight path gives one normal throughout; a faceted build would not.
      expect(Math.abs(normal.getX(v))).toBeCloseTo(0, 6);
      expect(Math.abs(normal.getZ(v))).toBeCloseTo(1, 6);
    }
  });

  it('reaches the edge of the tessellation, not the last sample inside it', () => {
    const source = flatStack(4, -100, 40);
    // Steps of 0.3 over a grid spanning 0..4, deliberately landing nowhere near
    // the boundary: without clipping, the face would stop at x = 3.9 and the
    // 0.1 left over is a full-height slit between the face and the wall.
    const crossing: Vec2[] = Array.from(
      { length: 30 },
      (_, i) => [-1.2 + i * 0.3, 2] as Vec2,
    );
    const position = buildFenceRibbons(source, crossing, {
      offset: 0,
    })[0].geometry.getAttribute('position');
    let minX = Infinity;
    let maxX = -Infinity;
    for (let v = 0; v < position.count; v++) {
      minX = Math.min(minX, position.getX(v));
      maxX = Math.max(maxX, position.getX(v));
    }
    expect(minX).toBeCloseTo(0, 4);
    expect(maxX).toBeCloseTo(4, 4);
  });

  it('flips which way it looks', () => {
    const source = flatStack(4, -100, 40);
    const a = buildFenceRibbons(source, path, { offset: 0 })[0]
      .geometry.getAttribute('normal')
      .getZ(0);
    const b = buildFenceRibbons(source, path, { offset: 0, flip: true })[0]
      .geometry.getAttribute('normal')
      .getZ(0);
    expect(Math.sign(a)).toBe(-Math.sign(b));
  });

  it('draws nothing where the path leaves the mesh', () => {
    const source = flatStack(4, -100, 40);
    const outside: Vec2[] = [
      [-50, 2],
      [-40, 2],
      [-30, 2],
    ];
    expect(buildFenceRibbons(source, outside, { offset: 0 })).toEqual([]);
  });

  it('draws nothing where the interval has no thickness', () => {
    const source = flatStack(4, -100, 0);
    expect(buildFenceRibbons(source, path, { offset: 0 })).toEqual([]);
  });

  it('carries distance along the fence as u', () => {
    const source = flatStack(4, -100, 40);
    const geometry = buildFenceRibbons(source, path, {
      offset: 0,
      along: x => x * 10,
    })[0].geometry;
    const uv = geometry.getAttribute('uv');
    const position = geometry.getAttribute('position');
    for (let v = 0; v < uv.count; v++) {
      expect(uv.getX(v)).toBeCloseTo(position.getX(v) * 10, 4);
    }
  });
});
