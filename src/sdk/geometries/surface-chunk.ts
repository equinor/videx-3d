import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';
import { computeUpwardNormals } from './geometry-attributes';
import { sampleValidGrid } from './grid-sampling';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';
import {
  duneRelief,
  RELIEF_FEATURE_SIZE,
  ridgeRelief,
} from './procedural-relief';
import {
  createClippedSurface,
  SurfaceClipHeader,
  surfaceWorldToGrid,
} from './surface-clip';
import { buildIntervalWalls } from './surface-walls';
import {
  GridPolygon,
  triangulateGridConstrained,
} from './triangulate-grid-delaunay';

/**
 * One layer of a {@link createSurfaceChunk} stack: the elevation grid plus how to
 * place and colour it. Layers should be ordered top (shallowest) to bottom.
 *
 * @group Geometries
 */
export type SurfaceChunkLayer = {
  /** row-major elevation grid of length `nx * ny` */
  values: Float32Array;
  /** grid geometry (see {@link SurfaceClipHeader}) */
  header: SurfaceClipHeader;
  /** depth-normalization reference (`SurfaceMeta.max`) */
  referenceDepth: number;
  /**
   * Scene XZ of this surface's origin — `crs.utmToWorld(xori, yori, 0)` mapped to
   * `[x, z]`. Used both to place the surface in the shared scene frame and to
   * sample the shared rim against this layer's grid.
   */
  worldPosition: Vec2;
  /** value marking a missing/hole sample (default -1) */
  nullValue?: number;
};

/**
 * Options for {@link createSurfaceChunk}.
 *
 * @group Geometries
 */
export type SurfaceChunkOptions = {
  /** mask polygon in scene XZ, shared by every layer */
  polygon: PlanarPolygonGeometry;
  /**
   * Rim densification spacing in world units — the polygon edges are subdivided
   * to at most this length so the shared rim (and the side walls) follow the
   * relief. Smaller = more wall segments. Default 250.
   */
  rimSpacing?: number;
  /** interior TIN simplification error, in grid height units. Default 5. */
  maxError?: number;
  /**
   * Optional basement slot: a solid block with a flat base, either attached below
   * the chunk's deepest layer or standalone with its own (surface / procedural)
   * top. See {@link SurfaceChunkBasement}.
   */
  basement?: SurfaceChunkBasement;
  /**
   * Optional ocean-top slot: a flat water surface at the water level plus a water
   * body down to the shallowest layer's rim (surface mode) or to a procedural sea
   * bed (procedural mode). See {@link SurfaceChunkOceanTop}. The returned water
   * geometries are meant to be rendered with the `Ocean` water shader.
   */
  oceanTop?: SurfaceChunkOceanTop;
};

/**
 * Procedural rocky-top model for a standalone {@link SurfaceChunkBasement} — used
 * when the basement is its own block (not attached to a chunk). Generates a jagged
 * rock surface as the basement TOP; the flat base then sits `thickness` below it.
 *
 * @group Geometries
 */
export type SurfaceChunkBasementProcedural = {
  /** mean depth of the procedural top below sea level, in meters (positive-down) */
  depth: number;
  /**
   * Whether `depth` is the mean top depth or the minimum (shallowest point).
   * Default `'mean'`.
   */
  depthMode?: 'mean' | 'min';
  /** ± relief amplitude of the rocky top, in meters. Default 150. */
  variation?: number;
  /** procedural seed. Default 0. */
  seed?: number;
  /**
   * Wavelength of the coarsest relief feature, in WORLD units. Default 8000.
   *
   * The field is evaluated in world space, so two chunks covering the same ground
   * generate the same rock — which is the whole point: it used to be evaluated in
   * rim-relative coordinates, so changing a chunk's outline changed its geology,
   * and neighbours never matched.
   */
  featureSize?: number;
  /** top tessellation across the larger footprint extent. Default 96. */
  segments?: number;
};

