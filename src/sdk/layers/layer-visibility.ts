// ⚠️ Free of three.js.

/**
 * When a layer shows, by the camera's height over the sea (metres): fully between
 * `minHeight` and `maxHeight`, fading out past each over `fade`.
 *
 * @group Layers
 */
export type LayerVisibility = {
  /** Default true */
  visible?: boolean;
  /** below this height the layer fades out; omitted, never */
  minHeight?: number;
  /** above this height the layer fades out; omitted, never */
  maxHeight?: number;
  /**
   * how far past a bound the layer is gone, as a ratio of the bound: a layer up to 50 km
   * with `fade` 0.2 is gone at 60 km. Heights span orders of magnitude, so a ratio fades
   * alike at 1 km and at 1000 km. 0 cuts at the bound. Default 0.2
   */
  fade?: number;
};

/**
 * How much of a layer shows (0 to 1) with the camera `height` metres over the sea (see
 * {@link LayerVisibility}).
 *
 * @group Layers
 */
export function layerVisibilityAt(
  height: number,
  { visible = true, minHeight, maxHeight, fade = 0.2 }: LayerVisibility,
): number {
  if (!visible) return 0;
  let opacity = 1;
  if (maxHeight !== undefined && height > maxHeight) {
    const gone = maxHeight * (1 + fade);
    opacity =
      gone > maxHeight ? Math.max(0, (gone - height) / (gone - maxHeight)) : 0;
  }
  if (minHeight !== undefined && height < minHeight) {
    const gone = minHeight > 0 ? minHeight / (1 + fade) : minHeight;
    opacity *=
      minHeight > gone ? Math.max(0, (height - gone) / (minHeight - gone)) : 0;
  }
  return opacity;
}
