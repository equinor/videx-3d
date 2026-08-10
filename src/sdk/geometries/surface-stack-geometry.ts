import { BufferAttribute, BufferGeometry } from 'three';
import { computeUpwardNormals } from './geometry-attributes';
import { Coordinates2D, PlanarPolygonGeometry } from './planar-geometry';
import {
  collapseStackTriangles,
  makeStackInsideTest,
  resolveStackOrder,
  sampleStackGridMasks,
  sampleStackHeights,
  sampleStackMasks,
  StackCollapseResult,
  stackDepthStats,
  stackDuplicateFractions,
  StackLayer,
  StackLayerDepth,
  stackLayerUvs,
  StackReference,
  StackResolveOptions,
  StackResolveResult,
  stackRimHeights,
  stackRimRings,
  StackTessellation,
  stackVertexPositions,
  tessellateStack,
} from './surface-stack';
import {
  collectStackCandidates,
  collectThicknessCrossings,
} from './surface-stack-candidates';

/** One layer of a shared-tessellation stack, ready to render. */
export type StackGeometryLayer = {
  /** the layer's surface, in the common scene frame — `null` when not capped */
  geometry: BufferGeometry | null;
  /** the layer's depth at the shared rim vertices (`rimY[ring][vertex]`) */
  rimY: number[][];
};

/**
 * Turn a resolved stack into one renderable geometry per layer.
 *
 * All layers share the shared tessellation's XZ and topology, so only `position.y`
 * (and the layer's own grid-space UVs) differ. Normals are per layer, computed
 * over the shared index buffer.
 *
 * ⚠️ The index `BufferAttribute` is **shared** by every layer that keeps the full
 * triangle set — with a deep stack, duplicating it would cost more memory than all
 * the vertex data. Any consumer must therefore dispose the layers of a stack
 * together (three re-uploads the buffer if a surviving geometry is drawn after a
 * sibling was disposed, so it degrades to a re-upload rather than breaking).
 *
 * @param reference the common domain
 * @param tessellation the shared tessellation
 * @param heights per-layer vertex heights (already resolved)
 * @param layers the source layers, for their grid-space UVs
 * @param layerIndices optional per-layer index subsets (see
 *   {@link collapseStackTriangles}); `null`/omitted entries use the shared set
 *
 * @group Geometries
 */
export function buildStackGeometries(
  reference: StackReference,
  tessellation: StackTessellation,
  heights: Float32Array[],
  layers: StackLayer[],
  layerIndices?: (Uint32Array | null)[],
  caps?: boolean[],
): StackGeometryLayer[] {
  const positionsXZ = stackVertexPositions(reference, tessellation.coords);
  const shared = new BufferAttribute(tessellation.indices, 1);

  return heights.map((y, i) => {
    const rimY = stackRimHeights(y, tessellation.rimVertices);
    // A layer can take part WITHOUT being drawn — when the chunk above or below
    // already draws that surface. Its rim still matters (the walls hang from it),
    // but building positions, UVs and normals for a mesh nobody renders would be
    // pure waste, and an unowned geometry is a leak waiting to happen.
    if (caps && caps[i] === false) return { geometry: null, rimY };

    const count = y.length;
    const positions = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      positions[3 * v] = positionsXZ[2 * v];
      positions[3 * v + 1] = y[v];
      positions[3 * v + 2] = positionsXZ[2 * v + 1];
    }
    const own = layerIndices?.[i];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute(
      'uv',
      new BufferAttribute(
        stackLayerUvs(reference, tessellation.coords, layers[i]),
        2,
      ),
    );
    geometry.setIndex(own ? new BufferAttribute(own, 1) : shared);
    computeUpwardNormals(geometry);
    return { geometry, rimY };
  });
}

