import { BufferAttribute, BufferGeometry, Box3, Sphere, Vector3 } from 'three';
import { Vec2 } from '../types/common';
import { CAP_NORMAL_MAP_CELLS, StackCapNormalMap } from './cap-normal-map';
import {
  buildStackCapArrays,
  indexDifference,
  StackCapArrays,
  StackCapInput,
} from './stack-cap-arrays';
import { buildEdgeOpposites, traceBoundaryRings } from './mesh-boundary';
import { Coordinates2D, PlanarPolygonGeometry } from './planar-geometry';
import { createPolygonCap } from './polygon-cap';
import { ringSignedArea, ringsToPolygonCoordinates } from './polygon-outline';
import {
  buildStackSectionIndex,
  packTriangleMask,
  StackSectionSource,
} from './surface-section';
import {
  scanThicknessLoops,
  simplifyThicknessLoops,
  ThicknessLines,
  ThicknessLoops,
} from './surface-stack-terminations';
import {
  classifyThinTriangles,
  collapseStackTriangles,
  makeStackInsideTest,
  resolveStackOrder,
  sampleStackGridMasks,
  sampleStackHeights,
  sampleStackMasks,
  sampleStackWeights,
  StackCapNeighbours,
  stackCapNeighbours,
  StackCollapseResult,
  stackDepthStats,
  stackDuplicateFractions,
  stackIntervalMembers,
  stackIntervalStates,
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
  planStackTessellation,
  stackSceneToGrid,
} from './surface-stack';
import {
  StackTileInput,
  StackTileOutput,
  tessellateStackTile,
} from './stack-tiles';
import {
  collectCoverageCrossings,
  collectStackCandidateLevels,
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
  /**
   * Per coarser level (see {@link SurfaceStackOptions.lod}), the triangles this
   * cap keeps there, over the same vertices. Wound like the cap's own index.
   */
  levels?: Uint32Array[] | null;
  /**
   * Per level, the full one first and then each of `levels`: where each tile's
   * triangles start in that level's index (in triangles; one past the end last).
   */
  tileStarts?: Uint32Array[] | null;
  /**
   * Per coarser level, the cap's patch there (see {@link patchIndex}): that level's
   * triangles a layer above covered. Empty where it has none.
   */
  patchLevels?: Uint32Array[] | null;
  /**
   * Per level, the full one first: where each tile's triangles start in the patch
   * there — what lets a renderer draw the patch at each tile's level.
   */
  patchTileStarts?: Uint32Array[] | null;
  /**
   * The cap's full-level normals on a coarse grid, which a tile drawn at a
   * coarser level shades from (see {@link StackCapNormalMap}).
   */
  normalMap?: StackCapNormalMap | null;
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
export function buildStackGeometries(
  tessellation: StackTessellation,
  positionsXZ: Float32Array,
  heights: Float32Array[],
  layerIndices?: (Uint32Array | null)[],
  caps?: boolean[],
  inferred?: Float32Array[],
  peelIndices?: (Uint32Array | null)[],
): StackGeometryLayer[] {
  const build = createStackGeometryBuilder(
    tessellation,
    positionsXZ,
    heights,
    layerIndices,
    caps,
    inferred,
    peelIndices,
  );
  return heights.map((_, i) => build(i));
}

/**
 * {@link buildStackGeometries} one layer at a time — same arguments; the returned
 * function builds layer `i` — so a caller can hand each cap on as soon as it
 * exists (see {@link SurfaceStackOptions.stream}).
 *
 * @group Geometries
 */
export function createStackGeometryBuilder(
  tessellation: StackTessellation,
  positionsXZ: Float32Array,
  heights: Float32Array[],
  layerIndices?: (Uint32Array | null)[],
  caps?: boolean[],
  inferred?: Float32Array[],
  peelIndices?: (Uint32Array | null)[],
): (layer: number) => StackGeometryLayer {
  const shared = new BufferAttribute(tessellation.indices, 1);
  // ⭐ Split cap layout: every cap SHARES one `xz` attribute; only `y` differs per
  // layer, and that `y` IS the height array (shared by reference with the section
  // source, so the two never duplicate it). A cap therefore stores no full
  // (x, y, z) position — the materials assemble it in the shader (see
  // `ChunkMaterial`).
  const sharedXZ = new BufferAttribute(positionsXZ, 2);

  return (i: number): StackGeometryLayer => {
    const y = heights[i];
    const rimY = stackRimHeights(y, tessellation.rimVertices);
    // A layer can take part WITHOUT being drawn — when the chunk above or below
    // already draws that surface. Its rim still matters (the walls hang from it),
    // but building a mesh nobody renders would be pure waste, and an unowned
    // geometry is a leak waiting to happen.
    if (caps && caps[i] === false) return { geometry: null, rimY };
    const arrays = buildStackCapArrays(
      stackCapInput(
        tessellation.indices,
        positionsXZ,
        y,
        i,
        layerIndices,
        peelIndices,
      ),
    );
    return {
      geometry: stackCapGeometry(arrays, sharedXZ, shared, y, inferred?.[i]),
      rimY,
      patchIndex: arrays.patchIndex,
    };
  };
}

function stackCapInput(
  shared: Uint32Array,
  positionsXZ: Float32Array,
  y: Float32Array,
  i: number,
  layerIndices?: (Uint32Array | null)[],
  peelIndices?: (Uint32Array | null)[],
  levels?: Uint32Array[],
  toGrid?: [number, number, number, number, number, number],
): StackCapInput {
  return {
    positionsXZ,
    y,
    shared,
    own: layerIndices?.[i] ?? null,
    peel: peelIndices?.[i] ?? null,
    levels: levels ?? null,
    toGrid: toGrid ?? null,
  };
}

/**
 * A cap's geometry from its {@link StackCapArrays}: the shared `xz`, its own `y`
 * (the height array itself), and what the arrays computed.
 */
function stackCapGeometry(
  arrays: StackCapArrays,
  sharedXZ: BufferAttribute,
  shared: BufferAttribute,
  y: Float32Array,
  marks: Float32Array | undefined,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('xz', sharedXZ);
  geometry.setAttribute('y', new BufferAttribute(y, 1));
  if (marks && marks.some(v => v > 0)) {
    geometry.setAttribute('inferred', new BufferAttribute(marks, 1));
  }
  geometry.setAttribute('normal', new BufferAttribute(arrays.normal, 3, true));
  geometry.setIndex(
    arrays.index ? new BufferAttribute(arrays.index, 1) : shared,
  );
  // ⚠️ A cap ships no `position`, so three cannot derive these — and a null
  // bounding sphere frustum-culls the whole cap the moment the local origin leaves
  // a close-up view.
  const [x0, y0, z0, x1, y1, z1] = arrays.box;
  geometry.boundingBox = new Box3(
    new Vector3(x0, y0, z0),
    new Vector3(x1, y1, z1),
  );
  const [cx, cy, cz, r] = arrays.sphere;
  geometry.boundingSphere = new Sphere(new Vector3(cx, cy, cz), r);
  return geometry;
}

/** A level with no patch: copied per cap when handed on, so sharing it is safe. */
const NO_TRIANGLES = new Uint32Array(0);

/**
 * Where each tile's triangles start in `kept`, an in-order subset of `shared`
 * (`null` = all of it), given where they start in `shared`.
 */
function keptTileStarts(
  shared: Uint32Array,
  sharedStarts: Uint32Array,
  kept: Uint32Array | null,
): Uint32Array {
  if (!kept) return sharedStarts.slice();
  const out = new Uint32Array(sharedStarts.length);
  const triangles = shared.length / 3;
  const keptTriangles = kept.length / 3;
  let j = 0;
  let tile = 0;
  for (let i = 0; i < triangles; i++) {
    while (tile + 1 < sharedStarts.length && i >= sharedStarts[tile + 1]) {
      out[++tile] = j;
    }
    if (
      j < keptTriangles &&
      shared[3 * i] === kept[3 * j] &&
      shared[3 * i + 1] === kept[3 * j + 1] &&
      shared[3 * i + 2] === kept[3 * j + 2]
    ) {
      j++;
    }
  }
  while (tile + 1 < out.length) out[++tile] = j;
  return out;
}

/**
 * Reverse `indices` in place when its triangles face DOWN in scene XZ — the flip
 * `buildStackCapArrays` would make on the first cap drawn from the shared set. Done
 * before the walls, the section and the caps, which read the same array — a cap
 * built on a worker re-winds only its copy.
 */
function orientUpward(indices: Uint32Array, positionsXZ: Float32Array) {
  // Twice the plan area, signed as the Y of each face normal: (b - a) × (c - a).
  let area = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = 2 * indices[t];
    const b = 2 * indices[t + 1];
    const c = 2 * indices[t + 2];
    area +=
      (positionsXZ[b + 1] - positionsXZ[a + 1]) *
        (positionsXZ[c] - positionsXZ[a]) -
      (positionsXZ[b] - positionsXZ[a]) *
        (positionsXZ[c + 1] - positionsXZ[a + 1]);
  }
  if (area >= 0) return;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const swap = indices[t + 1];
    indices[t + 1] = indices[t + 2];
    indices[t + 2] = swap;
  }
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
  /** per-pair thin flags (see {@link StackCollapseOptions.thin}) */
  thin?: (Uint8Array | null)[];
  /** the turn past which a rim point is a crease; see `RingWallOptions` */
  smoothAngle?: number;
  /**
   * The per-interval triangle masks ({@link stackIntervalTriangles}), when the
   * caller already has them — they are a full pass over every triangle per
   * interval. Computed from the options above when omitted.
   */
  members?: Uint8Array[];
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
  /**
   * The tallest wall point away from the rim. A pinch-out's is at most the
   * collapse threshold by construction; anything taller is a data edge, or a
   * termination drawn on the wrong side of its line.
   */
  maxInteriorWall: number;
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
    return {
      walls,
      intervals: null,
      ringsDropped: 0,
      ringsOpen: 0,
      maxInteriorWall: 0,
    };

  const { indices } = tessellation;
  const vertexCount = tessellation.coords.length >> 1;
  const opposite = buildEdgeOpposites(indices, vertexCount);
  const members =
    options.members ??
    stackIntervalTriangles(heights, indices, {
      threshold: options.threshold,
      coverage: options.coverage,
      coverageTriangles: options.coverageTriangles,
      absent: options.absent,
      unbounded: options.unbounded,
      thin: options.thin,
    });
  // The mesh boundary rather than `rimVertices`: a node lying exactly on the rim
  // splits a rim edge without being one of the densified rim points.
  const onRim = new Uint8Array(vertexCount);
  for (let e = 0; e < indices.length; e++) {
    if (opposite[e] >= 0) continue;
    onRim[indices[e]] = 1;
    onRim[indices[e - (e % 3) + ((e + 1) % 3)]] = 1;
  }
  let maxInteriorWall = 0;

  const point = (v: number): Vec2 => [
    positionsXZ[2 * v],
    positionsXZ[2 * v + 1],
  ];
  let ringsDropped = 0;
  let ringsOpen = 0;

  for (let i = 0; i + 1 < heights.length; i++) {
    if (!options.fills[i]) continue;
    const traced = traceBoundaryRings(indices, opposite, members[i]);
    ringsDropped += traced.dropped;
    ringsOpen += traced.open;
    const rings = traced.rings;
    if (rings.length === 0) continue;

    // `buildRingWalls` faces a quad away from the material when the region's
    // rings sum to a POSITIVE area. Fixed here rather than taken from the outline,
    // whose winding is the caller's: a clockwise one turned every wall inward.
    const total = rings.reduce((a, r) => a + ringSignedArea(r.map(point)), 0);
    const flip = total < 0;

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
    if (!clamped) {
      for (const ring of rings) {
        for (const v of ring) {
          if (!onRim[v] && top[v] - bottom[v] > maxInteriorWall)
            maxInteriorWall = top[v] - bottom[v];
        }
      }
    }
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

  return {
    walls,
    intervals: members,
    ringsDropped,
    ringsOpen,
    maxInteriorWall,
  };
}

