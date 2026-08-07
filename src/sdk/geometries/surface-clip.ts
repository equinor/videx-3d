import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';
import { computeUpwardNormals } from './geometry-attributes';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';
import {
  GridPolygon,
  triangulateGridConstrained,
} from './triangulate-grid-delaunay';

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
 * Options for {@link createClippedSurface}.
 *
 * @group Geometries
 */
export type SurfaceClipOptions = {
  /**
   * The mask polygon, in the same scene XZ frame the surface is rendered in
   * (`[x, z]` per vertex). Supports multiple components and holes. The exact
   * polygon rim is honored (constrained Delaunay) rather than following the grid
   * staircase; vertices outside it are dropped.
   */
  polygon: PlanarPolygonGeometry;
  /**
   * Depth-normalization reference (`SurfaceMeta.max`). The repo surfaces store
   * `value = referenceDepth - trueDepth`, so vertex Y becomes `-trueDepth`,
   * exactly as the `Surface` component / `generateSurfaceGeometry`.
   */
  referenceDepth: number;
  /**
   * Scene XZ of the surface's `<UtmPosition>` origin — i.e.
   * `crs.utmToWorld(header.xori, header.yori, 0)` mapped to `[x, z]`. Used to map
   * the mask polygon into grid space so the clip lines up with the rendered mesh.
   * Defaults to `[0, 0]`.
   */
  worldPosition?: Vec2;
  /** value marking a missing/hole sample (default -1) */
  nullValue?: number;
  /** greedy interior simplification error, in grid height units (default 5) */
  maxError?: number;
  /**
   * Subdivide + drape the rim at grid-line crossings so it follows the relief
   * rather than interpolating linearly between polygon vertices (default true).
   */
  drape?: boolean;
  /**
   * Cut no-data holes with a clean traced rim (kept region = inside the polygon
   * AND inside valid data) instead of filling them from neighbours (default
   * false).
   */
  cutHoles?: boolean;
  /**
   * When cutting holes, smooth the traced data boundary by this strength so the
   * rim reads as a continuous curve instead of a grid staircase (default 0 =
   * exact cell-edge rim). Trades boundary fidelity for smoothness.
   */
  edgeSmoothing?: number;
};

/**
 * Build the inverse of the surface placement: a function mapping a scene XZ point
 * into the surface's grid (column, row) space. This inverts the transform
 * `generateSurfaceGeometry` / {@link createClippedSurface} bake (center the grid,
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
 * `generateSurfaceGeometry` / {@link createClippedSurface} bake (grid centred, then
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

// Grid-space bounding box of already-mapped polygon rings, padded and clamped to
// the grid. Returns null when the polygon misses the grid entirely.
function boundsOfGridPolygons(
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

/**
 * The window of a surface's grid a polygon mask covers — the same crop
 * {@link clipSurfaceRaw} triangulates. Useful to restrict any per-node pre-pass
 * (e.g. {@link clampSurfaceUnder}) to the part of the grid that can actually end
 * up in the clipped geometry.
 *
 * @param header grid geometry
 * @param polygon mask polygon in scene XZ
 * @param worldPosition scene XZ of the grid origin (default `[0, 0]`)
 * @param margin extra cells kept around the box (default 2, matching the clip)
 * @returns the inclusive grid window, or null when the mask misses the grid
 *
 * @group Geometries
 */
export function surfaceGridBounds(
  header: SurfaceClipHeader,
  polygon: PlanarPolygonGeometry,
  worldPosition?: Vec2,
  margin = 2,
): SurfaceGridBounds | null {
  const toGrid = surfaceWorldToGrid(header, worldPosition);
  const components = polygon.coordinates as PlanarPolygonCoordinates;
  const gridPolygons: GridPolygon[] = components.map(rings =>
    rings.map(ring => ring.map(([sx, sz]) => toGrid(sx, sz))),
  );
  return boundsOfGridPolygons(gridPolygons, header.nx, header.ny, margin);
}

/**
 * Build a surface geometry clipped to an arbitrary (possibly holed / multi-part)
 * polygon mask, honoring the **exact** polygon rim via constrained Delaunay
 * triangulation (no grid staircase). The interior keeps the data-adaptive Delatin
 * simplification; the rim is draped onto the elevation grid.
 *
 * The result is placed with the same transform as `generateSurfaceGeometry`, so it
 * coincides with a full `Surface` when wrapped in the same
 * `<UtmPosition easting={xori} northing={yori} altitude={max}>`. UVs are grid-space
 * `[0, 1]`, so the surface shader / `SurfaceMaterial` can consume it. No-data holes
 * inside the mask are cut with a clean rim when `cutHoles` is set, otherwise filled
 * from neighbouring samples.
 *
 * @param values row-major elevation grid of length `nx * ny`
 * @param header grid geometry (see {@link SurfaceClipHeader})
 * @param options see {@link SurfaceClipOptions}
 * @returns the clipped geometry, or `null` when the mask covers no grid cell
 *
 * @group Geometries
 */
export function createClippedSurface(
  values: Float32Array,
  header: SurfaceClipHeader,
  options: SurfaceClipOptions,
): BufferGeometry | null {
  const raw = clipSurfaceRaw(values, header, options);
  if (!raw) return null;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(raw.positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(raw.uvs, 2));
  geometry.setIndex(new BufferAttribute(raw.indices, 1));
  computeUpwardNormals(geometry);

  return geometry;
}

