import { ReadonlyStore } from '../sdk';
import { stackContextStats } from './surface-stack-context';
import { stackPoolSize } from './workers/stack-worker-pool';

/**
 * Identity of the scope this module was loaded into, so a DUPLICATED or restarted
 * worker is visible: a fresh id (or an uptime that just reset) means the previous
 * one was orphaned rather than replaced.
 */
const scopeId = Math.random().toString(36).slice(2, 8);
const loadedAt = performance.now();

type ChromeMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

/**
 * What the generator scope currently holds.
 * @expand
 */
export type GeneratorStats = {
  /** identity of the generator scope (changes when the worker is recreated) */
  scopeId: string;
  /** milliseconds since this scope was loaded */
  uptimeMs: number;
  /** the cached column, or `null` when none is held */
  columnKey: string | null;
  /** bytes the cached column keeps resident */
  columnBytes: number;
  /** bytes held by the cached refinement candidates */
  candidateBytes: number;
  /** columns built since this scope was loaded */
  columnsBuilt: number;
  /** column builds running right now */
  columnsInFlight: number;
  /** workers in the internal refinement pool (0 = not created) */
  poolSize: number;
  /**
   * V8 heap of this scope, when the engine exposes it. ⚠️ `performance.memory` is
   * a non-standard Chrome API and is NOT available in every worker scope, so
   * treat `undefined` as "unknown", not "zero".
   */
  heapUsed?: number;
  heapTotal?: number;
  heapLimit?: number;
};

/**
 * Report what the generators are holding — the resolved column, its refinement,
 * the worker pool, and the scope's own heap where the engine exposes it.
 *
 * Meant for a diagnostics panel: the column is by far the largest allocation the
 * library makes, and a steadily climbing `columnsBuilt` with a `columnBytes` that
 * never falls is what a leak looks like from the outside.
 *
 * @group Generators
 */
export async function generatorStats(
  this: ReadonlyStore,
): Promise<GeneratorStats> {
  const memory = (performance as Performance & { memory?: ChromeMemory })
    .memory;
  return {
    scopeId,
    uptimeMs: performance.now() - loadedAt,
    ...stackContextStats(),
    poolSize: stackPoolSize(),
    heapUsed: memory?.usedJSHeapSize,
    heapTotal: memory?.totalJSHeapSize,
    heapLimit: memory?.jsHeapSizeLimit,
  };
}
