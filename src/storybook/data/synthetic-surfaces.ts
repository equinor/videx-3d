/**
 * Generated surfaces for the storybook data store.
 *
 * The library half of this lives in the sdk (`surface-field.ts`); everything here
 * is the storybook-specific wrapping: choosing grids, giving each scenario a
 * `SurfaceMeta`, and serving them through the mock store as if they had been
 * parsed from a file.
 *
 * ⭐ These go in as ordinary `surface-meta` + `surface-values` entries, so the
 * chunk pipeline cannot tell them apart from real data — which is the point. A
 * generated surface that took a shortcut past the null sentinel or the coverage
 * mask would validate a path no real survey takes.
 *
 * The demo field cannot show us controlled hole sizes, a controlled extent
 * mismatch, or a second rotation, and calibrating against one survey over-fits to
 * it (see `documents/chunks.md` §13, §14).
 */

import {
  CRS,
  generateSurfaceValues,
  getProjectionDefFromUtmZone,
  SurfaceFieldSpec,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import storyArgs from '../story-args.json';

const crs = new CRS(
  getProjectionDefFromUtmZone(storyArgs.utmZone),
  storyArgs.origin as Vec2,
  'utm',
);

/** Ids are prefixed so the loaders can route them without a lookup. */
export const SYNTHETIC_PREFIX = 'synthetic:';

/** Matches the demo surveys, so generated and real surfaces are comparable. */
const CELL = 25;
const ROT = 220;

type Scenario = {
  name: string;
  /** grid nodes; 400 x 400 at 25 m is 10 x 10 km */
  nx: number;
  ny: number;
  /** grid rotation in degrees. Defaults to the demo surveys' 220. */
  rot?: number;
  spec: SurfaceFieldSpec;
};

/**
 * Place a grid so its CENTRE sits on the scene origin, and report both the scene
 * position the generator needs and the UTM origin the meta needs — derived from
 * each other rather than chosen twice.
 */
function placeCentred(nx: number, ny: number, rot: number) {
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // `surfaceGridToWorld` centres rows on the LAST one, so the grid centre in local
  // coordinates is (+x/2, -z/2) before rotation.
  const lx = ((nx - 1) * CELL) / 2;
  const lz = -((ny - 1) * CELL) / 2;
  const dx = lx * cos + lz * sin;
  const dz = -lx * sin + lz * cos;
  const worldPosition: Vec2 = [-dx, -dz];
  const utm = crs.worldToUtm(worldPosition[0], 0, worldPosition[1]);
  return { worldPosition, xori: utm.easting, yori: utm.northing };
}

const KM = 1000;

/**
 * The scenarios. Deliberately few: each exists to make one thing measurable that
 * the demo field cannot show.
 */
const SCENARIOS: Record<string, Scenario> = {
  // Control: mapped everywhere, gently dipping with mild relief.
  flat: {
    name: 'Synthetic Flat',
    nx: 400,
    ny: 400,
    spec: {
      base: 800,
      dip: { azimuth: 120, gradient: 0.01 },
      relief: [{ amplitude: 60, featureSize: 6000, seed: 1 }],
    },
  },

  // The real-world case (§13): the grid is a rectangle, the surface is not.
  inset: {
    name: 'Synthetic Inset',
    nx: 400,
    ny: 400,
    spec: {
      base: 900,
      dip: { azimuth: 120, gradient: 0.01 },
      relief: [{ amplitude: 80, featureSize: 6000, seed: 2 }],
      boundary: {
        kind: 'polygon',
        points: [
          [-4 * KM, -3.5 * KM],
          [3.5 * KM, -4 * KM],
          [4 * KM, 2 * KM],
          [0.5 * KM, 4 * KM],
          [-3.5 * KM, 2.5 * KM],
        ],
      },
    },
  },

  // Holes spanning the range that matters: 0.03 / 0.8 / 7 km^2, so a single fill
  // threshold has to accept the small one and refuse the large one.
  holes: {
    name: 'Synthetic Holes',
    nx: 400,
    ny: 400,
    spec: {
      base: 1000,
      dip: { azimuth: 120, gradient: 0.01 },
      relief: [{ amplitude: 70, featureSize: 6000, seed: 3 }],
      holes: [
        { kind: 'ellipse', center: [-2 * KM, -2 * KM], radius: 100 },
        { kind: 'ellipse', center: [0, 0], radius: 500 },
        { kind: 'ellipse', center: [2.2 * KM, 1.8 * KM], radius: 1500 },
      ],
    },
  },

  // A pair that agree in shape but disagree about where they exist: `mismatchB`
  // stops short of `mismatchA` by ~1.5 km on one side. Sweeping the boundary is
  // how `D` (§10.1.2) gets exercised.
  mismatchA: {
    name: 'Synthetic Mismatch A',
    nx: 400,
    ny: 400,
    spec: {
      base: 1200,
      dip: { azimuth: 120, gradient: 0.012 },
      relief: [{ amplitude: 90, featureSize: 5000, seed: 4 }],
      boundary: {
        kind: 'rect',
        min: [-4 * KM, -4 * KM],
        max: [4 * KM, 4 * KM],
      },
    },
  },
  mismatchB: {
    name: 'Synthetic Mismatch B',
    nx: 400,
    ny: 400,
    spec: {
      base: 1400,
      dip: { azimuth: 120, gradient: 0.012 },
      relief: [{ amplitude: 90, featureSize: 5000, seed: 5 }],
      boundary: {
        kind: 'rect',
        min: [-4 * KM, -4 * KM],
        max: [2.5 * KM, 4 * KM],
      },
    },
  },
};

export type SyntheticSurface = {
  meta: SurfaceMeta;
  values: Float32Array;
};

const cache = new Map<string, SyntheticSurface>();

/** Every generated surface id, in declaration order. */
export const syntheticSurfaceIds = Object.keys(SCENARIOS).map(
  key => SYNTHETIC_PREFIX + key,
);

/** Whether an id belongs to a generated surface. */
export function isSyntheticSurfaceId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(SYNTHETIC_PREFIX);
}

/**
 * Generate (once) and return a scenario. Memoized so the meta and the values are
 * guaranteed to describe the same realization — `min`/`max` are outputs of
 * generation, not inputs, so generating twice would risk two different answers.
 *
 * A 400 x 400 grid is ~160k evaluations, a few milliseconds, so there is no build
 * step and no generated files to keep in sync with the specs.
 */
export function getSyntheticSurface(id: string): SyntheticSurface | null {
  const cached = cache.get(id);
  if (cached) return cached;

  const key = id.slice(SYNTHETIC_PREFIX.length);
  const scenario = SCENARIOS[key];
  if (!scenario) return null;

  const { nx, ny } = scenario;
  const rot = scenario.rot ?? ROT;
  const { worldPosition, xori, yori } = placeCentred(nx, ny, rot);
  const header = { nx, ny, xinc: CELL, yinc: CELL, rot };

  const generated = generateSurfaceValues(scenario.spec, header, worldPosition);

  const meta: SurfaceMeta = {
    id,
    name: scenario.name,
    projection: storyArgs.utmZone,
    min: generated.min,
    max: generated.max,
    displayMin: generated.min,
    displayMax: generated.max,
    color: 'black',
    visualization: 'depth',
    header: {
      nx,
      ny,
      xinc: CELL,
      yinc: CELL,
      rot,
      xori,
      yori,
      xmax: xori + nx * CELL,
      ymax: yori + ny * CELL,
    },
  };

  const surface = { meta, values: generated.values };
  cache.set(id, surface);
  return surface;
}
