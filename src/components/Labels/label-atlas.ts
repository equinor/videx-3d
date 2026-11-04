import {
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
} from 'three';
import {
  LABEL_CELL_HEIGHT,
  LABEL_CELL_PADDING,
  labelFont,
  labelFontKey,
  labelFontMetrics,
  labelLineWidth,
  layoutLabelText,
  resetLabelFontMetrics,
  setLabelFont,
  type LabelFontStyle,
  type LabelTextStyle,
} from './label-text';

/** A place in a {@link ShelfPacker}'s area, in its pixels: from its top left. */
export type PackedRect = { x: number; y: number };

/**
 * Packs rectangles into an area in rows (shelves), first fit, `gutter` pixels apart and
 * from the edges. Pure.
 */
export class ShelfPacker {
  private shelves: { y: number; height: number; x: number }[] = [];
  private bottom: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly gutter = 4,
  ) {
    this.bottom = gutter;
  }

  /** Where a `width` × `height` rectangle goes, or null if it does not fit. */
  pack(width: number, height: number): PackedRect | null {
    const { gutter } = this;
    if (width + 2 * gutter > this.width) return null;
    for (const shelf of this.shelves) {
      // A shelf no more than half again as tall: not to waste most of a tall one.
      if (
        height <= shelf.height &&
        height * 1.5 >= shelf.height &&
        shelf.x + width + gutter <= this.width
      ) {
        const placed = { x: shelf.x, y: shelf.y };
        shelf.x += width + gutter;
        return placed;
      }
    }
    if (this.bottom + height + gutter > this.height) return null;
    const shelf = { y: this.bottom, height, x: gutter + width + gutter };
    this.shelves.push(shelf);
    this.bottom += height + gutter;
    return { x: gutter, y: shelf.y };
  }
}

/** The font size glyphs are drawn in the atlas at, in its pixels. */
export const LABEL_RASTER_SIZE = 48;

/** What a glyph's look in the atlas depends on: its font and halo width; not its colours. */
export type LabelGlyphStyle = LabelFontStyle &
  Pick<LabelTextStyle, 'haloWidth'>;

/** The key a glyph is kept by in a {@link LabelAtlas}: its character, font and halo width. */
export const labelGlyphKey = (char: string, style: LabelGlyphStyle) =>
  `${labelFontKey(style)}|${style.haloWidth}|${char}`;

/**
 * A glyph in a {@link LabelAtlas}: its index in the atlas's glyph table, where its cell is,
 * in texture coordinates (`v0` its top row), and the cell's box about its pen on its line's
 * middle, in ems: from `x0` to `x1` along, `half` up and down.
 */
export type LabelGlyphEntry = {
  index: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  x0: number;
  x1: number;
  half: number;
};

/** Texels a glyph takes in a {@link LabelAtlas}'s glyph table: its cell (u0, v0, u1, v1) and its box (x0, x1, half, 0). */
export const LABEL_GLYPH_TEXELS = 2;

/** Texels across a {@link LabelAtlas}'s glyph table: 1024 glyphs a row. */
export const LABEL_GLYPHS_WIDTH = 2048;

/** Floats per glyph of a {@link LabelTextRun}: its index in the glyph table, its pen's place from its cell's left in ems, its line, 0. */
export const LABEL_RUN_FLOATS = 4;

/**
 * A text in a {@link LabelAtlas}'s glyphs, as a label draws it: each glyph with ink
 * ({@link LABEL_RUN_FLOATS} each, `count` of them), in order, line by line; its lines; its
 * cell's size in ems, its halo included; and its ink's, the box its glyphs and halo fill,
 * about its middle either way (so mirrored, turned half round, it is the same): what labels
 * keep apart on screen.
 */
export type LabelTextRun = {
  glyphs: Float32Array;
  count: number;
  lines: number;
  width: number;
  height: number;
  inkWidth: number;
  inkHeight: number;
};

const MAX_SIZE = 8192;
// Texts laid out kept at the most: cleared past it.
const MAX_RUNS = 50000;

