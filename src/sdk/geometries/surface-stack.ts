import { Vec2 } from '../types/common';
import { Delatin } from './delatin';
import { sampleValidGrid } from './grid-sampling';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';
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
import { GridPolygon, makeGridInside } from './triangulate-grid-delaunay';

/**
 * A layer entering a shared-tessellation stack: the elevation grid plus how to
 * place it. Same shape as a chunk layer, minus the appearance.
 *
 * @group Geometries
 */
export type StackLayer = {
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
  /** per layer: 1 where the layer has real data at that node, 0 where filled */
  masks: Uint8Array[];
  /** how many source grid cells one reference cell spans (1 = full resolution) */
  step: number;
};

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
};

/** The shared tessellation produced by {@link tessellateStack}. */
export type StackTessellation = {
  /** vertex `(column, row)` coordinates in the reference grid, xy interleaved */
  coords: Float32Array;
  /** triangle indices, shared by every layer */
  indices: Uint32Array;
  /** vertex indices along each rim ring, in ring order */
  rimVertices: number[][];
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
   * Per-layer truncation masks from {@link resolveStackOrder} in `'truncate'`
   * mode: 1 marks a vertex where the unit was cut away.
   */
  absent?: Uint8Array[];
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
};

/** Sentinel for a node with no data — outside the range of any real depth. */
const NO_DATA = STACK_NO_DATA;

// Fill every invalid node from the nearest valid one, via a two-sweep chamfer
// transform that carries the source value along with the distance. A continuous
// extension (rather than a mean or a hard edge) matters because the triangulator
// chases discontinuities: a cliff at a data boundary costs a dense cluster of
// slivers for geometry that is either outside the mask or about to be truncated.
function fillNearest(
  values: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
) {
  const D = 1;
  const D2 = Math.SQRT2;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 0 : Infinity;

  const relax = (i: number, j: number, d: number) => {
    const nd = dist[j] + d;
    if (nd < dist[i]) {
      dist[i] = nd;
      values[i] = values[j];
    }
  };

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = row - w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (dist[i] === 0) continue;
      if (x > 0) relax(i, i - 1, D);
      if (y > 0) {
        relax(i, up + x, D);
        if (x > 0) relax(i, up + x - 1, D2);
        if (x < w - 1) relax(i, up + x + 1, D2);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    const down = row + w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      if (dist[i] === 0) continue;
      if (x < w - 1) relax(i, i + 1, D);
      if (y < h - 1) {
        relax(i, down + x, D);
        if (x < w - 1) relax(i, down + x + 1, D2);
        if (x > 0) relax(i, down + x - 1, D2);
      }
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
  let best = -1;
  let bestArea = Infinity;
  layers.forEach((layer, i) => {
    const area = layer.header.xinc * layer.header.yinc;
    if (area < bestArea) {
      bestArea = area;
      best = i;
    }
  });
  const source = layers[best];
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
  const count = nx * ny;

  for (const layer of layers) {
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
          mask[out + col] = 1;
          any = true;
        }
      }
    }
    if (any) fillNearest(channel, mask, nx, ny);
    channels.push(channel);
    masks.push(mask);
  }

  return { header, worldPosition, channels, masks, step };
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
 * @returns the shared tessellation, or `null` when nothing survives the mask
 *
 * @group Geometries
 */
export function tessellateStack(
  reference: StackReference,
  polygon: PlanarPolygonGeometry,
  maxError: number,
  candidates?: Uint32Array[],
): StackTessellation | null {
  const { nx, ny } = reference.header;
  const toGrid = surfaceWorldToGrid(reference.header, reference.worldPosition);
  const components = polygon.coordinates as PlanarPolygonCoordinates;
  const gridPolygons: GridPolygon[] = components.map(rings =>
    rings.map(ring => ring.map(([sx, sz]) => toGrid(sx, sz))),
  );

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

  return {
    coords: Float32Array.from(coordList),
    indices,
    rimVertices: rimVertices.map(ring =>
      ring.map(v => remap[v]).filter(v => v >= 0),
    ),
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
 * Sample each layer's data coverage at the shared vertices: 1 where the layer has
 * real data, 0 where {@link buildStackReference} filled it in.
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
 *   source of z-fighting.
 *
 * Heights and rims are untouched, so the walls still close and the block stays
 * sealed. A triangle is only dropped when ALL THREE of its vertices qualify;
 * partly-absent triangles are kept, so terminations follow triangle edges (the
 * exact zero-thickness contour is not a mesh edge yet).
 *
 * @param heights per-layer vertex heights, already resolved
 * @param indices the shared triangle indices
 * @param options see {@link StackCollapseOptions}
 *
 * @group Geometries
 */
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

  heights.forEach((current, layer) => {
    const coverage = options.coverage?.[layer];
    const cut = options.absent?.[layer];
    // The shallowest layer has nothing above it to collapse onto, but it can
    // still be absent.
    const above = layer > 0 ? heights[layer - 1] : null;
    if (!coverage && !cut && !above) {
      out.push(null);
      dropped.push(0);
      droppedAbsent.push(0);
      droppedCollapsed.push(0);
      return;
    }

    const missing = (v: number) =>
      (coverage ? coverage[v] === 0 : false) || (cut ? cut[v] === 1 : false);

    const kept = new Uint32Array(indices.length);
    let n = 0;
    let absentDrops = 0;
    let collapsedDrops = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      if (missing(a) && missing(b) && missing(c)) {
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
      kept[n++] = a;
      kept[n++] = b;
      kept[n++] = c;
    }
    const drops = absentDrops + collapsedDrops;
    out.push(drops > 0 ? kept.slice(0, n) : null);
    dropped.push(drops);
    droppedAbsent.push(absentDrops);
    droppedCollapsed.push(collapsedDrops);
  });

  return { indices: out, dropped, droppedAbsent, droppedCollapsed };
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
 * @returns `[u0, v0, u1, v1, ...]`
 *
 * @group Geometries
 */
export function stackLayerUvs(
  reference: StackReference,
  coords: Float32Array,
  layer: StackLayer,
): Float32Array {
  const { a, b, c, d, e, f } = gridToGridTransform(
    reference.header,
    reference.worldPosition,
    layer.header,
    layer.worldPosition,
  );
  const uDen = layer.header.nx - 1;
  const vDen = layer.header.ny - 1;
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
