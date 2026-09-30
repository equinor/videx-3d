import type {
  StackGridPlacement,
  StackReferencePlan,
} from '../../sdk/geometries/surface-stack-resample';

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

export type StackWorkerRequest = RefineRequest | ResampleRequest;
export type StackWorkerResponse = RefineResponse | ResampleResponse;