/**
 * Default {@link SurfaceStackOptions.collapseThreshold}, in world units.
 *
 * @group Geometries
 */
export const DEFAULT_STACK_COLLAPSE_THRESHOLD = 0.5;

/**
 * What every layer of a stack shares, handed to {@link SurfaceStackStream.shared}
 * before the first cap is built.
 *
 * ⚠️ The build goes on reading `positionsXZ`, `indices`, `heights` and `inferred`
 * — they are what the caps are built from, and each cap's `xz`/`y`/`inferred`/index
 * IS one of them. Send copies; transferring them would hollow out the caps.
 *
 * @group Geometries
 */
export type SurfaceStackShared = {
  positionsXZ: Float32Array;
  indices: Uint32Array;
  heights: Float32Array[];
  inferred?: Float32Array[];
  section?: StackSectionSource;
  /** per layer, the wall of the interval below it (see `SurfaceStackBuild.walls`) */
  walls: (BufferGeometry | null)[];
  capNeighbours?: (StackCapNeighbours | null)[];
  /** per layer: whether a cap will follow */
  caps: boolean[];
};

/**
 * Hooks {@link buildSurfaceStack} calls as it goes. The walls and the section are
 * built before any cap, so `shared` carries them.
 *
 * @group Geometries
 */
export type SurfaceStackStream = {
  shared?: (shared: SurfaceStackShared) => void;
  /** one cap as soon as it is built — in layer order from `buildSurfaceStack`, in the caller's from `beginSurfaceStack` */
  cap?: (layer: number, built: StackGeometryLayer) => void;
};

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
   * Default {@link DEFAULT_STACK_COLLAPSE_THRESHOLD}; `0` disables the thickness
   * test (coverage still applies).
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
   * Per layer, per candidate, its level (see `collectStackCandidateLevels`) —
   * what `lod` builds its coarser levels from. Computed inline with the
   * candidates when they are omitted.
   */
  candidateErrors?: Float32Array[];
  /**
   * Also build coarser levels of detail over the same vertices (see
   * {@link StackGeometryLayer.levels}): level `k` simplified to `maxError ×
   * factor^k`, keeping the rim, cuts, data edges and tile seams and thinning the
   * pinch-out lines. Off when omitted or `levels` is 0.
   */
  lod?: { levels: number; factor: number };
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
   * Constrain each pair's thickness termination into the shared tessellation
   * instead (see `traceThicknessLines`): the line itself, simplified, rather than
   * the grid nodes either side of it. Default false.
   *
   * ⭐ Supersedes `refineTerminations`, which defaults to OFF when this is on.
   */
  constrainTerminations?: boolean;
  /**
   * Triangulate in square tiles of this many reference cells, joined along their
   * seams (see `planStackTessellation`). Omitted = one triangulation.
   */
  tileCells?: number;
  /**
   * Per adjacent pair, the raw termination loops from `scanThicknessLoops`, when
   * they were scanned elsewhere (on a worker pool). A pair scanned at any other
   * threshold than `collapseThreshold` is scanned again here.
   */
  terminationLoops?: ThicknessLoops[];
  /**
   * Per adjacent pair, the simplified termination lines from an earlier plan of
   * the SAME channels at the same `collapseThreshold` and `maxError` (see
   * {@link SurfaceStackPlan.terminationLines}). Supersedes `terminationLoops`.
   */
  terminationLines?: ThicknessLines[];
  /**
   * Per layer, its data edge's crossings (see `collectCoverageCrossings`) from an
   * earlier plan of the same masks (see {@link SurfaceStackPlan.coverageCrossings}).
   * Collected here for any layer without one.
   */
  coverageCrossings?: (Uint32Array | undefined)[];
  /**
   * Hooks to hand the build on WHILE it runs: what the layers share once, then
   * each cap as soon as it is built (see `documents/chunk-stack/streaming.md`).
   */
  stream?: SurfaceStackStream;
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
  /**
   * Also emit, per cap, the solid unit directly above and below each of its
   * triangles (see {@link stackCapNeighbours}) — what lets a renderer skip the
   * parts of a cap buried inside the block. Needs `fills`; costs two bytes per
   * kept cap triangle.
   */
  capNeighbours?: boolean;
  /**
   * Also measure what only REPORTS: {@link SurfaceStackBuild.depths} and
   * {@link SurfaceStackBuild.duplicates}. Default false — ~0.9 s on a field column,
   * ahead of any geometry.
   */
  diagnostics?: boolean;
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
  /** where `tessellateMs` went */
  tessellation: StackTessellationTimings;
};