/**
 * The basement slot of a {@link SurfaceChunk}: a solid block with a **flat base**
 * sitting `thickness` below its top. The top is either the chunk's deepest surface
 * (when `top` is omitted — the basement is *attached* to the chunk) or, for a
 * *standalone* basement, an assigned surface or a procedurally generated rocky
 * surface. Side walls run from the top rim down to the flat base rim, sharing the
 * chunk's canonical rim.
 *
 * @group Geometries
 */
export type SurfaceChunkBasement = {
  /** colour. Default dark gray. */
  color?: string;
  /**
   * Distance from the top (its deepest point) down to the flat base, in meters.
   * Default 500.
   */
  thickness?: number;
  /**
   * The basement top. Omit to **attach** to the chunk (top = the deepest layer's
   * surface). Provide an assigned `surface` or a `procedural` rocky surface for a
   * **standalone** basement (its own block).
   */
  top?:
    | { surface: SurfaceChunkLayer }
    | { procedural: SurfaceChunkBasementProcedural };
};

/**
 * Procedural sea-bed model for a {@link SurfaceChunkOceanTop} when the ocean chunk
 * has no geological layers of its own. Uses a SMOOTH dune-like noise (unlike the
 * ridged basement).
 *
 * @group Geometries
 */
export type SurfaceChunkOceanTopProcedural = {
  /** mean water depth below the water level, in meters (positive-down) */
  depth: number;
  /** whether `depth` is the mean or the minimum (shallowest) depth. Default 'mean'. */
  depthMode?: 'mean' | 'min';
  /** ± sea-bed relief amplitude, in meters. Default 60. */
  variation?: number;
  /** procedural seed. Default 0. */
  seed?: number;
  /**
   * Wavelength of the coarsest dune, in WORLD units. Default 8000. Evaluated in
   * world space so neighbouring chunks share one continuous sea bed (see
   * {@link SurfaceChunkBasementProcedural.featureSize}).
   */
  featureSize?: number;
  /** sea-bed tessellation across the larger footprint extent. Default 64. */
  segments?: number;
};

/**
 * The ocean-top slot: a flat water surface at `waterLevel` (default sea level,
 * y = 0) and a water body running down to the sea bed. The bed is the chunk's
 * SHALLOWEST layer (surface mode) or a procedural sea bed when there are no layers
 * ({@link SurfaceChunkOceanTopProcedural}). The produced geometries are intended
 * for the `Ocean` water shader (surface + body, and bed only when procedural).
 *
 * @group Geometries
 */
export type SurfaceChunkOceanTop = {
  /** water surface level (scene Y). Default 0 (sea level). */
  waterLevel?: number;
  /** procedural sea bed, used when the chunk has no geological layers. */
  procedural?: SurfaceChunkOceanTopProcedural;
};

/** A coloured side-wall mesh (basement slot). */
export type SurfaceChunkWall = {
  geometry: BufferGeometry;
  color: string;
};

/** A coloured clipped-surface mesh (basement slot). */
export type SurfaceChunkSurface = {
  geometry: BufferGeometry;
  color: string;
};

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
  /** basement build time (0 when no basement slot) */
  basementMs: number;
  /** ocean-top build time (0 when no ocean-top slot) */
  oceanTopMs: number;
  totalMs: number;
  layers: number;
  surfaces: number;
  walls: number;
  /** total triangles (surfaces + walls + basement) */
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
 * One group of a {@link SurfaceChunk}: a self-contained solid block whose top is
 * the group's first (shallowest) surface and whose base is its last (deepest).
 * Its walls fill only the intervals **between consecutive surfaces of the group**;
 * there is no wall to the next group, so adjacent groups are separated by an empty
 * gap.
 *
 * @group Geometries
 */
/**
 * A bundle of surfaces and the walls between them. Still the shape of the
 * basement slot; the chunk's own layers are a flat ordered list (see
 * {@link SurfaceChunk}).
 *
 * @group Geometries
 */
export type SurfaceChunkGroup = {
  surfaces: SurfaceChunkSurface[];
  walls: SurfaceChunkWall[];
};

