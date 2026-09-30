import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';
import { computeUpwardNormals } from './geometry-attributes';
import { buildEdgeOpposites, traceBoundaryRings } from './mesh-boundary';
import { Coordinates2D, PlanarPolygonGeometry } from './planar-geometry';
import { createPolygonCap } from './polygon-cap';
import { ringSignedArea, ringsToPolygonCoordinates } from './polygon-outline';
import { packTriangleMask, StackSectionSource } from './surface-section';
import {
  collapseStackTriangles,
  makeStackInsideTest,
  resolveStackOrder,
  sampleStackGridMasks,
  sampleStackHeights,
  sampleStackMasks,
  sampleStackWeights,
  StackCollapseResult,
  stackDepthStats,
  stackDuplicateFractions,
  stackIntervalTriangles,
  StackLayer,
  StackLayerDepth,
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
  collectCoverageCrossings,
  collectStackCandidates,
  collectThicknessCrossings,
} from './surface-stack-candidates';
import { buildRingWalls } from './surface-walls';

/** One layer of a shared-tessellation stack, ready to render. */
export type StackGeometryLayer = {
  /** the layer's surface, in the common scene frame — `null` when not capped */
  geometry: BufferGeometry | null;
  /** the layer's depth at the shared rim vertices (`rimY[ring][vertex]`) */
  rimY: number[][];
  /**
   * The triangles this cap gave up because a layer ABOVE covered them, to be drawn
   * IN ADDITION to the cap once that cover is gone (see
   * {@link StackCollapseOptions.peelable}). Shares the geometry's attributes, so it
   * is an index and nothing more.
   *
   * ⭐ The DIFFERENCE, not the union: a union would carry a second full copy of
   * every cap's index — hundreds of MB on a field-scale column — and would redraw
   * the whole cap on top of itself, which under OIT blends the covered area twice.
   */
  patchIndex?: Uint32Array | null;
};

/**
 * Turn a resolved stack into one renderable geometry per layer.
 *
 * ⭐ Split cap layout: every layer SHARES one `xz` attribute and the topology, and
 * carries only a per-layer `y` (its heights). A cap holds no `position` or `uv` —
 * the materials assemble the position from `xz` + `y` in the shader (see
 * `ChunkMaterial`). Normals are per layer, computed over the shared index buffer.
 *
 * ⚠️ The index `BufferAttribute` is **shared** by every layer that keeps the full
 * triangle set — with a deep stack, duplicating it would cost more memory than all
 * the vertex data. Any consumer must therefore dispose the layers of a stack
 * together (three re-uploads the buffer if a surviving geometry is drawn after a
 * sibling was disposed, so it degrades to a re-upload rather than breaking).
 *
 * @param tessellation the shared tessellation
 * @param positionsXZ scene XZ of every shared vertex ({@link stackVertexPositions});
 *   shared by reference with the section source, so neither duplicates it
 * @param heights per-layer vertex heights (already resolved); each array BECOMES
 *   that layer's `y` attribute
 * @param layerIndices optional per-layer index subsets (see
 *   {@link collapseStackTriangles}); `null`/omitted entries use the shared set
 * @param caps per layer: whether to build a geometry at all
 * @param inferred per-layer vertex weights (see `sampleStackWeights`); a layer
 *   with any weight above zero gets an `inferred` attribute, whose PRESENCE is
 *   what tells the appearance layer the layer is partly invented
 * @param peelIndices optional per-layer widened index for a peel/section patch
 *
 * @group Geometries
 */
/**
 * Re-store a computed normal attribute as snorm16.
 *
 * ⭐ A stack layer carries one normal per shared vertex, which at field scale is
 * the second-largest thing a chunk holds after its positions — and a unit vector
 * needs nothing like float32 (snorm16 resolves ~3e-5, far below what shading can
 * show). Halves it, and three feeds normalized integer attributes to the shader
 * unchanged.
 */
