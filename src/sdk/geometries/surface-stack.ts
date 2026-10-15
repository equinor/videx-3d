import { Vec2 } from '../types/common';
import { sampleValidGrid } from './grid-sampling';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';
import { evaluateRelief, StackRelief } from './procedural-relief';
import {
  gridToGridTransform,
  SurfaceClipHeader,
  surfaceGridToWorld,
  surfaceWorldToGrid,
} from './surface-grid';
import { surfaceGridBounds } from './surface-clip';
import {
  collectStackCandidateLevels,
  collectStackCandidates,
  STACK_NO_DATA,
} from './surface-stack-candidates';
import { TERMINATION_TOLERANCE } from './surface-stack-terminations';
import {
  layEmptyStackLayers,
  resampleStackLayer,
  STACK_MASK_DATA,
  STACK_MASK_FILLED,
  StackGridPlacement,
  StackReferencePlan,
} from './surface-stack-resample';
import {
  refineStackSeam,
  StackTileChain,
  StackTileInput,
  StackTileOutput,
  stitchStackTiles,
  tessellateStackTile,
} from './stack-tiles';
import {
  GRID_NODE_TOUCH,
  GridPolygon,
  GridRing,
  makeGridInside,
  nodeGridRings,
  traceMaskBoundary,
} from './triangulate-grid-delaunay';

/**
 * A layer entering a shared-tessellation stack from an elevation GRID: the
 * samples plus how to place them.
 *
 * @group Geometries
 */
export type StackGridLayer = {
  /** row-major elevation grid of length `header.nx * header.ny` */
  values: Float32Array;
  /** grid geometry */
  header: SurfaceClipHeader;
  /**
   * Depth-normalization reference (`SurfaceMeta.max`). Samples encode
   * `value = referenceDepth - trueDepth`, so scene `y = value - referenceDepth`.
   */
  referenceDepth: number;
  /** scene XZ of the grid origin (default `[0, 0]`) */
  worldPosition?: Vec2;
  /** value marking a missing sample (default -1) */
  nullValue?: number;
};

/**
 * A layer with no data behind it — a plane, optionally perturbed by a procedural
 * relief field.
 *
 * This is what makes water, a procedural sea bed and a basement floor ordinary
 * members of the stack rather than special cases bolted on beside it: each gets
 * the same shared tessellation, the same monotone guarantee, the same walls and
 * the same collapse.
 *
 * The base is either ABSOLUTE (`depth` below sea level, positive-down, matching
 * how surfaces are given) or RELATIVE (`offset` below the layer above it).
 *
 * @group Geometries
 */
export type StackSyntheticLayer = {
  /** metres below sea level (positive-down). `0` is sea level. */
  depth?: number;
  /**
   * Metres below the layer ABOVE this one — a floor that follows whatever it
   * hangs from. Ignored when `depth` is given, and meaningless on the first layer
   * (there is nothing above it to hang from).
   */
  offset?: number;
  /** optional procedural perturbation of the base plane */
  relief?: StackRelief;
};

/**
 * A layer entering a shared-tessellation stack: an elevation grid, or a synthetic
 * plane.
 *
 * @group Geometries
 */
export type StackLayer = StackGridLayer | StackSyntheticLayer;

/** Whether a stack layer is synthetic (has no grid behind it). */
export function isSyntheticLayer(
  layer: StackLayer,
): layer is StackSyntheticLayer {
  return (layer as StackGridLayer).values === undefined;
}

/**
 * Fill a channel for a synthetic layer over the common grid, in scene Y.
 *
 * Shared by `buildStackReference` and the chunk generator's shared-column path so
 * the two cannot drift — `offset` in particular depends on the layer above, so the
 * evaluation order is part of the contract.
 *
 * @param previous the channel of the layer above, for `offset`. Without it an
 *   `offset` layer has nothing to hang from and `null` is returned.
 *
 * @group Geometries
 */
export function buildSyntheticChannel(
  header: SurfaceClipHeader,
  worldPosition: Vec2,
  layer: StackSyntheticLayer,
  previous: Float32Array | null,
): Float32Array | null {
  const { nx, ny } = header;
  const count = nx * ny;
  const out = new Float32Array(count);

  if (layer.depth !== undefined) {
    out.fill(-layer.depth);
  } else if (layer.offset !== undefined) {
    if (!previous) return null;
    for (let n = 0; n < count; n++) out[n] = previous[n] - layer.offset;
  } else {
    return null;
  }

  if (layer.relief) {
    const toWorld = surfaceGridToWorld(header, worldPosition);
    for (let row = 0; row < ny; row++) {
      for (let col = 0; col < nx; col++) {
        const [x, z] = toWorld(col, row);
        out[row * nx + col] += evaluateRelief(layer.relief, x, z);
      }
    }
  }
  return out;
}

/**
 * Every layer of a stack resampled onto ONE common grid, in **scene Y** (metres,
 * upwards-positive) rather than the layers' own reference-relative encoding.
 *
 * This is the domain the shared tessellation lives in: one `(column, row)` space
 * that all layers agree on, so a single triangulation can serve the whole stack.
 *
 * @group Geometries
 */
export type StackReference = {
  /** grid geometry of the common domain */
  header: SurfaceClipHeader;
  /** scene XZ of the common domain's grid origin */
  worldPosition: Vec2;
  /**
   * Per layer: scene Y at every node. Holes and the area outside a layer's own
   * data extent are filled from the nearest valid sample, so the grid is
   * continuous everywhere (no cliffs for the triangulator to chase); use
   * {@link StackReference.masks} to tell real data from fill.
   */
  channels: Float32Array[];
  /**
   * Per layer, the layer's EFFECTIVE extent at every node:
   * {@link STACK_MASK_NONE}, {@link STACK_MASK_DATA} or {@link STACK_MASK_FILLED}.
   *
   * Every consumer that only asks "is this covered?" can keep testing the value
   * for truth; the distinction exists so that coverage bought by
   * {@link StackReferenceOptions.maxFill} can be reported rather than silently
   * counted as data.
   */
  masks: Uint8Array[];
  /** how many source grid cells one reference cell spans (1 = full resolution) */
  step: number;
};

/** {@link StackReference.masks}: the layer has no extent at this node. */
export {
  layEmptyStackLayers,
  resampleStackLayer,
  STACK_MASK_DATA,
  STACK_MASK_FILLED,
  STACK_MASK_NONE,
} from './surface-stack-resample';
export type {
  StackGridPlacement,
  StackLayerResample,
  StackReferencePlan,
} from './surface-stack-resample';

/**
 * Default node budget for the common grid — see
 * {@link StackReferenceOptions.maxNodes}. At 25 m cells this is a 50 x 50 km
 * window at full resolution.
 */
export const DEFAULT_STACK_MAX_NODES = 4_000_000;

/** Options for {@link buildStackReference}. */
export type StackReferenceOptions = {
  /** extra cells kept around the mask's bounding box. Default 2 (matches the clip). */
  margin?: number;
  /**
   * Node budget for the common grid. When the mask window exceeds it the grid is
   * decimated by an integer step, which caps both memory
   * (`nodes * layers * 4` bytes) and tessellation cost. Default 4,000,000.
   */
  maxNodes?: number;
  /**
   * How far a layer's coverage may extend past its own data, in METRES. Default
   * unbounded — the mask is then real data only, and every filled node stays
   * absent.
   *
   * Values are filled everywhere regardless (the triangulator chases
   * discontinuities, so a cliff at a data edge is expensive); what this bounds is
   * the MASK, i.e. how far out the fill is treated as knowledge. That makes a
   * surface's extent a matter of degree: an interior hole a few cells across is
   * bridged, while the space past the edge of a survey — or a hole kilometres
   * wide — stays absent and is dropped or trimmed as before.
   *
   * One threshold covers both, because they are the same measurement seen from
   * two sides. In metres rather than cells so it is independent of grid
   * resolution and of the decimation `maxNodes` may apply.
   */
  maxFill?: number;
};

/** The shared tessellation produced by {@link tessellateStack}. */
export type StackTessellation = {
  /** vertex `(column, row)` coordinates in the reference grid, xy interleaved */
  coords: Float32Array;
  /** triangle indices, shared by every layer */
  indices: Uint32Array;
  /** vertex indices along each rim ring, in ring order */
  rimVertices: number[][];
  /**
   * Per CUT outline (see the `cuts` argument of {@link tessellateStack}), one flag
   * per triangle: 1 where that outline contains the triangle.
   *
   * ⚠️ Containment, NOT a partition — two chunks whose footprints overlap both
   * contain the triangles in the overlap, which is the truth. Which of them draws
   * there is decided before the build (`documents/chunks.md` §10.1.9); this only
   * reports where the other one reaches. Exact rather than approximate because a
   * cut is CONSTRAINED, so no triangle straddles it.
   */
  cuts?: Uint8Array[];
  /**
   * Per LAYER, one flag per triangle: 1 where the triangle lies inside that
   * layer's own data extent. Present only when the boundaries were constrained
   * (see the `constrainCoverage` argument of {@link tessellateStack}), which is
   * what makes the test EXACT — no triangle straddles a data edge, so a whole
   * triangle is either mapped or not, and the drop rule no longer has to choose
   * between spilling past the survey and biting into it.
   */
  coverage?: Uint8Array[];
  /** vertices the constrained coverage boundaries added */
  coverageRingPoints?: number;
  /** vertices of the constrained termination lines (see `tessellateStack`) */
  terminationRingPoints?: number;
  /**
   * Per pair, in the order the `terminations` were given: the vertices lying on
   * that pair's constrained line (repeats possible), or `null` where none reach.
   */
  terminationVertices?: (Uint32Array | null)[];
  /**
   * Rim vertices that ended up in NO kept triangle and are therefore missing from
   * `rimVertices`.
   *
   * ⚠️ Should be 0. The walls are built from the rim rings, so a dropped vertex
   * makes the wall cut a straight chord across the gap while the SURFACE boundary
   * still follows the real triangle edges — the surface then juts out past the
   * wall. For a simple polygon it cannot happen (every rim vertex has interior
   * triangles), so a non-zero count means the outline has a zero-area spike or
   * crosses itself.
   */
  rimDropped: number;
  /**
   * Constraint edges the triangulator could not enforce (see
   * `Delatin.constraintFailures`). ⚠️ Should be 0 — non-zero means a rim or a cut
   * does NOT follow mesh edges, so a boundary drawn from it is a claim the mesh
   * does not support.
   */
  constraintFailures: number;
  /** how it was tiled, when it was (see {@link planStackTessellation}) */
  tiling?: StackTiling;
  /** per tile, where its triangles start in `indices` (in triangles; one past the end last) */
  tileStarts?: Uint32Array;
  /**
   * Coarser levels of detail, when asked for (see {@link StackTessellationLod}),
   * each its own triangles over `coords` — which then also holds the vertices
   * only a coarser level uses, where its thinned pinch-out lines cross.
   */
  levels?: StackTessellationLevel[];
  /**
   * Vertices only a coarser level puts on the outline — a thinned line crossing
   * it somewhere new — each on an outline edge of the full level, which the walls
   * follow: `ends` holds that edge (two per vertex), `along` where on it (0..1).
   * Their heights are taken along it, so a coarse cap meets the walls.
   */
  outlineBlends?: {
    vertices: Uint32Array;
    ends: Uint32Array;
    along: Float64Array;
  };
};

/**
 * Coarser levels of detail to build with a tessellation (see
 * {@link StackTessellation.levels}). Each keeps the rim, cuts, data edges and
 * tile seams of the full tessellation — so tiles at different levels still meet
 * — and has fewer refinement nodes and thinned pinch-out lines.
 *
 * @group Geometries
 */
export type StackTessellationLod = {
  /** per coarser level, ascending: the height error it is simplified to */
  errors: number[];
  /**
   * Per layer, per candidate (aligned with the `candidates` argument), its level
   * (see `collectStackCandidateLevels`). Without them every refinement node is
   * kept at every level; computed here when `candidates` is omitted.
   */
  candidateErrors?: Float32Array[];
};

/**
 * One coarser level of a {@link StackTessellation}, over its `coords`.
 *
 * @group Geometries
 */
export type StackTessellationLevel = {
  /** the height error it was simplified to */
  error: number;
  /** triangle indices, shared by every layer, tile by tile */
  indices: Uint32Array;
  /** as {@link StackTessellation.tileStarts}, for these triangles */
  tileStarts: Uint32Array;
  /** as {@link StackTessellation.cuts}, for these triangles */
  cuts?: Uint8Array[];
  /** as {@link StackTessellation.coverage}, for these triangles */
  coverage?: Uint8Array[];
  /** as {@link StackTessellation.terminationVertices}, for this level */
  terminationVertices?: (Uint32Array | null)[];
  /** as {@link StackTessellation.constraintFailures} — should be 0 */
  constraintFailures: number;
};

/** Options for {@link resolveStackOrder}. */
export type StackResolveOptions = {
  /**
   * How a violation of the stack's depth order is resolved. Default
   * `'truncate'`.
   *
   * Both modes clamp the height the same way — that is what keeps the block
   * sealed — but `'truncate'` additionally MARKS the layer as absent wherever it
   * had to be pushed down, which states the geology (the unit is not present
   * there) instead of leaving a welded duplicate surface behind. Feed the
   * returned masks to {@link collapseStackTriangles}. `'clamp'` keeps the welded
   * surface, which is only useful for comparison.
   */
  mode?: 'clamp' | 'truncate';
  /**
   * Minimum vertical separation kept between adjacent surfaces, in world units.
   * Default 0 — on a shared tessellation zero is safe: monotone vertex heights
   * stay monotone under linear interpolation, so the surfaces cannot cross even
   * where they touch.
   */
  minGap?: number;
  /**
   * Set to `false` to only measure the stack's crossings, leaving the heights
   * untouched. Default true.
   */
  apply?: boolean;
  /**
   * Per-layer data coverage at the shared vertices (see {@link sampleStackMasks}).
   * When given, the crossings are ALSO counted restricted to vertices both layers
   * actually have data for — outside a layer's own extent it is only standing on
   * the fill, so a "crossing" there says nothing about the geology.
   */
  coverage?: Uint8Array[];
  /**
   * Per layer: this boundary is a FLUID — a level inside the column rather than a
   * horizon: an oil/water contact, a gas cap, the sea.
   *
   * It is clamped by what lies above it like any other boundary, but it is never
   * the AUTHORITY: the cascade looks THROUGH it to the nearest solid layer above,
   * and orders everything below it against that one instead.
   *
   * ⭐ That asymmetry is the whole point. A contact sitting deeper than the base of
   * the unit it divides would otherwise drag the base down with it — an oil column
   * with no water leg — deforming real geology to make room for a level. Where a
   * fluid has no room, its interval simply pinches out as any unit's does.
   *
   * ⚠️ A fluid is still ORDERED. What is exempt from being truncated by the
   * surface above is {@link StackCollapseOptions.unbounded}, which is the sea and
   * nothing else.
   */
  fluid?: boolean[];
  /**
   * Per layer, its normals at the shared vertices (snorm16, 3 each), or `null`.
   * A vertex clamped onto the layer above takes that layer's normal there, as it
   * now lies on that surface.
   */
  normals?: (Int16Array | null)[];
};

