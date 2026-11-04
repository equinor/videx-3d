import {
  Color,
  Matrix4,
  PerspectiveCamera,
  Texture,
  Vector3,
  Vector4,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  labelGlyphKey,
  LabelTextRun,
  ShelfPacker,
} from '../src/components/Labels/label-atlas';
import {
  cssColorAlpha,
  cssDisplayColor,
} from '../src/components/Labels/label-colors';
import {
  labelAnchor,
  labelAutoScale,
  labelFade,
  labelPixels,
  labelReadsBackward,
  labelSeenPixels,
  labelFadeRanges,
  labelFrame,
} from '../src/components/Labels/label-geometry';
import {
  LabelGroup,
  LabelGroupAtlas,
  LabelGroupLayer,
  LABEL_PLACE_BUDGET,
  LABEL_STYLE_TEXELS,
} from '../src/components/Labels/label-group';
import {
  labelBand,
  LABEL_COOLDOWN,
  LABEL_FADE_TIME,
  labelPlaceChoice,
  LabelPlacer,
  labelQuadsOverlap,
  labelRank,
  stepLabelFade,
} from '../src/components/Labels/label-placement';
import {
  LabelBounds,
  LABEL_EXTENT_FLOATS,
  labelReach,
  LABEL_RECORD_FLOATS,
  LabelSource,
  labelSources,
  writeLabelRecords,
} from '../src/components/Labels/label-records';
import {
  LABEL_CELL_HEIGHT,
  LABEL_CELL_PADDING,
  LABEL_LINE_HEIGHT,
  LabelFontMetrics,
  labelLineWidth,
  layoutLabelText,
  wrapLabelText,
} from '../src/components/Labels/label-text';
import {
  Label,
  LABEL_SIZE_PRESETS,
  LABEL_STYLE_DEFAULTS,
  LabelStyle,
  ResolvedLabelStyle,
  resolveLabelStyle,
} from '../src/components/Labels/types';

const style = (patch: Partial<LabelStyle> = {}): ResolvedLabelStyle =>
  resolveLabelStyle(patch);

// Every text a run of one glyph, 2 ems by 1.5, its ink 1.8 by 1.1.
const RUN: LabelTextRun = {
  glyphs: new Float32Array([0, 0.5, 0, 0]),
  count: 1,
  lines: 1,
  width: 2,
  height: 1.5,
  inkWidth: 1.8,
  inkHeight: 1.1,
};

// An atlas like a LabelAtlas, without a canvas: every text 2 ems by 1.5, room for `room`
// texts each time it is packed. `byText`: each text as large as its lines, half an em a
// character and 1.2 a line, its ink 0.2 less each way.
const fakeAtlas = (room = Infinity, byText = false): LabelGroupAtlas => {
  let used = 0;
  const sized = (text: string): LabelTextRun => {
    const lines = text.split('\n');
    const inkWidth = Math.max(...lines.map(line => line.length)) / 2;
    const inkHeight = 1 + (lines.length - 1) * 1.2;
    const chars = text.replace(/\s/g, '').length;
    return {
      ...RUN,
      glyphs: new Float32Array(chars * 4),
      count: chars,
      lines: lines.length,
      width: inkWidth + 0.2,
      height: inkHeight + 0.2,
      inkWidth,
      inkHeight,
    };
  };
  const atlas = {
    texture: new Texture(),
    glyphTable: new Texture(),
    generation: 0,
    text: (text: string) =>
      used++ < room ? (byText ? sized(text) : RUN) : null,
    // Half an em a character.
    measure: (line: string) => line.length / 2,
    track() {},
    untrack() {},
    repack() {
      used = 0;
      atlas.generation++;
    },
    setAnisotropy() {},
    dispose() {},
  };
  return atlas;
};

// A canvas context measuring text as a font of fixed advances would: 0.25 ems a space, 0.8
// a W, 0.5 the rest, 'AV' kerned 0.1 closer; ink from the pen to 2 pixels short of the
// advance, 17 pixels over the middle and 7 under.
const fakeContext = () =>
  ({
    font: '',
    textBaseline: 'middle',
    textAlign: 'left',
    letterSpacing: '0px',
    measureText(text: string) {
      let width = 0;
      for (const c of text) width += c === ' ' ? 12 : c === 'W' ? 38.4 : 24;
      if (text === 'AV') width -= 4.8;
      const ink = text.trim().length > 0;
      return {
        width,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: ink ? width - 2 : 0,
        actualBoundingBoxAscent: ink ? 17 : 0,
        actualBoundingBoxDescent: ink ? 7 : 0,
      };
    },
  }) as unknown as CanvasRenderingContext2D;

describe('labelFrame', () => {
  const frame = (normal: Vector3, direction?: [number, number, number]) => {
    const along = new Vector3();
    const top = new Vector3();
    labelFrame(normal.normalize(), direction, along, top);
    // Rounded, and -0 as 0.
    const round = (v: Vector3) =>
      v.toArray().map(x => Math.round(x * 1e9) / 1e9 + 0);
    return { along: round(along), top: round(top) };
  };

  it('reads level: +X lying flat, its top −Z', () => {
    const { along, top } = frame(new Vector3(0, 1, 0));
    expect(along).toEqual([1, 0, 0]);
    expect(top).toEqual([0, 0, -1]);
  });

  it('reads level on a wall, its top up', () => {
    const { along, top } = frame(new Vector3(0, 0, 1));
    expect(along).toEqual([1, 0, 0]);
    expect(top).toEqual([0, 1, 0]);
  });

  it('reads along its direction, laid into its plane', () => {
    const { along, top } = frame(new Vector3(0, 1, 0), [0, 1, 1]);
    expect(along).toEqual([0, 0, 1]);
    expect(top).toEqual([1, 0, 0]);
    // Along its normal: level.
    expect(frame(new Vector3(0, 1, 0), [0, 2, 0]).along).toEqual([1, 0, 0]);
  });
});

