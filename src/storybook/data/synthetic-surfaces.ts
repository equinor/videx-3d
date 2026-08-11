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
  ColumnSpec,
  ColumnStep,
  CRS,
  ErosionEncoding,
  generateColumn,
  generateSurfaceValues,
  getProjectionDefFromUtmZone,
  SedimentClass,
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
function placeCentred(nx: number, ny: number, rot: number, cell = CELL) {
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // `surfaceGridToWorld` centres rows on the LAST one, so the grid centre in local
  // coordinates is (+x/2, -z/2) before rotation.
  const lx = ((nx - 1) * cell) / 2;
  const lz = -((ny - 1) * cell) / 2;
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

/**
 * Generated stratigraphic COLUMNS — a set of related surfaces, as opposed to the
 * independent scenarios above.
 *
 * The demo field can show a column, but not one whose relationships are KNOWN: a
 * crossing there might be the data. Here every surface is an exact function of the
 * one below it, so anything the pipeline reports is the pipeline.
 */
type ColumnScenario = {
  name: string;
  nx: number;
  ny: number;
  /** grid resolution in metres. Defaults to the demo surveys' 25. */
  cell?: number;
  rot?: number;
  spec: Omit<ColumnSpec, 'grid'>;
};

/**
 * ⭐⭐ THE KNOBS. Edit and reload — the column is rebuilt from these, so a
 * different structure, a longer column or a coarser grid is a one-line change
 * rather than a rewritten spec.
 *
 * ⚠️ Generation is eager (the meta loader needs the realized depth range of every
 * surface at store init), and costs roughly `NODES² × surfaces`: ~235 ms at
 * 400 × 400 with 10 surfaces, ~135 ms at 300 × 300. It is paid once per page load,
 * by every story, so keep it modest.
 */
const COLUMN = {
  /** grid nodes per side */
  nodes: 400,
  /** grid resolution in metres — extent is `nodes × cell` (400 × 25 m = 10 km) */
  cell: CELL,
  /** grid rotation in degrees; the demo surveys use 220 */
  rot: ROT,
  /** depositional units above the basement */
  units: 8,
  /** depth of the basement and of the shallowest surface, metres positive-down */
  baseDepth: 2600,
  topDepth: 700,
  /** relief on the basement — the structure everything else is deposited over */
  structure: 320,
  /**
   * Re-rolls every relief in the column, so the same architecture (same units,
   * same fault, same unconformity) comes out with a different structure.
   */
  seed: 1,
  /** how a horizon removed by erosion is RECORDED. See `ErosionEncoding`. */
  erosion: 'mask' as ErosionEncoding,
  /** the fault moves after this many units. 0 = no fault. */
  faultAfter: 3,
  faultThrow: 240,
  /** width the throw is gridded into — narrow is steeper, and harder to mesh */
  faultRamp: 300,
  /** erosion cuts after this many units. 0 = none. */
  erodeAfter: 5,
  /**
   * How steeply the unconformity is tilted, m/m. ⚠️ It has to be steep enough to
   * cut ACROSS the horizons: a near-flat one at the wrong depth removes whole
   * horizons instead of truncating them, leaving surfaces with no data anywhere.
   */
  erosionDip: 0.05,
  /** this unit is mapped over less ground than the rest. -1 = none. */
  partialUnit: 4,
  partialRadius: [3.6 * KM, 3 * KM] as Vec2,
};

/** Names and sediment classes are taken from here in order, deepest first. */
const UNITS: { name: string; class: SedimentClass }[] = [
  { name: 'Rotliegend', class: 'sand' },
  { name: 'Zechstein', class: 'salt' },
  { name: 'Triassic', class: 'shale' },
  { name: 'Jurassic', class: 'sand' },
  { name: 'Draupne', class: 'shale' },
  { name: 'Cromer Knoll', class: 'carbonate' },
  { name: 'Shetland', class: 'carbonate' },
  { name: 'Rogaland', class: 'silt' },
  { name: 'Hordaland', class: 'shale' },
  { name: 'Nordland', class: 'silt' },
];

/**
 * Build the column from {@link COLUMN}.
 *
 * Units alternate in character — some flood the lows and pinch out over the highs,
 * some drape and carry the structure upward — so a column of any length contains
 * both terminations and preserved relief.
 */
function fieldColumn(): Omit<ColumnSpec, 'grid'> {
  const span = COLUMN.baseDepth - COLUMN.topDepth;
  const per = span / Math.max(1, COLUMN.units);
  const steps: ColumnStep[] = [];

  let datum = COLUMN.baseDepth;
  for (let i = 0; i < COLUMN.units; i++) {
    datum -= per;
    const unit = UNITS[i % UNITS.length];
    // 0.9 floods (and pinches out), 0.15 mostly drapes (and carries structure)
    const fill = [0.9, 0.5, 0.15][i % 3];
    steps.push({
      name: COLUMN.units > UNITS.length ? `${unit.name} ${i}` : unit.name,
      class: unit.class,
      drape: per * (1 - fill) * 0.8,
      fill,
      datum,
      relief:
        i % 3 === 2
          ? [{ amplitude: per * 0.25, seed: 11 + i, featureSize: 3 * KM }]
          : undefined,
      boundary:
        i === COLUMN.partialUnit
          ? { kind: 'ellipse', center: [0, 0], radius: COLUMN.partialRadius }
          : undefined,
    });

    if (COLUMN.faultAfter > 0 && i + 1 === COLUMN.faultAfter) {
      steps.push({
        kind: 'fault',
        at: [0, 0],
        azimuth: 30,
        throw: COLUMN.faultThrow,
        ramp: COLUMN.faultRamp,
        halfLength: (COLUMN.nodes * COLUMN.cell) / 2.5,
      });
    }

    if (COLUMN.erodeAfter > 0 && i + 1 === COLUMN.erodeAfter) {
      steps.push({
        kind: 'erosion',
        name: 'Unconformity',
        class: 'shale',
        // Tilted through the level reached so far, so it cuts DOWN across the
        // units on one side and lies above them on the other — an angular
        // unconformity, with each affected horizon partly truncated.
        surface: {
          base: datum,
          dip: { azimuth: 300, gradient: COLUMN.erosionDip },
        },
      });
    }
  }

  return {
    basement: {
      name: 'Basement',
      class: 'basement',
      base: COLUMN.baseDepth,
      dip: { azimuth: 120, gradient: 0.02 },
      relief: [
        {
          kind: 'ridges',
          amplitude: COLUMN.structure,
          seed: 7,
          featureSize: 6 * KM,
        },
      ],
    },
    steps,
    seed: COLUMN.seed,
    erosionEncoding: COLUMN.erosion,
  };
}

const COLUMNS: Record<string, ColumnScenario> = {
  // A field-scale section: deposition over a rough basement, a fault part-way
  // through, a partly-mapped unit, and an angular unconformity.
  field: {
    name: 'Synthetic Field',
    nx: COLUMN.nodes,
    ny: COLUMN.nodes,
    cell: COLUMN.cell,
    rot: COLUMN.rot,
    spec: fieldColumn(),
  },
};

/** Ids of a generated column's surfaces are `synthetic:col:<key>:<index>`. */
export const SYNTHETIC_COLUMN_PREFIX = `${SYNTHETIC_PREFIX}col:`;

/** One surface of a generated column, as a story needs to see it. */
export type SyntheticColumnUnit = {
  id: string;
  name: string;
  class?: SedimentClass;
};

const cache = new Map<string, SyntheticSurface>();
const columnCache = new Map<string, SyntheticColumnUnit[]>();

const columnSurfaceId = (key: string, index: number) =>
  `${SYNTHETIC_COLUMN_PREFIX}${key}:${index}`;

/**
 * Generate (once) a whole column, caching each of its surfaces under its own id
 * so the loaders serve them exactly like any other surface.
 *
 * @returns its units SHALLOWEST FIRST — the order a chunk's layer array takes
 */
export function getSyntheticColumn(key: string): SyntheticColumnUnit[] {
  const cached = columnCache.get(key);
  if (cached) return cached;

  const scenario = COLUMNS[key];
  if (!scenario) return [];

  const { nx, ny } = scenario;
  const rot = scenario.rot ?? ROT;
  const cell = scenario.cell ?? CELL;
  const { worldPosition, xori, yori } = placeCentred(nx, ny, rot, cell);
  const header = { nx, ny, xinc: cell, yinc: cell, rot };

  const surfaces = generateColumn({
    ...scenario.spec,
    grid: { header, worldPosition },
  });

  const units = surfaces.map((surface, index) => {
    const id = columnSurfaceId(key, index);
    const meta: SurfaceMeta = {
      id,
      name: surface.name,
      projection: storyArgs.utmZone,
      min: surface.min,
      max: surface.max,
      displayMin: surface.min,
      displayMax: surface.max,
      color: 'black',
      visualization: 'depth',
      header: {
        nx: surface.header.nx,
        ny: surface.header.ny,
        xinc: surface.header.xinc,
        yinc: surface.header.yinc,
        rot: surface.header.rot,
        xori,
        yori,
        xmax: xori + surface.header.nx * surface.header.xinc,
        ymax: yori + surface.header.ny * surface.header.yinc,
      },
    };
    cache.set(id, { meta, values: surface.values });
    return { id, name: surface.name, class: surface.class };
  });

  columnCache.set(key, units);
  return units;
}

/** Every generated column key, in declaration order. */
export const syntheticColumnKeys = Object.keys(COLUMNS);

/** Every generated surface id, in declaration order. */
export const syntheticSurfaceIds = [
  ...Object.keys(SCENARIOS).map(key => SYNTHETIC_PREFIX + key),
  ...syntheticColumnKeys.flatMap(key => getSyntheticColumn(key).map(u => u.id)),
];

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

  // A column surface is only ever produced with its siblings.
  if (id.startsWith(SYNTHETIC_COLUMN_PREFIX)) {
    const key = id.slice(SYNTHETIC_COLUMN_PREFIX.length).split(':')[0];
    getSyntheticColumn(key);
    return cache.get(id) ?? null;
  }

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