/** Per-pair statistics from {@link resolveStackOrder}. */
export type StackPairStats = {
  /** index of the deeper layer of the pair */
  index: number;
  /** vertices where the deeper layer sat above the shallower one */
  crossings: number;
  /** the same, counted only where BOTH layers have data (see {@link StackResolveOptions.coverage}) */
  crossingsCovered: number;
  /** vertices both layers have data for (the whole stack when no coverage is given) */
  compared: number;
  /** deepest penetration, in world units */
  maxOverlap: number;
  /** the same, only where both layers have data */
  maxOverlapCovered: number;
  /** vertices moved by the pass */
  moved: number;
};

/** The result of {@link resolveStackOrder}. */
export type StackResolveResult = {
  pairs: StackPairStats[];
  /** total vertices moved */
  moved: number;
  /** whether the heights were actually modified (see {@link StackResolveOptions.apply}) */
  applied: boolean;
  /**
   * Per layer, per shared vertex: 1 where the layer was truncated away (it would
   * have risen above the layer over it, so the unit is not present there). All
   * zero in `'clamp'` mode. Feed to {@link collapseStackTriangles}.
   */
  absent: Uint8Array[];
};

/** Depth statistics for one layer, measured over the shared vertices. */
export type StackLayerDepth = {
  index: number;
  /** mean scene Y inside the chunk's footprint */
  meanY: number;
  /** median scene Y inside the chunk's footprint */
  medianY: number;
  minY: number;
  maxY: number;
};

/** Options for {@link collapseStackTriangles}. */
export type StackCollapseOptions = {
  /**
   * Thickness below which a unit counts as absent, in world units. Default 0.5.
   * A triangle is dropped from a layer when its distance to the layer above is
   * within this threshold at ALL THREE vertices — the two surfaces are then
   * coincident there, and drawing both is not only redundant but the one
   * remaining source of z-fighting on a shared tessellation.
   */
  threshold?: number;
  /**
   * Per-layer data coverage at the shared vertices (see
   * {@link sampleStackMasks}): 0 marks a vertex the layer has no data for. A
   * triangle with no data at all three of its vertices is dropped — the unit is
   * simply not mapped there, which is a fact about the data rather than something
   * to be inferred from a fill value.
   */
  coverage?: Uint8Array[];
  /**
   * Per layer, one flag per TRIANGLE from {@link StackTessellation.coverage}: 1
   * where the triangle lies inside the layer's data extent.
   *
   * ⭐ Supersedes `coverage` for the layers it is given for, and is EXACT: it is
   * only produced when the data boundary was constrained into the tessellation,
   * so a triangle is wholly mapped or wholly not. Without it a binary mask has to
   * be read at the corners, which either spills a layer up to a whole triangle
   * past its survey or bites the same distance out of it.
   */
  coverageTriangles?: Uint8Array[];
  /**
   * Per-layer truncation masks from {@link resolveStackOrder} in `'truncate'`
   * mode: 1 marks a vertex where the unit was cut away.
   */
  absent?: Uint8Array[];
  /**
   * Per layer: this one is the CEILING of a void — the upper copy of a surface
   * split around the space it cannot account for (see `splitVoidChannels`).
   *
   * ⭐ It inverts which of a coincident pair is dropped. Normally the deeper of
   * two welded surfaces goes, because the resolve made it by pushing a crossing
   * surface UP onto the one above, so the duplicate below is the artefact. For a
   * void pair the opposite is true: the shallower copy is the invention and the
   * deeper one is the real horizon. Outside the void the two are identical, so
   * without this the horizon is dropped and the ceiling is left standing in its
   * place — wearing the colour of the unit above it.
   */
  ceiling?: boolean[];
  /**
   * Per layer, one flag per TRIANGLE: 1 where a NEIGHBOURING chunk draws this
   * layer's cap. Two chunks that meet share a horizon, and drawing it twice means
   * two independent tessellations fighting for the same pixels.
   *
   * ⭐ It removes the CAP only. The layer keeps its rim, its walls and its place
   * in the resolve — the volume below it is this chunk's either way.
   */
  capExcluded?: (Uint8Array | null)[];
  /**
   * Index of the layer that is the stack's {@link StackCarrier} — the flat floor
   * the block terminates against.
   *
   * It reverses the usual authority for that one layer, in both directions: the
   * carrier is never dropped for having welded onto the surface above it (it is
   * what closes the block, so a hole there is a hole in the floor), and every
   * other layer IS dropped where it has been flattened onto the carrier, since
   * that is a horizon the carrier truncated away and drawing it would leave two
   * coincident surfaces.
   *
   * ⚠️ Only the surfaces go. The unit ABOVE a truncated horizon still occupies
   * the space down to the carrier, and its interval is bounded by heights, so it
   * survives — which is the difference between a block cut off flat and a block
   * with the bottom missing.
   */
  carrier?: number;
  /**
   * Per layer: this boundary is UNBOUNDED — it covers the whole footprint whatever
   * stands in its way. The sea, and nothing else.
   *
   * Its own cap is never dropped (the lid of a water body is drawn whether or not
   * an island rises through it), and the layer below it is not measured against
   * it, so ground standing above the plane is not read as a duplicate of it and
   * removed. The volume between the two is still bounded by their heights, so the
   * water body ends at the shoreline on its own.
   *
   * ⚠️ Distinct from {@link StackResolveOptions.fluid}, which every level shares:
   * a CONTACT is an ordinary boundary here — it pinches out where it has no room,
   * exactly as a unit does.
   */
  unbounded?: boolean[];
  /**
   * Also emit {@link StackCollapseResult.peelIndices} — each layer's cap as it
   * would be if nothing ABOVE it were drawn.
   *
   * ⭐ Two of the four drop reasons reference the layer above: a weld onto it, and
   * a truncation by it. Both exist only because that layer covers the fragment
   * (see the `topCover` argument), so both become invalid the moment it is hidden
   * — by a peel, or by a section that cuts it while this cap stays whole. Coverage,
   * seam exclusion and the floor/ceiling collapses reference no layer above and
   * are kept.
   *
   * OFF by default: it materialises a second index array for every layer that has
   * such drops.
   */
  peelable?: boolean;
  /**
   * Per layer `k > 0`, one flag per TRIANGLE for the pair `(k - 1, k)`: 1 where the
   * two are within `threshold` of each other. `null` (or absent) = judge that pair
   * at the corners.
   *
   * ⭐ Produced when the pair's termination line was constrained into the
   * tessellation (see {@link classifyThinTriangles}), where reading the corners is
   * ambiguous: a vertex ON the line is exactly at the threshold.
   */
  thin?: (Uint8Array | null)[];
};

/** The result of {@link collapseStackTriangles}. */
export type StackCollapseResult = {
  /** per layer: a reduced index array, or `null` when nothing was dropped */
  indices: (Uint32Array | null)[];
  /**
   * Per layer, when {@link StackCollapseOptions.peelable} asked for it: the cap
   * as it would be if nothing ABOVE this layer were drawn — `null` where that is
   * the same set as `indices`, which is the common case.
   */
  peelIndices?: (Uint32Array | null)[];
  /** per layer: triangles dropped, in total */
  dropped: number[];
  /** per layer: dropped because the unit is not present (no data / truncated) */
  droppedAbsent: number[];
  /** per layer: dropped because the unit has no thickness there */
  droppedCollapsed: number[];
  /** per layer: dropped because a neighbouring chunk draws the cap there */
  droppedExcluded: number[];
};

/** Sentinel for a node with no data — outside the range of any real depth. */
const NO_DATA = STACK_NO_DATA;

/**
 * Plan the common grid a stack will be resampled onto — the finest layer's grid
 * with square cells of its finer spacing, cropped to the mask and decimated to the
 * node budget.
 *
 * ⭐ Reads the layers' HEADERS only. That is what lets a caller resample each
 * layer as its samples arrive (or on a worker) instead of holding the whole
 * column first; {@link buildStackReference} is simply this plus a loop.
 *
 * @param layers the stack, shallowest first; `null` for a synthetic layer, which
 *   has no grid of its own to offer
 * @param polygon the mask polygon (scene XZ) the chunk is clipped to
 * @param options see {@link StackReferenceOptions}
 * @returns the common grid, or `null` when the mask misses every layer's grid
 *
 * @group Geometries
 */
export function planStackReference(
  layers: readonly (StackGridPlacement | null)[],
  polygon: PlanarPolygonGeometry,
  options: StackReferenceOptions = {},
): StackReferencePlan | null {
  if (layers.length === 0) return null;
  const margin = options.margin ?? 2;
  const maxNodes = options.maxNodes ?? DEFAULT_STACK_MAX_NODES;

  // The finest layer defines the common domain, so no layer is resampled up.
  // Synthetic layers have no grid to offer, so at least one real one is needed.
  let source: StackGridPlacement | null = null;
  let bestArea = Infinity;
  for (const layer of layers) {
    if (!layer) continue;
    const area = layer.header.xinc * layer.header.yinc;
    if (area < bestArea) {
      bestArea = area;
      source = layer;
    }
  }
  if (!source) return null;
  const bounds = surfaceGridBounds(
    source.header,
    polygon,
    source.worldPosition,
    margin,
  );
  if (!bounds) return null;

  const { col0, row0, col1, row1 } = bounds;
  const cropW = col1 - col0 + 1;
  const cropH = row1 - row0 + 1;
  if (cropW < 2 || cropH < 2) return null;

  // Square cells of the source's finer spacing, so anything counted in cells —
  // tiles, fill distance, tolerances — means the same distance along both axes.
  // The coarser axis is resampled up; a square source keeps its own nodes.
  const fine = Math.min(source.header.xinc, source.header.yinc);
  const fineW =
    Math.floor(((cropW - 1) * source.header.xinc) / fine + 1e-9) + 1;
  const fineH =
    Math.floor(((cropH - 1) * source.header.yinc) / fine + 1e-9) + 1;

  // Decimate when the window is bigger than the node budget.
  const step = Math.max(
    1,
    Math.ceil(Math.sqrt((fineW * fineH) / Math.max(1, maxNodes))),
  );
  const nx = Math.floor((fineW - 1) / step) + 1;
  const ny = Math.floor((fineH - 1) / step) + 1;
  if (nx < 2 || ny < 2) return null;

  const header: SurfaceClipHeader = {
    nx,
    ny,
    xinc: fine * step,
    yinc: fine * step,
    rot: source.header.rot,
  };

  // `maxFill` is given in metres so it survives decimation and means the same
  // thing on any survey; the chamfer transform counts in cells of THIS grid.
  const fillLimit =
    options.maxFill !== undefined && options.maxFill >= 0
      ? options.maxFill / header.xinc
      : Infinity;

  // Place the cropped/decimated grid so its node (0, 0) lands exactly on the
  // source grid's node (col0, row0): both grids share the rotation and axis
  // directions, so the difference is a pure translation.
  const anchor = surfaceGridToWorld(source.header, source.worldPosition)(
    col0,
    row0,
  );
  const origin = surfaceGridToWorld(header, [0, 0])(0, 0);
  const worldPosition: Vec2 = [anchor[0] - origin[0], anchor[1] - origin[1]];

  return { header, worldPosition, step, fillLimit };
}

/**
 * Resample a stack of surfaces onto one common grid — the first half of the
 * shared-tessellation build.
 *
 * The finest-resolution layer's grid, with square cells of its finer spacing and
 * cropped to the mask, defines the common domain; every layer is bilinearly
 * resampled onto it and converted to **scene Y** so all downstream work
 * (tessellation, ordering, geometry) speaks one coordinate system. Layers keep
 * their own grids untouched.
 *
 * @param layers the stack, shallowest first
 * @param polygon the mask polygon (scene XZ) the chunk is clipped to
 * @param options see {@link StackReferenceOptions}
 * @returns the common domain, or `null` when the mask misses every layer's grid
 *
 * @group Geometries
 */
export function buildStackReference(
  layers: StackLayer[],
  polygon: PlanarPolygonGeometry,
  options: StackReferenceOptions = {},
): StackReference | null {
  const plan = planStackReference(
    layers.map(l => (isSyntheticLayer(l) ? null : l)),
    polygon,
    options,
  );
  if (!plan) return null;

  const { header, worldPosition } = plan;
  const count = header.nx * header.ny;
  const channels: Float32Array[] = [];
  const masks: Uint8Array[] = [];
  const empty: boolean[] = [];

  for (const layer of layers) {
    // A synthetic layer has nothing to resample and data everywhere. `offset`
    // hangs from the layer above, so this must stay in order.
    if (isSyntheticLayer(layer)) {
      const channel = buildSyntheticChannel(
        header,
        worldPosition,
        layer,
        channels.length > 0 ? channels[channels.length - 1] : null,
      );
      // Nothing to hang from (an `offset` with no layer above, or nothing
      // declared): fall back to sea level. ⚠️ It must still emit a channel —
      // everything downstream indexes `layers` BY CHANNEL, so dropping one here
      // would silently pair every later layer with the wrong geometry.
      channels.push(channel ?? new Float32Array(count));
      masks.push(new Uint8Array(count).fill(STACK_MASK_DATA));
      empty.push(false);
      continue;
    }
    const resampled = resampleStackLayer(
      plan,
      layer,
      layer.referenceDepth,
      layer.nullValue ?? -1,
    );
    channels.push(resampled.channel);
    masks.push(resampled.mask);
    empty.push(resampled.empty);
  }

  layEmptyStackLayers(channels, empty);

  return { header, worldPosition, channels, masks, step: plan.step };
}