describe('labelFade', () => {
  const fade = (patch: Partial<LabelStyle>, facing = 1, pixels = 100) =>
    labelFade(style(patch), facing, pixels, 1000);

  it('hides a label from behind, and fades it out only near edge-on', () => {
    // Large enough on screen whatever its slant.
    const big = 1e4;
    expect(fade({ minFacing: 0 }, -0.1, big)).toBe(0);
    expect(fade({ minFacing: 0 }, 0.01, big)).toBe(1);
    // Whole from 0.2, gone at half that.
    expect(fade({ minFacing: 0.2 }, 0.2, big)).toBe(1);
    expect(fade({ minFacing: 0.2 }, 0.15, big)).toBeCloseTo(0.5, 9);
    expect(fade({ minFacing: 0.2 }, 0.1, big)).toBe(0);
  });

  it('never fades a label that reads whole, however it lies', () => {
    // 7 pixels face-on, face-on: whole, as 7 reads whole.
    expect(fade({ minPixels: 7 }, 1, 7)).toBe(1);
    // 10 face-on, lying flat seen 30° up (a facing of 0.5): reads √0.5 · 10 ≈ 7.07, whole.
    expect(fade({ minPixels: 7 }, 0.5, 10)).toBe(1);
  });

  it('fades a label out as it reads too small, by its height as seen', () => {
    // Gone at 0.6 of what reads whole: 4.2 of 7; halfway at 5.6.
    expect(fade({ minPixels: 7 }, 1, 4.2)).toBe(0);
    expect(fade({ minPixels: 7 }, 1, 5.6)).toBeCloseTo(0.5, 9);
    // 100 pixels face-on, seen at a cosine of 0.0016: √0.0016 · 100 = 4, a sliver.
    expect(fade({ minFacing: 0, minPixels: 7 }, 0.0016, 100)).toBe(0);
  });

  it('shows a label only within its distances', () => {
    expect(fade({ maxDistance: 999 })).toBe(0);
    expect(fade({ minDistance: 1001 })).toBe(0);
    expect(fade({ minDistance: 1000, maxDistance: 1000 })).toBe(1);
  });

  it('fades over the ranges and distances asked for, times its opacity', () => {
    expect(fade({ minFacing: 0.4, fadeFacing: 0.2 }, 0.3)).toBeCloseTo(0.5, 9);
    // Gone where it is whole: a step there.
    expect(fade({ minFacing: 0.2, fadeFacing: 0.2 }, 0.19)).toBe(0);
    expect(fade({ minFacing: 0.2, fadeFacing: 0.2 }, 0.2)).toBe(1);
    expect(fade({ minPixels: 20, fadePixels: 10 }, 1, 15)).toBeCloseTo(0.5, 9);
    // 1000 away: 100 inside the farthest of 1100, fading over 200.
    expect(fade({ maxDistance: 1100, fadeDistance: 200 })).toBeCloseTo(0.5, 9);
    expect(fade({ minDistance: 900, fadeDistance: 400 })).toBeCloseTo(0.25, 9);
    // No least distance: no fade near the camera.
    expect(fade({ fadeDistance: 5000 })).toBe(1);
    expect(fade({ opacity: 0.3 })).toBeCloseTo(0.3, 9);
  });

  it('caps a label at its largest on screen, shrunk rather than faded', () => {
    expect(fade({ maxPixels: 48 }, 1, 1e4)).toBe(1);
    // Shrunk to 40 face-on, seen at a cosine of 0.0196: √0.0196 · 40 = 5.6, halfway.
    expect(fade({ maxPixels: 40, minFacing: 0 }, 0.0196, 1e4)).toBeCloseTo(
      0.5,
      9,
    );
    expect(fade({ minFacing: 0 }, 0.0196, 1e4)).toBe(1);
  });

  it('fades a label out before the far plane, by its farthest corner', () => {
    const near = (depth: number, far: number) =>
      labelFade(style(), 1, 100, 1000, depth, far);
    expect(near(900, 1000)).toBe(1);
    expect(near(945, 1000)).toBeCloseTo(0.5, 9);
    expect(near(990, 1000)).toBe(0);
    // No far plane known: no fade.
    expect(near(1e9, 0)).toBe(1);
  });
});
describe('labelReadsBackward', () => {
  it('reads backward pointing away from a little above screen right', () => {
    expect(labelReadsBackward(1, 0)).toBe(false);
    expect(labelReadsBackward(-1, 0)).toBe(true);
    // Up and down the screen: read upward, either side of vertical.
    expect(labelReadsBackward(0, 1)).toBe(false);
    expect(labelReadsBackward(-0.05, 1)).toBe(false);
    expect(labelReadsBackward(0, -1)).toBe(true);
    expect(labelReadsBackward(0.05, -1)).toBe(true);
    // Exactly one of a label's two ways reads forward.
    for (let a = 0; a < 360; a += 7.5) {
      const x = Math.cos((a * Math.PI) / 180);
      const y = Math.sin((a * Math.PI) / 180);
      expect(labelReadsBackward(x, y)).not.toBe(labelReadsBackward(-x, -y));
    }
  });
});

describe('labelFadeRanges', () => {
  it('is whole from the least that reads, gone at half and 0.6 of it by default', () => {
    expect(labelFadeRanges(style({ minFacing: 0.2, minPixels: 10 }))).toEqual({
      facing: [0.1, 0.2],
      pixels: [6, 10],
    });
    expect(labelFadeRanges(style({ fadeFacing: 0.05, fadePixels: 3 }))).toEqual(
      { facing: [0.05, 0.15], pixels: [3, 7] },
    );
    // Never gone above where it is whole.
    expect(labelFadeRanges(style({ fadePixels: 20 })).pixels).toEqual([7, 7]);
  });
});

describe('resolveLabelStyle', () => {
  it('fills in the defaults: world sized, flipped, regular weight, a thin halo', () => {
    const resolved = resolveLabelStyle();
    expect(resolved).toEqual(LABEL_STYLE_DEFAULTS);
    expect(resolved.sizing).toBe('world');
    expect(resolved.flip).toBe(true);
    expect(resolved.fontWeight).toBe(400);
    expect(resolved.fontFamily.startsWith('Equinor,')).toBe(true);
  });

  it('leaves out what is null or undefined, as not given', () => {
    const resolved = resolveLabelStyle({
      maxDistance: null as unknown as number,
      maxPixels: undefined,
      color: '#123456',
    });
    expect(resolved.maxDistance).toBe(Infinity);
    expect(resolved.maxPixels).toBe(Infinity);
    expect(resolved.color).toBe('#123456');
  });

  it('draws a preset on screen, in its pixels and look, what is given winning', () => {
    const small = resolveLabelStyle({ size: 'small' });
    expect(small.sizing).toBe('screen');
    expect(small.size).toBe(LABEL_SIZE_PRESETS.small.size);
    expect(small.haloWidth).toBe(LABEL_SIZE_PRESETS.small.haloWidth);
    // What reads whole is the same at any size.
    expect(small.minPixels).toBe(LABEL_STYLE_DEFAULTS.minPixels);
    // 'world' cannot take a size on screen: drawn on screen.
    expect(resolveLabelStyle({ size: 'large', sizing: 'world' }).sizing).toBe(
      'screen',
    );
    expect(resolveLabelStyle({ size: 'large', sizing: 'auto' }).sizing).toBe(
      'auto',
    );
    const own = resolveLabelStyle({
      size: 'xsmall',
      fontWeight: 300,
      haloWidth: 0.3,
    });
    expect(own.fontWeight).toBe(300);
    expect(own.haloWidth).toBe(0.3);
    expect(own.letterSpacing).toBe(LABEL_SIZE_PRESETS.xsmall.letterSpacing);
  });

  it('keeps every preset larger than the last, its halo a pixel and a half or more', () => {
    const presets = Object.values(LABEL_SIZE_PRESETS);
    for (let i = 1; i < presets.length; i++)
      expect(presets[i].size).toBeGreaterThan(presets[i - 1].size);
    const { minPixels, minScale } = LABEL_STYLE_DEFAULTS;
    for (const preset of presets) {
      expect(preset.size * preset.haloWidth).toBeGreaterThanOrEqual(1.5);
      expect(preset.size * preset.haloWidth).toBeLessThanOrEqual(2);
      expect(preset.size).toBeGreaterThanOrEqual(minPixels);
    }
    // Read whole at the least 'auto' shrinks them to, but the smallest.
    for (const preset of presets.slice(1))
      expect(preset.size * minScale).toBeGreaterThanOrEqual(minPixels);
  });
});

