import { transfer } from 'comlink';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  SurfaceChunkLayerSpec,
  SurfaceChunkResponse,
  SurfaceChunkSpec,
} from '../components/Chunks/chunk-defs';
import {
  assembleChunk,
  AssembleChunkLayer,
  clampSurfaceUnder,
  clipChunkLayer,
  computeUpwardNormals,
  densifyChunkRim,
  DepthOrderLayer,
  depthOrderMargin,
  packSurfaceChunk,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  ReadonlyStore,
  SurfaceChunkLayer,
  surfaceGridBounds,
} from '../sdk';
import { getClipPool } from './workers/clip-worker-pool';
import type { ClipResponse } from './workers/clip-worker-types';

/** The shared rim rings produced by {@link densifyChunkRim}. */
type ChunkRings = ReturnType<typeof densifyChunkRim>['rings'];

type FlatSpecLayer = { layer: SurfaceChunkLayerSpec; groupIndex: number };
type FetchedLayer = FlatSpecLayer & { values: Float32Array };

/** A per-layer clip result in flat (group-major) order. */
export type ClippedLayer = {
  geometry: BufferGeometry | null;
  rimY: number[][];
  groupIndex: number;
};

/** Per-surface clip profiling (for the bottleneck harness). */
export type ClipProfile = {
  id: string;
  clipMs: number;
  nodes: number;
  holes: number;
  tris: number;
};

/** Rebuild a three.js geometry from a clip worker response (adds normals). */
export function rebuildClippedGeometry(
  res: ClipResponse,
): BufferGeometry | null {
  if (!res.positions || !res.indices) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(res.positions, 3));
  if (res.uvs) geometry.setAttribute('uv', new BufferAttribute(res.uvs, 2));
  geometry.setIndex(new BufferAttribute(res.indices, 1));
  // Translate-invariant, so computing normals here (after the worker baked the
  // worldPosition offset) matches clipChunkLayer's pre-offset computation.
  computeUpwardNormals(geometry);
  return geometry;
}

/**
 * Fetch each spec layer's grid and clip it, pipelined: every layer is clipped as
 * soon as its own grid arrives, so the data worker keeps decoding the next grid
 * while the clip worker pool (when available, else the current thread) works on
 * the ones already in. Returns results in flat (group-major) order, dropping
 * layers whose grid was missing. Shared by the chunk generator and the bottleneck
 * debug generator.
 *
 * Note the returned `fetchMs`/`clipMs` are OVERLAPPING wall-clock windows (last
 * grid arrival, and first dispatch to last completion) — they do not sum to the
 * total.
 *
 * When `spec.depthOrder` is set the layers are additionally made monotonic (see
 * {@link clampSurfaceUnder}) before clipping, which forces the layers to be
 * processed in depth order — the clips still run in parallel, one layer behind.
 */