/** The result of {@link measureStackCoverage}. */
export type StackCoverageResult = {
  /**
   * Per-layer share of the footprint that layer has data of its own for, in
   * `masks` order. A layer at 0 has no local evidence anywhere the chunk is
   * drawn — not even within `maxFill` of any — which is a different thing from
   * being thin or partly mapped, and the caller is expected to treat it as such.
   */
  layerCoverage: number[];
  /**
   * Per-layer share of the footprint covered ONLY through bounded fill (see
   * {@link StackReferenceOptions.maxFill}) — included in
   * {@link StackCoverageResult.layerCoverage}, and reported separately so a layer
   * that is standing on extrapolation can be told from one that is mapped.
   */
  layerFilled: number[];
};

/**
 * Rasterise a chunk's footprint onto the reference grid: 1 where a node is inside
 * the outline.
 *
 * ⚠️ The reference grid is the grid-space BOUNDING BOX of a (usually rotated)
 * outline, so a good part of it is never drawn. Anything that measures a property
 * of the chunk — coverage, or how far a seal has to reach — has to say which nodes
 * it means, or the answer is set by corners nobody sees.
 *
 * @param reference the common domain from {@link buildStackReference}
 * @param polygon the outline, in scene XZ
 *
 * @group Geometries
 */
export function rasterizeStackOutline(
  reference: StackReference,
  polygon: PlanarPolygonGeometry,
): Uint8Array {
  const { nx, ny } = reference.header;
  const toGrid = surfaceWorldToGrid(reference.header, reference.worldPosition);
  const components = polygon.coordinates as PlanarPolygonCoordinates;
  const gridPolygons: GridPolygon[] = components.map(rings =>
    rings.map(ring => ring.map(([sx, sz]) => toGrid(sx, sz))),
  );
  const insidePolygon = makeGridInside(gridPolygons);
  const inside = new Uint8Array(nx * ny);
  // Only the polygon's own grid-space window is tested: on a shared column the
  // grid spans the whole survey while a chunk may occupy a corner of it, and a
  // node outside the bounding box is outside the polygon by definition.
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const rings of gridPolygons) {
    for (const ring of rings) {
      for (const [gx, gy] of ring) {
        if (gx < minCol) minCol = gx;
        if (gx > maxCol) maxCol = gx;
        if (gy < minRow) minRow = gy;
        if (gy > maxRow) maxRow = gy;
      }
    }
  }
  const col0 = Math.max(0, Math.floor(minCol));
  const col1 = Math.min(nx - 1, Math.ceil(maxCol));
  const row0 = Math.max(0, Math.floor(minRow));
  const row1 = Math.min(ny - 1, Math.ceil(maxRow));
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      if (insidePolygon(col, row)) inside[row * nx + col] = 1;
    }
  }
  return inside;
}

/**
 * Every `stride`-th node of the reference grid over a chunk's footprint, with the
 * stride chosen so that about `nodes` of them fall inside the outline — the
 * refinement candidates of a coarse preview build (pass them as
 * `SurfaceStackOptions.candidates`).
 *
 * ⭐ Aligned to the GRID rather than to the outline, so neighbouring chunks'
 * previews sample the same nodes.
 *
 * @param reference the common domain from {@link buildStackReference}
 * @param polygon the outline, in scene XZ
 * @param nodes how many nodes to aim for inside the outline
 *
 * @group Geometries
 */
export function previewStackCandidates(
  reference: StackReference,
  polygon: PlanarPolygonGeometry,
  nodes: number,
): { candidates: Uint32Array; stride: number } {
  const { nx, ny } = reference.header;
  const toGrid = surfaceWorldToGrid(reference.header, reference.worldPosition);
  let area = 0;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const rings of polygon.coordinates as PlanarPolygonCoordinates) {
    rings.forEach((ring, k) => {
      const grid = ring.map(([sx, sz]) => toGrid(sx, sz));
      let twice = 0;
      for (let i = 0; i < grid.length; i++) {
        const [ax, ay] = grid[i];
        const [bx, by] = grid[(i + 1) % grid.length];
        twice += ax * by - bx * ay;
        if (ax < minCol) minCol = ax;
        if (ax > maxCol) maxCol = ax;
        if (ay < minRow) minRow = ay;
        if (ay > maxRow) maxRow = ay;
      }
      // the first ring of a component is its outer ring, the rest are holes
      area += ((k === 0 ? 1 : -1) * Math.abs(twice)) / 2;
    });
  }
  const stride = Math.max(
    1,
    Math.round(Math.sqrt(Math.max(area, 0) / Math.max(nodes, 1))),
  );
  if (!(maxCol >= minCol && maxRow >= minRow)) {
    return { candidates: new Uint32Array(0), stride };
  }
  const col0 = Math.max(0, Math.ceil(minCol / stride) * stride);
  const col1 = Math.min(nx - 1, Math.floor(maxCol));
  const row0 = Math.max(0, Math.ceil(minRow / stride) * stride);
  const row1 = Math.min(ny - 1, Math.floor(maxRow));
  const cols = col1 >= col0 ? Math.floor((col1 - col0) / stride) + 1 : 0;
  const rows = row1 >= row0 ? Math.floor((row1 - row0) / stride) + 1 : 0;
  const candidates = new Uint32Array(cols * rows);
  let at = 0;
  for (let row = row0; row <= row1; row += stride) {
    for (let col = col0; col <= col1; col += stride) {
      candidates[at++] = row * nx + col;
    }
  }
  return { candidates, stride };
}

/**
 * Measure how much of a chunk's footprint each layer actually has data for.
 *
 * ⚠️ Measured over the REQUESTED outline, and reported per layer rather than as a
 * single number, because the only useful question here is *which* layer is
 * standing on nothing. A chunk-level average hides exactly that.
 *
 * ⭐ Coverage includes bounded fill (see {@link StackReferenceOptions.maxFill}),
 * so a layer mapped just outside the crop still counts as covered — the same
 * threshold that decides everywhere else whether a gap is interpolated across or
 * admitted as invention. A layer measuring 0 therefore has no evidence anywhere
 * the chunk is drawn, not merely none inside it.
 *
 * This replaced `trimPolygonToCoverage`, which used the same tally to cut the
 * outline back to the data. Coverage is a per-LAYER property and the outline is
 * the user's crop; conflating them made one layer's survey edge silently reshape
 * the whole chunk (`documents/chunks.md` §10.1.8).
 *
 * @param reference the common domain from {@link buildStackReference}
 * @param polygon the requested outline (scene XZ)
 * @param masks the layers' coverage masks, in the reference's grid space (a subset
 *   of `reference.masks` when the chunk draws part of a column)
 *
 * @group Geometries
 */
export function measureStackCoverage(
  reference: StackReference,
  polygon: PlanarPolygonGeometry,
  masks: Uint8Array[],
): StackCoverageResult {
  const { nx, ny } = reference.header;
  if (masks.length === 0) return { layerCoverage: [], layerFilled: [] };

  const insideGrid = rasterizeStackOutline(reference, polygon);
  let inside = 0;
  const perLayer = new Array<number>(masks.length).fill(0);
  const perFilled = new Array<number>(masks.length).fill(0);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const n = row * nx + col;
      if (!insideGrid[n]) continue;
      inside++;
      for (let m = 0; m < masks.length; m++) {
        const v = masks[m][n];
        if (!v) continue;
        perLayer[m]++;
        if (v === STACK_MASK_FILLED) perFilled[m]++;
      }
    }
  }
  return {
    layerCoverage: perLayer.map(c => (inside > 0 ? c / inside : 0)),
    layerFilled: perFilled.map(c => (inside > 0 ? c / inside : 0)),
  };
}

/**
 * Each layer's data boundary as grid rings, or `null` where the layer has nothing
 * to bound (fully mapped, or mapped nowhere).
 *
 * ⭐ Deduped by mask CONTENT: surveys routinely share one interpreted polygon
 * (11 of the demo set's surfaces do), and resampling onto the common grid gives
 * each its own array, so identity alone misses them. Identical rings are not only
 * traced and constrained once per copy — they overlap segment for segment, so
 * the noder compares every copy against every other (measured: 15 sets from 6
 * distinct masks cost 2.9 s of noding; deduped, 0.6 s).
 *
 * ⚠️⚠️ NOT simplified, though a trace carries one vertex per cell and
 * Ramer-Douglas-Peucker would cut that by an order of magnitude. Simplifying a
 * rectilinear ring can make it cross ITSELF where two arms of a staircase pass
 * within the tolerance, and `nodeGridRings` does not node a ring against itself,
 * so the triangulator quietly fails to enforce the edge (measured on the
 * generated column: 36 constraint failures at a one-cell tolerance, 0 without).
 * The raw trace follows cell edges and cannot cross itself — and it costs no more
 * than the refinement pass it replaces.
 */
function coverageRings(masks: Uint8Array[], nx: number): (GridRing[] | null)[] {
  const traced = new Map<Uint8Array, GridRing[] | null>();
  const byHash = new Map<number, Uint8Array[]>();
  return masks.map(mask => {
    const known = traced.get(mask);
    if (known !== undefined) return known;
    let hash = 0x811c9dc5;
    for (let i = 0; i < mask.length; i++) {
      hash = Math.imul(hash ^ mask[i], 16777619);
    }
    const candidates = byHash.get(hash);
    const twin = candidates?.find(other => {
      if (other.length !== mask.length) return false;
      for (let i = 0; i < mask.length; i++) {
        if (other[i] !== mask[i]) return false;
      }
      return true;
    });
    if (twin) {
      const rings = traced.get(twin)!;
      traced.set(mask, rings);
      return rings;
    }
    if (candidates) candidates.push(mask);
    else byHash.set(hash, [mask]);
    let missing = false;
    let present = false;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) present = true;
      else missing = true;
      if (present && missing) break;
    }
    const rings = present && missing ? traceMaskBoundary(mask, nx) : [];
    traced.set(mask, rings.length > 0 ? rings : null);
    return traced.get(mask)!;
  });
}

/**
 * Build ONE triangulation for the whole stack, conforming to the mask polygon.
 *
 * Every layer is refined independently against the common grid (the cheap,
 * embarrassingly parallel part — pass `candidates` to reuse work done elsewhere),
 * and the **union** of their candidate vertices is triangulated once. The result
 * is therefore within `maxError` of *every* layer while giving them all identical
 * topology, which is what makes the stack safe: monotone vertex heights stay
 * monotone under linear interpolation, so no two surfaces can interpenetrate.
 *
 * @param reference the common domain from {@link buildStackReference}
 * @param polygon the mask polygon (scene XZ), already densified into the shared rim
 * @param maxError greedy simplification error, in world units of height
 * @param candidates optional precomputed per-layer candidate node indices (see
 *   {@link collectStackCandidates})
 * @param cuts outlines of NEIGHBOURING chunks this one partially overlaps. They do
 *   NOT extend the kept domain — they are constrained so that the part of this
 *   chunk another one also draws is bounded by real mesh edges, and reported per
 *   triangle in {@link StackTessellation.cuts}.
 * @param constrainCoverage constrain each layer's own DATA boundary as well, so no
 *   triangle straddles a survey edge, and report membership per triangle in
 *   {@link StackTessellation.coverage}. Costs vertices along every data edge; buys
 *   an exact drop rule instead of one that must either spill past the survey or
 *   bite into it.
 * @param terminations per pair of adjacent layers, the lines where the lower unit
 *   wedges out (see `traceThicknessLines`), constrained like a data boundary.
 *   Only the lines that reach the outline are kept.
 * @param tileCells triangulate in square tiles of this many reference cells,
 *   joined along their seams (see {@link planStackTessellation}); omitted = one
 *   triangulation
 * @param lod coarser levels to build as well (see {@link StackTessellation.levels})
 * @returns the shared tessellation, or `null` when nothing survives the mask
 *
 * @group Geometries
 */
export function tessellateStack(
  reference: StackReference,
  polygon: PlanarPolygonGeometry,
  maxError: number,
  candidates?: Uint32Array[],
  cuts?: PlanarPolygonGeometry[],
  constrainCoverage?: boolean,
  terminations?: GridRing[][],
  tileCells?: number,
  lod?: StackTessellationLod,
): StackTessellation | null {
  const plan = planStackTessellation(
    reference,
    polygon,
    maxError,
    candidates,
    cuts,
    constrainCoverage,
    terminations,
    tileCells,
    lod,
  );
  return plan.finish(plan.tiles.map(tile => tessellateStackTile(tile)));
}

/**
 * {@link tessellateStack} split at its tiles: run each of `tiles` through
 * `tessellateStackTile` (free of three.js, so a worker pool can) and hand the
 * outputs, in order, to `finish`.
 *
 * @group Geometries
 */
export type StackTessellationPlan = {
  tiles: StackTileInput[];
  finish(outputs: StackTileOutput[]): StackTessellation | null;
  /** the tile layout, when there is more than one tile */
  tiling?: StackTiling;
};

/**
 * How a tessellation was tiled: tile `(i, j)` covers reference columns
 * `[(first[0] + i) * cells, (first[0] + i + 1) * cells)`, rows likewise, with
 * seams on the half-cell lines between.
 *
 * @group Geometries
 */
export type StackTiling = {
  cells: number;
  first: [number, number];
  count: [number, number];
  /**
   * Scene XZ to reference grid `(column, row)`, as `[a, b, c, d, e, f]`:
   * `column = a x + b z + c`, `row = d x + e z + f`.
   */
  toGrid: [number, number, number, number, number, number];
};

/**
 * Scene XZ to `reference`'s grid `(column, row)` as `[a, b, c, d, e, f]` (see
 * {@link StackTiling.toGrid}).
 *
 * @group Geometries
 */
export function stackSceneToGrid(
  reference: StackReference,
): [number, number, number, number, number, number] {
  const toGrid = surfaceWorldToGrid(reference.header, reference.worldPosition);
  // The grid map is affine, so three points give it.
  const [c0, r0] = toGrid(0, 0);
  const [c1, r1] = toGrid(1, 0);
  const [c2, r2] = toGrid(0, 1);
  return [c1 - c0, c2 - c0, c0, r1 - r0, r2 - r0, r0];
}

