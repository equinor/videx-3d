/**
 * A corner of its container an overlay (`Panel`, `RenderStats`, `Minimap`) is anchored to.
 *
 * @group Utils
 */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** The CSS offsets of an absolutely positioned element anchored to a corner. */
export type CornerStyle = {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
};

/**
 * The CSS `left`/`right`/`top`/`bottom` that anchor an absolutely positioned element to
 * `corner` of its container, `offset` pixels in from it along X and Y: the one place the
 * overlays agree on what each corner means.
 *
 * @param corner the corner
 * @param offset pixels in from the corner, `[x, y]`
 *
 * @group Utils
 */
export function cornerStyle(
  corner: Corner,
  offset: readonly [number, number],
): CornerStyle {
  const x = `${offset[0]}px`;
  const y = `${offset[1]}px`;
  switch (corner) {
    case 'top-left':
      return { left: x, top: y };
    case 'top-right':
      return { right: x, top: y };
    case 'bottom-right':
      return { right: x, bottom: y };
    default:
      return { left: x, bottom: y };
  }
}
