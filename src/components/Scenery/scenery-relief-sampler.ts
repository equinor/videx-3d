import {
  heightFieldPatchAt,
  heightFieldPatchSlope,
} from '../../sdk/geometries/height-field-clip';
import type { ReliefTile } from '../../sdk/geometries/relief-tiles';
import type { SurfaceSampler } from '../../sdk/geometries/surface-sampler';
import type { TinSample } from '../../sdk/geometries/tin-sampler';

/** The one surface a relief sampler answers for. */
export const RELIEF_SURFACE = 'relief';

/** A square in scene X/Z: min X, min Z, max X, max Z. */
type Square = [number, number, number, number];

/**
 * A relief's ground as something placed on it asks it (see `SurfaceSampler`): from the
 * finest of its tiles in at a point, as their triangles draw it, in the stage's frame
 * (the Earth's curve left out, as a `HeightFieldClip`'s). Hand it to what is placed on
 * the relief through `SurfaceSamplerContext`, or to a `ChunkStack` built on the relief
 * (`reliefSampler`), whose sea bed it answers for.
 *
 * ⭐ Not what is drawn, but the finest there is: the tiles drawn change with the view,
 * and what settled on them would bob. Pin what is placed (`pin`): the tiles under it are
 * then held in down to the finest, whatever the view, and the sampler is a new object
 * once they are in — the signal to settle again. Close up the drawn tile is that one, so
 * it meets the ground exactly; far off it misses it by less than the relief's
 * `pixelError`.
 *
 * `surfaces` is `['relief']`; `solidAt` is how far below the ground a point lies.
 *
 * @group Components
 */
export type ReliefSampler = SurfaceSampler & {
  /** the width of the cells of the tile that answers at X/Z: how fine the answer is */
  cellAt(x: number, z: number): number | null;
  pin(squares: Square[]): () => void;
};

/** A relief tile in, and where a point lies on it. */
export type ReliefSamplerTile = {
  tile: ReliefTile;
  /** the point, in the tile's cells from its first node, along its columns and rows */
  u: number;
  v: number;
  /** how far a cell spans there along its columns and along its rows, in scene units */
  cellU: number;
  cellV: number;
  /** its columns' direction there in scene X/Z (unit): its rows run a right angle on, south */
  east: [number, number];
};

/**
 * Where `x`, `z` lies on a relief tile that is a square in scene X/Z (min X, min Z, width):
 * for a {@link createReliefSampler}'s `finestAt`.
 */
export function reliefSquareTile(
  tile: ReliefTile,
  minX: number,
  minZ: number,
  width: number,
  x: number,
  z: number,
): ReliefSamplerTile {
  const cell = width / tile.cells;
  return {
    tile,
    u: (x - minX) / cell,
    v: (z - minZ) / cell,
    cellU: cell,
    cellV: cell,
    east: [1, 0],
  };
}

/** The squares pinned on a relief sampler, by whoever pinned them. */
export class ReliefPins {
  private next = 0;
  private readonly held = new Map<number, Square[]>();
  private all: Square[] | null = [];

  /** Hold `squares` until the release is called. One function, whichever sampler hands it out. */
  readonly add = (squares: Square[]): (() => void) => {
    const id = this.next++;
    this.held.set(id, squares);
    this.all = null;
    return () => {
      if (this.held.delete(id)) this.all = null;
    };
  };

  /** Every square held. */
  get squares(): Square[] {
    if (!this.all) this.all = [...this.held.values()].flat();
    return this.all;
  }

  /** Whether any square held overlaps this one. */
  overlaps(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    for (const [x0, z0, x1, z1] of this.squares) {
      if (x0 <= maxX && z0 <= maxZ && x1 >= minX && z1 >= minZ) return true;
    }
    return false;
  }
}

/**
 * A {@link ReliefSampler} over `finestAt`, the finest tile in at a point, its heights
 * measured from `level`, its pins held by `pins`.
 */
export function createReliefSampler(
  finestAt: (x: number, z: number) => ReliefSamplerTile | undefined,
  level: number,
  pins: ReliefPins,
): ReliefSampler {
  const scratch: TinSample = { y: 0, normal: [0, 1, 0] };
  const sampleAt = (
    x: number,
    z: number,
    surface?: string,
    out?: TinSample,
  ): TinSample | null => {
    if (surface !== undefined && surface !== RELIEF_SURFACE) return null;
    const found = finestAt(x, z);
    if (!found) return null;
    const { tile, u, v, cellU, cellV, east } = found;
    const { cells, heights } = tile;
    const nodes = cells + 3;
    const node = (i: number, j: number) => heights[(1 + j) * nodes + 1 + i];
    const [du, dv] = heightFieldPatchSlope(node, cells, u, v);
    // Along the tile's columns and rows, then into the scene: rows run south of columns.
    const nu = -du / cellU;
    const nv = -dv / cellV;
    const [ex, ez] = east;
    const nx = nu * ex - nv * ez;
    const nz = nu * ez + nv * ex;
    const length = Math.hypot(nx, 1, nz);
    const result = out ?? { y: 0, normal: [0, 1, 0] };
    result.y = level + heightFieldPatchAt(node, cells, u, v);
    result.normal[0] = nx / length;
    result.normal[1] = 1 / length;
    result.normal[2] = nz / length;
    return result;
  };
  return {
    sampleAt,
    getHeightAt: (x, z, surface) => sampleAt(x, z, surface, scratch)?.y ?? null,
    solidAt: (x, y, z) => {
      const ground = sampleAt(x, z, undefined, scratch);
      return ground && y < ground.y ? ground.y - y : null;
    },
    surfaces: [RELIEF_SURFACE],
    cellAt: (x, z) => {
      const found = finestAt(x, z);
      return found ? Math.max(found.cellU, found.cellV) : null;
    },
    pin: pins.add,
  };
}
