import { collectStackCandidates } from '../../sdk/geometries/surface-stack-candidates';
import type { RefineRequest, RefineResponse } from './stack-worker-types';

/**
 * Internal stack refinement worker: runs the greedy TIN refinement for ONE layer
 * of a shared tessellation's common grid, entirely off the data store and free of
 * three.js. Created and pooled by `StackWorkerPool` inside the chunk generator, so
 * the per-layer refinement — the expensive part of the build, and fully
 * independent between layers — runs in parallel. Ships inlined in the library
 * bundle (`?worker&inline`), so host apps need no worker configuration.
 */
const workerSelf: {
  onmessage: ((e: MessageEvent<RefineRequest>) => void) | null;
  postMessage: (message: RefineResponse, transfer: Transferable[]) => void;
} = self as unknown as {
  onmessage: ((e: MessageEvent<RefineRequest>) => void) | null;
  postMessage: (message: RefineResponse, transfer: Transferable[]) => void;
};

workerSelf.onmessage = e => {
  const { id, channel, nx, maxError } = e.data;
  const start = performance.now();
  const nodes = collectStackCandidates(channel, nx, maxError);
  workerSelf.postMessage({ id, nodes, refineMs: performance.now() - start }, [
    nodes.buffer,
  ]);
};
