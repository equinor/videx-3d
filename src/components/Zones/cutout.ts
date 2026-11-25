import { PlanarPolygonGeometry, WellboreOutlineOptions } from '../../sdk';

/**
 * Which part of a wellbore counts towards a zone's boundary.
 *
 * - `'window'` — only where the trajectory lies inside the zone's own depth
 *   window (between its top and base surfaces). Footprints vary per zone with
 *   no relation between them.
 * - `'above'` — everything from the WELLHEAD down to the zone's base. The point
 *   set grows with depth, so the boundaries nest and the stack telescopes OUT:
 *   narrow at the top, widening downwards.
 * - `'below'` — everything from the zone's top down to TD. The mirror image:
 *   the shallowest zone covers every well and the stack narrows with depth.
 *
 * `'above'` and `'below'` are evaluated against the zone's own bounding surface
 * at each trajectory sample's XZ, NOT against the zone stack, so a zone is
 * never limited by what its neighbour happens to cover.
 *
 * @group Components
 */
export type WellboreOutlineMode = 'window' | 'above' | 'below';

/**
 * Options controlling a wellbore-derived {@link CutoutSource}: the SDK outline
 * options ({@link WellboreOutlineOptions}) plus the orchestration knobs the
 * {@link Zone} needs to turn raw trajectories into a footprint. The outline is
 * built in a worker, so `shapeFn` (a function) is not available here.
 *
 * @group Components
 */
export type WellboreCutoutOptions = Omit<WellboreOutlineOptions, 'shapeFn'> & {
  /** which part of each well counts (default `'window'`). */
  mode?: WellboreOutlineMode;
  /**
   * What to do where a bounding surface has no data at a trajectory sample
   * (default `'exclude'`): this decides whether a hole in a zone's DEEP base
   * surface also removes that area from its boundary.
   */
  unmapped?: 'exclude' | 'ignore';
  /**
   * Trajectory sampling spacing along the well path, scene units (default 50).
   * This decides how finely the depth window is tested, NOT the shape of the
   * buffer (the boundary is built from segments, and the window crossings are
   * interpolated), so it is a cost knob rather than a correctness one.
   */
  sampleSpacing?: number;
  /**
   * Vertical tolerance (scene units) widening the zone's depth window, so wells
   * grazing the top/base surface are still captured. Default 0.
   */
  tolerance?: number;
};

/**
 * A pluggable source for a zone's cut boundary. Either an explicit polygon, or a
 * set of wellbores whose trajectories are turned into a boundary (see the SDK
 * `createWellboreOutline` pipeline). Mirrors the design in `documents/zones.md`
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
 * A per-zone override of a wellbore cut source. Any field omitted is inherited
 * from the {@link ZoneStack}'s `cutSource`: `wellbores` falls back to the stack's
 * set, and `options` are **shallow-merged over** the stack's (the override wins
 * per key). Lets a single zone tweak e.g. `radius` without re-declaring the
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
 * The accepted value of {@link Zone}'s `boundary` prop: inherit the stack, an
 * explicit polygon (geometry or source), a full wellbore source, or a partial
 * wellbore override merged over the stack's source.
 *
 * @group Components
 */
export type ZoneBoundary =
  | PlanarPolygonGeometry
  | 'inherit'
  | PolygonCutoutSource
  | WellboreCutoutOverride;

/**
 * Resolve a {@link Zone}'s `boundary` prop against the {@link ZoneStack}'s
 * default source into a concrete {@link CutoutSource} (or `null` when nothing is
 * available to build from).
 *
 * - `'inherit'` → the stack source as-is.
 * - a `PlanarPolygonGeometry` → wrapped as a polygon source.
 * - a polygon source → used directly.
 * - a wellbore source/override → `wellbores` falls back to the stack's wellbore
 *   set when omitted, and `options` are shallow-merged over the stack's (the
 *   override wins per key), so a zone can tweak individual fields.
 *
 * @group Components
 */
export function resolveCutoutSource(
  boundary: ZoneBoundary,
  stackSource: CutoutSource | null,
): CutoutSource | null {
  if (boundary === 'inherit') return stackSource;
  if (!('kind' in boundary)) return { kind: 'polygon', polygon: boundary };
  if (boundary.kind === 'polygon') return boundary;

  const stackWellbores =
    stackSource && stackSource.kind === 'wellbores' ? stackSource : null;
  const wellbores = boundary.wellbores ?? stackWellbores?.wellbores;
  if (!wellbores || wellbores.length === 0) return null;
  const options: WellboreCutoutOptions = {
    ...(stackWellbores?.options ?? {}),
    ...(boundary.options ?? {}),
  };
  return { kind: 'wellbores', wellbores, options };
}
