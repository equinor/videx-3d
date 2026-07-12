import { describe, expect, it } from 'vitest';
import { createSurfaceOutline } from '../src/sdk/geometries/surface-outline';
import { pointInRing } from '../src/sdk/geometries/polygon-outline';
import { PlanarPolygonCoordinates } from '../src/sdk/geometries/planar-geometry';
import { SurfaceClipHeader } from '../src/sdk/geometries/surface-clip';

const header: SurfaceClipHeader = {
  nx: 10,
  ny: 10,
  xinc: 100,
  yinc: 100,
  rot: 0,
};

describe('createSurfaceOutline', () => {
  it('extracts the outer rim + an internal no-data hole', () => {
    // Fully valid grid except a central 2x2 hole (invalid = -1).
    const values = new Float32Array(header.nx * header.ny).fill(100);
    for (const r of [4, 5]) {
      for (const c of [4, 5]) values[r * header.nx + c] = -1;
    }
    const poly = createSurfaceOutline(values, header);
    expect(poly).not.toBeNull();
    const coords = poly!.coordinates as PlanarPolygonCoordinates;
    expect(coords.length).toBe(1);
    // outer ring + one hole
    expect(coords[0].length).toBe(2);

    // Outer ring spans (roughly) the full grid extent in scene XZ.
    const [minX, minZ] = poly!.min;
    const [maxX, maxZ] = poly!.max;
    expect(minX).toBeCloseTo(0, 6);
    expect(maxX).toBeCloseTo((header.nx - 1) * header.xinc, 6);
    expect(minZ).toBeCloseTo(-(header.ny - 1) * header.yinc, 6);
    expect(maxZ).toBeCloseTo(0, 6);

    // A point in the hole is outside the outline (inside the outer but inside the
    // hole ring), a point in solid data is inside.
    const outer = coords[0][0];
    const hole = coords[0][1];
    expect(pointInRing(450, -450, hole)).toBe(true);
    expect(pointInRing(150, -150, outer)).toBe(true);
    expect(pointInRing(150, -150, hole)).toBe(false);
  });

  it('returns null when there is no valid data', () => {
    const values = new Float32Array(header.nx * header.ny).fill(-1);
    expect(createSurfaceOutline(values, header)).toBeNull();
  });

  it('applies the worldPosition offset to the outline', () => {
    const values = new Float32Array(header.nx * header.ny).fill(100);
    const poly = createSurfaceOutline(values, header, {
      worldPosition: [1000, 2000],
    });
    expect(poly).not.toBeNull();
    const [minX] = poly!.min;
    const [, minZ] = poly!.min;
    expect(minX).toBeCloseTo(1000, 6);
    expect(minZ).toBeCloseTo(2000 - (header.ny - 1) * header.yinc, 6);
  });
});
