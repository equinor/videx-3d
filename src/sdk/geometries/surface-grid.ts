import type { Vec2 } from '../types/common';
import type { GridPolygon } from './triangulate-grid-delaunay';

// ⚠️ THIS MODULE MUST STAY FREE OF three.js. It is imported by the inlined stack
// worker (`?worker&inline`), which is shipped base64-encoded inside the library
// bundle — pulling three in here would embed a second copy of it.

/**
 * The subset of a `SurfaceMeta` header needed to build and place a clipped
 * surface (the same fields `generateSurfaceGeometry` uses for its transform).
 *
 * @group Geometries
 */
export type SurfaceClipHeader = {
  nx: number;
  ny: number;
  xinc: number;
  yinc: number;
  /** grid rotation in degrees (CCW about the origin corner, matching IRAP) */
  rot: number;
};

/**
 * Build the inverse of the surface placement: a function mapping a scene XZ point
 * into the surface's grid (column, row) space. This inverts the transform
 * `generateSurfaceGeometry` / `createClippedSurface` bake (center the grid,
 * `rotateY(rot)`, positioned at `worldPosition`), so a world point can be located
 * against — or sampled from — the grid.
 *
 * @group Geometries
 */
export function surfaceWorldToGrid(
  header: SurfaceClipHeader,
  worldPosition: Vec2 = [0, 0],
): (sx: number, sz: number) => [number, number] {
  const { ny, xinc, yinc, rot } = header;
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const zShift = -(ny - 1) * yinc;
  const [wpx, wpz] = worldPosition;
  return (sx: number, sz: number) => {
    const dx = sx - wpx;
    const dz = sz - wpz;
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    return [lx / xinc, (lz - zShift) / yinc];
  };
}

/**
 * The inverse of {@link surfaceWorldToGrid}: a function mapping a surface
 * `(column, row)` grid coordinate (fractional allowed) into the scene XZ frame the
 * surface is rendered in. This reproduces exactly the placement
 * `generateSurfaceGeometry` / `createClippedSurface` bake (grid centred, then
 * `rotateY(rot)`, positioned at `worldPosition`), so a traced grid ring can be
 * turned into a scene-space outline that lines up with the rendered mesh.
 *
 * @group Geometries
 */
export function surfaceGridToWorld(
  header: SurfaceClipHeader,
  worldPosition: Vec2 = [0, 0],
): (col: number, row: number) => Vec2 {
  const { ny, xinc, yinc, rot } = header;
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const zShift = -(ny - 1) * yinc;
  const [wpx, wpz] = worldPosition;
  return (col: number, row: number) => {
    const lx = col * xinc;
    const lz = row * yinc + zShift;
    // Inverse of the world->grid rotation (three.js rotateY): dx = cos*lx + sin*lz,
    // dz = -sin*lx + cos*lz — matching the mesh transform baked in createClippedSurface.
    const dx = lx * cos + lz * sin;
    const dz = -lx * sin + lz * cos;
    return [dx + wpx, dz + wpz];
  };
}

/**
 * A 2x3 affine map between two surface grids' `(column, row)` spaces:
 * `col' = a * col + b * row + c`, `row' = d * col + e * row + f`.
 *
 * @group Geometries
 */
export type GridAffine = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

/**
 * Build the affine map from one surface grid's `(column, row)` space into
 * another's — the composition of {@link surfaceGridToWorld} with
 * {@link surfaceWorldToGrid}. Both are affine, so their composition is too:
 * evaluating it at three points recovers the matrix and removes all trigonometry
 * (and both function calls) from per-node loops.
 *
 * @group Geometries
 */
export function gridToGridTransform(
  from: SurfaceClipHeader,
  fromWorldPosition: Vec2 | undefined,
  to: SurfaceClipHeader,
  toWorldPosition: Vec2 | undefined,
): GridAffine {
  const toWorld = surfaceGridToWorld(from, fromWorldPosition);
  const toGrid = surfaceWorldToGrid(to, toWorldPosition);
  const at = (col: number, row: number) => {
    const [wx, wz] = toWorld(col, row);
    return toGrid(wx, wz);
  };
  const o = at(0, 0);
  const dCol = at(1, 0);
  const dRow = at(0, 1);
  return {
    a: dCol[0] - o[0],
    b: dRow[0] - o[0],
    c: o[0],
    d: dCol[1] - o[1],
    e: dRow[1] - o[1],
    f: o[1],
  };
}

/**
 * An inclusive `(column, row)` window into a surface grid.
 *
 * @group Geometries
 */
export type SurfaceGridBounds = {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
};

/**
 * Grid-space bounding box of already-mapped polygon rings, padded and clamped to
 * the grid.
 *
 * @returns the inclusive window, or null when the polygon misses the grid entirely
 *
 * @group Geometries
 */
export function boundsOfGridPolygons(
  gridPolygons: GridPolygon[],
  nx: number,
  ny: number,
  margin: number,
): SurfaceGridBounds | null {
  let bMinX = Infinity;
  let bMinY = Infinity;
  let bMaxX = -Infinity;
  let bMaxY = -Infinity;
  for (const rings of gridPolygons) {
    for (const ring of rings) {
      for (const [gx, gy] of ring) {
        if (gx < bMinX) bMinX = gx;
        if (gx > bMaxX) bMaxX = gx;
        if (gy < bMinY) bMinY = gy;
        if (gy > bMaxY) bMaxY = gy;
      }
    }
  }
  if (!Number.isFinite(bMinX)) return null;
  return {
    col0: Math.max(0, Math.floor(bMinX) - margin),
    row0: Math.max(0, Math.floor(bMinY) - margin),
    col1: Math.min(nx - 1, Math.ceil(bMaxX) + margin),
    row1: Math.min(ny - 1, Math.ceil(bMaxY) + margin),
  };
}
