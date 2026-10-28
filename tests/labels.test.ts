import { Color, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  labelAtlasKey,
  ShelfPacker,
} from '../src/components/Labels/label-atlas';
import {
  labelAnchor,
  labelFade,
  labelReadsBackward,
  labelFadeRanges,
  labelFrame,
} from '../src/components/Labels/label-geometry';
import {
  cssColorAlpha,
  cssDisplayColor,
  LABEL_INSTANCE_FLOATS,
  LabelLayerMesh,
  LabelTexts,
  writeLabelInstances,
} from '../src/components/Labels/label-mesh';
import {
  LABEL_STYLE_DEFAULTS,
  LabelStyle,
} from '../src/components/Labels/types';

const style = (patch: Partial<LabelStyle> = {}): LabelStyle => ({
  ...LABEL_STYLE_DEFAULTS,
  ...patch,
});

// Every text at the same place, 2 ems by 1.5; out of room after `room` texts.
const texts = (room = Infinity): LabelTexts => {
  let used = 0;
  return {
    entry: () =>
      used++ < room
        ? { u0: 0.1, v0: 0.2, u1: 0.3, v1: 0.4, width: 2, height: 1.5 }
        : null,
  };
};

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

  it('hides a label from behind, and fades it in as it turns to face the camera', () => {
    // Large enough on screen whatever its slant.
    const big = 1e4;
    expect(fade({ minFacing: 0 }, -0.1, big)).toBe(0);
    expect(fade({ minFacing: 0 }, 0.01, big)).toBe(1);
    expect(fade({ minFacing: 0.2 }, 0.19, big)).toBe(0);
    expect(fade({ minFacing: 0.2 }, 0.3, big)).toBeCloseTo(0.5, 9);
    expect(fade({ minFacing: 0.2 }, 0.4, big)).toBe(1);
  });

  it('fades a label out as its slant thins it to a sliver, however large face-on', () => {
    // 100 pixels face-on, seen at a cosine of 0.05: 5 high, under the least, 6.
    expect(fade({ minFacing: 0, minPixels: 6 }, 0.05, 100)).toBe(0);
    // At 0.075: 7.5 high, halfway into 6–9.
    expect(fade({ minFacing: 0, minPixels: 6 }, 0.075, 100)).toBeCloseTo(
      0.5,
      9,
    );
  });

  it('fades a label in as it grows on screen', () => {
    expect(fade({ minPixels: 6 }, 1, 5)).toBe(0);
    expect(fade({ minPixels: 6 }, 1, 7.5)).toBeCloseTo(0.5, 9);
    expect(fade({ minPixels: 6 }, 1, 9)).toBe(1);
  });

  it('shows a label only within its distances', () => {
    expect(fade({ maxDistance: 999 })).toBe(0);
    expect(fade({ minDistance: 1001 })).toBe(0);
    expect(fade({ minDistance: 1000, maxDistance: 1000 })).toBe(1);
  });

  it('fades over the ranges and distances asked for, times its opacity', () => {
    expect(fade({ minFacing: 0.2, fullFacing: 0.6 }, 0.4)).toBeCloseTo(0.5, 9);
    // A full bound short of the least: a step there.
    expect(fade({ minFacing: 0.2, fullFacing: 0.1 }, 0.21)).toBe(1);
    expect(fade({ minPixels: 6, fullPixels: 26 }, 1, 16)).toBeCloseTo(0.5, 9);
    // 1000 away: 100 inside the farthest of 1100, fading over 200.
    expect(fade({ maxDistance: 1100, fadeDistance: 200 })).toBeCloseTo(0.5, 9);
    expect(fade({ minDistance: 900, fadeDistance: 400 })).toBeCloseTo(0.25, 9);
    // No least distance: no fade near the camera.
    expect(fade({ fadeDistance: 5000 })).toBe(1);
    expect(fade({ opacity: 0.3 })).toBeCloseTo(0.3, 9);
  });

  it('caps a label at its largest on screen, shrunk rather than faded', () => {
    expect(fade({ maxPixels: 48 }, 1, 1e4)).toBe(1);
    // Shrunk to 48 face-on, seen at a cosine of 0.15: 7.2 high, 40% into 6–9.
    expect(fade({ maxPixels: 48, minFacing: 0 }, 0.15, 1e4)).toBeCloseTo(
      0.4,
      9,
    );
    expect(fade({ minFacing: 0 }, 0.15, 1e4)).toBe(1);
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
  it('defaults the full bounds to twice and 1.5 times the least', () => {
    expect(labelFadeRanges(style({ minFacing: 0.2, minPixels: 6 }))).toEqual({
      facing: [0.2, 0.4],
      pixels: [6, 9],
    });
    expect(labelFadeRanges(style({ fullFacing: 0.9, fullPixels: 20 }))).toEqual(
      { facing: [0.2, 0.9], pixels: [6, 20] },
    );
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

describe('labelAtlasKey', () => {
  it('keeps a text apart for each look the atlas draws', () => {
    const base = style();
    const key = labelAtlasKey('a', base);
    expect(labelAtlasKey('a', style({ fontStyle: 'italic' }))).not.toBe(key);
    expect(labelAtlasKey('a', style({ letterSpacing: 0.1 }))).not.toBe(key);
    expect(labelAtlasKey('a', style({ fontWeight: 400 }))).not.toBe(key);
    // Its colours are the layer's: one text for them all.
    expect(labelAtlasKey('a', style({ color: '#123456' }))).toBe(key);
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

describe('writeLabelInstances', () => {
  it('writes where each label is, its frame, its text and its own size', () => {
    const out = new Float32Array(2 * LABEL_INSTANCE_FLOATS);
    const written = writeLabelInstances(
      [
        { text: 'a', position: [1, 2, 3] },
        { text: 'b', position: [4, 5, 6], normal: [0, 0, 2], size: 2.5 },
      ],
      style(),
      texts(),
      out,
    );
    expect(written).toBe(true);
    // -0 as 0.
    const first = Array.from(
      out.subarray(0, LABEL_INSTANCE_FLOATS),
      x => x + 0,
    );
    expect(first.slice(0, 9)).toEqual([1, 2, 3, 0, 1, 0, 1, 0, 0]);
    // Its own size, 1 left out.
    expect(first.slice(9)).toEqual(
      [0.1, 0.2, 0.3, 0.4, 2, 1.5, 1].map(Math.fround),
    );
    // Its normal, unit length.
    const second = LABEL_INSTANCE_FLOATS;
    expect(Array.from(out.subarray(second + 3, second + 6))).toEqual([0, 0, 1]);
    expect(out[second + LABEL_INSTANCE_FLOATS - 1]).toBe(2.5);
  });

  it('tells when the texts ran out of room', () => {
    const out = new Float32Array(2 * LABEL_INSTANCE_FLOATS);
    const labels = [
      { text: 'a', position: [0, 0, 0] as [number, number, number] },
      { text: 'b', position: [0, 0, 0] as [number, number, number] },
    ];
    expect(writeLabelInstances(labels, style(), texts(1), out)).toBe(false);
  });
});

describe('LabelLayerMesh', () => {
  it('draws as many labels as it is given, growing to them', () => {
    const layer = new LabelLayerMesh();
    const labels = Array.from({ length: 10 }, (_, i) => ({
      text: `${i}`,
      position: [i, 0, 0] as [number, number, number],
    }));
    expect(layer.write(labels, style(), texts())).toBe(true);
    expect(layer.count).toBe(10);
    expect(layer.write(labels.slice(0, 3), style(), texts())).toBe(true);
    expect(layer.count).toBe(3);
    expect(layer.write(labels, style(), texts(5))).toBe(false);
    expect(layer.count).toBe(0);
    layer.dispose();
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
