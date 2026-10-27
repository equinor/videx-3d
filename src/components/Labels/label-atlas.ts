import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  UnsignedByteType,
} from 'three';
import type { LabelStyle } from './types';

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

/** The font size texts are drawn in the atlas at, in its pixels. */
export const LABEL_RASTER_SIZE = 48;

/**
 * A text in a {@link LabelAtlas}: where it is, in texture coordinates (`v0` its top row),
 * and its size, in ems of its font, its halo included.
 */
export type LabelAtlasEntry = {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  width: number;
  height: number;
};

// What a text's look in the atlas depends on: not its colours, which are the layer's.
type AtlasStyle = Pick<
  LabelStyle,
  'fontFamily' | 'fontWeight' | 'fontStyle' | 'letterSpacing' | 'haloWidth'
>;

/** The key a text is kept by in a {@link LabelAtlas}: it and all of its style the atlas draws. */
export const labelAtlasKey = (text: string, style: AtlasStyle) =>
  `${style.fontStyle}|${style.fontWeight}|${style.fontFamily}|${style.letterSpacing}|${style.haloWidth}|${text}`;

/** The CSS font a {@link LabelAtlas} draws a style's texts in, at `size` pixels. */
export const labelAtlasFont = (style: AtlasStyle, size: number) =>
  `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;

const MAX_SIZE = 8192;

/**
 * The labels' texts, each drawn once with the canvas API into one texture: its fill's
 * coverage in red, its halo's (the fill's within it) in green, so its colours are the
 * layer's to choose. Mipmapped, so far labels stay smooth; magnified past
 * `LABEL_RASTER_SIZE` they grow soft.
 *
 * Texts are added as they are asked for and kept; when the texture is full, `repack` packs
 * it again with only those its users still draw, larger if they need it.
 */
export class LabelAtlas {
  size: number;
  texture: DataTexture;
  /** bumped whenever its texts change; its `texture` may be a new one */
  version = 0;
  /** bumped whenever it is packed again: every user's entries are then stale */
  generation = 0;
  private data: Uint8Array;
  private packer: ShelfPacker;
  private entries = new Map<string, LabelAtlasEntry>();
  private ctx: CanvasRenderingContext2D;
  // The texts each user draws, kept when it is packed again.
  private users = new Map<object, [readonly { text: string }[], AtlasStyle]>();
  private anisotropy = 1;

  constructor(size = 1024) {
    this.size = size;
    this.data = new Uint8Array(size * size * 2);
    this.packer = new ShelfPacker(size, size);
    this.texture = this.createTexture();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw Error('Unable to create canvas drawing context!');
    this.ctx = ctx;
  }

  /** the texts in it */
  get count() {
    return this.entries.size;
  }

  /**
   * Filter it anisotropically, `samples` deep: labels lying flat and seen at a slant stay
   * sharp along their length. The renderer's most (`capabilities.getMaxAnisotropy()`).
   */
  setAnisotropy(samples: number) {
    if (this.anisotropy === samples) return;
    this.anisotropy = samples;
    this.texture.anisotropy = samples;
    this.texture.needsUpdate = true;
  }

  /** Where `text` is, drawn in `style`, drawing it if it is not yet; null if it is full. */
  entry(text: string, style: AtlasStyle): LabelAtlasEntry | null {
    const key = labelAtlasKey(text, style);
    const found = this.entries.get(key);
    if (found) return found;
    const added = this.draw(text, style);
    if (added) {
      this.entries.set(key, added);
      this.texture.needsUpdate = true;
      this.version++;
    }
    return added;
  }

  /** Keep `user`'s texts, in `style`, whenever it is packed again (see `repack`). */
  track(user: object, texts: readonly { text: string }[], style: AtlasStyle) {
    this.users.set(user, [texts, style]);
  }

  /** Stop keeping `user`'s texts. */
  untrack(user: object) {
    this.users.delete(user);
  }

  /**
   * Pack it again with only the texts its users draw (see `track`), when it is full: every
   * user must then look its entries up again (`generation` changes).
   */
  repack() {
    const users = [...this.users.values()];
    this.rebuild(
      (function* () {
        for (const [texts, style] of users)
          for (const { text } of texts)
            yield [text, style] as [string, AtlasStyle];
      })(),
    );
    this.generation++;
  }

  /**
   * Empty it and draw `texts` again, only those: in a larger texture if they do not fit.
   * Their entries, and maybe the texture, are new.
   */
  rebuild(texts: Iterable<[string, AtlasStyle]>) {
    const list = [...texts];
    for (let size = this.size; size <= MAX_SIZE; size *= 2) {
      if (size !== this.size) {
        this.size = size;
        this.data = new Uint8Array(size * size * 2);
        this.texture.dispose();
        this.texture = this.createTexture();
      } else {
        this.data.fill(0);
      }
      this.packer = new ShelfPacker(size, size);
      this.entries.clear();
      let fits = true;
      for (const [text, style] of list) {
        if (!this.entry(text, style)) {
          fits = false;
          break;
        }
      }
      if (fits) break;
    }
    this.texture.needsUpdate = true;
    this.version++;
  }

  dispose() {
    this.texture.dispose();
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
    return texture;
  }

  // Draw `text` into a free place: its fill into red, its halo into green.
  private draw(text: string, style: AtlasStyle): LabelAtlasEntry | null {
    const { ctx } = this;
    const font = labelAtlasFont(style, LABEL_RASTER_SIZE);
    const halo = Math.max(style.haloWidth, 0) * LABEL_RASTER_SIZE;
    // Not in every browser: without it, letters keep their own spacing.
    const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const spacing = `${(style.letterSpacing || 0) * LABEL_RASTER_SIZE}px`;
    const setFont = () => {
      ctx.font = font;
      if ('letterSpacing' in spaced) spaced.letterSpacing = spacing;
    };
    setFont();
    const width = Math.ceil(ctx.measureText(text).width + 2 * halo + 4);
    const height = Math.ceil(LABEL_RASTER_SIZE * 1.3 + 2 * halo);
    const place = this.packer.pack(width, height);
    if (!place) return null;

    const { canvas } = ctx;
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, width);
      canvas.height = Math.max(canvas.height, height);
    }
    const coverage = (withHalo: boolean) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      setFont();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      if (withHalo && halo > 0) {
        ctx.strokeStyle = '#fff';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2 * halo;
        ctx.strokeText(text, width / 2, height / 2);
      }
      ctx.fillText(text, width / 2, height / 2);
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
    return {
      u0: place.x / size,
      v0: place.y / size,
      u1: (place.x + width) / size,
      v1: (place.y + height) / size,
      width: width / LABEL_RASTER_SIZE,
      height: height / LABEL_RASTER_SIZE,
    };
  }
}
