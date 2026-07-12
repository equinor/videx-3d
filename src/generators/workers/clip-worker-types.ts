import type { PlanarPolygonCoordinates } from '../../sdk/geometries/planar-geometry';
import type { SurfaceClipHeader } from '../../sdk/geometries/surface-clip';
import type { Vec2 } from '../../sdk/types/common';

/**
 * A single-layer clip task sent to the internal clip worker pool. Carries the raw
 * grid (transferred, zero-copy) plus the shared rim so the worker can clip and rim-
 * sample the layer without any access to the data store or three.js.
 */
export type ClipRequest = {
  /** correlation id (per task) */
  id: number;
  /** row-major elevation grid (transferred to the worker) */
  values: Float32Array;
  header: SurfaceClipHeader;
  referenceDepth: number;
  worldPosition: Vec2;
  /** the densified mask polygon rings (scene XZ) as plain coordinates */
  polygonCoordinates: PlanarPolygonCoordinates;
  /** the shared rim rings (scene XZ) */
  rings: Vec2[][];
  maxError: number;
  nullValue: number;
};

/** The clip worker's result: raw geometry arrays (or null) + the layer's rim depths. */
export type ClipResponse = {
  id: number;
  positions: Float32Array | null;
  uvs: Float32Array | null;
  indices: Uint32Array | null;
  /** this layer's depth at every shared-rim vertex: `rimY[ring][vertex]` */
  rimY: number[][];
  /** clip-only time (ms) measured inside the worker (profiling) */
  clipMs: number;
  /** full grid node count (profiling) */
  nodes: number;
  /** number of no-data (hole) nodes in the grid (profiling) */
  holes: number;
};