/**
 * The serial part of {@link tessellateStack}: the constraints, noded once for the
 * whole chunk, cut into tiles; and the joining afterwards.
 *
 * ⭐ Seams run on half-cell lines, so no grid node and no traced data boundary
 * (which follows cell edges) can lie on one. Each seam is noded with the other
 * rings, so every crossing is one point both tiles insert, and its height
 * profile is refined on its own (`refineStackSeam`) — nothing else refines a
 * boundary. The outer tiles reach the grid's edge, so a single tile is exactly
 * the untiled build.
 *
 * @group Geometries
 */
export function planStackTessellation(
  reference: StackReference,
  polygon: PlanarPolygonGeometry,
  maxError: number,
  candidates?: Uint32Array[],
  cuts?: PlanarPolygonGeometry[],
  constrainCoverage?: boolean,
  terminations?: GridRing[][],
  tileCells?: number,
  lod?: StackTessellationLod,
): StackTessellationPlan {
  const { nx, ny } = reference.header;
  const toGrid = surfaceWorldToGrid(reference.header, reference.worldPosition);
  const toGridPolygons = (p: PlanarPolygonGeometry): GridPolygon[] =>
    (p.coordinates as PlanarPolygonCoordinates).map(rings =>
      rings.map(ring => ring.map(([sx, sz]) => toGrid(sx, sz))),
    );
  const gridPolygons = toGridPolygons(polygon);
  const cutPolygons = (cuts ?? []).map(toGridPolygons);
  // Per layer, which traced set bounds it — the sets themselves are what get
  // constrained, and several layers usually share one.
  const layerRings = constrainCoverage
    ? coverageRings(reference.masks, nx)
    : null;
  const coverageSets: GridPolygon[] = [];
  layerRings?.forEach(rings => {
    if (rings && !coverageSets.includes(rings)) coverageSets.push(rings);
  });
  // The lines are traced over the whole column grid, which a chunk may only
  // occupy a corner of. Kept aligned with `terminations`: the index is the pair.
  const terminationSets: GridPolygon[] = [];
  // ⚠️ Only TRACED points lie exactly at the threshold. A split the noding adds
  // where two lines cross sits on the simplified chord, up to the tolerance off
  // the true line, and must be judged by its own thickness.
  const traced = new Set<number[]>();
  if (terminations && terminations.length > 0) {
    // By BOX: a simplified straight run may cross the outline with no vertex in it.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const rings of gridPolygons) {
      for (const ring of rings) {
        for (const [gx, gy] of ring) {
          minX = Math.min(minX, gx);
          maxX = Math.max(maxX, gx);
          minY = Math.min(minY, gy);
          maxY = Math.max(maxY, gy);
        }
      }
    }
    const reaches = (ring: GridRing) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [gx, gy] of ring) {
        x0 = Math.min(x0, gx);
        x1 = Math.max(x1, gx);
        y0 = Math.min(y0, gy);
        y1 = Math.max(y1, gy);
      }
      return x1 >= minX && x0 <= maxX && y1 >= minY && y0 <= maxY;
    };
    for (const rings of terminations) {
      const kept = rings.filter(reaches);
      for (const ring of kept) for (const p of ring) traced.add(p);
      terminationSets.push(kept);
    }
  }

  // The chunk's grid window, a cell wider than the outline all round.
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const poly of gridPolygons) {
    for (const ring of poly) {
      for (const [gx, gy] of ring) {
        if (gx < minCol) minCol = gx;
        if (gx > maxCol) maxCol = gx;
        if (gy < minRow) minRow = gy;
        if (gy > maxRow) maxRow = gy;
      }
    }
  }
  minCol -= 1;
  maxCol += 1;
  minRow -= 1;
  maxRow += 1;

  const cells =
    tileCells && tileCells >= 1 && minCol <= maxCol
      ? Math.floor(tileCells)
      : Infinity;
  const tileOf = (v: number) =>
    cells === Infinity ? 0 : Math.floor((v + 0.5) / cells);
  const kx0 = tileOf(Math.max(minCol, 0));
  const kx1 = tileOf(Math.min(maxCol, nx - 1));
  const ky0 = tileOf(Math.max(minRow, 0));
  const ky1 = tileOf(Math.min(maxRow, ny - 1));
  const tilesX = kx1 - kx0 + 1;
  const tilesY = ky1 - ky0 + 1;
  const seamX: number[] = [];
  const seamY: number[] = [];
  for (let k = kx0 + 1; k <= kx1; k++) seamX.push(k * cells - 0.5);
  for (let k = ky0 + 1; k <= ky1; k++) seamY.push(k * cells - 0.5);
  const tiled = seamX.length > 0 || seamY.length > 0;
  const tiling: StackTiling | undefined = tiled
    ? {
        cells,
        first: [kx0, ky0],
        count: [tilesX, tilesY],
        toGrid: stackSceneToGrid(reference),
      }
    : undefined;
  const tileIndex = (x: number, y: number) =>
    (Math.min(Math.max(tileOf(y), ky0), ky1) - ky0) * tilesX +
    Math.min(Math.max(tileOf(x), kx0), kx1) -
    kx0;

  // Open polylines along each seam: its ends, the seams crossing it, and the
  // positions its own height profile needs.
  const seamRings: GridRing[] = [];
  if (tiled) {
    const rows = [Math.max(Math.ceil(minRow), 0), Math.min(maxRow, ny - 1)];
    const cols = [Math.max(Math.ceil(minCol), 0), Math.min(maxCol, nx - 1)];
    const line = (ends: number[], crossing: number[], kept: number[]) =>
      [...new Set([...ends, ...crossing, ...kept])].sort((a, b) => a - b);
    for (const x of seamX) {
      const kept = refineStackSeam(
        reference.channels,
        nx,
        'x',
        x,
        rows[0],
        Math.floor(rows[1]),
        maxError,
      );
      seamRings.push(line([0, ny - 1], seamY, kept).map(y => [x, y]));
    }
    for (const y of seamY) {
      const kept = refineStackSeam(
        reference.channels,
        nx,
        'y',
        y,
        cols[0],
        Math.floor(cols[1]),
        maxError,
      );
      seamRings.push(line([0, nx - 1], seamX, kept).map(x => [x, y]));
    }
  }

  // ⚠️ A point a rounding error off a seam would land inside one tile and on the
  // other's boundary. Anything within the noder's touch distance goes ON it.
  const snap = (v: number, k0: number, k1: number) => {
    const k = Math.round((v + 0.5) / cells);
    const at = k * cells - 0.5;
    return k > k0 && k <= k1 && Math.abs(v - at) <= GRID_NODE_TOUCH ? at : v;
  };
  // Copies, never the caller's points: a pinch-out line is passed in.
  const snapRings = (polys: GridPolygon[]) =>
    polys.forEach(rings =>
      rings.forEach((ring, ri) => {
        let copy: GridRing | null = null;
        ring.forEach((p, i) => {
          const x = snap(p[0], kx0, kx1);
          const y = snap(p[1], ky0, ky1);
          if (x === p[0] && y === p[1]) return;
          copy ??= ring.slice();
          copy[i] = [x, y];
          if (traced.has(p)) traced.add(copy[i]);
        });
        if (copy) rings[ri] = copy;
      }),
    );
  if (tiled) {
    snapRings(gridPolygons);
    cutPolygons.forEach(snapRings);
    snapRings(coverageSets);
    snapRings(terminationSets);
  }

  // ⚠️ A cut rim CROSSES this chunk's rim — that is what makes it a partial
  // overlap. Two crossing constraint edges can only both follow mesh edges if the
  // crossing is itself a vertex, so they are noded first (`nodeGridRings`);
  // without it the triangulator silently drops one of the two boundaries. A data
  // boundary crosses the rim and the other layers' boundaries the same way, and
  // every ring crosses the seams.
  if (
    cutPolygons.length > 0 ||
    coverageSets.length > 0 ||
    terminationSets.some(set => set.length > 0) ||
    tiled
  ) {
    const flat: GridRing[] = [];
    const visit = (polys: GridPolygon[]) =>
      polys.forEach(rings => rings.forEach(ring => flat.push(ring)));
    visit(gridPolygons);
    cutPolygons.forEach(visit);
    visit(coverageSets);
    visit(terminationSets);
    const open = flat.map(() => false);
    for (const ring of seamRings) {
      flat.push(ring);
      open.push(true);
    }
    const noded = nodeGridRings(flat, open);
    if (noded !== flat) {
      let at = 0;
      const replace = (polys: GridPolygon[]) =>
        polys.forEach((rings, ci) => {
          polys[ci] = rings.map(() => noded[at++]);
        });
      replace(gridPolygons);
      cutPolygons.forEach(replace);
      replace(coverageSets);
      replace(terminationSets);
      for (let i = 0; i < seamRings.length; i++) seamRings[i] = noded[at++];
    }
  }

  // Every point ON a seam, by seam: both tiles beside it insert all of them.
  // Crossings are computed on whichever segment came first, so they are put
  // exactly on the line here (they are the noder's own points, shared by both).
  const onSeamX = new Map(seamX.map(x => [x, new Map<number, number[]>()]));
  const onSeamY = new Map(seamY.map(y => [y, new Map<number, number[]>()]));
  if (tiled) {
    const collect = (ring: GridRing) => {
      for (const p of ring) {
        p[0] = snap(p[0], kx0, kx1);
        p[1] = snap(p[1], ky0, ky1);
        onSeamX.get(p[0])?.set(p[1], p);
        onSeamY.get(p[1])?.set(p[0], p);
      }
    };
    const visit = (polys: GridPolygon[]) =>
      polys.forEach(rings => rings.forEach(collect));
    visit(gridPolygons);
    cutPolygons.forEach(visit);
    visit(coverageSets);
    visit(terminationSets);
    seamRings.forEach(collect);
  }

  // Union of every layer's refinement vertices, as reference grid node indices.
  const union = new Set<number>();
  let lists = candidates;
  let listErrors = lod?.candidateErrors;
  if (!lists && lod) {
    const levels = reference.channels.map(channel =>
      collectStackCandidateLevels(channel, nx, maxError),
    );
    lists = levels.map(level => level.nodes);
    listErrors = levels.map(level => level.errors);
  }
  lists ??= reference.channels.map(channel =>
    collectStackCandidates(channel, nx, maxError),
  );
  // Per node, the coarsest level any layer needs it at.
  const nodeError = lod ? new Float32Array(nx * ny).fill(-Infinity) : null;
  lists.forEach((list, l) => {
    for (let i = 0; i < list.length; i++) union.add(list[i]);
    if (!nodeError) return;
    const errors = listErrors?.[l];
    for (let i = 0; i < list.length; i++) {
      const e = errors ? errors[i] : Infinity;
      if (e > nodeError[list[i]]) nodeError[list[i]] = e;
    }
  });
  const levelsOf = (node: number) => {
    let k = 0;
    while (k < lod!.errors.length && nodeError![node] > lod!.errors[k]) k++;
    return k;
  };

  // ⭐ Only the nodes this chunk draws. The candidates are collected over the
  // whole COLUMN — one grid, shared by every chunk cut from it — so a chunk with a
  // small footprint is otherwise handed the entire field's detail. Dropping the
  // rest cannot change the result: the rim is a CONSTRAINT edge and a flip never
  // crosses one, so a point outside it takes part in no triangle that survives
  // `removeExteriorTriangles`.
  // ⚠️ DILATED BY ONE CELL (the neighbour test), because a node lying exactly ON
  // the rim IS a vertex of kept triangles and the even-odd test is free to call it
  // outside. The extra band costs a few exterior points; without it the chunk
  // quietly loses rim detail.
  const insidePolygon = makeGridInside(gridPolygons);
  const nearPolygon = (col: number, row: number) =>
    insidePolygon(col, row) ||
    insidePolygon(col - 1, row) ||
    insidePolygon(col + 1, row) ||
    insidePolygon(col, row - 1) ||
    insidePolygon(col, row + 1);

  // Corners come with the bootstrap triangulation.
  union.delete(0);
  union.delete(nx - 1);
  union.delete((ny - 1) * nx);
  union.delete((ny - 1) * nx + nx - 1);

  // Insert row by row: consecutive points are adjacent, so the locate walk that
  // Delatin starts from its last hit resolves in a couple of steps. (A typed sort:
  // numeric without a comparator, which is most of the cost on a million nodes.)
  const tileCount = tilesX * tilesY;
  const tileNodes: number[][] = Array.from({ length: tileCount }, () => []);
  const tileNodeLevels: number[][] = Array.from(
    { length: lod ? tileCount : 0 },
    () => [],
  );
  const nodes = Uint32Array.from(union).sort();
  for (const node of nodes) {
    const col = node % nx;
    const row = (node - col) / nx;
    if (col < minCol || col > maxCol || row < minRow || row > maxRow) continue;
    if (!nearPolygon(col, row)) continue;
    const t = tileIndex(col, row);
    tileNodes[t].push(col, row);
    if (lod) tileNodeLevels[t].push(levelsOf(node));
  }

  // The rim: inserted as explicit points and locked as constraint edges, so every
  // layer's boundary lands on exactly the same vertices as the walls. A ring that
  // crosses a seam is locked piece by piece, each piece by the tile it runs in.
  const clampCol = (x: number) => Math.min(Math.max(x, 0), nx - 1);
  const clampRow = (y: number) => Math.min(Math.max(y, 0), ny - 1);
  const tileRim: StackTileChain[][] = Array.from(
    { length: tileCount },
    () => [],
  );
  // per tile, per rim piece: its ring, and the ring point behind each piece point
  const rimRefs: { ring: number; at: number[] }[][] = Array.from(
    { length: tileCount },
    () => [],
  );
  const rims: GridRing[] = [];
  for (const poly of gridPolygons) {
    for (const ring of poly) {
      const r = rims.length;
      const points = ring.map(([gx, gy]) => [clampCol(gx), clampRow(gy)]);
      rims.push(points);
      const tiles = points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        return tileIndex((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      });
      if (tiles.every(t => t === tiles[0])) {
        tileRim[tiles[0] ?? 0].push({
          points: Float64Array.from(points.flat()),
          closed: true,
        });
        rimRefs[tiles[0] ?? 0].push({ ring: r, at: points.map((_, i) => i) });
        continue;
      }
      for (let i = 0; i < points.length; ) {
        const t = tiles[i];
        const at = [i];
        while (i < points.length && tiles[i] === t)
          at.push(++i % points.length);
        tileRim[t].push({
          points: Float64Array.from(at.flatMap(k => points[k])),
          closed: false,
        });
        rimRefs[t].push({ ring: r, at });
      }
    }
  }

  // A cut is constrained but never closed: it only has to bound the part of THIS
  // chunk that a neighbour also draws, so where it leaves the reference grid the
  // chain simply restarts. A data boundary is enforced the same way.
  // ⭐ Noded rings meet the rim only at vertices, so a segment outside it bounds
  // nothing kept and is skipped; an inside endpoint keeps it in case noding missed one.
  let coverageRingPoints = 0;
  let terminationRingPoints = 0;
  const tileChains: StackTileChain[][] = Array.from(
    { length: tileCount },
    () => [],
  );
  // per tile, per chain: the pinch-out pair each traced point belongs to
  const chainTags: (Int32Array | null)[][] = Array.from(
    { length: tileCount },
    () => [],
  );
  const inGrid = (p: number[]) =>
    p[0] >= 0 && p[0] <= nx - 1 && p[1] >= 0 && p[1] <= ny - 1;
  // Every layer's height along a pinch-out piece, for a coarser level to thin it by.
  const layers = reference.channels.length;
  const isNoData = (v: number) => v === NO_DATA;
  const heightsAt = (points: Float64Array) => {
    const out = new Float32Array((points.length >> 1) * layers);
    for (let k = 0; k < points.length >> 1; k++) {
      const col = points[2 * k];
      const row = points[2 * k + 1];
      for (let c = 0; c < layers; c++) {
        out[k * layers + c] = sampleValidGrid(
          reference.channels[c],
          nx,
          ny,
          col,
          row,
          isNoData,
          0,
        );
      }
    }
    return out;
  };
  const cutRing = (ring: GridRing, pair = -1) => {
    let tile = -1;
    let at: number[] = [];
    const flush = () => {
      if (at.length < 2) return;
      const points = new Float64Array(2 * at.length);
      for (let j = 0; j < at.length; j++) {
        points[2 * j] = ring[at[j]][0];
        points[2 * j + 1] = ring[at[j]][1];
      }
      tileChains[tile].push(
        lod && pair >= 0
          ? { points, closed: false, heights: heightsAt(points) }
          : { points, closed: false },
      );
      chainTags[tile].push(
        pair < 0
          ? null
          : Int32Array.from(at, k => (traced.has(ring[k]) ? pair : -1)),
      );
    };
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const kept =
        inGrid(p) &&
        inGrid(q) &&
        (insidePolygon((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) ||
          insidePolygon(p[0], p[1]) ||
          insidePolygon(q[0], q[1]));
      const t = kept ? tileIndex((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) : -1;
      if (t !== tile || !kept) {
        flush();
        at = kept ? [i] : [];
        tile = t;
      }
      if (kept) at.push((i + 1) % ring.length);
    }
    flush();
  };
  for (const cut of cutPolygons) {
    for (const poly of cut) {
      for (const ring of poly) cutRing(ring);
    }
  }
  for (const set of coverageSets) {
    for (const ring of set) {
      coverageRingPoints += ring.length;
      cutRing(ring);
    }
  }
  terminationSets.forEach((set, pair) => {
    for (const ring of set) {
      terminationRingPoints += ring.length;
      cutRing(ring, pair);
    }
  });

  const tiles: StackTileInput[] = [];
  // A coarser level's plan tolerance grows with its error, so a thinned line
  // stays within it in plan as well as in height.
  const cellSize = Math.min(reference.header.xinc, reference.header.yinc);
  const levelSpecs = lod?.errors.map((error): [number, number] => [
    error,
    Math.max(TERMINATION_TOLERANCE, error / cellSize),
  ]);
  for (let iy = 0; iy < tilesY; iy++) {
    for (let ix = 0; ix < tilesX; ix++) {
      const t = iy * tilesX + ix;
      const x0 = ix === 0 ? 0 : (kx0 + ix) * cells - 0.5;
      const x1 = ix === tilesX - 1 ? nx - 1 : (kx0 + ix + 1) * cells - 0.5;
      const y0 = iy === 0 ? 0 : (ky0 + iy) * cells - 0.5;
      const y1 = iy === tilesY - 1 ? ny - 1 : (ky0 + iy + 1) * cells - 0.5;
      const seams: number[] = [];
      const side = (points: Map<number, number[]> | undefined) => {
        for (const p of points?.values() ?? []) {
          if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) {
            seams.push(p[0], p[1]);
          }
        }
      };
      if (ix > 0) side(onSeamX.get(x0));
      if (ix < tilesX - 1) side(onSeamX.get(x1));
      if (iy > 0) side(onSeamY.get(y0));
      if (iy < tilesY - 1) side(onSeamY.get(y1));
      tiles.push({
        bounds: [x0, y0, x1, y1],
        shared: [ix > 0, iy > 0, ix < tilesX - 1, iy < tilesY - 1],
        seams: Float64Array.from(seams),
        nodes: Float64Array.from(tileNodes[t]),
        rim: tileRim[t],
        chains: tileChains[t],
        polygons: gridPolygons,
        ...(levelSpecs && {
          lod: {
            nodeLevels: Uint8Array.from(tileNodeLevels[t]),
            levels: levelSpecs,
            layers,
          },
        }),
      });
    }
  }

  const finish = (outputs: StackTileOutput[]): StackTessellation | null => {
    const stitched = stitchStackTiles(outputs, seamX, seamY);
    const { indices, vertexOf } = stitched;
    if (indices.length === 0) return null;

    // Back to whole rings: each rim point's vertex, from whichever piece has it.
    const rimLocal = rims.map(ring => new Int32Array(ring.length * 2).fill(-1));
    outputs.forEach((o, t) =>
      rimRefs[t].forEach(({ ring, at }, c) =>
        at.forEach((k, j) => {
          const local = o.rim[c][j];
          if (local < 0 || rimLocal[ring][2 * k + 1] >= 0) return;
          rimLocal[ring][2 * k] = t;
          rimLocal[ring][2 * k + 1] = local;
        }),
      ),
    );
    let rimDropped = 0;
    const keptRims = rimLocal.map(refs => {
      const mapped: number[] = [];
      let lastTile = -1;
      let lastLocal = -1;
      for (let k = 0; k < refs.length; k += 2) {
        const tile = refs[k];
        const local = refs[k + 1];
        if (local < 0 || (tile === lastTile && local === lastLocal)) continue;
        lastTile = tile;
        lastLocal = local;
        const v = vertexOf(tile, local);
        if (v < 0) rimDropped++;
        else mapped.push(v);
      }
      return mapped;
    });

    const records: number[][] = terminationSets.map(() => []);
    outputs.forEach((o, t) =>
      chainTags[t].forEach((tags, c) => {
        if (!tags) return;
        const verts = o.chains[c];
        for (let k = 0; k < tags.length; k++) {
          if (tags[k] < 0 || verts[k] < 0) continue;
          records[tags[k]].push(vertexOf(t, verts[k]));
        }
      }),
    );
    const terminationVertices = terminations
      ? records.map(record => {
          const kept = record.filter(v => v >= 0);
          return kept.length > 0 ? Uint32Array.from(kept) : null;
        })
      : undefined;

    const fineCoords = stitched.coords;
    // Coarser levels add the vertices only they use — where thinned lines cross —
    // after the full level's, which every per-vertex array is then sized to.
    const extra: number[] = [];
    const levelJoins = lod?.errors.map((_, k) => {
      const outs = outputs.map(o => o.levels![k]);
      return { outs, stitched: stitchStackTiles(outs, seamX, seamY) };
    });
    let levelRemaps: Uint32Array[] | undefined;
    if (levelJoins) {
      const fineCount = fineCoords.length >> 1;
      const known = new Map<string, number>();
      for (let v = 0; v < fineCount; v++) {
        known.set(`${fineCoords[2 * v]},${fineCoords[2 * v + 1]}`, v);
      }
      levelRemaps = levelJoins.map(({ stitched: level }) => {
        const remap = new Uint32Array(level.coords.length >> 1);
        for (let v = 0; v < remap.length; v++) {
          const x = level.coords[2 * v];
          const y = level.coords[2 * v + 1];
          const key = `${x},${y}`;
          let g = known.get(key);
          if (g === undefined) {
            g = fineCount + (extra.length >> 1);
            extra.push(x, y);
            known.set(key, g);
          }
          remap[v] = g;
        }
        return remap;
      });
    }
    const coords = new Float32Array(fineCoords.length + extra.length);
    coords.set(fineCoords);
    coords.set(extra, fineCoords.length);
    const outlineBlends =
      extra.length > 0
        ? blendOntoOutline(coords, indices, fineCoords.length >> 1)
        : undefined;

    // Membership by CENTROID, which is exact because the ring bounding it was
    // constrained: no triangle straddles it, so any interior point decides.
    const flagTriangles = (polys: GridPolygon[], over: Uint32Array) => {
      const test = makeGridInside(polys);
      const flags = new Uint8Array(over.length / 3);
      for (let t = 0; t < flags.length; t++) {
        const a = over[3 * t];
        const b = over[3 * t + 1];
        const c = over[3 * t + 2];
        const cx = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3;
        const cy =
          (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3;
        if (test(cx, cy)) flags[t] = 1;
      }
      return flags;
    };

    const cutFlagsOf = (over: Uint32Array) =>
      cutPolygons.length > 0
        ? cutPolygons.map(polys => flagTriangles(polys, over))
        : undefined;
    const coverageFlagsOf = (over: Uint32Array) => {
      if (!layerRings) return undefined;
      const everywhere = new Uint8Array(over.length / 3).fill(1);
      const bySet = new Map<GridRing[], Uint8Array>();
      return layerRings.map(rings => {
        if (!rings) return everywhere;
        let flags = bySet.get(rings);
        if (!flags) {
          flags = flagTriangles([rings], over);
          bySet.set(rings, flags);
        }
        return flags;
      });
    };
    const cutFlags = cutFlagsOf(indices);
    const coverageFlags = coverageFlagsOf(indices);

    const levels = levelJoins?.map(({ outs, stitched: level }, k) => {
      const remap = levelRemaps![k];
      const levelIndices = level.indices.map(v => remap[v]);
      const marks: number[][] = terminationSets.map(() => []);
      outs.forEach((o, t) =>
        chainTags[t].forEach((tags, c) => {
          if (!tags) return;
          const verts = o.chains[c];
          for (let p = 0; p < tags.length; p++) {
            if (tags[p] < 0 || verts[p] < 0) continue;
            const v = level.vertexOf(t, verts[p]);
            if (v >= 0) marks[tags[p]].push(remap[v]);
          }
        }),
      );
      return {
        error: lod!.errors[k],
        indices: levelIndices,
        tileStarts: tileStartsOf(outs),
        cuts: cutFlagsOf(levelIndices),
        coverage: coverageFlagsOf(levelIndices),
        terminationVertices: terminations
          ? marks.map(m => (m.length > 0 ? Uint32Array.from(m) : null))
          : undefined,
        constraintFailures: outs.reduce(
          (sum, o) => sum + o.constraintFailures,
          0,
        ),
      };
    });

    return {
      coords,
      indices,
      rimVertices: keptRims,
      cuts: cutFlags,
      coverage: coverageFlags,
      coverageRingPoints,
      terminationRingPoints,
      terminationVertices,
      rimDropped,
      constraintFailures: outputs.reduce(
        (sum, o) => sum + o.constraintFailures,
        0,
      ),
      tiling,
      tileStarts: tileStartsOf(outputs),
      levels,
      outlineBlends,
    };
  };

  return { tiles, finish, tiling };
}