function quantizeNormals(geometry: BufferGeometry) {
  const attribute = geometry.getAttribute('normal');
  if (!attribute || !(attribute.array instanceof Float32Array)) return;
  const source = attribute.array;
  const packed = new Int16Array(source.length);
  for (let i = 0; i < source.length; i++) {
    packed[i] = Math.max(
      -32767,
      Math.min(32767, Math.round(source[i] * 32767)),
    );
  }
  geometry.setAttribute('normal', new BufferAttribute(packed, 3, true));
}

/**
 * The triangles `widest` has and `own` does not.
 *
 * Both are emitted by the same pass over the triangles in the same order, and
 * `own` is a subset, so one walk finds the difference exactly.
 */
function indexDifference(
  widest: Uint32Array,
  own: Uint32Array,
): Uint32Array | null {
  const patch = new Uint32Array(widest.length - own.length);
  let j = 0;
  let k = 0;
  for (let i = 0; i < widest.length; i += 3) {
    if (
      j < own.length &&
      widest[i] === own[j] &&
      widest[i + 1] === own[j + 1] &&
      widest[i + 2] === own[j + 2]
    ) {
      j += 3;
      continue;
    }
    patch[k++] = widest[i];
    patch[k++] = widest[i + 1];
    patch[k++] = widest[i + 2];
  }
  return k > 0 ? patch : null;
}

export function buildStackGeometries(
  tessellation: StackTessellation,
  positionsXZ: Float32Array,
  heights: Float32Array[],
  layerIndices?: (Uint32Array | null)[],
  caps?: boolean[],
  inferred?: Float32Array[],
  peelIndices?: (Uint32Array | null)[],
): StackGeometryLayer[] {
  const shared = new BufferAttribute(tessellation.indices, 1);
  // ⭐ Split cap layout: every cap SHARES one `xz` attribute; only `y` differs per
  // layer, and that `y` IS the height array (shared by reference with the section
  // source, so the two never duplicate it). A cap therefore stores no full
  // (x, y, z) position — the materials assemble it in the shader (see
  // `ChunkMaterial`). The scratch below exists ONLY to feed the CPU normal build.
  const sharedXZ = new BufferAttribute(positionsXZ, 2);
  const vertexCount = positionsXZ.length >> 1;
  const scratch = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    scratch[3 * v] = positionsXZ[2 * v];
    scratch[3 * v + 2] = positionsXZ[2 * v + 1];
  }

  return heights.map((y, i) => {
    const rimY = stackRimHeights(y, tessellation.rimVertices);
    const peelIndex = peelIndices?.[i] ?? null;
    // A layer can take part WITHOUT being drawn — when the chunk above or below
    // already draws that surface. Its rim still matters (the walls hang from it),
    // but building a mesh nobody renders would be pure waste, and an unowned
    // geometry is a leak waiting to happen.
    if (caps && caps[i] === false) return { geometry: null, rimY };

    const own = layerIndices?.[i];
    const geometry = new BufferGeometry();
    geometry.setAttribute('xz', sharedXZ);
    // `y` IS the per-layer height array — shared by reference with the section.
    geometry.setAttribute('y', new BufferAttribute(y, 1));
    const marks = inferred?.[i];
    if (marks && marks.some(v => v > 0)) {
      geometry.setAttribute('inferred', new BufferAttribute(marks, 1));
    }
    // ⚠️⚠️ Normals are accumulated over the WIDEST index available, not the cap's
    // own: `computeVertexNormals` only touches vertices its index references, so a
    // vertex used ONLY by triangles the collapse dropped keeps a zero normal — and
    // shades BLACK the moment the patch restores it (see `patchIndex`).
    const widest = peelIndex ?? own;
    geometry.setIndex(widest ? new BufferAttribute(widest, 1) : shared);
    const wound = widest ? widest[1] : tessellation.indices[1];
    // Normals AND the bounding volumes need a real position; assemble it into the
    // reused scratch (only `y` changes between layers), compute, and leave it OFF
    // the geometry — it is never uploaded, so a cap ships `xz` + `y` + `normal`.
    for (let v = 0; v < vertexCount; v++) scratch[3 * v + 1] = y[v];
    geometry.setAttribute('position', new BufferAttribute(scratch, 3));
    computeUpwardNormals(geometry);
    let patchIndex: Uint32Array | null = null;
    if (peelIndex) {
      // ⚠️ `computeUpwardNormals` reverses the winding IN PLACE when the normals
      // come out facing down, and it only holds one of the two arrays.
      if (own && peelIndex[1] !== wound) {
        for (let t = 0; t + 2 < own.length; t += 3) {
          const swap = own[t + 1];
          own[t + 1] = own[t + 2];
          own[t + 2] = swap;
        }
      }
      // After the fix-up both are wound the same way, so the triples still match.
      // The union is dropped here; only the difference travels.
      patchIndex = own ? indexDifference(peelIndex, own) : null;
      geometry.setIndex(own ? new BufferAttribute(own, 1) : shared);
    }
    quantizeNormals(geometry);
    // The assembled position still exists here (deleted just below): compute the
    // bounding volumes from it now, because a cap ships no `position` and three
    // cannot derive one — a null bounding sphere frustum-culls the whole cap the
    // moment the local origin leaves a close-up view.
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.deleteAttribute('position');
    return { geometry, rimY, patchIndex };
  });
}

