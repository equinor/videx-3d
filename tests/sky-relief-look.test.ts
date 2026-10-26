import { describe, expect, it } from 'vitest';
import { colorRampIndex, colorRampRow } from '../src/common/color-ramps';
import { ContourColorMode } from '../src/common/types';
import {
  RELIEF_LOOKS,
  SkyReliefLooks,
} from '../src/components/Sky/sky-relief-look';

const row = (looks: SkyReliefLooks, column: number, r: number) => {
  const data = looks.texture.image.data as Float32Array;
  const i = (r * RELIEF_LOOKS + column) * 4;
  return Array.from(data.slice(i, i + 4));
};

describe('relief looks', () => {
  it('maps a terrain ramp over its own heights, or the range given', () => {
    const looks = new SkyReliefLooks();
    looks.update({ color: 'ramp' });
    const terrain = colorRampRow(colorRampIndex('terrain'));
    expect(row(looks, 0, 0)).toEqual([terrain, 0, 6000, 0]);
    // The sea's seabed colour, darkened with depth.
    expect(row(looks, 0, 2)[0]).toBe(-1);

    looks.update({
      color: { ramp: 'terrain', min: -50, max: 900, reverse: true },
    });
    expect(row(looks, 0, 0)).toEqual([terrain, -50, 900, 1]);
  });

  it('runs a value ramp as a Surface does, its start at the top', () => {
    const looks = new SkyReliefLooks();
    const rainbow = colorRampRow(colorRampIndex('rainbow'));
    looks.update({ color: { ramp: 'rainbow', seabed: 'ramp' } });
    expect(row(looks, 0, 0)).toEqual([rainbow, -3000, 2000, 1]);
    // Across land and seabed alike.
    expect(row(looks, 0, 2)).toEqual(row(looks, 0, 0));
    looks.update({ color: { ramp: 'rainbow', reverse: true } });
    expect(row(looks, 0, 0)).toEqual([rainbow, 0, 2000, 0]);
  });

  it('gives the seabed a ramp of its own', () => {
    const looks = new SkyReliefLooks();
    looks.update({ color: { ramp: 'atlas', seabed: { ramp: 'bathymetry' } } });
    expect(row(looks, 0, 2)).toEqual([
      colorRampRow(colorRampIndex('bathymetry')),
      -6000,
      0,
      0,
    ]);
  });

  it('writes a flat colour and contours', () => {
    const looks = new SkyReliefLooks();
    looks.update({
      color: '#ff0000',
      contours: {
        interval: 25,
        major: 4,
        colorMode: ContourColorMode.mixed,
        seabed: false,
      },
    });
    expect(row(looks, 0, 0)[0]).toBe(-1);
    expect(row(looks, 0, 2)[0]).toBe(-2);
    expect(row(looks, 0, 1)).toEqual([1, 0, 0, ContourColorMode.mixed]);
    const lines = row(looks, 0, 3);
    expect([lines[0], lines[2], lines[3]]).toEqual([25, 4, 0]);
    expect(lines[1]).toBeCloseTo(0.8);
    expect(row(looks, 0, 4)[3]).toBe(0.5);
  });

  it('gives each layer its own look over the relief\u2019s', () => {
    const looks = new SkyReliefLooks();
    looks.update({ color: 'ramp', contours: true }, [
      undefined,
      { color: { ramp: 'rainbow', min: -130, max: -60 } },
    ]);
    // Layer 0 (column 1) is the relief's; layer 1 (column 2) its own colour, the relief's contours.
    expect(row(looks, 1, 0)).toEqual(row(looks, 0, 0));
    expect(row(looks, 2, 0)).toEqual([
      colorRampRow(colorRampIndex('rainbow')),
      -130,
      -60,
      1,
    ]);
    expect(row(looks, 2, 3)).toEqual(row(looks, 0, 3));
    // Past the layers given, the relief's.
    expect(row(looks, 5, 0)).toEqual(row(looks, 0, 0));
  });
});
