import { ReadonlyStore } from '../sdk';
import { clearGeneratorClaims } from './generator-supersede';
import { clearStackContext } from './surface-stack-context';
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
 * @group Generators
 */
export async function releaseStackResources(
  this: ReadonlyStore,
  options?: StackReleaseOptions,
): Promise<null> {
  clearStackContext();
  clearGeneratorClaims();
  if (options?.pool) disposeStackPool();
  return null;
}
