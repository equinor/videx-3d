import { transfer } from 'comlink';
import type { SkyReliefResponse } from '../components/Sky/sky-defs';
import type { ReadonlyStore, ReliefMeta, SurfaceMeta } from '../sdk';
import {
  ReliefResampleOptions,
  resampleRelief,
} from '../sdk/geometries/relief-grid';
import type { GeoFrame } from '../sdk/projection/geo-frame';

/**
 * A relief — a `relief-meta` record and its `relief-values` — resampled onto a grid
 * aligned with the scene, as a `SkyBoxStage` draws its overview past its tiles (see
 * `resampleRelief`). The grid is read from the store where the generator runs, so only
 * the texture's levels reach the caller.
 *
 * @param id the relief
 * @param frame where the scene lies on the map
 * @param options the area to cover
 */
export async function generateSkyRelief(
  this: ReadonlyStore,
  id: string,
  frame: GeoFrame,
  options: ReliefResampleOptions,
): Promise<SkyReliefResponse> {
  const meta = await this.get<ReliefMeta>('relief-meta', id);
  if (!meta) return null;
  const values = await this.get<Float32Array>('relief-values', id, {
    level: 0,
    first: [0, 0],
    count: meta.grid.size,
  });
  if (!values) return null;
  const grid = resampleRelief(values, asSurfaceMeta(meta), frame, options);
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