/** Options for {@link buildSurfaceStack}. */
export type SurfaceStackOptions = {
  /** the mask polygon (scene XZ), already densified into the shared rim */
  polygon: PlanarPolygonGeometry;
  /** interior simplification error, in world units of height. Default 5. */
  maxError?: number;
  /**
   * Enforce depth order. Omit to only MEASURE the stack's crossings and leave the
   * heights alone. See {@link StackResolveOptions}.
   *
   * Pass `preResolved` instead when the stack was already made monotone on the
   * common grid (see `resolveStackGrid`) — sampling ordered grids yields ordered
   * vertices, so resolving again would be a no-op.
   */
  resolve?: StackResolveOptions;
  /**
   * Per-layer `absent` masks in GRID space, from a `resolveStackGrid` pass. When
   * given, the vertex resolve is skipped and these are sampled at the shared
   * vertices to drive the collapse.
   */
  preResolved?: Uint8Array[];
  /**
   * Thickness below which a unit counts as absent and its triangles are dropped.
   * Default 0.5; `0` disables the thickness test (coverage still applies).
   */
  collapseThreshold?: number;
  /**
   * Drop triangles where a layer has no data of its own, rather than letting the
   * reference's fill stand in for it. Default true.
   */
  coverageAbsence?: boolean;
  /**
   * Precomputed per-layer refinement candidates (see `collectStackCandidates`),
   * e.g. from a worker pool. Computed inline when omitted.
   */
  candidates?: Uint32Array[];
  /**
   * Footprint of whatever will be drawn ABOVE this stack (scene XZ) — typically
   * the outline of the neighbouring chunk.
   *
   * The stack's own top layer can be marked absent by a `preResolved` mask, having
   * been truncated against a surface that belongs to the stack above and is
   * therefore not drawn here. Dropping it is right where that neighbour covers the
   * spot (two coincident surfaces from two independent tessellations z-fight), and
   * wrong where it does not — there is nothing to fight with, and the drop leaves
   * a hole into the block. Given this polygon, the top layer's absence applies only
   * inside it.
   *
   * Only the TOP layer is affected: every deeper layer's coincident partner is
   * drawn by this same stack with this same outline, so it is always covered.
   */
  topCover?: PlanarPolygonGeometry;
  /**
   * Per layer: draw its cap. `false` leaves the layer in the stack (its rim still
   * carries the walls, and it still takes part in the resolve) but produces no
   * surface — for a boundary a NEIGHBOURING chunk already draws, so the two do not
   * z-fight over the same horizon.
   */
  caps?: boolean[];
  /**
   * Also refine along each pair's thickness termination (see
   * `collectThicknessCrossings`), so a unit wedging out follows the contour
   * instead of the nearest edges the height refinement left behind. Default true;
   * ignored when `collapseThreshold` is 0.
   */
  refineTerminations?: boolean;
};

/** Per-phase timings (ms) from {@link buildSurfaceStack}. */
export type SurfaceStackTimings = {
  tessellateMs: number;
  sampleMs: number;
  resolveMs: number;
  collapseMs: number;
  geometryMs: number;
};

/** The result of {@link buildSurfaceStack}. */
export type SurfaceStackBuild = {
  tessellation: StackTessellation;
  /** per-layer vertex heights, after the resolve */
  heights: Float32Array[];
  /** per-layer data coverage at the shared vertices */
  coverage: Uint8Array[];
  /** one renderable geometry (+ rim depths) per layer */
  layers: StackGeometryLayer[];
  /** the shared rim rings in scene XZ, matching each layer's `rimY` */
  rings: Coordinates2D[];
  resolved: StackResolveResult;
  collapsed: StackCollapseResult | null;
  /** per-layer depth statistics, measured inside the footprint */
  depths: StackLayerDepth[];
  /**
   * Per layer, the share of its jointly-covered vertices coincident with the layer
   * above, measured BEFORE the resolve (~1 = a duplicated horizon).
   */
  duplicates: number[];
  /**
   * Vertices where the TOP layer's absence was overridden because nothing above
   * covers them (see {@link SurfaceStackOptions.topCover}). 0 without a cover.
   */
  topKept: number;
  timings: SurfaceStackTimings;
};

/**
 * Build a whole stack of surfaces on ONE shared tessellation: tessellate, sample,
 * resolve the depth order, drop what is not present, and turn the result into a
 * renderable geometry per layer.
 *
 * This is the entry point callers should use. The individual steps are exported
 * too, but they have to be run in this order and with each other's outputs
 * (resolving without collapsing, in particular, leaves welded duplicate surfaces
 * behind — the one thing a shared tessellation still z-fights on).
 *
 * @param reference the common domain from `buildStackReference`
 * @param layers the source layers, in stratigraphic order (shallowest first) —
 *   the caller's order IS the stratigraphic order; nothing here infers it
 * @param options see {@link SurfaceStackOptions}
 * @returns the built stack, or `null` when the mask covers no geometry
 *
 * @group Geometries
 */