describe('labelAutoScale', () => {
  it('is whole near, follows the view out, and stops at its least', () => {
    // A view 1.5 times shorter than distanceFactor or less: past the bend, whole.
    expect(labelAutoScale(1000, 0.25, 600)).toBe(1);
    // Twice: half, exactly, between the bends.
    expect(labelAutoScale(1000, 0.25, 2000)).toBeCloseTo(0.5, 12);
    // Ten times: its least.
    expect(labelAutoScale(1000, 0.25, 10000)).toBeCloseTo(0.25, 12);
    expect(labelAutoScale(1000, 1, 1e6)).toBe(1);
  });

  it('never grows as the view widens, nor jumps', () => {
    const scales: number[] = [];
    for (let span = 100; span < 1e5; span *= 1.01)
      scales.push(labelAutoScale(1000, 0.25, span));
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeLessThanOrEqual(scales[i - 1] + 1e-12);
      expect(scales[i - 1] - scales[i]).toBeLessThan(0.01);
    }
  });
});

describe('labelPixels', () => {
  const sized = (sizing: 'world' | 'screen' | 'auto') => ({
    sizing,
    size: 14,
    distanceFactor: 1000,
    minScale: 0.25,
    slantGrowth: LABEL_STYLE_DEFAULTS.slantGrowth,
  });

  it('sizes by the world, by the screen, or by the screen shrinking with distance', () => {
    // A world unit 0.5 pixels across, in a view 1000 high: the view spans 2000 units.
    expect(labelPixels(sized('world'), 2, 0.5, 1000)).toBe(14);
    expect(labelPixels(sized('screen'), 2, 0.5, 1000)).toBe(28);
    expect(labelPixels(sized('auto'), 2, 0.5, 1000)).toBeCloseTo(14, 9);
    // Up close, whole.
    expect(labelPixels(sized('auto'), 1, 10, 1000)).toBe(14);
  });

  it('draws one sized on screen larger at a slant, to read as large as seen, at most twice', () => {
    // Lying flat seen 30° up: a facing of 0.5, √0.5 larger.
    expect(labelPixels(sized('screen'), 1, 0.5, 1000, 0.5)).toBeCloseTo(
      14 / Math.SQRT1_2,
      9,
    );
    expect(
      labelSeenPixels(labelPixels(sized('screen'), 1, 0.5, 1000, 0.5), 0.5),
    ).toBeCloseTo(14, 9);
    // Twice at the most, from a facing of 0.25.
    expect(labelPixels(sized('screen'), 1, 0.5, 1000, 0.25)).toBeCloseTo(28, 9);
    expect(labelPixels(sized('screen'), 1, 0.5, 1000, 0.01)).toBeCloseTo(28, 9);
    // Glued to the world: as large as it is there.
    expect(labelPixels(sized('world'), 2, 0.5, 1000, 0.25)).toBe(14);
  });

  it('draws one sized on screen no larger at a slant than slantGrowth asks, never with 1', () => {
    const grown = (slantGrowth: number, facing: number) =>
      labelPixels({ ...sized('screen'), slantGrowth }, 1, 0.5, 1000, facing);
    expect(grown(1, 0.25)).toBe(14);
    expect(grown(1, 0.01)).toBe(14);
    expect(grown(1.5, 0.01)).toBeCloseTo(21, 9);
    // Below 1, as 1.
    expect(grown(0.5, 0.25)).toBe(14);
    expect(
      labelPixels({ ...sized('world'), slantGrowth: 3 }, 2, 0.5, 1000, 0.01),
    ).toBe(14);
  });
});

describe('labelAnchor', () => {
  it('moves the text off its position by half its size', () => {
    expect(labelAnchor('center', 'middle')).toEqual([0, 0]);
    // Starting at its position: its middle half its width on along the way it reads.
    expect(labelAnchor('left', 'middle')).toEqual([0.5, 0]);
    expect(labelAnchor('right', 'bottom')).toEqual([-0.5, 0.5]);
    expect(labelAnchor('center', 'top')).toEqual([0, -0.5]);
  });
});

describe('labelGlyphKey', () => {
  it('keeps a glyph apart for each look the atlas draws, and only for those', () => {
    const base = style();
    const key = labelGlyphKey('a', base);
    expect(labelGlyphKey('b', base)).not.toBe(key);
    expect(labelGlyphKey('a', style({ fontStyle: 'italic' }))).not.toBe(key);
    expect(labelGlyphKey('a', style({ fontWeight: 700 }))).not.toBe(key);
    expect(labelGlyphKey('a', style({ haloWidth: 0.2 }))).not.toBe(key);
    // Its colours are the layer's, its spacing and alignment the layout's: one glyph for
    // them all.
    expect(labelGlyphKey('a', style({ color: '#123456' }))).toBe(key);
    expect(labelGlyphKey('a', style({ letterSpacing: 0.1 }))).toBe(key);
    expect(labelGlyphKey('a', style({ align: 'left' }))).toBe(key);
  });
});

