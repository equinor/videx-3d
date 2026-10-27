import { transfer } from 'comlink';
import type { SceneryReliefResponse } from '../components/Scenery/scenery-defs';
import type { ReadonlyStore, ReliefMeta, SurfaceMeta } from '../sdk';
import { resampleReliefGeographic } from '../sdk/geometries/relief-grid';
import {
  ReliefReader,
  reliefLayerWeight,
} from '../sdk/geometries/relief-tiles';

// One reader per store, for the layers' edges: it keeps what it read between layers.
const readers = new WeakMap<ReadonlyStore, ReliefReader>();

/**
 * A relief — a `relief-meta` record and its `relief-values` — resampled onto a grid of
 * longitude and latitude over all of it, as a `SceneryStage` draws its overview past its
 * tiles, wherever on the Earth (see `resampleReliefGeographic`). The grid is read from the
 * store where the generator runs, so only the texture's levels reach the caller.
 *
 * @param id the relief
 * @param options the most texels along either side (default 4096); and, for one of a
 *   relief's layers, its `feather` (`ReliefLayer.feather`, metres): the grid's coverage is
 *   then faded in from where its data ends, so the overview merges its layers as the tiles do
 */
export async function generateSceneryRelief(
  this: ReadonlyStore,
  id: string,
  options?: { maxSize?: number; feather?: number },
): Promise<SceneryReliefResponse> {
  const meta = await this.get<ReliefMeta>('relief-meta', id);
  if (!meta) return null;
  const values = await this.get<Float32Array>('relief-values', id, {
    level: 0,
    first: [0, 0],
    count: meta.grid.size,
  });
  if (!values) return null;
  let weightAt: ReturnType<typeof reliefLayerWeight> | undefined;
  const feather = options?.feather ?? 0;
  if (feather > 0) {
    let reader = readers.get(this);
    if (!reader) {
      reader = new ReliefReader((dataType, key, args) =>
        this.get(dataType, key, args),
      );
      readers.set(this, reader);
    }
    const layer = await reader.layer(id, null);
    if (layer) weightAt = reliefLayerWeight(layer.edge, feather);
  }
  const grid = resampleReliefGeographic(values, asSurfaceMeta(meta), {
    maxSize: options?.maxSize,
    weightAt,
  });
  if (!grid) return null;
  return transfer(
    grid,
    grid.levels.map(level => level.data.buffer as ArrayBuffer),
  );
}

// The record `resampleRelief` reads: the grid as a surface header.
function asSurfaceMeta(meta: ReliefMeta): SurfaceMeta {
  const [nx, ny] = meta.grid.size;
  const [xori, yori] = meta.grid.origin;
  const [xinc, yinc] = meta.grid.cell;
  return {
    id: meta.id,
    name: meta.name,
    projection: meta.crs,
    min: meta.min,
    max: meta.max,
    displayMin: meta.min,
    displayMax: meta.max,
    color: '#808080',
    visualization: 'relief',
    header: {
      nx,
      ny,
      xori,
      yori,
      xinc,
      yinc,
      xmax: xori + (nx - 1) * xinc,
      ymax: yori + (ny - 1) * yinc,
      rot: meta.grid.rotation ?? 0,
    },
  };
}
