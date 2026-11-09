/**
 * Soft clouds (a spike, 2026-11-09: `SceneryCloudVolume`'s `soft`): rounded masses of many sizes
 * in one layer, drawn from a map of how much each column is clouded over. Here, what is known of
 * that map's values (sampled from it as it is drawn) and the level of it a layer's share under
 * cloud picks: the share of columns whose cover passes the level is the share of the ground
 * under cloud, whatever the noise's distribution.
 *
 * @module
 */

/** The quantiles kept of the cover's distribution: at every 1/this of it. */
export const SOFT_COVER_QUANTILES = 64;

/**
 * The distribution of a cover map's values ({@link softCoverStatistics}): its quantiles from the
 * least (0) to the most ({@link SOFT_COVER_QUANTILES}), its mean and its standard deviation.
 *
 * @group Weather
 */
export type SoftCoverStatistics = {
  quantiles: Float32Array;
  mean: number;
  deviation: number;
};

/**
 * The distribution of `samples` of a cover map (every `stride`th value from the first: one
 * channel of a pixel buffer).
 *
 * @group Weather
 */
export function softCoverStatistics(
  samples: ArrayLike<number>,
  stride = 1,
): SoftCoverStatistics {
  const count = Math.floor((samples.length + stride - 1) / stride);
  const sorted = new Float32Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sorted[i] = samples[i * stride];
    sum += sorted[i];
  }
  sorted.sort();
  const mean = count > 0 ? sum / count : 0;
  let variance = 0;
  for (let i = 0; i < count; i++) variance += (sorted[i] - mean) ** 2;
  const quantiles = new Float32Array(SOFT_COVER_QUANTILES + 1);
  for (let k = 0; k <= SOFT_COVER_QUANTILES; k++)
    quantiles[k] =
      count > 0
        ? sorted[Math.round((k / SOFT_COVER_QUANTILES) * (count - 1))]
        : 0;
  return {
    quantiles,
    mean,
    deviation: count > 0 ? Math.sqrt(variance / count) : 0,
  };
}

/**
 * The level a column's cover must pass for `share` (0 to 1) of the ground to be under cloud:
 * the cover's quantile at 1 − `share`, read between the quantiles kept. Nothing passes the level
 * for none (a little over the most), everything for all.
 *
 * @group Weather
 */
export function softCoverLevel(
  statistics: SoftCoverStatistics,
  share: number,
): number {
  const { quantiles, deviation } = statistics;
  const s = Math.min(Math.max(share, 0), 1);
  if (s <= 0)
    return quantiles[SOFT_COVER_QUANTILES] + Math.max(deviation, 1e-3);
  const at = (1 - s) * SOFT_COVER_QUANTILES;
  const k = Math.min(Math.floor(at), SOFT_COVER_QUANTILES - 1);
  const f = at - k;
  return quantiles[k] + (quantiles[k + 1] - quantiles[k]) * f;
}

/**
 * The share of a cover map's values over `level`, as its quantiles tell: the inverse of
 * {@link softCoverLevel}.
 *
 * @group Weather
 */
export function softCoverShare(
  statistics: SoftCoverStatistics,
  level: number,
): number {
  const { quantiles } = statistics;
  if (level <= quantiles[0]) return 1;
  if (level >= quantiles[SOFT_COVER_QUANTILES]) return 0;
  let k = 0;
  while (k < SOFT_COVER_QUANTILES - 1 && quantiles[k + 1] < level) k++;
  const span = quantiles[k + 1] - quantiles[k];
  const f = span > 0 ? (level - quantiles[k]) / span : 0;
  return 1 - (k + f) / SOFT_COVER_QUANTILES;
}
