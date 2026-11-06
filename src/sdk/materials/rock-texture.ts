import { Texture, Uniform, WebGLRenderer } from 'three';
import { bakeTexture, BakeTextureOptions } from './bake-texture';
import fragmentShader from './shaderLib/rock-texture.glsl';

/**
 * A tileable square of rock: what a shader reads to give a large rock surface relief, a
 * varied shade and fissures at any distance, sampled at a few sizes of its own.
 *
 * @group Materials
 */
export type RockTexture = {
  /**
   * Repeating and mipmapped, 8 bits a channel, as data (no colour space); drawn once `ready`
   * resolves. r, g: the relief's slope along u and v, `0.5` where it lies level, `0` and `1`
   * at ±`slopeScale`; b: the rock's shade, 0 to 1, in blotches some 16 to the square, off any
   * grid; a: fissures, thin cracks of even width that bend, fork and end, 1 on one, with a soft
   * halo.
   */
  texture: Texture;
  /** the slope (height over the square's side, the height 0 to 1) that maps to `0` and `1` */
  slopeScale: number;
  /** `true` once drawn, `false` if disposed of first */
  ready: Promise<boolean>;
  /** let go of it on the GPU */
  dispose(): void;
};

/** Options of {@link createRockTexture}. */
export type RockTextureOptions = {
  /** texels along a side. Default 512 */
  size?: number;
  /** another pattern. Default 0 */
  seed?: number;
  /** lattice cells across the square of the coarse fissures, and of the fine ones; even. Default [8, 24] */
  fissures?: [number, number];
  /** the fissures' width, coarse and fine, in texels. Default [1.6, 1.1] */
  fissureWidth?: [number, number];
  /** the slope that maps to `0` and `1` in r and g. Default 24 */
  slopeScale?: number;
} & Pick<BakeTextureOptions, 'anisotropy' | 'priority' | 'onProgress'>;

/**
 * Make a {@link RockTexture} on the GPU with `renderer`, once its program has compiled (see
 * {@link bakeTexture}). Its noise wraps at the square's edge, so it tiles, and its domain is
 * warped by more of it, so its forms bend and flow rather than sit on a grid; its relief
 * spans 4 to 512 lattice cells across, so a shader reading it at three or four scales a few
 * times apart, turned against each other, covers every distance without a visible repeat,
 * its mipmaps fading what is finer than a pixel. Dispose of it when done.
 *
 * @group Materials
 */
export function createRockTexture(
  renderer: WebGLRenderer,
  options: RockTextureOptions = {},
): RockTexture {
  const size = options.size ?? 512;
  const slopeScale = options.slopeScale ?? 24;
  const even = (n: number) => 2 * Math.max(1, Math.round(n / 2));
  const [coarse, fine] = options.fissures ?? [8, 24];
  const [coarseWidth, fineWidth] = options.fissureWidth ?? [1.6, 1.1];
  const baked = bakeTexture(renderer, fragmentShader, {
    size,
    name: 'rock',
    anisotropy: options.anisotropy,
    priority: options.priority,
    onProgress: options.onProgress,
    uniforms: {
      uSize: new Uniform(size),
      uSeed: new Uniform(options.seed ?? 0),
      uSlopeScale: new Uniform(slopeScale),
      uFissures: new Uniform([even(coarse), even(fine)]),
      uFissureWidth: new Uniform([coarseWidth, fineWidth]),
    },
  });
  return { ...baked, slopeScale };
}
