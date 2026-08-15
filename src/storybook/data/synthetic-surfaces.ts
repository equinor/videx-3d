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
  ReliefSpec,
  reliefDepth,
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
  /** grid resolution in metres. Defaults to the demo surveys' 25. */
  cell?: number;
  /** grid rotation in degrees. Defaults to the demo surveys' 220. */
  rot?: number;
  /** scene XZ the grid is centred on. Defaults to the origin. */
  centre?: Vec2;
  spec: SurfaceFieldSpec;
  /**
   * Map this surface only inside a structural CLOSURE — where the named unit's
   * top is shallower than this surface, which is where a fluid could accumulate.
   *
   * ⚠️ `margin` metres past the crossing, because the crossing IS the
   * accumulation outline: the contact shader rejects a sample whose neighbouring
   * texels are unmapped, so an outline sitting exactly on the data edge would be
   * clipped away.
   *
   * ⚠️ Assumes the same grid as the column, which is true by construction here
   * (both are `COLUMN.nodes` at `CELL`/`ROT`) and checked before it is used.
   */
  closure?: { column: string; unit: string; margin: number };
};

/**
 * Place a grid so its CENTRE sits on `centre` (scene XZ, default the origin), and
 * report both the scene position the generator needs and the UTM origin the meta
 * needs — derived from each other rather than chosen twice.
 */
function placeCentred(
  nx: number,
  ny: number,
  rot: number,
  cell = CELL,
  centre: Vec2 = [0, 0],
) {
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // `surfaceGridToWorld` centres rows on the LAST one, so the grid centre in local
  // coordinates is (+x/2, -z/2) before rotation.
  const lx = ((nx - 1) * cell) / 2;
  const lz = -((ny - 1) * cell) / 2;
  const dx = lx * cos + lz * sin;
  const dz = -lx * sin + lz * cos;
  const worldPosition: Vec2 = [centre[0] - dx, centre[1] - dz];
  const utm = crs.worldToUtm(worldPosition[0], 0, worldPosition[1]);
  return { worldPosition, xori: utm.easting, yori: utm.northing };
}

const KM = 1000;

/**
 * The demo field's sea bed depth, as its wellbores measured it (generated into
 * `story-args.json`). The fallback is only for a dataset whose headers carry no
 * water depth at all.
 */
const FIELD_WATER_DEPTH = storyArgs.waterDepth ?? 100;

/**
 * The grid for a stand-in sea bed: the SURVEYS' own extent plus a margin, not a
 * square on the scene origin.
 *
 * ⚠️ A field's surveys need not straddle its origin — the demo field's run from
 * 3.5 km west to 9.8 km east of it and 11.6 km south to 6.6 km north — so a grid
 * centred on the origin misses most of them, and every chunk cut against it comes
 * out truncated to wherever the two happened to overlap.
 */
const CAP_GRID = (() => {
  const cell = 50;
  const margin = 2 * KM;
  const extent = storyArgs.fieldExtent as
    | [number, number, number, number]
    | null;
  if (!extent) return { nx: 400, ny: 400, cell, centre: [0, 0] as Vec2 };
  const [minE, minN, maxE, maxN] = extent;
  const middle = crs.utmToWorld((minE + maxE) / 2, (minN + maxN) / 2, 0);
  return {
    nx: Math.ceil((maxE - minE + 2 * margin) / cell) + 1,
    ny: Math.ceil((maxN - minN + 2 * margin) / cell) + 1,
    cell,
    centre: [middle.x, middle.z] as Vec2,
  };
})();

/**
 * ⭐ THE SEA BED, as landforms rather than noise.
 *
 * Deposition flattens a column upward, so the shallowest surface would otherwise
 * be nearly level — and a noise field over it reads as static, not as terrain.
 * These are shaped primitives instead (see `ReliefSpec`): a coast that rises out
 * of a basin, an island standing off it, and a hill on the island. Noise is left
 * as TEXTURE over the top, which is all it is good for.
 *
 * Depths are metres below sea level; heights are metres above it.
 */
const SEABED = {
  /** deepest point of the basin */
  basin: 200,
  /** how far above sea level the coast climbs at the far end of its run */
  coastHeight: 45,
  /**
   * Shallowest water over an OFFSHORE bed. ⭐ A bed away from any coast does not
   * approach the surface — it shoals to a shelf depth and stops — so this is a
   * depth in its own right, not the coast's climb turned negative.
   */
  offshoreMin: 90,
  /** compass direction the land rises toward, and over what distance */
  coastAzimuth: 300,
  coastRun: 9 * KM,
  /** the island: a broad, nearly flat platform standing off the coast */
  island: {
    center: [1400, -900] as Vec2,
    radius: 1700,
    /** narrow rim = a platform with a shore, rather than a dome */
    falloff: 800,
    /** how far its top clears sea level */
    freeboard: 15,
  },
  /** a hill on the island, off to one side of it */
  hill: {
    center: [1850, -1350] as Vec2,
    radius: 550,
    falloff: 520,
    /** above the island's own platform */
    height: 95,
  },
  /** dune-scale roughness over the whole sea bed. 0 = bare landforms */
  texture: 16,
} as const;

