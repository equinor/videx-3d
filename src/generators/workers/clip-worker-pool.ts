import ClipWorker from './clip-surface.worker?worker&inline';
import type { ClipRequest, ClipResponse } from './clip-worker-types';

type PendingTask = {
  req: ClipRequest;
  transfer: Transferable[];
  resolve: (r: ClipResponse) => void;
  reject: (e: unknown) => void;
};

/**
 * A small fixed-size pool of inlined clip workers with a task queue. Each worker
 * processes one {@link ClipRequest} at a time; queued tasks dispatch to the next
 * free worker (round-robin via an idle list). Used internally by the chunk
 * generator to run the independent per-surface clips in parallel.
 */
export class ClipWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: PendingTask[] = [];
  private active = new Map<Worker, PendingTask>();

  constructor(size: number) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const w = new ClipWorker();
      w.onmessage = (e: MessageEvent<ClipResponse>) => {
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

  run(req: ClipRequest, transfer: Transferable[]): Promise<ClipResponse> {
    return new Promise<ClipResponse>((resolve, reject) => {
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

let poolInstance: ClipWorkerPool | null = null;
let poolTried = false;

/**
 * Lazily create (once) the shared clip worker pool, sized from
 * `navigator.hardwareConcurrency` (capped). Returns `null` when workers are
 * unavailable (e.g. nested workers unsupported), so callers fall back to a serial
 * clip on the current thread.
 */
export function getClipPool(): ClipWorkerPool | null {
  if (poolTried) return poolInstance;
  poolTried = true;
  if (typeof Worker === 'undefined') return null;
  try {
    const cores =
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const size = Math.max(1, Math.min(cores - 1, 8));
    poolInstance = new ClipWorkerPool(size);
  } catch {
    poolInstance = null;
  }
  return poolInstance;
}
