import type { Vec2 } from '../../types/common';
import type { ReliefData } from '../types/ReliefMeta';

// ⚠️ Type imports only: the relief scripts load this file as it is, with Node's own
// TypeScript stripping, so it must stay free of runtime imports and of syntax that
// stripping cannot erase.

/**
 * A regular grid of heights, laid out however its source lays it out (see
 * {@link gridToRelief}).
 *
 * @group Data
 */
export type ReliefGridSource = {
  /** one value per node, row-major */
  values: ArrayLike<number>;
  /** nodes along X and Y */
  size: Vec2;
  /** map coordinates of the south-west node */
  origin: Vec2;
  /** map units between nodes along X and Y */
  cell: Vec2;
  /** degrees counter-clockwise about `origin`. Default 0 */
  rotation?: number;
  /** the map: a proj4 definition, or a name proj4 knows */
  crs: string;
  /** which row `values` starts with. Default `'north'` */
  rows?: 'north' | 'south';
};

/** What {@link gridToRelief} names the relief and how it reads its values. */
export type GridToReliefOptions = {
  id: string;
  name: string;
  description?: string;
  attribution?: string;
  /** a value meaning none, or a test for one; non-finite values are none anyway */
  noData?: number | ((value: number) => boolean);
  /** what each value is multiplied by: -1 for depths. Default 1 */
  scale?: number;
  /** what is added after: a shift to mean sea level from another datum. Default 0 */
  offset?: number;
};

/**
 * Any regular grid of heights as a relief: rows put northern first, no-data values made
 * `NaN`, and each value scaled and shifted into metres above mean sea level.
 *
 * @throws when the values do not fill the grid
 *
 * @group Data
 */
export function gridToRelief(
  grid: ReliefGridSource,
  options: GridToReliefOptions,
): ReliefData {
  const [nx, ny] = grid.size;
  if (grid.values.length !== nx * ny) {
    throw new Error(
      `gridToRelief: ${grid.values.length} values for a ${nx} x ${ny} grid`,
    );
  }
  const { noData, scale = 1, offset = 0 } = options;
  const none =
    typeof noData === 'function'
      ? noData
      : noData === undefined
        ? null
        : (value: number) => value === noData;
  const fromSouth = grid.rows === 'south';
  const values = new Float32Array(nx * ny);
  let min = Infinity;
  let max = -Infinity;
  for (let row = 0; row < ny; row++) {
    const from = (fromSouth ? ny - 1 - row : row) * nx;
    for (let col = 0; col < nx; col++) {
      const raw = grid.values[from + col];
      if (!Number.isFinite(raw) || (none && none(raw))) {
        values[row * nx + col] = NaN;
        continue;
      }
      const value = raw * scale + offset;
      values[row * nx + col] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return {
    meta: {
      id: options.id,
      name: options.name,
      ...(options.description ? { description: options.description } : {}),
      ...(options.attribution ? { attribution: options.attribution } : {}),
      crs: grid.crs,
      grid: {
        origin: [grid.origin[0], grid.origin[1]],
        cell: [grid.cell[0], grid.cell[1]],
        size: [nx, ny],
        ...(grid.rotation ? { rotation: grid.rotation } : {}),
      },
      min: min <= max ? min : 0,
      max: min <= max ? max : 0,
    },
    values,
  };
}