/**
 * The parts of {@link SurfaceStackTimings.tessellateMs} (ms).
 *
 * @group Geometries
 */
export type StackTessellationTimings = {
  /** merging the candidates and simplifying the pinch-out lines */
  prepMs: number;
  /** noding, seams, and cutting into tiles */
  planMs: number;
  /** the tiles, wall clock, wherever they ran */
  tilesMs: number;
  /** every tile's own time, summed (÷ `tilesMs` = how parallel they ran) */
  tileWorkMs: number;
  slowestTileMs: number;
  /** joining the tiles and flagging the triangles */
  stitchMs: number;
  tiles: number;
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
  /** see {@link StackWalls.maxInteriorWall} */
  maxInteriorWall: number;
  /** the shared rim rings in scene XZ, matching each layer's `rimY` */
  rings: Coordinates2D[];
  resolved: StackResolveResult;
  collapsed: StackCollapseResult | null;
  /** per-layer depth statistics, measured inside the footprint (with `diagnostics`) */
  depths?: StackLayerDepth[];
  /**
   * Per layer, the share of its jointly-covered vertices coincident with the layer
   * above, measured BEFORE the resolve (~1 = a duplicated horizon). With
   * `diagnostics`.
   */
  duplicates?: number[];
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
  /**
   * Per layer, the neighbours of its cap's triangles, when
   * {@link SurfaceStackOptions.capNeighbours} asked for them. `null` for a layer
   * with no cap, or whose cap is not on the shared tessellation (the sea's lid).
   */
  capNeighbours?: (StackCapNeighbours | null)[];
  timings: SurfaceStackTimings;
  /**
   * Termination lines left out, when `constrainTerminations` was on: `tiny`
   * flicker loops, and lines `discarded` because even the unsimplified trace
   * crosses itself.
   */
  terminationLines?: { tiny: number; discarded: number };
};

