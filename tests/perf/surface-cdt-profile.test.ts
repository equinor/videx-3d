import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it } from 'vitest';
import { triangulateGridConstrained } from '../../src/sdk/geometries/triangulate-grid-delaunay';

/**
 * Opt-in benchmark for the constrained-Delaunay surface path used by
 * `generateSurfaceGeometry` (holes cut, no clip polygon), run against the real
 * generated dataset in `public/data`. Skipped by default — run with:
 *
 *   PROFILE_CDT=1 npx vitest run tests/perf/surface-cdt-profile.test.ts
 *
 * Restrict or extend the set with `PROFILE_CDT_SURFACES` (comma separated
 * surface names, or `*` for every surface in `surface-meta.json`).
 */

type SurfaceMeta = {
  id: string;
  name: string;
  header: { nx: number; ny: number; xinc: number; yinc: number; rot: number };
};

const DATA = resolve(__dirname, '../../public/data');

// Default set: the surfaces that were pathologically slow, plus a hole-free one.
const DEFAULT_SURFACES = [
  'Halibut Bank Fm. 2 JS Base',
  'Basement Base',
  'ZECHSTEIN GP. Top',
  'Utsira Fm. Base',
];

const loadMeta = () => {
  const raw = JSON.parse(
    readFileSync(resolve(DATA, 'surface-meta.json'), 'utf8'),
  );
  return (Array.isArray(raw) ? raw : Object.values(raw)) as SurfaceMeta[];
};

const loadValues = (id: string) =>
  Float32Array.from(
    JSON.parse(readFileSync(resolve(DATA, 'surfaces', `${id}.json`), 'utf8')),
  );

describe.skipIf(!process.env.PROFILE_CDT)('surface CDT benchmark', () => {
  it(
    'triangulates each surface with holes cut',
    { timeout: 30 * 60 * 1000 },
    () => {
      const metas = loadMeta();
      const names = (process.env.PROFILE_CDT_SURFACES ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const wanted =
        names[0] === '*'
          ? metas.map(m => m.name)
          : names.length
            ? names
            : DEFAULT_SURFACES;
      const rows: Record<string, string | number>[] = [];

      for (const name of wanted) {
        const meta = metas.find(m => m.name === name);
        if (!meta) {
          console.warn(`surface not found: ${name}`);
          continue;
        }
        const grid = loadValues(meta.id);
        let nulls = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] < 0) nulls++;

        const t0 = performance.now();
        const { indices } = triangulateGridConstrained(
          grid,
          meta.header.nx,
          meta.header.xinc,
          meta.header.yinc,
          -1,
          5,
          [],
          false,
          true,
          0,
        );
        const total = performance.now() - t0;

        rows.push({
          surface: name,
          nodes: grid.length,
          'hole %': ((nulls / grid.length) * 100).toFixed(1),
          triangles: indices.length / 3,
          ms: total.toFixed(0),
        });
      }

      console.table(rows);
    },
  );
});
