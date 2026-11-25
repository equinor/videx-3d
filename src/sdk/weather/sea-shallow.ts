/**
 * Waves meeting the bottom: how much of each layer's waves is left in water `depth` deep. One
 * rule for every sea and both sides of it — the surface's shaders (sea-shallow.glsl) and the
 * heights floating objects ride (`SeaState.heightAtDepth`) — so what floats rides what is drawn.
 *
 * The waves are drawn as deep-water waves, each layer's of a length and speed that never change
 * (`SeaState`); in shallow water only their HEIGHT answers the bottom:
 * - shoaling: a wave's height follows its energy flux, constant as it runs into shallower
 *   water while its group speed falls. Linear theory's coefficient, per layer at its waves'
 *   typical wavenumber: a dip of some 9 % at middling depths, then growing toward the shore;
 * - breaking: the waves' height held under a share of the depth, the measured breaking
 *   criterion (the depth they break at as a multiple of their height, the surf's
 *   `shoreBreakDepth`), smoothly, so they die out toward the beach and the still water line
 *   stays where the bed meets the level.
 *
 * Their length and speed do not change (they neither slow nor bunch up nor turn to the shore):
 * that is refraction, which a tiled layer of fixed waves cannot draw.
 *
 * @group Weather
 */

/**
 * The depth waves break at, as a multiple of their significant height: the measured breaking
 * criterion (a height of some 0.78 of the depth). The default of `WaterSettings.shoreBreakDepth`.
 *
 * @group Weather
 */
export const SEA_BREAK_DEPTH = 1.3;

// Past this k·h the bottom changes a wave's height by under 0.1 %.
const DEEP_KH = 6;
// The softness of the breaking limit: 1 / (1 + r⁴)^¼, at its knee 0.84.
const BREAK_SOFTNESS = 4;

/**
 * Linear theory's shoaling coefficient: how many times its deep-water height a wave of deep-water
 * wavenumber `k` (rad/m) stands in water `depth` deep, √(c_g,deep / c_g). The wavenumber there
 * is Fenton and McKee's explicit approximation of the dispersion relation (0.05 % off).
 * 1 in deep water; unbounded toward zero depth, where breaking takes over ({@link seaShallowFactors}).
 *
 * @group Weather
 */
export function seaShoaling(k: number, depth: number): number {
  const x = Math.max(k * depth, 1e-6);
  if (!(x < DEEP_KH)) return 1;
  const kh = x / Math.pow(Math.tanh(Math.pow(x, 0.75)), 2 / 3);
  const g = (2 * kh) / Math.sinh(2 * kh);
  return 1 / Math.sqrt(Math.tanh(kh) * (1 + g));
}

/**
 * The depth (m) from which the bottom changes no layer's height by more than 0.1 %: every
 * layer's waves past their shoaling (k·h ≥ 6), and the breaking limit over 0.999. Where the
 * water is deeper, {@link seaShallowFactors} is all 1, so the surface's shaders skip it there.
 *
 * @group Weather
 */
export function seaDeepDepth(
  layers: readonly SeaShallowLayer[],
  breakDepth = SEA_BREAK_DEPTH,
): number {
  let deep = 0;
  let variance = 0;
  for (const layer of layers) {
    variance += layer.variance;
    if (layer.variance > 0 && layer.slopeVariance > 0)
      deep = Math.max(
        deep,
        DEEP_KH / Math.sqrt(layer.slopeVariance / layer.variance),
      );
  }
  // The limit is 1 / (1 + r⁴)^¼, over 0.999 while r⁴ < 0.004.
  const r = Math.pow(Math.pow(0.999, -BREAK_SOFTNESS) - 1, 1 / BREAK_SOFTNESS);
  return Math.max(
    deep,
    (4 * Math.sqrt(variance) * Math.max(breakDepth, 0)) / r,
  );
}

/**
 * One layer of waves, as {@link seaShallowFactors} takes it: its height variance (m²) and slope
 * variance (both axes summed), as `SeaState.stats` gives them.
 *
 * @group Weather
 */
export type SeaShallowLayer = { variance: number; slopeVariance: number };

/**
 * Per layer, the share of its waves' height (and slope) left in water `depth` deep: its shoaling
 * ({@link seaShoaling}) at its waves' typical wavenumber √(slope variance / height variance),
 * times the breaking limit on them all, `1 / (1 + r⁴)^¼` with `r` the shoaled significant
 * height times `breakDepth` over the depth. 0 at no depth (or on land), 1 in deep water.
 *
 * @param out written and returned, one factor per layer
 *
 * @group Weather
 */
export function seaShallowFactors(
  depth: number,
  layers: readonly SeaShallowLayer[],
  breakDepth = SEA_BREAK_DEPTH,
  out: number[] = [],
): number[] {
  out.length = layers.length;
  if (!(depth > 0)) {
    out.fill(0);
    return out;
  }
  // As the shaders skip it (seaDeepDepth): within 0.1 % of all 1 there.
  if (depth >= seaDeepDepth(layers, breakDepth)) {
    out.fill(1);
    return out;
  }
  let variance = 0;
  layers.forEach((layer, i) => {
    const k =
      layer.variance > 0 ? Math.sqrt(layer.slopeVariance / layer.variance) : 0;
    const ks = k > 0 ? seaShoaling(k, depth) : 1;
    out[i] = ks;
    variance += ks * ks * layer.variance;
  });
  const r = (4 * Math.sqrt(variance) * Math.max(breakDepth, 0)) / depth;
  const limit = Math.pow(1 + Math.pow(r, BREAK_SOFTNESS), -1 / BREAK_SOFTNESS);
  for (let i = 0; i < out.length; i++) out[i] *= limit;
  return out;
}