export async function fetchAndClipSpecLayers(
  store: ReadonlyStore,
  spec: SurfaceChunkSpec,
  densified: PlanarPolygonGeometry,
  rings: ChunkRings,
  maxError: number,
): Promise<{
  clipped: ClippedLayer[];
  bytes: number;
  fetchMs: number;
  clipMs: number;
  /** time spent in the depth-order pass (0 when disabled) */
  depthOrderMs: number;
  poolSize: number;
  profile: ClipProfile[];
}> {
  const flat: FlatSpecLayer[] = [];
  spec.groups.forEach((g, gi) =>
    g.forEach(layer => flat.push({ layer, groupIndex: gi })),
  );

  const pool = getClipPool();
  const densifiedCoords = densified.coordinates as PlanarPolygonCoordinates;
  let taskId = 0;

  const t0 = performance.now();
  let bytes = 0;
  let lastFetchEnd = t0;
  let firstClipStart = Infinity;
  let lastClipEnd = t0;

  const clipLayer = async (
    f: FetchedLayer,
  ): Promise<{ clipped: ClippedLayer; profile: ClipProfile }> => {
    if (pool) {
      const res = await pool.run(
        {
          id: taskId++,
          values: f.values,
          header: f.layer.header,
          referenceDepth: f.layer.referenceDepth,
          worldPosition: f.layer.worldPosition,
          polygonCoordinates: densifiedCoords,
          rings,
          maxError,
          nullValue: -1,
        },
        [f.values.buffer],
      );
      const tris = res.indices ? res.indices.length / 3 : 0;
      return {
        clipped: {
          geometry: rebuildClippedGeometry(res),
          rimY: res.rimY,
          groupIndex: f.groupIndex,
        },
        profile: {
          id: f.layer.id,
          clipMs: res.clipMs,
          nodes: res.nodes,
          holes: res.holes,
          tris,
        },
      };
    }
    // Serial fallback (workers unavailable): clip on the current thread.
    const layer: SurfaceChunkLayer = {
      values: f.values,
      header: f.layer.header,
      referenceDepth: f.layer.referenceDepth,
      worldPosition: f.layer.worldPosition,
      color: '',
    };
    const clip = clipChunkLayer(layer, densified, rings, maxError);
    const idx = clip.geometry?.getIndex();
    const tris = idx ? idx.count / 3 : 0;
    let holes = 0;
    for (let i = 0; i < f.values.length; i++) {
      const v = f.values[i];
      if (v === -1 || v < 0) holes++;
    }
    return {
      clipped: {
        geometry: clip.geometry,
        rimY: clip.rimY,
        groupIndex: f.groupIndex,
      },
      profile: {
        id: f.layer.id,
        clipMs: clip.clipMs,
        nodes: f.values.length,
        holes,
        tris,
      },
    };
  };

  let depthOrderMs = 0;
  let settled: ({ clipped: ClippedLayer; profile: ClipProfile } | null)[];

  if (spec.depthOrder) {
    // Depth-ordered path: the clamp cascade is inherently sequential (each layer
    // is clamped against the ALREADY-clamped one above it), so walk the layers in
    // depth order. Fetches are still issued up front (concurrent), and a layer's
    // clip is dispatched as soon as the NEXT layer has finished reading it as a
    // ceiling — a one-layer lag that keeps the clip pool busy without copying any
    // grid.
    const fetches = flat.map(f =>
      store.get<Float32Array>('surface-values', f.layer.id),
    );
    const pending: (Promise<{
      clipped: ClippedLayer;
      profile: ClipProfile;
    }> | null)[] = new Array(flat.length).fill(null);
    let ceiling: DepthOrderLayer | null = null;
    let held: { index: number; layer: FetchedLayer } | null = null;

    const release = () => {
      if (!held) return;
      if (firstClipStart === Infinity) firstClipStart = performance.now();
      pending[held.index] = clipLayer(held.layer);
      held = null;
    };

    for (let i = 0; i < flat.length; i++) {
      const values = await fetches[i];
      lastFetchEnd = performance.now();
      if (!values) continue;
      bytes += values.byteLength;
      const f = flat[i];
      const current: DepthOrderLayer = {
        values,
        header: f.layer.header,
        referenceDepth: f.layer.referenceDepth,
        worldPosition: f.layer.worldPosition,
      };
      if (ceiling) {
        const d0 = performance.now();
        const res = clampSurfaceUnder(current, ceiling, {
          ...spec.depthOrder,
          // only the masked window can end up in the geometry, grown so the
          // feather taper finishes outside the clip crop
          region:
            surfaceGridBounds(
              f.layer.header,
              densified,
              f.layer.worldPosition,
              depthOrderMargin(spec.depthOrder),
            ) ?? undefined,
        });
        current.referenceDepth = res.referenceDepth;
        depthOrderMs += performance.now() - d0;
      }
      // `held` is no longer needed as a ceiling, so its buffer can be transferred
      release();
      held = {
        index: i,
        // the clamp may have rebased the layer's reference depth
        layer: {
          ...f,
          layer: { ...f.layer, referenceDepth: current.referenceDepth },
          values,
        },
      };
      ceiling = current;
    }
    release();

    settled = await Promise.all(pending);
    lastClipEnd = performance.now();
  } else {
    settled = await Promise.all(
      flat.map(async f => {
        const values = await store.get<Float32Array>(
          'surface-values',
          f.layer.id,
        );
        lastFetchEnd = performance.now();
        if (!values) return null;
        bytes += values.byteLength;
        if (firstClipStart === Infinity) firstClipStart = lastFetchEnd;
        const result = await clipLayer({ ...f, values });
        lastClipEnd = performance.now();
        return result;
      }),
    );
  }

  const results = settled.filter((r): r is NonNullable<typeof r> => !!r);
  const fetchMs = lastFetchEnd - t0;
  const clipMs = firstClipStart === Infinity ? 0 : lastClipEnd - firstClipStart;
  const clipped = results.map(r => r.clipped);
  const profile = results.map(r => r.profile);

  return {
    clipped,
    bytes,
    fetchMs,
    clipMs,
    depthOrderMs,
    poolSize: pool ? pool.size : 0,
    profile,
  };
}

