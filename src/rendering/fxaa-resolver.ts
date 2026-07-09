import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  RawShaderMaterial,
  RGBAFormat,
  Texture,
  Uniform,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullscreenRenderer } from './fullscreen-renderer';
import copyFrag from './shaders/copy-frag.glsl';
import copyVert from './shaders/copy-vert.glsl';
import fxaaFrag from './shaders/fxaa-frag.glsl';

/**
 * Fast Approximate Anti-Aliasing (FXAA) resolver. A single-pass, purely spatial
 * morphological technique: it estimates edge direction from local luma and blends
 * along it. Very cheap, but softer than SMAA and — like all spatial techniques —
 * unable to recover sub-pixel features (thin lines/tubes that fall between
 * samples); those need supersampling or the temporal mode.
 *
 * It operates entirely in the pipeline's linear FP16 space: the shader detects
 * edges with a cheap perceptual luma but blends the linear texels, so brightness
 * is untouched, flat regions are an exact passthrough, and HDR values above 1 are
 * preserved (no LDR clamp). Because the neighbourhood taps cannot read the same
 * target being written, it resolves into a scratch target and blits the result
 * back into the buffer in place.
 */
export class FxaaResolver {
  private scratch: WebGLRenderTarget;
  private fxaaMaterial: RawShaderMaterial;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();

  constructor() {
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
        resolution: new Uniform(new Vector2(1, 1)),
      },
      vertexShader: copyVert,
      fragmentShader: fxaaFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: NoBlending,
    });

    this.blitMaterial = new RawShaderMaterial({
      uniforms: {
        opacity: new Uniform(1),
        source: new Uniform<Texture | null>(null),
      },
      vertexShader: copyVert,
      fragmentShader: copyFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: NoBlending,
    });
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.scratch.setSize(w, h);
    this.fxaaMaterial.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  dispose() {
    this.scratch.dispose();
    this.fxaaMaterial.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    // 1) FXAA the linear buffer into the linear scratch target. Reading `buffer`
    // and writing `scratch` are different targets, so the neighbourhood taps are
    // hazard-free.
    this.fxaaMaterial.uniforms.source.value = buffer.texture;
    this.fullscreenRenderer.renderMaterial(
      renderer,
      this.scratch,
      this.fxaaMaterial,
    );

    // 2) Blit the anti-aliased result back into the buffer in place (NoBlending
    // overwrite, so transparent regions are not double-composited).
    this.blitMaterial.uniforms.source.value = this.scratch.texture;
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.blitMaterial);
  }
}
