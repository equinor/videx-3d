import { describe, expect, it } from 'vitest';
import { createClippedSurface } from '../src/sdk/geometries/surface-clip';
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