/**
 * A stack built up to its caps (see {@link beginSurfaceStack}).
 *
 * @group Geometries
 */
export type SurfaceStackPending = {
  /** per layer, what its cap is built from, or `null` for a layer with no TIN cap */
  jobs: (StackCapInput | null)[];
  /** turn one layer's arrays (`null` for a `null` job) into its cap, and stream it */
  finishCap(layer: number, arrays: StackCapArrays | null): StackGeometryLayer;
  /** the build, from every layer's `finishCap` result in layer order */
  finish(layers: StackGeometryLayer[]): SurfaceStackBuild;
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
  const pending = beginSurfaceStack(reference, _layers, options);
  if (!pending) return null;
  return pending.finish(
    pending.jobs.map((job, i) =>
      pending.finishCap(i, job && buildStackCapArrays(job)),
    ),
  );
}

/**
 * {@link buildSurfaceStack} up to its caps, which are left to the caller: build
 * each job's arrays anywhere (`buildStackCapArrays` is free of three.js, so a
 * worker pool can), hand them to `finishCap` in ANY order, then `finish`.
 *
 * @group Geometries
 */
export function beginSurfaceStack(
  reference: StackReference,
  _layers: StackLayer[],
  options: SurfaceStackOptions,
): SurfaceStackPending | null {
  const plan = planSurfaceStack(reference, _layers, options);
  return plan.begin(plan.tiles.map(tile => tessellateStackTile(tile)));
}

