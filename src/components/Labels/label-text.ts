import type { LabelStyle } from './types';

// ⚠️ Free of three.js. `wrapLabelText` and `layoutLabelText` are pure; the metrics measure
// on a canvas.

/** The distance between a label's lines, middle to middle, in ems of its font. */
export const LABEL_LINE_HEIGHT = 1.2;

/** A text cell's height for one line, in ems, its halo left out: room above and below the ink. */
export const LABEL_CELL_HEIGHT = 1.3;

/** Room left round a text's ink and halo, each side, in ems (2 pixels at 48). */
export const LABEL_CELL_PADDING = 2 / 48;

/** The font a label's glyphs are drawn in: what their shapes depend on, layout aside. */
export type LabelFontStyle = Pick<
  LabelStyle,
  'fontFamily' | 'fontWeight' | 'fontStyle'
>;

/** What a label's text's layout depends on: its font, spacing and halo, and its alignment. */
export type LabelTextStyle = LabelFontStyle &
  Pick<LabelStyle, 'letterSpacing' | 'haloWidth' | 'align'>;

/** The CSS font a label's text is drawn and measured in, at `size` pixels. */
export const labelFont = (style: LabelFontStyle, size: number) =>
  `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;

/** The key a font's glyphs and metrics are kept by. */
export const labelFontKey = (style: LabelFontStyle) =>
  `${style.fontStyle}|${style.fontWeight}|${style.fontFamily}`;

// A context that can measure and draw text.
type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Set `ctx` to draw and measure glyphs in `style` at `size` pixels, one at a time: its font,
 * no letter spacing (the layout's, `layoutLabelText`), left aligned on the middle baseline.
 */
export function setLabelFont(
  ctx: TextContext,
  style: LabelFontStyle,
  size: number,
) {
  ctx.font = labelFont(style, size);
  const spaced = ctx as TextContext & { letterSpacing?: string };
  if ('letterSpacing' in spaced) spaced.letterSpacing = '0px';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
}

/**
 * A character's metrics in a font, in ems: how far it moves the pen, and its ink about the
 * pen — left of it, right of it, above its line's middle and below. `ink` false for one
 * that draws nothing (a space).
 */
export type LabelGlyphMetrics = {
  advance: number;
  left: number;
  right: number;
  up: number;
  down: number;
  ink: boolean;
};

/** The pixels a font is measured at: as large as the atlas draws it, so hinting rounds alike. */
export const LABEL_MEASURE_SIZE = 48;

/**
 * A font's metrics, measured on a canvas as asked for and kept: each character's
 * (`LabelGlyphMetrics`) and each pair's kerning — what the font's own pair adjustments move
 * the second by, as the canvas sets text: the pair's width less its characters' — all in
 * ems. Without a canvas (outside a browser), estimates: 0.6 ems a character, no kerning.
 */
export class LabelFontMetrics {
  private glyphs = new Map<string, LabelGlyphMetrics>();
  private pairs = new Map<string, number>();

  constructor(
    readonly style: LabelFontStyle,
    private readonly ctx: TextContext | null,
  ) {}

  /** `char`'s metrics: one character (a code point). */
  glyph(char: string): LabelGlyphMetrics {
    let found = this.glyphs.get(char);
    if (found) return found;
    const { ctx } = this;
    if (!ctx) {
      const ink = char.trim().length > 0;
      found = {
        advance: 0.6,
        left: 0,
        right: ink ? 0.55 : 0,
        up: ink ? 0.4 : 0,
        down: ink ? 0.3 : 0,
        ink,
      };
    } else {
      setLabelFont(ctx, this.style, LABEL_MEASURE_SIZE);
      const m = ctx.measureText(char);
      const known = (v: number) => (Number.isFinite(v) ? v : 0);
      const left = known(m.actualBoundingBoxLeft) / LABEL_MEASURE_SIZE;
      const right = known(m.actualBoundingBoxRight) / LABEL_MEASURE_SIZE;
      const up = known(m.actualBoundingBoxAscent) / LABEL_MEASURE_SIZE;
      const down = known(m.actualBoundingBoxDescent) / LABEL_MEASURE_SIZE;
      found = {
        advance: m.width / LABEL_MEASURE_SIZE,
        left,
        right,
        up,
        down,
        ink: left + right > 0 && up + down > 0,
      };
    }
    this.glyphs.set(char, found);
    return found;
  }

  /** How far the pen moves `second` after `first` beyond their advances: their kerning. */
  kerning(first: string, second: string): number {
    const { ctx } = this;
    if (!ctx) return 0;
    const key = first + second;
    let found = this.pairs.get(key);
    if (found === undefined) {
      setLabelFont(ctx, this.style, LABEL_MEASURE_SIZE);
      found =
        ctx.measureText(key).width / LABEL_MEASURE_SIZE -
        this.glyph(first).advance -
        this.glyph(second).advance;
      // Rounding, not kerning.
      if (Math.abs(found) < 1e-3) found = 0;
      this.pairs.set(key, found);
    }
    return found;
  }
}

let shared: TextContext | null | undefined;

// A context to measure on, made once; null where there is no canvas (outside a browser).
function measuringContext(): TextContext | null {
  if (shared !== undefined) return shared;
  shared = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined')
      shared = new OffscreenCanvas(1, 1).getContext('2d');
    else if (typeof document !== 'undefined')
      shared = document.createElement('canvas').getContext('2d');
  } catch {
    shared = null;
  }
  return shared;
}

const fonts = new Map<string, LabelFontMetrics>();

/** The metrics of `style`'s font, measured as asked for and kept (see {@link LabelFontMetrics}). */
export function labelFontMetrics(style: LabelFontStyle): LabelFontMetrics {
  const key = labelFontKey(style);
  let found = fonts.get(key);
  if (!found) {
    found = new LabelFontMetrics(
      {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
      },
      measuringContext(),
    );
    fonts.set(key, found);
  }
  return found;
}

/**
 * Forget every font's metrics: measured again as asked for. For when the page's fonts come
 * in, and the fonts standing in for them were measured.
 */
export function resetLabelFontMetrics() {
  fonts.clear();
}

/**
 * How wide one line of text is set, in ems: its characters' advances, their kerning and
 * `letterSpacing` (ems) between each two.
 */
export function labelLineWidth(
  line: string,
  letterSpacing: number,
  metrics: LabelFontMetrics,
) {
  let width = 0;
  let previous: string | null = null;
  for (const char of line) {
    if (previous !== null)
      width += metrics.kerning(previous, char) + (letterSpacing || 0);
    width += metrics.glyph(char).advance;
    previous = char;
  }
  return width;
}

/**
 * A label's text laid out glyph by glyph, in ems: each character with ink (`chars`), its
 * pen's place from its cell's left edge (`xs`) and its line (`lines`); its lines' count; its
 * cell's size, halo and padding included; and its ink's — the box its glyphs and halo fill —
 * about the cell's middle either way, so the same turned half round.
 */
export type LabelTextLayout = {
  chars: string[];
  xs: number[];
  lines: number[];
  lineCount: number;
  width: number;
  height: number;
  inkWidth: number;
  inkHeight: number;
};

/**
 * Lay a label's text out glyph by glyph, as the atlas's glyphs are drawn and placed: each
 * line (split at `\n`) {@link LABEL_LINE_HEIGHT} below the last, its characters advanced by
 * the font's metrics, its kerning and `letterSpacing`, the lines aligned by `style.align`,
 * in a cell its halo and {@link LABEL_CELL_PADDING} wider each side than its widest line,
 * {@link LABEL_CELL_HEIGHT} ems high a line and its halo more. Characters, not shaped:
 * ligatures and scripts that join their letters are not.
 */
export function layoutLabelText(
  text: string,
  style: LabelTextStyle,
  metrics: LabelFontMetrics,
): LabelTextLayout {
  const halo = Math.max(style.haloWidth, 0);
  const spacing = style.letterSpacing || 0;
  const rows = text.split('\n');
  const widths = rows.map(row => labelLineWidth(row, spacing, metrics));
  const widest = Math.max(...widths);
  const width = widest + 2 * halo + 2 * LABEL_CELL_PADDING;
  const height =
    LABEL_CELL_HEIGHT + (rows.length - 1) * LABEL_LINE_HEIGHT + 2 * halo;
  const chars: string[] = [];
  const xs: number[] = [];
  const lines: number[] = [];
  // Its ink about the cell's middle, either way.
  let across = 0;
  let up = 0;
  let inked = false;
  rows.forEach((row, line) => {
    const aligned =
      rows.length > 1 && style.align === 'left'
        ? 0
        : rows.length > 1 && style.align === 'right'
          ? widest - widths[line]
          : (widest - widths[line]) / 2;
    // Its middle below the cell's.
    const middle = (line - (rows.length - 1) / 2) * LABEL_LINE_HEIGHT;
    let pen = halo + LABEL_CELL_PADDING + aligned;
    let previous: string | null = null;
    for (const char of row) {
      if (previous !== null) pen += metrics.kerning(previous, char) + spacing;
      const glyph = metrics.glyph(char);
      if (glyph.ink) {
        chars.push(char);
        xs.push(pen);
        lines.push(line);
        inked = true;
        across = Math.max(
          across,
          Math.abs(pen - glyph.left - width / 2),
          Math.abs(pen + glyph.right - width / 2),
        );
        up = Math.max(
          up,
          Math.abs(middle - glyph.up),
          Math.abs(middle + glyph.down),
        );
      }
      pen += glyph.advance;
      previous = char;
    }
  });
  return {
    chars,
    xs,
    lines,
    lineCount: rows.length,
    width,
    height,
    inkWidth: inked ? Math.min(2 * across + 2 * halo, width) : 0,
    inkHeight: inked ? Math.min(2 * up + 2 * halo, height) : 0,
  };
}

/**
 * A text broken into lines, a way for each count of lines up to `maxLines`: the fewest
 * lines first, the text as it is, then each count's balanced break — at spaces, its widest
 * line as narrow as it can be (`measure` a line's width) — where that is narrower than the
 * fewer lines' by 2 % or more. A text with line breaks of its own, or of one word, is
 * kept as it is.
 */
export function wrapLabelText(
  text: string,
  measure: (line: string) => number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  if (text.includes('\n') || n < 2 || maxLines < 2) return [text];
  const widths = new Map<number, number>();
  // The width of words i to j (not j).
  const width = (i: number, j: number) => {
    const key = i * (n + 1) + j;
    let found = widths.get(key);
    if (found === undefined) {
      found = measure(words.slice(i, j).join(' '));
      widths.set(key, found);
    }
    return found;
  };
  const variants = [text];
  let narrowest = width(0, n);
  // widest[j]: the least widest line of words 0 to j in so many lines; from[k][j]: where
  // its last line starts, in k + 1 lines.
  let widest = new Float64Array(n + 1);
  for (let j = 1; j <= n; j++) widest[j] = width(0, j);
  const from: Int32Array[] = [new Int32Array(n + 1)];
  for (let k = 2; k <= Math.min(maxLines, n); k++) {
    const next = new Float64Array(n + 1).fill(Infinity);
    const starts = new Int32Array(n + 1);
    for (let j = k; j <= n; j++) {
      for (let i = k - 1; i < j; i++) {
        const w = Math.max(widest[i], width(i, j));
        if (w < next[j]) {
          next[j] = w;
          starts[j] = i;
        }
      }
    }
    widest = next;
    from.push(starts);
    if (!(widest[n] <= narrowest * 0.98)) continue;
    narrowest = widest[n];
    const lines: string[] = [];
    for (let line = k - 1, end = n; line >= 0; line--) {
      const start = line > 0 ? from[line][end] : 0;
      lines.unshift(words.slice(start, end).join(' '));
      end = start;
    }
    variants.push(lines.join('\n'));
  }
  return variants;
}

/** A way of breaking a label's text into lines, and its size, in ems (see {@link labelTextVariants}). */
export type LabelTextVariant = {
  text: string;
  lines: number;
  /** its cell's, as the atlas lays it out, halo and padding included */
  width: number;
  height: number;
  /** its ink's: the box its glyphs and halo fill */
  inkWidth: number;
  inkHeight: number;
};

/**
 * The ways `text` breaks into lines in `style`, up to `maxLines` ({@link wrapLabelText}),
 * each with its size in ems as a label lays it out (`layoutLabelText`): for fitting a label
 * to a place, as `GeoLabels` fits a polygon's name in it. Measured on a canvas in the
 * page's fonts as they are: a font not loaded yet measures as the one standing in for it.
 */
export function labelTextVariants(
  text: string,
  style: LabelTextStyle,
  maxLines: number,
): LabelTextVariant[] {
  const metrics = labelFontMetrics(style);
  const measure = (line: string) =>
    labelLineWidth(line, style.letterSpacing, metrics);
  return wrapLabelText(text, measure, maxLines).map(variant => {
    const layout = layoutLabelText(variant, style, metrics);
    return {
      text: variant,
      lines: layout.lineCount,
      width: layout.width,
      height: layout.height,
      inkWidth: layout.inkWidth,
      inkHeight: layout.inkHeight,
    };
  });
}
