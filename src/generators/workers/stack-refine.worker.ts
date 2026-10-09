import { collectStackCandidates } from '../../sdk/geometries/surface-stack-candidates';
import { resampleStackLayer } from '../../sdk/geometries/surface-stack-resample';
import { createWellboreOutlineCoordinates } from '../../sdk/geometries/wellbore-outline';
import type { Vec2 } from '../../sdk/types/common';
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
 * bundle (`?worker&inline`), so host apps need no worker configuration. It also
 * rasterizes wellbore outlines (`'outline'`), which are independent per chunk.
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
  if (e.data.kind === 'outline') {
    const { id, paths, options } = e.data;
    const { coordinates, metrics } = createWellboreOutlineCoordinates(
      paths.map(({ points, radius }) => ({
        points: unflatten(points),
        radius,
      })),
      options,
    );
    workerSelf.postMessage(
      {
        kind: 'outline',
        id,
        coordinates,
        metrics,
        outlineMs: performance.now() - start,
      },
      [],
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

function unflatten(flat: Float64Array): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    points.push([flat[i], flat[i + 1]]);
  return points;
}