/**
 * The result of {@link createSurfaceChunk}: the chunk's layers in stratigraphic
 * order, all in one common scene frame.
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
  /**
   * The basement block, present only when the `basement` option is set. Its
   * `surfaces` hold the flat base cap (and, for a standalone basement, the top cap
   * as well); its `walls` hold the sides.
   */
  basement?: SurfaceChunkGroup;
  /**
   * The ocean-top water geometries, present only when the `oceanTop` option is
   * set: a flat water `surface`, the water `body` (sides), and a procedural `bed`
   * (procedural mode only — in surface mode the shallowest layer is the bed).
   * Render these with the `Ocean` water shader.
   */
  oceanTop?: {
    surface: BufferGeometry;
    body: BufferGeometry;
    bed?: BufferGeometry;
  };
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
export function createSurfaceChunk(
  groups: SurfaceChunkLayer[][],
  options: SurfaceChunkOptions,
): SurfaceChunk {
  const rimSpacing = options.rimSpacing ?? 250;
  const maxError = options.maxError ?? 5;

  const t0 = performance.now();
  const { densified, rings } = densifyChunkRim(options.polygon, rimSpacing);
  const tDensify = performance.now();

  // Flatten the groups but remember which group each layer belongs to, so the
  // shared rim / clip machinery runs once across every layer. A group becomes a
  // run of FILLED intervals: every layer fills down to the next one except the
  // last of its group, which leaves the gap to the next group open.
  const flatLayers: SurfaceChunkLayer[] = [];
  const fills: boolean[] = [];
  groups.forEach(group =>
    group.forEach((layer, i) => {
      flatLayers.push(layer);
      fills.push(i + 1 < group.length);
    }),
  );

  // Per-layer clip + rim sampling — the expensive, independent part. Split out as
  // {@link clipChunkLayer} so it can be parallelized (e.g. across workers); here it
  // runs serially.
  let clipMs = 0;
  let rimMs = 0;
  const layers: AssembleChunkLayer[] = flatLayers.map((layer, i) => {
    const clip = clipChunkLayer(layer, densified, rings, maxError);
    clipMs += clip.clipMs;
    rimMs += clip.rimMs;
    return {
      geometry: clip.geometry,
      rimY: clip.rimY,
      fill: fills[i],
    };
  });

  return assembleChunk(
    layers,
    rings,
    densified,
    {
      maxError,
      basement: options.basement,
      oceanTop: options.oceanTop,
    },
    { t0, densifyMs: tDensify - t0, clipMs, rimMs },
  );
}

/**
 * Densify a chunk's mask polygon into the shared rim used by every layer, returning
 * both the densified polygon (for clipping) and its flattened rings (for rim
 * sampling / wall building). See {@link createSurfaceChunk}.
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

/** The per-layer result of {@link clipChunkLayer}: clipped geometry + rim depths. */
export type ChunkLayerClip = {
  /** clipped surface geometry (scene frame), or null when the mask covered nothing */
  geometry: BufferGeometry | null;
  /** this layer's depth at every shared-rim vertex: `rimY[ring][vertex]` */
  rimY: number[][];
  /** clip time (ms) */
  clipMs: number;
  /** rim-sampling time (ms) */
  rimMs: number;
};

/**
 * Clip ONE layer against the shared rim and sample its rim depths — the expensive,
 * per-layer part of {@link createSurfaceChunk}, extracted so it can run
 * independently (e.g. in parallel across workers). The result feeds
 * {@link assembleChunk}.
 *
 * @group Geometries
 */
