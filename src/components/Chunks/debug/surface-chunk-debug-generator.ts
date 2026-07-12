import { transfer } from 'comlink';
import {
  assembleClippedChunk,
  ClipProfile,
  fetchAndClipSpecLayers,
} from '../../../generators/surface-chunk-generator';
import {
  densifyChunkRim,
  PackedSurfaceChunk,
  packSurfaceChunk,
  PlanarPolygonGeometry,
  ReadonlyStore,
} from '../../../sdk';
import { SurfaceChunkSpec } from '../chunk-defs';

/**
 * TEMPORARY bottleneck-test generator — mirrors `generateSurfaceChunk` (fetch +
 * PARALLEL clip pool + assemble) but adds worker-side phase timings so we can
 * measure the optimization. Remove together with `ChunkBottleneck.stories.tsx`.
 */
export const surfaceChunkDebug = 'surfaceChunkDebug';

export type SurfaceChunkDebugTimings = {
  /** time to fetch every layer's `surface-values` (serial, single data worker) */
  fetchMs: number;
  /** clip time (wall-clock; parallel across the clip worker pool) */
  buildMs: number;
  /** time to pack all geometries for transfer */
  packMs: number;
  /** total worker time (fetch + clip + assemble + pack) */
  totalWorkerMs: number;
  /** total bytes of `surface-values` fetched */
  bytes: number;
  /** number of clip workers in the pool (0 = serial fallback) */
  poolSize: number;
  /** per-surface clip profile (id / clipMs / nodes / holes / tris) */
  profile: ClipProfile[];
};

export type SurfaceChunkDebugResponse = PackedSurfaceChunk & {
  debug: SurfaceChunkDebugTimings;
};

export async function generateSurfaceChunkDebug(
  this: ReadonlyStore,
  spec: SurfaceChunkSpec,
): Promise<SurfaceChunkDebugResponse | null> {
  const t0 = performance.now();
  const polygon = new PlanarPolygonGeometry(
    spec.polygon.coordinates,
    spec.polygon.offset,
  );
  const { densified, rings } = densifyChunkRim(polygon, spec.rimSpacing ?? 250);
  const densifyMs = performance.now() - t0;
  const maxError = spec.maxError ?? 5;

  const { clipped, bytes, fetchMs, clipMs, poolSize, profile } =
    await fetchAndClipSpecLayers(this, spec, densified, rings, maxError);

  if (clipped.length === 0 && !spec.basement) return null;

  const tAssemble = performance.now();
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
  const tPack = performance.now();

  const response: SurfaceChunkDebugResponse = {
    ...packed,
    debug: {
      fetchMs,
      buildMs: clipMs,
      packMs: tPack - tAssemble,
      totalWorkerMs: tPack - t0,
      bytes,
      poolSize,
      profile,
    },
  };
  return transfer(response, transferables);
}