/** Options for {@link buildStackWalls}. */
export type StackWallOptions = {
  /** per layer: build the wall of the interval BELOW it */
  fills: boolean[];
  /** thickness below which the interval counts as absent (see the collapse) */
  threshold?: number;
  /** per-layer coverage at the shared vertices */
  coverage?: Uint8Array[];
  /** per-layer, per-triangle coverage (see {@link StackCollapseOptions}) */
  coverageTriangles?: Uint8Array[];
  /** per-layer truncation masks at the shared vertices */
  absent?: Uint8Array[];
  /**
   * Per-layer inferred weights at the shared vertices (see `sampleStackWeights`).
   * A wall takes the LARGER of its two bounding layers': a volume is invented as
   * soon as either surface that closes it was.
   */
  inferred?: Float32Array[];
  /** per layer: this boundary is a fluid (see {@link StackResolveOptions.fluid}) */
  fluid?: boolean[];
  /** per layer: this boundary is the sea (see {@link StackCollapseOptions.unbounded}) */
  unbounded?: boolean[];
  /** the turn past which a rim point is a crease; see `RingWallOptions` */
  smoothAngle?: number;
};

/** What {@link buildStackWalls} produced. */
export type StackWalls = {
  /** per layer, the wall of the interval BELOW it; `null` where there is none */
  walls: (BufferGeometry | null)[];
  /**
   * Per interval, one flag per triangle: where that interval holds a volume
   * ({@link stackIntervalTriangles}). Returned rather than discarded because a
   * section needs exactly the same set, and computing it twice is the cost of a
   * second pass over every triangle. `null` when nothing is filled.
   */
  intervals: Uint8Array[] | null;
  /** boundary walks discarded as degenerate (see `BoundaryRings.dropped`) */
  ringsDropped: number;
  /** boundary walks that did not close (see `BoundaryRings.open`) — should be 0 */
  ringsOpen: number;
};

/**
 * Build each filled interval's side wall from the SHARED TESSELLATION, around the
 * area that interval actually occupies.
 *
 * The alternative — a wall around the whole chunk rim — draws a face along the
 * outline whether or not the unit still exists there, and says nothing at all
 * where a unit ends inside the chunk. Tracing the interval's own triangles gives
 * both, so the rim is not a special case: it is simply the part of that boundary
 * which happens to lie on the outline.
 *
 * ⚠️ The two are no longer told apart. They were, and the tag drove a separate
 * appearance for a data edge — but a cut face is legible without help, and under
 * sealing there is no visible one to mark (a pinch-out face is at most
 * `collapseThreshold` tall). The wall's `inferred` attribute now means invention
 * and nothing else.
 *
 * Because the rings are made of shared vertices, the wall's top and bottom edges
 * are the same points as the surfaces above and below it — the block stays sealed
 * by construction rather than by agreement between two samplings.
 *
 * @param tessellation the shared tessellation
 * @param positionsXZ scene XZ of every shared vertex ({@link stackVertexPositions})
 * @param heights per-layer vertex heights, after the resolve
 * @param options see {@link StackWallOptions}
 * @returns the walls, plus the counts that say whether the boundary traced cleanly
 *
 * @group Geometries
 */