/** The raw, three.js-free result of {@link clipSurfaceRaw}. */
export type RawClippedSurface = {
  /** vertex positions in the scene frame (placement baked in), xyz interleaved */
  positions: Float32Array;
  /** grid-space `[0, 1]` UVs, uv interleaved */
  uvs: Float32Array;
  /** triangle indices */
  indices: Uint32Array;
};

/**
 * The **three.js-free core** of {@link createClippedSurface}: crop the grid to the
 * mask, triangulate against the exact polygon rim (constrained Delaunay), remap UVs
 * to full-grid space, and bake the placement transform into the returned position
 * array — all without importing three, so it can run in a worker.
 *
 * The transform is applied in the same stepwise order as the three.js
 * `translate`/`rotateY` sequence `createClippedSurface` used to apply (each pass
 * rounds to float32 exactly as `BufferGeometry.translate`/`rotateY` would), so the
 * result is byte-identical. Normals are NOT computed here (that needs three);
 * callers wrap the result and call `computeUpwardNormals`.
 *
 * @returns raw `{ positions, uvs, indices }` in the scene frame, or `null` when the
 *   mask covers no grid cell.
 *
 * @group Geometries
 */
export function clipSurfaceRaw(
  values: Float32Array,
  header: SurfaceClipHeader,
  options: SurfaceClipOptions,
): RawClippedSurface | null {
  const { nx, ny, xinc, yinc, rot } = header;
  const { referenceDepth, polygon } = options;
  const nullValue = options.nullValue ?? -1;
  const maxError = options.maxError ?? 5;
  const drape = options.drape ?? true;
  const cutHoles = options.cutHoles ?? false;
  const edgeSmoothing = options.edgeSmoothing ?? 0;

  const theta = (rot * Math.PI) / 180;
  const zShift = -(ny - 1) * yinc;

  // Map a scene XZ point back into grid (column, row) space so the mask lines up
  // with the rendered mesh.
  const toGrid = surfaceWorldToGrid(header, options.worldPosition);

  const components = polygon.coordinates as PlanarPolygonCoordinates;
  const gridPolygons: GridPolygon[] = components.map(rings =>
    rings.map(ring => ring.map(([sx, sz]) => toGrid(sx, sz))),
  );

  // Crop the grid to the polygon's bounding box (+margin). A mask usually covers a
  // small part of a large surface grid, so triangulating and constraining the whole
  // grid — then discarding everything outside the mask — is wasteful and makes the
  // constraint phase blow up super-linearly on big grids. Cropping first keeps the
  // triangulation tiny. Positions and UVs are emitted back into the full-grid frame
  // below, so placement and grid-space UVs are unchanged.
  const MARGIN = 2;
  const bounds = boundsOfGridPolygons(gridPolygons, nx, ny, MARGIN);
  if (!bounds) return null;

  const { col0, row0, col1, row1 } = bounds;
  const cropW = col1 - col0 + 1;
  const cropH = row1 - row0 + 1;
  // Polygon fully outside the grid, or too thin a strip to triangulate.
  if (cropW < 2 || cropH < 2) return null;

  // Extract the sub-grid (row-major) and shift the polygon into its coordinates.
  const cropped = new Float32Array(cropW * cropH);
  for (let r = 0; r < cropH; r++) {
    const srcBase = (row0 + r) * nx + col0;
    cropped.set(values.subarray(srcBase, srcBase + cropW), r * cropW);
  }
  const croppedPolygons: GridPolygon[] = gridPolygons.map(rings =>
    rings.map(ring => ring.map(([gx, gy]) => [gx - col0, gy - row0])),
  );

  const { positions, uvs, indices } = triangulateGridConstrained(
    cropped,
    cropW,
    xinc,
    yinc,
    nullValue,
    maxError,
    croppedPolygons,
    drape,
    cutHoles,
    edgeSmoothing,
  );

  if (indices.length === 0) return null;

  // Remap sub-grid UVs (col'/(cropW-1), 1 - row'/(cropH-1)) back to full-grid space
  // so consumers (e.g. SurfaceMaterial) still get grid-space [0, 1] coordinates.
  const uDen = nx - 1;
  const vDen = ny - 1;
  for (let i = 0; i < uvs.length; i += 2) {
    const colp = uvs[i] * (cropW - 1);
    const rowp = (1 - uvs[i + 1]) * (cropH - 1);
    uvs[i] = (colp + col0) / uDen;
    uvs[i + 1] = 1 - (rowp + row0) / vDen;
  }

  // Sub-grid positions are (col' * xinc, h, row' * yinc). Bake the placement
  // transform into `positions`, matching the three.js translate/rotateY sequence
  // step-for-step (each pass rounds to float32 exactly as three would), so the
  // output equals the previous `geometry.translate/rotateY` version: shift back to
  // the full grid, center, rotate, then drop to true depth (y = -trueDepth).
  const tx = col0 * xinc;
  const tz = row0 * yinc;
  // translate(col0 * xinc, 0, row0 * yinc)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += tx;
    positions[i + 2] += tz;
  }
  // translate(0, 0, zShift)
  for (let i = 2; i < positions.length; i += 3) positions[i] += zShift;
  // rotateY(theta): x' = cos*x + sin*z, z' = -sin*x + cos*z
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    positions[i] = cos * x + sin * z;
    positions[i + 2] = -sin * x + cos * z;
  }
  // translate(0, -referenceDepth, 0)
  for (let i = 1; i < positions.length; i += 3) positions[i] -= referenceDepth;

  return { positions, uvs, indices };
}
