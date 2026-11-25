import {
  ClampToEdgeWrapping,
  Color,
  ColorRepresentation,
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RepeatWrapping,
  RGBAFormat,
} from 'three';

/**
 * The void's gradient all round: the ceiling overhead fading down to the horizon, and the
 * depths below it. A `Scenery`'s void and its stand-in draw it, and with `sky={false}` it is
 * what the scene is lit by and its seas reflect (`SceneryVoidProps.colors`, `falloff`).
 *
 * @group Materials
 */
export type VoidGradient = {
  /** straight up. Default `#2a2d32` */
  ceiling?: ColorRepresentation;
  /** at the horizon, where ceiling and depths meet. Default `#4a5058` */
  horizon?: ColorRepresentation;
  /** straight down. Default `#0e1013` */
  depth?: ColorRepresentation;
  /** how the depths darken below the horizon: the gradient's exponent; smaller reaches the depth colour sooner. Default 0.5 */
  falloff?: number;
};

/**
 * The {@link VoidGradient}'s defaults.
 *
 * @group Materials
 */
export const VOID_GRADIENT_DEFAULTS = {
  ceiling: '#2a2d32',
  horizon: '#4a5058',
  depth: '#0e1013',
  falloff: 0.5,
} as const;

/**
 * The {@link VoidGradient}'s colour for a view `y` along up (−1 straight down to 1 straight
 * up), in linear colour, into `target`: as the void's shader draws it.
 *
 * @group Materials
 */
export function voidGradientColor(
  y: number,
  gradient: VoidGradient = {},
  target = new Color(),
): Color {
  const horizon = new Color(gradient.horizon ?? VOID_GRADIENT_DEFAULTS.horizon);
  if (y > 0) {
    const ceiling = new Color(
      gradient.ceiling ?? VOID_GRADIENT_DEFAULTS.ceiling,
    );
    return target.copy(horizon).lerp(ceiling, Math.sqrt(Math.min(y, 1)));
  }
  const depth = new Color(gradient.depth ?? VOID_GRADIENT_DEFAULTS.depth);
  const falloff = Math.max(
    gradient.falloff ?? VOID_GRADIENT_DEFAULTS.falloff,
    0.01,
  );
  return target.copy(horizon).lerp(depth, Math.pow(Math.min(-y, 1), falloff));
}

/**
 * Options of {@link createVoidGradientTexture}.
 *
 * @group Materials
 */
export type VoidGradientTextureOptions = {
  /** texels from straight down to straight up. Default 512 */
  rows?: number;
};

/**
 * The {@link VoidGradient} as an equirectangular texture, for `scene.background` (or
 * `scene.environment`): one column of half floats in linear colour, from straight down to
 * straight up. `<VoidBackground>` sets it as the scene's background. Dispose of it when done.
 *
 * @example
 * scene.background = createVoidGradientTexture({ ceiling: '#202428' });
 *
 * @group Materials
 */
export function createVoidGradientTexture(
  gradient: VoidGradient = {},
  options: VoidGradientTextureOptions = {},
): DataTexture {
  const rows = Math.max(Math.round(options.rows ?? 512), 2);
  const data = new Uint16Array(rows * 4);
  const color = new Color();
  for (let row = 0; row < rows; row++) {
    // Each row's centre, at three's equirectangular latitude: v = asin(y) / π + 0.5.
    const y = Math.sin(Math.PI * ((row + 0.5) / rows - 0.5));
    voidGradientColor(y, gradient, color);
    data[row * 4] = DataUtils.toHalfFloat(color.r);
    data[row * 4 + 1] = DataUtils.toHalfFloat(color.g);
    data[row * 4 + 2] = DataUtils.toHalfFloat(color.b);
    data[row * 4 + 3] = DataUtils.toHalfFloat(1);
  }
  const texture = new DataTexture(data, 1, rows, RGBAFormat, HalfFloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
