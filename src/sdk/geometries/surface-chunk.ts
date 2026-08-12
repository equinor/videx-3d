import { BufferGeometry } from 'three';
import { Vec2 } from '../types/common';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';
import { buildIntervalWalls } from './surface-walls';

/**
 * One mesh of a chunk, tagged with the layer it came from.
 *
 * The index matters because the lists are SPARSE: a layer whose geometry was
 * dropped contributes no surface, and a wall exists only for a filled interval. So
 * position in the list says nothing about which layer a mesh belongs to — which is
 * exactly what a caller needs to know to give it the right material.
 *
 * @group Geometries
 */
export type SurfaceChunkMesh = {
  geometry: BufferGeometry;
  /** index into the caller's layer list (for a wall: the layer ABOVE the interval) */
  layer: number;
  /**
   * This surface is the ceiling of a void: it faces UP, so it shows the BASE of
   * the interval above rather than the cap of `layer`, and should take that
   * interval's colour. Only ever set on a surface.
   */
  ceiling?: boolean;
};

/**
 * One layer's share of {@link SurfaceChunkDiagnostics}. The chunk-level totals are
 * sums, which hide WHICH layer lost its geometry — and that is usually the only
 * question worth asking when a chunk comes out with holes in it.
 *
 * @group Geometries
 */
export type SurfaceChunkLayerDiagnostics = {
  /** position in the chunk's flat layer order (0 = the chunk's own top) */
  index: number;
  /** the surface id, so a row can be tied back to a name (null when synthetic) */
  id: string | null;
  /**
   * Share of the REQUESTED footprint where this layer has data of its own (0..1).
   *
   * Measured before the outline is cut back to the data (see
   * `trimPolygonToCoverage`), so that a chunk which shrank can be traced to the
   * layer that shrank it. Measuring it after the cut would report 1 for every
   * layer of every chunk, by construction.
   */
  coverage: number;
  /**
   * The part of `coverage` that is bounded FILL rather than data (0..1) — see
   * `ChunkResolveOptions.maxFill`. Coverage bought by bridging a hole is a
   * plausible extrapolation, and a layer whose coverage is mostly this is
   * standing on very little.
   */
  filled: number;
  /**
   * Share of the REQUESTED footprint where this layer has no data at all, and its
   * height was therefore INFERRED by the seal (`1 - coverage`).
   *
   * ⚠️ This is invented geometry. A layer with a large share here is mostly a
   * construction and should be read as one.
   */
  inferred: number;
  /**
   * This layer has no data ANYWHERE the chunk is drawn (not even within
   * `maxFill` of any), so it was VOIDED: no cap, and neither interval it bounds
   * is filled. Extending it from a survey that exists only outside the crop would
   * draw a horizon with no local evidence at all.
   */
  voided: boolean;
  /** triangles actually drawn for this layer */
  triangles: number;
  /** triangles dropped because the unit is not present (no data / truncated) */
  droppedAbsent: number;
  /** triangles dropped because the unit has no thickness there */
  droppedCollapsed: number;
  /**
   * Triangles this layer's cap gave up to a NEIGHBOURING chunk that draws the
   * same horizon where their footprints overlap (see `resolveSeam`).
   */
  droppedExcluded: number;
  /**
   * Whether this layer's cap is drawn at all. `false` means a neighbouring chunk
   * contains this whole footprint and draws that horizon instead — which is the
   * one thing that makes a layer vanish for a reason outside this chunk, so it is
   * reported rather than left to be guessed.
   */
  capped: boolean;
  /**
   * Share of its jointly-covered vertices coincident with the layer above,
   * measured BEFORE the resolve (~1 = a duplicated horizon).
   */
  duplicate: number;
};

/**
 * What the depth-order resolve found in a chunk's stack. Reported so a caller can
 * SEE that it handed the layers over in the wrong order — the failure mode is
 * otherwise invisible, because the resolve dutifully makes any order consistent.
 *
 * A pair inverted over a large share of the footprint is almost always an ordering
 * problem, not geology: order by stratigraphic age, not by depth
 * (`SurfaceMeta.min`/`.max` describe a surface's whole extent, not its position
 * inside this chunk).
 *
 * @group Geometries
 */
