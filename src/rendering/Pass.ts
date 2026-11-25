import { Color, WebGLRenderer, WebGLRenderTarget } from 'three';

/**
 * The buffers a {@link RenderingPipeline} hands each pass besides the one it draws into: for
 * a pass that reads the whole buffer to write a result of the same size (an anti-aliasing
 * resolve), which cannot read and write one target at once. It writes the result into
 * `spare` and calls `swap()`, and the passes after it draw into and read the spare: no copy
 * back into the buffer.
 *
 * ⚠️ The spare shares the buffer's depth texture, so what is drawn into it full screen must
 * neither test nor write depth (`depthTest` and `depthWrite` false).
 *
 * @group Rendering
 */
export type PassBuffers = {
  /** a target like the buffer — single-sample, sharing its depth texture — made on first use */
  readonly spare: WebGLRenderTarget;
  /** make the spare the buffer the passes after draw into and read; returns it */
  swap(): WebGLRenderTarget;
};

export abstract class Pass {
  writeToScreen: boolean = false;

  /**
   * Explicit background for passes that clear the frame (e.g. {@link RenderPass} and
   * the OIT opaque clear). When set, the pass clears to this colour/alpha instead of
   * the renderer's current clear state, giving a single source of truth so the
   * background is identical regardless of which base pass renders the scene. When
   * `null` the pass falls back to the renderer's current clear colour/alpha.
   */
  clearColor: Color | null = null;
  clearAlpha: number = 1;

  setSize?(width: number, height: number, pixelRatio: number): void;

  dispose?(): void;

  /**
   * Draw into `buffer`, the pipeline's linear HDR target, or read it. `buffers` (from a
   * {@link RenderingPipeline}) offers a spare target to write a full-screen result into
   * instead of copying it back: see {@link PassBuffers}. A pass driven by other code may
   * not get it.
   */
  public abstract render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
    buffers?: PassBuffers,
  ): void;
}