describe('LabelFontMetrics', () => {
  it('measures each character and the kerning of each pair, in ems', () => {
    const metrics = new LabelFontMetrics(style(), fakeContext());
    const a = metrics.glyph('A');
    expect(a.advance).toBe(0.5);
    expect(a.ink).toBe(true);
    expect(a.up).toBeCloseTo(17 / 48, 12);
    expect(metrics.glyph(' ')).toMatchObject({ advance: 0.25, ink: false });
    expect(metrics.kerning('A', 'V')).toBeCloseTo(-0.1, 12);
    expect(metrics.kerning('A', 'B')).toBe(0);
  });

  it('estimates without a canvas', () => {
    const metrics = new LabelFontMetrics(style(), null);
    expect(metrics.glyph('x').advance).toBe(0.6);
    expect(metrics.glyph(' ').ink).toBe(false);
    expect(metrics.kerning('A', 'V')).toBe(0);
  });
});

describe('layoutLabelText', () => {
  const metrics = new LabelFontMetrics(style(), fakeContext());
  const halo = 0.1;
  const inset = halo + LABEL_CELL_PADDING;

  it('sets glyphs by their advances, kerning and letter spacing, spaces drawing nothing', () => {
    const layout = layoutLabelText(
      'AV A',
      style({ haloWidth: halo, letterSpacing: 0.05 }),
      metrics,
    );
    expect(layout.chars).toEqual(['A', 'V', 'A']);
    expect(layout.lines).toEqual([0, 0, 0]);
    const [a, v, last] = layout.xs;
    expect(a).toBeCloseTo(inset, 12);
    // Kerned 0.1 closer, spaced 0.05 apart.
    expect(v - a).toBeCloseTo(0.5 - 0.1 + 0.05, 12);
    expect(last - v).toBeCloseTo(0.5 + 0.05 + 0.25 + 0.05, 12);
    expect(layout.width).toBeCloseTo(
      labelLineWidth('AV A', 0.05, metrics) + 2 * inset,
      12,
    );
    expect(layout.height).toBeCloseTo(LABEL_CELL_HEIGHT + 2 * halo, 12);
    // Its ink about the middle, halo and all.
    expect(layout.inkHeight).toBeCloseTo((2 * 17) / 48 + 2 * halo, 12);
  });

  it('breaks lines at \\n, aligning them, a line height apart', () => {
    const lines = (align: 'left' | 'center' | 'right') =>
      layoutLabelText('A\nWWW', style({ haloWidth: halo, align }), metrics);
    const widest = 3 * 0.8;
    expect(lines('left').lines).toEqual([0, 1, 1, 1]);
    expect(lines('left').lineCount).toBe(2);
    expect(lines('left').xs[0]).toBeCloseTo(inset, 12);
    expect(lines('right').xs[0]).toBeCloseTo(inset + widest - 0.5, 12);
    expect(lines('center').xs[0]).toBeCloseTo(inset + (widest - 0.5) / 2, 12);
    expect(lines('center').xs[1]).toBeCloseTo(inset, 12);
    expect(lines('center').height).toBeCloseTo(
      LABEL_CELL_HEIGHT + LABEL_LINE_HEIGHT + 2 * halo,
      12,
    );
  });

  it('has no ink with nothing to draw', () => {
    const layout = layoutLabelText('  ', style(), metrics);
    expect(layout.chars).toEqual([]);
    expect(layout.inkWidth).toBe(0);
  });
});

describe('wrapLabelText', () => {
  const chars = (line: string) => line.length;

  it('breaks at spaces into each count of lines, its widest line as narrow as can be', () => {
    // Balanced, not greedy: 8 and 10, not 13 and 5.
    expect(wrapLabelText('a bb ccc dddd eeeee', chars, 2)).toEqual([
      'a bb ccc dddd eeeee',
      'a bb ccc\ndddd eeeee',
    ]);
  });

  it('leaves out a count of lines no narrower than fewer', () => {
    // Three lines are as wide as two (7): left out; four narrower.
    expect(wrapLabelText('aa bbbb cc dddd', chars, 3)).toEqual([
      'aa bbbb cc dddd',
      'aa bbbb\ncc dddd',
    ]);
    expect(wrapLabelText('aa bbbb cc dddd', chars, 4)).toEqual([
      'aa bbbb cc dddd',
      'aa bbbb\ncc dddd',
      'aa\nbbbb\ncc\ndddd',
    ]);
  });

  it('keeps a word, its own line breaks, and one line as they are', () => {
    expect(wrapLabelText('word', chars, 3)).toEqual(['word']);
    expect(wrapLabelText('a b\nc d', chars, 3)).toEqual(['a b\nc d']);
    expect(wrapLabelText('a b c', chars, 1)).toEqual(['a b c']);
  });
});

describe('labelSources', () => {
  const chars = (line: string) => line.length;

  it('is a label itself, its places filled in by it, or its text’s line breaks in its room', () => {
    const plain: Label = { text: 'a b', position: [1, 2, 3] };
    const placed: Label = {
      text: 'name',
      position: [0, 0, 0],
      normal: [0, 0, 1],
      size: 2,
      places: [{ text: 'x', bounds: [1, 2] }, { position: [9, 9, 9] }],
    };
    const bounded: Label = {
      text: 'aa bbbb cc dddd',
      position: [4, 5, 6],
      bounds: [10, 5],
    };
    const out: LabelSource[] = [];
    const starts = new Int32Array(4);
    labelSources([plain, placed, bounded], 2, chars, out, starts);
    expect(Array.from(starts)).toEqual([0, 1, 3, 5]);
    expect(out[0]).toBe(plain);
    expect(out[1]).toEqual({
      text: 'x',
      position: [0, 0, 0],
      normal: [0, 0, 1],
      direction: undefined,
      size: 2,
      bounds: [1, 2],
    });
    expect(out[2].text).toBe('name');
    expect(out[2].position).toEqual([9, 9, 9]);
    expect(out[2].bounds).toBeUndefined();
    expect(out.slice(3).map(source => source.text)).toEqual([
      'aa bbbb cc dddd',
      'aa bbbb\ncc dddd',
    ]);
    expect(out[4].bounds).toEqual([10, 5]);
    expect(out[4].position).toEqual([4, 5, 6]);
  });
});

