import { Texture, Uniform, WebGLRenderer } from 'three';
import { bakeTexture, BakeTextureOptions } from './bake-texture';
import fragmentShader from './shaderLib/cliff-texture.glsl';

/**
 * A tileable square of cliff face, x along it and y down it: what a shader reads to give a
 * steep rock face its columns, flutes, cracks, grain and ledges.
 *
 * @group Materials
 */
export type CliffTexture = {
  /**
   * Repeating and mipmapped, 8 bits a channel, as data (no colour space); drawn once `ready`
   * resolves. r: the rock's shade, 0 to 1; g, b: its normal's x and y (along and down the
   * face), `0.5` where it faces straight out; a: how open the surface is, 0 to 1, low in its
   * creases and cracks.
   */
  texture: Texture;
  /** `true` once drawn, `false` if disposed of first */
  ready: Promise<boolean>;
  /** let go of it on the GPU */
  dispose(): void;
};

/** Options of {@link createCliffTexture}. */
export type CliffTextureOptions = {
  /** texels along a side. Default 1024 */
  size?: number;
  /** another pattern. Default 0 */
  seed?: number;
} & Pick<BakeTextureOptions, 'anisotropy' | 'priority' | 'onProgress'>;

/**
 * Make a {@link CliffTexture} on the GPU with `renderer`, once its program has compiled (see
 * {@link bakeTexture}): 16 columns across a tile and 2 down it, 48 flutes across, 6 ledges
 * down, a grain 64 across. Dispose of it when done.
 *
 * @group Materials
 */
export function createCliffTexture(
  renderer: WebGLRenderer,
  options: CliffTextureOptions = {},
): CliffTexture {
  const size = options.size ?? 1024;
  return bakeTexture(renderer, fragmentShader, {
    size,
    name: 'cliff',
    anisotropy: options.anisotropy,
    priority: options.priority,
    onProgress: options.onProgress,
    uniforms: {
      uSize: new Uniform(size),
      uSeed: new Uniform(options.seed ?? 0),
    },
  });
}
