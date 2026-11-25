import { WebGLRenderer, WebGLRenderTarget } from 'three';
import { FxaaResolver } from '../fxaa-resolver';
import { Pass, type PassBuffers } from '../Pass';

/**
 * Standalone FXAA post pass. Wraps a `FxaaResolver` and composites it into the
 * shared pipeline buffer (in a {@link RenderingPipeline}, by swapping in its spare
 * target, {@link PassBuffers}), so it works after any base pass
 * ({@link RenderPass} or {@link OITRenderPass}) — unlike the OIT-internal SMAA /
 * temporal modes it does not require order-independent transparency.
 *
 * Insert it between the base pass and the {@link OutputPass}:
 * `[base, new FXAAPass(), new OutputPass()]`.
 */
export class FXAAPass extends Pass {
  private resolver = new FxaaResolver();

  setSize(width: number, height: number) {
    this.resolver.setSize(width, height);
  }

  dispose() {
    this.resolver.dispose();
  }

  render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
    buffers?: PassBuffers,
  ) {
    this.resolver.render(renderer, buffer, buffers);
  }
}
