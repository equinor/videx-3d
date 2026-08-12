import { Vec2 } from '../types/common';
import { chamferFill } from './chamfer';
import { Delatin } from './delatin';
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
  surfaceGridBounds,
  surfaceGridToWorld,
  surfaceWorldToGrid,
} from './surface-clip';
import {
  collectStackCandidates,
  STACK_NO_DATA,
} from './surface-stack-candidates';
import {
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
export const STACK_MASK_NONE = 0;
/** {@link StackReference.masks}: the layer has data of its own at this node. */
export const STACK_MASK_DATA = 1;
/**
 * {@link StackReference.masks}: no data of the layer's own, but close enough to
 * some that {@link StackReferenceOptions.maxFill} counts the node as covered.
 */
export const STACK_MASK_FILLED = 2;

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
};

/** The result of {@link collapseStackTriangles}. */
export type StackCollapseResult = {
  /** per layer: a reduced index array, or `null` when nothing was dropped */
  indices: (Uint32Array | null)[];
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

// Fill every invalid node from the nearest valid one (see `chamferFill`). A
// continuous extension rather than a hard edge matters because the triangulator
// chases discontinuities: a cliff at a data boundary costs a dense cluster of
// slivers for geometry that is either outside the mask or about to be truncated.
//
// `limit` (in CELLS) bounds how far the fill counts as coverage: nodes within it
// are marked STACK_MASK_FILLED, everything beyond keeps its filled value but stays
// absent. The distance is already computed by the fill, so bounding it is free.
function fillNearest(
  values: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  limit: number,
) {
  const dist = chamferFill(values, mask, w, h);
  if (limit < Infinity) {
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] && dist[i] <= limit) mask[i] = STACK_MASK_FILLED;
    }
  }
}

// Bilinear sample over the VALID corners only, without clamping into the grid:
// returns NaN outside the grid or where all four corners are missing.
function sampleStrict(
  values: Float32Array,
  nx: number,
  ny: number,
  fx: number,
  fz: number,
  nullValue: number,
): number {
  if (!(fx >= 0 && fx <= nx - 1 && fz >= 0 && fz <= ny - 1)) return NaN;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, nx - 1);
  const z1 = Math.min(z0 + 1, ny - 1);
  const tx = fx - x0;
  const tz = fz - z0;
  let sum = 0;
  let wsum = 0;
  const add = (col: number, row: number, w: number) => {
    const v = values[row * nx + col];
    if (v !== nullValue && v >= 0) {
      sum += v * w;
      wsum += w;
    }
  };
  add(x0, z0, (1 - tx) * (1 - tz));
  add(x1, z0, tx * (1 - tz));
  add(x0, z1, (1 - tx) * tz);
  add(x1, z1, tx * tz);
  return wsum > 0 ? sum / wsum : NaN;
}

