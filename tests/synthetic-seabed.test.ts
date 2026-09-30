import { describe, expect, it } from 'vitest';
import { surfaceGridToWorld } from '../src/sdk/geometries/surface-clip';
import { CRS, getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import {
  getSyntheticSurface,
  SYNTHETIC_SEABED_ID,
} from '../src/storybook/data/synthetic-surfaces';
import storyArgs from '../src/storybook/story-args.json';

/**
 * The stand-in sea bed stands in for a horizon the demo data does not map, so the
 * chunk stories cut every chunk against it. ⚠️ A field's surveys need not straddle
 * its origin — the demo field's sit several km off to one side — so a grid placed
 * on the ORIGIN rather than on the DATA leaves most of the field with no sea bed,
 * and every chunk comes out truncated to wherever the two happened to overlap.
 */
describe('generated sea bed', () => {
  const crs = new CRS(
    getProjectionDefFromUtmZone(storyArgs.utmZone),
    storyArgs.origin as [number, number],
    'utm',
  );

  it('covers every corner of the demo field surveys', () => {
    const extent = storyArgs.fieldExtent as number[] | null;
    expect(extent, 'story-args carries no fieldExtent').not.toBeNull();

    const cap = getSyntheticSurface(SYNTHETIC_SEABED_ID);
    expect(cap).not.toBeNull();
    const h = cap!.meta.header;
    const p = crs.utmToWorld(h.xori, h.yori, 0);
    const toWorld = surfaceGridToWorld(
      { nx: h.nx, ny: h.ny, xinc: h.xinc, yinc: h.yinc, rot: h.rot },
      [p.x, p.z],
    );
    const corners = [
      toWorld(0, 0),
      toWorld(h.nx - 1, 0),
      toWorld(h.nx - 1, h.ny - 1),
      toWorld(0, h.ny - 1),
    ];
    const minX = Math.min(...corners.map(c => c[0]));
    const maxX = Math.max(...corners.map(c => c[0]));
    const minZ = Math.min(...corners.map(c => c[1]));
    const maxZ = Math.max(...corners.map(c => c[1]));

    const [minE, minN, maxE, maxN] = extent!;
    for (const [easting, northing] of [
      [minE, minN],
      [maxE, minN],
      [maxE, maxN],
      [minE, maxN],
    ]) {
      const w = crs.utmToWorld(easting, northing, 0);
      expect(w.x).toBeGreaterThanOrEqual(minX);
      expect(w.x).toBeLessThanOrEqual(maxX);
      expect(w.z).toBeGreaterThanOrEqual(minZ);
      expect(w.z).toBeLessThanOrEqual(maxZ);
    }
  });

  it('is mapped everywhere and lies wholly below sea level', () => {
    const cap = getSyntheticSurface(SYNTHETIC_SEABED_ID)!;
    expect(cap.values.length).toBe(cap.meta.header.nx * cap.meta.header.ny);
    // Depths are positive-down, so a bed reaching air would report min <= 0.
    expect(cap.meta.min).toBeGreaterThan(0);
    // And it sits at the field's own measured water depth, not an invented one.
    expect(cap.meta.min).toBeLessThanOrEqual(storyArgs.waterDepth!);
    expect(cap.meta.max).toBeGreaterThanOrEqual(storyArgs.waterDepth!);
  });
});
