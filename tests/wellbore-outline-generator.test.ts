import { describe, expect, it } from 'vitest';
import { buildWellboreOutlineSpec } from '../src/components/Chunks/chunk-spec';
import { resolveWellboreOutline } from '../src/components/Chunks/resolveWellboreOutline';
import { generateWellboreOutline } from '../src/generators/wellbore-outline-generator';
import type { SurfaceMeta } from '../src/sdk/data/types/SurfaceMeta';
import {
  collectTrajectoryRuns,
  createSurfaceDepthSampler,
  createWellboreOutlineCoordinates,
  WellboreOutlineMetrics,
  WellborePath,
} from '../src/sdk/geometries/wellbore-outline';
import { Vec3 } from '../src/sdk/types/common';
import { TestStore } from './mocks/test-store';

// A CRS-like mapping with the origin at UTM (1000, 5000).
const utmToArea = (e: number, n: number, a = 0): Vec3 => [
  e - 1000,
  a,
  5000 - n,
];

const NX = 41;
const INC = 100;

// Grid covering scene x ∈ [-1000, 3000], z ∈ [1000, 5000]; depth tilts across it.
function surface(id: string, depthAt: (c: number, r: number) => number) {
  const depths = new Float32Array(NX * NX);
  for (let r = 0; r < NX; r++)
    for (let c = 0; c < NX; c++) depths[r * NX + c] = depthAt(c, r);
  const max = Math.max(...depths);
  const values = depths.map(d => max - d);
  const meta = {
    id,
    max,
    header: { nx: NX, ny: NX, xinc: INC, yinc: INC, rot: 0, xori: 0, yori: 0 },
  } as unknown as SurfaceMeta;
  return { meta, values };
}

const top = surface('top', c => 900 + 5 * c);
const mid = surface('mid', (_c, r) => 1600 + 4 * r);
const base = surface('base', c => 2400 + 3 * c);

// Flat [dE, tvd, dN, md] groups from the wellhead.
function log(steps: number, dEPerM: number, dNPerM: number) {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const tvd = i * 100;
    out.push(tvd * dEPerM, tvd, tvd * dNPerM, tvd);
  }
  return new Float32Array(out);
}

const headers = {
  a: { id: 'a', easting: 2000, northing: 2000 },
  b: { id: 'b', easting: 1500, northing: 3000 },
  shallow: { id: 'shallow', easting: 2500, northing: 2500 },
};
const logs = {
  a: log(30, 0, 0),
  b: log(30, 0.5, -0.3),
  shallow: log(8, 0.2, 0.2),
};

function makeStore() {
  const store = new TestStore();
  store.data = {
    'wellbore-headers': headers,
    'position-logs': logs,
    'surface-values': {
      top: top.values,
      mid: mid.values,
      base: base.values,
    },
  };
  return store;
}

const sampler = (s: typeof top) => {
  const p = utmToArea(s.meta.header.xori, s.meta.header.yori);
  return createSurfaceDepthSampler({
    values: s.values,
    header: s.meta.header,
    worldPosition: [p[0], p[2]],
    referenceDepth: s.meta.max,
  });
};

// The same cut and buffer, called directly on this thread.
function expected(
  intervals: {
    top: typeof top | null;
    base: typeof top | null;
    radius: number;
  }[],
  options: { cellSize: number; smoothing: number },
) {
  const bounds = intervals.map(i => ({
    top: i.top ? sampler(i.top) : null,
    base: i.base ? sampler(i.base) : null,
    radius: i.radius,
  }));
  const paths: WellborePath[] = [];
  for (const id of ['a', 'b', 'shallow'] as const) {
    const h = headers[id];
    const l = logs[id];
    const points: Vec3[] = [];
    for (let j = 0; j + 3 < l.length; j += 4)
      points.push(
        utmToArea(h.easting + l[j], h.northing + l[j + 2], -l[j + 1]),
      );
    for (const b of bounds)
      for (const run of collectTrajectoryRuns(points, b.top, b.base))
        paths.push({ points: run, radius: b.radius });
  }
  return createWellboreOutlineCoordinates(paths, { ...options, radius: 500 });
}

// `sampleSpacing` past any segment length leaves the trajectories undensified,
// so the direct path above needs no densify of its own.
const options = { cellSize: 50, smoothing: 1, sampleSpacing: 1e9 };

describe('generateWellboreOutline', () => {
  it('matches the direct cut-and-buffer, with a surface shared by two intervals', async () => {
    const spec = buildWellboreOutlineSpec(
      ['a', 'b', 'shallow'],
      options,
      [
        { top: top.meta, base: mid.meta, radius: 300 },
        { top: mid.meta, base: base.meta, radius: 600 },
      ],
      utmToArea,
    );
    expect(spec.surfaces.map(s => s.id)).toEqual(['top', 'mid', 'base']);
    expect(spec.intervals.map(i => [i.top, i.base])).toEqual([
      [0, 1],
      [1, 2],
    ]);

    const result = await generateWellboreOutline.call(makeStore(), spec);
    const reference = expected(
      [
        { top, base: mid, radius: 300 },
        { top: mid, base, radius: 600 },
      ],
      options,
    );
    expect(reference.coordinates).not.toBeNull();
    expect(result).toEqual(reference);
  });

  it('drops an interval whose bounding surface has no values', async () => {
    const store = makeStore();
    delete store.data['surface-values'].base;
    const spec = buildWellboreOutlineSpec(
      ['a', 'b'],
      options,
      [
        { top: top.meta, base: mid.meta, radius: 300 },
        { top: mid.meta, base: base.meta, radius: 600 },
      ],
      utmToArea,
    );
    const result = await generateWellboreOutline.call(store, spec);
    expect(result).toEqual(
      expected([{ top, base: mid, radius: 300 }], options),
    );
  });

  it('reproduces utmToArea exactly through the spec affine', () => {
    const { utmToScene: m } = buildWellboreOutlineSpec(
      [],
      undefined,
      [],
      utmToArea,
    );
    for (const [e, n, a] of [
      [452317.25, 6541026.5, -1834.75],
      [0, 0, 0],
    ]) {
      expect([
        m[0] * e + m[1] * n + m[2] * a + m[3],
        m[4] * e + m[5] * n + m[6] * a + m[7],
        m[8] * e + m[9] * n + m[10] * a + m[11],
      ]).toEqual(utmToArea(e, n, a));
    }
  });
});

describe('resolveWellboreOutline', () => {
  it('builds the polygon on this side and reports metrics through onMetrics', async () => {
    const store = makeStore();
    const seen: WellboreOutlineMetrics[] = [];
    const polygon = await resolveWellboreOutline(
      spec => generateWellboreOutline.call(store, spec),
      ['a', 'b'],
      { ...options, onMetrics: m => seen.push(m) },
      [{ top: top.meta, base: base.meta, radius: 500 }],
      utmToArea,
    );
    const reference = expected([{ top, base, radius: 500 }], options);
    expect(polygon?.coordinates).toEqual(reference.coordinates);
    expect(seen).toEqual([reference.metrics]);
  });
});
