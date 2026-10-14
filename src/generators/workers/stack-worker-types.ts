import type {
  StackCapArrays,
  StackCapInput,
} from '../../sdk/geometries/stack-cap-arrays';
import type {
  StackTileInput,
  StackTileOutput,
} from '../../sdk/geometries/stack-tiles';
import type {
  StackGridPlacement,
  StackReferencePlan,
} from '../../sdk/geometries/surface-stack-resample';
import type { ThicknessLoops } from '../../sdk/geometries/surface-stack-terminations';
import type {
  WellboreOutlineCoordinates,
  WellboreOutlineOptions,
} from '../../sdk/geometries/wellbore-outline';

/**
 * A shared-tessellation refinement task: refine ONE layer of the stack's common
 * grid and return the grid nodes its TIN would use. The channel is transferred, so
 * the caller must send a copy when it still needs the heights.
 */
export type RefineRequest = {
  kind: 'refine';
  /** correlation id (per task) */
  id: number;
  /** the layer's heights over the common grid (transferred to the worker) */
  channel: Float32Array;
  /** the common grid's column count */
  nx: number;
  /** greedy simplification error, in world units of height */
  maxError: number;
};

/** The refine worker's result: the layer's TIN nodes (`row * nx + col`). */
export type RefineResponse = {
  kind: 'refine';
  id: number;
  nodes: Uint32Array;
  /** per node, its level (see `collectStackCandidateLevels`) */
  errors: Float32Array;
  /** refinement time (ms) measured inside the worker (profiling) */
  refineMs: number;
};

/**
 * A resampling task: put ONE layer's own grid onto the stack's common grid.
 *
 * The samples are transferred in and never come back — after the resample a layer
 * is only ever asked for its placement, not for its grid.
 */
export type ResampleRequest = {
  kind: 'resample';
  id: number;
  /** the common grid (plain data — it carries no class instances) */
  plan: StackReferencePlan;
  /** the layer's own grid placement */
  placement: StackGridPlacement;
  /** the layer's samples (transferred to the worker) */
  values: Float32Array;
  /** depth-normalization reference (`SurfaceMeta.max`) */
  referenceDepth: number;
  /** the value marking a missing sample */
  nullValue: number;
};

/** The resample worker's result: the layer's channel and mask, both transferred. */
export type ResampleResponse = {
  kind: 'resample';
  id: number;
  channel: Float32Array;
  mask: Uint8Array;
  /** the layer has no data anywhere on the common grid */
  empty: boolean;
  /** resample time (ms) measured inside the worker (profiling) */
  resampleMs: number;
};

export type StackWorkerRequest =
  | RefineRequest
  | ResampleRequest
  | OutlineRequest
  | TerminationsRequest
  | CapRequest
  | TileRequest;
export type StackWorkerResponse =
  | RefineResponse
  | ResampleResponse
  | OutlineResponse
  | TerminationsResponse
  | CapResponse
  | TileResponse;

/**
 * A tessellation tile task: triangulate ONE tile of a tiled stack tessellation
 * (see `tessellateStackTile`). Its arrays are transferred.
 */
export type TileRequest = {
  kind: 'tile';
  id: number;
  tile: StackTileInput;
};

export type TileResponse = {
  kind: 'tile';
  id: number;
  output: StackTileOutput;
};

/**
 * A cap task: build ONE cap's arrays (see `buildStackCapArrays`). Everything in
 * `input` is transferred, so the caller sends copies.
 */
export type CapRequest = {
  kind: 'cap';
  id: number;
  input: StackCapInput;
};

export type CapResponse = {
  kind: 'cap';
  id: number;
  arrays: StackCapArrays;
};

/**
 * A termination scan task: trace where ONE adjacent pair's thickness crosses the
 * collapse threshold (see `scanThicknessLoops`). Both channels are transferred, so
 * the caller sends copies.
 */
export type TerminationsRequest = {
  kind: 'terminations';
  id: number;
  above: Float32Array;
  below: Float32Array;
  nx: number;
  threshold: number;
};

export type TerminationsResponse = {
  kind: 'terminations';
  id: number;
  loops: ThicknessLoops;
};

/**
 * A wellbore outline task: buffer and contour trajectory runs that were already
 * cut to their depth windows. Only the runs travel — the surfaces they were cut
 * against stay with the caller.
 */
export type OutlineRequest = {
  kind: 'outline';
  id: number;
  /** per run, flat `[x0, z0, x1, z1, ...]` in scene XZ (transferred) */
  paths: { points: Float64Array; radius?: number }[];
  options: Omit<WellboreOutlineOptions, 'shapeFn' | 'onMetrics'>;
};

export type OutlineResponse = WellboreOutlineCoordinates & {
  kind: 'outline';
  id: number;
  /** raster time (ms) measured inside the worker (profiling) */
  outlineMs: number;
};
