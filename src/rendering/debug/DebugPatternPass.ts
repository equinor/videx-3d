import {
  RawShaderMaterial,
  Uniform,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';
import vertexShader from '../shaders/copy-vert.glsl';
import fragmentShader from './shaders/debug-pattern-frag.glsl';

/**
 * Named test signals produced by {@link DebugPatternPass}.
 * - `zonePlate` / `grid` / `checker`: high-frequency signals for anti-aliasing /
 *   supersampling / downsample inspection.
 * - `gradient` / `colorBars` / `grayStep` / `grayCard`: known linear values for
 *   colour-space and tone-mapping verification.
 */
export type DebugPattern =
  | 'zonePlate'
  | 'grid'
  | 'checker'
  | 'gradient'
  | 'colorBars'
  | 'grayStep'
  | 'grayCard';

const PATTERN_INDEX: Record<DebugPattern, number> = {
  zonePlate: 0,
  grid: 1,
  checker: 2,
  gradient: 3,
  colorBars: 4,
  grayStep: 5,
  grayCard: 6,
};

/**
 * Debug pass that overwrites the shared pipeline buffer with a synthetic test
 * signal (see {@link DebugPattern}). It writes *linear* values at the buffer's
 * (supersampled) resolution, replacing scene geometry so the rest of the pipeline
 * — supersample downsample, tone mapping and output colour-space encode — can be
 * validated against a known input.
 *
 * Story/debug only — not part of the public rendering API.
 */
export class DebugPatternPass extends Pass {
  fullscreenRenderer = new FullscreenRenderer();
  material: RawShaderMaterial;

  constructor(pattern: DebugPattern = 'zonePlate', scale = 24) {
    super();
    this.material = new RawShaderMaterial({
      uniforms: {
        uResolution: new Uniform(new Vector2(1, 1)),
        uPattern: new Uniform(PATTERN_INDEX[pattern]),
        uScale: new Uniform(scale),
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
  }

  set pattern(value: DebugPattern) {
    this.material.uniforms.uPattern.value = PATTERN_INDEX[value];
  }

  set scale(value: number) {
    this.material.uniforms.uScale.value = value;
  }

  setSize(width: number, height: number) {
    this.material.uniforms.uResolution.value.set(width, height);
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    this.fullscreenRenderer.renderMaterial(renderer, buffer, this.material);
  }

  dispose() {
    this.material.dispose();
    this.fullscreenRenderer.dispose();
  }
}
