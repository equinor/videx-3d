import { Material } from 'three';
import {
  PackedSurfaceChunk,
  PlanarPolygonCoordinates,
  StackRelief,
  SurfaceChunkBasement,
  SurfaceClipHeader,
  SurfaceMeta,
  Vec2,
} from '../../sdk';

/** Generator key for the {@link Chunk} geometry generator. */
export const surfaceChunk = 'surfaceChunk';

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
   * Draw this layer's cap. Default true; `false` keeps the layer in the stack but
   * draws no surface (a neighbouring chunk draws that horizon).
   */
  cap?: boolean;
  /**
   * Do not cut this chunk's outline back to this layer's data extent. Default
   * false. Where the layer has no data the interval it bounds pinches out.
   */
  optional?: boolean;
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
   */
  fill?: string | Material | boolean | null;
  /**
   * Draw this layer's cap. Default `true`.
   *
   * Set `false` where a NEIGHBOURING chunk already draws this horizon — two chunks
   * that meet share their boundary surface, and drawing it twice means two
   * independent tessellations of the same horizon fighting for the same pixels.
   * The layer still takes part fully: its rim carries the walls and it is still
   * resolved against its neighbours.
   *
   * The chunk with the LARGER footprint should be the one that keeps its cap.
   */
  cap?: boolean;
  /**
   * Keep this layer's data extent from cutting the chunk's outline back. Default
   * `false`.
   *
   * A chunk is trimmed to where ALL of its layers are mapped, because inside that
   * footprint nothing is ever drawn on a fabricated height. That is the right rule
   * for the layers a chunk is ABOUT, and the wrong one for a boundary it merely
   * BORROWS from the chunk next to it: a detail chunk whose own surfaces are mapped
   * everywhere should not shrink to the extent of the survey that happens to define
   * its floor.
   *
   * Marked optional, the layer no longer trims the outline, and where it has no
   * data of its own the interval it bounds is given zero thickness and dropped —
   * so the chunk stops where its knowledge stops instead of resting on a flat
   * extrapolation of a survey edge.
   *
   * Its coverage is still reported in the build diagnostics, so the trade stays
   * visible.
   */
  optional?: boolean;
};

/** Whether a {@link ChunkLayer.fill} asks for a volume at all. */
export function hasFill(fill: ChunkLayer['fill']): boolean {
  return fill !== undefined && fill !== null && fill !== false;
}

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
   * How much of a chunk's outline survives where the layers are not all mapped.
   * The outline is cut back to the covered area (see `trimPolygonToCoverage`), and
   * this decides what "covered" means: `'all'` (default) every layer, `'any'` at
   * least one. `'all'` is self-consistent — inside the result nothing is drawn on
   * hole fill and every wall runs between two known surfaces.
   */
  coverageRule?: 'all' | 'any';
  /**
   * Refine the tessellation along the lines where a unit wedges out, so the
   * dropped area follows the pinch-out instead of the nearest edges the height
   * refinement happened to leave there. Default true; costs vertices along those
   * lines only. Turn off to see what it is buying.
   */
  refineTerminations?: boolean;
  /**
   * Node budget for the stack's common grid; beyond it the grid is decimated.
   * Caps both memory and tessellation cost. Default 4,000,000.
   */
  maxNodes?: number;
};

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
  /** the column this chunk is cut from (see {@link SurfaceChunkStackSpec}) */
  stack?: SurfaceChunkStackSpec;
  /** rim densification spacing (world units) */
  rimSpacing?: number;
  /** interior simplification error (grid height units) */
  maxError?: number;
  /** see {@link ChunkResolveOptions} — omit to skip the depth-order pass */
  resolve?: ChunkResolveOptions;
  /** optional basement block */
  basement?: SurfaceChunkBasement;
};

/** Response from the {@link surfaceChunk} generator (packed for transfer). */
export type SurfaceChunkResponse = PackedSurfaceChunk;
