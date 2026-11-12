import {
  DataTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RawShaderMaterial,
  RepeatWrapping,
  RGBAFormat,
  Uniform,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FullscreenRenderer } from '../../rendering/fullscreen-renderer';
import type { SeaLayer, SeaLayerTable } from '../../sdk/weather/sea-state';
import fragmentShader from './shaders/sea-bake-fragment.glsl';
import vertexShader from './shaders/sea-bake-vertex.glsl';

/** One layer's tile as drawn. */
export type SeaBakedLayer = {
  layer: SeaLayer;
  /**
   * x, y: slope ∂h/∂x, ∂h/∂z in the wave plane; z: height (m); w: |∇h|². Down its mips, w minus
   * the square of x and y is the slope variance a texel spans.
   */
  surface: Texture;
};

/**
 * Draws a `SeaState`'s layers into tiling textures each frame: every wave of a layer's
 * table summed per texel (a direct sum, not an FFT: a few hundred waves a layer), with
 * mipmaps, so a surface reads a layer in one filtered fetch and the slopes a pixel cannot show
 * come back as variance.
 */
export class SeaWaveBake {
  readonly layers: SeaBakedLayer[];
  /** per layer, its tile */
  readonly targets: WebGLRenderTarget[];
  private readonly tables: DataTexture[];
  private readonly material: RawShaderMaterial;
  private readonly fullscreen = new FullscreenRenderer();

  constructor(layers: readonly SeaLayer[]) {
    this.targets = layers.map(
      layer =>
        new WebGLRenderTarget(layer.texels, layer.texels, {
          format: RGBAFormat,
          type: HalfFloatType,
          wrapS: RepeatWrapping,
          wrapT: RepeatWrapping,
          minFilter: LinearMipmapLinearFilter,
          magFilter: LinearFilter,
          generateMipmaps: true,
          depthBuffer: false,
          stencilBuffer: false,
        }),
    );
    this.tables = layers.map(layer => {
      const texture = new DataTexture(
        new Float32Array(layer.waves * 4),
        layer.waves,
        1,
        RGBAFormat,
        FloatType,
      );
      texture.minFilter = NearestFilter;
      texture.magFilter = NearestFilter;
      return texture;
    });
    this.layers = layers.map((layer, i) => ({
      layer,
      surface: this.targets[i].texture,
    }));
    this.material = new RawShaderMaterial({
      vertexShader,
      fragmentShader,
      glslVersion: GLSL3,
      uniforms: {
        uWaves: new Uniform<Texture | null>(null),
        uCount: new Uniform(0),
        uSize: new Uniform(1),
        uTurn: new Uniform(new Vector2(1, 0)),
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Draw the layers' tables (`SeaState.layerTables`) into their tiles. */
  update(renderer: WebGLRenderer, tables: readonly SeaLayerTable[]): void {
    const previous = renderer.getRenderTarget();
    const uniforms = this.material.uniforms;
    tables.forEach((table, i) => {
      const waves = this.tables[i];
      (waves.image.data as Float32Array).set(table.data);
      waves.needsUpdate = true;
      uniforms.uWaves.value = waves;
      uniforms.uCount.value = table.count;
      uniforms.uSize.value = table.layer.size;
      (uniforms.uTurn.value as Vector2).set(
        Math.cos(table.layer.angle),
        Math.sin(table.layer.angle),
      );
      this.fullscreen.renderMaterial(renderer, this.targets[i], this.material);
    });
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    for (const target of this.targets) target.dispose();
    for (const texture of this.tables) texture.dispose();
    this.material.dispose();
    this.fullscreen.dispose();
  }
}