/**
 * The vertices from `first` on (those only a coarser level uses) that lie on an
 * outline edge of the full level, with that edge and how far along it.
 */
function blendOntoOutline(
  coords: Float32Array,
  indices: Uint32Array,
  first: number,
): StackTessellation['outlineBlends'] {
  const V = coords.length >> 1;
  const uses = new Map<number, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const u = indices[i + k];
      const v = indices[i + ((k + 1) % 3)];
      const key = u < v ? u * V + v : v * V + u;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  // Outline edges by the grid cells their boxes cover.
  const cells = new Map<number, number[]>();
  const cellKey = (x: number, y: number) => x * 1048576 + y;
  for (const [key, n] of uses) {
    if (n !== 1) continue;
    const a = Math.floor(key / V);
    const b = key - a * V;
    const x0 = Math.floor(Math.min(coords[2 * a], coords[2 * b]));
    const x1 = Math.floor(Math.max(coords[2 * a], coords[2 * b]));
    const y0 = Math.floor(Math.min(coords[2 * a + 1], coords[2 * b + 1]));
    const y1 = Math.floor(Math.max(coords[2 * a + 1], coords[2 * b + 1]));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = cells.get(cellKey(x, y));
        if (list) list.push(a, b);
        else cells.set(cellKey(x, y), [a, b]);
      }
    }
  }
  const vertices: number[] = [];
  const ends: number[] = [];
  const along: number[] = [];
  for (let v = first; v < V; v++) {
    const px = coords[2 * v];
    const py = coords[2 * v + 1];
    const list = cells.get(cellKey(Math.floor(px), Math.floor(py)));
    if (!list) continue;
    for (let i = 0; i < list.length; i += 2) {
      const a = list[i];
      const b = list[i + 1];
      const dx = coords[2 * b] - coords[2 * a];
      const dy = coords[2 * b + 1] - coords[2 * a + 1];
      const len2 = dx * dx + dy * dy;
      const qx = px - coords[2 * a];
      const qy = py - coords[2 * a + 1];
      const t = (qx * dx + qy * dy) / len2;
      // Noded onto the rim, so off it by no more than the float32 coordinates.
      if (
        t <= 0 ||
        t >= 1 ||
        Math.abs(qx * dy - qy * dx) > 1e-4 * Math.sqrt(len2)
      ) {
        continue;
      }
      vertices.push(v);
      ends.push(a, b);
      along.push(t);
      break;
    }
  }
  return vertices.length > 0
    ? {
        vertices: Uint32Array.from(vertices),
        ends: Uint32Array.from(ends),
        along: Float64Array.from(along),
      }
    : undefined;
}