describe('labelPlaceChoice', () => {
  const choose = (room: number[], current: number) =>
    labelPlaceChoice(room, room.length, current, { place: -1, fit: -1 });

  it('takes the first place that fits, whole', () => {
    expect(choose([0.5, 1.2, 3], 0)).toEqual({ place: 1, fit: 1 });
    expect(choose([Infinity], 0)).toEqual({ place: 0, fit: 1 });
  });

  it('stays at a later one that fits, till one before fits with room to spare', () => {
    expect(choose([0.5, 1.02, 3], 2)).toEqual({ place: 2, fit: 1 });
    expect(choose([0.5, 1.2, 3], 2)).toEqual({ place: 1, fit: 1 });
    // No longer fitting: moved at once.
    expect(choose([1.01, 2, 0.9], 2)).toEqual({ place: 0, fit: 1 });
  });

  it('shrinks it where it has the most room when none fits, staying where it has nearly as much', () => {
    expect(choose([0.5, 0.8, 0.6], 0)).toEqual({ place: 1, fit: 0.8 });
    expect(choose([0.5, 0.8, 0.78], 2)).toEqual({ place: 2, fit: 0.78 });
    // Seen nowhere: where it is, whole.
    expect(choose([0, 0], 1)).toEqual({ place: 1, fit: 1 });
  });
});

describe('ShelfPacker', () => {
  it('packs apart and inside, and tells when it is full', () => {
    const packer = new ShelfPacker(100, 80, 4);
    const placed = [
      [40, 20],
      [40, 20],
      [40, 20],
      [90, 20],
    ].map(([w, h]) => ({ w, h, at: packer.pack(w, h)! }));
    for (const { w, h, at } of placed) {
      expect(at.x).toBeGreaterThanOrEqual(4);
      expect(at.y).toBeGreaterThanOrEqual(4);
      expect(at.x + w + 4).toBeLessThanOrEqual(100);
      expect(at.y + h + 4).toBeLessThanOrEqual(80);
    }
    const apart = (a: (typeof placed)[0], b: (typeof placed)[0]) =>
      a.at.x + a.w + 4 <= b.at.x ||
      b.at.x + b.w + 4 <= a.at.x ||
      a.at.y + a.h + 4 <= b.at.y ||
      b.at.y + b.h + 4 <= a.at.y;
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(apart(placed[i], placed[j])).toBe(true);
    // Taller than any shelf, and no room for another.
    expect(packer.pack(10, 30)).toBeNull();
  });

  it('starts a shelf rather than waste most of a taller one', () => {
    const packer = new ShelfPacker(200, 200, 2);
    packer.pack(20, 40);
    expect(packer.pack(20, 10)!.y).toBe(2 + 40 + 2);
    expect(packer.pack(20, 30)!.y).toBe(2);
  });
});

describe('writeLabelRecords', () => {
  it('writes where each label is, its layer, frame, own size and text’s run', () => {
    const out = new Float32Array(3 * LABEL_RECORD_FLOATS);
    const extents = new Float32Array(2 * LABEL_EXTENT_FLOATS);
    writeLabelRecords(
      [
        { text: 'a', position: [1, 2, 3] },
        { text: 'b', position: [4, 5, 6], normal: [0, 0, 2], size: 2.5 },
      ],
      [RUN, { ...RUN, count: 3, lines: 2 }],
      [5, 9],
      7,
      out,
      1,
      extents,
    );
    // Nothing before its first record.
    expect(out.subarray(0, LABEL_RECORD_FLOATS).every(x => x === 0)).toBe(true);
    // -0 as 0.
    const first = Array.from(
      out.subarray(LABEL_RECORD_FLOATS, 2 * LABEL_RECORD_FLOATS),
      x => x + 0,
    );
    expect(first).toEqual([
      ...[1, 2, 3, 7],
      // Lying flat, its own size 1 left out.
      ...[0, 1, 0, 1],
      // Its lines.
      ...[1, 0, 0, 1],
      // Its run's first glyph and count, its cell's extent.
      ...[5, 1, 2, 1.5],
    ]);
    // Its normal unit length, and its own size; its lines and run.
    const second = 2 * LABEL_RECORD_FLOATS;
    expect(Array.from(out.subarray(second + 4, second + 8))).toEqual([
      0, 0, 1, 2.5,
    ]);
    expect(out[second + 11]).toBe(2);
    expect(Array.from(out.subarray(second + 12, second + 14))).toEqual([9, 3]);
    // Its cell's extent and its ink's, in ems.
    expect(Array.from(extents)).toEqual(
      [2, 1.5, 1.8, 1.1, 2, 1.5, 1.8, 1.1].map(Math.fround),
    );
  });
});

describe('labelReach', () => {
  it('reaches half its extent about its middle, moved by its anchor and offset', () => {
    expect(labelReach(2, 1.5, [0, 0], [0, 0])).toBeCloseTo(1.25, 12);
    expect(labelReach(2, 1.5, [0.5, 0], [0, 0])).toBeCloseTo(
      Math.hypot(2, 0.75),
      12,
    );
    expect(labelReach(2, 1.5, [0, 0], [3, 4])).toBeCloseTo(6.25, 12);
  });
});

describe('LabelBounds.reachable', () => {
  // A 50° view 1000 pixels high, from the origin down -Z.
  const camera = new PerspectiveCamera(50, 1, 1, 1e7);
  camera.updateProjectionMatrix();
  const reachable = (labels: Label[], given: ResolvedLabelStyle) => {
    const records = new Float32Array(labels.length * LABEL_RECORD_FLOATS);
    const extents = new Float32Array(labels.length * LABEL_EXTENT_FLOATS);
    writeLabelRecords(
      labels,
      labels.map(() => RUN),
      labels.map(() => 0),
      0,
      records,
      0,
      extents,
    );
    const bounds = new LabelBounds();
    bounds.bound(records, 0, labels.length, extents, given);
    return bounds.reachable(camera, 1000, new Matrix4(), given);
  };
  const at = (z: number, size = 100, patch: Partial<LabelStyle> = {}) =>
    reachable([{ text: 'a', position: [0, 0, -z] }], style({ size, ...patch }));

  it('is false with no labels', () => {
    expect(
      new LabelBounds().reachable(camera, 1000, new Matrix4(), style()),
    ).toBe(false);
  });

  it('is false past maxDistance, and nearer than minDistance', () => {
    expect(at(5000, 100, { maxDistance: 10000 })).toBe(true);
    expect(at(20000, 100, { maxDistance: 10000 })).toBe(false);
    expect(at(50, 100, { minDistance: 1000 })).toBe(false);
  });

  it('is false once the largest could be no larger than minPixels', () => {
    // 100 units at 10 km: about 11 pixels; at 1000 km, a tenth of one.
    expect(at(10000)).toBe(true);
    expect(at(1e6)).toBe(false);
    // Never larger than maxPixels: below minPixels, never drawn.
    expect(at(10000, 100, { maxPixels: 4 })).toBe(false);
    // No least size: drawn at any distance.
    expect(at(1e6, 100, { minPixels: 0 })).toBe(true);
  });

  it('judges a layer spread over a region by its nearest part', () => {
    // A line of labels 1000 km long, 113 km below the camera.
    const spread = (maxDistance: number) =>
      reachable(
        Array.from({ length: 101 }, (_, i) => ({
          text: `${i}`,
          position: [(i - 50) * 10000, -113000, 0] as [number, number, number],
        })),
        style({ size: 2500, maxDistance }),
      );
    expect(spread(60000)).toBe(false);
    expect(spread(150000)).toBe(true);
  });

  it('counts how far its text reaches from its position', () => {
    // 1 m from the label's position, its text 2 by 1.5 ems about it: 1.25 m.
    expect(at(10001, 1, { maxDistance: 10000, minPixels: 0 })).toBe(true);
    expect(at(10002, 1, { maxDistance: 10000, minPixels: 0 })).toBe(false);
  });

  it('keeps a label sized on screen whatever its distance, within its distances', () => {
    expect(at(1e6, 14, { sizing: 'screen' })).toBe(true);
    expect(at(1e6, 14, { sizing: 'screen', maxDistance: 1e5 })).toBe(false);
    // Never as large as it shows from: gone at 0.6 of 10.
    expect(at(100, 5, { sizing: 'screen', minPixels: 10 })).toBe(false);
    expect(at(100, 7, { sizing: 'screen', minPixels: 10 })).toBe(true);
    // Shrunk 'auto' to a quarter of 14 at the most far off: under 6.
    expect(at(1e6, 14, { sizing: 'auto', minScale: 0.25, minPixels: 6 })).toBe(
      false,
    );
    expect(at(1e6, 14, { sizing: 'auto', minScale: 0.5, minPixels: 6 })).toBe(
      true,
    );
  });
});

