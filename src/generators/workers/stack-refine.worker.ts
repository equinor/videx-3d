import { collectStackCandidates } from '../../sdk/geometries/surface-stack-candidates';
import { resampleStackLayer } from '../../sdk/geometries/surface-stack-resample';
import type {
  StackWorkerRequest,
  StackWorkerResponse,
} from './stack-worker-types';

/**
 * Internal stack worker: does the two per-layer jobs of a shared tessellation —
 * putting a layer's grid onto the common grid, and running the greedy TIN
 * refinement on it — entirely off the data store and free of three.js. Both are
 * fully independent between layers, which is what makes them poolable. Created by
 * `StackWorkerPool` inside the chunk generator and shipped inlined in the library
 * bundle (`?worker&inline`), so host apps need no worker configuration.
 */
const workerSelf: {
  onmessage: ((e: MessageEvent<StackWorkerRequest>) => void) | null;
  postMessage: (message: StackWorkerResponse, transfer: Transferable[]) => void;
} = self as unknown as {
  onmessage: ((e: MessageEvent<StackWorkerRequest>) => void) | null;
  postMessage: (message: StackWorkerResponse, transfer: Transferable[]) => void;
};

workerSelf.onmessage = e => {
  const start = performance.now();
  if (e.data.kind === 'resample') {
    const { id, plan, placement, values, referenceDepth, nullValue } = e.data;
    const { channel, mask, empty } = resampleStackLayer(
      plan,
      { ...placement, values },
      referenceDepth,
      nullValue,
    );
    workerSelf.postMessage(
      {
        kind: 'resample',
        id,
        channel,
        mask,
        empty,
        resampleMs: performance.now() - start,
      },
      [channel.buffer, mask.buffer],
    );
    return;
  }
  const { id, channel, nx, maxError } = e.data;
  const nodes = collectStackCandidates(channel, nx, maxError);
  workerSelf.postMessage(
    { kind: 'refine', id, nodes, refineMs: performance.now() - start },
    [nodes.buffer],
  );
};
