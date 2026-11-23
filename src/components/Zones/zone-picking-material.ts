import { IUniform, Material, Vector4 } from 'three';
import { applyFenceField } from '../../sdk/materials/fence-field';
import {
  applyHeightFieldClip,
  HeightFieldClipUniforms,
} from '../../sdk/materials/height-field-clip';
import {
  CustomPickingMaterial,
  setPickingMaterial,
} from '../EventEmitter/picking-material';
import type {
  ZoneFenceOverlayUniforms,
  ZoneFenceUniforms,
} from './zone-material';
import fragmentShader from './shaders/zone-pick-frag.glsl';
import vertexShader from './shaders/zone-pick-vert.glsl';

/** The cut a zone material applies, in the shape its constructor takes. */
export type ZonePickingCut = {
  sectionPlane?: IUniform<Vector4>;
  fence?: ZoneFenceUniforms;
  /** the overlay of an overlay-only face, which exists only where it has data */
  overlayOnly?: ZoneFenceOverlayUniforms;
  /** the ground drawn over the stack, above which nothing is there */
  heightClip?: HeightFieldClipUniforms;
};

/**
 * The picking twin of a cut zone material: the standard pick shader behind the same
 * section, fence and ground discards, so geometry that is cut away is not picked.
 *
 * ⭐ Bound to the SAME uniform objects as the material it stands in for, never
 * copies, so a moving plane or a fence side swap reaches it with no extra writes.
 *
 * @group Components
 */
export class ZonePickingMaterial extends CustomPickingMaterial {
  constructor({
    sectionPlane,
    fence,
    overlayOnly,
    heightClip,
  }: ZonePickingCut) {
    super(vertexShader);
    this.fragmentShader = fragmentShader;
    const defines = this.defines as Record<string, unknown>;
    if (sectionPlane) {
      defines.ZONE_SECTION = '';
      this.uniforms.sectionPlane = sectionPlane;
    }
    if (fence) {
      defines.ZONE_FENCE = '';
      applyFenceField(this.uniforms, fence);
    }
    if (overlayOnly) {
      defines.ZONE_FENCE_OVERLAY_ONLY = '';
      this.uniforms.overlayRect = overlayOnly.rect;
      this.uniforms.overlayParams = overlayOnly.params;
    }
    if (heightClip) {
      defines.ZONE_HEIGHT_CLIP = '';
      applyHeightFieldClip(this.uniforms, heightClip);
    }
  }
}

/**
 * Register a {@link ZonePickingMaterial} for `material` when it is cut, disposed
 * together with it. An uncut material needs none: the default pick material already
 * matches what it draws.
 *
 * @returns the picking twin, or `null` when the material is not cut
 */
export function attachZonePicking(
  material: Material,
  cut: ZonePickingCut,
): ZonePickingMaterial | null {
  if (!cut.sectionPlane && !cut.fence && !cut.overlayOnly && !cut.heightClip)
    return null;
  const picking = new ZonePickingMaterial(cut);
  setPickingMaterial(material, picking);
  material.addEventListener('dispose', () => {
    setPickingMaterial(material, null);
    picking.dispose();
  });
  return picking;
}