/**
 * Resample a stack of surfaces onto one common grid — the first half of the
 * shared-tessellation build.
 *
 * The finest-resolution layer's grid, cropped to the mask, defines the common
 * domain; every layer is bilinearly resampled onto it and converted to **scene Y**
 * so all downstream work (tessellation, ordering, geometry) speaks one coordinate
 * system. Layers keep their own grids untouched.
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
  if (layers.length === 0) return null;
  const margin = options.margin ?? 2;
  const maxNodes = options.maxNodes ?? 4_000_000;

  // The finest layer defines the common domain, so no layer is resampled up.
  // Synthetic layers have no grid to offer, so at least one real one is needed.
  let best = -1;
  let bestArea = Infinity;
  layers.forEach((layer, i) => {
    if (isSyntheticLayer(layer)) return;
    const area = layer.header.xinc * layer.header.yinc;
    if (area < bestArea) {
      bestArea = area;
      best = i;
    }
  });
  if (best < 0) return null;
  const source = layers[best] as StackGridLayer;
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

  // Decimate when the window is bigger than the node budget.
  const step = Math.max(
    1,
    Math.ceil(Math.sqrt((cropW * cropH) / Math.max(1, maxNodes))),
  );
  const nx = Math.floor((cropW - 1) / step) + 1;
  const ny = Math.floor((cropH - 1) / step) + 1;
  if (nx < 2 || ny < 2) return null;

  const header: SurfaceClipHeader = {
    nx,
    ny,
    xinc: source.header.xinc * step,
    yinc: source.header.yinc * step,
    rot: source.header.rot,
  };

  // `maxFill` is given in metres so it survives decimation and means the same
  // thing on any survey; the chamfer transform counts in cells of THIS grid.
  const cell = (header.xinc + header.yinc) / 2;
  const fillLimit =
    options.maxFill !== undefined && options.maxFill >= 0
      ? options.maxFill / cell
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

  const channels: Float32Array[] = [];
  const masks: Uint8Array[] = [];
  const empty: boolean[] = [];
  const count = nx * ny;

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
      continue;
    }
    const nullValue = layer.nullValue ?? -1;
    const channel = new Float32Array(count);
    const mask = new Uint8Array(count);
    const { a, b, c, d, e, f } = gridToGridTransform(
      header,
      worldPosition,
      layer.header,
      layer.worldPosition,
    );
    const lnx = layer.header.nx;
    const lny = layer.header.ny;
    let any = false;
    for (let row = 0; row < ny; row++) {
      let col2 = b * row + c;
      let row2 = e * row + f;
      const out = row * nx;
      for (let col = 0; col < nx; col++, col2 += a, row2 += d) {
        const v = sampleStrict(layer.values, lnx, lny, col2, row2, nullValue);
        if (Number.isNaN(v)) {
          channel[out + col] = NO_DATA;
        } else {
          // scene Y (upwards-positive, sea level at 0)
          channel[out + col] = v - layer.referenceDepth;
          mask[out + col] = STACK_MASK_DATA;
          any = true;
        }
      }
    }
    if (any) fillNearest(channel, mask, nx, ny, fillLimit);
    channels.push(channel);
    masks.push(mask);
    empty.push(!any);
  }

  // ⚠️ A layer with NO data ANYWHERE — a horizon eroded away across the whole
  // area, or a survey that misses this footprint entirely — has nothing to fill
  // from, so its channel would stay at the NO_DATA sentinel (-1e30) and be drawn
  // as a surface reaching to infinity. Lay it on its nearest mapped neighbour
  // instead: zero thickness, so it claims no volume and the collapse drops it.
  // The mask stays empty, so absence and the diagnostics remain truthful.
  for (let i = 0; i < channels.length; i++) {
    if (!empty[i]) continue;
    let donor = -1;
    for (let j = i - 1; j >= 0 && donor < 0; j--) if (!empty[j]) donor = j;
    for (let j = i + 1; j < channels.length && donor < 0; j++) {
      if (!empty[j]) donor = j;
    }
    if (donor >= 0) channels[i].set(channels[donor]);
  }

  return { header, worldPosition, channels, masks, step };
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
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      if (insidePolygon(col, row)) inside[row * nx + col] = 1;
    }
  }
  return inside;
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
 * ⭐ Deduped by mask IDENTITY: surveys routinely share one interpreted polygon
 * (11 of the demo set's surfaces do), and untouched masks are shared by reference
 * down the whole column, so the trace runs once per distinct extent rather than
 * once per layer.
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
  return masks.map(mask => {
    const known = traced.get(mask);
    if (known !== undefined) return known;
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
): StackTessellation | null {
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

  // ⚠️ A cut rim CROSSES this chunk's rim — that is what makes it a partial
  // overlap. Two crossing constraint edges can only both follow mesh edges if the
  // crossing is itself a vertex, so they are noded first (`nodeGridRings`);
  // without it the triangulator silently drops one of the two boundaries. A data
  // boundary crosses the rim and the other layers' boundaries the same way.
  if (cutPolygons.length > 0 || coverageSets.length > 0) {
    const flat: GridRing[] = [];
    const visit = (polys: GridPolygon[]) =>
      polys.forEach(rings => rings.forEach(ring => flat.push(ring)));
    visit(gridPolygons);
    cutPolygons.forEach(visit);
    visit(coverageSets);
    const noded = nodeGridRings(flat);
    if (noded !== flat) {
      let at = 0;
      const replace = (polys: GridPolygon[]) =>
        polys.forEach((rings, ci) => {
          polys[ci] = rings.map(() => noded[at++]);
        });
      replace(gridPolygons);
      cutPolygons.forEach(replace);
      replace(coverageSets);
    }
  }

  // Union of every layer's refinement vertices, as reference grid node indices.
  const union = new Set<number>();
  const lists =
    candidates ??
    reference.channels.map(channel =>
      collectStackCandidates(channel, nx, maxError),
    );
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) union.add(list[i]);
  }

  // Corners come with the bootstrap triangulation.
  const master = new Delatin(reference.channels[0], nx, NO_DATA);
  master.beginConstraints();
  union.delete(0);
  union.delete(nx - 1);
  union.delete((ny - 1) * nx);
  union.delete((ny - 1) * nx + nx - 1);

  // Insert row by row: consecutive points are adjacent, so the locate walk that
  // Delatin starts from its last hit resolves in a couple of steps.
  const nodes = Array.from(union).sort((p, q) => p - q);
  for (const node of nodes) {
    const col = node % nx;
    const row = (node - col) / nx;
    master.insertPoint(col, row, 0);
  }

  // The rim: inserted as explicit points and locked as constraint edges, so every
  // layer's boundary lands on exactly the same vertices as the walls.
  const clampCol = (x: number) => Math.min(Math.max(x, 0), nx - 1);
  const clampRow = (y: number) => Math.min(Math.max(y, 0), ny - 1);
  const rimVertices: number[][] = [];
  for (const poly of gridPolygons) {
    for (const ring of poly) {
      const verts: number[] = [];
      for (const [gx, gy] of ring) {
        const vi = master.insertPoint(clampCol(gx), clampRow(gy), 0);
        if (vi >= 0 && vi !== verts[verts.length - 1]) verts.push(vi);
      }
      if (verts.length >= 3) {
        for (let i = 0; i < verts.length; i++) {
          master.constrainEdge(verts[i], verts[(i + 1) % verts.length]);
        }
      }
      rimVertices.push(verts);
    }
  }

  // A cut is constrained but never closed: it only has to bound the part of THIS
  // chunk that a neighbour also draws, so where it leaves the reference grid the
  // chain simply restarts. A data boundary is enforced the same way.
  let coverageRingPoints = 0;
  const constrainRing = (ring: GridRing) => {
    let prev = -1;
    for (let i = 0; i <= ring.length; i++) {
      const [gx, gy] = ring[i % ring.length];
      if (gx < 0 || gx > nx - 1 || gy < 0 || gy > ny - 1) {
        prev = -1;
        continue;
      }
      const vi = master.insertPoint(gx, gy, 0);
      if (vi < 0) {
        prev = -1;
        continue;
      }
      if (prev >= 0 && vi !== prev) master.constrainEdge(prev, vi);
      prev = vi;
    }
  };
  for (const cut of cutPolygons) {
    for (const poly of cut) {
      for (const ring of poly) constrainRing(ring);
    }
  }
  for (const set of coverageSets) {
    for (const ring of set) {
      coverageRingPoints += ring.length;
      constrainRing(ring);
    }
  }

  master.removeExteriorTriangles(makeGridInside(gridPolygons));
  if (master.triangles.length === 0) return null;

  // Compact: the trimmed triangulation keeps every vertex ever inserted, and the
  // stack pays for each one N times over (one Y per layer).
  const remap = new Int32Array(master.coords.length >> 1).fill(-1);
  const indices = new Uint32Array(master.triangles.length);
  const coordList: number[] = [];
  for (let i = 0; i < master.triangles.length; i++) {
    const v = master.triangles[i];
    let mapped = remap[v];
    if (mapped < 0) {
      mapped = coordList.length >> 1;
      remap[v] = mapped;
      coordList.push(master.coords[2 * v], master.coords[2 * v + 1]);
    }
    indices[i] = mapped;
  }

  let rimDropped = 0;
  const keptRims = rimVertices.map(ring => {
    const mapped: number[] = [];
    for (const v of ring) {
      if (remap[v] >= 0) mapped.push(remap[v]);
      else rimDropped++;
    }
    return mapped;
  });

  const coords = Float32Array.from(coordList);

  const triangles = indices.length / 3;
  // Membership by CENTROID, which is exact because the ring bounding it was
  // constrained: no triangle straddles it, so any interior point decides.
  const flagTriangles = (polys: GridPolygon[]) => {
    const test = makeGridInside(polys);
    const flags = new Uint8Array(triangles);
    for (let t = 0; t < triangles; t++) {
      const a = indices[3 * t];
      const b = indices[3 * t + 1];
      const c = indices[3 * t + 2];
      const cx = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3;
      const cy =
        (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3;
      if (test(cx, cy)) flags[t] = 1;
    }
    return flags;
  };

  const cutFlags =
    cutPolygons.length > 0 ? cutPolygons.map(flagTriangles) : undefined;

  let coverageFlags: Uint8Array[] | undefined;
  if (layerRings) {
    const everywhere = new Uint8Array(triangles).fill(1);
    const bySet = new Map<GridRing[], Uint8Array>();
    coverageFlags = layerRings.map(rings => {
      if (!rings) return everywhere;
      let flags = bySet.get(rings);
      if (!flags) {
        flags = flagTriangles([rings]);
        bySet.set(rings, flags);
      }
      return flags;
    });
  }

  return {
    coords,
    indices,
    rimVertices: keptRims,
    cuts: cutFlags,
    coverage: coverageFlags,
    coverageRingPoints,
    rimDropped,
    constraintFailures: master.constraintFailures,
  };
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

  for (let i = 1; i < heights.length; i++) {
    const above = heights[i - 1];
    const current = heights[i];
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
        ? covered[i][v] === 1 && covered[i - 1][v] === 1
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
        if (apply) current[v] = limit;
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
  return weights.map(weight => {
    const out = new Float32Array(vertices);
    for (let v = 0; v < vertices; v++) {
      const col = Math.min(Math.max(coords[2 * v], 0), nx - 1);
      const row = Math.min(Math.max(coords[2 * v + 1], 0), ny - 1);
      const x0 = Math.floor(col);
      const z0 = Math.floor(row);
      const x1 = Math.min(x0 + 1, nx - 1);
      const z1 = Math.min(z0 + 1, ny - 1);
      const fx = col - x0;
      const fz = row - z0;
      const a = weight[z0 * nx + x0];
      const b = weight[z0 * nx + x1];
      const c = weight[z1 * nx + x0];
      const d = weight[z1 * nx + x1];
      out[v] = (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
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

export function collapseStackTriangles(
  heights: Float32Array[],
  indices: Uint32Array,
  options: StackCollapseOptions = {},
): StackCollapseResult {
  const threshold = options.threshold ?? 0.5;
  const out: (Uint32Array | null)[] = [];
  const dropped: number[] = [];
  const droppedAbsent: number[] = [];
  const droppedCollapsed: number[] = [];
  const droppedExcluded: number[] = [];

  heights.forEach((current, layer) => {
    const coverage =
      options.coverageTriangles?.[layer] ?? options.coverage?.[layer];
    const cut = options.absent?.[layer];
    // A void's ceiling is the invention of the pair, so it yields to the horizon
    // BELOW it instead of the horizon below yielding to it.
    const isCeiling = options.ceiling?.[layer] === true;
    const aboveIsCeiling = layer > 0 && options.ceiling?.[layer - 1] === true;
    const isCarrier = options.carrier === layer;
    // The shallowest layer has nothing above it to collapse onto, but it can
    // still be absent. The carrier has something above it and yields to none of
    // it — it is the floor.
    const above =
      layer > 0 && !aboveIsCeiling && !isCarrier ? heights[layer - 1] : null;
    const below = isCeiling ? (heights[layer + 1] ?? null) : null;
    // Whatever the carrier truncated is sitting exactly on it.
    const floor =
      options.carrier !== undefined && !isCarrier
        ? (heights[options.carrier] ?? null)
        : null;
    const excluded = options.capExcluded?.[layer] ?? null;
    if (!coverage && !cut && !above && !below && !floor && !excluded) {
      out.push(null);
      dropped.push(0);
      droppedAbsent.push(0);
      droppedCollapsed.push(0);
      droppedExcluded.push(0);
      return;
    }

    const missing = makeAbsentTriangleTest(options, layer);

    const kept = new Uint32Array(indices.length);
    let n = 0;
    let absentDrops = 0;
    let collapsedDrops = 0;
    let excludedDrops = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      if (excluded && excluded[i / 3] === 1) {
        excludedDrops++;
        continue;
      }
      if (missing(i / 3, a, b, c)) {
        absentDrops++;
        continue;
      }
      if (
        above &&
        above[a] - current[a] <= threshold &&
        above[b] - current[b] <= threshold &&
        above[c] - current[c] <= threshold
      ) {
        collapsedDrops++;
        continue;
      }
      // A ceiling that has closed onto the horizon below it is a duplicate of it,
      // and the horizon is the one worth keeping.
      if (
        below &&
        current[a] - below[a] <= threshold &&
        current[b] - below[b] <= threshold &&
        current[c] - below[c] <= threshold
      ) {
        collapsedDrops++;
        continue;
      }
      if (
        floor &&
        current[a] - floor[a] <= threshold &&
        current[b] - floor[b] <= threshold &&
        current[c] - floor[c] <= threshold
      ) {
        collapsedDrops++;
        continue;
      }
      kept[n++] = a;
      kept[n++] = b;
      kept[n++] = c;
    }
    const drops = absentDrops + collapsedDrops + excludedDrops;
    out.push(drops > 0 ? kept.slice(0, n) : null);
    dropped.push(drops);
    droppedAbsent.push(absentDrops);
    droppedCollapsed.push(collapsedDrops);
    droppedExcluded.push(excludedDrops);
  });

  return {
    indices: out,
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
  const threshold = options.threshold ?? 0.5;
  const triangles = indices.length / 3;
  const out: Uint8Array[] = [];

  for (let i = 0; i + 1 < heights.length; i++) {
    const top = heights[i];
    const bottom = heights[i + 1];
    const topMissing = makeAbsentTriangleTest(options, i);
    const bottomMissing = makeAbsentTriangleTest(options, i + 1);
    const member = new Uint8Array(triangles);
    for (let t = 0; t < triangles; t++) {
      const a = indices[3 * t];
      const b = indices[3 * t + 1];
      const c = indices[3 * t + 2];
      if (topMissing(t, a, b, c)) continue;
      if (bottomMissing(t, a, b, c)) continue;
      if (
        top[a] - bottom[a] <= threshold &&
        top[b] - bottom[b] <= threshold &&
        top[c] - bottom[c] <= threshold
      ) {
        continue;
      }
      member[t] = 1;
    }
    out.push(member);
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
