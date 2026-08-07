import { transfer } from 'comlink';
import {
  PlanarPolygonCoordinates,
  pointInRing,
  ReadonlyStore,
  StackResolveOptions,
  SurfaceClipHeader,
  surfaceWorldToGrid,
  Vec2,
} from '../../../sdk';

/**
 * TEMPORARY diagnostic generator for the ordering / crossing investigation:
 * samples a vertical cross-section through a stack of depth surfaces BEFORE and
 * AFTER the depth-order resolve, and measures where the surfaces cross or are
 * near-coincident.
 *
 * The resolve is applied to the SAMPLED PROFILES rather than to the grids: on a
 * shared tessellation the rule is a per-vertex `min` against the layer above, and
 * a section sample is just such a vertex, so the fence shows exactly what the
 * chunk build does. Remove together with `ChunkDepthOrder.stories.tsx`.
 */
export const surfaceSection = 'surfaceSection';

/** Separation below which two surfaces are treated as co-planar (world units). */
export const COINCIDENCE_EPS = 0.5;

/** One layer of a {@link SurfaceSectionSpec} (grid values fetched in the worker). */
export type SurfaceSectionLayerSpec = {
  /** surface id (the worker fetches `surface-values` for this id) */
  id: string;
  /** grid geometry (from `SurfaceMeta.header`) */
  header: SurfaceClipHeader;
  /** depth-normalization reference (`SurfaceMeta.max`) */
  referenceDepth: number;
  /** scene XZ of the surface origin (`utmToArea(xori, yori, 0)` -> `[x, z]`) */
  worldPosition: Vec2;
};

/** Serializable input to the {@link surfaceSection} generator. */
export type SurfaceSectionSpec = {
  /** the stack, shallowest first — the same flat order the chunk builds */
  layers: SurfaceSectionLayerSpec[];
  /** the chunk outline (scene XZ), as plain coordinates + offset */
  polygon: { coordinates: PlanarPolygonCoordinates; offset: Vec2 };
  /** the cut line, in scene XZ */
  section: { from: Vec2; to: Vec2; samples: number };
  /**
   * Resolution of the regular probe grid used for the crossing statistics
   * (`n x n` over the outline's bounding box, points outside the outline are
   * skipped). `0` disables the statistics.
   */
  probeResolution?: number;
  /** resolve options — omit to sample the stack unchanged */
  resolve?: StackResolveOptions;
};

/** Crossing statistics for one pair of adjacent surfaces. */
export type SurfacePairStats = {
  /** id of the DEEPER surface of the pair */
  id: string;
  /** flat index of the deeper surface */
  index: number;
  /** probe points where both surfaces have data */
  compared: number;
  /** points where the deeper surface sits ABOVE the shallower one */
  crossings: number;
  /** points where the two are within {@link COINCIDENCE_EPS} */
  coincident: number;
  /** how far the deeper surface pokes through the shallower one (world units) */
  maxOverlap: number;
  /** smallest vertical separation (negative = crossing) */
  minSeparation: number;
  /** the same four numbers after the depth-order pass */
  crossingsAfter: number;
  coincidentAfter: number;
  maxOverlapAfter: number;
  minSeparationAfter: number;
  /** grid nodes the depth-order pass moved (0 when disabled) */
  clampedNodes: number;
};

/** Response from the {@link surfaceSection} generator. */
export type SurfaceSectionResponse = {
  /** ids of the layers that actually loaded, in flat order */
  ids: string[];
  /** length of the cut line (world units) */
  length: number;
  /** per layer: scene Y along the section (NaN = no data / outside the outline) */
  before: Float32Array[];
  /** the same after the depth-order pass (a copy of `before` when disabled) */
  after: Float32Array[];
  /** per adjacent pair (deeper layer), in flat order */
  stats: SurfacePairStats[];
  /** probe points inside the outline that the statistics used */
  probePoints: number;
  fetchMs: number;
  depthOrderMs: number;
};