export type SurfaceChunkDiagnostics = {
  /**
   * Vertices where a layer sat above the one over it, summed over adjacent pairs
   * and measured BEFORE the order was enforced.
   *
   * ⚠️ On a shared column these are counted on the column's grid, over the whole
   * column envelope rather than this chunk's footprint — the resolve happens once,
   * for everyone, before any chunk exists. They still answer the question the
   * diagnostic is for ("was the input in stratigraphic order?"), but they are not
   * a per-chunk quantity and will read the same for every chunk of a column.
   */
  crossings: number;
  /** the same, counted only where BOTH layers have data of their own */
  crossingsCovered: number;
  /** per-layer breakdown, in the chunk's flat layer order */
  layers: SurfaceChunkLayerDiagnostics[];
  /**
   * Rim vertices the tessellation dropped (see `StackTessellation.rimDropped`).
   * Non-zero means the wall and the surface disagree about where the chunk ends.
   */
  rimDropped: number;
  /**
   * Constraint edges the triangulator could not enforce (see
   * `StackTessellation.constraintFailures`). ⚠️ Should be 0 — non-zero means a rim
   * or a neighbour's cut does not follow mesh edges, so a boundary drawn from it
   * is a claim the mesh does not support.
   */
  constraintFailures: number;
  /**
   * Vertices the constrained data boundaries added (see
   * `ChunkResolveOptions.constrainCoverage`). 0 when it is off, or when every
   * layer is fully mapped. This is what the exact drop rule costs, in a
   * tessellation the whole stack shares.
   */
  coverageRingPoints: number;
  /**
   * Boundary walks the wall tracer discarded as degenerate, and walks that failed
   * to close. Both should be 0: a discarded walk leaves a (small) piece of an
   * interval unwalled, and an unclosed one is sealed with an edge that does not
   * exist — either way, a gap or a phantom face in a wall.
   */
  wallRingsDropped: number;
  /** see {@link SurfaceChunkDiagnostics.wallRingsDropped} */
  wallRingsOpen: number;
  /** deepest interpenetration found, in world units */
  maxOverlap: number;
  /** largest share of a layer coincident with the one above it (~1 = duplicated horizon) */
  maxDuplicate: number;
  /** triangles dropped because the unit is not present (no data / truncated) */
  trianglesAbsent: number;
  /** triangles dropped because the unit has no thickness there */
  trianglesCollapsed: number;
  /**
   * Vertices where the TOP layer was truncated away against the chunk ABOVE, but
   * kept anyway because that chunk's outline does not reach them — nothing would
   * have stood in for the dropped surface there.
   */
  topKept: number;
  /** whether the column was built once and shared by every chunk cut from it */
  sharedStack: boolean;
  /** layers in the shared column (0 when the chunk built on its own) */
  stackLayers: number;
  /** nodes of the common reference grid */
  referenceNodes: number;
  /**
   * Source grid cells per reference cell. `1` is full resolution; anything higher
   * means the common grid was decimated to stay inside the node budget, which
   * coarsens the coverage masks along with everything else.
   */
  referenceStep: number;
  /** fetching every layer's grid (shared across the column) */
  fetchMs: number;
  /** resampling the column onto the common grid (shared) */
  referenceMs: number;
  /** making the column monotone on the grid (shared) */
  stackResolveMs: number;
  /** this chunk's own tessellation */
  tessellateMs: number;
};

/** Per-phase build timings (ms) and counts for a {@link SurfaceChunk}. */
export type SurfaceChunkMetrics = {
  densifyMs: number;
  /** total surface-clip time across all layers */
  clipMs: number;
  /** total rim-sampling time across all layers */
  rimMs: number;
  wallsMs: number;
  totalMs: number;
  layers: number;
  surfaces: number;
  walls: number;
  /** total triangles (surfaces + walls) */
  triangles: number;
  /**
   * Of which, the side walls'. Traced per interval on the shared tessellation,
   * so a unit that terminates inside the chunk adds rings here — worth watching
   * against the surface count.
   */
  wallTriangles: number;
  /** shared rim vertex count (all rings) */
  rimPoints: number;
  /**
   * What the depth-order resolve found, when the build ran one (the shared
   * tessellation path). See {@link SurfaceChunkDiagnostics}.
   */
  diagnostics?: SurfaceChunkDiagnostics;
};

