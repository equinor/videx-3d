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
import type { PassBuffers } from './Pass';
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
 * target being written, it resolves elsewhere: into a pipeline's spare target, swapped
 * in ({@link PassBuffers}), or without one into a scratch target of its own, copied back.
 */
export class FxaaResolver {
  private scratch: WebGLRenderTarget | null = null;
  private fxaaMaterial: RawShaderMaterial;
  private blitMaterial: RawShaderMaterial;
  private fullscreenRenderer = new FullscreenRenderer();
  private width = 1;
  private height = 1;

  constructor() {
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
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.scratch?.setSize(this.width, this.height);
    this.fxaaMaterial.uniforms.resolution.value.set(
      1 / this.width,
      1 / this.height,
    );
  }

  dispose() {
    this.scratch?.dispose();
    this.fxaaMaterial.dispose();
    this.blitMaterial.dispose();
    this.fullscreenRenderer.dispose();
  }

  /** Where the result goes without a pipeline's spare: made on first use. */
  private ensureScratch() {
    return (this.scratch ??= new WebGLRenderTarget(this.width, this.height, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      samples: 0,
    }));
  }

  /**
   * Anti-alias `buffer`. With `buffers` the result goes into the pipeline's spare, swapped
   * in; without, it is copied back into `buffer`. Returns the target that holds it.
   */
  render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
    buffers?: PassBuffers,
  ): WebGLRenderTarget {
    // 1) FXAA the linear buffer into another target, so the neighbourhood taps are
    // hazard-free: the pipeline's spare, which becomes the buffer, or else scratch.
    this.fxaaMaterial.uniforms.source.value = buffer.texture;
    const out = buffers ? buffers.spare : this.ensureScratch();
    this.fullscreenRenderer.renderMaterial(renderer, out, this.fxaaMaterial);
    if (buffers) return buffers.swap();

    // 2) Blit the anti-aliased result back into the buffer in place (NoBlending
    // overwrite, so transparent regions are not double-composited).
    this.blitMaterial.uniforms.source.value = out.texture;
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.blitMaterial);
    return buffer;
  }
}
