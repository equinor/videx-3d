import type { Material } from 'three';
import type { OitVariants } from './oit-material';

/**
 * @internal
 * The define that makes an OIT min-depth variant also keep, per pixel, the nearest fragment
 * opaque enough to hide what lies behind it: `OITRenderPass.occlusionDepthStamp` folded into
 * the min-depth pass (oit.glsl).
 */
export const OIT_DEPTH_OCCLUDERS = 'OIT_DEPTH_OCCLUDERS';

/**
 * @internal
 * Give or take `variants`' min-depth variant {@link OIT_DEPTH_OCCLUDERS}, recompiling it only
 * on a change. A re-sync of the variants (`getOitVariants`, when the base material's program
 * changes) drops it, so it is set again after each.
 */
export function setOitDepthOccluders(variants: OitVariants, on: boolean) {
  const variant = variants.depthMin as Material & {
    defines?: Record<string, unknown>;
  };
  const defines = variant.defines ?? {};
  if (OIT_DEPTH_OCCLUDERS in defines === on) return;
  const next = { ...defines };
  if (on) next[OIT_DEPTH_OCCLUDERS] = '';
  else delete next[OIT_DEPTH_OCCLUDERS];
  variant.defines = next;
  variant.needsUpdate = true;
}
