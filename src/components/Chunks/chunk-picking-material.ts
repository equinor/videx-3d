import { IUniform, Material, Vector4 } from 'three';
import {
  CustomPickingMaterial,
  setPickingMaterial,
} from '../EventEmitter/picking-material';
import type {
  ChunkFenceOverlayUniforms,
  ChunkFenceUniforms,
} from './chunk-material';
import fragmentShader from './shaders/chunk-pick-frag.glsl';
import vertexShader from './shaders/chunk-pick-vert.glsl';

/** The cut a chunk material applies, in the shape its constructor takes. */
export type ChunkPickingCut = {
  sectionPlane?: IUniform<Vector4>;
  fence?: ChunkFenceUniforms;
  /** the overlay of an overlay-only face, which exists only where it has data */
  overlayOnly?: ChunkFenceOverlayUniforms;
};

/**
 * The picking twin of a cut chunk material: the standard pick shader behind the same
 * section and fence discards, so geometry that is cut away is not picked.
 *
 * ⭐ Bound to the SAME uniform objects as the material it stands in for, never
 * copies, so a moving plane or a fence side swap reaches it with no extra writes.
 *
 * @group Components
 */
export class ChunkPickingMaterial extends CustomPickingMaterial {
  constructor({ sectionPlane, fence, overlayOnly }: ChunkPickingCut) {
    super(vertexShader);
    this.fragmentShader = fragmentShader;
    const defines = this.defines as Record<string, unknown>;
    if (sectionPlane) {
      defines.CHUNK_SECTION = '';
      this.uniforms.sectionPlane = sectionPlane;
    }
    if (fence) {
      defines.CHUNK_FENCE = '';
      this.uniforms.fenceParams = fence.params;
      this.uniforms.fenceMap = fence.map;
      this.uniforms.fenceToUv = fence.toUv;
      this.uniforms.fenceSize = fence.size;
      this.uniforms.fenceCells = fence.cells;
      this.uniforms.fenceSegments = fence.segments;
      this.uniforms.fenceIndex = fence.index;
      this.uniforms.fenceIndexSize = fence.indexSize;
      this.uniforms.fencePages = fence.pages;
      this.uniforms.fenceSegmentsSize = fence.segmentsSize;
    }
    if (overlayOnly) {
      defines.CHUNK_FENCE_OVERLAY_ONLY = '';
      this.uniforms.overlayRect = overlayOnly.rect;
      this.uniforms.overlayParams = overlayOnly.params;
    }
  }
}

/**
 * Register a {@link ChunkPickingMaterial} for `material` when it is cut, disposed
 * together with it. An uncut material needs none: the default pick material already
 * matches what it draws.
 *
 * @returns the picking twin, or `null` when the material is not cut
 */
export function attachChunkPicking(
  material: Material,
  cut: ChunkPickingCut,
): ChunkPickingMaterial | null {
  if (!cut.sectionPlane && !cut.fence && !cut.overlayOnly) return null;
  const picking = new ChunkPickingMaterial(cut);
  setPickingMaterial(material, picking);
  material.addEventListener('dispose', () => {
    setPickingMaterial(material, null);
    picking.dispose();
  });
  return picking;
}
