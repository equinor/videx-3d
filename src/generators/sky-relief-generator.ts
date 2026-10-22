import { transfer } from 'comlink';
import type { SkyReliefResponse } from '../components/Sky/sky-defs';
import type { ReadonlyStore, SurfaceMeta } from '../sdk';
import {
  ReliefFrame,
  ReliefResampleOptions,
  resampleRelief,
} from '../sdk/geometries/relief-grid';

/**
 * A relief — a `relief-meta` record and its `relief-values` — resampled onto a grid
 * aligned with the scene, as a `SkyBoxStage` draws it (see `resampleRelief`). The grid
 * is read from the store where the generator runs, so only the texture's levels reach
 * the caller.
 *
 * @param id the relief
 * @param frame where the scene lies on the map
 * @param options the area to cover
 */
export async function generateSkyRelief(
  this: ReadonlyStore,
  id: string,
  frame: ReliefFrame,
  options: ReliefResampleOptions,
): Promise<SkyReliefResponse> {
  const meta = await this.get<SurfaceMeta>('relief-meta', id);
  if (!meta) return null;
  const values = await this.get<Float32Array>('relief-values', id);
  if (!values) return null;
  const grid = resampleRelief(values, meta, frame, options);
  if (!grid) return null;
  return transfer(
    grid,
    grid.levels.map(level => level.data.buffer as ArrayBuffer),
  );
}
