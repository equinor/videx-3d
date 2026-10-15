import { buildStackCapArrays } from '../../sdk/geometries/stack-cap-arrays';
import {
  stackTileOutputBuffers,
  tessellateStackTile,
} from '../../sdk/geometries/stack-tiles';
import { collectStackCandidateLevels } from '../../sdk/geometries/surface-stack-candidates';
import { sampleStackOwnLayer } from '../../sdk/geometries/surface-stack-own';
import { resampleStackLayer } from '../../sdk/geometries/surface-stack-resample';
import { scanThicknessLoops } from '../../sdk/geometries/surface-stack-terminations';
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
 * rasterizes wellbore outlines (`'outline'`), which are independent per chunk, and
 * scans each layer pair's termination loops (`'terminations'`), and builds each
 * cap's normals, index and bounds (`'cap'`), and triangulates the tiles of a
 * tiled tessellation (`'tile'`), and samples each layer from its own surface
 * (`'own'`).
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
  if (e.data.kind === 'terminations') {
    const { id, above, below, nx, threshold } = e.data;
    const loops = scanThicknessLoops(above, below, nx, threshold);
    workerSelf.postMessage({ kind: 'terminations', id, loops }, [
      loops.xs.buffer,
      loops.ys.buffer,
      loops.na.buffer,
      loops.nb.buffer,
      loops.nt.buffer,
      loops.loops.buffer,
      loops.offsets.buffer,
    ]);
    return;
  }
  if (e.data.kind === 'cap') {
    const { id, input } = e.data;
    const arrays = buildStackCapArrays(input);
    const transfer: Transferable[] = [arrays.normal.buffer];
    if (arrays.normalMap) transfer.push(arrays.normalMap.data.buffer);
    if (arrays.index) transfer.push(arrays.index.buffer);
    if (arrays.patchIndex) transfer.push(arrays.patchIndex.buffer);
    workerSelf.postMessage({ kind: 'cap', id, arrays }, transfer);
    return;
  }
  if (e.data.kind === 'tile') {
    const { id, tile } = e.data;
    const output = tessellateStackTile(tile);
    workerSelf.postMessage(
      { kind: 'tile', id, output },
      stackTileOutputBuffers(output),
    );
    return;
  }
  if (e.data.kind === 'own') {
    const { id, job } = e.data;
    const layer = sampleStackOwnLayer(job);
    const transfer: Transferable[] = [layer.grid.buffer, layer.y.buffer];
    if (layer.normals) transfer.push(layer.normals.buffer);
    workerSelf.postMessage({ kind: 'own', id, layer }, transfer);
    return;
  }
  const { id, channel, nx, maxError } = e.data;
  const { nodes, errors, triangles } = collectStackCandidateLevels(
    channel,
    nx,
    maxError,
  );
  workerSelf.postMessage(
    {
      kind: 'refine',
      id,
      nodes,
      errors,
      triangles,
      refineMs: performance.now() - start,
    },
    [nodes.buffer, errors.buffer, triangles.buffer],
  );
};

function unflatten(flat: Float64Array): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    points.push([flat[i], flat[i + 1]]);
  return points;
}
