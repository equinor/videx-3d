import { Camera, Color, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from '../Pass';

export class RenderPass extends Pass {
  private scene: Scene;
  private camera: Camera;
  /** Reused scratch for saving the renderer clear colour (no per-frame alloc). */
  private prevClearColor = new Color();

  constructor(scene: Scene, camera: Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    renderer.setRenderTarget(this.writeToScreen ? null : buffer);
    if (this.clearColor) {
      // Explicit background: clear to it, then restore the renderer's clear state so
      // later passes / R3F are unaffected.
      renderer.getClearColor(this.prevClearColor);
      const prevClearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(this.clearColor, this.clearAlpha);
      renderer.clear();
      renderer.setClearColor(this.prevClearColor, prevClearAlpha);
    } else {
      renderer.clear();
    }
    renderer.render(this.scene, this.camera);
  }
}
