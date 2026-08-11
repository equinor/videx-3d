/**
 * Generated stratigraphic COLUMNS — a whole set of related surfaces from one
 * description, rather than the independent surfaces of {@link surface-field}.
 *
 * A column is built the way one is deposited: start from a structure, lay units on
 * top of it, and let events interrupt. Two knobs per unit cover most of what a
 * section looks like:
 *
 * ```
 * thickness(x, z) = drape + fill * max(0, dPrev - datum)
 * ```
 *
 * `drape` blankets the topography and carries the structure upward; `fill` levels
 * it toward `datum`. Where the surface below is already shallower than the datum
 * the fill term is zero, so ⭐ **the unit pinches out over a high** — a real
 * zero-thickness termination, which is what `collapseThreshold` and
 * `refineTerminations` exist for and what no single generated surface can produce.
 * Stack several units and the structure flattens upward, as a real column does.
 *
 * ⭐ Everything is ANALYTIC in `(x, z)`: a unit's depth is a function of the
 * previous unit's depth at the same point, never of its grid. So each surface can
 * be rasterized onto its OWN grid — different `nx` / `xinc` / `rot` / origin — and
 * the surfaces still relate exactly. That is the case §10.3.5 needs and a
 * grid-chained generator could not give.
 *
 * ⭐⭐ Because the relationship is exact, a crossing or a mis-ordering seen
 * downstream is unambiguously a pipeline bug and never data noise. That is the
 * main reason to generate a column at all.
 *
 * Deliberately free of any three.js import, like the rest of the grid maths.
 *
 * @module
 */

import { Vec2 } from '../types/common';
import { ReliefSpec, sampleRelief } from './procedural-relief';
import { SurfaceClipHeader, surfaceGridToWorld } from './surface-clip';
import {
  evaluateSurfaceField,
  GeneratedSurface,
  RegionSpec,
  SurfaceFieldSpec,
} from './surface-field';

const DEG = Math.PI / 180;

/**
 * What a unit is made of. Carried through so a scenario can be read, and so the
 * HOST can map it to a colour — the library never assigns one (§ "colour is
 * config": the name → unit → colour mapping is company-specific).
 *
 * @group Geometries
 */
export type SedimentClass =
  | 'sand'
  | 'silt'
  | 'shale'
  | 'carbonate'
  | 'salt'
  | 'coal'
  | 'basement';

/** The grid a generated surface is rasterized onto. */
export type ColumnGrid = {
  header: SurfaceClipHeader;
  /** the grid origin in scene XZ. Default `[0, 0]`. */
  worldPosition?: Vec2;
};

/**
 * One depositional unit. Its TOP is emitted as a surface; its base is whatever it
 * was laid on.
 *
 * @group Geometries
 */
export type ColumnUnit = {
  kind?: 'unit';
  name: string;
  class?: SedimentClass;
  /** uniform thickness laid over whatever is below, metres. Default 0. */
  drape?: number;
  /** share of the space down to `datum` that this unit fills, 0..1. Default 0. */
  fill?: number;
  /** the depth `fill` levels toward, metres positive-down. Default 0. */
  datum?: number;
  /** roughness on this unit's top, summed. Each contributes ± `amplitude / 2`. */
  relief?: ReliefSpec[];
  /**
   * Where this unit's top is MAPPED — a survey extent, not a geological one.
   * Omitted means everywhere. ⚠️ Extent is an emission property: it never changes
   * what is deposited, only what someone recorded.
   */
  boundary?: RegionSpec;
  /** no-data regions inside `boundary` */
  holes?: RegionSpec[];
  /** rasterize this surface onto its own grid instead of the column's */
  grid?: ColumnGrid;
};

/**
 * How a horizon that erosion removed is recorded.
 *
 * - `mask` — it has NO DATA above the unconformity, which is what an interpreter
 *   actually delivers. ⚠️ It is then indistinguishable from a survey edge, which
 *   is precisely the case §10.1.5 wants to tell apart, and precisely what a seal
 *   would taper back across.
 * - `clip` — it is pushed onto the unconformity: zero thickness, still present in
 *   the data, and read downstream as a geological pinch-out.
 *
 * @group Geometries
 */
export type ErosionEncoding = 'mask' | 'clip';

/**
 * Default {@link ErosionEncoding}: the realistic one, so generated data contains
 * the hard case rather than the convenient one.
 *
 * ⚠️ Provisional — chosen on the reasoning above rather than on domain review.
 * Flipping it is one word here.
 *
 * @group Geometries
 */