/**
 * How a generated sea bed's shallow end is finished.
 *
 * - `shoreline` — the coast climbs out of the water, with an island standing off
 *   it and a hill on the island;
 * - `offshore` — no land at all, and the bed shoals only to `SEABED.offshoreMin`
 *   metres of water, as one away from any coast does.
 */
export type SeabedStyle = 'shoreline' | 'offshore';

/** Where the bed's shallow end sits relative to sea level: + above, − below. */
const shallowEnd = (style: SeabedStyle) =>
  style === 'shoreline' ? SEABED.coastHeight : -SEABED.offshoreMin;

/**
 * Mean depth of a generated sea bed — the MIDPOINT of the basin and the shallow
 * end, rather than a number of its own.
 */
const seabedDatum = (style: SeabedStyle) =>
  (SEABED.basin - shallowEnd(style)) / 2;

/**
 * Build the sea bed's relief. ⭐ The island's height is DERIVED — sampled from the
 * coast at the island's own position — so it keeps its stated freeboard if the
 * coast is retuned, instead of being a number that silently stops meaning what it
 * says.
 */
function seabedRelief(
  meanDepth: number,
  style: SeabedStyle = 'shoreline',
): ReliefSpec[] {
  const slope: ReliefSpec = {
    kind: 'ramp',
    amplitude: SEABED.basin + shallowEnd(style),
    azimuth: SEABED.coastAzimuth,
    run: SEABED.coastRun,
  };
  const texture: ReliefSpec[] =
    SEABED.texture > 0
      ? [{ amplitude: SEABED.texture, seed: 23, featureSize: 2.5 * KM }]
      : [];

  // Offshore is the slope alone: no island and no hill, because there is no coast
  // for them to stand off.
  if (style === 'offshore') return [slope, ...texture];

  const [ix, iz] = SEABED.island.center;
  const seabedAt = meanDepth + reliefDepth(slope, ix, iz) + SEABED.texture / 2;
  return [
    slope,
    {
      kind: 'dome',
      mode: 'above',
      amplitude: seabedAt + SEABED.island.freeboard,
      center: SEABED.island.center,
      radius: SEABED.island.radius,
      falloff: SEABED.island.falloff,
    },
    {
      kind: 'dome',
      mode: 'above',
      amplitude: SEABED.hill.height,
      center: SEABED.hill.center,
      radius: SEABED.hill.radius,
      falloff: SEABED.hill.falloff,
    },
    ...texture,
  ];
}

/**
 * The scenarios. Deliberately few: each exists to make one thing measurable that
 * the demo field cannot show.
 */
