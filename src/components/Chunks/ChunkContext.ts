import { createContext } from 'react';
import { IUniform, Material, Vector4 } from 'three';
import { PlanarPolygonGeometry, SurfaceMeta } from '../../sdk';
import {
  ChunkBuildState,
  ChunkCarrier,
  ChunkResolveOptions,
  ChunkSectionState,
  StackWater,
} from './chunk-defs';
import { CutoutSource } from './cutout';
import { ChunkContactTexture } from './chunk-contacts';
import { ChunkDepthMap } from './chunk-depth-map';
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
   * Default build options for the column (see `ChunkStackProps.resolve`), used by
   * chunks that declare none of their own.
   */
  resolve?: ChunkResolveOptions;
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
   * The flat floor the whole column terminates against, when the caller declared
   * one (see `ChunkStackProps.carrier`). A chunk draws it when its own last layer
   * declares a fill; every chunk that does draws the SAME plane.
   */
  carrier?: ChunkCarrier;
  /**
   * The carrier's cap material, published separately from `carrier` because it is
   * APPEARANCE: it must reach `ChunkMeshes` without joining the build spec, where
   * it would make recolouring the floor rebuild the geometry.
   */
  carrierMaterial?: string | Material;
  /**
   * Fluid contacts drawn as LINES across whatever face crosses them, prepared as
   * textures. APPEARANCE only, like `carrierMaterial`: a contact takes no part in
   * the depth order and never joins a build spec.
   */
  contacts?: ChunkContactTexture[] | null;
  /**
   * The sea over the whole column, when the caller declared one (see
   * `ChunkStackProps.water`). Chunks read it for APPEARANCE only — the bed tint on
   * their shallowest cap; the sea's own geometry belongs to the stack.
   */
  water?: StackWater | null;
  /**
   * The sea bed's depth grid as a texture, when a sea is declared. APPEARANCE
   * only: it drives the bed tint per fragment, so a face hanging below the bed is
   * tinted by the water standing over it rather than by its own depth.
   */
  bathymetry?: ChunkDepthMap | null;
  /**
   * The live clip plane through the whole stack, when the caller declared one (see
   * `ChunkStackProps.section`). A chunk reads it every frame to build its own cut
   * faces. Stable identity — see {@link ChunkSectionState}.
   */
  section?: ChunkSectionState | null;
  /**
   * The section plane as a SHARED uniform (xyz normal, w constant), written once
   * per frame by the stack.
   *
   * ⭐ Shared identity is the whole mechanism: every `ChunkMaterial` of every chunk
   * is handed this same object, and a `ShaderMaterial`'s OIT variants share their
   * `uniforms` by reference — so moving the plane is one write that reaches every
   * material in every pass, with no React render and no material rebuild.
   */
  sectionUniform?: IUniform<Vector4>;
  /**
   * The exact COMPLEMENT of {@link ChunkStackContextValue.sectionUniform} — for
   * geometry that must appear only where the section took something away. A cap
   * kept whole over a layer the section cut needs its dropped fragments back, but
   * only in the half that layer vacated; the negated plane makes the two mutually
   * exclusive with no tolerance to tune.
   */
  sectionUniformInverse?: IUniform<Vector4>;
  /**
   * Whether the column's floor is cut with the rest of the block (see
   * `ChunkSection.carrier`). A PRIMITIVE, deliberately: it decides how a material
   * is built, so it has to be visible to React — and a primitive cannot churn this
   * context's identity, which is what every chunk's build spec derives from.
   */
  sectionCarrier?: boolean;
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
   * Drop everything the stack holds for a chunk that has UNMOUNTED — its outline
   * and its build state.
   *
   * ⚠️ Deliberately separate from the deregistration callback: claims change
   * whenever a chunk's layers do, so that cleanup also runs on a re-registration,
   * and clearing the outline there would leave it unresolved for good (publishing
   * is a different effect and would not re-run).
   */
  releaseChunk?: (key: string) => void;
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
  /**
   * Every chunk's depth window and wellbore margin, ordered shallow→deep by the
   * column. A chunk accumulating trajectory from outside its own window (see
   * `WellboreOutlineMode`) buffers each depth interval with the margin of the
   * chunk that owns it, so it needs its NEIGHBOURS' margins, not just its own.
   *
   * ⚠️ Empty until the children have registered (they do so in an effect), so a
   * chunk must wait for its own entry to appear rather than build against a
   * partial ramp — exactly like {@link ChunkStackContextValue.column}.
   */
  margins?: ChunkMarginEntry[];
  /**
   * Publish a chunk's depth window and margin (see
   * {@link ChunkStackContextValue.margins}). Pass `null` to withdraw it.
   */
  publishMargin?: (key: string, entry: ChunkMarginEntry | null) => void;
};

/**
 * One chunk's depth window and the margin its wellbore cut source buffers with.
 *
 * @group Contexts
 */
export type ChunkMarginEntry = {
  /** the publishing chunk's registry key */
  key: string;
  /** its shallowest REAL surface (a synthetic layer bounds nothing) */
  topSurfaceId?: string;
  /** its deepest REAL surface */
  baseSurfaceId?: string;
  /** the buffer margin, scene units */
  radius: number;
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
  /** the surface is that chunk's LID (see {@link ChunkSurfaceClaim.top}) */
  top: boolean;
};

/** One surface a chunk declares, and whether that chunk's block hangs from it. */
export type ChunkSurfaceClaim = {
  id: string;
  /**
   * The surface is this chunk's LID: its first layer, AND one holding a volume.
   *
   * ⚠️ Both halves matter. A cap is the lid of the block underneath it, so a
   * chunk whose first layer is a bare sheet has no block for it to be the lid of
   * — claiming it anyway would let a translucent sheet take the horizon away from
   * the solid block below, which is the exact failure the rule exists to prevent.
   */
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
