import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { describe, it } from 'vitest';
import { PlanarPolygonGeometry } from '../../src/sdk/geometries/planar-geometry';
import { surfaceGridToWorld } from '../../src/sdk/geometries/surface-clip';
import {
  ColumnSpec,
  ColumnStep,
  generateColumn,
} from '../../src/sdk/geometries/surface-column';
import {
  buildStackReference,
  StackGridLayer,
  StackReference,
  tessellateStack,
} from '../../src/sdk/geometries/surface-stack';
import {
  collectCoverageCrossings,
  collectStackCandidates,
  collectThicknessCrossings,
} from '../../src/sdk/geometries/surface-stack-candidates';

/**
 * Opt-in measurement for the question `documents/chunks.md` §11 leaves open: what
 * would it cost to hoist the tessellation from the CHUNK to the STACK?
 *
 *   PROFILE_HOIST=1 npx vitest run tests/perf/stack-hoist-profile.test.ts
 *   PROFILE_HOIST_REAL=1 npx vitest run tests/perf/stack-hoist-profile.test.ts
 *
 * ⭐ Hoisting does not have to be built to be costed. A chunk's triangulation is
 * driven by the UNION of its layers' refinement candidates (`tessellateStack`
 * unions them internally), so the whole question is: how much bigger is that union
 * when it carries the WHOLE column instead of the chunk's own slice? Tessellating
 * the same reference both ways answers it exactly, with the real triangulator.
 *
 * The generated column (§14.4) is the control — deterministic, no data files, and
 * the number of layers can be varied. The real surfaces are the check: they carry
 * survey edges and pinch-outs, which add coverage and thickness candidates that a
 * generated column has none of, and those are the ones the hoisted union has to
 * carry for every layer.
 */

const KM = 1000;
const NODES = 300;
const CELL = 25;
const ROT = 220;
const TOP_DEPTH = 1200;
const BASE_DEPTH = 3000;

const columnSpec = (
  units: number,
  correlated: boolean,
): Omit<ColumnSpec, 'grid'> => {
  const span = BASE_DEPTH - TOP_DEPTH;
  const per = span / Math.max(1, units);
  const steps: ColumnStep[] = [];
  let datum = BASE_DEPTH;
  for (let i = 0; i < units; i++) {
    datum -= per;
    const fill = [0.9, 0.5, 0.15][i % 3];
    steps.push({
      name: `Unit ${i}`,
      drape: per * (1 - fill) * 0.8,
      fill,
      datum,
      // ⭐ The variable the answer turns on. Correlated: units drape the structure
      // below, so their refinement lands on the same nodes and the union barely
      // grows. Independent: every unit carries relief of its own at its own scale,
      // which is closer to a real column of separately picked horizons.
      relief: correlated
        ? i % 3 === 2
          ? [{ amplitude: per * 0.25, seed: 11 + i, featureSize: 3 * KM }]
          : undefined
        : [
            {
              amplitude: per * 0.6,
              seed: 101 + 7 * i,
              featureSize: (1 + (i % 5) * 0.7) * KM,
            },
          ],
    });
  }
  return {
    basement: {
      name: 'Basement',
      base: BASE_DEPTH,
      dip: { azimuth: 120, gradient: 0.02 },
      relief: [
        { kind: 'ridges', amplitude: 400, seed: 7, featureSize: 6 * KM },
      ],
    },
    steps,
    seed: 1,
  };
};

/** An axis-aligned square of `size` km, centred on `at` (default the origin). */
const square = (size: number, at: [number, number] = [0, 0]) => {
  const h = (size * KM) / 2;
  const [cx, cz] = at;
  return new PlanarPolygonGeometry([
    [
      [
        [cx - h, cz - h],
        [cx + h, cz - h],
        [cx + h, cz + h],
        [cx - h, cz + h],
      ],
    ],
  ]);
};

const buildColumn = (units: number, correlated: boolean) => {
  const extent = NODES * CELL;
  const header = { nx: NODES, ny: NODES, xinc: CELL, yinc: CELL, rot: ROT };
  const worldPosition: [number, number] = [-extent / 2, -extent / 2];
  const surfaces = generateColumn({
    ...columnSpec(units, correlated),
    grid: { header, worldPosition },
  });
  return surfaces.map<StackGridLayer>(s => ({
    values: s.values,
    header,
    referenceDepth: s.max,
    worldPosition,
    nullValue: s.nullValue,
  }));
};