export function buildSurfaceStack(
  reference: StackReference,
  layers: StackLayer[],
  options: SurfaceStackOptions,
): SurfaceStackBuild | null {
  const maxError = options.maxError ?? 5;
  const collapseThreshold = options.collapseThreshold ?? 0.5;
  const coverageAbsence = options.coverageAbsence ?? true;

  const t0 = performance.now();

  // The height refinement only knows about each surface on its own, so it puts no
  // vertices where two of them converge. Those are exactly the lines the collapse
  // cuts along, so refine them too — the candidates are a union, and the crossings
  // are a thin line, so this costs vertices only where a unit wedges out.
  let candidates = options.candidates;
  if (
    collapseThreshold > 0 &&
    (options.refineTerminations ?? true) &&
    reference.channels.length > 1
  ) {
    const lists =
      candidates ??
      reference.channels.map(channel =>
        collectStackCandidates(channel, reference.header.nx, maxError),
      );
    candidates = lists.map((list, i) => {
      if (i === 0) return list;
      const contour = collectThicknessCrossings(
        reference.channels[i - 1],
        reference.channels[i],
        reference.header.nx,
        collapseThreshold,
      );
      if (contour.length === 0) return list;
      const merged = new Uint32Array(list.length + contour.length);
      merged.set(list);
      merged.set(contour, list.length);
      return merged;
    });
  }

  const tessellation = tessellateStack(
    reference,
    options.polygon,
    maxError,
    candidates,
  );
  if (!tessellation) return null;
  const tTessellate = performance.now();

  const heights = sampleStackHeights(reference, tessellation.coords);
  const coverage = sampleStackMasks(reference, tessellation.coords);
  const tSample = performance.now();

  const depths = stackDepthStats(heights);
  // Measured BEFORE resolving, or the welding masquerades as duplication.
  const duplicates = stackDuplicateFractions(
    heights,
    coverage,
    collapseThreshold || 0.5,
  );

  const resolved = resolveStackOrder(heights, {
    ...options.resolve,
    coverage,
    // A stack resolved on the common grid arrives ordered, so the pass only
    // measures — re-clamping identical values would be busywork.
    apply: options.preResolved
      ? false
      : options.resolve
        ? (options.resolve.apply ?? true)
        : false,
  });
  const tResolve = performance.now();

  const absent = options.preResolved
    ? sampleStackGridMasks(reference, tessellation.coords, options.preResolved)
    : resolved.applied
      ? resolved.absent
      : undefined;

  // The top layer was truncated against a surface this stack does not draw, so its
  // absence is only safe where something else will stand in for it.
  let topKept = 0;
  if (absent && options.topCover && absent.length > 0) {
    const inside = makeStackInsideTest(
      reference,
      options.topCover,
      tessellation.coords,
    );
    const top = absent[0];
    for (let v = 0; v < top.length; v++) {
      if (top[v] && !inside(v)) {
        top[v] = 0;
        topKept++;
      }
    }
  }

  const collapsed =
    collapseThreshold > 0 || coverageAbsence
      ? collapseStackTriangles(heights, tessellation.indices, {
          threshold: collapseThreshold,
          coverage: coverageAbsence ? coverage : undefined,
          absent,
        })
      : null;
  const tCollapse = performance.now();

  const built = buildStackGeometries(
    reference,
    tessellation,
    heights,
    layers,
    collapsed?.indices,
    options.caps,
  );
  const rings = stackRimRings(
    stackVertexPositions(reference, tessellation.coords),
    tessellation.rimVertices,
  );
  const tGeometry = performance.now();

  return {
    tessellation,
    heights,
    coverage,
    layers: built,
    rings,
    resolved,
    collapsed,
    depths,
    duplicates,
    topKept,
    timings: {
      tessellateMs: tTessellate - t0,
      sampleMs: tSample - tTessellate,
      resolveMs: tResolve - tSample,
      collapseMs: tCollapse - tResolve,
      geometryMs: tGeometry - tCollapse,
    },
  };
}