// Stitched tiles keep their triangles in tile order, so a tile starts where the
// ones before it end.
function tileStartsOf(outputs: { triangles: Uint32Array }[]): Uint32Array {
  const starts = new Uint32Array(outputs.length + 1);
  outputs.forEach(
    (o, t) => (starts[t + 1] = starts[t] + o.triangles.length / 3),
  );
  return starts;
}

/**
 * Sample every layer's scene Y at the shared vertices.
 *
 * @returns one `Float32Array` per layer, indexed by shared vertex
 *
 * @group Geometries
 */
export function sampleStackHeights(
  reference: StackReference,
  coords: Float32Array,
): Float32Array[] {
  const { nx, ny } = reference.header;
  const vertices = coords.length >> 1;
  return reference.channels.map(channel => {
    const out = new Float32Array(vertices);
    for (let v = 0; v < vertices; v++) {
      const col = coords[2 * v];
      const row = coords[2 * v + 1];
      // Refinement vertices land on grid nodes; only the rim is fractional.
      out[v] =
        Number.isInteger(col) && Number.isInteger(row)
          ? channel[row * nx + col]
          : sampleValidGrid(channel, nx, ny, col, row, v2 => v2 === NO_DATA, 0);
    }
    return out;
  });
}

/**
 * Make the stack monotone at every shared vertex, so no two surfaces of the stack
 * can interpenetrate anywhere.
 *
 * On a shared tessellation this is exact rather than approximate: each surface is
 * the linear interpolant of its vertex heights over the *same* triangles, and
 * linear interpolation preserves an inequality that holds at all three corners.
 * The heights are modified **in place**.
 *
 * @param heights per-layer vertex heights (shallowest first), as returned by
 *   {@link sampleStackHeights}
 * @param options see {@link StackResolveOptions}
 *
 * @group Geometries
 */
export function resolveStackOrder(
  heights: Float32Array[],
  options: StackResolveOptions = {},
): StackResolveResult {
  const minGap = options.minGap ?? 0;
  const apply = options.apply ?? true;
  const truncate = (options.mode ?? 'truncate') === 'truncate';
  const pairs: StackPairStats[] = [];
  const absent = heights.map(y => new Uint8Array(y.length));
  let total = 0;

  // The authority is the nearest layer above that is part of the depth order, so
  // a fluid boundary in the middle of a stack does not break the chain.
  let authority = -1;
  for (let i = 0; i < heights.length; i++) {
    const fluid = !!options.fluid?.[i];
    // One entry per layer below the first, whether or not it was resolved.
    if (i > 0 && authority < 0) {
      pairs.push({
        index: i,
        crossings: 0,
        crossingsCovered: 0,
        compared: 0,
        maxOverlap: 0,
        maxOverlapCovered: 0,
        moved: 0,
      });
    }
    if (authority < 0) {
      // Nothing above to be clamped by — but a fluid never becomes the authority
      // either, so a sea at the top of a stack leaves the bed below it untouched.
      if (!fluid) authority = i;
      continue;
    }
    const from = authority;
    const above = heights[from];
    const current = heights[i];
    const normalAbove = options.normals?.[from];
    const normal = normalAbove ? options.normals?.[i] : null;
    if (!fluid) authority = i;
    const cut = absent[i];
    const covered = options.coverage;
    let crossings = 0;
    let crossingsCovered = 0;
    let compared = 0;
    let maxOverlap = 0;
    let maxOverlapCovered = 0;
    let moved = 0;
    for (let v = 0; v < current.length; v++) {
      const inData = covered
        ? covered[i][v] === 1 && covered[from][v] === 1
        : true;
      if (inData) compared++;
      const separation = above[v] - current[v];
      if (separation < 0) {
        crossings++;
        if (-separation > maxOverlap) maxOverlap = -separation;
        if (inData) {
          crossingsCovered++;
          if (-separation > maxOverlapCovered) maxOverlapCovered = -separation;
        }
      }
      const limit = above[v] - minGap;
      if (current[v] > limit) {
        if (apply) {
          current[v] = limit;
          if (normal && normalAbove) {
            normal[3 * v] = normalAbove[3 * v];
            normal[3 * v + 1] = normalAbove[3 * v + 1];
            normal[3 * v + 2] = normalAbove[3 * v + 2];
          }
        }
        // The unit had negative thickness here, so it is not present: mark it
        // rather than leaving a welded copy of the surface above.
        if (truncate) cut[v] = 1;
        moved++;
      }
    }
    total += moved;
    pairs.push({
      index: i,
      crossings,
      crossingsCovered,
      compared,
      maxOverlap,
      maxOverlapCovered,
      moved,
    });
  }

  return { pairs, moved: total, applied: apply, absent };
}

/**
 * Make the stack monotone on the COMMON GRID, before anything is tessellated.
 *
 * This is the stack-wide counterpart of {@link resolveStackOrder}: because every
 * layer has been resampled onto the same nodes, the cascade is a plain elementwise
 * `min` down the channels — no resampling, no coverage boundary to taper across,
 * no reference-depth bookkeeping. The channels are modified **in place**.
 *
 * Resolving here rather than per tessellation is what lets several chunks that cut
 * different footprints out of one column agree with each other: they all sample
 * grids that are already ordered. Bilinear sampling is a convex combination, so an
 * ordering that holds at every node holds at every sample point, and each chunk's
 * own triangles then preserve it — so a chunk stays exactly as correct as one built
 * with {@link resolveStackOrder}. What it does NOT give is agreement *between* two
 * chunks' independent triangulations, which stay within `2 * maxError` of each
 * other.
 *
 * @param channels per-layer heights over the common grid (shallowest first)
 * @param options see {@link StackResolveOptions}. `coverage` takes the per-layer
 *   GRID masks (`StackReference.masks`) here rather than vertex masks; without it
 *   the covered statistics repeat the raw ones, and the raw ones count the
 *   reference's hole fill as if it were geology.
 * @returns per-pair statistics, plus the per-layer `absent` masks (in grid space)
 *   that `'truncate'` mode produces
 *
 * @group Geometries
 */
export function resolveStackGrid(
  channels: Float32Array[],
  options: StackResolveOptions = {},
): { pairs: StackPairStats[]; moved: number; absent: Uint8Array[] } {
  const minGap = options.minGap ?? 0;
  const truncate = (options.mode ?? 'truncate') === 'truncate';
  const apply = options.apply ?? true;
  const coverage = options.coverage;
  const absent = channels.map(c => new Uint8Array(c.length));
  const pairs: StackPairStats[] = [];
  let total = 0;

  for (let i = 1; i < channels.length; i++) {
    const above = channels[i - 1];
    const current = channels[i];
    const cut = absent[i];
    const maskAbove = coverage?.[i - 1];
    const maskCurrent = coverage?.[i];
    let crossings = 0;
    let crossingsCovered = 0;
    let compared = current.length;
    let maxOverlap = 0;
    let maxOverlapCovered = 0;
    let moved = 0;
    if (maskAbove && maskCurrent) {
      compared = 0;
      for (let n = 0; n < current.length; n++) {
        if (maskAbove[n] && maskCurrent[n]) compared++;
      }
    }
    for (let n = 0; n < current.length; n++) {
      const separation = above[n] - current[n];
      if (separation < 0) {
        crossings++;
        if (-separation > maxOverlap) maxOverlap = -separation;
        if (!maskAbove || !maskCurrent || (maskAbove[n] && maskCurrent[n])) {
          crossingsCovered++;
          if (-separation > maxOverlapCovered) maxOverlapCovered = -separation;
        }
      }
      const limit = above[n] - minGap;
      if (current[n] > limit) {
        if (apply) current[n] = limit;
        if (truncate) cut[n] = 1;
        moved++;
      }
    }
    total += moved;
    pairs.push({
      index: i,
      crossings,
      crossingsCovered,
      compared,
      maxOverlap,
      maxOverlapCovered,
      moved,
    });
  }

  return { pairs, moved: total, absent };
}

/**
 * A flat surface closing a whole column from below — the datum a stack terminates
 * against, rather than a unit of its own.
 *
 * It is complete over the entire grid and constant in Y, which is what makes it a
 * guarantee: whatever the surfaces above it do, the block has a floor. Nothing may
 * pierce it, so anything that would is truncated at it
 * ({@link clampStackToCarrier}).
 *
 * ⭐ Not a layer with an infinite unit beneath it: there is no interval below a
 * carrier at all, so it has a cap and no fill.
 *
 * @group Geometries
 */
export type StackCarrier = {
  /** absolute, metres below sea level (positive-down, as surfaces are given) */
  depth?: number;
  /**
   * Metres beneath the column's deepest mapped sample — a floor that clears the
   * geology by a fixed margin. Ignored when `depth` is given.
   *
   * ⚠️ Measured over everything the column covers, so it follows the deepest
   * point anywhere in the envelope rather than inside any one chunk.
   */
  below?: number;
};

/**
 * Scene Y of a carrier plane, resolved against the column it closes.
 *
 * @param channels the column's channels, WITHOUT the carrier
 * @param masks the matching coverage masks — the depth is taken from mapped nodes
 *   only, so hole fill past the edge of a survey cannot drag the floor down
 * @param carrier see {@link StackCarrier}
 *
 * @group Geometries
 */
export function stackCarrierLevel(
  channels: Float32Array[],
  masks: Uint8Array[],
  carrier: StackCarrier,
): number {
  if (carrier.depth !== undefined) return -carrier.depth;
  let mapped = Infinity;
  let any = Infinity;
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    const mask = masks[i];
    for (let n = 0; n < channel.length; n++) {
      const y = channel[n];
      if (y < any) any = y;
      if ((!mask || mask[n]) && y < mapped) mapped = y;
    }
  }
  const deepest = Number.isFinite(mapped)
    ? mapped
    : Number.isFinite(any)
      ? any
      : 0;
  return deepest - (carrier.below ?? 0);
}

/**
 * Truncate everything that would pierce the carrier, in place.
 *
 * ⭐ Because a carrier is a CONSTANT plane, "nothing goes below it" is an
 * elementwise `max`, which is order-preserving — so it can never introduce a
 * crossing and needs no cascade of its own, unlike the reversed authority it would
 * otherwise imply (the stack's own resolve clamps the DEEPER surface down).
 *
 * Everything it moves lands exactly ON the plane, so the units below it end up
 * with no thickness and the ordinary collapse drops them; the surfaces themselves
 * are removed by {@link StackCollapseOptions.carrier}, which is what stops a
 * truncated horizon z-fighting with the floor it was flattened onto.
 *
 * @param channels every layer of the column, the carrier included
 * @param carrier index of the carrier's own channel (left untouched)
 * @param level scene Y of the plane
 * @returns per layer, the number of nodes truncated
 *
 * @group Geometries
 */
export function clampStackToCarrier(
  channels: Float32Array[],
  carrier: number,
  level: number,
): number[] {
  return channels.map((channel, i) => {
    if (i === carrier) {
      channel.fill(level);
      return 0;
    }
    let moved = 0;
    for (let n = 0; n < channel.length; n++) {
      if (channel[n] < level) {
        channel[n] = level;
        moved++;
      }
    }
    return moved;
  });
}

/**
 * Build an "inside this polygon" test over the shared vertices.
 *
 * The tessellation's coordinates are in the reference grid's frame, so the polygon
 * is mapped into that same frame once and then queried per vertex — the rim
 * vertices are fractional, which is exactly what the grid-space test expects.
 *
 * @param reference the common domain the vertices index into
 * @param polygon the polygon to test against, in scene XZ
 * @param coords the shared vertices, as returned by {@link tessellateStack}
 * @returns `(vertex) => boolean`
 *
 * @group Geometries
 */
export function makeStackInsideTest(
  reference: StackReference,
  polygon: PlanarPolygonGeometry,
  coords: Float32Array,
): (vertex: number) => boolean {
  const toGrid = surfaceWorldToGrid(reference.header, reference.worldPosition);
  const components = polygon.coordinates as PlanarPolygonCoordinates;
  const gridPolygons: GridPolygon[] = components.map(rings =>
    rings.map(ring => ring.map(([sx, sz]) => toGrid(sx, sz))),
  );
  const inside = makeGridInside(gridPolygons);
  return (vertex: number) => inside(coords[2 * vertex], coords[2 * vertex + 1]);
}

/**
 * Sample each layer's coverage at the shared vertices: 1 within the layer's
 * effective extent, 0 where {@link buildStackReference} filled it in from too far
 * away to count (see {@link StackReferenceOptions.maxFill}).
 *
 * A layer whose survey covers less than the chunk is not "flat" out there — it is
 * ABSENT, and saying so explicitly is both more honest and cheaper than inferring
 * it from a fill value after the fact.
 *
 * ⚠️ Deliberately CONSERVATIVE: a vertex counts as covered when ANY of the four
 * surrounding nodes has data. A rim vertex sits between nodes, so picking the
 * nearest one would mark it uncovered whenever the outline runs just outside the
 * data extent — and since a triangle is dropped once all three of its corners are
 * uncovered, that removes whole triangles (hundreds of metres wide, in the coarse
 * parts of the mesh) from geometry that is actually there.
 *
 * @group Geometries
 */
export function sampleStackMasks(
  reference: StackReference,
  coords: Float32Array,
): Uint8Array[] {
  const { nx, ny } = reference.header;
  const vertices = coords.length >> 1;
  return reference.masks.map(mask => {
    const out = new Uint8Array(vertices);
    for (let v = 0; v < vertices; v++) {
      const col = Math.min(Math.max(coords[2 * v], 0), nx - 1);
      const row = Math.min(Math.max(coords[2 * v + 1], 0), ny - 1);
      const x0 = Math.floor(col);
      const z0 = Math.floor(row);
      const x1 = Math.min(x0 + 1, nx - 1);
      const z1 = Math.min(z0 + 1, ny - 1);
      out[v] =
        mask[z0 * nx + x0] ||
        mask[z0 * nx + x1] ||
        mask[z1 * nx + x0] ||
        mask[z1 * nx + x1]
          ? 1
          : 0;
    }
    return out;
  });
}

