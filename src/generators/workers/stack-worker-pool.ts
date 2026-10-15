import pLimit from 'p-limit';
import {
  buildStackCapArrays,
  StackCapArrays,
  StackCapInput,
} from '../../sdk/geometries/stack-cap-arrays';
import {
  stackTileInputBuffers,
  StackTileInput,
  StackTileOutput,
  tessellateStackTile,
} from '../../sdk/geometries/stack-tiles';
import { collectStackCandidateLevels } from '../../sdk/geometries/surface-stack-candidates';
import {
  sampleStackOwnLayer,
  StackOwnLayer,
  StackOwnLayerJob,
} from '../../sdk/geometries/surface-stack-own';
import {
  resampleStackLayer,
  StackGridPlacement,
  StackLayerResample,
  StackReferencePlan,
} from '../../sdk/geometries/surface-stack-resample';
import {
  scanThicknessLoops,
  ThicknessLoops,
} from '../../sdk/geometries/surface-stack-terminations';
import {
  createWellboreOutlineCoordinates,
  WellboreOutlineCoordinates,
  WellborePath,
} from '../../sdk/geometries/wellbore-outline';
// oxlint-disable-next-line import/default -- Vite virtual module; the `?worker&inline` query is resolved by the bundler, not by the linter's resolver.
import RefineWorker from './stack-refine.worker?worker&inline';
import type {
  CapResponse,
  OutlineRequest,
  OutlineResponse,
  OwnResponse,
  RefineResponse,
  ResampleResponse,
  StackWorkerRequest,
  StackWorkerResponse,
  TerminationsResponse,
  TileResponse,
} from './stack-worker-types';

type PendingTask = {
  req: StackWorkerRequest;
  transfer: Transferable[];
  resolve: (r: StackWorkerResponse) => void;
  reject: (e: unknown) => void;
};

/**
 * A small fixed-size pool of inlined stack workers with a task queue. Each worker
 * handles one per-layer job of a shared tessellation at a time — resampling a
 * layer onto the common grid, or refining it — and queued tasks dispatch to the
 * next free worker (round-robin via an idle list). Used internally by the chunk
 * generator to run those independent per-layer jobs in parallel.
 */
