import type { ReliefData } from '../types/ReliefMeta';
import type { SurfaceMeta } from '../types/SurfaceMeta';
import { gridToRelief } from './grid-to-relief';

// ⚠️ Free of three.js: it runs where a store runs.

/**
 * What {@link surfaceToRelief} names the relief, and where its map is.
 *
 * @group Data
 */
export type SurfaceToReliefOptions = {
  /** Default the surface's */
  id?: string;
  /** Default the surface's */
  name?: string;
  description?: string;
  attribution?: string;
  /**
   * The map the surface's grid is laid out in: a proj4 definition, or a name proj4
   * knows. Default `meta.projection`, which must then be one.
   */
  crs?: string;
  /** the value the store marks a node with no data with. Default -1 */
  nullValue?: number;
};

/**
 * A surface from the store — its `surface-meta` record and its `surface-values` — as a
 * relief: the store's encoding (`max − depth`, row-major from the north, `nullValue` for
 * none) turned into heights above mean sea level, on the surface's own grid.
 *
 * @group Data
 */
export function surfaceToRelief(
  meta: SurfaceMeta,
  values: ArrayLike<number>,
  options: SurfaceToReliefOptions = {},
): ReliefData {
  const { header } = meta;
  const nullValue = options.nullValue ?? -1;
  return gridToRelief(
    {
      values,
      size: [header.nx, header.ny],
      origin: [header.xori, header.yori],
      cell: [header.xinc, header.yinc],
      rotation: header.rot,
      crs: options.crs ?? meta.projection,
      rows: 'north',
    },
    {
      id: options.id ?? meta.id,
      name: options.name ?? meta.name,
      description: options.description ?? meta.description,
      attribution: options.attribution,
      noData: nullValue,
      // depth = max − value, so height = value − max.
      offset: -meta.max,
    },
  );
}