/**
 * Sample per-node masks produced in GRID space (e.g. the `absent` masks from
 * {@link resolveStackGrid}) at the shared vertices.
 *
 * ⚠️ The mirror image of {@link sampleStackMasks}, and conservative in the same
 * direction: a vertex is only marked absent when ALL four surrounding nodes are,
 * so a single truncated node cannot take a whole triangle with it.
 *
 * @group Geometries
 */
export function sampleStackGridMasks(
  reference: StackReference,
  coords: Float32Array,
  masks: Uint8Array[],
): Uint8Array[] {
  const { nx, ny } = reference.header;
  const vertices = coords.length >> 1;
  return masks.map(mask => {
    const out = new Uint8Array(vertices);
    for (let v = 0; v < vertices; v++) {
      const col = Math.min(Math.max(coords[2 * v], 0), nx - 1);
      const row = Math.min(Math.max(coords[2 * v + 1], 0), ny - 1);
      const x0 = Math.floor(col);
      const z0 = Math.floor(row);
      const x1 = Math.min(x0 + 1, nx - 1);
      const z1 = Math.min(z0 + 1, ny - 1);
      out[v] =
        mask[z0 * nx + x0] &&
        mask[z0 * nx + x1] &&
        mask[z1 * nx + x0] &&
        mask[z1 * nx + x1]
          ? 1
          : 0;
    }
    return out;
  });
}

/**
 * Sample per-node WEIGHTS produced in grid space (e.g. the seal's `inferred`
 * weights) at the shared vertices.
 *
 * ⚠️ Bilinear, unlike the two mask samplers, which round to a conservative side.
 * A weight is already continuous, so interpolating it is the honest reading — and
 * it is what lets a marking derived from one fade rather than step.
 *
 * @group Geometries
 */
export function sampleStackWeights(
  reference: StackReference,
  coords: Float32Array,
  weights: Float32Array[],
): Float32Array[] {
  const { nx, ny } = reference.header;
  const vertices = coords.length >> 1;
  // Where each vertex reads, worked out once for every layer. Most vertices are
  // grid nodes (`node >= 0`), and bilinear weights at a node ARE the node's
  // value, so those read it directly; only constraint points interpolate.
  const node = new Int32Array(vertices);
  const fx = new Float64Array(vertices);
  const fz = new Float64Array(vertices);
  // the window of nodes the vertices read
  let minCol = nx;
  let maxCol = -1;
  let minRow = ny;
  let maxRow = -1;
  for (let v = 0; v < vertices; v++) {
    const col = Math.min(Math.max(coords[2 * v], 0), nx - 1);
    const row = Math.min(Math.max(coords[2 * v + 1], 0), ny - 1);
    const x0 = Math.floor(col);
    const z0 = Math.floor(row);
    fx[v] = col - x0;
    fz[v] = row - z0;
    node[v] = fx[v] === 0 && fz[v] === 0 ? z0 * nx + x0 : -1;
    if (x0 < minCol) minCol = x0;
    if (z0 < minRow) minRow = z0;
    maxCol = Math.max(maxCol, Math.min(x0 + 1, nx - 1));
    maxRow = Math.max(maxRow, Math.min(z0 + 1, ny - 1));
  }
  return weights.map(weight => {
    const out = new Float32Array(vertices);
    // A layer that needed no inference here is all zero — so is the answer.
    // Scanned over the window only: the weights cover the whole column.
    let any = false;
    for (let row = minRow; row <= maxRow && !any; row++) {
      const end = row * nx + maxCol;
      for (let n = row * nx + minCol; n <= end; n++) {
        if (weight[n] !== 0) {
          any = true;
          break;
        }
      }
    }
    if (!any) return out;

    for (let v = 0; v < vertices; v++) {
      if (node[v] >= 0) {
        out[v] = weight[node[v]];
        continue;
      }
      const col = Math.min(Math.max(coords[2 * v], 0), nx - 1);
      const row = Math.min(Math.max(coords[2 * v + 1], 0), ny - 1);
      const x0 = Math.floor(col);
      const z0 = Math.floor(row);
      const x1 = Math.min(x0 + 1, nx - 1);
      const z1 = Math.min(z0 + 1, ny - 1);
      const a = weight[z0 * nx + x0];
      const b = weight[z0 * nx + x1];
      const c = weight[z1 * nx + x0];
      const d = weight[z1 * nx + x1];
      out[v] =
        (a + (b - a) * fx[v]) * (1 - fz[v]) + (c + (d - c) * fx[v]) * fz[v];
    }
    return out;
  });
}

/**
 * For each layer, the share of its jointly-covered vertices that sit within
 * `threshold` of the layer above — i.e. how much of it is a DUPLICATE of its
 * neighbour.
 *
 * Stratigraphic data routinely carries the same horizon twice (a unit's base pick
 * and the next unit's top pick), and a value near 1 says exactly that. Measure it
 * BEFORE {@link resolveStackOrder}, or the welding will masquerade as duplication.
 * This only reports — deciding what to do about a duplicated horizon needs the
 * host's stratigraphic knowledge.
 *
 * @group Geometries
 */
export function stackDuplicateFractions(
  heights: Float32Array[],
  coverage?: Uint8Array[],
  threshold = 0.5,
): number[] {
  return heights.map((current, i) => {
    if (i === 0) return 0;
    const above = heights[i - 1];
    let compared = 0;
    let same = 0;
    for (let v = 0; v < current.length; v++) {
      if (coverage && (!coverage[i][v] || !coverage[i - 1][v])) continue;
      compared++;
      if (Math.abs(above[v] - current[v]) <= threshold) same++;
    }
    return compared > 0 ? same / compared : 0;
  });
}

/**
 * Measure each layer's depth over the shared vertices — i.e. **inside the chunk's
 * own footprint**, which is the only place its position in the stack matters.
 *
 * `SurfaceMeta.min` / `.max` describe a surface's whole extent, so ordering by
 * them mis-sorts any surface whose relief outside the footprint differs from the
 * relief inside it. These statistics are the measured alternative: sorting the
 * stack by descending `medianY` puts it in the order the data actually implies.
 *
 * @group Geometries
 */
export function stackDepthStats(heights: Float32Array[]): StackLayerDepth[] {
  return heights.map((y, index) => {
    let sum = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let v = 0; v < y.length; v++) {
      const value = y[v];
      sum += value;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
    const sorted = Float32Array.from(y).sort();
    const mid = sorted.length >> 1;
    const medianY =
      sorted.length === 0
        ? NaN
        : sorted.length % 2
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
      index,
      meanY: y.length > 0 ? sum / y.length : NaN,
      medianY,
      minY,
      maxY,
    };
  });
}

/**
 * Drop each layer's triangles where the unit is not present.
 *
 * Two independent reasons, reported separately:
 * - **absent** — the layer has no data there (see {@link StackCollapseOptions.coverage}),
 *   or {@link resolveStackOrder} truncated it away.
 * - **collapsed** — it has welded onto the layer above. After a depth-order pass a
 *   crossing is resolved by pushing the deeper surface onto the shallower one,
 *   which on a shared tessellation leaves two geometrically IDENTICAL triangles at
 *   the same depth — the worst case for the depth buffer, and the last remaining
 *   source of z-fighting. ⚠️ Which of the pair goes is inverted for a void's
 *   ceiling; see {@link StackCollapseOptions.ceiling}.
 *
 * Heights and rims are untouched, so the walls still close and the block stays
 * sealed. A triangle whose thickness has collapsed is dropped only when ALL THREE
 * of its vertices are thin (exact — see {@link makeAbsentTriangleTest}), so a
 * termination follows triangle edges; a triangle reaching past the edge of a
 * layer's DATA is dropped as soon as one vertex is uncovered, so what is drawn
 * stays inside what is mapped.
 *
 * @param heights per-layer vertex heights, already resolved
 * @param indices the shared triangle indices
 * @param options see {@link StackCollapseOptions}
 *
 * @group Geometries
 */
// Whether a layer is absent across a whole TRIANGLE, from whichever of the two
// masks were given. Shared by the collapse and the interval test so they cannot
// drift — the walls have to stop exactly where the surfaces do.
//
// ⭐ The two masks are read with DIFFERENT rules, deliberately:
// - `absent` (a truncation) is derived from the HEIGHTS, which vary linearly over
//   the shared topology, so all three corners cut means the whole triangle is cut.
// - `coverage` is BINARY and interpolates nothing. Requiring all three would mean
//   "draw wherever any corner has data", extending a layer up to a whole triangle
//   past its survey — and in an unmapped flat there is nothing for the refinement
//   to chase, so that triangle can be very large.
// ⭐⭐ Unless the boundary was CONSTRAINED, in which case no triangle straddles it
// and `coverageTriangles` answers exactly, per triangle — neither spilling past
// the survey nor biting into it.
function makeAbsentTriangleTest(
  options: StackCollapseOptions,
  layer: number,
): (t: number, a: number, b: number, c: number) => boolean {
  // An unbounded boundary is a level rather than a mapped surface: it is present
  // everywhere the chunk is, so nothing about it is ever missing.
  if (options.unbounded?.[layer]) return () => false;
  const exact = options.coverageTriangles?.[layer];
  const coverage = exact ? undefined : options.coverage?.[layer];
  const cut = options.absent?.[layer];
  if (!exact && !coverage && !cut) return () => false;
  return (t, a, b, c) =>
    (exact
      ? exact[t] === 0
      : coverage
        ? coverage[a] === 0 || coverage[b] === 0 || coverage[c] === 0
        : false) ||
    (cut ? cut[a] === 1 && cut[b] === 1 && cut[c] === 1 : false);
}

// ⭐ The ONE place a pair's thickness is judged, so the collapse, the intervals
// and everything built on them cannot disagree about where a unit wedges out.
function makeThinTest(
  heights: Float32Array[],
  upper: number,
  lower: number,
  options: StackCollapseOptions,
): (t: number, a: number, b: number, c: number) => boolean {
  const flags = lower === upper + 1 ? options.thin?.[lower] : undefined;
  if (flags) return t => flags[t] === 1;
  const threshold = options.threshold ?? 0.5;
  const top = heights[upper];
  const bottom = heights[lower];
  return (_t, a, b, c) =>
    top[a] - bottom[a] <= threshold &&
    top[b] - bottom[b] <= threshold &&
    top[c] - bottom[c] <= threshold;
}

/**
 * Per pair of adjacent layers whose termination line was constrained into the
 * tessellation, one flag per triangle: 1 where the pair is within `threshold` of
 * each other (see {@link StackCollapseOptions.thin}).
 *
 * A vertex ON the line is at the threshold by construction, so it counts as thin.
 * Every edge bounding a thin region then has both ends at most `threshold` apart,
 * and the wall closing it stays as invisible as the per-corner rule makes it. A
 * triangle with all three corners on the line says nothing at its corners, and is
 * judged by the grid at its centroid.
 *
 * @param reference the common grid the lines were traced on
 * @param tessellation the shared tessellation, carrying `terminationVertices`
 *   for the pairs `(k - 1, k)`, `k = 1, 2, …`
 * @param heights per-layer vertex heights, after the resolve
 * @param threshold the collapse threshold
 * @returns per layer `k`, the flags for the pair `(k - 1, k)`; `null` where no line
 *   was constrained
 *
 * @group Geometries
 */
