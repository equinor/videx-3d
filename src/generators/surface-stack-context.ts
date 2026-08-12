import {
  ChunkResolveOptions,
  DEFAULT_CHUNK_MAX_FILL,
  SurfaceChunkLayerSpec,
  SurfaceChunkStackSpec,
} from '../components/Chunks/chunk-defs';
import {
  buildStackReference,
  clampStackToCarrier,
  PlanarPolygonGeometry,
  rasterizeStackOutline,
  ReadonlyStore,
  resolveStackGrid,
  sealStackChannels,
  STACK_MASK_DATA,
  stackCarrierLevel,
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
  /**
   * Index of the carrier plane appended below the column, or `null` when none was
   * declared. It closes the block, so the resolve leaves it alone and the collapse
   * never drops it (see `StackCollapseOptions.carrier`).
   */
  carrier: number | null;
  /** per-layer, per-node: 1 where the unit was truncated away */
  absent: Uint8Array[];
  /**
   * Per layer, per node: how far the height is INFERRED rather than measured, or
   * `null` when the column was not sealed.
   */
  inferred: Float32Array[] | null;
  /** per layer: nodes the seal moved */
  tapered: number[];
  pairs: StackPairStats[];
  bytes: number;
  fetchMs: number;
  referenceMs: number;
  sealMs: number;
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
  const key = `${stack.key}|${resolve?.mode ?? 'truncate'}|${resolve?.minGap ?? 0}|${resolve?.maxNodes ?? ''}|${resolve?.maxFill ?? DEFAULT_CHUNK_MAX_FILL}|${resolve ? 1 : 0}|${resolve?.seal === false ? 0 : 1}|${resolve?.sealMode ?? 'proportional'}|${resolve?.minThickness ?? ''}`;
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

  // ⭐ The carrier is appended AFTER the resample, not passed through it: a `below`
  // plane is measured against the column's own depths, which only exist once every
  // layer is on the common grid. It is complete and constant, so it needs no
  // resampling of its own — and it gives the deepest surface a neighbour below,
  // which is what keeps the seal proportional down there.
  let carrier: number | null = null;
  let carrierLevel = 0;
  if (stack.carrier) {
    carrierLevel = stackCarrierLevel(
      reference.channels,
      reference.masks,
      stack.carrier,
    );
    const nodes = reference.header.nx * reference.header.ny;
    carrier = reference.channels.length;
    reference.channels.push(new Float32Array(nodes).fill(carrierLevel));
    reference.masks.push(new Uint8Array(nodes).fill(STACK_MASK_DATA));
    layers.push({ depth: -carrierLevel });
  }

  // ⭐ SEALED HERE, on the column, so a horizon two chunks share has ONE height.
  // Sealing per chunk gave a surface the neighbours of whichever chunk was asking —
  // the deepest layer of one chunk tapered against the layer above it while another
  // chunk tapered the same surface onto its own floor — and the two then met each
  // other's walls at different depths.
  // ⚠️ The reach is therefore measured inside the ENVELOPE rather than inside one
  // chunk's footprint: a single height and a per-chunk taper shape cannot both hold.
  // ⚠️ `void` is NOT done here — it splits a layer in two, which the id -> index map
  // below cannot express. It stays per chunk (see `buildSpecStack`).
  const sealing = resolve?.seal !== false && resolve?.sealMode !== 'void';
  const sealed = sealing
    ? sealStackChannels(
        reference.channels,
        reference.masks,
        reference.header.nx,
        {
          mode: resolve?.sealMode,
          minThickness: resolve?.minThickness,
          inside: rasterizeStackOutline(reference, envelope),
          cellSize: (reference.header.xinc + reference.header.yinc) / 2,
        },
      )
    : null;
  const sealedReference = sealed
    ? { ...reference, channels: sealed.channels }
    : reference;
  const tSeal = performance.now();

  // Nothing pierces the carrier. Elementwise, so it cannot introduce a crossing
  // for the resolve below to find; whatever it flattens ends up with no thickness
  // and is dropped by the collapse.
  if (carrier !== null) {
    clampStackToCarrier(sealedReference.channels, carrier, carrierLevel);
  }

  // The whole column is made monotone here, on the common grid, so every chunk
  // that samples it inherits an ordering the others agree with. The masks come
  // along so the statistics can separate real crossings from the hole fill.
  const resolved = resolve
    ? resolveStackGrid(sealedReference.channels, {
        mode: resolve.mode,
        minGap: resolve.minGap,
        coverage: reference.masks,
      })
    : resolveStackGrid(sealedReference.channels, {
        apply: false,
        coverage: reference.masks,
      });
  const tResolve = performance.now();

  // Re-imposed, because a positive `minGap` would have pushed the floor below the
  // very horizons it just truncated. Clamping again cannot break the ordering the
  // resolve established — a max against a constant preserves it.
  if (carrier !== null) {
    clampStackToCarrier(sealedReference.channels, carrier, carrierLevel);
    resolved.absent[carrier]?.fill(0);
  }

  return {
    key,
    reference: sealedReference,
    layers,
    index,
    carrier,
    absent: resolved.absent,
    inferred: sealed?.inferred ?? null,
    tapered: sealed?.tapered ?? [],
    pairs: resolved.pairs,
    bytes,
    fetchMs: tFetch - t0,
    referenceMs: tReference - tFetch,
    sealMs: tSeal - tReference,
    resolveMs: tResolve - tSeal,
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