export function clipChunkLayer(
  layer: SurfaceChunkLayer,
  densified: PlanarPolygonGeometry,
  rings: Coordinates2D[],
  maxError: number,
): ChunkLayerClip {
  const nullValue = layer.nullValue ?? -1;
  const isInvalid = (v: number) => v === nullValue || v < 0;

  const c0 = performance.now();
  const geo = createClippedSurface(layer.values, layer.header, {
    polygon: densified,
    referenceDepth: layer.referenceDepth,
    worldPosition: layer.worldPosition,
    // No draping: the boundary must land on exactly the shared rim points so
    // every layer aligns. Fill holes so each layer spans the full polygon.
    drape: false,
    cutHoles: false,
    maxError,
    nullValue,
  });
  if (geo) {
    // local grid frame -> common scene frame (bake the UtmPosition offset)
    geo.translate(layer.worldPosition[0], 0, layer.worldPosition[1]);
  }
  const clipMs = performance.now() - c0;

  // Sample this layer's rim depth at the shared rim vertices. Uses the same
  // world->grid mapping and `value - referenceDepth` as the clipped surface, so
  // the rim matches the surface boundary.
  const r0 = performance.now();
  const toGrid = surfaceWorldToGrid(layer.header, layer.worldPosition);
  const { nx, ny } = layer.header;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < layer.values.length; i++) {
    const v = layer.values[i];
    if (!isInvalid(v)) {
      sum += v;
      cnt++;
    }
  }
  const fill = cnt > 0 ? sum / cnt : layer.referenceDepth;
  const rimY = rings.map(ring =>
    ring.map(([sx, sz]) => {
      const [col, row] = toGrid(sx, sz);
      const v = sampleValidGrid(
        layer.values,
        nx,
        ny,
        col,
        row,
        isInvalid,
        fill,
      );
      return v - layer.referenceDepth;
    }),
  );
  const rimMs = performance.now() - r0;

  return { geometry: geo, rimY, clipMs, rimMs };
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
  maxError?: number;
  basement?: SurfaceChunkBasement;
  oceanTop?: SurfaceChunkOceanTop;
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
 * Assemble a {@link SurfaceChunk} from already-clipped layers (see
 * {@link clipChunkLayer}): the pinch-out clamp, the coloured side walls, the
 * optional basement and ocean-top slots, and the metrics. This is the cheap,
 * serial counterpart to the parallelizable per-layer clip.
 *
 * @group Geometries
 */