export function buildStackWalls(
  tessellation: StackTessellation,
  positionsXZ: Float32Array,
  heights: Float32Array[],
  options: StackWallOptions,
): StackWalls {
  const walls: (BufferGeometry | null)[] = heights.map(() => null);
  if (!options.fills.some(Boolean))
    return { walls, intervals: null, ringsDropped: 0, ringsOpen: 0 };

  const { indices, rimVertices } = tessellation;
  const vertexCount = tessellation.coords.length >> 1;
  const opposite = buildEdgeOpposites(indices, vertexCount);
  const members = stackIntervalTriangles(heights, indices, {
    threshold: options.threshold,
    coverage: options.coverage,
    coverageTriangles: options.coverageTriangles,
    absent: options.absent,
    unbounded: options.unbounded,
  });

  const point = (v: number): Vec2 => [
    positionsXZ[2 * v],
    positionsXZ[2 * v + 1],
  ];
  let ringsDropped = 0;
  let ringsOpen = 0;

  // Which way round a ring has to run for `buildRingWalls` to face its quads away
  // from the material. Rather than reason about it, take the convention from the
  // rim the chunk's walls have always used: the largest rim ring is the outer one,
  // and a traced region's rings sum to its (signed) area, so matching the two signs
  // matches the convention.
  let rimSign = 0;
  let widest = 0;
  for (const ring of rimVertices) {
    const area = ringSignedArea(ring.map(point));
    if (Math.abs(area) > widest) {
      widest = Math.abs(area);
      rimSign = Math.sign(area);
    }
  }

  for (let i = 0; i + 1 < heights.length; i++) {
    if (!options.fills[i]) continue;
    const traced = traceBoundaryRings(indices, opposite, members[i]);
    ringsDropped += traced.dropped;
    ringsOpen += traced.open;
    const rings = traced.rings;
    if (rings.length === 0) continue;

    const total = rings.reduce((a, r) => a + ringSignedArea(r.map(point)), 0);
    const flip = rimSign !== 0 && total !== 0 && Math.sign(total) !== rimSign;

    const top = heights[i];
    const bottom = heights[i + 1];
    // ⭐ A fluid is not the authority for what lies below it, so the surface below
    // may stand ABOVE it — and a quad whose bottom edge is over its top edge does
    // not vanish, it INVERTS: it paints the volume above the fluid, with its
    // normal flipped, in the very place the unit that rises through it draws its
    // own wall. Clamping collapses that part of the quad onto the fluid instead,
    // so the wall simply ends where the two meet — the shoreline of a sea, the
    // pinch-out of a contact against the base of its own unit. Only for a pair
    // involving a fluid: everywhere else the resolve guarantees the order, and
    // quietly clamping would hide a crossing rather than report it.
    //
    // The clamped skirt is then ≤ `threshold` tall by construction (its boundary
    // vertices are corners of a dropped, below-threshold triangle), and the two
    // caps already meet there — so it is dropped via `minHeight` rather than
    // rendered as a sliver.
    const clamped = !!(options.fluid?.[i] || options.fluid?.[i + 1]);
    const markTop = options.inferred?.[i];
    const markBottom = options.inferred?.[i + 1];
    const geometry = buildRingWalls(
      rings.map(ring => {
        const loop = flip ? ring.slice().reverse() : ring;
        return {
          points: loop.map(point),
          topY: loop.map(v => top[v]),
          bottomY: loop.map(v =>
            clamped ? Math.min(bottom[v], top[v]) : bottom[v],
          ),
          inferred:
            markTop || markBottom
              ? loop.map(v => Math.max(markTop?.[v] ?? 0, markBottom?.[v] ?? 0))
              : undefined,
        };
      }),
      {
        smoothAngle: options.smoothAngle,
        minHeight: clamped ? (options.threshold ?? 0.5) : 0,
      },
    );
    walls[i] = geometry;
  }

  return { walls, intervals: members, ringsDropped, ringsOpen };
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
   * Outlines of NEIGHBOURING chunks whose footprint this one only PARTLY overlaps
   * (scene XZ, already densified). Constrained into the tessellation so the area
   * they also cover is bounded by real mesh edges rather than cut at triangle
   * resolution — with both chunks sampling the same reference grid, the seam is
   * then watertight rather than merely close.
   */
  cuts?: PlanarPolygonGeometry[];
  /**
   * Per layer, the indices into {@link SurfaceStackOptions.cuts} of the neighbours
   * that draw that layer's cap where they reach. `caps` is the containment case of
   * the same decision — the neighbour covers this chunk entirely, so nothing is
   * left to draw.
   */
  capCuts?: (number[] | null)[];
  /**
   * Per layer: this one is a void's CEILING, which inverts which of a coincident
   * pair is dropped. See `StackCollapseOptions.ceiling`.
   */
  ceiling?: boolean[];
  /**
   * Index of the layer that is the stack's carrier (see `StackCarrier`) — the flat
   * floor the block terminates against.
   *
   * The resolve may not move it and the collapse may not drop it, while anything
   * flattened onto it loses its cap. Both are re-imposed here rather than assumed
   * of the channels, so a positive `minGap` cannot push the floor below the very
   * horizons it just truncated.
   */
  carrier?: number;
  /**
   * Also refine along each pair's thickness termination (see
   * `collectThicknessCrossings`), so a unit wedging out follows the contour
   * instead of the nearest edges the height refinement left behind. Default true;
   * ignored when `collapseThreshold` is 0.
   */
  refineTerminations?: boolean;
  /**
   * Also refine along the edge of each layer's own DATA (see
   * `collectCoverageCrossings`). Default true.
   *
   * ⭐ A different line from `refineTerminations`, and the one a SEALED stack
   * needs: a sealed surface keeps full thickness either side of the edge of its
   * data, so that edge is not a thickness crossing and nothing else puts vertices
   * on it — the taper then starts wherever the height refinement left a vertex,
   * which in a flat area is hundreds of metres inside the data.
   */
  refineCoverage?: boolean;
  /**
   * Constrain each layer's DATA boundary into the shared tessellation, so no
   * triangle straddles a survey edge and the drop rule can be exact per triangle
   * (see {@link StackTessellation.coverage}).
   *
   * ⭐ Supersedes `refineCoverage`, which defaults to OFF when this is on: that
   * pass exists only to put vertices NEAR an unconstrained data edge, and a
   * constraint puts them ON it.
   *
   * ⚠️ Costs vertices along every partly-mapped layer's boundary, in a
   * tessellation every layer of the stack shares.
   */
  constrainCoverage?: boolean;
  /**
   * Per layer: build the side wall of the interval BELOW it. Omit to build no
   * walls at all (the caller then has `rings` and each layer's `rimY` and can
   * build its own).
   */
  fills?: boolean[];
  /**
   * Per layer, per NODE of the reference grid: how far the height there was
   * inferred rather than measured — the seal's taper weight (see
   * `sealStackChannels`). Sampled at the shared vertices and attached to both the
   * caps and the walls, so the appearance layer can draw the invented part of a
   * block as the inference it is.
   *
   * Omit it and the weights are derived from `coverage` instead, but only when
   * `coverageAbsence` is off — that is the other way a layer ends up drawn past
   * its own extent, standing on the reference's hole fill.
   */
  inferred?: Float32Array[];
  /**
   * Per layer: this boundary is a FLUID — a level rather than a horizon (see
   * {@link StackResolveOptions.fluid}). It is ordered like any other boundary but
   * is never the authority for what lies below it, and the wall of an interval it
   * bounds is clamped so it cannot invert where the two cross.
   */
  fluid?: boolean[];
  /**
   * Per layer: this boundary is the SEA — unbounded, covering the whole footprint
   * whatever stands in its way (see {@link StackCollapseOptions.unbounded}), and
   * its lid built on its OWN triangulation of the outline rather than on the
   * shared tessellation.
   *
   * ⭐ That last part is the reason it is worth being a case at all. A flat lid in
   * the shared TIN is wrong in both directions at once: it carries every vertex
   * the surfaces below it needed, and still has no detail of its own where they
   * did not — which is exactly where a water surface is most likely to be
   * displaced by waves. Refining the shared TIN for it is not an option either,
   * since every other layer would pay for it. Nothing is compared against it per
   * vertex, so its lid is free to be tessellated on its own terms; the only thing
   * it must agree with is the wall of the volume below it, and that follows from
   * the outline, which both share.
   */
  unbounded?: (StackUnbounded | null)[];
  /**
   * Also emit a {@link StackSectionSource} — the channels a clip plane's cut face
   * is built from. OFF by default: it hands out the shared tessellation and every
   * layer's heights, which for a worker build means transferring them, and nobody
   * who is not sectioning should pay for that.
   *
   * ⚠️ Needs `fills`: a cut face shows the MATERIAL an interval holds, so an
   * unfilled gap has nothing to draw.
   */
  section?: boolean;
  /**
   * Also emit each layer's cap as it would be if nothing ABOVE it were drawn (see
   * {@link StackCollapseOptions.peelable}) — what a peel or a section needs in
   * order not to open a hole where the collapse relied on a covering layer.
   */
  peelable?: boolean;
};

