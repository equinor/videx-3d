import { MeshBasicMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';

export class OutputPass extends Pass {
  fullscreenRenderer = new FullscreenRenderer();
  material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
    premultipliedAlpha: true,
  });

  constructor() {
    super();
    this.writeToScreen = true;
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    this.material.map = buffer.texture;
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.writeToScreen ? null : buffer,
      this.material,
    );
  }

  dispose() {
    this.material.dispose();
    this.fullscreenRenderer.dispose();
  }
}
