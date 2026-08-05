import { Color, ColorRepresentation } from 'three';

export const idToHexColor = (num: number) =>
  `#${num.toString(16).padStart(6, '0')}`;

export function randomColor(): string {
  const letters = '123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

/**
 * Darken a color toward black, returning a `#rrggbb` string.
 *
 * The scaling is done in three's working (linear) color space, so the result is
 * a proper shade of the input rather than a naive sRGB byte scale — useful for
 * deriving banding/alternating variants of a palette color.
 *
 * @param color any three color representation (`'#rrggbb'`, `'rgb(...)'`, a CSS
 *   color name, a hex number or a `Color`)
 * @param amount fraction to darken by, `0` = unchanged, `1` = black (default 0.25)
 *
 * @group Utilities
 */
export function darkenColor(
  color: ColorRepresentation,
  amount: number = 0.25,
): string {
  const scale = Math.min(Math.max(1 - amount, 0), 1);
  return `#${new Color(color).multiplyScalar(scale).getHexString()}`;
}
