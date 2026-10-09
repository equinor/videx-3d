import pLimit from 'p-limit';
import { collectStackCandidates } from '../../sdk/geometries/surface-stack-candidates';
import {
  resampleStackLayer,
  StackGridPlacement,
  StackLayerResample,
  StackReferencePlan,
} from '../../sdk/geometries/surface-stack-resample';
import {
  createWellboreOutlineCoordinates,
  WellboreOutlineCoordinates,
  WellborePath,
} from '../../sdk/geometries/wellbore-outline';
// oxlint-disable-next-line import/default -- Vite virtual module; the `?worker&inline` query is resolved by the bundler, not by the linter's resolver.
import RefineWorker from './stack-refine.worker?worker&inline';
import type {
  OutlineRequest,
  OutlineResponse,
  RefineResponse,
  ResampleResponse,
  StackWorkerRequest,
  StackWorkerResponse,
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
 * @returns the per-layer candidate node lists, and the pool size used (0 = serial)
 */
export async function refineStackChannels(
  channels: Float32Array[],
  nx: number,
  maxError: number,
): Promise<{ candidates: Uint32Array[]; poolSize: number }> {
  const pool = getStackPool();
  if (!pool) {
    return {
      candidates: channels.map(channel =>
        collectStackCandidates(channel, nx, maxError),
      ),
      poolSize: 0,
    };
  }
  // ⚠️ The copy is made INSIDE the limited task, not while mapping: a whole
  // column's worth of copies allocated up front is hundreds of MB sitting in the
  // pool's queue until a worker takes each one.
  const limit = pLimit(pool.size);
  const candidates = await Promise.all(
    channels.map(channel =>
      limit(async () => {
        const copy = channel.slice();
        const res = (await pool.run(
          { kind: 'refine', id: taskId++, channel: copy, nx, maxError },
          [copy.buffer],
        )) as RefineResponse;
        return res.nodes;
      }),
    ),
  );
  return { candidates, poolSize: pool.size };
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
