import { describe, expect, it } from 'vitest';
import {
  COLOR_RAMP_CAPACITY,
  COLOR_RAMP_WIDTH,
  builtInColorRamps,
  colorRampIndex,
  colorRampInterpolators,
  colorRampPalette,
  colorRampRow,
  colorRampTexture,
  registerColorRamp,
  resolveColorRamp,
  sampleColorRamp,
} from '../src/common/color-ramps';

const texel = (row: number, x: number) => {
  const data = colorRampTexture.image.data as Uint8Array;
  const i = (row * COLOR_RAMP_WIDTH + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};

const css = (value: string) =>
  /rgba?\((\d+), (\d+), (\d+)/.exec(value)!.slice(1, 4).map(Number);

describe('color ramps', () => {
  it('keeps the ten value ramps in their rows, as their interpolators draw them', () => {
    expect(colorRampTexture.image.height).toBe(COLOR_RAMP_CAPACITY);
    // Not the very ends: there the old HCL blend missed `earth`'s white by a few levels
    // (255, 254, 248); a row ends on its stop's colour exactly.
    colorRampInterpolators.forEach((interpolate, row) => {
      for (let x = 1; x < COLOR_RAMP_WIDTH - 1; x += 7) {
        const expected = css(interpolate(x / (COLOR_RAMP_WIDTH - 1)));
        const got = texel(row, x);
        got.forEach((v, c) =>
          expect(Math.abs(v - expected[c])).toBeLessThanOrEqual(1),
        );
      }
    });
    expect(colorRampIndex('rainbow')).toBe(0);
    expect(colorRampIndex('gray')).toBe(9);
  });

  it('places stops in data units over the domain', () => {
    const terrain = builtInColorRamps.find(r => r.name === 'terrain')!;
    const [low, high] = terrain.domain!;
    for (const stop of terrain.stops) {
      const at = sampleColorRamp(terrain, (stop.at - low) / (high - low));
      const hex = String(stop.color).slice(1);
      const want = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      expect(at).toEqual(want);
    }
  });

  it('registers, finds and replaces ramps by name', () => {
    const mine = {
      name: 'test-two-stops',
      interpolation: 'rgb' as const,
      stops: [
        { at: 1, color: '#ffffff' },
        { at: 0, color: '#000000' },
      ],
    };
    const row = registerColorRamp(mine);
    expect(row).toBe(builtInColorRamps.length);
    expect(registerColorRamp(mine)).toBe(row);
    expect(resolveColorRamp('test-two-stops')).toBe(row);
    expect(resolveColorRamp(mine)).toBe(row);
    expect(texel(row, 0)).toEqual([0, 0, 0]);
    expect(texel(row, COLOR_RAMP_WIDTH - 1)).toEqual([255, 255, 255]);

    const palette = colorRampPalette(row);
    registerColorRamp({ ...mine, stops: [{ at: 0, color: '#ff0000' }] });
    expect(texel(row, 100)).toEqual([255, 0, 0]);
    expect(Array.from((palette.image.data as Uint8Array).slice(0, 3))).toEqual([
      255, 0, 0,
    ]);
    expect(colorRampRow(row)).toBeCloseTo((row + 0.5) / COLOR_RAMP_CAPACITY);
  });

  it('clamps rows and falls back from unknown names', () => {
    expect(resolveColorRamp(-3)).toBe(0);
    expect(resolveColorRamp(1e6)).toBeLessThan(COLOR_RAMP_CAPACITY);
    expect(resolveColorRamp('no-such-ramp')).toBe(0);
  });

  it('refuses ramps past its capacity', () => {
    expect(() => {
      for (let i = 0; i <= COLOR_RAMP_CAPACITY; i++)
        registerColorRamp({
          name: `fill-${i}`,
          stops: [{ at: 0, color: '#000' }],
        });
    }).toThrow(/No room/);
  });
});
