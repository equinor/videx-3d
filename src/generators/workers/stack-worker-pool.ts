import { collectStackCandidates } from '../../sdk/geometries/surface-stack-candidates';
// oxlint-disable-next-line import/default -- Vite virtual module; the `?worker&inline` query is resolved by the bundler, not by the linter's resolver.
import RefineWorker from './stack-refine.worker?worker&inline';
import type { RefineRequest, RefineResponse } from './stack-worker-types';

type PendingTask = {
  req: RefineRequest;
  transfer: Transferable[];
  resolve: (r: RefineResponse) => void;
  reject: (e: unknown) => void;
};

/**
 * A small fixed-size pool of inlined stack workers with a task queue. Each worker
 * refines one layer of a shared tessellation's common grid at a time; queued tasks
 * dispatch to the next free worker (round-robin via an idle list). Used internally
 * by the chunk generator to run the independent per-layer refinements in parallel.
 */
export class StackWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: PendingTask[] = [];
  private active = new Map<Worker, PendingTask>();

  constructor(size: number) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const w = new RefineWorker();
      w.onmessage = (e: MessageEvent<RefineResponse>) => {
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

  /** Refine one layer of a shared tessellation's common grid. */
  refine(
    req: RefineRequest,
    transfer: Transferable[],
  ): Promise<RefineResponse> {
    return new Promise<RefineResponse>((resolve, reject) => {
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
 * unavailable (e.g. nested workers unsupported), so callers fall back to refining
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
  let taskId = 0;
  const candidates = await Promise.all(
    channels.map(async channel => {
      const copy = channel.slice();
      const res = await pool.refine(
        { id: taskId++, channel: copy, nx, maxError },
        [copy.buffer],
      );
      return res.nodes;
    }),
  );
  return { candidates, poolSize: pool.size };
}