export const DEFAULT_EROSION_ENCODING: ErosionEncoding = 'mask';

/**
 * Erosion: everything shallower than `surface` is gone. Deposition afterwards
 * resumes on the unconformity, which is what makes the section ANGULAR.
 *
 * @group Geometries
 */
export type ColumnErosion = {
  kind: 'erosion';
  /** the unconformity. Its own `boundary` limits WHERE erosion acted. */
  surface: SurfaceFieldSpec;
  /** emit the unconformity itself as a surface under this name */
  name?: string;
  class?: SedimentClass;
  /** default {@link DEFAULT_EROSION_ENCODING} */
  encoding?: ErosionEncoding;
  grid?: ColumnGrid;
};

/**
 * A fault, as GRID DATA holds one.
 *
 * ⭐ A height field cannot carry a discontinuity, so whoever mapped these surfaces
 * carried them ACROSS the fault plane and the throw arrives as a steep flexure
 * `ramp` metres wide. `ramp` is therefore a property of the GRIDDING, not of the
 * geology: narrow it and the surface approaches vertical, which is what stresses
 * the tessellation. Juxtaposition survives — an old unit ends up beside a younger
 * one — while the structural gap does not, because it is not in the data either.
 *
 * ⚠️ Reverse and overturned geometry cannot be expressed at all: two depths at one
 * position is not a height field. That is a limit of the representation, not of
 * this generator (see §10.3 "faults are out of scope: detect and report").
 *
 * Applies to every surface deposited SO FAR. For a growth fault — one moving while
 * deposition continued — interleave several smaller ones between units: the fill
 * term then thickens each unit on the downthrown side by itself, which is what a
 * growth fault looks like.
 *
 * @group Geometries
 */
export type ColumnFault = {
  kind: 'fault';
  /** a point on the fault trace, scene XZ */
  at: Vec2;
  /** trace direction, degrees clockwise from +Z. Default 0. */
  azimuth?: number;
  /** vertical throw in metres; positive lifts the side the trace normal points to */
  throw: number;
  /** width of the flexure the throw is gridded into, metres. Default 250. */
  ramp?: number;
  /** half-length along strike; beyond it the throw has died out. Default: infinite. */
  halfLength?: number;
};

/** One entry of a {@link ColumnSpec}. */
export type ColumnStep = ColumnUnit | ColumnErosion | ColumnFault;

/**
 * A stratigraphic column: a structure, and what happened to it since.
 *
 * @group Geometries
 */
export type ColumnSpec = {
  /** the deepest surface, on which everything is built */
  basement: SurfaceFieldSpec & { name?: string; class?: SedimentClass };
  /** ⚠️ OLDEST FIRST — the order things happened in */
  steps: ColumnStep[];
  /** the grid surfaces are rasterized onto unless they name their own */
  grid: ColumnGrid;
  /**
   * Shifts every relief seed in the column, so one spec gives DIFFERENT
   * realizations of the same architecture — same units, same fault, same
   * unconformity, different structure. Changing a single relief's own seed would
   * only re-roll that one surface.
   */
  seed?: number;
  /**
   * Encoding for erosion steps that do not name one. Default
   * {@link DEFAULT_EROSION_ENCODING}.
   */
  erosionEncoding?: ErosionEncoding;
};

/** One generated surface of a column. */
export type ColumnSurface = GeneratedSurface & {
  name: string;
  class?: SedimentClass;
  header: SurfaceClipHeader;
  worldPosition: Vec2;
};

const DEFAULT_RAMP = 250;

/** What a step contributes to the output, in emission (oldest-first) order. */
type Emitted = {
  name: string;
  class?: SedimentClass;
  grid: ColumnGrid;
  boundary?: RegionSpec;
  holes?: RegionSpec[];
};

/**
 * The surfaces a spec produces, SHALLOWEST FIRST — the order the library's
 * layer arrays take.
 *
 * @group Geometries
 */
export function columnSurfaces(spec: ColumnSpec): Emitted[] {
  return plan(spec).slice().reverse();
}

function plan(spec: ColumnSpec): Emitted[] {
  const out: Emitted[] = [
    {
      name: spec.basement.name ?? 'Basement',
      class: spec.basement.class ?? 'basement',
      grid: spec.grid,
      boundary: spec.basement.boundary,
      holes: spec.basement.holes,
    },
  ];
  for (const step of spec.steps) {
    if (step.kind === 'fault') continue;
    if (step.kind === 'erosion') {
      if (step.name) {
        out.push({
          name: step.name,
          class: step.class,
          grid: step.grid ?? spec.grid,
        });
      }
      continue;
    }
    out.push({
      name: step.name,
      class: step.class,
      grid: step.grid ?? spec.grid,
      boundary: step.boundary,
      holes: step.holes,
    });
  }
  return out;
}