const MAX_ERROR = 5;
const COLLAPSE = 0.5;

/**
 * The comparison itself: today's per-chunk tessellations against one shared
 * buffer, over the same reference.
 *
 * ⚠️ The tiers TELESCOPE — a deeper chunk is cut tighter around the wells — so
 * today's cost is measured on each tier's own (smaller) outline while the shared
 * buffer has to span the envelope containing them all. Giving every tier the
 * envelope would flatter hoisting.
 */
const measure = (
  label: Record<string, unknown>,
  reference: StackReference,
  centre: [number, number] = [0, 0],
) => {
  const { nx } = reference.header;
  const count = reference.channels.length;

  const heights = reference.channels.map(c =>
    collectStackCandidates(c, nx, MAX_ERROR),
  );
  const coverage = reference.masks.map(m => collectCoverageCrossings(m, nx));
  const thickness = reference.channels.map((c, i) =>
    i === 0
      ? new Uint32Array(0)
      : collectThicknessCrossings(reference.channels[i - 1], c, nx, COLLAPSE),
  );
  const all = reference.channels.map((_, i) => {
    const parts = [heights[i], coverage[i], thickness[i]];
    const out = new Uint32Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  });

  const tiers: [number, number, PlanarPolygonGeometry][] = [
    [0, Math.ceil(count / 3), square(6, centre)],
    [Math.ceil(count / 3), Math.ceil((2 * count) / 3), square(4.5, centre)],
    [Math.ceil((2 * count) / 3), count, square(3, centre)],
  ];

  const tShared = performance.now();
  const shared = tessellateStack(reference, square(6, centre), MAX_ERROR, all)!;
  const msShared = performance.now() - tShared;

  const rows = tiers.map(([from, to, outline], tier) => {
    const t0 = performance.now();
    const local = tessellateStack(
      reference,
      outline,
      MAX_ERROR,
      all.slice(from, to),
    )!;
    return {
      tier,
      layers: to - from,
      vertsLocal: local.coords.length / 2,
      trisLocal: local.indices.length / 3,
      msLocal: +(performance.now() - t0).toFixed(1),
    };
  });

  // ⭐ The aggregate is the number that decides this. Today every chunk owns a
  // vertex buffer; hoisted there is ONE for the whole stack, so compare the SUM of
  // the local buffers against a single shared one.
  const localTotal = rows.reduce((a, r) => a + r.vertsLocal, 0);
  const sharedVerts = shared.coords.length / 2;
  // `process.stdout` rather than `console`, which the runner intercepts.
  process.stdout.write(
    `HOIST ${JSON.stringify({
      ...label,
      columnLayers: count,
      referenceNodes: reference.header.nx * reference.header.ny,
      referenceStep: reference.step,
      candidatesHeights: heights.reduce((a, c) => a + c.length, 0),
      candidatesCoverage: coverage.reduce((a, c) => a + c.length, 0),
      candidatesThickness: thickness.reduce((a, c) => a + c.length, 0),
      vertsAllChunksToday: localTotal,
      vertsOneSharedBuffer: sharedVerts,
      totalFactor: +(sharedVerts / localTotal).toFixed(2),
      trisAllChunksToday: rows.reduce((a, r) => a + r.trisLocal, 0),
      trisSharedBuffer: shared.indices.length / 3,
      msAllChunksToday: +rows.reduce((a, r) => a + r.msLocal, 0).toFixed(1),
      msSharedBuffer: +msShared.toFixed(1),
      rows,
    })}\n`,
  );
};

describe.skipIf(!process.env.PROFILE_HOIST)('stack hoisting cost', () => {
  it(
    'compares a chunk-local tessellation against a column-wide one',
    { timeout: 30 * 60 * 1000 },
    () => {
      for (const correlated of [true, false]) {
        for (const units of [4, 8, 16]) {
          const layers = buildColumn(units, correlated);
          const reference = buildStackReference(layers, square(6))!;
          measure(
            { source: correlated ? 'correlated' : 'independent' },
            reference,
          );
        }
      }
    },
  );
});