/**
 * Assemble clipped layers into a {@link SurfaceChunk}: compact fully-empty groups,
 * assign per-layer colours by flat order (parity with the previous behaviour), and
 * run the cheap rim/wall/basement assembly. Shared by the chunk generator and the
 * debug generator.
 */
export function assembleClippedChunk(
  clipped: ClippedLayer[],
  spec: SurfaceChunkSpec,
  densified: PlanarPolygonGeometry,
  rings: ChunkRings,
  maxError: number,
  timings: { t0: number; densifyMs: number; clipMs: number },
) {
  const colors = spec.colors.length > 0 ? spec.colors : ['#4e79a7'];
  // Compact away fully-empty groups (matches the previous filter) while keeping
  // flat order for colour assignment and wall stitching.
  const usedGroups = [...new Set(clipped.map(c => c.groupIndex))].sort(
    (a, b) => a - b,
  );
  const remap = new Map(usedGroups.map((g, i) => [g, i]));
  const layers: AssembleChunkLayer[] = clipped.map((c, i) => ({
    geometry: c.geometry,
    rimY: c.rimY,
    color: colors[i % colors.length],
    groupIndex: remap.get(c.groupIndex)!,
  }));

  return assembleChunk(
    usedGroups.length,
    layers,
    rings,
    densified,
    { clamp: spec.clamp, maxError, basement: spec.basement },
    {
      t0: timings.t0,
      densifyMs: timings.densifyMs,
      clipMs: timings.clipMs,
      rimMs: 0,
    },
  );
}

/**
 * Build a surface chunk inside a worker: fetch each layer's `surface-values` (the
 * heavy grids stay in the worker), clip them **in parallel** across an internal
 * clip worker pool, assemble the walls/basement, then pack + transfer the resulting
 * geometry back to the main thread. Only the (much smaller) triangulated geometry
 * crosses the boundary.
 *
 * @group Generators
 */
export async function generateSurfaceChunk(
  this: ReadonlyStore,
  spec: SurfaceChunkSpec,
): Promise<SurfaceChunkResponse | null> {
  const t0 = performance.now();
  const polygon = new PlanarPolygonGeometry(
    spec.polygon.coordinates,
    spec.polygon.offset,
  );
  const { densified, rings } = densifyChunkRim(polygon, spec.rimSpacing ?? 250);
  const densifyMs = performance.now() - t0;
  const maxError = spec.maxError ?? 5;

  const { clipped, clipMs } = await fetchAndClipSpecLayers(
    this,
    spec,
    densified,
    rings,
    maxError,
  );

  if (clipped.length === 0 && !spec.basement) return null;

  const chunk = assembleClippedChunk(
    clipped,
    spec,
    densified,
    rings,
    maxError,
    {
      t0,
      densifyMs,
      clipMs,
    },
  );

  const [packed, transferables] = packSurfaceChunk(chunk);
  return transfer(packed, transferables);
}
