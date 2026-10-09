import { describe, expect, it } from 'vitest';
import { buildSurfaceChunkSpec } from '../src/components/Chunks/chunk-spec';
import type { ChunkLayer } from '../src/components/Chunks/chunk-defs';
import { buildSpecStack } from '../src/generators/surface-chunk-generator';
import type { SurfaceMeta } from '../src/sdk/data/types/SurfaceMeta';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { densifyChunkRim } from '../src/sdk/geometries/surface-chunk';
import { Vec3 } from '../src/sdk/types/common';
import { TestStore } from './mocks/test-store';

// Grid node (c, r) lands at scene x = -1000 + 100c, z = 1000 + 100r.
const utmToArea = (e: number, n: number, a = 0): Vec3 => [
  e - 1000,
  a,
  5000 - n,
];

const NX = 41;

function surface(id: string, depthAt: (c: number, r: number) => number | null) {
  const depths = new Float32Array(NX * NX);
  let max = -Infinity;
  for (let r = 0; r < NX; r++)
    for (let c = 0; c < NX; c++) {
      const d = depthAt(c, r) ?? NaN;
      depths[r * NX + c] = d;
      if (d > max) max = d;
    }
  const values = depths.map(d => (Number.isNaN(d) ? -1 : max - d));
  const meta = {
    id,
    max,
    header: { nx: NX, ny: NX, xinc: 100, yinc: 100, rot: 0, xori: 0, yori: 0 },
  } as unknown as SurfaceMeta;
  return { meta, values };
}

const top = surface('top', () => 1000);
// Unmapped over x ∈ [500, 1500], z ∈ [2500, 3500] — what the void split opens.
const mid = surface('mid', (c, r) =>
  c >= 15 && c <= 25 && r >= 15 && r <= 25 ? null : 1500 + 2 * c,
);
const base = surface('base', () => 2000);

const outline = new PlanarPolygonGeometry([
  [
    [
      [0, 2000],
      [2000, 2000],
      [2000, 4000],
      [0, 4000],
      [0, 2000],
    ],
  ],
]);

async function build(topFill: boolean) {
  const store = new TestStore();
  store.data = {
    'surface-values': {
      top: top.values,
      mid: mid.values,
      base: base.values,
    },
  };
  const layers: ChunkLayer[] = [
    { surface: top.meta, fill: topFill },
    { surface: mid.meta, fill: true },
    { surface: base.meta },
  ];
  const spec = buildSurfaceChunkSpec(layers, utmToArea, outline, {
    resolve: { seal: true, sealMode: 'void' },
    maxError: 5,
  });
  const { densified } = densifyChunkRim(outline, 250);
  return (await buildSpecStack(store, spec, densified, 5))!;
}

describe('a void ceiling', () => {
  // The upper copy of a split horizon closes the unit ABOVE it.
  const ceilingOf = (result: Awaited<ReturnType<typeof build>>) =>
    result.source.findIndex((s, k) => s === 1 && result.ceilings[k]);

  it('is drawn under a filled interval', async () => {
    const result = await build(true);
    const k = ceilingOf(result);
    expect(k).toBeGreaterThan(0);
    expect(result.caps[k]).toBe(true);
  });

  it('is not drawn under a gap, where it would close nothing', async () => {
    const result = await build(false);
    const k = ceilingOf(result);
    expect(k).toBeGreaterThan(0);
    expect(result.caps[k]).toBe(false);
    expect(result.build.layers[k].geometry).toBeNull();
  });
});
