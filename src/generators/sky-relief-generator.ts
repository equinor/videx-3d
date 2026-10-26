import { transfer } from 'comlink';
import type { SkyReliefResponse } from '../components/Sky/sky-defs';
import type { ReadonlyStore, ReliefMeta, SurfaceMeta } from '../sdk';
import { resampleReliefGeographic } from '../sdk/geometries/relief-grid';

/**
 * A relief — a `relief-meta` record and its `relief-values` — resampled onto a grid of
 * longitude and latitude over all of it, as a `SkyBoxStage` draws its overview past its
 * tiles, wherever on the Earth (see `resampleReliefGeographic`). The grid is read from the
 * store where the generator runs, so only the texture's levels reach the caller.
 *
 * @param id the relief
 * @param options the most texels along either side (default 4096)
 */
export async function generateSkyRelief(
  this: ReadonlyStore,
  id: string,
  options?: { maxSize?: number },
): Promise<SkyReliefResponse> {
  const meta = await this.get<ReliefMeta>('relief-meta', id);
  if (!meta) return null;
  const values = await this.get<Float32Array>('relief-values', id, {
    level: 0,
    first: [0, 0],
    count: meta.grid.size,
  });
  if (!values) return null;
  const grid = resampleReliefGeographic(values, asSurfaceMeta(meta), options);
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
