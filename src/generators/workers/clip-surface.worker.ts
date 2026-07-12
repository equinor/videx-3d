import { sampleValidGrid } from '../../sdk/geometries/grid-sampling';
import type { PlanarPolygonGeometry } from '../../sdk/geometries/planar-geometry';
import {
  clipSurfaceRaw,
  surfaceWorldToGrid,
} from '../../sdk/geometries/surface-clip';
import type { ClipRequest, ClipResponse } from './clip-worker-types';

/**
 * Internal clip worker: runs the (three.js-free) {@link clipSurfaceRaw} for ONE
 * layer plus its rim sampling, entirely off the data store. Created and pooled by
 * `ClipWorkerPool` inside the chunk generator, so the expensive per-surface clip
 * runs in parallel. Ships inlined in the library bundle (`?worker&inline`), so host
 * apps need no worker configuration.
 */
const workerSelf: {
  onmessage: ((e: MessageEvent<ClipRequest>) => void) | null;
  postMessage: (message: ClipResponse, transfer: Transferable[]) => void;
} = self as unknown as {
  onmessage: ((e: MessageEvent<ClipRequest>) => void) | null;
  postMessage: (message: ClipResponse, transfer: Transferable[]) => void;
};

workerSelf.onmessage = e => {
  const {
    id,
    values,
    header,
    referenceDepth,
    worldPosition,
    polygonCoordinates,
    rings,
    maxError,
    nullValue,
  } = e.data;

  // clipSurfaceRaw only reads `polygon.coordinates`; avoid importing the
  // PlanarPolygonGeometry class (it pulls three.js) by passing a plain shape.
  const polygon = {
    coordinates: polygonCoordinates,
  } as unknown as PlanarPolygonGeometry;

  const clipStart = performance.now();
  const raw = clipSurfaceRaw(values, header, {
    polygon,
    referenceDepth,
    worldPosition,
    drape: false,
    cutHoles: false,
    maxError,
    nullValue,
  });
  const clipMs = performance.now() - clipStart;

  let positions: Float32Array | null = null;
  let uvs: Float32Array | null = null;
  let indices: Uint32Array | null = null;
  if (raw) {
    positions = raw.positions;
    uvs = raw.uvs;
    indices = raw.indices;
    // Bake the UtmPosition offset into the scene frame (matches the
    // `geo.translate(worldPosition)` step in clipChunkLayer).
    const wpx = worldPosition[0];
    const wpz = worldPosition[1];
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += wpx;
      positions[i + 2] += wpz;
    }
  }

  // Rim sampling (three.js-free) — identical to clipChunkLayer's rim loop.
  const isInvalid = (v: number) => v === nullValue || v < 0;
  const toGrid = surfaceWorldToGrid(header, worldPosition);
  const { nx, ny } = header;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isInvalid(v)) {
      sum += v;
      cnt++;
    }
  }
  const fill = cnt > 0 ? sum / cnt : referenceDepth;
  const rimY = rings.map(ring =>
    ring.map(([sx, sz]) => {
      const [col, row] = toGrid(sx, sz);
      const v = sampleValidGrid(values, nx, ny, col, row, isInvalid, fill);
      return v - referenceDepth;
    }),
  );

  const transferList: Transferable[] = [];
  if (positions) transferList.push(positions.buffer);
  if (uvs) transferList.push(uvs.buffer);
  if (indices) transferList.push(indices.buffer);

  workerSelf.postMessage(
    {
      id,
      positions,
      uvs,
      indices,
      rimY,
      clipMs,
      nodes: values.length,
      holes: values.length - cnt,
    },
    transferList,
  );
};
