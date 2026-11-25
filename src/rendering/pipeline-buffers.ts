import { WebGLRenderTarget, type ColorSpace, type PixelFormat } from 'three';
import type { PassBuffers } from './Pass';

/**
 * @internal
 * A {@link RenderingPipeline}'s buffers ({@link PassBuffers}): its main target, and a spare like
 * it — single-sample, sharing its depth texture — made only when a pass first asks for one.
 * A pass that writes a full-screen result into the spare swaps the two, and the passes after
 * it draw into and read the spare. Each frame starts on the main target (`reset`).
 */
export class PipelineBuffers implements PassBuffers {
  /** the buffer the next pass draws into and reads */
  current: WebGLRenderTarget;
  private made: WebGLRenderTarget | null = null;

  constructor(readonly main: WebGLRenderTarget) {
    this.current = main;
  }

  get spare(): WebGLRenderTarget {
    if (this.current !== this.main) return this.main;
    return (this.made ??= this.createSpare());
  }

  swap(): WebGLRenderTarget {
    this.current = this.spare;
    return this.current;
  }

  /** Back to the main target, for a new frame. */
  reset() {
    this.current = this.main;
  }

  /** Resized with the main target (after it). */
  setSize(width: number, height: number) {
    const made = this.made;
    if (!made) return;
    // Resizing disposes a target, and three disposes its depth texture with it: the main
    // target's, which the spare lets go of first.
    made.depthTexture = null;
    made.setSize(width, height);
    made.depthTexture = this.main.depthTexture;
  }

  dispose() {
    const made = this.made;
    if (!made) return;
    made.depthTexture = null;
    made.dispose();
    this.made = null;
    this.current = this.main;
  }

  private createSpare() {
    const { main } = this;
    const texture = main.texture;
    const spare = new WebGLRenderTarget(main.width, main.height, {
      format: texture.format as PixelFormat,
      type: texture.type,
      colorSpace: texture.colorSpace as ColorSpace,
      depthBuffer: true,
      generateMipmaps: texture.generateMipmaps,
      minFilter: texture.minFilter,
      magFilter: texture.magFilter,
    });
    spare.depthTexture = main.depthTexture;
    return spare;
  }
}
