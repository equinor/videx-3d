import { useEffect, useMemo } from 'react';
import { FenceSideName } from '../../sdk';
import { ChunkFenceOverlay, ChunkFenceOverlayShading } from './chunk-defs';
import {
  ChunkFenceOverlayUniforms,
  createFenceOverlayUniforms,
} from './chunk-material';

const SHADING_MODE: Record<ChunkFenceOverlayShading, number> = {
  flat: 0,
  lit: 1,
  facing: 2,
};

/**
 * Publish a fence's overlay to the cut faces through shared uniforms.
 *
 * ⭐ The textures are the caller's; this only points the uniforms at the shown side's, so a side
 * flip is a uniform write. A side with no texture shows the formations alone.
 *
 * @param overlay the fence's overlay, or `undefined` for none
 * @param enabled whether the fence is cutting; while it is not, nothing shows
 * @param side the side currently cut away
 * @returns the shared uniforms, or `null` when there is no overlay
 *
 * @group Components
 */
export function useStackFenceOverlay(
  overlay: ChunkFenceOverlay | undefined,
  enabled: boolean,
  side: FenceSideName,
): ChunkFenceOverlayUniforms | null {
  const hasOverlay = !!overlay;
  const uniforms = useMemo(
    () => (hasOverlay ? createFenceOverlayUniforms() : null),
    [hasOverlay],
  );

  const shown = overlay?.[side] ?? null;
  const palette = overlay?.palette ?? null;
  const [low, high] = overlay?.range ?? [0, 1];
  const mix = overlay?.mix ?? 1;
  const shading = overlay?.shading ?? 'lit';

  useEffect(() => {
    if (!uniforms) return;
    const visible =
      enabled &&
      !!shown &&
      !!palette &&
      shown.along[1] !== shown.along[0] &&
      shown.y[1] !== shown.y[0];
    uniforms.values.value = visible ? shown.values : null;
    uniforms.palette.value = palette;
    if (visible) {
      uniforms.rect.value.set(
        shown.along[0],
        shown.along[1],
        shown.y[0],
        shown.y[1],
      );
    }
    // A zero range would divide by zero in the shader.
    const span = high - low || 1e-6;
    uniforms.params.value.set(
      low,
      low + span,
      visible ? Math.min(Math.max(mix, 0), 1) : 0,
      SHADING_MODE[shading] ?? SHADING_MODE.lit,
    );
  }, [uniforms, enabled, shown, palette, low, high, mix, shading]);

  return uniforms;
}