// A square on screen, `side` pixels from `x`, `y`, its corners in order round it.
const square = (x: number, y: number, side = 10) => [
  ...[x, y, x + side, y],
  ...[x + side, y + side, x, y + side],
];

describe('labelQuadsOverlap', () => {
  it('tells quads apart by their edges, not their boxes', () => {
    // A diamond whose box takes in a square's corner, 1.41 pixels off it.
    const quads = new Float32Array([
      ...square(0, 0, 9),
      ...[15, 5, 25, 15, 15, 25, 5, 15],
      ...square(5, 5),
    ]);
    expect(labelQuadsOverlap(quads, 0, 1)).toBe(false);
    expect(labelQuadsOverlap(quads, 1, 0)).toBe(false);
    expect(labelQuadsOverlap(quads, 0, 1, 2)).toBe(true);
    expect(labelQuadsOverlap(quads, 0, 2)).toBe(true);
  });
});

describe('LabelPlacer', () => {
  it('lets the best in first, keeps each band apart, and lets free ones through', () => {
    const quads = new Float32Array([
      ...square(0, 0),
      ...square(5, 5),
      ...square(5, 5),
      ...square(100, 100),
      ...square(2, 2),
    ]);
    const accepted = new Uint8Array(5);
    new LabelPlacer().place(
      5,
      [1, 0, 2, 3, 4],
      quads,
      new Uint8Array([0, 0, 1, 0, 0]),
      new Uint8Array([0, 0, 0, 0, 1]),
      0,
      accepted,
    );
    // 0 meets 1, which came first; 2 meets 1 in the other band; 4 is free.
    expect(Array.from(accepted)).toEqual([0, 1, 1, 1, 1]);
  });

  it('keeps labels a margin apart', () => {
    const quads = new Float32Array([...square(0, 0), ...square(12, 0)]);
    const place = (margin: number) => {
      const accepted = new Uint8Array(2);
      new LabelPlacer().place(
        2,
        [0, 1],
        quads,
        new Uint8Array(2),
        new Uint8Array(2),
        margin,
        accepted,
      );
      return Array.from(accepted);
    };
    expect(place(1)).toEqual([1, 1]);
    expect(place(3)).toEqual([1, 0]);
  });
});

describe('labelRank', () => {
  it('ranks by priority first, then shown over not, then whole, central and near', () => {
    expect(labelRank(1, false, 0, 1, 1)).toBeGreaterThan(
      labelRank(0, true, 1, 0, 0),
    );
    // Shown and whole: kept, wherever it is.
    expect(labelRank(0, true, 1, 1, 1)).toBeGreaterThan(
      labelRank(0, false, 1, 0, 0),
    );
    // Shown but all but faded out: no place kept from one that reads whole.
    expect(labelRank(0, true, 0.2, 0, 0)).toBeLessThan(
      labelRank(0, false, 1, 0, 0),
    );
    expect(labelRank(0, false, 1, 0, 0)).toBeGreaterThan(
      labelRank(0, false, 0.5, 0, 0),
    );
    expect(labelRank(0, false, 1, 0.1, 0)).toBeGreaterThan(
      labelRank(0, false, 1, 0.5, 0),
    );
    expect(labelRank(0, false, 1, 0, 0.1)).toBeGreaterThan(
      labelRank(0, false, 1, 0, 0.9),
    );
  });
});

describe('stepLabelFade and labelBand', () => {
  it('fades over LABEL_FADE_TIME, either way', () => {
    expect(stepLabelFade(0, 1, LABEL_FADE_TIME / 2)).toBeCloseTo(0.5, 12);
    expect(stepLabelFade(0.9, 1, LABEL_FADE_TIME)).toBe(1);
    expect(stepLabelFade(0.2, 0, LABEL_FADE_TIME)).toBe(0);
  });

  it('is near while the view where it is spans no more than twice distanceFactor', () => {
    expect(labelBand(1000, 1999)).toBe(0);
    expect(labelBand(1000, 2001)).toBe(1);
  });
});

