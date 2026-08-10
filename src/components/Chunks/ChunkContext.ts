import { createContext } from 'react';
import { PlanarPolygonGeometry, SurfaceMeta } from '../../sdk';
import { ChunkBuildState } from './chunk-defs';
import { CutoutSource } from './cutout';

/**
 * Shared configuration a {@link ChunkStack} publishes to its child chunks. Chunks
 * read this when a prop is left to inherit (e.g. `outline="inherit"`).
 *
 * @group Contexts
 */
export type ChunkStackContextValue = {
  /** default outline polygon (scene XZ) shared by chunks that inherit it */
  outline: PlanarPolygonGeometry | null;
  /**
   * default cut source shared by chunks that inherit it. Takes precedence over
   * `outline` when set (an explicit `polygon` source is equivalent to `outline`).
   */
  cutSource?: CutoutSource;
  /** default rim densification spacing (world units) */
  rimSpacing?: number;
  /** default interior simplification error (grid height units) */
  maxError?: number;
  /**
   * The whole column, shallowest first, when the caller declared it on the stack.
   * Chunks pass it to the generator so the fetch, the common grid and the
   * depth-order resolve happen ONCE for every chunk cut from it — which is also
   * what makes those chunks agree with each other about depth order.
   */
  surfaces?: SurfaceMeta[];
  /**
   * Envelope footprint of the column (scene XZ) — must contain every chunk's
   * outline. Defaults to the stack `outline`; with a wellbore cut source the
   * stack resolves it over the FULL depth window, which by construction contains
   * each chunk's own (narrower) outline.
   */
  envelope?: PlanarPolygonGeometry | null;
  /**
   * A chunk's outline, once resolved, published back to the stack (see
   * {@link ChunkStackContextValue.registerChunk}). `undefined` while a registered
   * chunk is still resolving its outline.
   */
  outlines?: ChunkOutlineRegistry;
  /**
   * Announce which surfaces a chunk draws, and later its resolved outline.
   *
   * A chunk's TOP layer can be truncated against a surface the chunk ABOVE draws,
   * so it needs that chunk's footprint to know whether dropping the truncated
   * fragment leaves a hole. Chunks are independent siblings and cannot ask each
   * other, so the stack brokers it.
   *
   * The surface ids are registered on mount, BEFORE any outline resolves, so a
   * chunk can tell "nobody draws that surface" (build now) from "somebody does,
   * their outline is still coming" (wait) — and never has to build twice.
   *
   * @returns a deregistration callback for the effect cleanup
   */
  registerChunk?: (key: string, surfaceIds: string[]) => () => void;
  /**
   * Publish a registered chunk's resolved outline: a polygon, or `null` when it
   * resolved to no footprint at all (e.g. a wellbore cut source no well reaches).
   * Passing `undefined` returns it to unresolved.
   */
  publishOutline?: (
    key: string,
    polygon: PlanarPolygonGeometry | null | undefined,
  ) => void;
  /**
   * Report a chunk's build state, so the stack can aggregate it into
   * {@link ChunkStackProgress}. Registered chunks that have not reported yet count
   * as building.
   */
  reportBuildState?: (key: string, state: ChunkBuildState) => void;
};

/**
 * What the stack knows about one surface: whether the chunk drawing it has
 * finished resolving its outline, and what that outline is.
 *
 * The distinction matters — an unresolved chunk is worth waiting for, whereas one
 * that resolved to NO footprint (e.g. a wellbore cut source no well reaches) never
 * will be, and waiting for it would hang every chunk beneath it.
 *
 * @group Contexts
 */
export type ChunkOutlineEntry = {
  resolved: boolean;
  polygon: PlanarPolygonGeometry | null;
};

/**
 * What the stack knows about its chunks' footprints: for each surface id, the
 * outline of the chunk drawing it. A surface no chunk draws is absent from the
 * map, which is the difference between "not covered" and "not known yet".
 *
 * @group Contexts
 */
export type ChunkOutlineRegistry = Map<string, ChunkOutlineEntry>;

/**
 * Context published by {@link ChunkStack}.
 *
 * @group Contexts
 */
export const ChunkStackContext = createContext<ChunkStackContextValue>({
  outline: null,
});
