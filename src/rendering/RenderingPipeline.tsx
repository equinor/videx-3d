import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  Color,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { Pass } from './Pass';

/** Transparent-black used to reset the default framebuffer each frame. */
const SCREEN_CLEAR_COLOR = new Color(0, 0, 0);

/**
 * Props for the {@link RenderingPipeline} component.
 * @expand
 */
export type RenderingPipelineProps = {
  /** Ordered list of passes to execute every frame. */
  passes: Pass[];
  /**
   * Multisample count (MSAA) for the main render target. Defaults to 0.
   *
   * This applies hardware MSAA to the pipeline's shared render target and is only
   * meaningful for an opaque {@link RenderPass}-based pipeline. When the base pass
   * is an {@link OITRenderPass}, keep this at `0`: OIT renders into its own
   * multi-target buffers, so pipeline-level MSAA would add cost without
   * anti-aliasing the resolved result. Use {@link OITRenderPass.opaqueSamples}
   * instead to multisample the opaque sub-pass inside OIT.
   */
  samples?: number;
  /** Render target supersampling factor. Defaults to 1. */
  supersample?: number;
  /** Frame priority (passed to `useFrame`). Defaults to 1. */
  priority?: number;
};

/**
 * Generic render pipeline component that runs an ordered list of {@link Pass} objects
 * against a shared `WebGLRenderTarget` (color + depth texture). Use it to compose
 * custom rendering pipelines — e.g. a {@link OITRenderPass} based pipeline for
 * order-independent transparency.
 *
 * @example
 * ```tsx
 * const passes = useMemo(
 *   () => [new OITRenderPass(scene, camera), new OutputPass()],
 *   [scene, camera],
 * );
 * return <RenderingPipeline passes={passes} />;
 * ```
 *
 * @group Components
 * @category Rendering
 * @see {@link Pass}
 * @see {@link OITRenderPass}
 * @see {@link OutputPass}
 */
export const RenderingPipeline = ({
  passes,
  samples = 0,
  supersample = 1,
  priority = 1,
}: RenderingPipelineProps) => {
  const { gl: renderer, size, viewport } = useThree();

  const drawingBufferSize = useMemo(() => new Vector2(), []);
  const prevClearColor = useMemo(() => new Color(), []);

  const renderTarget = useMemo(() => {
    const depthTexture = new DepthTexture(1, 1);
    // Mip-mapped trilinear sampling so the final blit to the (smaller) screen is
    // a proper box-filtered downsample. A plain bilinear tap only averages a 2x2
    // texel neighbourhood, which discards most samples beyond 2x supersampling
    // (4x SSAA then looks no better than 2x). With mipmaps the output blit's uv
    // derivatives select LOD ~= log2(supersample), averaging the whole
    // supersample x supersample block. Three regenerates these mips after each
    // render into the target, so they stay current. Only enabled when actually
    // supersampling — at supersample <= 1 the ratio is 1 (LOD 0) so mipmaps would
    // be pure per-frame cost for no benefit.
    const mip = supersample > 1;
    return new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: true,
      depthTexture,
      generateMipmaps: mip,
      minFilter: mip ? LinearMipmapLinearFilter : LinearFilter,
      magFilter: LinearFilter,
      samples,
    });
  }, [samples, supersample]);

  useEffect(() => {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    return () => {
      renderer.autoClear = prevAutoClear;
    };
  }, [renderer]);

  useEffect(() => {
    return () => {
      renderTarget.dispose();
    };
  }, [renderTarget]);

  useEffect(() => {
    return () => {
      passes.forEach(p => p.dispose?.());
    };
  }, [passes]);

  useLayoutEffect(() => {
    // Use the renderer's true drawing-buffer size (the actual GL backing store)
    // rather than recomputing size * pixelRatio ourselves. This avoids rendering
    // at the wrong resolution when the device pixel ratio settles or changes
    // *after* mount (e.g. moving the window to another monitor) — R3F updates
    // `viewport.dpr` without necessarily changing `size`, so we depend on
    // `viewport.dpr` to re-run whenever the effective resolution changes.
    // Getting this wrong makes the whole scene render at reduced resolution and
    // get upscaled by OutputPass, which looks like heavy aliasing / a halved
    // pixel ratio.
    renderer.getDrawingBufferSize(drawingBufferSize);
    let w = Math.max(1, Math.floor(drawingBufferSize.x * supersample));
    let h = Math.max(1, Math.floor(drawingBufferSize.y * supersample));
    // Clamp to the GPU's maximum texture size, preserving aspect ratio. At high
    // supersample factors on large (4K+) windows the target can otherwise exceed
    // maxTextureSize (commonly 16384), producing an incomplete framebuffer and a
    // silent render failure. Scaling the larger dimension down keeps the render
    // valid (it just caps the effective supersample) instead of breaking.
    const maxSize = renderer.capabilities.maxTextureSize;
    if (w > maxSize || h > maxSize) {
      const scale = maxSize / Math.max(w, h);
      w = Math.max(1, Math.floor(w * scale));
      h = Math.max(1, Math.floor(h * scale));
    }
    renderTarget.setSize(w, h);
    passes.forEach(p => p.setSize?.(w, h, viewport.dpr));
  }, [
    renderTarget,
    renderer,
    size,
    viewport.dpr,
    supersample,
    passes,
    drawingBufferSize,
  ]);

  useFrame(() => {
    // Nothing else clears the default framebuffer (autoClear is disabled above), so
    // clear it to transparent-black each frame before the passes run. With an opaque
    // final composite this is effectively a no-op (the OutputPass fully overwrites the
    // screen), but a transparent-background composite blends *over* the screen — and
    // if the canvas preserves its drawing buffer, previous frames would otherwise pile
    // up as motion trails. The renderer clear colour/alpha are saved and restored so
    // the passes' own offscreen clears (which use them) are unaffected.
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(null);
    renderer.setClearColor(SCREEN_CLEAR_COLOR, 0);
    renderer.clear(true, true, true);
    renderer.setClearColor(prevClearColor, prevClearAlpha);

    for (const pass of passes) {
      pass.render(renderer, renderTarget);
    }
  }, priority);

  return null;
};
