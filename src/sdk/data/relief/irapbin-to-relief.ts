import { IRAPBIN_UNDEFINED, readIrapbin } from '../../utils/irapbin-parser';
import type { ReliefData } from '../types/ReliefMeta';
import { gridToRelief } from './grid-to-relief';

// ⚠️ Free of three.js: it runs where a store runs.

/**
 * What {@link irapbinToRelief} names the relief, and how it reads the grid.
 *
 * @group Data
 */
export type IrapbinToReliefOptions = {
  id: string;
  name: string;
  description?: string;
  attribution?: string;
  /** the map the grid is laid out in: a proj4 definition, or a name proj4 knows */
  crs: string;
  /** the values are depths, positive down, and are turned into heights. Default true */
  depth?: boolean;
  /** what is added after: a shift to mean sea level from another datum. Default 0 */
  offset?: number;
};

/**
 * An IRAP binary grid ("irapbin") as a relief: its header's grid (south-west node,
 * spacing and rotation), its undefined value (9999900) and anything past ±1e30 made
 * `NaN`, and its depths turned into heights.
 *
 * @group Data
 */
export function irapbinToRelief(
  buffer: ArrayBuffer,
  options: IrapbinToReliefOptions,
): ReliefData {
  const { header, values } = readIrapbin(buffer);
  const { depth = true, offset = 0, crs, ...naming } = options;
  return gridToRelief(
    {
      values,
      size: [header.nx, header.ny],
      origin: [header.xori, header.yori],
      cell: [header.xinc, header.yinc],
      rotation: header.rot,
      crs,
      rows: 'south',
    },
    {
      ...naming,
      noData: value => value === IRAPBIN_UNDEFINED || Math.abs(value) >= 1e30,
      scale: depth ? -1 : 1,
      offset,
    },
  );
}
