import {
  GLSL3,
  RawShaderMaterial,
  SRGBColorSpace,
  Uniform,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';
import fragmentShader from './shaders/box-downsample-frag.glsl';
import vertexShader from './shaders/box-downsample-vert.glsl';

const clampFactor = (supersample: number) =>
  Math.max(1, Math.min(8, Math.round(supersample)));

/**
 * Alternative output pass that performs an explicit NxN box downsample of the
 * supersampled buffer straight to the screen. Intended purely as an A/B reference
 * against the mipmap-based {@link OutputPass}: with the same scene/pattern and
 * supersample factor, the only difference is the resample filter, which isolates
 * whether the perceived aliasing comes from the downsample step.
 *
 * Tone mapping is not applied here (only sRGB / linear output encode), so pair it
 * with tone mapping = none for a fair comparison. Story/debug only.
 */
export class DebugBoxOutputPass extends Pass {
  fullscreenRenderer = new FullscreenRenderer();
  material: RawShaderMaterial;
  supersample: number;

  constructor(supersample = 1) {
    super();
    this.writeToScreen = true;
    this.supersample = supersample;
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        map: new Uniform<WebGLRenderTarget['texture'] | null>(null),
        texelSize: new Uniform(new Vector2(1, 1)),
        factor: new Uniform(clampFactor(supersample)),
        outputColorSpace: new Uniform(1),
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(width: number, height: number) {
    this.material.uniforms.texelSize.value.set(1 / width, 1 / height);
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    this.material.uniforms.map.value = buffer.texture;
    this.material.uniforms.factor.value = clampFactor(this.supersample);
    this.material.uniforms.outputColorSpace.value =
      renderer.outputColorSpace === SRGBColorSpace ? 1 : 0;
    this.fullscreenRenderer.renderMaterial(renderer, null, this.material);
  }

  dispose() {
    this.material.dispose();
    this.fullscreenRenderer.dispose();
  }
}
