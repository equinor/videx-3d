import { describe, expect, it } from 'vitest';
import { colorRampIndex, colorRampRow } from '../src/common/color-ramps';
import { ContourColorMode } from '../src/common/types';
import {
  RELIEF_CONTOUR_LABEL_DEFAULTS,
  RELIEF_LOOKS,
  resolveReliefContourLabels,
  resolveReliefContours,
  SceneryReliefLooks,
} from '../src/components/Scenery/scenery-relief-look';

const row = (looks: SceneryReliefLooks, column: number, r: number) => {
  const data = looks.texture.image.data as Float32Array;
  const i = (r * RELIEF_LOOKS + column) * 4;
  return Array.from(data.slice(i, i + 4));
};

describe('relief looks', () => {
  it('maps a terrain ramp over its own heights, or the range given', () => {
    const looks = new SceneryReliefLooks();
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
    const looks = new SceneryReliefLooks();
    const rainbow = colorRampRow(colorRampIndex('rainbow'));
    looks.update({ color: { ramp: 'rainbow', seabed: 'ramp' } });
    expect(row(looks, 0, 0)).toEqual([rainbow, -3000, 2000, 1]);
    // Across land and seabed alike.
    expect(row(looks, 0, 2)).toEqual(row(looks, 0, 0));
    looks.update({ color: { ramp: 'rainbow', reverse: true } });
    expect(row(looks, 0, 0)).toEqual([rainbow, 0, 2000, 0]);
  });

  it('gives the seabed a ramp of its own', () => {
    const looks = new SceneryReliefLooks();
    looks.update({ color: { ramp: 'atlas', seabed: { ramp: 'bathymetry' } } });
    expect(row(looks, 0, 2)).toEqual([
      colorRampRow(colorRampIndex('bathymetry')),
      -6000,
      0,
      0,
    ]);
  });

  it('writes a flat colour and contours', () => {
    const looks = new SceneryReliefLooks();
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
    const looks = new SceneryReliefLooks();
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

describe('relief contour labels', () => {
  const labelsOf = (contours: Parameters<typeof resolveReliefContours>[0]) =>
    resolveReliefContourLabels(resolveReliefContours(contours));

  it('has none unless asked', () => {
    expect(labelsOf(true)).toBeNull();
    expect(labelsOf({ labels: false })).toBeNull();
    expect(labelsOf(undefined)).toBeNull();
  });

  it('writes in the lines\u2019 own colour, as strongly as they shade', () => {
    // Darkening: black, as strong as the lines, a hair of light grey round it.
    const dark = labelsOf({ labels: true, factor: 0.4 })!;
    expect(dark.color).toBe('#000000');
    expect(dark.opacity).toBeCloseTo(0.4);
    expect(dark.haloColor).toBe('rgba(210, 210, 210, 0.3)');
    expect(dark.haloWidth).toBe(RELIEF_CONTOUR_LABEL_DEFAULTS.haloWidth);
    // Mixed: their colour; a light one takes a dark grey halo.
    const mixed = labelsOf({
      labels: true,
      colorMode: ContourColorMode.mixed,
      color: '#ffcc00',
    })!;
    expect(mixed.color).toBe('#ffcc00');
    expect(mixed.opacity).toBeCloseTo(0.5);
    expect(mixed.haloColor).toBe('rgba(45, 45, 45, 0.3)');
    // Lightening: white, a quarter as strong.
    const light = labelsOf({
      labels: true,
      colorMode: ContourColorMode.lighten,
      factor: 0.8,
    })!;
    expect(light.color).toBe('#ffffff');
    expect(light.opacity).toBeCloseTo(0.2);
    // Never more than whole.
    expect(labelsOf({ labels: true, factor: 3 })!.opacity).toBe(1);
  });

  it('takes what is given over what the lines give', () => {
    const given = labelsOf({
      factor: 0.4,
      labels: { color: '#ff0000', opacity: 0.9, haloWidth: 0 },
    })!;
    expect(given.color).toBe('#ff0000');
    expect(given.opacity).toBe(0.9);
    expect(given.haloWidth).toBe(0);
    // Left out, the defaults.
    expect(given.size).toBe(RELIEF_CONTOUR_LABEL_DEFAULTS.size);
  });

  it('lies across its line and reads left to right by default', () => {
    const labels = labelsOf({ labels: true })!;
    expect(labels.baseline).toBe('middle');
    expect(labels.flip).toBe(true);
    const given = labelsOf({ labels: { baseline: 'top', flip: false } })!;
    expect(given.baseline).toBe('top');
    expect(given.flip).toBe(false);
  });
});
