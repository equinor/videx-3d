import { ReadonlyStore } from '../sdk';
import { clearGeneratorClaims } from './generator-supersede';
import {
  acquireStackContext,
  clearStackContext,
  releaseStackContext,
} from './surface-stack-context';
import { disposeStackPool } from './workers/stack-worker-pool';

/**
 * What {@link releaseStackResources} should let go of.
 * @expand
 */
export type StackReleaseOptions = {
  /**
   * Also terminate the internal refinement worker pool. Off by default: the pool
   * is idle between builds and costs a thread each, while the next build would
   * have to spawn it again.
   *
   * ⚠️ Terminating it abandons any refinement still in flight, so only ask for
   * this when the generators are known to be idle.
   */
  pool?: boolean;
  /**
   * Stable id of the calling `ChunkStack`, so releases are reference-counted: with
   * two stacks in one scene, unmounting one must NOT tear down the other's cached
   * column. Omit it and the release is unconditional (the historical behaviour).
   */
  stackId?: string;
  /**
   * Register the stack as live instead of releasing it. Called on mount so the
   * matching release can tell whether it is the last stack going away.
   */
  acquire?: boolean;
};

/**
 * Release what the chunk generators hold between builds — the resolved column
 * (one channel per layer over the whole reference grid, plus masks and the seal's
 * inferred weights) and its refinement candidates.
 *
 * Those caches exist so that every chunk cut from a column shares one fetch,
 * resample and resolve, which means they are keyed to the column rather than to
 * any component and nothing collects them on their own. At the default node
 * budget they are the largest thing the worker holds by an order of magnitude, so
 * a host that unmounts its chunks should invoke this — `ChunkStack` does it for
 * you.
 *
 * ⭐ Reference-counted by `stackId`: the caches are only cleared once the LAST
 * live stack releases, so a scene with two `ChunkStack`s does not have one tear
 * down the other's column.
 *
 * @group Generators
 */
export async function releaseStackResources(
  this: ReadonlyStore,
  options?: StackReleaseOptions,
): Promise<null> {
  if (options?.acquire) {
    if (options.stackId) acquireStackContext(options.stackId);
    return null;
  }
  // Only tear the caches down when the last live stack has gone.
  const last = options?.stackId ? releaseStackContext(options.stackId) : true;
  if (!last) return null;
  clearStackContext();
  clearGeneratorClaims();
  if (options?.pool) disposeStackPool();
  return null;
}
