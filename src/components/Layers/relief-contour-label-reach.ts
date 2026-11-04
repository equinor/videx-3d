// ⚠️ Free of three.js: how far a relief's contour labels reach (GeoReliefContourLabels).

/**
 * Where a contour label is gone, as a fraction of what it needs on screen to be whole: its
 * rank's `spacing` along its line, and `RELIEF_CONTOUR_LABEL_LINE_PIXELS` to the next line
 * labelled. It fades in from there.
 */
export const RELIEF_CONTOUR_LABEL_FADE = 0.6;

/**
 * The least distance on screen, CSS pixels, from a contour label's line to the next one
 * labelled for the label to be whole: closer, the lines crowd too much for labels to help
 * (and the lines themselves fade out a little after, under 8 pixels apart).
 */
export const RELIEF_CONTOUR_LABEL_LINE_PIXELS = 48;

/**
 * The distance on the ground, metres, from a contour label's line to the next one labelled
 * (`step` metres higher or lower): `step` over the ground's slope there, from its `rise`
 * (metres a column east and a row south, as `ReliefContourLabelPoint`'s) and a column's and
 * a row's width. Infinity on flat ground.
 */
export function reliefContourLineGap(
  rise: readonly [number, number],
  step: number,
  columnMetres: number,
  rowMetres: number,
): number {
  const slope = Math.hypot(rise[0] / columnMetres, rise[1] / rowMetres);
  return slope > 0 ? step / slope : Infinity;
}

/**
 * A contour label's reach class: how far from the camera it is whole, as `unit · 2^-class`
 * times the camera's focal length (CSS pixels a metre across at a metre's distance), the
 * labels of a class in one `LabelLayer` (see {@link reliefContourLabelClassReach}). The
 * nearer of where its rank's spacing along its line is `spacing` on screen —
 * `unit · 2^-kind`, `kind` its tile's depth plus its rank, `unit` a depth-0 tile's row on
 * the ground times `2 / cellPixels` — and where its line is
 * {@link RELIEF_CONTOUR_LABEL_LINE_PIXELS} from the next labelled, `gap` metres off (see
 * {@link reliefContourLineGap}): rounded down to the class below, so a label limited by its
 * spacing alone is its `kind`'s.
 */
export function reliefContourLabelClass(
  unit: number,
  kind: number,
  gap: number,
): number {
  const reach = Math.min(
    unit * 2 ** -kind,
    gap / RELIEF_CONTOUR_LABEL_LINE_PIXELS,
  );
  if (!(reach > 0)) return Infinity;
  return Math.max(kind, Math.ceil(Math.log2(unit / reach) - 1e-9));
}

/**
 * How far from the camera a contour label reach class's labels are whole, and where they
 * are gone ({@link RELIEF_CONTOUR_LABEL_FADE}), for a camera `focal` CSS pixels a metre
 * across at a metre's distance.
 */
export function reliefContourLabelClassReach(
  unit: number,
  reachClass: number,
  focal: number,
): [whole: number, gone: number] {
  const whole = unit * 2 ** -reachClass * focal;
  return [whole, whole / RELIEF_CONTOUR_LABEL_FADE];
}
