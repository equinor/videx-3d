import { Vec2 } from '../types/common';

/**
 * A coarse raster of DISTANCE-TO-OBSTACLE over a rectangle of the plan — the free-space model a
 * router steers on.
 *
 * ⭐ It is a GUIDE, never an authority. A raster cannot reproduce a polyline boundary (a bilinear
 * field rounds every vertex off), so anything built on top of one must still be verified against
 * the exact geometry. What the grid IS good for is answering "how much room is there here?" in
 * O(1), which is what lets a route prefer open ground over a tight gap.
 *
 * ⭐ The band within {@link SEED_CELLS} cells of an obstacle carries the EXACT distance; beyond it
 * a chamfer sweep propagates outward with a few percent error. The exact band is what a passability
 * threshold is compared against, so the approximation never decides whether ground is blocked.
 *
 * @group Utils
 */
export type ClearanceGrid = {
  /** world X of cell (0,0)'s CENTRE */
  x0: number;
  /** world Z of cell (0,0)'s CENTRE */
  z0: number;
  /** cell size, in metres */
  cell: number;
  nx: number;
  nz: number;
  /** distance (m) from each cell centre to the nearest obstacle, row-major (`ix + iz * nx`) */
  values: Float32Array;
};

/** An axis-aligned plan rectangle. */
export type GridBounds = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};

/** Cells around an obstacle that receive an EXACT distance before the chamfer sweep. */
const SEED_CELLS = 3;
/**
 * Refuse to raster more than this. A grid is only ever a router's scratch space; needing tens of
 * millions of cells means the cell size is wrong for the extent, and silently coarsening it would
 * change the routing without saying so.
 */
const MAX_CELLS = 4_000_000;

/** The plan bounding box of a set of polylines, grown by `pad` metres. */
export function boundsOf(paths: Vec2[][], pad = 0): GridBounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const path of paths) {
    for (const p of path) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
  }
  if (!Number.isFinite(minX)) {
    throw new Error('boundsOf: no points to bound');
  }
  return {
    minX: minX - pad,
    minZ: minZ - pad,
    maxX: maxX + pad,
    maxZ: maxZ + pad,
  };
}

/** Squared distance from `p` to the segment `a→b`. */
function segDistSq(p: Vec2, a: Vec2, b: Vec2): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = p[0] - (a[0] + ex * t);
  const dz = p[1] - (a[1] + ez * t);
  return dx * dx + dz * dz;
}

/**
 * Raster the distance from every cell centre to the nearest point of `obstacles`.
 *
 * Cost is O(obstacle segments × seed band) for the exact band plus O(cells) for the two chamfer
 * sweeps — both linear, with no per-cell nearest-neighbour query.
 *
 * @param obstacles polylines (open or closed) the distance is measured to
 * @param bounds the plan rectangle to cover
 * @param cell cell size in metres
 *
 * @group Utils
 */
export function buildClearanceGrid(
  obstacles: Vec2[][],
  bounds: GridBounds,
  cell: number,
): ClearanceGrid {
  if (!(cell > 0)) throw new Error('buildClearanceGrid: cell must be > 0');
  const nx = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / cell) + 1);
  const nz = Math.max(2, Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1);
  if (nx * nz > MAX_CELLS) {
    throw new Error(
      `buildClearanceGrid: ${nx}×${nz} cells exceeds the ${MAX_CELLS}-cell budget — the cell size is too fine for this extent`,
    );
  }
  const values = new Float32Array(nx * nz).fill(Infinity);
  const grid: ClearanceGrid = {
    x0: bounds.minX,
    z0: bounds.minZ,
    cell,
    nx,
    nz,
    values,
  };

  // Exact distances in a band around every obstacle segment.
  const band = SEED_CELLS * cell;
  for (const path of obstacles) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const ix0 = Math.max(
        0,
        Math.floor((Math.min(a[0], b[0]) - band - bounds.minX) / cell),
      );
      const ix1 = Math.min(
        nx - 1,
        Math.ceil((Math.max(a[0], b[0]) + band - bounds.minX) / cell),
      );
      const iz0 = Math.max(
        0,
        Math.floor((Math.min(a[1], b[1]) - band - bounds.minZ) / cell),
      );
      const iz1 = Math.min(
        nz - 1,
        Math.ceil((Math.max(a[1], b[1]) + band - bounds.minZ) / cell),
      );
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = bounds.minZ + iz * cell;
        for (let ix = ix0; ix <= ix1; ix++) {
          const k = ix + iz * nx;
          const d2 = segDistSq([bounds.minX + ix * cell, z], a, b);
          if (d2 < values[k] * values[k]) values[k] = Math.sqrt(d2);
        }
      }
    }
  }

  // Two chamfer sweeps carry the distance outward from the exact band.
  const orth = cell;
  const diag = cell * Math.SQRT2;
  const relax = (k: number, from: number, w: number) => {
    const d = values[from] + w;
    if (d < values[k]) values[k] = d;
  };
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const k = ix + iz * nx;
      if (ix > 0) relax(k, k - 1, orth);
      if (iz > 0) {
        relax(k, k - nx, orth);
        if (ix > 0) relax(k, k - nx - 1, diag);
        if (ix < nx - 1) relax(k, k - nx + 1, diag);
      }
    }
  }
  for (let iz = nz - 1; iz >= 0; iz--) {
    for (let ix = nx - 1; ix >= 0; ix--) {
      const k = ix + iz * nx;
      if (ix < nx - 1) relax(k, k + 1, orth);
      if (iz < nz - 1) {
        relax(k, k + nx, orth);
        if (ix < nx - 1) relax(k, k + nx + 1, diag);
        if (ix > 0) relax(k, k + nx - 1, diag);
      }
    }
  }
  return grid;
}

/** The world position of a cell centre. */
export function cellCentre(grid: ClearanceGrid, k: number): Vec2 {
  const ix = k % grid.nx;
  const iz = (k - ix) / grid.nx;
  return [grid.x0 + ix * grid.cell, grid.z0 + iz * grid.cell];
}

/** The cell containing `p`, or `-1` when it falls outside the grid. */
export function cellIndexAt(grid: ClearanceGrid, p: Vec2): number {
  const ix = Math.round((p[0] - grid.x0) / grid.cell);
  const iz = Math.round((p[1] - grid.z0) / grid.cell);
  if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) return -1;
  return ix + iz * grid.nx;
}

/**
 * The clearance at an arbitrary plan point, bilinearly interpolated. Points outside the grid report
 * the nearest edge cell's value — the grid is always built with a pad, so that is off the route.
 */
export function clearanceAt(grid: ClearanceGrid, p: Vec2): number {
  const fx = (p[0] - grid.x0) / grid.cell;
  const fz = (p[1] - grid.z0) / grid.cell;
  const ix = Math.min(grid.nx - 2, Math.max(0, Math.floor(fx)));
  const iz = Math.min(grid.nz - 2, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - ix));
  const tz = Math.min(1, Math.max(0, fz - iz));
  const k = ix + iz * grid.nx;
  const v00 = grid.values[k];
  const v10 = grid.values[k + 1];
  const v01 = grid.values[k + grid.nx];
  const v11 = grid.values[k + grid.nx + 1];
  return (
    v00 * (1 - tx) * (1 - tz) +
    v10 * tx * (1 - tz) +
    v01 * (1 - tx) * tz +
    v11 * tx * tz
  );
}
