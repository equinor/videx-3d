import { PlanarPolygonGeometry, WellboreOutlineOptions } from '../../sdk';

/**
 * Options controlling a wellbore-derived {@link CutoutSource}: the SDK outline
 * options plus the orchestration knobs the {@link Chunk} needs to turn raw
 * trajectories into a footprint point cloud.
 *
 * @group Components
 */
export type WellboreCutoutOptions = WellboreOutlineOptions & {
  /** trajectory sampling spacing along the well path, scene units (default 50). */
  sampleSpacing?: number;
  /**
   * Proximity for clustering footprint points into separate outline components.
   * Defaults to `2 * radius` (touching buffers stay one cluster).
   */
  clusterDistance?: number;
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