/**
 * A stack planned up to its shared tessellation's tiles (see
 * {@link planSurfaceStack}).
 *
 * @group Geometries
 */
export type SurfaceStackPlan = {
  /** run each through `tessellateStackTile`, anywhere: it is free of three.js */
  tiles: StackTileInput[];
  /**
   * The stack up to its caps, from every tile's output in tile order; `null` when
   * the mask covers no geometry. Never reads `tiles`, so they may be transferred.
   */
  begin(outputs: StackTileOutput[]): SurfaceStackPending | null;
  /**
   * The termination lines it constrains, when it constrains them. Depends on the
   * channels alone, so another build of them can skip making them again.
   */
  terminationLines?: ThicknessLines[];
  /** per layer, its data edge's crossings, when it refines along them */
  coverageCrossings?: (Uint32Array | undefined)[];
};

/**
 * {@link beginSurfaceStack} up to its tessellation's tiles, which are left to the
 * caller: triangulate them anywhere (a worker pool can), then `begin`.
 *
 * @group Geometries
 */
export function planSurfaceStack(
  reference: StackReference,
  _layers: StackLayer[],
  options: SurfaceStackOptions,
): SurfaceStackPlan {
  const maxError = options.maxError ?? 5;
  const collapseThreshold =
    options.collapseThreshold ?? DEFAULT_STACK_COLLAPSE_THRESHOLD;

  const t0 = performance.now();

  // The height refinement only knows about each surface on its own, so it puts no
  // vertices where two of them converge. Those are exactly the lines the collapse
  // cuts along, so refine them too — the candidates are a union, and the crossings
  // are a thin line, so this costs vertices only where a unit wedges out.
  let candidates = options.candidates;
  let candidateErrors = options.candidateErrors;
  const lod =
    options.lod && options.lod.levels > 0
      ? Array.from(
          { length: options.lod.levels },
          (_, k) => maxError * options.lod!.factor ** (k + 1),
        )
      : undefined;
  const constrainTerminations =
    collapseThreshold > 0 &&
    !!options.constrainTerminations &&
    reference.channels.length > 1;
  const refineTerminations =
    collapseThreshold > 0 &&
    (options.refineTerminations ?? !constrainTerminations) &&
    reference.channels.length > 1;
  const refineCoverage = options.refineCoverage ?? !options.constrainCoverage;
  const coverageCrossings = refineCoverage
    ? reference.masks.map((mask, i) =>
        mask
          ? (options.coverageCrossings?.[i] ??
            collectCoverageCrossings(mask, reference.header.nx))
          : undefined,
      )
    : undefined;
  if (refineTerminations || refineCoverage) {
    let lists = candidates;
    if (!lists) {
      const levels = reference.channels.map(channel =>
        collectStackCandidateLevels(channel, reference.header.nx, maxError),
      );
      lists = levels.map(level => level.nodes);
      candidateErrors = levels.map(level => level.errors);
    }
    const errors = candidateErrors;
    candidateErrors = [];
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
      const coverage = coverageCrossings?.[i];
      if (coverage) extra.push(coverage);
      const total = extra.reduce((a, e) => a + e.length, 0);
      // An added node marks a line, which every coarser level keeps.
      const levels = new Float32Array(list.length + total).fill(Infinity);
      if (errors?.[i]) levels.set(errors[i]);
      candidateErrors!.push(levels);
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

  let terminations: ThicknessLines[] | undefined;
  if (constrainTerminations && options.terminationLines) {
    terminations = options.terminationLines;
  } else if (constrainTerminations) {
    terminations = [];
    for (let i = 1; i < reference.channels.length; i++) {
      const scanned = options.terminationLoops?.[i - 1];
      terminations.push(
        simplifyThicknessLoops(
          scanned?.threshold === collapseThreshold
            ? scanned
            : scanThicknessLoops(
                reference.channels[i - 1],
                reference.channels[i],
                reference.header.nx,
                collapseThreshold,
              ),
          { channels: reference.channels, maxError },
        ),
      );
    }
  }
  const tPrep = performance.now();

  const plan = planStackTessellation(
    reference,
    options.polygon,
    maxError,
    candidates,
    options.cuts,
    options.constrainCoverage,
    terminations?.map(t => t.rings),
    options.tileCells,
    lod && { errors: lod, candidateErrors },
  );
  const tPlan = performance.now();
  return {
    tiles: plan.tiles,
    terminationLines: terminations,
    coverageCrossings,
    begin: outputs => {
      const tTiles = performance.now();
      const tessellation = plan.finish(outputs);
      const timings: StackTessellationTimings = {
        prepMs: tPrep - t0,
        planMs: tPlan - tPrep,
        tilesMs: tTiles - tPlan,
        tileWorkMs: outputs.reduce((sum, o) => sum + o.tileMs, 0),
        slowestTileMs: outputs.reduce((max, o) => Math.max(max, o.tileMs), 0),
        stitchMs: performance.now() - tTiles,
        tiles: outputs.length,
      };
      return (
        tessellation &&
        beginOnTessellation(
          reference,
          options,
          tessellation,
          t0,
          terminations,
          timings,
        )
      );
    },
  };
}

function beginOnTessellation(
  reference: StackReference,
  options: SurfaceStackOptions,
  tessellation: StackTessellation,
  t0: number,
  terminations: ThicknessLines[] | undefined,
  tessellationTimings: StackTessellationTimings,
): SurfaceStackPending {
  const collapseThreshold =
    options.collapseThreshold ?? DEFAULT_STACK_COLLAPSE_THRESHOLD;
  const coverageAbsence = options.coverageAbsence ?? true;
  const fluid = options.fluid;
  const unbounded = options.unbounded?.map(f => !!f);
  const constrainTerminations = terminations !== undefined;
  // Includes the tiles, wherever they ran.
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
  // Plain loops: `Float32Array.from(mask, fn)` and `.some(fn)` cost ~10x as much,
  // and this runs per layer over every shared vertex.
  const uncovered = (mask: Uint8Array) => {
    const out = new Float32Array(mask.length);
    for (let v = 0; v < mask.length; v++) out[v] = mask[v] ? 0 : 1;
    return out;
  };
  const positive = (weights: Float32Array) => {
    for (let v = 0; v < weights.length; v++) if (weights[v] > 0) return true;
    return false;
  };
  // ⚠️ A layer the seal could not process — nothing above it or below it to lean
  // on, which is what the end of a column looks like — comes back with all-zero
  // weights and is still drawn on the fill, so it would be the one invented thing
  // left unmarked. Per LAYER is exact rather than a heuristic: a layer the seal did
  // process carries a positive weight at every unmapped node.
  const inferred = coverageAbsence
    ? sampled
    : (sampled ?? coverage.map(uncovered)).map((weights, i) =>
        positive(weights) ? weights : uncovered(coverage[i]),
      );
  const tSample = performance.now();

  const depths = options.diagnostics ? stackDepthStats(heights) : undefined;
  // Measured BEFORE resolving, or the welding masquerades as duplication.
  const duplicates = options.diagnostics
    ? stackDuplicateFractions(heights, coverage, collapseThreshold || 0.5)
    : undefined;

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

  // On the outline, a coarse cap takes the height of the full level's edge there,
  // which is where the walls run. A blend of two ordered stacks stays ordered.
  const blends = tessellation.outlineBlends;
  if (blends) {
    for (const h of heights) {
      for (let i = 0; i < blends.vertices.length; i++) {
        const a = h[blends.ends[2 * i]];
        const b = h[blends.ends[2 * i + 1]];
        h[blends.vertices[i]] = a + blends.along[i] * (b - a);
      }
    }
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

  const excludedBy = (flags: Uint8Array[] | undefined, triangles: number) => {
    const masks = options.capCuts?.map(list => {
      if (!list || list.length === 0 || !flags) return null;
      if (list.length === 1) return (flags[list[0]] ?? null) as Uint8Array;
      const merged = new Uint8Array(triangles);
      for (const k of list) {
        const f = flags[k];
        if (!f) continue;
        for (let t = 0; t < merged.length; t++) if (f[t]) merged[t] = 1;
      }
      return merged;
    });
    // A chunk that shares nothing still gets an entry per layer, and an array of
    // nulls must not make the collapse run where it otherwise would not.
    return masks?.some(mask => mask) ? masks : undefined;
  };
  const excludes = excludedBy(
    tessellation.cuts,
    tessellation.indices.length / 3,
  );

  const thin = constrainTerminations
    ? classifyThinTriangles(reference, tessellation, heights, collapseThreshold)
    : undefined;

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
          thin,
        })
      : null;

  const positionsXZ = stackVertexPositions(reference, tessellation.coords);
  // Each coarser level drops by the same rules, over its own triangles. Wound
  // upward first, so its caps take their copies as they are.
  const levelCollapses = tessellation.levels?.map(level => {
    orientUpward(level.indices, positionsXZ);
    const levelExcludes = excludedBy(level.cuts, level.indices.length / 3);
    return collapseThreshold > 0 || coverageAbsence || levelExcludes
      ? collapseStackTriangles(heights, level.indices, {
          threshold: collapseThreshold,
          coverage: coverageAbsence ? coverage : undefined,
          coverageTriangles: coverageAbsence ? level.coverage : undefined,
          absent,
          ceiling: options.ceiling,
          capExcluded: levelExcludes,
          carrier: options.carrier,
          unbounded,
          peelable: options.peelable,
          thin: constrainTerminations
            ? classifyThinTriangles(
                reference,
                {
                  ...tessellation,
                  indices: level.indices,
                  terminationVertices: level.terminationVertices,
                },
                heights,
                collapseThreshold,
              )
            : undefined,
        })
      : null;
  });
  const levelKept = levelCollapses?.map((result, k) =>
    heights.map((_, i) => result?.indices[i] ?? tessellation.levels![k].indices),
  );
  // Per cap, per level (the full one first): where each tile's triangles start,
  // so a renderer can pick a level per tile. Before the shared index is re-wound.
  const capTileStarts =
    levelKept && tessellation.tileStarts
      ? heights.map((_, i) => [
          keptTileStarts(
            tessellation.indices,
            tessellation.tileStarts!,
            collapsed?.indices[i] ?? null,
          ),
          ...tessellation.levels!.map((level, k) =>
            keptTileStarts(
              level.indices,
              level.tileStarts,
              levelKept[k][i] === level.indices ? null : levelKept[k][i],
            ),
          ),
        ])
      : undefined;
  // Per cap with a patch at any level: the patch at each coarser level, and where
  // each tile starts in it at every level — the full patch is the cap arrays'
  // `patchIndex`, the same triangles in the same order.
  const capPatches =
    levelCollapses && levelKept && tessellation.tileStarts
      ? heights.map((_, i) => {
          const peel = collapsed?.peelIndices?.[i];
          const full = peel
            ? indexDifference(peel, collapsed!.indices[i] ?? tessellation.indices)
            : null;
          const levels = levelCollapses.map((result, k) => {
            const levelPeel = result?.peelIndices?.[i];
            return levelPeel ? indexDifference(levelPeel, levelKept[k][i]) : null;
          });
          if (!full && levels.every(patch => !patch)) return null;
          return {
            levels: levels.map(patch => patch ?? NO_TRIANGLES),
            tileStarts: [
              keptTileStarts(
                tessellation.indices,
                tessellation.tileStarts!,
                full ?? NO_TRIANGLES,
              ),
              ...tessellation.levels!.map((level, k) =>
                keptTileStarts(
                  level.indices,
                  level.tileStarts,
                  levels[k] ?? NO_TRIANGLES,
                ),
              ),
            ],
          };
        })
      : undefined;

  // The sea's lid is built below, on its own triangulation of the outline.
  const caps = unbounded
    ? unbounded.map((f, i) => !f && options.caps?.[i] !== false)
    : options.caps;

  // ⚠️ One pass serves both the walls and the cap neighbours, and it has to come
  // BEFORE the geometry build: that may reverse the winding of the kept indices in
  // place, and the neighbours match those against the shared set triple by triple.
  const maskOptions = {
    threshold: collapseThreshold,
    coverage: coverageAbsence ? coverage : undefined,
    coverageTriangles: coverageAbsence ? tessellation.coverage : undefined,
    absent,
    unbounded,
    thin,
  };
  const states =
    options.fills && options.capNeighbours
      ? stackIntervalStates(heights, tessellation.indices, maskOptions)
      : undefined;
  const capNeighbours =
    states && options.fills
      ? stackCapNeighbours(
          states,
          options.fills,
          tessellation.indices,
          collapsed?.indices,
          caps,
        )
      : undefined;
  const tCollapse = performance.now();

  const rings = stackRimRings(positionsXZ, tessellation.rimVertices);
  // AFTER the cap neighbours, which match the collapse's indices against these
  // triple by triple as both were emitted.
  orientUpward(tessellation.indices, positionsXZ);

  const members = states ? stackIntervalMembers(states) : undefined;
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
        thin,
        members,
      })
    : {
        walls: heights.map(() => null),
        intervals: null,
        ringsDropped: 0,
        ringsOpen: 0,
        maxInteriorWall: 0,
      };
  const tWalls = performance.now();

  // The walls skip the masks when nothing is filled, but a gap still carries data.
  const intervalMasks =
    walls.intervals ??
    (options.section && options.fills
      ? (members ??
        stackIntervalTriangles(heights, tessellation.indices, maskOptions))
      : null);

  // An interval with no volume has no material to show on the cut, so it is left
  // out here rather than being filtered by every consumer.
  // ⭐ Packed to one bit per triangle here: the wall builder wants a byte it can
  // index, but this copy is the one that crosses to the main thread and stays for
  // the life of the build.
  const section: StackSectionSource | undefined =
    options.section && intervalMasks
      ? {
          positionsXZ,
          indices: tessellation.indices,
          heights,
          intervals: intervalMasks.map((mask, i) =>
            options.fills?.[i] ? packTriangleMask(mask) : null,
          ),
          // A bit per triangle, and only for the few intervals left open.
          gaps: intervalMasks.map((mask, i) =>
            !options.fills?.[i] && mask.indexOf(1) >= 0
              ? packTriangleMask(mask)
              : null,
          ),
          // A void under a gap has no ceiling drawn, so it reads as part of the gap.
          voids: intervalMasks.map(
            (_, i) =>
              options.ceiling?.[i] === true &&
              i > 0 &&
              !!options.fills?.[i - 1],
          ),
          inferred,
        }
      : undefined;
  if (section) section.index = buildStackSectionIndex(section);

  options.stream?.shared?.({
    positionsXZ,
    indices: tessellation.indices,
    heights,
    inferred,
    section,
    walls: walls.walls,
    capNeighbours,
    caps: heights.map(
      (_, i) =>
        (caps?.[i] ?? true) ||
        (!!options.unbounded?.[i] && options.caps?.[i] !== false),
    ),
  });
  const tShared = performance.now();

  // ⭐ After the walls and the section, and one at a time, so a streaming caller
  // can hand each cap on as soon as it exists.
  const sharedIndex = new BufferAttribute(tessellation.indices, 1);
  const sharedXZ = new BufferAttribute(positionsXZ, 2);
  // Read only where a coarser level draws, so only built with one.
  const toGrid = tessellation.levels?.length
    ? (stackSceneToGrid(reference).map(
        v => v / CAP_NORMAL_MAP_CELLS,
      ) as ReturnType<typeof stackSceneToGrid>)
    : undefined;
  const jobs = heights.map((y, i) =>
    caps && caps[i] === false
      ? null
      : stackCapInput(
          tessellation.indices,
          positionsXZ,
          y,
          i,
          collapsed?.indices,
          collapsed?.peelIndices,
          levelKept?.map(kept => kept[i]),
          toGrid,
        ),
  );
  let shapes: ReturnType<PlanarPolygonGeometry['toShapes']> | null = null;
  const finishCap = (
    i: number,
    arrays: StackCapArrays | null,
  ): StackGeometryLayer => {
    const y = heights[i];
    const layer: StackGeometryLayer = {
      geometry: arrays
        ? stackCapGeometry(arrays, sharedXZ, sharedIndex, y, inferred?.[i])
        : null,
      rimY: stackRimHeights(y, tessellation.rimVertices),
      patchIndex: arrays?.patchIndex ?? null,
      levels: arrays ? (jobs[i]?.levels ?? null) : null,
      tileStarts: arrays ? (capTileStarts?.[i] ?? null) : null,
      patchLevels: arrays ? (capPatches?.[i]?.levels ?? null) : null,
      patchTileStarts: arrays ? (capPatches?.[i]?.tileStarts ?? null) : null,
      normalMap: arrays?.normalMap ?? null,
    };
    const lid = options.unbounded?.[i];
    if (lid && options.caps?.[i] !== false) {
      // Ear clipping puts no vertices on the boundary and the refinement never
      // splits it, so the lid's rim IS the shared rim — the same points the wall
      // of the volume below hangs from, at any resolution. Constant in Y, like the
      // carrier, so any vertex of it is the plane.
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
      layer.geometry = createPolygonCap(shapes, {
        y: heights[i][0],
        resolution: lid.resolution,
      });
    }
    if (layer.geometry) options.stream?.cap?.(i, layer);
    return layer;
  };

  const finish = (built: StackGeometryLayer[]): SurfaceStackBuild => {
    const tGeometry = performance.now();
    return {
      tessellation,
      heights,
      coverage,
      inferred,
      layers: built,
      walls: walls.walls,
      ringsDropped: walls.ringsDropped,
      ringsOpen: walls.ringsOpen,
      maxInteriorWall: walls.maxInteriorWall,
      rings,
      resolved,
      collapsed,
      depths,
      duplicates,
      topKept,
      section,
      capNeighbours,
      terminationLines: terminations
        ? {
            tiny: terminations.reduce((a, t) => a + t.tiny, 0),
            discarded: terminations.reduce((a, t) => a + t.discarded, 0),
          }
        : undefined,
      timings: {
        tessellateMs: tTessellate - t0,
        sampleMs: tSample - tTessellate,
        resolveMs: tResolve - tSample,
        collapseMs: tCollapse - tResolve,
        geometryMs: tGeometry - tShared,
        wallMs: tWalls - tCollapse,
        tessellation: tessellationTimings,
      },
    };
  };

  return { jobs, finishCap, finish };
}
