import { Color, WebGLRenderer, WebGLRenderTarget } from 'three';

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

  public abstract render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
  ): void;
}
