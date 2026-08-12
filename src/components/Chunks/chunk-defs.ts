import { Material } from 'three';
import {
  PackedSurfaceChunk,
  PlanarPolygonCoordinates,
  SealMode,
  StackCarrier,
  StackRelief,
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
   * This layer is the column's CARRIER — the flat floor declared once on the
   * `ChunkStack` (see `ChunkStackProps.carrier`), drawn by whichever chunk closes
   * the block. `surface`, `depth`, `offset` and `relief` are all ignored: the
   * plane is the column's, so every chunk that draws it draws the same one.
   *
   * ⭐ It is a terminator, not a unit — there is no interval below it, so `fill`
   * has no meaning here and the cap defaults to the fill of the unit ABOVE it,
   * which is the only side of it that is ever seen.
   *
   * ⚠️ Must be the chunk's LAST layer, and is dropped entirely when the stack
   * declares no carrier.
   */
  carrier?: boolean;
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
};

/** Whether a {@link ChunkLayer.fill} asks for a volume at all. */
export function hasFill(fill: ChunkLayer['fill']): boolean {
  return fill !== undefined && fill !== null && fill !== false;
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
   * Node budget for the stack's common grid; beyond it the grid is decimated.
   * Caps both memory and tessellation cost. Default 4,000,000.
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