type LoadedLayer = {
  id: string;
  values: Float32Array;
  header: SurfaceClipHeader;
  referenceDepth: number;
  worldPosition: Vec2;
  toGrid: (sx: number, sz: number) => [number, number];
};

/**
 * Scene Y of a layer at a scene XZ point, or NaN outside its grid / over a hole.
 * Bilinear over the VALID corners only, without clamping into the grid — an edge
 * value must not bleed outside the surface's own extent (which is exactly the
 * artefact the depth-order feather exists to avoid).
 */
function sampleY(layer: LoadedLayer, sx: number, sz: number): number {
  const [fx, fz] = layer.toGrid(sx, sz);
  const { nx, ny } = layer.header;
  if (!(fx >= 0 && fx <= nx - 1 && fz >= 0 && fz <= ny - 1)) return NaN;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, nx - 1);
  const z1 = Math.min(z0 + 1, ny - 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const values = layer.values;
  let sum = 0;
  let wsum = 0;
  const add = (col: number, row: number, w: number) => {
    const v = values[row * nx + col];
    if (v >= 0) {
      sum += v * w;
      wsum += w;
    }
  };
  add(x0, z0, (1 - tx) * (1 - tz));
  add(x1, z0, tx * (1 - tz));
  add(x0, z1, (1 - tx) * tz);
  add(x1, z1, tx * tz);
  if (wsum <= 0) return NaN;
  return sum / wsum - layer.referenceDepth;
}