const SCENARIOS: Record<string, Scenario> = {
  // ⭐ A stand-in SEA BED for a dataset that maps none — most do not, since a sea
  // bed is bathymetry rather than stratigraphy. Its depth is the FIELD's own, as
  // the wellbores measured it, and its grid covers the FIELD's own surveys (see
  // {@link CAP_GRID}), so it lands where the sea bed actually is. The relief is
  // plain bathymetry, wholly submerged, and deliberately not the landforms the
  // generated column uses.
  'cap-seabed': {
    name: 'Generated Sea Bed',
    nx: CAP_GRID.nx,
    ny: CAP_GRID.ny,
    cell: CAP_GRID.cell,
    centre: CAP_GRID.centre,
    // Axis-aligned: a rotation buys a synthetic bathymetry nothing, and squares it
    // with the box the extent was measured as.
    rot: 0,
    spec: {
      base: FIELD_WATER_DEPTH,
      relief: [
        { amplitude: 18, seed: 31, featureSize: 6 * KM },
        { amplitude: 6, seed: 32, featureSize: 1.5 * KM },
      ],
    },
  },

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

  // ⭐ Fluid contacts. Near-flat by nature — a level, with only the slight
  // variation a density difference produces. The GAS CAP is mapped only inside
  // the structural closure it could collect in; the OWC spans the whole
  // accumulation, as a real one does.
  'contact-goc': {
    name: 'Synthetic GOC',
    nx: 400,
    ny: 400,
    spec: {
      base: 2200,
      relief: [{ amplitude: 6, featureSize: 5000, seed: 11 }],
    },
    closure: { column: 'shoreline', unit: 'Rotliegend', margin: 40 },
  },
  'contact-owc': {
    name: 'Synthetic OWC',
    nx: 400,
    ny: 400,
    spec: {
      base: 2600,
      relief: [{ amplitude: 4, featureSize: 5000, seed: 12 }],
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
  /** depth of the basement, metres positive-down */
  baseDepth: 2600,
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
 *
 * @param style how the sea bed's shallow end is finished. See {@link SeabedStyle}.
 */
function fieldColumn(
  style: SeabedStyle = 'shoreline',
): Omit<ColumnSpec, 'grid'> {
  const topDepth = seabedDatum(style);
  const span = COLUMN.baseDepth - topDepth;
  const per = span / Math.max(1, COLUMN.units);
  const steps: ColumnStep[] = [];

  let datum = COLUMN.baseDepth;
  for (let i = 0; i < COLUMN.units; i++) {
    datum -= per;
    const unit = UNITS[i % UNITS.length];
    // 0.9 floods (and pinches out), 0.15 mostly drapes (and carries structure)
    const fill = [0.9, 0.5, 0.15][i % 3];
    const seabed = i === COLUMN.units - 1;
    steps.push({
      name: COLUMN.units > UNITS.length ? `${unit.name} ${i}` : unit.name,
      class: unit.class,
      // ⭐ The sea bed levels COMPLETELY onto its datum (no drape, full fill), so
      // its mean depth is exactly `topDepth` and the landforms below can be
      // measured from it. Anything less and the unit lands wherever the drape and
      // the surface underneath happen to put it, and every stated height — the
      // island's freeboard, the coast's 45 m — is quietly wrong by that much.
      drape: seabed ? 0 : per * (1 - fill) * 0.8,
      fill: seabed ? 1 : fill,
      datum,
      relief: seabed
        ? seabedRelief(datum, style)
        : i % 3 === 2
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
  // through, a partly-mapped unit, and an angular unconformity — under a sea bed
  // that climbs out of the water into a coast, an island and a hill.
  shoreline: {
    name: 'Synthetic Shoreline',
    nx: COLUMN.nodes,
    ny: COLUMN.nodes,
    cell: COLUMN.cell,
    rot: COLUMN.rot,
    spec: fieldColumn('shoreline'),
  },

  // The same section under an OFFSHORE sea bed: no land anywhere, and the bed
  // shoals only to shelf depth rather than reaching for the surface.
  offshore: {
    name: 'Synthetic Offshore',
    nx: COLUMN.nodes,
    ny: COLUMN.nodes,
    cell: COLUMN.cell,
    rot: COLUMN.rot,
    spec: fieldColumn('offshore'),
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

/** The stand-in sea bed, for a dataset whose own surfaces start below one. */
export const SYNTHETIC_SEABED_ID = `${SYNTHETIC_PREFIX}cap-seabed`;

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
 * Cut a contact back to the structural closure of the unit it sits in — a
 * hydrocarbon accumulates only where the reservoir top rises ABOVE the contact.
 *
 * ⭐ Derived rather than drawn: the pocket follows the column's own structure, so
 * it stays correct if the seed or the fault changes, and it needs no polygon.
 *
 * ⚠️ `min`/`max` describe the MAPPED field, so masking has to rebase the values:
 * they are stored as `max - depth`, so a `max` left over from the unmasked field
 * would decode every sample against a reference depth no longer present.
 */
function applyClosure(
  generated: {
    values: Float32Array;
    min: number;
    max: number;
    nullValue: number;
  },
  closure: { column: string; unit: string; margin: number },
) {
  const units = getSyntheticColumn(closure.column);
  const top = units.find(u => u.name === closure.unit);
  const reservoir = top ? cache.get(top.id) : null;
  if (!reservoir || reservoir.values.length !== generated.values.length) return;

  const { values, max, nullValue } = generated;
  const topMax = reservoir.meta.max;
  let min = Infinity;
  let deepest = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === nullValue) continue;
    const depth = max - values[i];
    const tv = reservoir.values[i];
    // Unmapped reservoir means no trap to speak of, not a shallow one.
    const topDepth = tv === nullValue ? Infinity : topMax - tv;
    if (topDepth >= depth + closure.margin) {
      values[i] = nullValue;
      continue;
    }
    if (depth < min) min = depth;
    if (depth > deepest) deepest = depth;
  }
  if (!Number.isFinite(min)) return;

  generated.min = min;
  generated.max = deepest;
  const shift = deepest - max;
  if (shift === 0) return;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== nullValue) values[i] += shift;
  }
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
  const cell = scenario.cell ?? CELL;
  const { worldPosition, xori, yori } = placeCentred(
    nx,
    ny,
    rot,
    cell,
    scenario.centre,
  );
  const header = { nx, ny, xinc: cell, yinc: cell, rot };

  const generated = generateSurfaceValues(scenario.spec, header, worldPosition);
  if (scenario.closure) applyClosure(generated, scenario.closure);

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
      xinc: cell,
      yinc: cell,
      rot,
      xori,
      yori,
      xmax: xori + nx * cell,
      ymax: yori + ny * cell,
    },
  };

  const surface = { meta, values: generated.values };
  cache.set(id, surface);
  return surface;
}
