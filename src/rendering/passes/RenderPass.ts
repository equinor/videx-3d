import { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from '../Pass';

export class RenderPass extends Pass {
  private scene: Scene;
  private camera: Camera;

  constructor(scene: Scene, camera: Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    renderer.setRenderTarget(this.writeToScreen ? null : buffer);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
}