export function assembleChunk(
  layers: AssembleChunkLayer[],
  rings: Coordinates2D[],
  densified: PlanarPolygonGeometry,
  options: AssembleChunkOptions,
  timings: ChunkBuildTimings,
): SurfaceChunk {
  const maxError = options.maxError ?? 5;

  const surfaces: SurfaceChunkMesh[] = [];
  // rimY[layer][ring][vertex] — each layer's rim depth at the shared rim points.
  const rimY: number[][][] = [];
  // Deepest built surface geometry (last non-null layer), used to keep a
  // procedural basement floor below the whole chunk.
  let deepestGeo: BufferGeometry | null = null;
  let surfaceTris = 0;

  layers.forEach((layer, i) => {
    rimY.push(layer.rimY);
    if (layer.geometry) {
      surfaces.push({
        geometry: layer.geometry,
        layer: layer.source ?? i,
        ceiling: layer.ceiling,
      });
      deepestGeo = layer.geometry;
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

  // --- Basement slot: a solid block below the deepest layer ------------------
  const b0 = performance.now();
  let basement: SurfaceChunkGroup | undefined;
  let basementTris = 0;
  if (options.basement) {
    const deepestRim = rimY.length > 0 ? rimY[rimY.length - 1] : null;
    basement = buildBasement(
      options.basement,
      rings,
      deepestRim, // deepest layer's rim = attached basement ceiling
      deepestGeo,
      densified,
      maxError,
    );
    if (basement) {
      for (const s of basement.surfaces) {
        const idx = s.geometry.getIndex();
        if (idx) basementTris += idx.count / 3;
      }
      for (const wl of basement.walls) {
        const idx = wl.geometry.getIndex();
        if (idx) basementTris += idx.count / 3;
      }
    }
  }
  const basementMs = performance.now() - b0;

  // --- Ocean-top slot: water surface + body (+ procedural sea bed) ----------
  const o0 = performance.now();
  let oceanTop: SurfaceChunk['oceanTop'];
  let oceanTopTris = 0;
  if (options.oceanTop) {
    const shallowestRim = rimY.length > 0 ? rimY[0] : null;
    oceanTop = buildOceanTop(
      options.oceanTop,
      rings,
      shallowestRim,
      densified,
      maxError,
    );
    if (oceanTop) {
      for (const g of [oceanTop.surface, oceanTop.body, oceanTop.bed]) {
        const idx = g?.getIndex();
        if (idx) oceanTopTris += idx.count / 3;
      }
    }
  }
  const oceanTopMs = performance.now() - o0;

  const metrics: SurfaceChunkMetrics = {
    densifyMs: timings.densifyMs,
    clipMs: timings.clipMs,
    rimMs: timings.rimMs,
    wallsMs,
    basementMs,
    oceanTopMs,
    totalMs: performance.now() - timings.t0,
    layers: layers.length,
    surfaces: surfaces.length,
    walls: walls.length,
    triangles: Math.round(surfaceTris + wallTris + basementTris + oceanTopTris),
    wallTriangles: Math.round(wallTris),
    rimPoints: rings.reduce((a, r) => a + r.length, 0),
    diagnostics: options.diagnostics,
  };

  return { surfaces, walls, basement, oceanTop, metrics };
}

/** Default procedural-basement colour (dark gray rock). */
const BASEMENT_COLOR = '#4a4a4a';
/** Tessellation for the flat base cap (flat → needs almost no interior detail). */
const BASE_SEGMENTS = 8;

/**
 * Build the {@link SurfaceChunkBasement} block: a **flat base** sitting `thickness`
 * below the top, plus side walls from the top rim down to the base rim (sharing the
 * chunk's canonical `rings`). The top is the chunk's deepest surface (attached,
 * `basement.top` omitted) or a standalone assigned/procedural surface.
 */
function buildBasement(
  basement: SurfaceChunkBasement,
  rings: Coordinates2D[],
  deepestRim: number[][] | null,
  deepestGeo: BufferGeometry | null,
  densified: PlanarPolygonGeometry,
  maxError: number,
): SurfaceChunkGroup | undefined {
  const color = basement.color ?? BASEMENT_COLOR;
  const thickness = basement.thickness ?? 500;

  // Shared-rim origin in scene XZ (where the cap's sampling grid starts). The
  // procedural fields are anchored in WORLD space, so the rim EXTENT no longer
  // takes part in them.
  let minX = Infinity;
  let minZ = Infinity;
  for (const ring of rings)
    for (const [x, z] of ring) {
      if (x < minX) minX = x;
      if (z < minZ) minZ = z;
    }
  if (!Number.isFinite(minX)) return undefined;

  // --- Determine the TOP: its rim and (for standalone) a cap mesh -------------
  let topRim: number[][];
  let topCap: BufferGeometry | null = null;

  if (!basement.top) {
    // Attached: the top is the chunk's deepest surface (already rendered).
    if (!deepestRim) return undefined;
    topRim = deepestRim;
  } else if ('surface' in basement.top) {
    // Standalone: an assigned surface top (clipped like a layer).
    const layer = basement.top.surface;
    const nullValue = layer.nullValue ?? -1;
    const isInvalid = (v: number) => v === nullValue || v < 0;
    const geo = createClippedSurface(layer.values, layer.header, {
      polygon: densified,
      referenceDepth: layer.referenceDepth,
      worldPosition: layer.worldPosition,
      drape: false,
      cutHoles: false,
      maxError,
      nullValue,
    });
    if (geo) {
      geo.translate(layer.worldPosition[0], 0, layer.worldPosition[1]);
      topCap = geo;
    }
    const toGrid = surfaceWorldToGrid(layer.header, layer.worldPosition);
    const { nx, ny } = layer.header;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < layer.values.length; i++) {
      const v = layer.values[i];
      if (!isInvalid(v)) {
        sum += v;
        cnt++;
      }
    }
    const fill = cnt > 0 ? sum / cnt : layer.referenceDepth;
    topRim = rings.map(ring =>
      ring.map(([sx, sz]) => {
        const [col, row] = toGrid(sx, sz);
        return (
          sampleValidGrid(layer.values, nx, ny, col, row, isInvalid, fill) -
          layer.referenceDepth
        );
      }),
    );
  } else {
    // Standalone: a procedurally generated rocky top.
    const proc = basement.top.procedural;
    const variation = proc.variation ?? 150;
    const seed = proc.seed ?? 0;
    const segments = Math.max(2, Math.floor(proc.segments ?? 96));
    const mode = proc.depthMode ?? 'mean';
    const featureSize = Math.max(proc.featureSize ?? RELIEF_FEATURE_SIZE, 1);
    const topFn = (x: number, z: number) => {
      const n = ridgeRelief(x / featureSize, z / featureSize, seed);
      return mode === 'min'
        ? -proc.depth - variation * n
        : -proc.depth + variation * (2 * n - 1);
    };
    const built = buildCap(
      rings,
      densified,
      topFn,
      segments,
      maxError,
      minX,
      minZ,
    );
    topCap = built.cap;
    topRim = built.rim;
  }

  // --- Deepest point of the top (rim + cap / deepest surface interior) --------
  let topMinY = Infinity;
  for (const ring of topRim) for (const y of ring) if (y < topMinY) topMinY = y;
  const interior = topCap ?? (basement.top ? null : deepestGeo);
  if (interior) {
    interior.computeBoundingBox();
    const by = interior.boundingBox?.min.y;
    if (by !== undefined && by < topMinY) topMinY = by;
  }
  if (!Number.isFinite(topMinY)) return undefined;

  // --- Flat base: `thickness` below the top's deepest point -------------------
  const baseY = topMinY - thickness;
  const baseRim = rings.map(ring => ring.map(() => baseY));
  const base = buildCap(
    rings,
    densified,
    () => baseY,
    BASE_SEGMENTS,
    maxError,
    minX,
    minZ,
  );
  if (!base.cap) return undefined;

  // --- Walls: top rim -> flat base rim ---------------------------------------
  const wallGeo = buildIntervalWalls(rings, topRim, baseRim);

  const surfaces: SurfaceChunkSurface[] = [];
  if (topCap) surfaces.push({ geometry: topCap, color }); // standalone top
  surfaces.push({ geometry: base.cap, color }); // flat base
  const walls: SurfaceChunkWall[] = wallGeo
    ? [{ geometry: wallGeo, color }]
    : [];
  return { surfaces, walls };
}

/**
 * Build a cap surface over the shared rim's bounding box by sampling `heightFn`
 * (scene Y) on a synthetic grid, clipped to the densified polygon so it shares the
 * canonical rim, plus that rim sampled from the SAME grid (so a wall meeting it is
 * watertight). Heights are stored positive-down for the triangulator (which treats
 * `v < 0` as no-data) and flipped back to y-up afterwards.
 */
function buildCap(
  rings: Coordinates2D[],
  densified: PlanarPolygonGeometry,
  heightFn: (x: number, z: number) => number,
  segments: number,
  maxError: number,
  minX: number,
  minZ: number,
): { cap: BufferGeometry | null; rim: number[][] } {
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const ring of rings)
    for (const [x, z] of ring) {
      if (x > maxX) maxX = x;
      if (z > maxZ) maxZ = z;
    }
  const w = Math.max(maxX - minX, 1e-6);
  const l = Math.max(maxZ - minZ, 1e-6);
  const nx = Math.max(2, Math.round((w / Math.max(w, l)) * segments) + 1);
  const ny = Math.max(2, Math.round((l / Math.max(w, l)) * segments) + 1);
  const cellX = w / (nx - 1);
  const cellZ = l / (ny - 1);
  const grid = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      grid[r * nx + c] = -heightFn(minX + c * cellX, minZ + r * cellZ);
    }
  }
  const gridPolygons: GridPolygon[] = (
    densified.coordinates as PlanarPolygonCoordinates
  ).map(comp =>
    comp.map(ring =>
      ring.map(([sx, sz]) => [(sx - minX) / cellX, (sz - minZ) / cellZ]),
    ),
  );
  const { positions, uvs, indices } = triangulateGridConstrained(
    grid,
    nx,
    cellX,
    cellZ,
    -1,
    maxError,
    gridPolygons,
    false,
    false,
    0,
  );
  let cap: BufferGeometry | null = null;
  if (indices.length > 0) {
    for (let i = 1; i < positions.length; i += 3) positions[i] = -positions[i];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setIndex(new BufferAttribute(indices, 1));
    g.translate(minX, 0, minZ);
    computeUpwardNormals(g);
    cap = g;
  }
  const capInvalid = (v: number) => v === -1 || v < 0;
  const rim = rings.map(ring =>
    ring.map(
      ([sx, sz]) =>
        -sampleValidGrid(
          grid,
          nx,
          ny,
          (sx - minX) / cellX,
          (sz - minZ) / cellZ,
          capInvalid,
          0,
        ),
    ),
  );
  return { cap, rim };
}

