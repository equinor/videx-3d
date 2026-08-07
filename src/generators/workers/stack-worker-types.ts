/**
 * A shared-tessellation refinement task: refine ONE layer of the stack's common
 * grid and return the grid nodes its TIN would use. The channel is transferred, so
 * the caller must send a copy when it still needs the heights.
 */
export type RefineRequest = {
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
  id: number;
  nodes: Uint32Array;
  /** refinement time (ms) measured inside the worker (profiling) */
  refineMs: number;
};
