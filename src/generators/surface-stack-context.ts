import pLimit from 'p-limit';
import {
  ChunkResolveOptions,
  DEFAULT_CHUNK_MAX_FILL,
  SurfaceChunkLayerSpec,
  SurfaceChunkStackSpec,
} from '../components/Chunks/chunk-defs';
import {
  clampStackToCarrier,
  layEmptyStackLayers,
  PlanarPolygonGeometry,
  planStackReference,
  rasterizeStackOutline,
  ReadonlyStore,
  ReliefReader,
  ReliefSource,
  resolveStackGrid,
  sampleReliefSource,
  sealStackChannels,
  splitVoidChannels,
  STACK_MASK_DATA,
  stackCarrierLevel,
  StackLayer,
  StackPairStats,
  StackReference,
  StackReferencePlan,
  SurfaceChunkPhase,
  surfaceGridToWorld,
  SurfaceStackOptions,
  SurfaceStackPlan,
} from '../sdk';
import type { ThicknessLines } from '../sdk/geometries/surface-stack-terminations';
import type { GridRing } from '../sdk/geometries/triangulate-grid-delaunay';
import {
  getStackPool,
  refineStackChannels,
  resampleStackChannel,
  StackCandidates,
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
   * Bytes this context KEEPS ALIVE while it is cached — the channels, the masks,
   * the truncation masks and the seal's inferred weights. Reported so the largest
   * allocation in the library is visible rather than inferred.
   */
  retainedBytes: number;
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

// Columns are the heaviest thing the generator holds (nodes x layers x 4 bytes),
// so only a few are kept resident — enough for several ChunkStacks (or one stack
// whose chunks resolve differently) to coexist without evicting each other on
// every request, yet bounded so a control sweep cannot pile columns up. Chunks of
// the same column arrive together and share its in-flight promise.
const MAX_CACHED_COLUMNS = 4;
const columns = new Map<string, Promise<StackContext | null>>();

// ⭐ Column builds are SERIALIZED on this chain. Eviction does not stop a build
// that has already started, and each one holds its own full set of channels, so
// letting a control sweep start a column per tick multiplies the largest
// allocation in the library by the number of stale requests.
let chain: Promise<unknown> = Promise.resolve();

/** Bytes each cached column keeps resident, for {@link stackContextStats}. */
const retainedByKey = new Map<string, number>();
let columnsBuilt = 0;
let columnsInFlight = 0;

/** Hears a step of shared work: `done` of `total` units of `phase`. */
export type StackProgress = (
  phase: SurfaceChunkPhase,
  done: number,
  total: number,
) => void;

type Watcher = {
  listeners: Set<StackProgress>;
  last: Parameters<StackProgress> | null;
  report: StackProgress;
};

// Shared work IN FLIGHT, keyed like the work: every chunk waiting on it hears its
// progress, and one that joins late starts from the last report.
const watchers = new Map<string, Watcher>();

function openWatcher(key: string): Watcher {
  const watcher: Watcher = {
    listeners: new Set(),
    last: null,
    report: (phase, done, total) => {
      watcher.last = [phase, done, total];
      watcher.listeners.forEach(listener => listener(phase, done, total));
    },
  };
  watchers.set(key, watcher);
  return watcher;
}

function closeWatcher(key: string, watcher: Watcher, work: Promise<unknown>) {
  const close = () => {
    if (watchers.get(key) === watcher) watchers.delete(key);
  };
  work.then(close, close);
}

function watch(key: string, listener: StackProgress | undefined): void {
  const watcher = watchers.get(key);
  if (!watcher || !listener) return;
  watcher.listeners.add(listener);
  if (watcher.last) listener(...watcher.last);
}

/** Drop a column from the cache (and its resident-bytes accounting). */
function evictColumn(key: string): void {
  columns.delete(key);
  retainedByKey.delete(key);
}

/** Keep the cache within {@link MAX_CACHED_COLUMNS}, evicting least-recently-used. */
function pruneColumns(): void {
  while (columns.size > MAX_CACHED_COLUMNS) {
    const oldest = columns.keys().next().value as string;
    evictColumn(oldest);
  }
}

/** Accounting for the resources the stack generators hold. */
export type StackContextStats = {
  /** the cached column, or `null` when none is held */
  columnKey: string | null;
  /** bytes the cached column keeps resident (channels, masks, absent, inferred) */
  columnBytes: number;
  /** bytes held by the cached per-layer refinement candidates */
  candidateBytes: number;
  /** columns built since this worker started */
  columnsBuilt: number;
  /** column builds currently running */
  columnsInFlight: number;
};

/** What the stack generators currently hold (see `generatorStats`). */
export function stackContextStats(): StackContextStats {
  let columnBytes = 0;
  for (const bytes of retainedByKey.values()) columnBytes += bytes;
  // Most-recently-used column (last in insertion order).
  let columnKey: string | null = null;
  for (const key of columns.keys()) columnKey = key;
  return {
    columnKey,
    columnBytes,
    candidateBytes: totalCandidateBytes(),
    columnsBuilt,
    columnsInFlight,
  };
}

/**
 * Build (or reuse) the resolved column a chunk belongs to.
 *
 * The first chunk of a column pays for the fetch, the resample and the resolve;
 * every other chunk with the same `stack.key` awaits the same promise. That is
 * what makes several chunks of one column agree about depth order — they sample
 * grids that were ordered together — as well as what keeps the cost flat as chunks
 * are added.
 *
 * @param onProgress hears the column's `fetch` and `resolve` steps while it is
 *   being built, whichever chunk started it
 */
export function getStackContext(
  store: ReadonlyStore,
  stack: SurfaceChunkStackSpec,
  resolve: ChunkResolveOptions | undefined,
  onProgress?: StackProgress,
): Promise<StackContext | null> {
  const key = `${stack.key}|${resolve?.mode ?? 'truncate'}|${resolve?.minGap ?? 0}|${resolve?.maxNodes ?? ''}|${resolve?.maxFill ?? DEFAULT_CHUNK_MAX_FILL}|${resolve ? 1 : 0}|${resolve?.seal === false ? 0 : 1}|${resolve?.sealMode ?? 'proportional'}|${resolve?.minThickness ?? ''}`;
  const existing = columns.get(key);
  if (existing) {
    // Touch: move to the most-recently-used end so a shared column is not the one
    // an unrelated request evicts.
    columns.delete(key);
    columns.set(key, existing);
    watch(key, onProgress);
    return existing;
  }
  // ⭐ The column is SHARED work — every chunk cut from it awaits this one promise,
  // so it is deliberately NOT gated on any single caller's staleness. A chunk that
  // has moved on abandons its OWN build (see `isStale` in the chunk generator); it
  // does not abort the column its siblings are still waiting for.
  const watcher = openWatcher(key);
  const promise = chain.then(() => {
    columnsInFlight++;
    return buildStackContext(
      store,
      stack,
      resolve,
      key,
      watcher.report,
    ).finally(() => {
      columnsInFlight--;
    });
  });
  closeWatcher(key, watcher, promise);
  watch(key, onProgress);
  // ⚠️ Never leave a failed or empty build cached: a null under the key would hand
  // every later chunk of this column an empty result with nothing to retry it.
  promise.then(
    context => {
      if (columns.get(key) !== promise) retainedByKey.delete(key);
      else if (!context) evictColumn(key);
    },
    () => {
      if (columns.get(key) === promise) evictColumn(key);
      retainedByKey.delete(key);
    },
  );
  columns.set(key, promise);
  pruneColumns();
  chain = promise.catch(() => undefined);
  return promise;
}

// Live ChunkStacks, so the shared caches are torn down only when the LAST one
// unmounts — two stacks in a scene must not release each other's column.
const activeStacks = new Set<string>();

/** Register a live ChunkStack (see `releaseStackResources`). */
export function acquireStackContext(id: string): void {
  activeStacks.add(id);
}

/**
 * Drop a ChunkStack. Returns whether it was the last one still live — i.e. whether
 * the heavy caches should now be cleared.
 */
export function releaseStackContext(id: string): boolean {
  activeStacks.delete(id);
  return activeStacks.size === 0;
}

/**
 * Drop the cached column and its refinement (tests / explicit teardown).
 *
 * ⚠️ This is the heaviest thing the generators hold — one channel per layer over
 * the whole reference grid, plus masks and the seal's inferred weights. At the
 * default node budget that is hundreds of MB, retained until something calls
 * this. An in-flight build is unaffected: it holds its own reference and only
 * loses the chance to be shared.
 */
export function clearStackContext(): void {
  columns.clear();
  retainedByKey.clear();
  refinedByKey.clear();
  candidateBytesByKey.clear();
}

// One reader per store: it keeps the relief's records, and its blocks under a budget,
// between columns.
const reliefReaders = new WeakMap<ReadonlyStore, ReliefReader>();
const RELIEF_BLOCK_BUDGET = 32 * 1024 * 1024;

/**
 * A column layer on the relief: merged onto the common grid as the stage merges its
 * tiles, in scene Y — the sea's level, plus the height, plus the source's margin.
 */
async function sampleColumnRelief(
  store: ReadonlyStore,
  plan: StackReferencePlan,
  source: ReliefSource,
): Promise<Float32Array> {
  let reader = reliefReaders.get(store);
  if (!reader) {
    reader = new ReliefReader(
      (dataType, id, args) => store.get(dataType, id, args),
      RELIEF_BLOCK_BUDGET,
    );
    reliefReaders.set(store, reader);
  }
  const { nx, ny } = plan.header;
  const toWorld = surfaceGridToWorld(plan.header, plan.worldPosition);
  const origin = toWorld(0, 0);
  const [ux, uz] = toWorld(1, 0);
  const [vx, vz] = toWorld(0, 1);
  const channel = await sampleReliefSource(reader, source, {
    origin,
    u: [ux - origin[0], uz - origin[1]],
    v: [vx - origin[0], vz - origin[1]],
    size: [nx, ny],
  });
  const lift = source.level + (source.margin ?? 0);
  for (let k = 0; k < channel.length; k++) channel[k] += lift;
  return channel;
}

async function buildStackContext(
  store: ReadonlyStore,
  stack: SurfaceChunkStackSpec,
  resolve: ChunkResolveOptions | undefined,
  key: string,
  report: StackProgress,
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
  // ⚠️⚠️ BOUNDED, not `Promise.all` over every layer: the store hands out a COPY
  // of each grid (comlink's transfer detaches, so it cannot hand out the cached
  // one), and that copy is only released when the pool takes it. Fetching the
  // whole column at once therefore holds a second copy of the entire dataset —
  // hundreds of MB — for as long as the slowest resample takes. One in flight per
  // pool worker keeps the pool saturated, so the pipelining is unaffected.
  const inFlight = pLimit(Math.max(2, getStackPool()?.size ?? 4));
  let fetched = 0;
  const resampled = await Promise.all(
    stack.layers.map((spec: SurfaceChunkLayerSpec) =>
      inFlight(async () => {
        if (spec.reliefSource) {
          // On the relief: covered everywhere, and already on the common grid.
          const channel = await sampleColumnRelief(
            store,
            plan,
            spec.reliefSource,
          );
          tFetch = performance.now();
          bytes += channel.byteLength;
          report('fetch', ++fetched, stack.layers.length);
          return {
            spec,
            // Read by nothing downstream (see below); a grid layer all the same.
            values: new Float32Array(0),
            result: {
              channel,
              mask: new Uint8Array(channel.length).fill(STACK_MASK_DATA),
              empty: false,
            },
          };
        }
        const values = await store.get<Float32Array>('surface-values', spec.id);
        tFetch = performance.now();
        if (!values) {
          report('fetch', ++fetched, stack.layers.length);
          return null;
        }
        bytes += values.byteLength;
        // ⚠️ `values` is TRANSFERRED into the worker and detached here. Safe
        // because nothing downstream reads a layer's samples — `isSyntheticLayer`
        // only tests whether the field is undefined, and the geometry needs the
        // placement.
        const result = await resampleStackChannel(
          plan,
          { header: spec.header, worldPosition: spec.worldPosition },
          values,
          spec.referenceDepth,
        );
        report('fetch', ++fetched, stack.layers.length);
        return { spec, values, result };
      }),
    ),
  );
  report('resolve', 0, 1);

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

  const inferred = split?.inferred ?? sealed?.inferred ?? null;
  const sum = (arrays: ArrayBufferView[] | null) =>
    arrays ? arrays.reduce((a, v) => a + v.byteLength, 0) : 0;
  const retainedBytes =
    sum(sealedReference.channels) +
    sum(sealedReference.masks) +
    sum(resolved.absent) +
    sum(inferred);
  retainedByKey.set(key, retainedBytes);
  columnsBuilt++;

  return {
    key,
    reference: sealedReference,
    layers,
    index,
    expansion,
    ceiling: split?.ceiling ?? layers.map(() => false),
    carrier,
    absent: resolved.absent,
    inferred,
    // The split counts per COPY; the caller reads this per declared layer.
    tapered: split
      ? expansion.map(copies =>
          copies.reduce((a, k) => a + (split.moved[k] ?? 0), 0),
        )
      : (sealed?.tapered ?? []),
    pairs: resolved.pairs,
    bytes,
    retainedBytes,
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
const refinedByKey = new Map<string, Promise<StackCandidates>>();

/** Bytes each cached candidate set holds, keyed like {@link refinedByKey}. */
const candidateBytesByKey = new Map<string, number>();

function totalCandidateBytes(): number {
  let total = 0;
  for (const bytes of candidateBytesByKey.values()) total += bytes;
  return total;
}

export function getStackCandidates(
  context: StackContext,
  maxError: number,
  onProgress?: StackProgress,
): Promise<StackCandidates> {
  const key = `${context.key}|${maxError}`;
  const existing = refinedByKey.get(key);
  if (existing) {
    refinedByKey.delete(key);
    refinedByKey.set(key, existing);
    watch(key, onProgress);
    return existing;
  }
  const watcher = openWatcher(key);
  const pending = refineStackChannels(
    context.reference.channels,
    context.reference.header.nx,
    maxError,
    (done, total) => watcher.report('refine', done, total),
  ).then(result => {
    if (refinedByKey.get(key) === pending)
      candidateBytesByKey.set(
        key,
        result.candidates.reduce((a, c) => a + c.byteLength, 0) +
          result.errors.reduce((a, e) => a + e.byteLength, 0) +
          result.triangles.reduce((a, t) => a + t.byteLength, 0),
      );
    return result;
  });
  pending.catch(() => {
    if (refinedByKey.get(key) === pending) {
      refinedByKey.delete(key);
      candidateBytesByKey.delete(key);
    }
  });
  refinedByKey.set(key, pending);
  closeWatcher(key, watcher, pending);
  watch(key, onProgress);
  // Kept in step with the column cache: the candidates belong to a column.
  while (refinedByKey.size > MAX_CACHED_COLUMNS) {
    const oldest = refinedByKey.keys().next().value as string;
    refinedByKey.delete(oldest);
    candidateBytesByKey.delete(oldest);
  }
  return pending;
}

/** One pair's termination lines, packed: a quarter of the memory of point arrays. */
type PackedLines = {
  points: Float64Array;
  /** where each ring ends, in points */
  ends: Uint32Array;
  tiny: number;
  discarded: number;
};

type ColumnDerived = {
  coverage: Map<Uint8Array, Uint32Array>;
  lines: Map<string, PackedLines[]>;
};

// By the context itself, so it goes when the column does.
const derivedByColumn = new WeakMap<StackContext, ColumnDerived>();
// Chunks of one column may draw different layer sets.
const MAX_LINE_SETS = 4;

/** What a stack plan may be handed instead of deriving it (see `planSurfaceStack`). */
export type StackDerived = Pick<
  SurfaceStackOptions,
  'terminationLines' | 'coverageCrossings'
>;

/**
 * What an earlier build of this column derived from its channels alone, for a
 * build over `channels` and `masks`. Only the column's own arrays match: a
 * synthetic or voided layer's are made per build, so nothing is reused for them.
 *
 * @param key whatever else the termination lines depend on (threshold, error)
 */
export function getStackDerived(
  context: StackContext,
  channels: Float32Array[],
  masks: Uint8Array[],
  key: string,
): StackDerived {
  const derived = derivedByColumn.get(context);
  if (!derived) return {};
  const set = layerSetKey(context, channels, key);
  const packed = set !== null ? derived.lines.get(set) : undefined;
  if (packed) {
    derived.lines.delete(set!);
    derived.lines.set(set!, packed);
  }
  return {
    coverageCrossings: masks.map(mask => derived.coverage.get(mask)),
    terminationLines: packed?.map(unpackLines),
  };
}

/** Keep what a plan derived (see {@link getStackDerived}). */
export function keepStackDerived(
  context: StackContext,
  channels: Float32Array[],
  masks: Uint8Array[],
  key: string,
  plan: Pick<SurfaceStackPlan, 'terminationLines' | 'coverageCrossings'>,
): void {
  let derived = derivedByColumn.get(context);
  if (!derived) {
    derived = { coverage: new Map(), lines: new Map() };
    derivedByColumn.set(context, derived);
  }
  const own = new Set(context.reference.masks);
  plan.coverageCrossings?.forEach((crossings, i) => {
    if (crossings && own.has(masks[i]))
      derived.coverage.set(masks[i], crossings);
  });
  const set = layerSetKey(context, channels, key);
  if (!plan.terminationLines || set === null || derived.lines.has(set)) return;
  derived.lines.set(set, plan.terminationLines.map(packLines));
  while (derived.lines.size > MAX_LINE_SETS) {
    derived.lines.delete(derived.lines.keys().next().value as string);
  }
}

// The column index of every channel; `null` when one is not the column's own.
function layerSetKey(
  context: StackContext,
  channels: Float32Array[],
  key: string,
): string | null {
  const indices = channels.map(c => context.reference.channels.indexOf(c));
  return indices.includes(-1) ? null : `${indices.join(',')}|${key}`;
}

function packLines({ rings, tiny, discarded }: ThicknessLines): PackedLines {
  const ends = new Uint32Array(rings.length);
  let count = 0;
  rings.forEach((ring, r) => (ends[r] = count += ring.length));
  const points = new Float64Array(2 * count);
  let at = 0;
  for (const ring of rings) {
    for (const p of ring) {
      points[at++] = p[0];
      points[at++] = p[1];
    }
  }
  return { points, ends, tiny, discarded };
}

function unpackLines({ points, ends, tiny, discarded }: PackedLines) {
  const rings: GridRing[] = [];
  let k = 0;
  for (const end of ends) {
    const ring: GridRing = [];
    for (; k < end; k++) ring.push([points[2 * k], points[2 * k + 1]]);
    rings.push(ring);
  }
  return { rings, tiny, discarded };
}
