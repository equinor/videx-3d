import { BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { createOceanBoxFromPolygon } from '../src/sdk/geometries/ocean-geometry';
import type { Coordinates2D } from '../src/sdk/geometries/planar-geometry';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { DEMO_MULTI_POLYGON } from '../src/storybook/data/demo-polygons';

// The story's own footprint: three separated components, the middle one with TWO
// holes close together.
const coords = DEMO_MULTI_POLYGON;

function ringContains(x: number, y: number, r: Coordinates2D): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0],
      yi = r[i][1],
      xj = r[j][0],
      yj = r[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number): boolean {
  for (const comp of coords) {
    if (!ringContains(x, y, comp[0])) continue;
    let inHole = false;
    for (let r = 1; r < comp.length; r++)
      if (ringContains(x, y, comp[r])) inHole = true;
    if (!inHole) return true;
  }
  return false;
}

function pointInTri(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-9) return false;
  const a = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
  const b = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
  const c = 1 - a - b;
  return a >= -1e-6 && b >= -1e-6 && c >= -1e-6;
}

function countUncovered(
  pos: BufferAttribute,
  idx: BufferAttribute,
  n: number,
): number {
  const minX = -2300,
    maxX = 2100,
    minY = -750,
    maxY = 2100;
  let uncovered = 0;
  for (let ix = 0; ix <= n; ix++) {
    for (let iy = 0; iy <= n; iy++) {
      const x = minX + ((maxX - minX) * ix) / n;
      const y = minY + ((maxY - minY) * iy) / n;
      if (!inPolygon(x, y)) continue;
      const wx = x;
      const wz = -y; // bed maps polygon (x, y) -> world (x, 0, -y)
      let covered = false;
      for (let t = 0; t < idx.count && !covered; t += 3) {
        const a = idx.getX(t),
          b = idx.getX(t + 1),
          c = idx.getX(t + 2);
        if (
          pointInTri(
            wx,
            wz,
            pos.getX(a),
            pos.getZ(a),
            pos.getX(b),
            pos.getZ(b),
            pos.getX(c),
            pos.getZ(c),
          )
        )
          covered = true;
      }
      if (!covered) uncovered++;
    }
  }
  return uncovered;
}

describe('createOceanBoxFromPolygon multi-hole footprint', () => {
  it('triangulates the whole sea bed with no gaps around close holes', () => {
    const geom = new PlanarPolygonGeometry(coords);
    const box = createOceanBoxFromPolygon(geom, {
      surfaceSegments: 0,
      bedSegments: 48,
    });
    const pos = box.bed.getAttribute('position') as BufferAttribute;
    const idx = box.bed.getIndex() as BufferAttribute;
    expect(countUncovered(pos, idx, 160)).toBe(0);
  });

  it('produces no degenerate or folded triangles (consistent XZ winding)', () => {
    const geom = new PlanarPolygonGeometry(coords);
    const box = createOceanBoxFromPolygon(geom, {
      surfaceSegments: 0,
      bedSegments: 48,
    });
    const pos = box.bed.getAttribute('position') as BufferAttribute;
    const idx = box.bed.getIndex() as BufferAttribute;
    let degenerate = 0;
    let flipped = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t),
        b = idx.getX(t + 1),
        c = idx.getX(t + 2);
      // Signed area in the XZ plane (displacement only moves Y, so a correct
      // triangulation keeps every triangle's XZ winding identical and non-zero).
      const area =
        (pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a)) -
        (pos.getX(c) - pos.getX(a)) * (pos.getZ(b) - pos.getZ(a));
      if (Math.abs(area) < 1e-6) degenerate++;
      else if (area > 0) flipped++;
    }
    expect(degenerate).toBe(0);
    // All triangles share one winding sign -> the minority count must be 0.
    expect(Math.min(flipped, idx.count / 3 - flipped)).toBe(0);
  });

  it('keeps the surface, sea bed and wall rims watertight (shared outline)', () => {
    const geom = new PlanarPolygonGeometry(coords);
    const box = createOceanBoxFromPolygon(geom, {
      surfaceSegments: 64,
      bedSegments: 48,
    });
    const surf = box.surface.getAttribute('position') as BufferAttribute;
    const idx = box.bed.getIndex() as BufferAttribute;
    const pos = box.bed.getAttribute('position') as BufferAttribute;
    // Even with different surface/bed refinement levels the bed has no gaps.
    expect(countUncovered(pos, idx, 120)).toBe(0);
    expect(surf.count).toBeGreaterThan(0);
  });
});