describe('LabelGroup', () => {
  // Placed every frame, whatever the time it takes: as tests run, the clock tells nothing.
  const newGroup = (atlas = fakeAtlas()) => {
    const group = new LabelGroup(atlas);
    group.placeBudget = Infinity;
    return group;
  };
  // A 50° view 1000 by 1000 pixels from the origin down -Z.
  const camera = new PerspectiveCamera(50, 1, 1, 1e7);
  camera.updateProjectionMatrix();
  const frames = (group: LabelGroup, count: number, from: number) => {
    for (let f = 0; f < count; f++)
      group.frame({ camera, width: 1000, height: 1000, time: from + f * 0.1 });
    return from + count * 0.1;
  };
  const layerOf = (
    group: LabelGroup,
    labels: Label[],
    patch: Partial<LabelStyle> = {},
    priority = 0,
    overlap = false,
  ) => {
    const layer = new LabelGroupLayer(group);
    group.add(layer);
    layer.set({
      labels,
      style: style({ minFacing: 0, ...patch }),
      priority,
      overlap,
      visible: true,
    });
    return layer;
  };
  // Facing the camera, `z` down the view.
  const facing = (x: number, z: number, more: Partial<Label> = {}): Label => ({
    text: 'a',
    position: [x, 0, z],
    normal: [0, 0, 1],
    ...more,
  });
  // The records drawn and their opacities, depth tested (0) or not (1), in order.
  const drawn = (group: LabelGroup, which = 0) => {
    const array = group.meshes[which].geometry.getAttribute('labelDraw')
      .array as Float32Array;
    return Array.from({ length: group.drawn[which] }, (_, i) => [
      array[i * 4],
      array[i * 4 + 1],
    ]);
  };

  it('draws labels where they do not meet, fading them in', () => {
    const group = newGroup();
    layerOf(group, [facing(-200, -1000), facing(200, -1000, { text: 'b' })], {
      size: 10,
    });
    frames(group, 1, 0);
    // Let in, not yet faded in.
    expect(group.drawn).toEqual([0, 0]);
    frames(group, 5, 0.1);
    expect(drawn(group).map(([, alpha]) => alpha)).toEqual([1, 1]);
  });

  it('keeps the label of higher priority where two meet', () => {
    const group = newGroup();
    const layer = layerOf(
      group,
      [facing(0, -1000), facing(5, -1000, { text: 'b', priority: 1 })],
      { size: 10 },
    );
    frames(group, 6, 0);
    expect(drawn(group)).toEqual([[layer.first + 1, 1]]);
  });

  it('lets a near label lie over a distant one, drawn after it', () => {
    const near = (distanceFactor: number) => {
      const group = newGroup();
      const layer = layerOf(
        group,
        [facing(0, -100), facing(0, -5000, { text: 'far' })],
        { sizing: 'screen', size: 14, distanceFactor },
      );
      frames(group, 6, 0);
      return drawn(group).map(([record]) => record - layer.first);
    };
    // Near and distant: both, the far one first.
    expect(near(1000)).toEqual([1, 0]);
    // Both distant: the nearer kept.
    expect(near(10)).toEqual([0]);
  });

  it('lets a layer free to overlap through, keeping none out', () => {
    const group = newGroup();
    layerOf(group, [facing(0, -1000)], { size: 10 }, 0, true);
    layerOf(group, [facing(0, -1000, { text: 'b' })], { size: 10 });
    frames(group, 6, 0);
    expect(group.drawn).toEqual([2, 0]);
  });

  it('draws layers without the depth test apart, over the others', () => {
    const group = newGroup();
    layerOf(group, [facing(-200, -1000)], { size: 10 });
    layerOf(group, [facing(200, -1000, { text: 'b' })], {
      size: 10,
      depthTest: false,
    });
    frames(group, 6, 0);
    expect(group.drawn).toEqual([1, 1]);
    expect(group.meshes[1].material.depthTest).toBe(false);
    expect(group.meshes[1].renderOrder).toBeGreaterThan(
      group.meshes[0].renderOrder,
    );
  });

  it('keeps a label pushed out away a while, though room is made', () => {
    const group = newGroup();
    const low = layerOf(group, [facing(0, -1000)], { size: 10 });
    let time = frames(group, 6, 0);
    expect(drawn(group)).toEqual([[low.first, 1]]);
    const high = layerOf(
      group,
      [facing(0, -1000, { text: 'b' })],
      {
        size: 10,
      },
      1,
    );
    // Pushed out at once: away for LABEL_COOLDOWN from then.
    time = frames(group, 2, time);
    expect(drawn(group).map(([record]) => record)).toEqual([
      low.first,
      high.first,
    ]);
    group.remove(high);
    time = frames(group, 3, time);
    expect(group.drawn).toEqual([0, 0]);
    frames(group, Math.ceil(LABEL_COOLDOWN * 10) + 4, time);
    expect(drawn(group)).toEqual([[low.first, 1]]);
  });

  it('keeps a label in place by its key as its layer is given its labels anew', () => {
    const group = newGroup();
    const layer = layerOf(group, [facing(0, -1000)], { size: 10 });
    const time = frames(group, 6, 0);
    layer.set({
      labels: [facing(0, -1000), facing(300, -1000, { text: 'b' })],
      style: layer.style,
      priority: 0,
      overlap: false,
      visible: true,
    });
    frames(group, 1, time);
    // The first still whole; the new one fading in.
    const [first, second] = drawn(group);
    expect(first).toEqual([layer.first, 1]);
    expect(second[1]).toBeLessThan(1);
  });

  it('places less often while placing overruns its budget, fading by the time since', () => {
    let now = 0;
    const clock = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => (now += 1.25));
    const group = new LabelGroup(fakeAtlas());
    expect(group.placeBudget).toBe(LABEL_PLACE_BUDGET);
    layerOf(group, [facing(0, -1000)], { size: 10 });
    // Each placement 1.25 ms: placed, waits a frame, placed (0.1 s on, at most), waits.
    frames(group, 4, 0);
    clock.mockRestore();
    expect(drawn(group)[0][1]).toBeCloseTo(0.4, 6);
  });

  it('draws those labels whose texts fit, once its atlas is full, and tells once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const group = newGroup(fakeAtlas(1));
    const layer = layerOf(
      group,
      [
        facing(-300, -1000),
        facing(0, -1000, { text: 'b' }),
        facing(300, -1000, { text: 'c' }),
      ],
      { size: 10 },
    );
    frames(group, 6, 0);
    expect(drawn(group)).toEqual([[layer.first, 1]]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('wraps a label into the fewest lines that fit its room, shrunk where none do', () => {
    const group = newGroup(fakeAtlas(Infinity, true));
    // 'alpha beta' 10 world units high: one line 50 by 10, two 25 by 22.
    const at = (bounds: [number, number]): Label =>
      facing(0, -1000, { text: 'alpha beta', bounds });
    const layer = layerOf(group, [at([40, 30])], { size: 10 });
    const shown = () => {
      const array = group.meshes[0].geometry.getAttribute('labelDraw')
        .array as Float32Array;
      return [array[0] - layer.first, array[2]];
    };
    const relabel = (bounds: [number, number]) =>
      layer.set({
        labels: [at(bounds)],
        style: layer.style,
        priority: 0,
        overlap: false,
        visible: true,
      });
    let time = frames(group, 6, 0);
    // One line is too wide: two.
    expect(shown()).toEqual([1, 1]);
    // One line would just fit, not by enough to move: kept.
    relabel([52, 30]);
    time = frames(group, 2, time);
    expect(shown()).toEqual([1, 1]);
    relabel([60, 30]);
    time = frames(group, 2, time);
    expect(shown()).toEqual([0, 1]);
    // Neither fits: the roomiest, two lines, shrunk to fit.
    relabel([20, 30]);
    frames(group, 2, time);
    const [place, fit] = shown();
    expect(place).toBe(1);
    expect(fit).toBeCloseTo(0.8, 6);
  });

  it('draws a label at the first of its places whose text fits there', () => {
    const group = newGroup(fakeAtlas(Infinity, true));
    const layer = layerOf(
      group,
      [
        facing(0, -1000, {
          text: 'alpha beta',
          places: [
            { bounds: [30, 30] },
            {
              text: 'alpha\nbeta',
              position: [100, 0, -1000],
              bounds: [30, 30],
            },
          ],
        }),
      ],
      { size: 10 },
    );
    frames(group, 6, 0);
    expect(drawn(group)).toEqual([[layer.first + 1, 1]]);
  });

  it('lays each distinct text of a layer out once, its labels sharing its run', () => {
    const atlas = fakeAtlas(Infinity, true);
    const text = vi.spyOn(atlas, 'text');
    const group = newGroup(atlas);
    const layer = layerOf(
      group,
      [
        facing(-300, -1000),
        facing(0, -1000),
        facing(300, -1000, { text: 'bc' }),
      ],
      { size: 10 },
    );
    frames(group, 1, 0);
    expect(text).toHaveBeenCalledTimes(2);
    expect(layer.glyphNeed).toBe(3);
    const records = group.meshes[0].material.uniforms.uRecords.value as Texture;
    const data = (records.image as { data: Float32Array }).data;
    const run = (i: number) =>
      Array.from(
        data.subarray(
          (layer.first + i) * LABEL_RECORD_FLOATS + 12,
          (layer.first + i) * LABEL_RECORD_FLOATS + 14,
        ),
      );
    // 'a' one glyph, 'bc' two, after it.
    expect(run(0)).toEqual(run(1));
    expect(run(2)).toEqual([run(0)[0] + 1, 2]);
  });

  it('uploads its records whole when laid out, and a changed layer’s by ranges after', () => {
    const group = newGroup();
    const records = group.meshes[0].material.uniforms.uRecords.value as Texture;
    // As three does once it has uploaded a texture.
    const uploaded = () => records.onUpdate?.(records);
    const labels = [facing(0, -1000), facing(300, -1000, { text: 'b' })];
    const layer = layerOf(group, labels, { size: 10 });
    let time = frames(group, 1, 0);
    const version = records.version;
    expect(version).toBeGreaterThan(0);
    // Laid out: whole.
    expect(records.updateRanges).toEqual([]);
    uploaded();
    // The same count, new labels: its own block, uploaded.
    layer.set({
      labels: [facing(0, -1000, { text: 'c' }), facing(300, -1000)],
      style: layer.style,
      priority: 0,
      overlap: false,
      visible: true,
    });
    time = frames(group, 1, time);
    expect(records.version).toBeGreaterThan(version);
    expect(records.updateRanges).toEqual([
      {
        start: layer.first * LABEL_RECORD_FLOATS,
        count: 2 * LABEL_RECORD_FLOATS,
      },
    ]);
    // Still: nothing.
    const still = records.version;
    time = frames(group, 2, time);
    expect(records.version).toBe(still);
    // Freed on the GPU with ranges marked: made anew whole, not from the ranges alone.
    layer.set({
      labels: [facing(0, -1000, { text: 'd' }), facing(300, -1000)],
      style: layer.style,
      priority: 0,
      overlap: false,
      visible: true,
    });
    records.addUpdateRange(0, LABEL_RECORD_FLOATS);
    group.release();
    expect(records.updateRanges).toEqual([]);
    frames(group, 1, time);
    expect(records.updateRanges).toEqual([]);
    expect(records.version).toBeGreaterThan(still);
  });

  it('uploads a texture whole till three has uploaded it, whatever is written meanwhile', () => {
    // Two layers' styles written in a frame nothing is drawn, then a third's: the first
    // upload must hold all three rows, not the last written alone.
    const group = newGroup();
    const styles = group.meshes[0].material.uniforms.uStyles.value as Texture;
    layerOf(group, [facing(0, -1000)], { size: 10 });
    layerOf(group, [facing(300, -1000, { text: 'b' })], { size: 10 });
    let time = frames(group, 1, 0);
    layerOf(group, [facing(-300, -1000, { text: 'c' })], { size: 10 });
    time = frames(group, 1, time);
    expect(styles.updateRanges).toEqual([]);
    // Uploaded: one layer's style changing marks its row alone.
    styles.onUpdate?.(styles);
    const [first] = group.layers;
    first.set({
      labels: first.labels,
      style: style({ size: 10, color: '#ff0000' }),
      priority: 0,
      overlap: false,
      visible: true,
    });
    frames(group, 1, time);
    expect(styles.updateRanges).toEqual([
      {
        start: first.row * LABEL_STYLE_TEXELS * 4,
        count: LABEL_STYLE_TEXELS * 4,
      },
    ]);
  });
});

describe('cssColorAlpha', () => {
  const parse = (css: string) => {
    const color = new Color();
    const alpha = cssColorAlpha(css, color);
    return { alpha, hex: color.getHexString() };
  };

  it('keeps the alpha of rgba() and #rrggbbaa apart from the colour', () => {
    expect(parse('rgba(0, 0, 0, 0.75)')).toEqual({
      alpha: 0.75,
      hex: '000000',
    });
    expect(parse('rgb(255 0 0 / 50%)')).toEqual({ alpha: 0.5, hex: 'ff0000' });
    expect(parse('#00ff0080').hex).toBe('00ff00');
    expect(parse('#00ff0080').alpha).toBeCloseTo(128 / 255, 9);
    expect(parse('#ffffff')).toEqual({ alpha: 1, hex: 'ffffff' });
  });

  it('gives display values, as a canvas mixes colours', () => {
    const display = cssDisplayColor('rgba(255, 128, 0, 0.5)', new Vector4());
    // Through linear and back: to a hundred-thousandth.
    expect(display.x).toBeCloseTo(1, 4);
    expect(display.y).toBeCloseTo(128 / 255, 4);
    expect(display.z).toBeCloseTo(0, 4);
    expect(display.w).toBe(0.5);
  });
});