/**
 * The result of a chunk build: the chunk's layers in stratigraphic order, all in
 * one common scene frame.
 *
 * Surfaces and walls are FLAT lists rather than groups. A chunk is a run of
 * boundaries, and the wall between two of them exists or does not — whether a
 * given interval is filled is a property of that interval
 * ({@link AssembleChunkLayer.fill}), not of a grouping imposed on the layers.
 *
 * @group Geometries
 */
export type SurfaceChunk = {
  /** one per DRAWN layer, tagged with its layer index */
  surfaces: SurfaceChunkMesh[];
  /** one per FILLED interval, tagged with the layer above it */
  walls: SurfaceChunkMesh[];
  metrics: SurfaceChunkMetrics;
};

/**
 * Densify a polygon's rings in world XZ so no edge is longer than `spacing`,
 * returning a new polygon. Used to give a shared rim enough resolution to follow
 * the relief. `spacing <= 0` returns the polygon unchanged.
 *
 * @group Geometries
 */
export function densifyPolygon(
  polygon: PlanarPolygonGeometry,
  spacing: number,
): PlanarPolygonGeometry {
  if (spacing <= 0) return polygon;
  const comps = polygon.coordinates as PlanarPolygonCoordinates;
  const out: PlanarPolygonCoordinates = comps.map(rings =>
    rings.map(ring => densifyRing(ring, spacing)),
  );
  return new PlanarPolygonGeometry(out);
}

function densifyRing(ring: Coordinates2D, spacing: number): Coordinates2D {
  const n = ring.length;
  if (n < 2) return ring;
  const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  const m = closed ? n - 1 : n;
  const out: Vec2[] = [];
  for (let i = 0; i < m; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % m];
    out.push([a[0], a[1]]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const steps = Math.floor(len / spacing);
    for (let s = 1; s < steps; s++) {
      const t = (s * spacing) / len;
      out.push([a[0] + dx * t, a[1] + dy * t]);
    }
  }
  return out;
}

/**
 * Build a "surface chunk": one or more solid layered blocks (groups) of depth
 * surfaces clipped to a shared mask polygon and stitched together with coloured
 * side walls. Each interval's wall takes the colour of the surface above it.
 *
 * Layers are supplied as a 2D array: each inner array is one **group** whose top
 * is its first (shallowest) surface and whose base is its last (deepest). Walls
 * are built only for the intervals **within** a group, so adjacent groups are
 * separated by an empty gap (surfaces overlapping/crossing across a group boundary
 * is a special case left for later). The library is intentionally unopinionated
 * about how layers are grouped — that is the caller's decision.
 *
 * Because the layers generally come from **different grids** (resolution,
 * rotation, origin), the walls need a single rim shared vertex-for-vertex by every
 * layer. The mask polygon is densified in world XZ into that canonical rim; each
 * surface is clipped to it **without draping** so its boundary lands on exactly
 * those rim points (at the layer's own depth), and every layer is baked into one
 * common scene frame. The walls then connect consecutive layers' rims directly.
 *
 * Holes are filled (each layer spans the full polygon) so the rims stay aligned.
 * Where surfaces cross within a group, the corresponding wall segment flips; the
 * caller should render walls double-sided (or enable the clamp/pinch-out option,
 * which cascades within each group).
 *
 * @param groups groups of layers; within each group, top (shallowest) to bottom
 * @param options see {@link SurfaceChunkOptions}
 *
 * @group Geometries
 */
/**
 * Densify a chunk's mask polygon into the shared rim used by every layer, returning
 * both the densified polygon (for clipping) and its flattened rings (for rim
 * sampling / wall building).
 *
 * @group Geometries
 */
export function densifyChunkRim(
  polygon: PlanarPolygonGeometry,
  rimSpacing: number,
): { densified: PlanarPolygonGeometry; rings: Coordinates2D[] } {
  const densified = densifyPolygon(polygon, rimSpacing);
  // All rings (across components) of the shared rim, in world XZ.
  const rings = (densified.coordinates as PlanarPolygonCoordinates).flat();
  return { densified, rings };
}

