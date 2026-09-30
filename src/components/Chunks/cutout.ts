import { PlanarPolygonGeometry, WellboreOutlineOptions } from '../../sdk';

/**
 * Which part of a wellbore counts towards a chunk's outline.
 *
 * - `'window'` — only where the trajectory lies inside the chunk's own depth
 *   window (between its top and base surfaces). Footprints vary per chunk with
 *   no relation between them.
 * - `'above'` — everything from the WELLHEAD down to the chunk's base. The point
 *   set grows with depth, so the outlines nest and the stack telescopes OUT:
 *   narrow at the top, widening downwards.
 * - `'below'` — everything from the chunk's top down to TD. The mirror image:
 *   the shallowest chunk covers every well and the stack narrows with depth.
 *
 * `'above'` and `'below'` are evaluated against the chunk's own bounding surface
 * at each trajectory sample's XZ, NOT against the chunk stack, so a chunk is
 * never limited by what its neighbour happens to cover.
 *
 * @group Components
 */
export type WellboreOutlineMode = 'window' | 'above' | 'below';

/**
 * Options controlling a wellbore-derived {@link CutoutSource}: the SDK outline
 * options plus the orchestration knobs the {@link Chunk} needs to turn raw
 * trajectories into a footprint.
 *
 * @group Components
 */
export type WellboreCutoutOptions = WellboreOutlineOptions & {
  /** which part of each well counts (default `'window'`). */
  mode?: WellboreOutlineMode;
  /**
   * What to do where a bounding surface has no data at a trajectory sample
   * (default `'exclude'`). See {@link TrajectoryWindowOptions.unmapped} — this is
   * what decides whether a hole in a chunk's DEEP base surface also removes that
   * area from its outline.
   */
  unmapped?: 'exclude' | 'ignore';
  /**
   * Trajectory sampling spacing along the well path, scene units (default 50).
   * This decides how finely the depth window is tested, NOT the shape of the
   * buffer (the outline is built from segments, and the window crossings are
   * interpolated), so it is a cost knob rather than a correctness one.
   */
  sampleSpacing?: number;
  /**
   * Vertical tolerance (scene units) widening the chunk's depth window, so wells
   * grazing the top/base surface are still captured. Default 0.
   */
  tolerance?: number;
};

/**
 * A pluggable source for a chunk's cut outline. Either an explicit polygon, or a
 * set of wellbores whose trajectories are turned into an outline (see the SDK
 * `createWellboreOutline` pipeline). Mirrors the design in `documents/chunks.md`
 * §4.1.
 *
 * @group Components
 */
export type PolygonCutoutSource = {
  kind: 'polygon';
  polygon: PlanarPolygonGeometry;
};

/** A wellbore-derived cut source (see {@link CutoutSource}). */
export type WellboreCutoutSource = {
  kind: 'wellbores';
  wellbores: string[];
  options?: WellboreCutoutOptions;
};

export type CutoutSource = PolygonCutoutSource | WellboreCutoutSource;

/**
 * A per-chunk override of a wellbore cut source. Any field omitted is inherited
 * from the {@link ChunkStack}'s `cutSource`: `wellbores` falls back to the stack's
 * set, and `options` are **shallow-merged over** the stack's (the override wins
 * per key). Lets a single chunk tweak e.g. `radius` without re-declaring the
 * whole source.
 *
 * @group Components
 */
export type WellboreCutoutOverride = {
  kind: 'wellbores';
  wellbores?: string[];
  options?: WellboreCutoutOptions;
};

/**
 * The accepted value of {@link Chunk}'s `outline` prop: inherit the stack, an
 * explicit polygon (geometry or source), a full wellbore source, or a partial
 * wellbore override merged over the stack's source.
 *
 * @group Components
 */
export type ChunkOutline =
  | PlanarPolygonGeometry
  | 'inherit'
  | PolygonCutoutSource
  | WellboreCutoutOverride;

/** Narrow an outline prop to a {@link CutoutSource}. */
export function isCutoutSource(value: unknown): value is CutoutSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ((value as CutoutSource).kind === 'polygon' ||
      (value as CutoutSource).kind === 'wellbores')
  );
}

/**
 * Resolve a {@link Chunk}'s `outline` prop against the {@link ChunkStack}'s
 * default source into a concrete {@link CutoutSource} (or `null` when nothing is
 * available to build from).
 *
 * - `'inherit'` → the stack source as-is.
 * - a `PlanarPolygonGeometry` → wrapped as a polygon source.
 * - a polygon source → used directly.
 * - a wellbore source/override → `wellbores` falls back to the stack's wellbore
 *   set when omitted, and `options` are shallow-merged over the stack's (the
 *   override wins per key), so a chunk can tweak individual fields.
 *
 * @group Components
 */
export function resolveCutoutSource(
  outline: ChunkOutline,
  stackSource: CutoutSource | null,
): CutoutSource | null {
  if (outline === 'inherit') return stackSource;
  if (!('kind' in outline)) return { kind: 'polygon', polygon: outline };
  if (outline.kind === 'polygon') return outline;

  const stackWellbores =
    stackSource && stackSource.kind === 'wellbores' ? stackSource : null;
  const wellbores = outline.wellbores ?? stackWellbores?.wellbores;
  if (!wellbores || wellbores.length === 0) return null;
  const options: WellboreCutoutOptions = {
    ...(stackWellbores?.options ?? {}),
    ...(outline.options ?? {}),
  };
  return { kind: 'wellbores', wellbores, options };
}