/**
 * How an unbounded layer's lid is tessellated (see
 * {@link SurfaceStackOptions.unbounded}).
 *
 * @group Geometries
 */
export type StackUnbounded = {
  /**
   * Target triangle edge length for the lid, in world units. Omit (or 0) for the
   * fewest triangles that fill the outline — which is all a flat, undisplaced
   * surface needs, since its shading is per pixel.
   *
   * ⚠️ A cost knob, and a quadratic one: it applies over the whole footprint.
   * Only worth setting when vertex displacement is on, and then only as coarse as
   * the swells being displaced allow.
   */
  resolution?: number;
};

/** Per-phase timings (ms) from {@link buildSurfaceStack}. */
export type SurfaceStackTimings = {
  tessellateMs: number;
  sampleMs: number;
  resolveMs: number;
  collapseMs: number;
  geometryMs: number;
  wallMs: number;
};

/** The result of {@link buildSurfaceStack}. */
export type SurfaceStackBuild = {
  tessellation: StackTessellation;
  /** per-layer vertex heights, after the resolve */
  heights: Float32Array[];
  /** per-layer data coverage at the shared vertices */
  coverage: Uint8Array[];
  /**
   * Per-layer inferred weight at the shared vertices, or `undefined` when none
   * was given (see {@link SurfaceStackOptions.inferred}).
   */
  inferred?: Float32Array[];
  /** one renderable geometry (+ rim depths) per layer */
  layers: StackGeometryLayer[];
  /**
   * Per layer, the side wall of the interval BELOW it, traced around the area that
   * interval occupies (see {@link buildStackWalls}). `null` where the interval is
   * unfilled or empty; all `null` when `fills` was not given.
   */
  walls: (BufferGeometry | null)[];
  /** boundary walks discarded as degenerate while building the walls */
  ringsDropped: number;
  /** boundary walks that did not close — should be 0 (see {@link StackWalls}) */
  ringsOpen: number;
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
  /**
   * The channels a clip plane's cut face is built from, when
   * {@link SurfaceStackOptions.section} asked for them.
   */
  section?: StackSectionSource;
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
 * @param _layers the source layers (shallowest first). Retained for API symmetry:
 *   the `reference` is built from them and already carries everything the build
 *   needs, so nothing here reads them.
 * @param options see {@link SurfaceStackOptions}
 * @returns the built stack, or `null` when the mask covers no geometry
 *
 * @group Geometries
 */
export function buildSurfaceStack(
  reference: StackReference,
  _layers: StackLayer[],
  options: SurfaceStackOptions,
): SurfaceStackBuild | null {
  const maxError = options.maxError ?? 5;
  const collapseThreshold = options.collapseThreshold ?? 0.5;
  const coverageAbsence = options.coverageAbsence ?? true;
  const fluid = options.fluid;
  const unbounded = options.unbounded?.map(f => !!f);

  const t0 = performance.now();

  // The height refinement only knows about each surface on its own, so it puts no
  // vertices where two of them converge. Those are exactly the lines the collapse
  // cuts along, so refine them too — the candidates are a union, and the crossings
  // are a thin line, so this costs vertices only where a unit wedges out.
  let candidates = options.candidates;
  const refineTerminations =
    collapseThreshold > 0 &&
    (options.refineTerminations ?? true) &&
    reference.channels.length > 1;
  const refineCoverage = options.refineCoverage ?? !options.constrainCoverage;
  if (refineTerminations || refineCoverage) {
    const lists =
      candidates ??
      reference.channels.map(channel =>
        collectStackCandidates(channel, reference.header.nx, maxError),
      );
    candidates = lists.map((list, i) => {
      const extra: Uint32Array[] = [];
      if (refineTerminations && i > 0) {
        extra.push(
          collectThicknessCrossings(
            reference.channels[i - 1],
            reference.channels[i],
            reference.header.nx,
            collapseThreshold,
          ),
        );
      }
      // The edge of this layer's own data, which is where a seal's taper starts.
      if (refineCoverage && reference.masks[i]) {
        extra.push(
          collectCoverageCrossings(reference.masks[i], reference.header.nx),
        );
      }
      const total = extra.reduce((a, e) => a + e.length, 0);
      if (total === 0) return list;
      const merged = new Uint32Array(list.length + total);
      merged.set(list);
      let at = list.length;
      for (const e of extra) {
        merged.set(e, at);
        at += e.length;
      }
      return merged;
    });
  }

  const tessellation = tessellateStack(
    reference,
    options.polygon,
    maxError,
    candidates,
    options.cuts,
    options.constrainCoverage,
  );
  if (!tessellation) return null;
  const tTessellate = performance.now();

  const heights = sampleStackHeights(reference, tessellation.coords);
  const coverage = sampleStackMasks(reference, tessellation.coords);
  // Constant over the whole grid, so any vertex of it is the plane.
  const carrierLevel =
    options.carrier !== undefined ? heights[options.carrier]?.[0] : undefined;
  // What is drawn beyond a layer's extent is invented however its height was
  // arrived at. A seal says how far, and its gradient must not be flattened; with
  // no seal the same region is drawn on the reference's hole fill, which is a flat
  // extrapolation and just as invented — but only when it is drawn at all.
  const sampled = options.inferred
    ? sampleStackWeights(reference, tessellation.coords, options.inferred)
    : undefined;
  const uncovered = (mask: Uint8Array) =>
    Float32Array.from(mask, covered => (covered ? 0 : 1));
  // ⚠️ A layer the seal could not process — nothing above it or below it to lean
  // on, which is what the end of a column looks like — comes back with all-zero
  // weights and is still drawn on the fill, so it would be the one invented thing
  // left unmarked. Per LAYER is exact rather than a heuristic: a layer the seal did
  // process carries a positive weight at every unmapped node.
  const inferred = coverageAbsence
    ? sampled
    : (sampled ?? coverage.map(uncovered)).map((weights, i) =>
        weights.some(w => w > 0) ? weights : uncovered(coverage[i]),
      );
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
    fluid,
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

  // The floor is a guarantee, so it survives the resolve unchanged and is never
  // reported absent — the resolve would otherwise push it below anything it had
  // truncated whenever `minGap` is positive, and a truncated floor is a hole.
  if (carrierLevel !== undefined && options.carrier !== undefined) {
    const floor = heights[options.carrier];
    floor.fill(carrierLevel);
    heights.forEach((y, i) => {
      if (i === options.carrier) return;
      for (let v = 0; v < y.length; v++) {
        if (y[v] < carrierLevel) y[v] = carrierLevel;
      }
    });
    absent?.[options.carrier]?.fill(0);
  }

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

  const capExcluded = options.capCuts
    ? options.capCuts.map(list => {
        const flags = tessellation.cuts;
        if (!list || list.length === 0 || !flags) return null;
        if (list.length === 1) return (flags[list[0]] ?? null) as Uint8Array;
        const merged = new Uint8Array(tessellation.indices.length / 3);
        for (const k of list) {
          const f = flags[k];
          if (!f) continue;
          for (let t = 0; t < merged.length; t++) if (f[t]) merged[t] = 1;
        }
        return merged;
      })
    : undefined;
  // A chunk that shares nothing still gets an entry per layer, and an array of
  // nulls must not make the collapse run where it otherwise would not.
  const excludes = capExcluded?.some(mask => mask) ? capExcluded : undefined;

  const collapsed =
    collapseThreshold > 0 || coverageAbsence || excludes
      ? collapseStackTriangles(heights, tessellation.indices, {
          threshold: collapseThreshold,
          coverage: coverageAbsence ? coverage : undefined,
          coverageTriangles: coverageAbsence
            ? tessellation.coverage
            : undefined,
          absent,
          ceiling: options.ceiling,
          capExcluded: excludes,
          carrier: options.carrier,
          unbounded,
          peelable: options.peelable,
        })
      : null;
  const tCollapse = performance.now();

  const positionsXZ = stackVertexPositions(reference, tessellation.coords);
  const built = buildStackGeometries(
    tessellation,
    positionsXZ,
    heights,
    collapsed?.indices,
    // The sea's lid is built below, on its own triangulation of the outline.
    unbounded
      ? unbounded.map((f, i) => !f && options.caps?.[i] !== false)
      : options.caps,
    inferred,
    collapsed?.peelIndices,
  );
  const rings = stackRimRings(positionsXZ, tessellation.rimVertices);

  if (options.unbounded) {
    // Ear clipping puts no vertices on the boundary and the refinement never
    // splits it, so the lid's rim IS the shared rim — the same points the wall of
    // the volume below hangs from, at any resolution. Constant in Y, like the
    // carrier, so any vertex of it is the plane.
    let shapes: ReturnType<PlanarPolygonGeometry['toShapes']> | null = null;
    options.unbounded.forEach((spec, i) => {
      if (!spec || options.caps?.[i] === false) return;
      shapes ??= new PlanarPolygonGeometry(
        // The rim rings close implicitly; a ring that also repeats its first
        // point would ear-clip a degenerate sliver.
        ringsToPolygonCoordinates(
          rings.map(ring =>
            ring.length > 1 &&
            ring[0][0] === ring[ring.length - 1][0] &&
            ring[0][1] === ring[ring.length - 1][1]
              ? ring.slice(0, -1)
              : ring,
          ),
        ),
      ).toShapes();
      built[i].geometry = createPolygonCap(shapes, {
        y: heights[i][0],
        resolution: spec.resolution,
      });
    });
  }
  const tGeometry = performance.now();

  const walls = options.fills
    ? buildStackWalls(tessellation, positionsXZ, heights, {
        fills: options.fills,
        threshold: collapseThreshold,
        coverage: coverageAbsence ? coverage : undefined,
        coverageTriangles: coverageAbsence ? tessellation.coverage : undefined,
        absent,
        inferred,
        fluid,
        unbounded,
      })
    : {
        walls: heights.map(() => null),
        intervals: null,
        ringsDropped: 0,
        ringsOpen: 0,
      };
  const tWalls = performance.now();

  // An interval with no volume has no material to show on the cut, so it is left
  // out here rather than being filtered by every consumer.
  // ⭐ Packed to one bit per triangle here: the wall builder wants a byte it can
  // index, but this copy is the one that crosses to the main thread and stays for
  // the life of the build.
  const section =
    options.section && walls.intervals
      ? {
          positionsXZ,
          indices: tessellation.indices,
          heights,
          intervals: walls.intervals.map((members, i) =>
            options.fills?.[i] ? packTriangleMask(members) : null,
          ),
          inferred,
        }
      : undefined;

  return {
    tessellation,
    heights,
    coverage,
    inferred,
    layers: built,
    walls: walls.walls,
    ringsDropped: walls.ringsDropped,
    ringsOpen: walls.ringsOpen,
    rings,
    resolved,
    collapsed,
    depths,
    duplicates,
    topKept,
    section,
    timings: {
      tessellateMs: tTessellate - t0,
      sampleMs: tSample - tTessellate,
      resolveMs: tResolve - tSample,
      collapseMs: tCollapse - tResolve,
      geometryMs: tGeometry - tCollapse,
      wallMs: tWalls - tGeometry,
    },
  };
}
