import { describe, expect, it } from 'vitest';
import {
  createClippedSurface,
  createSeabedMesh,
} from '../src/sdk/geometries/surface-clip';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { Vec2 } from '../src/sdk/types/common';

// A tilted plane height field: value = col + row. Because it is planar, the greedy
// simplification and the draped rim reproduce it exactly, so every output vertex's
// Y must equal `col + row` recovered from its world position. This pins down the
// bounding-box crop offset, the placement transform and the UV remap all at once.
describe('createClippedSurface (bbox crop)', () => {
  const nx = 20;
  const ny = 20;
  const xinc = 100;
  const yinc = 100;
  const zShift = -(ny - 1) * yinc; // grid is centered on Z before rotation (rot=0)

  const rampValues = () => {
    const v = new Float32Array(nx * ny);
    for (let row = 0; row < ny; row++) {
      for (let col = 0; col < nx; col++) v[row * nx + col] = col + row;
    }
    return v;
  };

  it('places a small mask correctly on a large grid (heights + extent)', () => {
    const header = { nx, ny, xinc, yinc, rot: 0 };
    // Mask covering grid cols [5,10], rows [5,10] in scene XZ (rot=0, wp=[0,0]):
    // x = col*xinc, z = row*yinc + zShift.
    const outer: Vec2[] = [
      [5 * xinc, 5 * yinc + zShift],
      [10 * xinc, 5 * yinc + zShift],
      [10 * xinc, 10 * yinc + zShift],
      [5 * xinc, 10 * yinc + zShift],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);

    const geo = createClippedSurface(rampValues(), header, {
      polygon,
      referenceDepth: 0, // y = value
      drape: false,
      cutHoles: false,
      maxError: 5,
    });
    expect(geo).not.toBeNull();

    const pos = geo!.getAttribute('position');
    const uv = geo!.getAttribute('uv');
    expect(pos.count).toBeGreaterThan(0);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Recover grid coords from the (rot=0) placement.
      const col = x / xinc;
      const row = (z - zShift) / yinc;
      // Planar field: y must equal col + row everywhere.
      expect(y).toBeCloseTo(col + row, 4);
      // Region is cropped to the mask bbox (+2 cell margin); boundary triangles
      // kept by centroid may reach the margin but never span the full grid.
      expect(col).toBeGreaterThanOrEqual(3 - 1e-4);
      expect(col).toBeLessThanOrEqual(12 + 1e-4);
      expect(row).toBeGreaterThanOrEqual(3 - 1e-4);
      expect(row).toBeLessThanOrEqual(12 + 1e-4);
      // UVs stay in full-grid space [0, 1].
      expect(uv.getX(i)).toBeCloseTo(col / (nx - 1), 4);
      expect(uv.getY(i)).toBeCloseTo(1 - row / (ny - 1), 4);
    }
  });

  it('returns null when the mask is fully outside the grid', () => {
    const header = { nx, ny, xinc, yinc, rot: 0 };
    const outer: Vec2[] = [
      [100 * xinc, 0],
      [110 * xinc, 0],
      [110 * xinc, 100],
      [100 * xinc, 100],
    ];
    const polygon = new PlanarPolygonGeometry([[outer]]);
    const geo = createClippedSurface(rampValues(), header, {
      polygon,
      referenceDepth: 0,
      drape: false,
    });
    expect(geo).toBeNull();
  });
});

// The seabed an occupant hands a sky stage: its rim must BE the outline, in the scene
// frame, so the stage's relief and walls built on it meet it exactly.
describe('createSeabedMesh', () => {
  const nx = 20;
  const ny = 20;
  const xinc = 100;
  const yinc = 100;
  const zShift = -(ny - 1) * yinc;
  const header = { nx, ny, xinc, yinc, rot: 0 };
  const values = new Float32Array(nx * ny);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) values[row * nx + col] = col + row;
  }
  const origin: Vec2 = [5000, -3000];
  const referenceDepth = 40;
  // A rotated hexagon about the grid's centre, off every grid line.
  const centre: Vec2 = [origin[0] + 950, origin[1] + zShift + 950];
  const outline: Vec2[] = Array.from({ length: 6 }, (_, i) => {
    const a = ((i * 60 + 10) * Math.PI) / 180;
    return [centre[0] + 600 * Math.cos(a), centre[1] + 600 * Math.sin(a)];
  });
  const polygon = new PlanarPolygonGeometry([[outline]]);

  const segmentDistance = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const [ax, az] = outline[i];
      const [bx, bz] = outline[(i + 1) % outline.length];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
      );
      best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
    return best;
  };

  it('⭐ its rim is the outline, every vertex of it, in the scene frame', () => {
    const mesh = createSeabedMesh(values, header, {
      polygon,
      referenceDepth,
      worldPosition: origin,
    });
    expect(mesh).not.toBeNull();
    const { positions, indices } = mesh!;

    // On the grid at the origin, at true depth: y = value - referenceDepth.
    for (let i = 0; i < positions.length; i += 3) {
      const col = (positions[i] - origin[0]) / xinc;
      const row = (positions[i + 2] - origin[1] - zShift) / yinc;
      expect(positions[i + 1]).toBeCloseTo(col + row - referenceDepth, 3);
    }

    const counts = new Map<string, number>();
    for (let i = 0; i < indices.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = indices[i + e];
        const b = indices[i + ((e + 1) % 3)];
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    const rim = new Set<number>();
    for (const [k, n] of counts) {
      if (n === 1) for (const v of k.split('_').map(Number)) rim.add(v);
    }
    expect(rim.size).toBeGreaterThanOrEqual(outline.length);
    for (const v of rim) {
      expect(
        segmentDistance(positions[3 * v], positions[3 * v + 2]),
      ).toBeLessThan(1e-2);
    }
    for (const [x, z] of outline) {
      const found = [...rim].some(
        v => Math.hypot(positions[3 * v] - x, positions[3 * v + 2] - z) < 1e-2,
      );
      expect(found).toBe(true);
    }
  });
});
