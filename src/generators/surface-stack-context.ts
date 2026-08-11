import {
  ChunkResolveOptions,
  DEFAULT_CHUNK_MAX_FILL,
  SurfaceChunkLayerSpec,
  SurfaceChunkStackSpec,
} from '../components/Chunks/chunk-defs';
import {
  buildStackReference,
  PlanarPolygonGeometry,
  ReadonlyStore,
  resolveStackGrid,
  StackLayer,
  StackPairStats,
  StackReference,
} from '../sdk';
import { refineStackChannels } from './workers/stack-worker-pool';

/**
 * A whole column, resampled onto one common grid and made monotone — the work
 * every chunk cut from that column shares.
 */
export type StackContext = {
  key: string;
  reference: StackReference;
  /** the layers, in the order they were resolved (shallowest first) */
  layers: StackLayer[];
  /** surface id -> index into `layers` / `reference.channels` */
  index: Map<string, number>;
  /** per-layer, per-node: 1 where the unit was truncated away */
  absent: Uint8Array[];
  pairs: StackPairStats[];
  bytes: number;
  fetchMs: number;
  referenceMs: number;
  resolveMs: number;
};

// ONE column is cached at a time: the channels are the heaviest thing the
// generator holds (nodes x layers x 4 bytes), so keeping several would be worse
// than rebuilding. Chunks of the same column arrive together and share the
// in-flight promise; a different column evicts this one.
let cached: { key: string; promise: Promise<StackContext | null> } | null =
  null;

/**
 * Build (or reuse) the resolved column a chunk belongs to.
 *
 * The first chunk of a column pays for the fetch, the resample and the resolve;
 * every other chunk with the same `stack.key` awaits the same promise. That is
 * what makes several chunks of one column agree about depth order — they sample
 * grids that were ordered together — as well as what keeps the cost flat as chunks
 * are added.
 */
export function getStackContext(
  store: ReadonlyStore,
  stack: SurfaceChunkStackSpec,
  resolve: ChunkResolveOptions | undefined,
): Promise<StackContext | null> {
  const key = `${stack.key}|${resolve?.mode ?? 'truncate'}|${resolve?.minGap ?? 0}|${resolve?.maxNodes ?? ''}|${resolve?.maxFill ?? DEFAULT_CHUNK_MAX_FILL}|${resolve ? 1 : 0}`;
  if (cached && cached.key === key) return cached.promise;
  const promise = buildStackContext(store, stack, resolve, key);
  cached = { key, promise };
  return promise;
}

/** Drop the cached column (tests / explicit teardown). */
export function clearStackContext(): void {
  cached = null;
}

async function buildStackContext(
  store: ReadonlyStore,
  stack: SurfaceChunkStackSpec,
  resolve: ChunkResolveOptions | undefined,
  key: string,
): Promise<StackContext | null> {
  const t0 = performance.now();
  const grids = await Promise.all(
    stack.layers.map(l => store.get<Float32Array>('surface-values', l.id)),
  );
  const tFetch = performance.now();

  const layers: StackLayer[] = [];
  const index = new Map<string, number>();
  let bytes = 0;
  stack.layers.forEach((spec: SurfaceChunkLayerSpec, i) => {
    const values = grids[i];
    if (!values) return;
    bytes += values.byteLength;
    index.set(spec.id, layers.length);
    layers.push({
      values,
      header: spec.header,
      referenceDepth: spec.referenceDepth,
      worldPosition: spec.worldPosition,
    });
  });
  if (layers.length === 0) return null;

  const envelope = new PlanarPolygonGeometry(
    stack.polygon.coordinates,
    stack.polygon.offset,
  );
  const reference = buildStackReference(layers, envelope, {
    maxNodes: resolve?.maxNodes,
    maxFill: resolve?.maxFill ?? DEFAULT_CHUNK_MAX_FILL,
  });
  if (!reference) return null;
  const tReference = performance.now();

  // ⚠️ The SEAL does NOT run here. A chunk's layer list is not the column's — it
  // adds synthetic layers (a water top, a floor) and takes a slice — so the
  // neighbours a surface is sealed against differ per chunk. Sealing the column
  // would use the wrong ones: the deepest column surface would appear to have no
  // neighbour below even in a chunk that puts a floor under it. See
  // `buildSpecStack`.

  // The whole column is made monotone here, on the common grid, so every chunk
  // that samples it inherits an ordering the others agree with. The masks come
  // along so the statistics can separate real crossings from the hole fill.
  const resolved = resolve
    ? resolveStackGrid(reference.channels, {
        mode: resolve.mode,
        minGap: resolve.minGap,
        coverage: reference.masks,
      })
    : resolveStackGrid(reference.channels, {
        apply: false,
        coverage: reference.masks,
      });
  const tResolve = performance.now();

  return {
    key,
    reference,
    layers,
    index,
    absent: resolved.absent,
    pairs: resolved.pairs,
    bytes,
    fetchMs: tFetch - t0,
    referenceMs: tReference - tFetch,
    resolveMs: tResolve - tReference,
  };
}

/**
 * Refine the column's channels once and cache the candidates alongside it, so the
 * per-layer refinement is also shared by every chunk of the column.
 */
const refinedByKey = new Map<string, Promise<Uint32Array[]>>();

export function getStackCandidates(
  context: StackContext,
  maxError: number,
): Promise<Uint32Array[]> {
  const key = `${context.key}|${maxError}`;
  let pending = refinedByKey.get(key);
  if (!pending) {
    // only the current column is worth keeping
    refinedByKey.clear();
    pending = refineStackChannels(
      context.reference.channels,
      context.reference.header.nx,
      maxError,
    ).then(r => r.candidates);
    refinedByKey.set(key, pending);
  }
  return pending;
}