export class StackWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: PendingTask[] = [];
  private active = new Map<Worker, PendingTask>();

  constructor(size: number) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const w = new RefineWorker();
      w.onmessage = (e: MessageEvent<StackWorkerResponse>) => {
        const task = this.active.get(w);
        this.active.delete(w);
        this.idle.push(w);
        task?.resolve(e.data);
        this.pump();
      };
      w.onerror = (err: ErrorEvent) => {
        const task = this.active.get(w);
        this.active.delete(w);
        this.idle.push(w);
        task?.reject(err);
        this.pump();
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Run one per-layer task on the next free worker. */
  run(
    req: StackWorkerRequest,
    transfer: Transferable[],
  ): Promise<StackWorkerResponse> {
    return new Promise<StackWorkerResponse>((resolve, reject) => {
      this.queue.push({ req, transfer, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const task = this.queue.shift()!;
      this.active.set(w, task);
      w.postMessage(task.req, task.transfer);
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.active.clear();
  }
}

let poolInstance: StackWorkerPool | null = null;
let poolTried = false;

/**
 * Lazily create (once) the shared stack worker pool, sized from
 * `navigator.hardwareConcurrency` (capped). Returns `null` when workers are
 * unavailable (e.g. nested workers unsupported), so callers fall back to working
 * on the current thread.
 */
export function getStackPool(): StackWorkerPool | null {
  if (poolTried) return poolInstance;
  poolTried = true;
  if (typeof Worker === 'undefined') return null;
  try {
    const cores =
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const size = Math.max(1, Math.min(cores - 1, 8));
    poolInstance = new StackWorkerPool(size);
  } catch {
    poolInstance = null;
  }
  return poolInstance;
}

/**
 * Terminate the shared pool. The next caller gets a fresh one, so this is a
 * release rather than a shutdown — use it when the generators are expected to be
 * idle for a while (the last chunk stack unmounted, a test finished).
 *
 * @group Generators
 */
export function disposeStackPool(): void {
  poolInstance?.dispose();
  poolInstance = null;
  poolTried = false;
}

/** Workers in the shared pool, WITHOUT creating it (0 = not created). */
export function stackPoolSize(): number {
  return poolInstance?.size ?? 0;
}

let taskId = 0;

/**
 * Put ONE layer onto the stack's common grid — on the pool when available, on the
 * current thread otherwise.
 *
 * ⚠️⚠️ `values` is TRANSFERRED, so the caller's array is detached and must not be
 * read again. That is deliberate: nothing downstream of the resample asks a layer
 * for its samples, only for its placement.
 *
 * @group Generators
 */
export async function resampleStackChannel(
  plan: StackReferencePlan,
  placement: StackGridPlacement,
  values: Float32Array,
  referenceDepth: number,
  nullValue = -1,
): Promise<StackLayerResample> {
  const pool = getStackPool();
  if (!pool) {
    return resampleStackLayer(
      plan,
      { ...placement, values },
      referenceDepth,
      nullValue,
    );
  }
  const res = (await pool.run(
    {
      kind: 'resample',
      id: taskId++,
      plan,
      placement,
      values,
      referenceDepth,
      nullValue,
    },
    [values.buffer],
  )) as ResampleResponse;
  return { channel: res.channel, mask: res.mask, empty: res.empty };
}

/**
 * Refine every layer of a common grid — across the worker pool when available, on
 * the current thread otherwise.
 *
 * The channels are still needed by the caller afterwards (to sample the heights),
 * so each worker gets a transferred COPY rather than the channel itself.
 *
 * @param onProgress called with the layers done so far, as each finishes
 * @returns the per-layer candidate node lists with each node's level (see
 *   `collectStackCandidateLevels`), and the pool size used (0 = serial)
 */
export async function refineStackChannels(
  channels: Float32Array[],
  nx: number,
  maxError: number,
  onProgress?: (done: number, total: number) => void,
): Promise<StackCandidates> {
  const total = channels.length;
  let done = 0;
  const pool = getStackPool();
  if (!pool) {
    const levels = channels.map(channel => {
      const level = collectStackCandidateLevels(channel, nx, maxError);
      onProgress?.(++done, total);
      return level;
    });
    return {
      candidates: levels.map(l => l.nodes),
      errors: levels.map(l => l.errors),
      triangles: levels.map(l => l.triangles),
      poolSize: 0,
    };
  }
  // ⚠️ The copy is made INSIDE the limited task, not while mapping: a whole
  // column's worth of copies allocated up front is hundreds of MB sitting in the
  // pool's queue until a worker takes each one.
  const limit = pLimit(pool.size);
  const results = await Promise.all(
    channels.map(channel =>
      limit(async () => {
        const copy = channel.slice();
        const res = (await pool.run(
          { kind: 'refine', id: taskId++, channel: copy, nx, maxError },
          [copy.buffer],
        )) as RefineResponse;
        onProgress?.(++done, total);
        return res;
      }),
    ),
  );
  return {
    candidates: results.map(r => r.nodes),
    errors: results.map(r => r.errors),
    triangles: results.map(r => r.triangles),
    poolSize: pool.size,
  };
}

/** Per-layer refinement candidates (see {@link refineStackChannels}). */
export type StackCandidates = {
  candidates: Uint32Array[];
  /** per layer, per candidate, its level (see `collectStackCandidateLevels`) */
  errors: Float32Array[];
  /** per layer, its own TIN over `candidates` (see `collectStackCandidateLevels`) */
  triangles: (Uint16Array | Uint32Array)[];
  poolSize: number;
};

/**
 * Scan every adjacent pair's termination loops (see `scanThicknessLoops`) —
 * across the worker pool when available, on the current thread otherwise. Each
 * pair needs only its own two channels, so each worker gets copies of those.
 *
 * @param onProgress called with the pairs done so far, as each finishes
 * @returns per adjacent pair, aligned with `channels` (pair `i` is `i, i + 1`)
 */
export async function scanStackTerminations(
  channels: Float32Array[],
  nx: number,
  threshold: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ThicknessLoops[]> {
  const pairs = channels.slice(1).map((below, i) => [channels[i], below]);
  const total = pairs.length;
  let done = 0;
  const pool = getStackPool();
  if (!pool) {
    return pairs.map(([above, below]) => {
      const loops = scanThicknessLoops(above, below, nx, threshold);
      onProgress?.(++done, total);
      return loops;
    });
  }
  // Copies made inside the limited task, as in `refineStackChannels`.
  const limit = pLimit(pool.size);
  return Promise.all(
    pairs.map(([above, below]) =>
      limit(async () => {
        const a = above.slice();
        const b = below.slice();
        const res = (await pool.run(
          {
            kind: 'terminations',
            id: taskId++,
            above: a,
            below: b,
            nx,
            threshold,
          },
          [a.buffer, b.buffer],
        )) as TerminationsResponse;
        onProgress?.(++done, total);
        return res.loops;
      }),
    ),
  );
}

/**
 * Sample each layer from its own surface (see `sampleStackOwnLayer`) — across the
 * worker pool when available, on the current thread otherwise. `onLayer` hears
 * each one as it finishes, in ANY order; nothing once `isStale` says so.
 */
export async function sampleStackOwnLayers(
  jobs: StackOwnLayerJob[],
  onLayer: (layer: number, sampled: StackOwnLayer) => void,
  isStale: () => boolean = () => false,
): Promise<void> {
  const pool = getStackPool();
  if (!pool) {
    jobs.forEach((job, i) => {
      if (!isStale()) onLayer(i, sampleStackOwnLayer(job));
    });
    return;
  }
  // Copies made inside the limited task, as in `refineStackChannels`: the build
  // reads the channels and coords on, and the TINs belong to the column.
  const limit = pLimit(pool.size);
  await Promise.all(
    jobs.map((job, i) =>
      limit(async () => {
        if (isStale()) return;
        const input: StackOwnLayerJob = {
          ...job,
          coords: job.coords.slice(),
          channel: job.channel.slice(),
          nodes: job.nodes?.slice() ?? null,
          triangles: job.triangles?.slice() ?? null,
          exact: job.exact?.slice() ?? null,
        };
        const transfer = [
          input.coords,
          input.channel,
          input.nodes,
          input.triangles,
          input.exact,
        ].flatMap(array =>
          array && array.byteLength > 0 ? [array.buffer as ArrayBuffer] : [],
        );
        const res = (await pool.run(
          { kind: 'own', id: taskId++, job: input },
          transfer,
        )) as OwnResponse;
        if (!isStale()) onLayer(i, res.layer);
      }),
    ),
  );
}

/**
 * Build every cap of a stack (see `buildStackCapArrays`) — across the worker pool
 * when available, on the current thread otherwise. `onCap` hears each one as it
 * finishes, in ANY order; a `null` job, and every job once `isStale` says so, gets
 * `null`.
 */
export async function buildStackCaps(
  jobs: (StackCapInput | null)[],
  onCap: (layer: number, arrays: StackCapArrays | null) => void,
  isStale: () => boolean = () => false,
): Promise<void> {
  const pool = getStackPool();
  if (!pool) {
    jobs.forEach((job, i) =>
      onCap(i, job && !isStale() ? buildStackCapArrays(job) : null),
    );
    return;
  }
  // Copies made inside the limited task, as in `refineStackChannels`, and the
  // shared index only for a cap that draws it.
  const limit = pLimit(pool.size);
  await Promise.all(
    jobs.map((job, i) =>
      limit(async () => {
        if (!job || isStale()) return onCap(i, null);
        const input: StackCapInput = {
          positionsXZ: job.positionsXZ.slice(),
          y: job.y.slice(),
          shared: job.own || job.peel ? new Uint32Array(0) : job.shared.slice(),
          own: job.own?.slice() ?? null,
          peel: job.peel?.slice() ?? null,
          levels: job.levels?.map(level => level.slice()) ?? null,
          toGrid: job.toGrid ?? null,
          // Not read again here: it comes back as the cap's `normal`.
          normals: job.normals ?? null,
        };
        const transfer = [
          input.positionsXZ,
          input.y,
          input.shared,
          input.own,
          input.peel,
          input.normals,
          ...(input.levels ?? []),
        ].flatMap(array =>
          array && array.byteLength > 0 ? [array.buffer as ArrayBuffer] : [],
        );
        const res = (await pool.run(
          { kind: 'cap', id: taskId++, input },
          transfer,
        )) as CapResponse;
        onCap(i, res.arrays);
      }),
    ),
  );
}

/**
 * Triangulate every tile of a tiled stack tessellation (see
 * `tessellateStackTile`) — across the worker pool when there is more than one,
 * on the current thread otherwise. `null` once `isStale` says so.
 *
 * ⚠️ Each tile's arrays are TRANSFERRED, so `tiles` must not be read again.
 *
 * @param onProgress called with the tiles done so far, as each finishes
 */
export async function tessellateStackTiles(
  tiles: StackTileInput[],
  isStale: () => boolean = () => false,
  onProgress?: (done: number, total: number) => void,
): Promise<StackTileOutput[] | null> {
  const total = tiles.length;
  let done = 0;
  const pool = getStackPool();
  if (!pool || tiles.length < 2) {
    return tiles.map(tile => {
      const output = tessellateStackTile(tile);
      onProgress?.(++done, total);
      return output;
    });
  }
  const work = tiles.map(
    tile =>
      tile.seams.length +
      tile.nodes.length +
      tile.rim.reduce((sum, c) => sum + c.points.length, 0) +
      tile.chains.reduce((sum, c) => sum + c.points.length, 0),
  );
  // Largest first, so the slowest tile is not the last to start.
  const order = tiles.map((_, t) => t).sort((a, b) => work[b] - work[a]);
  const outputs: StackTileOutput[] = new Array(tiles.length);
  const limit = pLimit(pool.size);
  await Promise.all(
    order.map(t =>
      limit(async () => {
        if (isStale()) return;
        const tile = tiles[t];
        const res = (await pool.run(
          { kind: 'tile', id: taskId++, tile },
          stackTileInputBuffers(tile),
        )) as TileResponse;
        outputs[t] = res.output;
        onProgress?.(++done, total);
      }),
    ),
  );
  return isStale() ? null : outputs;
}

/**
 * Buffer and contour trajectory runs into a wellbore outline — on the pool when
 * available, on the current thread otherwise. Only the runs cross to the worker.
 *
 * @group Generators
 */
export async function buildOutlineCoordinates(
  paths: WellborePath[],
  options: OutlineRequest['options'],
): Promise<WellboreOutlineCoordinates> {
  const pool = getStackPool();
  if (!pool) return createWellboreOutlineCoordinates(paths, options);
  const flat = paths.map(({ points, radius }) => {
    const out = new Float64Array(points.length * 2);
    points.forEach(([x, z], i) => {
      out[i * 2] = x;
      out[i * 2 + 1] = z;
    });
    return { points: out, radius };
  });
  const res = (await pool.run(
    { kind: 'outline', id: taskId++, paths: flat, options },
    flat.map(p => p.points.buffer),
  )) as OutlineResponse;
  return { coordinates: res.coordinates, metrics: res.metrics };
}