/** A clipped layer as consumed by {@link assembleChunk}. */
export type AssembleChunkLayer = {
  geometry: BufferGeometry | null;
  rimY: number[][];
  /**
   * Draw the interval BELOW this layer (a wall down to the next one). `false` (the
   * default) leaves it open — which is how a gap between zones, and a surface with
   * no volume at all, are both expressed.
   */
  fill?: boolean;
  /**
   * The interval's wall, already built (see `buildStackWalls`) — traced around the
   * area the interval actually occupies rather than round the whole rim, so it
   * also stops where the unit does.
   *
   * Present at all (including `null`, meaning "there is no wall there") = use it.
   * ABSENT = fall back to a wall around the full rim, which is all the per-layer
   * clip path can offer, having no shared topology to trace.
   */
  wall?: BufferGeometry | null;
  /**
   * Index of the layer this one came FROM, when the build expanded the caller's
   * list (a surface split around a void becomes two layers). Meshes are tagged
   * with this, so materials keep resolving against the caller's own layers.
   * Defaults to the position in the array.
   */
  source?: number;
  /**
   * This surface faces UP into a void: it is the BASE of the interval above it,
   * not the cap of its own layer, so it should be coloured as the unit above.
   * Set on the upper copy of a surface split around a void.
   */
  ceiling?: boolean;
};

/** Options for {@link assembleChunk} (the non-clip build parameters). */
export type AssembleChunkOptions = {
  /** carried into the metrics (see {@link SurfaceChunkDiagnostics}) */
  diagnostics?: SurfaceChunkDiagnostics;
};

/** Timings threaded into {@link assembleChunk} for the returned metrics. */
export type ChunkBuildTimings = {
  /** `performance.now()` at the start of the whole build (for `totalMs`) */
  t0: number;
  densifyMs: number;
  /** aggregate clip time across all layers */
  clipMs: number;
  /** aggregate rim-sampling time across all layers */
  rimMs: number;
};

/**
 * Assemble a {@link SurfaceChunk} from already-built layers: the coloured side
 * walls and the metrics.
 *
 * @group Geometries
 */
export function assembleChunk(
  layers: AssembleChunkLayer[],
  rings: Coordinates2D[],
  options: AssembleChunkOptions,
  timings: ChunkBuildTimings,
): SurfaceChunk {
  const surfaces: SurfaceChunkMesh[] = [];
  // rimY[layer][ring][vertex] — each layer's rim depth at the shared rim points.
  const rimY: number[][][] = [];
  let surfaceTris = 0;

  layers.forEach((layer, i) => {
    rimY.push(layer.rimY);
    if (layer.geometry) {
      surfaces.push({
        geometry: layer.geometry,
        layer: layer.source ?? i,
        ceiling: layer.ceiling,
      });
      const idx = layer.geometry.getIndex();
      if (idx) surfaceTris += idx.count / 3;
    }
  });

  // Side walls: one mesh per FILLED interval, tagged with the layer above it. An
  // interval the caller did not fill is simply left open — that is how both a gap
  // between zones and a surface with no volume are expressed.
  const w0 = performance.now();
  const walls: SurfaceChunkMesh[] = [];
  let wallTris = 0;
  for (let i = 0; i + 1 < layers.length; i++) {
    if (!layers[i].fill) continue;
    const geometry =
      'wall' in layers[i]
        ? layers[i].wall
        : buildIntervalWalls(rings, rimY[i], rimY[i + 1]);
    if (geometry) {
      walls.push({ geometry, layer: layers[i].source ?? i });
      const idx = geometry.getIndex();
      if (idx) wallTris += idx.count / 3;
    }
  }
  const wallsMs = performance.now() - w0;

  const metrics: SurfaceChunkMetrics = {
    densifyMs: timings.densifyMs,
    clipMs: timings.clipMs,
    rimMs: timings.rimMs,
    wallsMs,
    totalMs: performance.now() - timings.t0,
    layers: layers.length,
    surfaces: surfaces.length,
    walls: walls.length,
    triangles: Math.round(surfaceTris + wallTris),
    wallTriangles: Math.round(wallTris),
    rimPoints: rings.reduce((a, r) => a + r.length, 0),
    diagnostics: options.diagnostics,
  };

  return { surfaces, walls, metrics };
}
