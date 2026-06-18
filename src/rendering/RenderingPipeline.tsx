import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { Pass } from './Pass';

/**
 * Props for the {@link RenderingPipeline} component.
 * @expand
 */
export type RenderingPipelineProps = {
  /** Ordered list of passes to execute every frame. */
  passes: Pass[];
  /** Multisample count for the main render target. Defaults to 0. */
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
    const w = Math.max(1, Math.floor(drawingBufferSize.x * supersample));
    const h = Math.max(1, Math.floor(drawingBufferSize.y * supersample));
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
    for (const pass of passes) {
      pass.render(renderer, renderTarget);
    }
  }, priority);

  return null;
};
