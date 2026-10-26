import { IUniform, Matrix3, Texture, Vector2, Vector4 } from 'three';

/**
 * The shared uniforms a fence cut reads (`shaderLib/fence-field.glsl`): a vertical cut
 * swept along a curve in plan, normally a wellbore's trajectory, in the cut object's own
 * XZ. Every material cut by one fence is handed the SAME objects, so moving the fence is a
 * write into them rather than a rebuild. A `ChunkStack` makes them for its fence; the
 * `Ocean` and a `SkyBoxStage`'s relief (through an occupant's `cut`) take them to be cut
 * with it.
 */
export type FenceFieldUniforms = {
  /** x: 1 while the cut is live, y: +1, or -1 to draw only what was removed */
  params: IUniform<Vector2>;
  /**
   * Flood-fill sign of the fence over the footprint, read NEAREST.
   *
   * ⚠️ A SIGN, not a distance to interpolate. It settles the global topology; the
   * boundary itself comes from {@link FenceFieldUniforms.segments}.
   */
  map: IUniform<Texture | null>;
  /** object XZ -> uv */
  toUv: IUniform<Matrix3>;
  /** grid size in texels */
  size: IUniform<Vector2>;
  /** the page table followed by the allocated tiles: page r = tile or -1, cell rg = offset, count */
  cells: IUniform<Texture | null>;
  /**
   * The curve itself, bucketed: xy = segment start, zw = segment end.
   *
   * ⭐⭐ Carrying the segments is what makes the cut EXACT. Reconstructing them from
   * a raster cannot reproduce a polyline, and the error shows as gaps and a wavy
   * edge where the block meets the cut face.
   */
  segments: IUniform<Texture | null>;
  /** xy: index origin, z: metres per fine cell, w: cross sign meaning removed */
  index: IUniform<Vector4>;
  /** `cells` texture size in texels */
  indexSize: IUniform<Vector2>;
  /** xy: page grid, z: fine cells per tile, w: the exactness band in metres */
  pages: IUniform<Vector4>;
  /** segment texture size in texels */
  segmentsSize: IUniform<Vector2>;
};

/**
 * Bind a fence's shared uniform objects into a shader's uniforms, under the names its
 * shader reads: `fenceParams`, `fenceMap`, `fenceToUv` and `fenceSize`, declared next to
 * the include, and the rest as `shaderLib/fence-field.glsl` declares them.
 */
export function applyFenceField(
  uniforms: Record<string, IUniform>,
  fence: FenceFieldUniforms,
) {
  uniforms.fenceParams = fence.params;
  uniforms.fenceMap = fence.map;
  uniforms.fenceToUv = fence.toUv;
  uniforms.fenceSize = fence.size;
  uniforms.fenceCells = fence.cells;
  uniforms.fenceSegments = fence.segments;
  uniforms.fenceIndex = fence.index;
  uniforms.fenceIndexSize = fence.indexSize;
  uniforms.fencePages = fence.pages;
  uniforms.fenceSegmentsSize = fence.segmentsSize;
}

/**
 * How an object is cut, as the shared uniform objects its own materials read, so that
 * something drawn for it can be cut with it: a `plane` (`dot(xyz, p) + w > 0` is cut
 * away; `(0, 0, 0, -1)` cuts nothing) and a `fence`, both in the object's own frame. A
 * `ChunkStack` hands out its own (`onCut`).
 */
export type CutUniforms = {
  plane?: IUniform<Vector4>;
  fence?: FenceFieldUniforms;
};