/** Vertical displacement a fault applies at a world position. */
function faultOffset(fault: ColumnFault, x: number, z: number): number {
  const az = (fault.azimuth ?? 0) * DEG;
  // strike direction, and the normal the throw is measured across
  const ux = Math.sin(az);
  const uz = Math.cos(az);
  const nx = Math.cos(az);
  const nz = -Math.sin(az);
  const dx = x - fault.at[0];
  const dz = z - fault.at[1];
  const ramp = fault.ramp && fault.ramp > 0 ? fault.ramp : DEFAULT_RAMP;
  const t = Math.min(1, Math.max(0, (dx * nx + dz * nz) / ramp + 0.5));
  let w = t * t * (3 - 2 * t);
  if (fault.halfLength && fault.halfLength > 0) {
    // displacement dies out toward the tips, as a real fault does
    const r = (dx * ux + dz * uz) / fault.halfLength;
    w *= Math.max(0, 1 - r * r);
  }
  return fault.throw * w;
}

/** Depth of a field ignoring its extent — geology does not stop at a survey edge. */
function structuralDepth(spec: SurfaceFieldSpec, x: number, z: number): number {
  let depth = spec.base ?? 0;
  if (spec.dip) {
    const a = spec.dip.azimuth * DEG;
    depth += spec.dip.gradient * (x * Math.sin(a) + z * Math.cos(a));
  }
  if (spec.relief) {
    for (const relief of spec.relief) {
      depth += relief.amplitude * (sampleRelief(relief, x, z) - 0.5);
    }
  }
  return depth;
}

function reliefOffset(relief: ReliefSpec[] | undefined, x: number, z: number) {
  if (!relief) return 0;
  let sum = 0;
  for (const r of relief) sum += r.amplitude * (sampleRelief(r, x, z) - 0.5);
  return sum;
}

const mapped = (e: Emitted, x: number, z: number) =>
  !e.boundary && !e.holes
    ? true
    : evaluateSurfaceField({ boundary: e.boundary, holes: e.holes }, x, z) !==
      null;

/**
 * Run the column at one world position.
 *
 * @param out reused across nodes; `NaN` where a surface has no data there
 * @returns `out`, in EMISSION (oldest-first) order — see {@link evaluateColumn}
 *   for the shallowest-first public form
 */
function runColumn(
  spec: ColumnSpec,
  emitted: Emitted[],
  x: number,
  z: number,
  out: Float64Array,
): Float64Array {
  let at = 0;
  // The current sediment surface. Never null: erosion lowers it, an unmapped
  // extent does not (nobody recording a horizon changes where the rock is).
  let top = structuralDepth(spec.basement, x, z);
  out[at] = mapped(emitted[at], x, z) ? top : NaN;
  at++;

  for (const step of spec.steps) {
    if (step.kind === 'fault') {
      const off = faultOffset(step, x, z);
      for (let i = 0; i < at; i++) out[i] -= off;
      top -= off;
      continue;
    }

    if (step.kind === 'erosion') {
      const cut = evaluateSurfaceField(step.surface, x, z);
      if (cut !== null) {
        const encoding =
          step.encoding ?? spec.erosionEncoding ?? DEFAULT_EROSION_ENCODING;
        for (let i = 0; i < at; i++) {
          if (out[i] < cut) out[i] = encoding === 'clip' ? cut : NaN;
        }
        top = Math.max(top, cut);
      }
      if (step.name) {
        out[at] = cut === null ? NaN : cut;
        at++;
      }
      continue;
    }

    const thickness =
      (step.drape ?? 0) +
      (step.fill ?? 0) * Math.max(0, top - (step.datum ?? 0));
    // Relief may not push a surface through the one below it: that would be
    // negative thickness. Clamping instead gives a pinch-out, which is real.
    const next = Math.min(
      top,
      top - thickness + reliefOffset(step.relief, x, z),
    );
    top = next;
    out[at] = mapped(emitted[at], x, z) ? next : NaN;
    at++;
  }

  return out;
}

/**
 * Apply {@link ColumnSpec.seed} to every relief in the column.
 *
 * Done ONCE per spec rather than per node: rebuilding a relief object inside the
 * sample loop would allocate once per node per relief. Memoized because a spec is
 * typically a module constant evaluated over hundreds of thousands of nodes.
 */