/**
 * Build the {@link SurfaceChunkOceanTop} water geometries: a flat water surface at
 * `waterLevel` and a water body down to the sea bed. In surface mode the bed is the
 * shallowest layer's rim (`shallowestRim`); with no layers a procedural sea bed is
 * generated (and returned). Geometries are for the `Ocean` shader.
 */
function buildOceanTop(
  oceanTop: SurfaceChunkOceanTop,
  rings: Coordinates2D[],
  shallowestRim: number[][] | null,
  densified: PlanarPolygonGeometry,
  maxError: number,
): SurfaceChunk['oceanTop'] {
  const waterLevel = oceanTop.waterLevel ?? 0;

  // Rim origin only — the procedural bed is anchored in WORLD space, so the rim
  // extent no longer takes part in it.
  let minX = Infinity;
  let minZ = Infinity;
  for (const ring of rings)
    for (const [x, z] of ring) {
      if (x < minX) minX = x;
      if (z < minZ) minZ = z;
    }
  if (!Number.isFinite(minX)) return undefined;

  const water = buildCap(
    rings,
    densified,
    () => waterLevel,
    BASE_SEGMENTS,
    maxError,
    minX,
    minZ,
  );
  if (!water.cap) return undefined;

  let bedRim: number[][];
  let bed: BufferGeometry | undefined;

  if (shallowestRim) {
    // Surface mode: the shallowest layer is the sea bed (already a chunk surface).
    bedRim = shallowestRim;
  } else if (oceanTop.procedural) {
    // Procedural sea bed (smooth dunes) below the water level.
    const proc = oceanTop.procedural;
    const variation = proc.variation ?? 60;
    const seed = proc.seed ?? 0;
    const segments = Math.max(2, Math.floor(proc.segments ?? 64));
    const mode = proc.depthMode ?? 'mean';
    const featureSize = Math.max(proc.featureSize ?? RELIEF_FEATURE_SIZE, 1);
    const bedFn = (x: number, z: number) => {
      const n = duneRelief(x / featureSize, z / featureSize, seed);
      return mode === 'min'
        ? waterLevel - proc.depth - variation * n
        : waterLevel - proc.depth + variation * (2 * n - 1);
    };
    const built = buildCap(
      rings,
      densified,
      bedFn,
      segments,
      maxError,
      minX,
      minZ,
    );
    if (!built.cap) return undefined;
    bed = built.cap;
    bedRim = built.rim;
  } else {
    return undefined;
  }

  const waterRim = rings.map(ring => ring.map(() => waterLevel));
  const body = buildIntervalWalls(rings, waterRim, bedRim);
  if (!body) return undefined;

  return { surface: water.cap, body, bed };
}