export function classifyThinTriangles(
  reference: StackReference,
  tessellation: StackTessellation,
  heights: Float32Array[],
  threshold: number,
): (Uint8Array | null)[] {
  const out: (Uint8Array | null)[] = heights.map(() => null);
  const lines = tessellation.terminationVertices;
  if (!lines) return out;
  const { coords, indices } = tessellation;
  const { nx, ny } = reference.header;
  const triangles = indices.length / 3;
  const onLine = new Uint8Array(coords.length >> 1);
  const isNoData = (v: number) => v === NO_DATA;

  lines.forEach((line, p) => {
    const lower = p + 1;
    if (!line || lower >= heights.length) return;
    onLine.fill(0);
    for (let i = 0; i < line.length; i++) onLine[line[i]] = 1;
    const top = heights[lower - 1];
    const bottom = heights[lower];
    const thinAt = (v: number) =>
      onLine[v] === 1 || top[v] - bottom[v] <= threshold;
    const flags = new Uint8Array(triangles);
    for (let t = 0; t < triangles; t++) {
      const a = indices[3 * t];
      const b = indices[3 * t + 1];
      const c = indices[3 * t + 2];
      if (onLine[a] && onLine[b] && onLine[c]) {
        const col = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3;
        const row =
          (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3;
        const above = sampleValidGrid(
          reference.channels[lower - 1],
          nx,
          ny,
          col,
          row,
          isNoData,
          0,
        );
        const below = sampleValidGrid(
          reference.channels[lower],
          nx,
          ny,
          col,
          row,
          isNoData,
          0,
        );
        if (above - below <= threshold) flags[t] = 1;
      } else if (thinAt(a) && thinAt(b) && thinAt(c)) {
        flags[t] = 1;
      }
    }
    out[lower] = flags;
  });
  return out;
}

export function collapseStackTriangles(
  heights: Float32Array[],
  indices: Uint32Array,
  options: StackCollapseOptions = {},
): StackCollapseResult {
  const out: (Uint32Array | null)[] = [];
  const peelOut: (Uint32Array | null)[] = [];
  const dropped: number[] = [];
  const droppedAbsent: number[] = [];
  const droppedCollapsed: number[] = [];
  const droppedExcluded: number[] = [];

  heights.forEach((_, layer) => {
    const coverage =
      options.coverageTriangles?.[layer] ?? options.coverage?.[layer];
    const cut = options.absent?.[layer];
    // A void's ceiling is the invention of the pair, so it yields to the horizon
    // BELOW it instead of the horizon below yielding to it.
    const isCeiling = options.ceiling?.[layer] === true;
    const isCarrier = options.carrier === layer;
    const isUnbounded = options.unbounded?.[layer] === true;
    // The nearest layer above that this one can be a duplicate of. The sea is not
    // one: ground standing above the water plane is not a copy of it.
    let up = layer - 1;
    while (up >= 0 && options.unbounded?.[up]) up--;
    const aboveIsCeiling = up >= 0 && options.ceiling?.[up] === true;
    // The shallowest layer has nothing above it to collapse onto, but it can
    // still be absent. The carrier has something above it and yields to none of
    // it — it is the floor. The sea's own lid is always drawn.
    const above =
      up >= 0 && !aboveIsCeiling && !isCarrier && !isUnbounded
        ? heights[up]
        : null;
    const below = isCeiling ? (heights[layer + 1] ?? null) : null;
    // Whatever the carrier truncated is sitting exactly on it.
    const floor =
      options.carrier !== undefined && !isCarrier && !isUnbounded
        ? (heights[options.carrier] ?? null)
        : null;
    const aboveThin = above ? makeThinTest(heights, up, layer, options) : null;
    const belowThin = below
      ? makeThinTest(heights, layer, layer + 1, options)
      : null;
    const floorThin = floor
      ? makeThinTest(heights, layer, options.carrier!, options)
      : null;
    const excluded = options.capExcluded?.[layer] ?? null;
    const nothingToDrop =
      isUnbounded || (!coverage && !cut && !above && !below && !floor);
    if (nothingToDrop && !excluded) {
      out.push(null);
      peelOut.push(null);
      dropped.push(0);
      droppedAbsent.push(0);
      droppedCollapsed.push(0);
      droppedExcluded.push(0);
      return;
    }

    const missing = makeAbsentTriangleTest(options, layer);
    // The same test WITHOUT the truncation mask: a truncation is a clamp onto a
    // shallower layer, so it says nothing about whether the surface exists — only
    // that something above is covering it.
    const uncovered = options.peelable
      ? makeAbsentTriangleTest({ ...options, absent: undefined }, layer)
      : null;

    const kept = new Uint32Array(indices.length);
    const peelKept = uncovered ? new Uint32Array(indices.length) : null;
    let n = 0;
    let peelN = 0;
    let absentDrops = 0;
    let collapsedDrops = 0;
    let excludedDrops = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      const t = i / 3;
      if (excluded && excluded[t] === 1) {
        excludedDrops++;
        continue;
      }
      // Neither of these references a layer above, so they hold for the peel set
      // too: a void's ceiling yields to the horizon below it, and everything
      // flattened onto the floor is the floor.
      const belowDrop = !!belowThin && belowThin(t, a, b, c);
      const floorDrop = !!floorThin && floorThin(t, a, b, c);
      if (peelKept && !belowDrop && !floorDrop && !uncovered!(t, a, b, c)) {
        peelKept[peelN++] = a;
        peelKept[peelN++] = b;
        peelKept[peelN++] = c;
      }

      if (missing(t, a, b, c)) {
        absentDrops++;
        continue;
      }
      if (aboveThin && aboveThin(t, a, b, c)) {
        collapsedDrops++;
        continue;
      }
      if (belowDrop || floorDrop) {
        collapsedDrops++;
        continue;
      }
      kept[n++] = a;
      kept[n++] = b;
      kept[n++] = c;
    }
    const drops = absentDrops + collapsedDrops + excludedDrops;
    out.push(drops > 0 ? kept.slice(0, n) : null);
    // Only worth carrying when it actually restores something.
    peelOut.push(peelKept && peelN > n ? peelKept.slice(0, peelN) : null);
    dropped.push(drops);
    droppedAbsent.push(absentDrops);
    droppedCollapsed.push(collapsedDrops);
    droppedExcluded.push(excludedDrops);
  });

  return {
    indices: out,
    peelIndices: options.peelable ? peelOut : undefined,
    dropped,
    droppedAbsent,
    droppedCollapsed,
    droppedExcluded,
  };
}

/**
 * Which of the shared triangles each INTERVAL occupies — the volume between two
 * adjacent layers, as opposed to {@link collapseStackTriangles}, which answers the
 * same question for the surfaces.
 *
 * The interval exists where it has thickness and where each of its two bounding
 * surfaces is present — by the same test the collapse uses
 * ({@link makeAbsentTriangleTest}), so an interval's triangles are a subset of the
 * ones its lower surface draws and the wall traced around them meets that
 * surface's edge. ⚠️ Note this is NOT the intersection of the two layers' KEPT
 * sets: a layer dropped for being coincident with the one above it (the interval
 * ABOVE it is empty) still bounds a perfectly real volume below. Using the kept
 * sets would delete those volumes.
 *
 * @param heights per-layer vertex heights, after the resolve
 * @param indices the shared triangle indices
 * @param options the same masks and threshold the collapse was given
 * @returns one mask per interval (`length - 1` of them): 1 where the volume
 *   between layer `i` and layer `i + 1` is present
 *
 * @group Geometries
 */
export function stackIntervalTriangles(
  heights: Float32Array[],
  indices: Uint32Array,
  options: StackCollapseOptions = {},
): Uint8Array[] {
  return stackIntervalMembers(stackIntervalStates(heights, indices, options));
}

/** {@link stackIntervalStates}: a bounding surface is missing over the triangle. */
export const INTERVAL_MISSING = 0;
/** {@link stackIntervalStates}: the interval holds a volume over the triangle. */
export const INTERVAL_PRESENT = 1;
/**
 * {@link stackIntervalStates}: both bounding surfaces are there but coincide
 * (within the collapse threshold) — no volume, and nothing BETWEEN them either.
 */
export const INTERVAL_FLAT = 2;

/**
 * {@link stackIntervalTriangles} with the empty case split in two: a FLAT interval
 * (both surfaces present, no thickness) is told apart from a MISSING one.
 *
 * ⭐ The difference matters to anything walking a column of intervals: a flat one
 * can be stepped over (its two surfaces are one), a missing one cannot (something
 * is open there). See {@link stackCapNeighbours}.
 *
 * @returns one array per interval, of {@link INTERVAL_MISSING},
 *   {@link INTERVAL_PRESENT} or {@link INTERVAL_FLAT} per triangle
 *
 * @group Geometries
 */
export function stackIntervalStates(
  heights: Float32Array[],
  indices: Uint32Array,
  options: StackCollapseOptions = {},
): Uint8Array[] {
  const triangles = indices.length / 3;
  const out: Uint8Array[] = [];

  for (let i = 0; i + 1 < heights.length; i++) {
    const topMissing = makeAbsentTriangleTest(options, i);
    const bottomMissing = makeAbsentTriangleTest(options, i + 1);
    const thin = makeThinTest(heights, i, i + 1, options);
    const state = new Uint8Array(triangles);
    for (let t = 0; t < triangles; t++) {
      const a = indices[3 * t];
      const b = indices[3 * t + 1];
      const c = indices[3 * t + 2];
      if (topMissing(t, a, b, c)) continue;
      if (bottomMissing(t, a, b, c)) continue;
      state[t] = thin(t, a, b, c) ? INTERVAL_FLAT : INTERVAL_PRESENT;
    }
    out.push(state);
  }

  return out;
}

/**
 * Turn {@link stackIntervalStates} into {@link stackIntervalTriangles}' 0/1 masks
 * IN PLACE, and return them.
 *
 * @group Geometries
 */
export function stackIntervalMembers(states: Uint8Array[]): Uint8Array[] {
  for (const state of states) {
    for (let t = 0; t < state.length; t++) {
      if (state[t] === INTERVAL_FLAT) state[t] = INTERVAL_MISSING;
    }
  }
  return states;
}

/**
 * A cap side with no solid unit against it — open air, a void, or a hole in the
 * stack. See {@link StackCapNeighbours}.
 *
 * @group Geometries
 */
export const CAP_SIDE_OPEN = 255;

/**
 * What one cap has against either face, per triangle it KEEPS (in the order of
 * its own index): the id of the interval directly above and directly below, or
 * {@link CAP_SIDE_OPEN}.
 *
 * ⭐ What lets a renderer skip a cap that cannot be seen: a cap triangle with a
 * filled unit against BOTH faces is buried inside solid rock. Which units count
 * as solid is a per-frame question (peel, cut, opacity, where the camera is), so
 * only the topology is answered here.
 *
 * @group Geometries
 */
export type StackCapNeighbours = {
  above: Uint8Array;
  below: Uint8Array;
  /** the distinct interval ids in `above` and `below`, ascending, without {@link CAP_SIDE_OPEN} */
  units: number[];
};

/**
 * Per triangle of `subset`, its triangle number in `shared` — `subset` being an
 * in-order subsequence of `shared`, as every collapse output is.
 */
function subsetTriangles(shared: Uint32Array, subset: Uint32Array) {
  const ids = new Uint32Array(subset.length / 3);
  let j = 0;
  for (let i = 0; i < shared.length && j < subset.length; i += 3) {
    if (
      shared[i] === subset[j] &&
      shared[i + 1] === subset[j + 1] &&
      shared[i + 2] === subset[j + 2]
    ) {
      ids[j / 3] = i / 3;
      j += 3;
    }
  }
  return ids;
}

/**
 * The solid unit, if any, directly above and below each triangle every cap keeps
 * (see {@link StackCapNeighbours}).
 *
 * The walk from a cap steps over FLAT intervals (two surfaces that are one) and
 * stops at the first that is not: a present, filled interval is the neighbour;
 * anything else — a missing interval, an unfilled one (a void or a gap), the end
 * of the stack — is {@link CAP_SIDE_OPEN}.
 *
 * ⚠️ Must run on the indices as the collapse emitted them, BEFORE any winding
 * fix-up: the kept triangles are matched against the shared ones by their vertex
 * triples, in order.
 *
 * @param states per interval, from {@link stackIntervalStates}
 * @param fills per layer: whether the interval BELOW it is filled
 * @param indices the shared triangle indices
 * @param kept per layer, the collapse's kept subset; `null` = the shared set
 * @param caps per layer: whether it has a cap at all; omitted = every layer
 * @returns per layer, the neighbours of its kept triangles; `null` for a layer
 *   with no cap, and for every layer when the stack has more intervals than an
 *   id byte can hold (254)
 *
 * @group Geometries
 */
export function stackCapNeighbours(
  states: Uint8Array[],
  fills: boolean[],
  indices: Uint32Array,
  kept?: (Uint32Array | null)[],
  caps?: boolean[],
): (StackCapNeighbours | null)[] {
  const layers = states.length + 1;
  if (states.length >= CAP_SIDE_OPEN) return new Array(layers).fill(null);
  const all = new Uint32Array(indices.length / 3);
  for (let t = 0; t < all.length; t++) all[t] = t;

  const out: (StackCapNeighbours | null)[] = [];
  for (let layer = 0; layer < layers; layer++) {
    if (caps && caps[layer] === false) {
      out.push(null);
      continue;
    }
    const own = kept?.[layer];
    const ids = own ? subsetTriangles(indices, own) : all;
    const above = new Uint8Array(ids.length);
    const below = new Uint8Array(ids.length);
    const seen = new Uint8Array(CAP_SIDE_OPEN + 1);
    for (let k = 0; k < ids.length; k++) {
      const t = ids[k];
      let up = CAP_SIDE_OPEN;
      for (let j = layer - 1; j >= 0; j--) {
        const state = states[j][t];
        if (state === INTERVAL_FLAT) continue;
        if (state === INTERVAL_PRESENT && fills[j]) up = j;
        break;
      }
      let down = CAP_SIDE_OPEN;
      for (let j = layer; j < states.length; j++) {
        const state = states[j][t];
        if (state === INTERVAL_FLAT) continue;
        if (state === INTERVAL_PRESENT && fills[j]) down = j;
        break;
      }
      above[k] = up;
      below[k] = down;
      seen[up] = 1;
      seen[down] = 1;
    }
    const units: number[] = [];
    for (let u = 0; u < CAP_SIDE_OPEN; u++) if (seen[u]) units.push(u);
    out.push({ above, below, units });
  }
  return out;
}

/**
 * Scene XZ of every shared vertex — the placement all layers have in common.
 *
 * @returns `[x0, z0, x1, z1, ...]`
 *
 * @group Geometries
 */
export function stackVertexPositions(
  reference: StackReference,
  coords: Float32Array,
): Float32Array {
  const toWorld = surfaceGridToWorld(reference.header, reference.worldPosition);
  const vertices = coords.length >> 1;
  const out = new Float32Array(vertices * 2);
  for (let v = 0; v < vertices; v++) {
    const [x, z] = toWorld(coords[2 * v], coords[2 * v + 1]);
    out[2 * v] = x;
    out[2 * v + 1] = z;
  }
  return out;
}

/**
 * Grid-space `[0, 1]` UVs of the shared vertices **in one layer's own grid**, so a
 * layer of a shared tessellation can still be textured (or shaded by
 * `SurfaceMaterial`) exactly as a standalone surface would be.
 *
 * A synthetic layer has no grid of its own, so it gets the shared tessellation's
 * own `[0, 1]` span instead — enough for a material that only needs *some* UVs.
 *
 * @returns `[u0, v0, u1, v1, ...]`
 *
 * @group Geometries
 */
export function stackLayerUvs(
  reference: StackReference,
  coords: Float32Array,
  layer: StackLayer,
): Float32Array {
  const target = isSyntheticLayer(layer) ? reference : layer;
  const { a, b, c, d, e, f } = isSyntheticLayer(layer)
    ? { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }
    : gridToGridTransform(
        reference.header,
        reference.worldPosition,
        layer.header,
        layer.worldPosition,
      );
  const uDen = target.header.nx - 1;
  const vDen = target.header.ny - 1;
  const vertices = coords.length >> 1;
  const out = new Float32Array(vertices * 2);
  for (let v = 0; v < vertices; v++) {
    const col = coords[2 * v];
    const row = coords[2 * v + 1];
    out[2 * v] = (a * col + b * row + c) / uDen;
    out[2 * v + 1] = 1 - (d * col + e * row + f) / vDen;
  }
  return out;
}

/**
 * Each layer's depth at the shared rim vertices, in the ring shape the wall
 * builder expects (`rimY[ring][vertex]`).
 *
 * @group Geometries
 */
export function stackRimHeights(
  heights: Float32Array,
  rimVertices: number[][],
): number[][] {
  return rimVertices.map(ring => ring.map(v => heights[v]));
}

/**
 * The shared rim rings in scene XZ, matching {@link stackRimHeights} vertex for
 * vertex — the rim the walls are built on.
 *
 * @group Geometries
 */
export function stackRimRings(
  positions: Float32Array,
  rimVertices: number[][],
): Coordinates2D[] {
  return rimVertices.map(ring =>
    ring.map(v => [positions[2 * v], positions[2 * v + 1]] as Vec2),
  );
}