const seeded = new WeakMap<ColumnSpec, ColumnSpec>();

function resolveSeed(spec: ColumnSpec): ColumnSpec {
  const seed = spec.seed ?? 0;
  if (!seed) return spec;
  const cached = seeded.get(spec);
  if (cached) return cached;

  const shift = (relief: ReliefSpec[] | undefined) =>
    relief?.map(r => ({ ...r, seed: (r.seed ?? 0) + seed }));

  const resolved: ColumnSpec = {
    ...spec,
    basement: { ...spec.basement, relief: shift(spec.basement.relief) },
    steps: spec.steps.map(step => {
      if (step.kind === 'fault') return step;
      if (step.kind === 'erosion') {
        return {
          ...step,
          surface: { ...step.surface, relief: shift(step.surface.relief) },
        };
      }
      return { ...step, relief: shift(step.relief) };
    }),
  };
  seeded.set(spec, resolved);
  return resolved;
}

/**
 * Evaluate a column at a world position.
 *
 * @returns one depth per surface, SHALLOWEST FIRST and aligned with
 *   {@link columnSurfaces}; `null` where that surface has no data
 *
 * @group Geometries
 */
export function evaluateColumn(
  spec: ColumnSpec,
  x: number,
  z: number,
): (number | null)[] {
  const resolved = resolveSeed(spec);
  const emitted = plan(resolved);
  const out = runColumn(
    resolved,
    emitted,
    x,
    z,
    new Float64Array(emitted.length),
  );
  const depths = Array.from(out, d => (Number.isNaN(d) ? null : d));
  return depths.reverse();
}

/**
 * Rasterize a whole column, in the same encoding a parser produces (see
 * {@link generateSurfaceValues}).
 *
 * Surfaces sharing a grid are evaluated in ONE pass over its nodes, so the chain
 * is run once per node rather than once per node per surface.
 *
 * @returns one surface per emitted horizon, SHALLOWEST FIRST — the order the
 *   library's layer arrays take
 *
 * @group Geometries
 */
export function generateColumn(
  spec: ColumnSpec,
  nullValue = -1,
): ColumnSurface[] {
  const resolved = resolveSeed(spec);
  const emitted = plan(resolved);
  const depths = emitted.map(
    e => new Float64Array(e.grid.header.nx * e.grid.header.ny),
  );
  const has = emitted.map(
    e => new Uint8Array(e.grid.header.nx * e.grid.header.ny),
  );

  // One pass per distinct grid, writing every surface that uses it.
  const groups = new Map<ColumnGrid, number[]>();
  emitted.forEach((e, i) => {
    const list = groups.get(e.grid);
    if (list) list.push(i);
    else groups.set(e.grid, [i]);
  });

  const sample = new Float64Array(emitted.length);
  for (const [grid, members] of groups) {
    const { nx, ny } = grid.header;
    const toWorld = surfaceGridToWorld(
      grid.header,
      grid.worldPosition ?? [0, 0],
    );
    for (let row = 0; row < ny; row++) {
      for (let col = 0; col < nx; col++) {
        const [x, z] = toWorld(col, row);
        runColumn(resolved, emitted, x, z, sample);
        const n = row * nx + col;
        for (const i of members) {
          const d = sample[i];
          if (Number.isNaN(d)) continue;
          depths[i][n] = d;
          has[i][n] = 1;
        }
      }
    }
  }

  const surfaces = emitted.map((e, i) => {
    const nodes = e.grid.header.nx * e.grid.header.ny;
    let min = Infinity;
    let max = -Infinity;
    let covered = 0;
    for (let n = 0; n < nodes; n++) {
      if (!has[i][n]) continue;
      covered++;
      if (depths[i][n] < min) min = depths[i][n];
      if (depths[i][n] > max) max = depths[i][n];
    }
    const values = new Float32Array(nodes);
    if (covered === 0) values.fill(nullValue);
    else {
      for (let n = 0; n < nodes; n++) {
        values[n] = has[i][n] ? max - depths[i][n] : nullValue;
      }
    }
    return {
      name: e.name,
      class: e.class,
      header: e.grid.header,
      worldPosition: e.grid.worldPosition ?? ([0, 0] as Vec2),
      values,
      min: covered === 0 ? 0 : min,
      max: covered === 0 ? 0 : max,
      nullValue,
      covered,
    };
  });

  return surfaces.reverse();
}
