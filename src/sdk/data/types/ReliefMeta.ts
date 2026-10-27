import type { Vec2 } from '../../types/common';

/**
 * A relief in the store (`relief-meta`): a grid of heights in a map of its own, which a
 * `SceneryStage` draws as land and seabed. Its heights are read by window, at any of the
 * grid's levels (`relief-values` with a {@link ReliefWindow}).
 *
 * @group Data
 */
export type ReliefMeta = {
  id: string;
  name: string;
  description?: string;
  /** the credit the source asks for; for documentation, not drawn */
  attribution?: string;
  /** the map the grid is laid out in: a proj4 definition, or a name proj4 knows (`EPSG:4326`) */
  crs: string;
  /** the grid, laid out as an irapbin header lays it out */
  grid: {
    /** map coordinates of the south-west node */
    origin: Vec2;
    /** map units between nodes along the grid's X and Y */
    cell: Vec2;
    /** nodes along X and Y */
    size: Vec2;
    /** degrees counter-clockwise about `origin`. Default 0 */
    rotation?: number;
  };
  /** the lowest and highest heights it holds, metres above mean sea level */
  min: number;
  max: number;
};

/**
 * The argument of `relief-values`: a window of one level of a relief's grid.
 *
 * Level 0 is the grid itself. Each level up holds a value per 2 x 2 of the level below,
 * their mean where they are not `NaN` (`NaN` where none is), lying at the centre of the
 * block of grid nodes it stands for: a level is `ceil(size / 2^level)` values along each
 * axis. The values come row-major from the northern row, in metres above mean sea level,
 * positive up, `NaN` where there is none, and past the level's edge.
 *
 * @group Data
 */
export type ReliefWindow = {
  /** 0 is the grid itself; each level up has half as many values along each axis */
  level: number;
  /** the first value: column from the west, row from the NORTH, in the level's own grid */
  first: Vec2;
  /** values along X and Y */
  count: Vec2;
};

/**
 * A relief held whole: its record, and the heights of every node of its grid, row-major
 * from the northern row, metres above mean sea level, `NaN` where there is none.
 *
 * @group Data
 */
export type ReliefData = {
  meta: ReliefMeta;
  values: Float32Array;
};