/** Even-odd point-in-polygon over all components (outer ring minus its holes). */
function insidePolygon(
  components: PlanarPolygonCoordinates,
  x: number,
  z: number,
): boolean {
  for (const rings of components) {
    if (rings.length === 0 || !pointInRing(x, z, rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(x, z, rings[i])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Probe points on a regular grid over the outline's bbox, kept if inside it. */
function buildProbePoints(
  components: PlanarPolygonCoordinates,
  resolution: number,
): Vec2[] {
  if (resolution < 2) return [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const rings of components) {
    for (const ring of rings) {
      for (const [x, z] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  if (!Number.isFinite(minX)) return [];
  const points: Vec2[] = [];
  for (let r = 0; r < resolution; r++) {
    const z = minZ + ((maxZ - minZ) * r) / (resolution - 1);
    for (let c = 0; c < resolution; c++) {
      const x = minX + ((maxX - minX) * c) / (resolution - 1);
      if (insidePolygon(components, x, z)) points.push([x, z]);
    }
  }
  return points;
}

/** Sample every layer at every probe point (row-major: layer-major). */
function sampleAll(layers: LoadedLayer[], points: Vec2[]): Float32Array[] {
  return layers.map(layer => {
    const out = new Float32Array(points.length);
    for (let i = 0; i < points.length; i++) {
      out[i] = sampleY(layer, points[i][0], points[i][1]);
    }
    return out;
  });
}

/**
 * Sample a stack of surfaces along a cut line, before and after the depth-order
 * pass, and measure the crossings / near-coincidences between adjacent surfaces.
 *
 * @group Generators
 */
export async function generateSurfaceSection(
  this: ReadonlyStore,
  spec: SurfaceSectionSpec,
): Promise<SurfaceSectionResponse | null> {
  if (spec.layers.length === 0) return null;

  const components = spec.polygon.coordinates;

  const t0 = performance.now();
  const grids = await Promise.all(
    spec.layers.map(l => this.get<Float32Array>('surface-values', l.id)),
  );
  const fetchMs = performance.now() - t0;

  const layers: LoadedLayer[] = [];
  spec.layers.forEach((l, i) => {
    const values = grids[i];
    if (!values) return;
    layers.push({
      id: l.id,
      values,
      header: l.header,
      referenceDepth: l.referenceDepth,
      worldPosition: l.worldPosition,
      toGrid: surfaceWorldToGrid(l.header, l.worldPosition),
    });
  });
  if (layers.length === 0) return null;

  // The cut line (points outside the outline sample to NaN, so the fence stops at
  // the chunk boundary just like the clipped geometry does).
  const { from, to, samples } = spec.section;
  const n = Math.max(2, samples);
  const sectionPoints: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    sectionPoints.push(insidePolygon(components, x, z) ? [x, z] : [NaN, NaN]);
  }

  const probePoints = buildProbePoints(components, spec.probeResolution ?? 0);

  const before = sampleAll(layers, sectionPoints);
  const beforeProbes = sampleAll(layers, probePoints);

  // The resolve, applied to the SAMPLED PROFILES. On a shared tessellation the
  // rule is a per-vertex `min` against the (already resolved) layer above, and a
  // sample is just such a vertex — so this is the same operation the chunk build
  // performs, without needing a tessellation here.
  const resolveProfiles = (profiles: Float32Array[], minGap: number) => {
    const out = profiles.map(p => Float32Array.from(p));
    const moved = new Array<number>(profiles.length).fill(0);
    for (let i = 1; i < out.length; i++) {
      const above = out[i - 1];
      const current = out[i];
      for (let v = 0; v < current.length; v++) {
        if (Number.isNaN(above[v]) || Number.isNaN(current[v])) continue;
        const limit = above[v] - minGap;
        if (current[v] > limit) {
          current[v] = limit;
          moved[i]++;
        }
      }
    }
    return { out, moved };
  };

  const clampedNodes = new Array<number>(layers.length).fill(0);
  let depthOrderMs = 0;
  let after: Float32Array[];
  let afterProbes: Float32Array[] | null = null;
  if (spec.resolve) {
    const minGap = spec.resolve.minGap ?? 0;
    const d0 = performance.now();
    const section = resolveProfiles(before, minGap);
    const probes = resolveProfiles(beforeProbes, minGap);
    depthOrderMs = performance.now() - d0;
    after = section.out;
    afterProbes = probes.out;
    probes.moved.forEach((m, i) => (clampedNodes[i] = m));
  } else {
    after = before.map(a => Float32Array.from(a));
  }

  const measure = (upper: Float32Array, lower: Float32Array) => {
    let compared = 0;
    let crossings = 0;
    let coincident = 0;
    let maxOverlap = 0;
    let minSeparation = Infinity;
    for (let i = 0; i < upper.length; i++) {
      const a = upper[i];
      const b = lower[i];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      compared++;
      // Scene Y grows upwards, so a correctly ordered pair has upper above lower.
      const separation = a - b;
      if (separation < 0) {
        crossings++;
        if (-separation > maxOverlap) maxOverlap = -separation;
      }
      if (Math.abs(separation) <= COINCIDENCE_EPS) coincident++;
      if (separation < minSeparation) minSeparation = separation;
    }
    return {
      compared,
      crossings,
      coincident,
      maxOverlap,
      minSeparation: minSeparation === Infinity ? NaN : minSeparation,
    };
  };

  const stats: SurfacePairStats[] = [];
  for (let i = 1; i < layers.length; i++) {
    const b = measure(beforeProbes[i - 1], beforeProbes[i]);
    const a = afterProbes ? measure(afterProbes[i - 1], afterProbes[i]) : b;
    stats.push({
      id: layers[i].id,
      index: i,
      compared: b.compared,
      crossings: b.crossings,
      coincident: b.coincident,
      maxOverlap: b.maxOverlap,
      minSeparation: b.minSeparation,
      crossingsAfter: a.crossings,
      coincidentAfter: a.coincident,
      maxOverlapAfter: a.maxOverlap,
      minSeparationAfter: a.minSeparation,
      clampedNodes: clampedNodes[i],
    });
  }

  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const response: SurfaceSectionResponse = {
    ids: layers.map(l => l.id),
    length: Math.hypot(dx, dz),
    before,
    after,
    stats,
    probePoints: probePoints.length,
    fetchMs,
    depthOrderMs,
  };

  return transfer(response, [
    ...before.map(a => a.buffer),
    ...after.map(a => a.buffer),
  ]);
}
