import {
  ChunkResolveOptions,
  DEFAULT_CHUNK_MAX_FILL,
  SurfaceChunkLayerSpec,
  SurfaceChunkStackSpec,
} from '../components/Chunks/chunk-defs';
import {
  clampStackToCarrier,
  layEmptyStackLayers,
  planStackReference,
  PlanarPolygonGeometry,
  rasterizeStackOutline,
  ReadonlyStore,
  resolveStackGrid,
  sealStackChannels,
  splitVoidChannels,
  STACK_MASK_DATA,
  stackCarrierLevel,
  StackLayer,
  StackPairStats,
  StackReference,
} from '../sdk';
import {
  refineStackChannels,
  resampleStackChannel,
} from './workers/stack-worker-pool';

/**
 * A whole column, resampled onto one common grid and made monotone — the work
 * every chunk cut from that column shares.
 */
export type StackContext = {
  key: string;
  /**
   * The common grid, holding one channel per EXPANDED layer — which is one per
   * column layer unless `sealMode: 'void'` split one in two (see
   * {@link StackContext.expansion}).
   */
  reference: StackReference;
  /** the layers, in the order they were resolved (shallowest first) */
  layers: StackLayer[];
  /** surface id -> index into `layers` */
  index: Map<string, number>;
  /**
   * Per COLUMN layer, the index (or two) it occupies in the expanded arrays. A
   * void splits a surface into a ceiling and a floor, and both belong to every
   * chunk that draws that horizon — splitting it here rather than per chunk is
   * what stops two chunks opening the same void differently.
   */
  expansion: number[][];
  /** per EXPANDED layer: it is the upper copy of a void (see `StackVoidResult`) */
  ceiling: boolean[];
  /**
   * Index of the carrier plane appended below the column, or `null` when none was
   * declared. In COLUMN space, like {@link StackContext.index} — the expanded one
   * a chunk needs it finds through {@link StackContext.expansion}.
   *
   * It closes the block, so the resolve leaves it alone and the collapse never
   * drops it (see `StackCollapseOptions.carrier`).
   */
  carrier: number | null;
  /** per EXPANDED layer, per node: 1 where the unit was truncated away */
  absent: Uint8Array[];
  /**
   * Per EXPANDED layer, per node: how far the height is INFERRED rather than
   * measured, or `null` when the column was neither sealed nor split.
   */
  inferred: Float32Array[] | null;
  /** per COLUMN layer: nodes the seal or the split moved */
  tapered: number[];
  pairs: StackPairStats[];
  bytes: number;
  /**
   * ⚠️ `fetchMs` and `referenceMs` are OVERLAPPING windows, not consecutive
   * phases: a layer is resampled as soon as its own grid lands. `fetchMs` runs to
   * the last grid's arrival, `referenceMs` from there to the last resample.
   */
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
  const envelope = new PlanarPolygonGeometry(
    stack.polygon.coordinates,
    stack.polygon.offset,
  );
  // ⭐ The common grid comes from the layers' HEADERS, which the spec already
  // carries — so it is known before a single grid has been fetched, and each layer
  // can be resampled (on the pool) the moment its own samples land instead of
  // after the slowest one. `fetchMs` and `referenceMs` are therefore OVERLAPPING
  // windows, not consecutive phases.
  const plan = planStackReference(stack.layers, envelope, {
    maxNodes: resolve?.maxNodes,
    maxFill: resolve?.maxFill ?? DEFAULT_CHUNK_MAX_FILL,
  });
  if (!plan) return null;

  let tFetch = t0;
  let bytes = 0;
  const resampled = await Promise.all(
    stack.layers.map(async (spec: SurfaceChunkLayerSpec) => {
      const values = await store.get<Float32Array>('surface-values', spec.id);
      tFetch = performance.now();
      if (!values) return null;
      bytes += values.byteLength;
      // ⚠️ `values` is TRANSFERRED into the worker and detached here. Safe because
      // nothing downstream reads a layer's samples — `isSyntheticLayer` only tests
      // whether the field is undefined, and the geometry needs the placement.
      const result = await resampleStackChannel(
        plan,
        { header: spec.header, worldPosition: spec.worldPosition },
        values,
        spec.referenceDepth,
      );
      return { spec, values, result };
    }),
  );

  const layers: StackLayer[] = [];
  const index = new Map<string, number>();
  const channels: Float32Array[] = [];
  const masks: Uint8Array[] = [];
  const empty: boolean[] = [];
  resampled.forEach(entry => {
    if (!entry) return;
    index.set(entry.spec.id, layers.length);
    layers.push({
      values: entry.values,
      header: entry.spec.header,
      referenceDepth: entry.spec.referenceDepth,
      worldPosition: entry.spec.worldPosition,
    });
    channels.push(entry.result.channel);
    masks.push(entry.result.mask);
    empty.push(entry.result.empty);
  });
  if (layers.length === 0) return null;
  layEmptyStackLayers(channels, empty);

  const reference: StackReference = {
    header: plan.header,
    worldPosition: plan.worldPosition,
    channels,
    masks,
    step: plan.step,
  };
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
  const voiding = resolve?.seal !== false && resolve?.sealMode === 'void';
  const sealing = resolve?.seal !== false && !voiding;
  const sealOptions = {
    minThickness: resolve?.minThickness,
    inside: rasterizeStackOutline(reference, envelope),
    cellSize: (reference.header.xinc + reference.header.yinc) / 2,
  };
  const sealed = sealing
    ? sealStackChannels(
        reference.channels,
        reference.masks,
        reference.header.nx,
        { mode: resolve?.sealMode, ...sealOptions },
      )
    : null;
  // ⭐ `void` turns one layer into TWO, so the column publishes the expansion and
  // every chunk picks its copies out of it — rather than each chunk splitting the
  // same horizon against its own neighbours and meeting the next chunk's walls
  // somewhere else. The split needs no fill state, which is what lets it run here.
  const split = voiding
    ? splitVoidChannels(
        reference.channels,
        reference.masks,
        reference.header.nx,
        sealOptions,
      )
    : null;
  // Per COLUMN layer, the index (or two) it occupies in the expanded list.
  const expansion: number[][] = layers.map(() => []);
  (split?.source ?? layers.map((_, i) => i)).forEach((column, expanded) =>
    expansion[column].push(expanded),
  );
  const sealedReference = {
    ...reference,
    channels: split?.channels ?? sealed?.channels ?? reference.channels,
    masks: split?.masks ?? reference.masks,
  };
  // ⚠️ `carrier` stays a COLUMN index, because that is what a chunk's picks are.
  // The clamp and the resolve work on the expanded arrays, so they need the other
  // one — the carrier is complete and so never split, but layers above it may be,
  // which moves it.
  const carrierExpanded = carrier === null ? null : expansion[carrier][0];
  const tSeal = performance.now();

  // Nothing pierces the carrier. Elementwise, so it cannot introduce a crossing
  // for the resolve below to find; whatever it flattens ends up with no thickness
  // and is dropped by the collapse.
  if (carrierExpanded !== null) {
    clampStackToCarrier(
      sealedReference.channels,
      carrierExpanded,
      carrierLevel,
    );
  }

  // The whole column is made monotone here, on the common grid, so every chunk
  // that samples it inherits an ordering the others agree with. The masks come
  // along so the statistics can separate real crossings from the hole fill.
  const resolved = resolve
    ? resolveStackGrid(sealedReference.channels, {
        mode: resolve.mode,
        minGap: resolve.minGap,
        coverage: sealedReference.masks,
      })
    : resolveStackGrid(sealedReference.channels, {
        apply: false,
        coverage: sealedReference.masks,
      });
  const tResolve = performance.now();

  // Re-imposed, because a positive `minGap` would have pushed the floor below the
  // very horizons it just truncated. Clamping again cannot break the ordering the
  // resolve established — a max against a constant preserves it.
  if (carrierExpanded !== null) {
    clampStackToCarrier(
      sealedReference.channels,
      carrierExpanded,
      carrierLevel,
    );
    resolved.absent[carrierExpanded]?.fill(0);
  }

  return {
    key,
    reference: sealedReference,
    layers,
    index,
    expansion,
    ceiling: split?.ceiling ?? layers.map(() => false),
    carrier,
    absent: resolved.absent,
    inferred: split?.inferred ?? sealed?.inferred ?? null,
    // The split counts per COPY; the caller reads this per declared layer.
    tapered: split
      ? expansion.map(copies =>
          copies.reduce((a, k) => a + (split.moved[k] ?? 0), 0),
        )
      : (sealed?.tapered ?? []),
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
const refinedByKey = new Map<
  string,
  Promise<{ candidates: Uint32Array[]; poolSize: number }>
>();

export function getStackCandidates(
  context: StackContext,
  maxError: number,
): Promise<{ candidates: Uint32Array[]; poolSize: number }> {
  const key = `${context.key}|${maxError}`;
  let pending = refinedByKey.get(key);
  if (!pending) {
    // only the current column is worth keeping
    refinedByKey.clear();
    pending = refineStackChannels(
      context.reference.channels,
      context.reference.header.nx,
      maxError,
    );
    refinedByKey.set(key, pending);
  }
  return pending;
}
