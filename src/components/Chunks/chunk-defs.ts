import { ColorRepresentation, Material, Plane } from 'three';
import {
  FenceExtensionMode,
  FenceField,
  FenceSegmentIndex,
  PackedBufferGeometry,
  PackedSurfaceChunk,
  PlanarPolygonCoordinates,
  SealMode,
  StackCarrier,
  StackRelief,
  StackSectionSource,
  SurfaceClipHeader,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import { OceanBodyProps, OceanWaterProps } from '../Ocean/ocean-material-sync';
import { ChunkDetail } from './chunk-detail';

/** Generator key for the {@link Chunk} geometry generator. */
export const surfaceChunk = 'surfaceChunk';

/** Generator key for the `ChunkStack` sea geometry generator. */
export const stackWater = 'stackWater';

/**
 * The id the column's floor claims in the seam registry.
 *
 * ⭐ The floor is ONE plane, so two chunks whose footprints overlap must not both
 * draw it — the same problem as a shared horizon, and answered the same way. It is
 * nobody's top layer, so `resolveSeam` falls back to area order: the widest draws
 * it and the others cut around it.
 *
 * ⚠️ Not a surface id, and deliberately not shaped like one.
 */
export const CARRIER_SEAM_ID = '@carrier';

/**
 * What the `stackWater` generator needs to build the sea: the footprint it covers,
 * its level, and the column its BED comes from.
 */
export type StackWaterSpec = {
  /** the stack outline (scene XZ) the sea is drawn over */
  polygon: {
    coordinates: PlanarPolygonCoordinates;
    offset: Vec2;
  };
  /** sea level, metres below datum (POSITIVE-DOWN, as surfaces are given) */
  depth: number;
  /**
   * Target triangle edge length for the lid, in world units. Omit (or 0) for the
   * fewest triangles that fill the outline.
   */
  resolution?: number;
  rimSpacing?: number;
  maxError?: number;
  /**
   * The column the sea's bed comes from — its shallowest surface, taken from the
   * very channels the chunks are built on, so the water body meets the bed they
   * draw rather than a second opinion about where it is.
   */
  stack: SurfaceChunkStackSpec;
  resolve?: ChunkResolveOptions;
  /**
   * Also return the channels a cut FACE is built from, so a section or a fence can
   * close the water body instead of leaving it open. Requested by the PRESENCE of a
   * cut on the stack, so switching one on or off does not rebuild the sea.
   */
  section?: boolean;
};

/** What the `stackWater` generator returns: the sea's lid and the body under it. */
export type StackWaterResponse = {
  /** the sea surface over the whole outline */
  lid: PackedBufferGeometry | null;
  /** the water body's walls — the outline rim and the shoreline */
  body: PackedBufferGeometry | null;
  /**
   * The level and the bed as channels, when {@link StackWaterSpec.section} asked
   * for them — what a cut face is swept over. Flat typed arrays, so it crosses the
   * worker boundary as it is.
   */
  section?: StackSectionSource;
};

/**
 * One layer of a {@link SurfaceChunkSpec} backed by a surface: a reference plus how
 * to place it. The (heavy) grid values are NOT included — the generator fetches
 * `surface-values` for `id` inside the worker so the raw grids never cross to the
 * main thread.
 */
export type SurfaceChunkLayerSpec = {
  /** surface id (the worker fetches `surface-values` for this id) */
  id: string;
  /** grid geometry needed to place/clip the surface (from `SurfaceMeta.header`) */
  header: SurfaceClipHeader;
  /** depth-normalization reference (`SurfaceMeta.max`) */
  referenceDepth: number;
  /** scene XZ of the surface origin (`utmToArea(xori, yori, 0)` -> `[x, z]`) */
  worldPosition: Vec2;
};

export type SurfaceChunkSpecLayer = (
  | SurfaceChunkLayerSpec
  | SurfaceChunkSyntheticLayer
) & {
  /**
   * Draw the interval between this surface and the next one down. Default false —
   * a chunk is a run of boundaries, and a volume between two of them is something
   * the caller asks for.
   */
  fill?: boolean;
  /**
   * This layer is the COLUMN's carrier (see `SurfaceChunkStackSpec.carrier`) —
   * the flat floor the whole stack terminates against, rather than a boundary of
   * this chunk's own.
   */
  carrier?: boolean;
  /**
   * Draw this layer's cap. Default true; `false` keeps the layer in the stack but
   * draws no surface, because a neighbouring chunk covers this whole footprint and
   * draws that horizon instead. INFERRED by `ChunkStack` from the chunks'
   * footprints — not something the caller declares.
   */
  cap?: boolean;
  /**
   * Indices into {@link SurfaceChunkSpec.cuts} of the neighbours that draw this
   * layer's cap where they reach. The partial-overlap case of the same decision:
   * this chunk draws its own footprint minus theirs.
   */
  capCuts?: number[];
};

/** A synthetic (data-free) boundary in a {@link SurfaceChunkSpec}. */
export type SurfaceChunkSyntheticLayer = {
  /** metres below sea level (positive-down), matching how surfaces are given */
  depth?: number;
  /** metres below the layer ABOVE this one */
  offset?: number;
  /** optional procedural perturbation of the base plane */
  relief?: StackRelief;
};

/** Whether a spec layer is synthetic rather than backed by a surface. */
export function isSyntheticSpecLayer(
  layer: SurfaceChunkSpecLayer,
): layer is SurfaceChunkSyntheticLayer & { fill?: boolean } {
  return (layer as SurfaceChunkLayerSpec).id === undefined;
}

/** Whether a spec layer draws the column's carrier. */
export function isCarrierSpecLayer(layer: SurfaceChunkSpecLayer): boolean {
  return layer.carrier === true;
}

/**
 * Where a chunk is in its build, for a host that wants a busy indicator.
 *
 * `'building'` covers everything before the geometry exists — resolving the
 * outline, waiting for a neighbour, and the worker build itself — because from the
 * outside they are the same thing: not ready yet. `'empty'` is a real outcome, not
 * a failure: a chunk whose outline resolves to nothing, or whose footprint is cut
 * away entirely because no surface is mapped there, has nothing to draw.
 *
 * @group Components
 */
export type ChunkBuildState = 'building' | 'ready' | 'empty' | 'failed';

/**
 * How far a {@link ChunkStack} is through building its chunks.
 *
 * Counted in CHUNKS, not in work: the first chunk of a shared column pays for the
 * fetch, the resample and the resolve (~half the wall clock on the demo field), so
 * the count moves in uneven steps. It is still the honest signal — a smooth bar
 * here would be an invented one.
 *
 * @group Components
 */
export type ChunkStackProgress = {
  /** chunks mounted in the stack */
  total: number;
  /** chunks still working */
  building: number;
  /** chunks that reached a terminal state (ready, empty or failed) */
  completed: number;
  /** `completed / total`, or 1 for an empty stack */
  fraction: number;
};

/**
 * One boundary of a `Chunk`: a surface, plus whether the interval BELOW it is
 * filled with a volume.
 *
 * A chunk is a run of boundaries in stratigraphic order. The wall between two of
 * them exists only because the caller asked for it — which is how a zone, a gap
 * between zones, and a bare surface with no volume at all are all expressed with
 * one concept instead of three.
 *
 * @group Components
 */
export type ChunkLayer = {
  /**
   * The surface itself (callers provide `SurfaceMeta`, as with `Surface`). Omit it
   * and give {@link ChunkLayer.depth} or {@link ChunkLayer.offset} for a synthetic
   * boundary — water, a procedural sea bed, a basement floor.
   */
  surface?: SurfaceMeta;
  /**
   * Synthetic boundary: metres below sea level (POSITIVE-DOWN, the same convention
   * surfaces are given in). `0` is sea level.
   */
  depth?: number;
  /**
   * Synthetic boundary: metres below the layer ABOVE this one — a floor that
   * follows whatever it hangs from. Meaningless on the first layer.
   */
  offset?: number;
  /** optional procedural perturbation of a synthetic boundary */
  relief?: StackRelief;
  /**
   * The cap's material — a colour, or a `Material` (e.g. a `SurfaceMaterial`) the
   * CALLER owns and this component never disposes. Omit for the built-in palette,
   * cycled by layer order.
   */
  material?: string | Material;
  /**
   * The volume between this surface and the next one down: a colour, a `Material`,
   * or `true` to reuse this layer's own {@link ChunkLayer.material}.
   *
   * Omitted / `null` / `false` means NO volume — which is how a gap between zones
   * and a bare surface with no thickness are both expressed.
   *
   * ⭐ On the LAST layer it means the block is open at the bottom, and the column's
   * carrier closes it (see `ChunkStackProps.carrier`) — a volume has to end
   * somewhere, and the only thing that can say where is the column.
   */
  fill?: string | Material | boolean | null;
  /**
   * Procedural surface relief for this layer's cap AND the volume below it — a
   * {@link ChunkDetail} preset such as `'sand'` or `'shale'`, adding subtle
   * texture-free detail once the camera is close. OFF when omitted.
   *
   * ⚠️ Ignored where {@link ChunkLayer.material} / {@link ChunkLayer.fill} supply a
   * `Material`: that one is the caller's and is used exactly as given.
   */
  detail?: ChunkDetail;
  /**
   * Opacity for this layer's cap AND the volume below it, OVERRIDING the chunk's
   * `surfaceOpacity` / `wallOpacity`.
   *
   * ⭐ Opacity is a property of the UNIT, not of the chunk that happens to contain
   * it: water at 0.45 over an opaque sea bed is one chunk, not two.
   *
   * ⚠️ An override, not a multiplier, so an explicit value WINS — which also means
   * the chunk-level sliders no longer reach this layer. Leave it unset on the layers
   * a global transparency control should sweep along.
   */
  opacity?: number;
  /**
   * Let the stack's section cut this unit. Default true; `false` keeps it WHOLE
   * while everything around it is cut away — a slab standing proud of the section,
   * which is how you single out a reservoir, a seal or the sea bed.
   *
   * ⭐ It keeps the whole UNIT, not one surface: this layer's cap, the volume below
   * it, AND the cap of the layer that floors that volume. The floor is INFERRED —
   * a cap is left uncut whenever the unit above OR below it is kept — because a
   * unit whose top survives the cut but whose base does not is not a slab, it is a
   * lid over open space, which is the hollow shell the section exists to avoid.
   *
   * ⚠️ So keeping two adjacent units keeps the cap between them, once. And keeping
   * the LAST unit keeps the column's floor with it, exactly as
   * {@link ChunkSection.carrier} would.
   *
   * ⚠️ No cut face is drawn for a kept unit — there is nothing to close, and a face
   * there would sit inside solid material.
   */
  section?: boolean;
  /**
   * Which of the stack's contacts draw on this unit, by id. Omit for ALL of them
   * (the default), `false` for none.
   *
   * ⚠️ Purely optional masking. A contact is drawn wherever its grid says it is,
   * so an unrestricted one will also cross units that hold no fluid — restricting
   * it is the HOST's interpretation, and the library will not infer it.
   */
  contacts?: string[] | false;
};

/**
 * How a water body tints whatever lies UNDER it, as if seen through the water
 * column — the chunk's answer to the `Ocean` component's `seaBedWaterTint`.
 *
 * ⭐ Depth-dependent where the `Ocean` sea bed's is flat, because a chunk's sea
 * bed is ordinary geology and can rise THROUGH the water. Absorption that fades
 * to nothing at the waterline leaves a coast or an island untinted without
 * anything having to know where the shoreline runs.
 *
 * ⭐ The depth is read from the BED's own grid rather than from each fragment's
 * height, so the gradient follows the bathymetry instead of the tessellation.
 * ⚠️ Where that grid is unmapped it falls back to the fragment's own depth.
 *
 * ⚠️ Applies to the cap of the SHALLOWEST solid layer, and to that one only: it
 * stands for looking down through the water at the bed, not for making the whole
 * column blue. The rim WALL is not tinted either — the water body ends at the
 * footprint, so there is none between the eye and the flank.
 *
 * @expand
 * @group Components
 */
export type ChunkWaterTint = {
  /**
   * Strength of the tint deep down (0..1, 0 = off). Follows
   * {@link OceanWaterProps.waterOpacity} when omitted, so the bed reads denser as
   * the water does — the same coupling the `Ocean` component uses.
   */
  bedTint?: number;
  /**
   * Depth below the water level at which the tint reaches ~86% of `bedTint`, in
   * metres. Default {@link DEFAULT_BED_TINT_DEPTH}.
   */
  bedTintDepth?: number;
  /**
   * Depth of the WET band just below the waterline, in metres. 0 (the default)
   * is off.
   *
   * ⭐ Wet ground is darker, and this is what stops a shore reading as a hard
   * colour boundary between dry land and tinted bed. It fades out a little above
   * the waterline as well — the splash zone — rather than ending on a step there.
   */
  wetBand?: number;
  /** How much `wetBand` darkens the ground, 0..1. Default 0.4. */
  wetStrength?: number;
};

/**
 * Open water over a whole column, declared once on the `ChunkStack`.
 *
 * ⭐ It is a property of the COLUMN, not of a chunk — the same reasoning as
 * `ChunkStackProps.carrier`, and for one more: a fluid lid covers its whole
 * footprint by design, so two chunks each drawing part of the sea would draw two
 * coplanar lids wherever their footprints overlap. The stack draws it once.
 *
 * @expand
 * @group Components
 */
export type StackWater = OceanWaterProps &
  OceanBodyProps &
  ChunkWaterTint & {
    /** sea level, metres below datum (POSITIVE-DOWN, as surfaces are given). Default 0. */
    depth?: number;
    /**
     * Master opacity multiplier for the sea, 0..1. Default 1.
     *
     * ⚠️ NOT the same as `waterOpacity`, which is the water's OWN opacity and only
     * a base: the shader mixes it toward 1 with the Fresnel term, so the surface is
     * see-through from above and mirror-like at a grazing angle whatever it says.
     * This then multiplies the result. Water that looks too transparent at
     * `opacity: 1` is usually carrying `waterOpacity`'s default of 0.7.
     */
    opacity?: number;
    /**
     * Target triangle edge length for the lid, in metres. Omit for the fewest
     * triangles that fill the outline — all a flat surface needs, since its waves
     * are shaded per pixel.
     *
     * ⚠️ Only worth setting when vertex displacement is on, and then no finer than
     * the swells being displaced need: it applies over the whole footprint, so the
     * triangle count grows with the square of the field size.
     */
    resolution?: number;
  };

/**
 * Fog the view while the camera is INSIDE something the stack draws — the sea, or
 * the block itself.
 *
 * ⭐ Both are made of SURFACES rather than of a medium, so from outside every
 * sightline crosses one and picks up its attenuation, and from inside there is
 * nothing in the path at all. Scene fog supplies what is missing: attenuation by
 * distance from the CAMERA, which also reaches host geometry (vessels, facilities,
 * pipelines) that no material of this library could.
 *
 * ⚠️ OFF unless declared, and it has to be: installing `scene.fog` at all changes
 * every material's program cache key, so there is no free "disabled" state. Absent,
 * nothing subscribes to the frame loop and no shader differs.
 *
 * @expand
 * @group Components
 */
export type StackImmersion = {
  /** fog inside the sea. Default true (when the stack declares water) */
  water?: boolean;
  /** fog inside the block. Default true */
  sediment?: boolean;
  /**
   * Colour inside the block. Default a near-black brown.
   *
   * ⚠️ One colour for the whole block, not per unit: the fills live in the
   * appearance layer and the stack does not know them. Per-unit colour would mean
   * every chunk publishing its palette upward.
   */
  color?: ColorRepresentation;
  /**
   * Roughly how far you can see inside the block, in metres. Default 400.
   *
   * ⭐ The point of this effect is a positional CUE — telling a user who has flown
   * the camera into the ground that they have — not occlusion. Dimming that still
   * leaves wellbores and other geometry readable is more useful than the blackout
   * physical realism would ask for.
   *
   * ⚠️ Three's `FogExp2` is `exp(−(d / visibility)²)`, so it saturates
   * QUADRATICALLY: ~63% fogged at this distance and ~98% at twice it. There is no
   * way to bound it short of patching the fog chunk in every shader, so the only
   * control over how much you can see is this number.
   */
  visibility?: number;
  /**
   * Take the scene's background to the medium's colour too. Default true.
   *
   * ⚠️ Fogged geometry against an unfogged background is the classic mismatch, and
   * it is worse on a BRIGHT background than a dark one: fog reads as a haze hanging
   * in the room rather than as a medium. Off means setting your background
   * yourself. ⚠️ Interpolated where the host's background is a colour, swapped
   * where it is a texture or a cube map — those cannot be blended.
   */
  background?: boolean;
  /** metres over which a medium fades in at its boundaries. Default 5 */
  transition?: number;
  /**
   * Seconds for the fog to catch up with a step change. Default 0.12.
   *
   * ⚠️ Needed at all because a medium's own boundaries ramp smoothly but leaving
   * one SIDEWAYS — past the edge of the drawn footprint, or through a section plane
   * — has no distance to ramp over. Keep it short: this is a cue, and a slow one
   * reads as a bug.
   */
  settle?: number;
};

/**
 * The flat floor a whole column terminates against, as a `ChunkStack` declares it:
 * a {@link StackCarrier} plus how it is drawn.
 *
 * @group Components
 */
export type ChunkCarrier = StackCarrier & {
  /**
   * The floor's own cap material — a colour, or a `Material` the CALLER owns and
   * this component never disposes.
   *
   * Omit it and the floor is drawn with the fill of the unit resting ON it, which
   * is the only side of it ever seen; give it one to let the floor read as its own
   * thing (a datum rather than the underside of the deepest unit).
   */
  material?: string | Material;
};

/**
 * A clip plane through a whole `ChunkStack`, whose cut face is FILLED per interval
 * so the block reads as a geological section rather than a hollow shell.
 *
 * ⭐ Declared on the stack, but each chunk builds its own cut faces from its own
 * channels — the plane is one decision, the geometry is per chunk.
 *
 * ⚠️⚠️ It cuts what the STACK draws and nothing else: the chunks, and the sea if
 * `water` allows. Wellbores, vessels, facilities, pipelines, annotations and host
 * meshes all keep drawing whole, because the cut is a branch in the stack's own
 * shaders rather than a renderer-wide clip. So an object resting on the sea bed
 * stays put while the ground under it is cut away.
 *
 * @group Components
 */
export type ChunkSection = {
  /**
   * The cutting plane, in the STACK's own object space. Points where
   * `plane.distanceToPoint(p) > 0` are cut away, so the normal points at what is
   * removed — which is also the cut face's outward normal. Flipping the section is
   * `plane.negate()`.
   *
   * ⭐ Read every frame and never through React, so MUTATING it animates the
   * section at no render cost. ⚠️ Object space, not world: the stack may carry a
   * vertical exaggeration, and the shader tests the raw vertex position for
   * exactly this reason.
   *
   * Ignored when {@link ChunkSection.cameraDistance} or
   * {@link ChunkSection.lockToTarget} is set.
   */
  plane?: Plane;
  /**
   * Lock the plane to the CAMERA, this many metres in front of it and facing it,
   * so everything NEARER than that is cut away.
   *
   * ⭐ Moving the camera is then the interaction: orbit to choose the angle, dolly
   * in to drive the cut through the block. It needs no gizmo, no pointer handling
   * and no widget to hit, which is what makes it better than a draggable plane.
   *
   * The plane is built in world space and transformed into the stack's frame, so
   * it is exact under a vertical exaggeration. `plane` is ignored while this is
   * set, but the stack still publishes the resulting plane, so the debug view (and
   * anything else) sees the same one.
   *
   * ⚠️ Ignored while {@link ChunkSection.lockToTarget} is on, which anchors the
   * plane on the camera TARGET instead of at a distance from the eye.
   */
  cameraDistance?: number;
  /**
   * Anchor the camera-locked plane on the camera TARGET — the orbit pivot — so it
   * passes through that point, still facing the camera. Default false.
   *
   * ⭐ Orbiting then swings the cut about the pivot and dollying does NOT move it:
   * you can zoom right into the cut face to read it without the cut running away
   * through the block, which is what makes {@link ChunkSection.cameraDistance}
   * hard to inspect closely. Flying to a point puts the cut on that point.
   *
   * ⚠️ The target comes from the default camera controls (`state.controls`), so
   * this needs controls with `makeDefault` that expose a target (`CameraControls`,
   * `OrbitControls`). Without them it falls back to `cameraDistance` in front of
   * the eye, silently.
   */
  lockToTarget?: boolean;
  /**
   * Keep a camera-locked plane VERTICAL: it takes the camera's heading but never
   * its dip. Default true, and only meaningful together with
   * {@link ChunkSection.cameraDistance} or {@link ChunkSection.lockToTarget}.
   *
   * ⭐ A section is conventionally drawn on a vertical plane, and a cut that tilts
   * with the camera makes the block appear to shear as you orbit — the geology
   * stops being readable, which is the whole point of the view. Off gives the
   * literal view-aligned cut, which is worth having but is an effect rather than a
   * tool.
   *
   * ⚠️ `cameraDistance` is then a HORIZONTAL distance, measured in plan. Under
   * {@link ChunkSection.lockToTarget} the plane still passes through the target,
   * standing vertically on it.
   */
  vertical?: boolean;
  /**
   * Draw the section. Default true. Toggling it is free — the build payload the
   * cut face needs is requested by the section's PRESENCE, so switching it off
   * does not throw the geometry away.
   */
  enabled?: boolean;
  /**
   * Metres to move the cut face toward the KEPT side, so the same test that cuts
   * the block does not cut the face closing it. Default 0.05.
   */
  offset?: number;
  /**
   * Cut the sea too (see `ChunkStackProps.water`). Default FALSE.
   *
   * ⭐ Off by default because the sea FRAMES the block: an intact water surface
   * over an opened column reads immediately as a field seen in section, while a
   * sea cut in half alongside it mostly reads as missing. Turn it on when the
   * water column itself is the subject.
   *
   * ⚠️ Changing it rebuilds the two ocean materials (the cut is a define).
   */
  water?: boolean;
  /**
   * Cut the column's floor too (see `ChunkStackProps.carrier`). Default FALSE, so
   * the block stands on an intact base plate — which is the other half of the
   * frame, and what stops the cut reading as a hole.
   */
  carrier?: boolean;
  /**
   * Draw where the plane is: its outline through the stack's bounds, and its
   * centre. Always on top, and never an event emitter.
   */
  debug?: boolean;
};

/** Default {@link ChunkSection.offset}. @group Components */
export const DEFAULT_SECTION_OFFSET = 0.05;

/** Default {@link ChunkFence.cellSize}, in metres. @group Components */
export const DEFAULT_FENCE_CELL_SIZE = 50;

/** Default {@link ChunkFence.resolution}, in metres. @group Components */
export const DEFAULT_FENCE_RESOLUTION = 10;

/** Floor for {@link ChunkFence.autoDeadband}, in metres. @group Components */
export const DEFAULT_FENCE_AUTO_DEADBAND = 50;

/** Default {@link ChunkFence.autoSettle}, in seconds. @group Components */
export const DEFAULT_FENCE_AUTO_SETTLE = 0.2;

/**
 * Open a stack along a **fence** — a vertical surface swept along a curve in plan,
 * normally a wellbore's trajectory, run out past both ends of the well so it
 * reaches clear of the block.
 *
 * ⭐ Mutually exclusive with {@link ChunkSection}: both cut, and two cuts at once
 * say less than one.
 *
 * ⭐⭐ Why it is cheap enough to drive from a selection: a fence is VERTICAL, so
 * what it removes depends on XZ alone. That is one number per vertex, which the
 * shader reads as a varying and the CPU contours to build the cut face — no
 * rebuild, no worker, and nothing per frame once it has settled.
 *
 * @group Components
 */
export type ChunkFence = {
  /** Wellbore to follow. */
  wellbore?: string;
  /**
   * Which half is taken AWAY: 1 removes the half the fence curve's left normal
   * points into, walking the well from head to terminal depth.
   *
   * ⭐ Free to flip. Both halves are built up front, so this swaps a texture and a
   * curve rather than rebuilding anything.
   *
   * ⭐⭐ `'auto'` keeps the CAMERA in the open half, which is the only half the cut
   * face can be seen from — orbit past the fence and the block changes sides so the
   * section stays readable. See {@link ChunkFence.autoDeadband}.
   */
  side?: 1 | -1 | 'auto';
  /**
   * Metres the camera must clear the cut by before `side: 'auto'` flips, in the
   * stack's own frame. Default `max(margin, 50)`.
   *
   * ⚠️ Anti-flicker only. An orbit crosses the fence exactly where the two halves
   * are equally good, and a plan view looks straight down it, so without a little
   * slack a jitter there would toggle the whole block.
   */
  autoDeadband?: number;
  /**
   * Seconds the camera must stay clear before `side: 'auto'` acts on it. Default
   * 0.2 — long enough to ignore a fly-through, short enough to feel immediate.
   */
  autoSettle?: number;
  /**
   * Metres of clearance kept between the trajectory and the cut. Default 0, which
   * puts the face through the well itself.
   *
   * ⭐ Raise it to leave room for what is drawn IN the hole — casings, completion,
   * logs — which a cut through the trajectory would slice in half.
   *
   * ⚠️ Baked into the curve, so changing it rebuilds the fence (not the chunks).
   * It also sets how smooth the curve has to be: an offset folds wherever the curve
   * turns tighter than the offset itself.
   */
  margin?: number;
  /** How the run-outs continue past the ends of the well. Default 'straight'. */
  extension?: FenceExtensionMode;
  /** Draw the cut. Default true. */
  enabled?: boolean;
  /**
   * Metres to move the cut face toward the KEPT side. Default 0.
   *
   * ⚠️ Normally leave at 0: a fence's face is drawn with a material that is NOT
   * cut, so it needs no nudge to escape its own test. A small NEGATIVE value pushes
   * it slightly proud, which is the way to hide a seam if one shows.
   */
  offset?: number;
  /**
   * Spacing the cut face is built at, in metres. Default 10.
   *
   * ⭐ The face is a ribbon along the curve, INDEPENDENT of the tessellation, so
   * this alone sets its smoothness.
   */
  resolution?: number;
  /**
   * Cut the sea too. Default FALSE — see {@link ChunkSection.water}, which this
   * mirrors: the intact sea is what makes an opened column read as a section.
   */
  water?: boolean;
  /** Cut the column's floor too. Default FALSE — see {@link ChunkSection.carrier}. */
  carrier?: boolean;
  /**
   * Draw the cut face as a bright wireframe instead of as rock, so the ribbon the
   * fence actually generated can be seen on its own.
   */
  debug?: boolean;
};

/**
 * The live fence, as a `ChunkStack` publishes it to its chunks.
 *
 * ⭐ Stable identity for the same reason {@link ChunkSectionState} has one: the
 * context's identity is what every chunk's build spec derives from.
 *
 * ⭐⭐ The CURVE lives here, not in each chunk. It is the same for every chunk of
 * the stack, and deriving it per chunk meant repeating the most expensive step of
 * the whole feature once per chunk with identical inputs.
 */
export type ChunkFenceState = {
  /** the cut curve for the current side, resampled at `resolution` */
  curve: Vec2[] | null;
  /** arc length at the curve's first vertex, for the face's `u` */
  alongOffset: number;
  /** the field the shader cuts by, or `null` until the trajectory has resolved */
  field: FenceField | null;
  /**
   * The EXACT boundary lookup, paired with `field`.
   *
   * ⭐ What the immersion fog asks whether the camera is standing in the half that
   * was taken away. The field alone would answer a fraction of a cell out, which is
   * metres — enough for the fog to switch on before the cut visually reaches you.
   */
  index: FenceSegmentIndex | null;
  side: 1 | -1;
  offset: number;
  resolution: number;
  enabled: boolean;
  debug: boolean;
};

/**
 * The live section, as a `ChunkStack` publishes it to its chunks: a STABLE object
 * the stack refreshes from the props once per frame.
 *
 * ⭐ Stable identity is the point. The caller naturally writes
 * `section={{ plane, enabled }}`, which is a new object every render, and the
 * stack context's identity is what every chunk's build spec derives from — so
 * publishing the prop itself would rebuild every chunk on any parent render.
 * Nothing here is read during React rendering; it is all read from `useFrame`.
 *
 * @group Components
 */
export type ChunkSectionState = {
  /** the stack's own copy of {@link ChunkSection.plane} */
  plane: Plane;
  enabled: boolean;
  offset: number;
};

/**
 * Depth over which a {@link ChunkWaterTint.bedTint} builds up when the water names
 * no {@link ChunkWaterTint.bedTintDepth} of its own. Shallow enough that a shoreline
 * reads as one.
 *
 * @group Components
 */
export const DEFAULT_BED_TINT_DEPTH = 80;

/**
 * Target lid resolution (metres) used when the sea displaces its vertices and
 * names no {@link StackWater.resolution} of its own. Coarse enough that a
 * field-sized footprint stays affordable, fine enough for the long swells that
 * are the only ones displaced.
 *
 * @group Components
 */
export const DEFAULT_WATER_RESOLUTION = 100;

/** Whether a {@link ChunkLayer.fill} asks for a volume at all. */
export function hasFill(fill: ChunkLayer['fill']): boolean {
  return fill !== undefined && fill !== null && fill !== false;
}

/** Whether a layer holds a volume below it. */
export function chunkLayerFill(layer: ChunkLayer): boolean {
  return hasFill(layer.fill);
}

/**
 * Fallback per-layer colour, cycled by layer order.
 *
 * ⚠️ Lives here rather than in `ChunkMeshes` because a chunk drawing a horizon on
 * a NEIGHBOUR's behalf has to resolve that neighbour's colour the same way.
 */
export const DEFAULT_PALETTE = [
  '#4e79a7',
  '#f28e2c',
  '#59a14f',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
  '#edc949',
  '#9c755f',
];

/**
 * Turn the grouped form (each inner array a zone, walls only within a zone) into
 * the ordered layer list `Chunk` takes: every layer fills down to the next, except
 * the last of each group, which leaves the gap to the next group open.
 *
 * @group Components
 */
export function layersFromGroups(groups: SurfaceMeta[][]): ChunkLayer[] {
  return groups.flatMap(group =>
    group.map((surface, i) => ({ surface, fill: i + 1 < group.length })),
  );
}

/**
 * How a chunk's stack is made monotone, and what is dropped where a unit is not
 * present. Omit `ChunkResolveOptions` entirely to skip the pass.
 *
 * @group Components
 */
export type ChunkResolveOptions = {
  /**
   * `'truncate'` (default) marks a unit ABSENT wherever it had to be pushed down,
   * so the (now redundant) welded surface is dropped rather than drawn.
   * `'clamp'` keeps it, which is only useful for comparison.
   */
  mode?: 'clamp' | 'truncate';
  /**
   * Minimum separation kept between adjacent surfaces, in world units. Default 0
   * — on a shared tessellation zero is safe, and a positive gap gives every
   * pinch-out an artificial thickness.
   */
  minGap?: number;
  /**
   * Thickness below which a unit counts as absent and its triangles are dropped.
   * Default 0.5; `0` disables the thickness test.
   */
  collapseThreshold?: number;
  /**
   * Drop triangles where a layer has no data of its own (a surface mapped over a
   * smaller area than the chunk is ABSENT out there, not flat). Default true.
   */
  coverageAbsence?: boolean;
  /**
   * Refine the tessellation along the lines where a unit wedges out, so the
   * dropped area follows the pinch-out instead of the nearest edges the height
   * refinement happened to leave there. Default true; costs vertices along those
   * lines only. Turn off to see what it is buying.
   */
  refineTerminations?: boolean;
  /**
   * Constrain each layer's DATA boundary into the shared tessellation, so a
   * triangle is either wholly inside a layer's survey or wholly outside it.
   * Default false.
   *
   * ⭐ Without it the boundary is only a per-vertex mask, so a triangle spanning
   * it has to be resolved one way or the other: the rule keeps the drawn area
   * inside the mapped one, which leaves a bite up to a triangle deep, and a comb
   * of slivers where the edge runs at an angle to the mesh.
   *
   * ⚠️ Costs vertices along every partly-mapped layer's boundary, and the
   * tessellation is shared by the whole stack.
   */
  constrainCoverage?: boolean;
  /**
   * Node budget for the stack's common grid — the ⭐ **quality/speed dial** for
   * the whole build. Default `DEFAULT_STACK_MAX_NODES` (4,000,000).
   *
   * Every layer is resampled onto one grid derived from the finest layer's,
   * cropped to the outline; when that window exceeds this budget it is decimated
   * by an integer step. Fetching aside, essentially all of the build's cost —
   * resample, seal, depth-order resolve and the per-layer refinement — is linear
   * in the node count, so halving the budget quarters it.
   *
   * ⚠️ What it costs is RESOLUTION, and unevenly. Heights barely suffer (the TIN
   * is error-bounded by `maxError` either way, and a horizon is smooth at field
   * scale), but the coverage MASKS coarsen with it, so data edges, interior holes
   * and pinch-out contours are resolved to the coarser cell. Reported as
   * `referenceNodes` / `referenceStep` in the build diagnostics — a step above 1
   * means the trade is active.
   *
   * ⚠️ It is part of the shared column's cache key, so changing it rebuilds every
   * chunk of the stack.
   */
  maxNodes?: number;
  /**
   * How far a layer counts as covered past its own data, in METRES. Default
   * {@link DEFAULT_CHUNK_MAX_FILL}; `0` counts only real data.
   *
   * A grid is incomplete in two ways: it has interior holes, and the area it was
   * actually mapped over is smaller than its rectangle. Both are filled from the
   * nearest real sample so the surface stays continuous, and this decides how far
   * that fill is trusted. Below the threshold a hole is bridged and the chunk
   * carries on across it; beyond it the layer stays absent there, so its
   * triangles are dropped or the outline is cut back, as before.
   *
   * It behaves as an EROSION RADIUS rather than a size test — a hole of radius `r`
   * disappears at `maxFill = r`, and a larger one merely loses a rim of that width
   * — which is what lets one value cope with holes spanning orders of magnitude.
   *
   * ⚠️ Coverage bought this way IS fill — a plausible extrapolation, not
   * knowledge. It is reported per layer in the build diagnostics so the trade
   * stays visible.
   */
  maxFill?: number;
  /**
   * Close the block where a surface is not mapped, by tapering it toward its
   * neighbours. Default `true`.
   *
   * Without it, every interval bounded by an unmapped surface simply disappears
   * while the surfaces above and below it are still drawn — a cap left floating
   * over a floor with open space between. Sealing asserts something about that
   * space, which is unavoidable: the alternative is a block with holes in it.
   *
   * ⚠️ Sealing invents geometry, so it overrides `coverageAbsence` (which would
   * drop the wedge again) and the coverage trim (which would cut the outline back
   * to the very area the wedge covers). The inferred share is reported per layer.
   */
  seal?: boolean;
  /**
   * How the space an unmapped surface cannot account for is closed —
   * `'proportional'` (default) keeps its relative depth between its neighbours,
   * `'void'` splits it in two and leaves the space between EMPTY. See `SealMode`.
   */
  sealMode?: SealMode;
  /**
   * How much of a neighbouring unit a seal must leave standing, in metres.
   * Default `TAPER_MIN_THICKNESS`.
   *
   * This is the only setting the shape of a seal has: how far it reaches is
   * derived from the size of the gap it is closing, inside the chunk's own
   * footprint. Raise it to hold the taper further off its neighbours.
   *
   * ⚠️ Keep it above `collapseThreshold`, or the sliver the seal leaves is
   * dropped for having no thickness and the hole it closed comes back.
   */
  minThickness?: number;
};

/**
 * Default {@link ChunkResolveOptions.maxFill}, in metres.
 *
 * Chosen against the demo field, whose interior holes are 0.06–0.23 km² (a radius
 * of 140–270 m) apart from three far larger ones: small enough to leave those
 * alone, large enough to bridge the everyday ones. It is one dataset, so treat it
 * as a starting point rather than a constant of nature.
 *
 * ⚠️ Applies even when `resolve` is omitted — the common grid is built either
 * way, and how far its fill is trusted is a property of that grid rather than of
 * the depth-order pass.
 *
 * @group Components
 */
export const DEFAULT_CHUNK_MAX_FILL = 250;

/**
 * The COLUMN a chunk belongs to. When given, the generator builds the common grid,
 * fetches and resolves **once for the whole stack** and caches it, so every chunk
 * cut from the same column shares that work — and, more importantly, agrees with
 * the others about depth order.
 *
 * Without it a chunk resolves only its own layers, so two chunks can still cross
 * each other where their footprints overlap.
 *
 * @group Components
 */
export type SurfaceChunkStackSpec = {
  /** every layer of the column, shallowest first (the chunk's own layers included) */
  layers: SurfaceChunkLayerSpec[];
  /**
   * The stack's ENVELOPE footprint — it must contain every chunk's outline, since
   * it defines the common grid they all sample. Plain coordinates + offset.
   */
  polygon: { coordinates: PlanarPolygonCoordinates; offset: Vec2 };
  /**
   * A flat floor closing the whole column, appended below its deepest surface.
   * Nothing pierces it: anything that would is truncated at it.
   *
   * ⭐ Declared on the COLUMN rather than per chunk so that a horizon and the
   * floor beneath it are resolved against each other ONCE — which is also what
   * gives the column's deepest surface a neighbour below it, so sealing it no
   * longer falls back to the one-neighbour rule.
   */
  carrier?: StackCarrier;
  /** identity of the stack, so chunks of the same column hit the same cache entry */
  key: string;
};

/**
 * Serializable input to the {@link surfaceChunk} generator — everything needed to
 * build a `SurfaceChunk` in a worker except the grid values (fetched by the worker
 * from the surface ids). `PlanarPolygonGeometry` is passed as plain coordinates +
 * offset and reconstructed in the worker.
 */
export type SurfaceChunkSpec = {
  /**
   * The chunk's boundaries in stratigraphic order (shallowest first). Each also
   * says whether the interval BELOW it is filled.
   */
  layers: SurfaceChunkSpecLayer[];
  /** shared mask polygon (scene XZ) as plain coordinates + offset */
  polygon: { coordinates: PlanarPolygonCoordinates; offset: Vec2 };
  /**
   * Outline of whatever is drawn directly ABOVE this chunk (the neighbouring
   * chunk that draws the surface this chunk's top layer was truncated against).
   * Where it does not reach, the truncated-away top fragments are kept rather than
   * dropped — there is nothing above to hide them behind, so dropping them would
   * open a hole into the block. Only meaningful together with `stack`.
   */
  coverAbove?: { coordinates: PlanarPolygonCoordinates; offset: Vec2 };
  /**
   * Footprints of neighbouring chunks this one only PARTLY overlaps, referenced
   * per layer by {@link SurfaceChunkSpecLayer.capCuts}. Each carries the rim
   * spacing its owner densified it with — ⚠️ densifying it differently would put
   * the two boundaries on different points of the reference grid, and the seam
   * would open a hairline crack.
   */
  cuts?: SurfaceChunkCut[];
  /** the column this chunk is cut from (see {@link SurfaceChunkStackSpec}) */
  stack?: SurfaceChunkStackSpec;
  /**
   * The column's carrier plane, repeated here so a chunk built WITHOUT a shared
   * column can still terminate against it. Same declaration as
   * {@link SurfaceChunkStackSpec.carrier}.
   */
  carrier?: StackCarrier;
  /** rim densification spacing (world units) */
  rimSpacing?: number;
  /** interior simplification error (grid height units) */
  maxError?: number;
  /** see {@link ChunkResolveOptions} — omit to skip the depth-order pass */
  resolve?: ChunkResolveOptions;
  /**
   * Also return the channels a clip plane's cut face is built from (see
   * `SurfaceChunk.section`). Requested by the presence of a section on the
   * enclosing `ChunkStack`, NOT by whether one is currently enabled — the payload
   * is part of the build, so making it follow a toggle would rebuild the geometry
   * every time the section is switched on or off.
   */
  section?: boolean;
  /**
   * Also return each cap as it would be if nothing ABOVE it were drawn (see
   * `SurfaceChunkMesh.peelIndex`). Requested when the chunk can PEEL or the stack
   * has a section — both hide a covering layer, and the collapse dropped
   * fragments on the strength of that cover.
   */
  peelable?: boolean;
};

/**
 * A neighbouring chunk's footprint, carried into the build so this chunk's cap can
 * stop exactly where that chunk's begins.
 */
export type SurfaceChunkCut = {
  coordinates: PlanarPolygonCoordinates;
  offset: Vec2;
  /** the spacing its OWNER densified it with */
  rimSpacing?: number;
};

/** Response from the {@link surfaceChunk} generator (packed for transfer). */
export type SurfaceChunkResponse = PackedSurfaceChunk;
