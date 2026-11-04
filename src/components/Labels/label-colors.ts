import { Color, SRGBColorSpace, Vector4 } from 'three';

const RGBA = /^rgba?\(([^)]*)\)$/i;
const HEX_ALPHA = /^#([0-9a-f]{6})([0-9a-f]{2})$/i;

/** Set `color` from a CSS colour, its alpha left out; the alpha. */
export function cssColorAlpha(css: string, color: Color) {
  const text = css.trim();
  const rgba = RGBA.exec(text);
  if (rgba) {
    const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
    color.setStyle(`rgb(${parts.slice(0, 3).join(',')})`);
    if (parts.length < 4) return 1;
    const alpha = parseFloat(parts[3]);
    return parts[3].endsWith('%') ? alpha / 100 : alpha;
  }
  const hex = HEX_ALPHA.exec(text);
  if (hex) {
    color.setStyle(`#${hex[1]}`);
    return parseInt(hex[2], 16) / 255;
  }
  color.setStyle(text);
  return 1;
}

const scratchColor = new Color();
const scratchRgb = { r: 0, g: 0, b: 0 };

/**
 * A CSS colour in display (sRGB) values, 0 to 1, and its alpha (x, y, z and w of `target`):
 * as a canvas mixes colours, not as the scene does.
 */
export function cssDisplayColor(css: string, target: Vector4) {
  const alpha = cssColorAlpha(css, scratchColor);
  scratchColor.getRGB(scratchRgb, SRGBColorSpace);
  return target.set(scratchRgb.r, scratchRgb.g, scratchRgb.b, alpha);
}
