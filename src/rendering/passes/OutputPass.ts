import { MeshBasicMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';

/**
 * Terminal pass: composites the pipeline's linear HDR buffer to the screen and
 * applies tone mapping + sRGB output encoding once, for the whole buffer, via
 * `renderer.toneMapping` / `toneMappingExposure` (`toneMapped: true` below).
 *
 * Because tone mapping is deferred to this single pass, scene materials must render
 * linear (`toneMapped: false`) or they double-tone-map, and the per-material
 * `toneMapped = false` opt-out is not honored. See documents/oit-guide.md §7.
 */
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