// --- Real surfaces ---------------------------------------------------------

const DATA = resolvePath(__dirname, '../../public/data');

type RealMeta = {
  id: string;
  name: string;
  min: number;
  max: number;
  header: {
    nx: number;
    ny: number;
    xinc: number;
    yinc: number;
    rot: number;
    xori: number;
    yori: number;
  };
};

/**
 * The demo field, as `StackGridLayer`s.
 *
 * ⚠️ UTM is mapped to the scene by a plain offset about the field centre rather
 * than through `UtmArea`'s CRS. Only the RELATIVE placement of the grids matters
 * here — a different projection would move the whole stack, not change how the
 * layers overlap — and this keeps the measurement free of the component tree.
 */
const loadRealLayers = (wanted: number) => {
  const raw = JSON.parse(
    readFileSync(resolvePath(DATA, 'surface-meta.json'), 'utf8'),
  );
  const metas = (Array.isArray(raw) ? raw : Object.values(raw)) as RealMeta[];
  // Spread across the depth range so both grid families (§13) are represented.
  const sorted = [...metas].sort((a, b) => a.max - b.max);
  const step = Math.max(1, Math.floor(sorted.length / wanted));
  const picked = sorted.filter((_, i) => i % step === 0).slice(0, wanted);

  const cx = picked.reduce((a, m) => a + m.header.xori, 0) / picked.length;
  const cy = picked.reduce((a, m) => a + m.header.yori, 0) / picked.length;

  return picked.map<StackGridLayer & { name: string }>(m => ({
    name: m.name,
    values: Float32Array.from(
      JSON.parse(
        readFileSync(resolvePath(DATA, 'surfaces', `${m.id}.json`), 'utf8'),
      ),
    ),
    header: m.header,
    referenceDepth: m.max,
    worldPosition: [m.header.xori - cx, -(m.header.yori - cy)],
    nullValue: -1,
  }));
};

describe.skipIf(!process.env.PROFILE_HOIST_REAL)(
  'stack hoisting cost (real surfaces)',
  () => {
    it(
      'compares a chunk-local tessellation against a column-wide one',
      { timeout: 30 * 60 * 1000 },
      () => {
        const wanted = Number(process.env.PROFILE_HOIST_SURFACES ?? 9);
        const layers = loadRealLayers(wanted);
        // ⚠️ `worldPosition` places a grid's ORIGIN, which is a corner — centring
        // the envelope on it puts the crop off the edge of the field, where the
        // deepest tier finds almost no data and the comparison is meaningless.
        const centres = layers.map(l => {
          const toWorld = surfaceGridToWorld(l.header, l.worldPosition!);
          return toWorld((l.header.nx - 1) / 2, (l.header.ny - 1) / 2);
        });
        const centre: [number, number] = [
          centres.reduce((a, c) => a + c[0], 0) / centres.length,
          centres.reduce((a, c) => a + c[1], 0) / centres.length,
        ];
        const reference = buildStackReference(layers, square(6, centre))!;

        // ⚠️ Ordered by MEDIAN DEPTH inside the footprint, not by age: only the
        // thickness crossings are order-sensitive, and §14.5 records that on this
        // dataset the median-depth order agreed exactly with the age order. Using
        // `strat-ages.ts` would drag the storybook tree into a node test.
        const median = (c: Float32Array, mask: Uint8Array) => {
          const vals: number[] = [];
          for (let n = 0; n < c.length; n += 7) if (mask[n]) vals.push(c[n]);
          vals.sort((a, b) => a - b);
          return vals.length ? vals[vals.length >> 1] : -Infinity;
        };
        const order = reference.channels
          .map((c, i) => ({ i, y: median(c, reference.masks[i]) }))
          .sort((a, b) => b.y - a.y)
          .map(o => o.i);

        measure(
          {
            source: 'real',
            surfaces: order.map(i => layers[i].name).join(' > '),
          },
          {
            ...reference,
            channels: order.map(i => reference.channels[i]),
            masks: order.map(i => reference.masks[i]),
          },
          centre,
        );
      },
    );
  },
);