/** A CSS font family list's names, unquoted and in lower case: to match a `FontFace`'s. */
export const labelFontFamilies = (fontFamily: string) =>
  fontFamily
    .split(',')
    .map(name =>
      name
        .trim()
        .replace(/^(["'])(.*)\1$/, '$2')
        .toLowerCase(),
    )
    .filter(Boolean);

/**
 * The labels' glyphs, each drawn once with the canvas API into one texture — per character,
 * font and halo width, however many texts use it — and the texts as runs of them
 * (`text`). A glyph's fill's coverage is in red, its halo's (the fill's within it) in green,
 * so its colours are the layer's to choose; its cell and box are in a float texture, the
 * glyph table (`glyphTable`), for the labels' shader to find. Mipmapped, so far labels stay
 * smooth; magnified past `LABEL_RASTER_SIZE`, the labels' shader keeps their edges about a
 * pixel wide.
 *
 * Texts are laid out glyph by glyph (`layoutLabelText`): each character's advance and each
 * pair's kerning as the canvas sets them (`LabelFontMetrics`), letter spacing and line
 * breaks the layout's. So 600 names of 20 characters take some 70 glyphs, not 600 texts'
 * room.
 *
 * Glyphs are added as they are asked for and kept; when the texture is full, `repack` draws
 * it again with only those of the texts its users still draw, larger if they need it.
 *
 * A font the page declares (`@font-face`) but has not loaded is asked for as a glyph is
 * drawn in it; drawn meanwhile in the family's next font, its glyphs are drawn and measured
 * again once it is in (`generation` changes, as when packed again).
 */
export class LabelAtlas {
  size: number;
  texture: DataTexture;
  /** each glyph's cell and box (`LABEL_GLYPH_TEXELS` texels, `LABEL_GLYPHS_WIDTH` a row) */
  glyphTable: DataTexture;
  /** bumped whenever its glyphs change; its textures may be new ones */
  version = 0;
  /** bumped whenever it is packed again: every user's runs are then stale */
  generation = 0;
  private data: Uint8Array;
  private packer: ShelfPacker;
  private glyphs = new Map<string, LabelGlyphEntry>();
  private table: Float32Array;
  private runs = new Map<string, LabelTextRun>();
  private ctx: CanvasRenderingContext2D;
  // The texts each user draws, kept when it is packed again.
  private users = new Map<
    object,
    [readonly { text: string }[], LabelTextStyle]
  >();
  private anisotropy = 1;
  // Uploaded whole at its next upload — made anew, packed again or freed on the GPU — till
  // three tells it has uploaded it (`onUpdate`); after, only the rows glyphs were drawn
  // into since (`queued`).
  private whole = true;
  private queued: Uint8Array;
  // The fonts asked of the page so far, and every family drawn in.
  private requested = new Set<string>();
  private families = new Set<string>();
  private fonts: FontFaceSet | null = null;
  private listening = false;
  private onFontsLoaded = (event: Event) => {
    const faces = (event as FontFaceSetLoadEvent).fontfaces ?? [];
    if (
      faces.some(face => this.families.has(labelFontFamilies(face.family)[0]))
    ) {
      resetLabelFontMetrics();
      this.repack();
    }
  };

  constructor(size = 1024) {
    this.size = size;
    this.data = new Uint8Array(size * size * 2);
    this.queued = new Uint8Array(size);
    this.packer = new ShelfPacker(size, size);
    this.texture = this.createTexture();
    this.table = new Float32Array(LABEL_GLYPHS_WIDTH * 4);
    this.glyphTable = this.createTable();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw Error('Unable to create canvas drawing context!');
    this.ctx = ctx;
    this.fonts = document.fonts ?? null;
    this.listen();
  }

  /** the glyphs in it */
  get count() {
    return this.glyphs.size;
  }

  /**
   * Filter it anisotropically, `samples` deep: labels lying flat and seen at a slant stay
   * sharp along their length. The renderer's most (`capabilities.getMaxAnisotropy()`).
   */
  setAnisotropy(samples: number) {
    if (this.anisotropy === samples) return;
    this.anisotropy = samples;
    this.texture.anisotropy = samples;
    this.uploadWhole();
  }

  /** `char`, drawn in `style`, drawing it if it is not yet; null if it is full. */
  glyph(char: string, style: LabelGlyphStyle): LabelGlyphEntry | null {
    const key = labelGlyphKey(char, style);
    const found = this.glyphs.get(key);
    if (found) return found;
    const added = this.draw(char, style);
    if (added) {
      this.glyphs.set(key, added);
      this.queueRows(
        Math.round(added.v0 * this.size),
        Math.round(added.v1 * this.size),
      );
      this.texture.needsUpdate = true;
      this.version++;
    }
    return added;
  }

  /**
   * `text` in `style`, as a run of its glyphs (`layoutLabelText`), drawing those it has not
   * yet; null if it is full. Kept, so the same text is laid out once.
   */
  text(text: string, style: LabelTextStyle): LabelTextRun | null {
    const key = `${labelFontKey(style)}|${style.haloWidth}|${style.letterSpacing}|${style.align}|${text}`;
    const found = this.runs.get(key);
    if (found) return found;
    const layout = layoutLabelText(text, style, labelFontMetrics(style));
    const glyphs = new Float32Array(layout.chars.length * LABEL_RUN_FLOATS);
    for (let i = 0; i < layout.chars.length; i++) {
      const glyph = this.glyph(layout.chars[i], style);
      if (!glyph) return null;
      glyphs[i * LABEL_RUN_FLOATS] = glyph.index;
      glyphs[i * LABEL_RUN_FLOATS + 1] = layout.xs[i];
      glyphs[i * LABEL_RUN_FLOATS + 2] = layout.lines[i];
    }
    const run: LabelTextRun = {
      glyphs,
      count: layout.chars.length,
      lines: layout.lineCount,
      width: layout.width,
      height: layout.height,
      inkWidth: layout.inkWidth,
      inkHeight: layout.inkHeight,
    };
    if (this.runs.size >= MAX_RUNS) this.runs.clear();
    this.runs.set(key, run);
    return run;
  }

  /** How wide `line` is set in `style`, in ems of its font, its halo left out: for wrapping. */
  measure(line: string, style: LabelTextStyle) {
    return labelLineWidth(line, style.letterSpacing, labelFontMetrics(style));
  }

  /** Keep `user`'s texts, in `style`, whenever it is packed again (see `repack`). */
  track(
    user: object,
    texts: readonly { text: string }[],
    style: LabelTextStyle,
  ) {
    this.users.set(user, [texts, style]);
  }

  /** Stop keeping `user`'s texts. */
  untrack(user: object) {
    this.users.delete(user);
  }

  /**
   * Draw it again with only the glyphs of the texts its users draw (see `track`), when it
   * is full or its fonts came in: every user must then lay its texts out again
   * (`generation` changes).
   */
  repack() {
    const users = [...this.users.values()];
    this.rebuild(
      (function* () {
        for (const [texts, style] of users)
          for (const { text } of texts)
            yield [text, style] as [string, LabelTextStyle];
      })(),
    );
    this.generation++;
  }

  /**
   * Empty it and draw the glyphs of `texts` again, only those: in a larger texture if they
   * do not fit. Their indices, and maybe the textures, are new.
   */
  rebuild(texts: Iterable<[string, LabelGlyphStyle]>) {
    const wanted = new Map<string, [string, LabelGlyphStyle]>();
    for (const [text, style] of texts) {
      const metrics = labelFontMetrics(style);
      for (const char of text) {
        const key = labelGlyphKey(char, style);
        if (!wanted.has(key) && metrics.glyph(char).ink)
          wanted.set(key, [char, style]);
      }
    }
    this.runs.clear();
    for (let size = this.size; size <= MAX_SIZE; size *= 2) {
      if (size !== this.size) {
        this.size = size;
        this.data = new Uint8Array(size * size * 2);
        this.queued = new Uint8Array(size);
        this.texture.dispose();
        this.texture = this.createTexture();
      } else {
        this.data.fill(0);
      }
      // All of it drawn again: uploaded whole.
      this.uploadWhole();
      this.packer = new ShelfPacker(size, size);
      this.glyphs.clear();
      let fits = true;
      for (const [char, style] of wanted.values()) {
        if (!this.glyph(char, style)) {
          fits = false;
          break;
        }
      }
      if (fits) break;
    }
    this.glyphTable.needsUpdate = true;
    this.texture.needsUpdate = true;
    this.version++;
  }

  /** Free its textures and stop listening for fonts; used again, it starts again. */
  dispose() {
    this.fonts?.removeEventListener?.('loadingdone', this.onFontsLoaded);
    this.listening = false;
    this.texture.dispose();
    this.glyphTable.dispose();
  }

  // Listen for the page's fonts coming in, once.
  private listen() {
    if (this.listening || !this.fonts?.addEventListener) return;
    this.listening = true;
    this.fonts.addEventListener('loadingdone', this.onFontsLoaded);
  }

  // Ask the page for `font` if it declares it and has not loaded it: once in, the
  // 'loadingdone' event draws its glyphs again (onFontsLoaded).
  private request(font: string, family: string, text: string) {
    for (const name of labelFontFamilies(family)) this.families.add(name);
    this.listen();
    const fonts = this.fonts;
    if (!fonts || this.requested.has(font)) return;
    this.requested.add(font);
    try {
      if (!fonts.check(font, text)) fonts.load(font, text).catch(() => {});
    } catch {
      // Not a font the page can parse: drawn as the canvas falls back.
    }
  }

  private createTexture() {
    const texture = new DataTexture(
      this.data,
      this.size,
      this.size,
      RGFormat,
      UnsignedByteType,
    );
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.anisotropy;
    texture.needsUpdate = true;
    // Freed on the GPU (by its group, or anyone), it is made anew at its next use from what
    // is to upload: the whole of it, not the rows last queued.
    texture.addEventListener('dispose', () => {
      if (texture === this.texture) this.uploadWhole();
    });
    // Uploaded: rows will do from now on.
    texture.onUpdate = () => {
      if (texture !== this.texture) return;
      this.whole = false;
      this.queued.fill(0);
    };
    this.whole = true;
    return texture;
  }

  private createTable() {
    const texture = new DataTexture(
      this.table,
      LABEL_GLYPHS_WIDTH,
      this.table.length / (LABEL_GLYPHS_WIDTH * 4),
      RGBAFormat,
      FloatType,
    );
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  // Upload it whole at its next upload: nothing queued, so three uploads all of it.
  private uploadWhole() {
    this.whole = true;
    this.texture.clearUpdateRanges();
    this.queued.fill(0);
    this.texture.needsUpdate = true;
  }

  // Queue rows `from` to `to` (not `to`) to upload, each its whole width once: three takes
  // a range a row at a time, in RGBA elements (four a texel) whatever the format, so a
  // row's range is four times its texels.
  private queueRows(from: number, to: number) {
    if (this.whole) return;
    const { size, queued, texture } = this;
    for (let row = Math.max(from, 0); row < Math.min(to, size); row++) {
      if (queued[row]) continue;
      queued[row] = 1;
      texture.addUpdateRange(row * size * 4, size * 4);
    }
  }

  // Draw `char` into a free place — its fill into red, its halo into green — and its cell
  // and box into the glyph table.
  private draw(char: string, style: LabelGlyphStyle): LabelGlyphEntry | null {
    const { ctx } = this;
    const R = LABEL_RASTER_SIZE;
    this.request(labelFont(style, R), style.fontFamily, char);
    const metrics = labelFontMetrics(style).glyph(char);
    const halo = Math.max(style.haloWidth, 0) * R;
    const padding = LABEL_CELL_PADDING * R;
    const width = Math.max(
      Math.ceil((metrics.left + metrics.right) * R + 2 * halo + 2 * padding),
      1,
    );
    const height = Math.ceil(LABEL_CELL_HEIGHT * R + 2 * halo);
    const place = this.packer.pack(width, height);
    if (!place) return null;
    // Its pen, so its ink starts its halo and padding in.
    const x = padding + halo + metrics.left * R;

    const { canvas } = ctx;
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, width);
      canvas.height = Math.max(canvas.height, height);
    }
    const coverage = (withHalo: boolean) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // Set again: resizing the canvas resets its state.
      setLabelFont(ctx, style, R);
      ctx.fillStyle = '#fff';
      if (withHalo && halo > 0) {
        ctx.strokeStyle = '#fff';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2 * halo;
        ctx.strokeText(char, x, height / 2);
      }
      ctx.fillText(char, x, height / 2);
      return ctx.getImageData(0, 0, width, height).data;
    };
    const fill = coverage(false);
    const outline = coverage(true);
    const { data, size } = this;
    for (let row = 0; row < height; row++) {
      let to = ((place.y + row) * size + place.x) * 2;
      let from = row * width * 4 + 3;
      for (let col = 0; col < width; col++, to += 2, from += 4) {
        data[to] = fill[from];
        data[to + 1] = outline[from];
      }
    }
    const entry: LabelGlyphEntry = {
      index: this.glyphs.size,
      u0: place.x / size,
      v0: place.y / size,
      u1: (place.x + width) / size,
      v1: (place.y + height) / size,
      x0: -(padding + halo) / R - metrics.left,
      x1: -(padding + halo) / R - metrics.left + width / R,
      half: height / 2 / R,
    };
    this.setTableRow(entry);
    return entry;
  }

  // Write `entry` into the glyph table, grown to hold it.
  private setTableRow(entry: LabelGlyphEntry) {
    const at = entry.index * LABEL_GLYPH_TEXELS * 4;
    if (at + LABEL_GLYPH_TEXELS * 4 > this.table.length) {
      const grown = new Float32Array(this.table.length * 2);
      grown.set(this.table);
      this.table = grown;
      this.glyphTable.dispose();
      this.glyphTable = this.createTable();
    }
    const t = this.table;
    t[at] = entry.u0;
    t[at + 1] = entry.v0;
    t[at + 2] = entry.u1;
    t[at + 3] = entry.v1;
    t[at + 4] = entry.x0;
    t[at + 5] = entry.x1;
    t[at + 6] = entry.half;
    t[at + 7] = 0;
    this.glyphTable.needsUpdate = true;
  }
}
