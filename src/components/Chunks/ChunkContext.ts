import { createContext } from 'react';
import { PlanarPolygonGeometry, SurfaceMeta } from '../../sdk';
import { ChunkBuildState } from './chunk-defs';
import { CutoutSource } from './cutout';
import { SeamDecision } from './seams';

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
   * `surfaces` filtered to those a chunk actually claims, in the declared order —
   * what the shared build LOADS. A surface no chunk draws would otherwise be
   * fetched, resampled onto the common grid and cascaded through the resolve for
   * nothing.
   *
   * ⚠️ Empty until the children have registered (they do so in an effect), so a
   * chunk must wait for its own claims to appear rather than build against it.
   *
   * ⚠️ Dropping the undrawn surfaces also drops them as CEILINGS in the monotone
   * resolve — a drawn layer is no longer pushed down by a surface nobody can see.
   */
  column?: SurfaceMeta[];
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
   * Who draws each shared horizon, per surface id and then per chunk. Two chunks
   * that meet share their boundary surface, and drawing it twice means two
   * independent tessellations fighting for the same pixels; the stack settles it
   * from the footprints (see `resolveSeam`) rather than the caller declaring it.
   */
  seams?: ChunkSeamRegistry;
  /**
   * Announce which surfaces a chunk draws, and later its resolved outline.
   *
   * A chunk's TOP layer can be truncated against a surface the chunk ABOVE draws,
   * and a horizon two chunks share must be drawn by exactly one of them — both
   * need the neighbours' footprints, and chunks are independent siblings that
   * cannot ask each other, so the stack brokers it.
   *
   * The claims are registered on mount, BEFORE any outline resolves, so a chunk
   * can tell "nobody else draws that surface" (build now) from "somebody does,
   * their outline is still coming" (wait) — and never has to build twice.
   *
   * @returns a deregistration callback for the effect cleanup
   */
  registerChunk?: (key: string, claims: ChunkSurfaceClaim[]) => () => void;
  /**
   * Publish a registered chunk's resolved outline: a polygon, or `null` when it
   * resolved to no footprint at all (e.g. a wellbore cut source no well reaches).
   * Passing `undefined` returns it to unresolved.
   */
  publishOutline?: (
    key: string,
    polygon: PlanarPolygonGeometry | null | undefined,
    rimSpacing?: number,
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
  /** the claiming chunk's registry key */
  key: string;
  /** bumped whenever that chunk publishes a different footprint */
  version: number;
  resolved: boolean;
  polygon: PlanarPolygonGeometry | null;
  /** rim spacing that footprint is densified with */
  rimSpacing?: number;
  /** the surface is that chunk's TOP layer */
  top: boolean;
};

/** One surface a chunk declares, and where it sits in that chunk's layer list. */
export type ChunkSurfaceClaim = {
  id: string;
  /** the chunk's first layer, i.e. this surface is its lid */
  top: boolean;
};

/**
 * What the stack knows about its chunks' footprints: for each surface id, EVERY
 * chunk claiming it. A surface no chunk draws is absent from the map, which is the
 * difference between "not covered" and "not known yet".
 *
 * ⚠️ A list, not a single entry — a shared horizon is claimed twice by
 * construction, and that is exactly the case the seam resolution exists for.
 *
 * @group Contexts
 */
export type ChunkOutlineRegistry = Map<string, ChunkOutlineEntry[]>;

/** Per surface, then per claiming chunk, what that chunk draws of it. */
export type ChunkSeamRegistry = Map<string, Map<string, SeamDecision>>;

/**
 * Context published by {@link ChunkStack}.
 *
 * @group Contexts
 */
export const ChunkStackContext = createContext<ChunkStackContextValue>({
  outline: null,
});
