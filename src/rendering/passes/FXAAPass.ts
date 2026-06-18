import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  RawShaderMaterial,
  RGBAFormat,
  Texture,
  Uniform,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';
import copyFrag from '../shaders/copy-frag.glsl';
import copyVert from '../shaders/copy-vert.glsl';
import fxaaFrag from '../shaders/fxaa-frag.glsl';

export class FxaaPass extends Pass {
  private scratch: WebGLRenderTarget;
  private fxaaMaterial: RawShaderMaterial;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();

  constructor() {
    super();
    this.scratch = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      samples: 0,
    });
    this.fxaaMaterial = new RawShaderMaterial({
      uniforms: {
        source: new Uniform<Texture | null>(null),
        invResolution: new Uniform(new Vector2(1, 1)),
      },
      vertexShader: copyVert,
      fragmentShader: fxaaFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.blitMaterial = new RawShaderMaterial({
      uniforms: {
        source: new Uniform<Texture | null>(null),
        opacity: new Uniform(1),
      },
      vertexShader: copyVert,
      fragmentShader: copyFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.scratch.setSize(w, h);
    (this.fxaaMaterial.uniforms.invResolution.value as Vector2).set(
      1 / w,
      1 / h,
    );
  }

  dispose() {
    this.scratch.dispose();
    this.fxaaMaterial.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    // FXAA: buffer.texture -> scratch
    this.fxaaMaterial.uniforms.source.value = buffer.texture;
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.scratch,
      this.fxaaMaterial,
    );
    // Overwrite buffer with the AA'd result.
    this.blitMaterial.uniforms.source.value = this.scratch.texture;
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.blitMaterial);
  }
}
