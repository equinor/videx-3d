import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  graticuleLabels,
  graticuleLabelSize,
  graticuleLabelText,
} from '../src/components/Scenery/scenery-graticule-labels';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';

// The demo field's frame (UTM 31N, ED50), the stage's disc 8 km across about its origin.
const FRAME: GeoFrame = {
  projection: getProjectionDefFromUtmZone('31N'),
  origin: [434500, 6478000],
};

const globe = () => {
  const g = new Globe();
  g.setDisc([-4000, -4000, 4000, 4000]);
  g.setFrame(FRAME);
  return g;
};

describe('graticuleLabelText', () => {
  it('names a line as finely as its step needs, with its hemisphere', () => {
    expect(graticuleLabelText(60, 10, 'lat')).toBe('60°N');
    expect(graticuleLabelText(-30, 10, 'lat')).toBe('30°S');
    expect(graticuleLabelText(58.5, 0.5, 'lat')).toBe('58°30′N');
    expect(graticuleLabelText(58, 0.5, 'lat')).toBe('58°00′N');
    expect(graticuleLabelText(2 + 1 / 12, 1 / 12, 'lon')).toBe('2°05′E');
    expect(graticuleLabelText(-(1 + 1 / 120), 1 / 120, 'lon')).toBe(
      '1°00′30″W',
    );
    expect(graticuleLabelText(0, 1, 'lon')).toBe('0°');
    expect(graticuleLabelText(-180, 30, 'lon')).toBe('180°');
    // Off a step by rounding: the step's own name.
    expect(graticuleLabelText(58 + 1 / 6 - 1e-12, 1 / 6, 'lat')).toBe(
      '58°10′N',
    );
  });
});

describe('graticuleLabels', () => {
  it('lays the labels flat on the sea, along their lines, midway between those across', () => {
    const g = globe();
    const step = 0.5;
    const labels = graticuleLabels(
      g,
      step,
      { latitude: 58.4, longitude: 1.9 },
      2,
      // Every line.
      1,
    );
    // 5 parallels and 5 meridians, a label of each in each of 5 cells.
    expect(labels).toHaveLength(2 * 5 * 5);
    const there = { latitude: 0, longitude: 0 };
    const up = new Vector3();
    for (const label of labels) {
      const at = new Vector3().fromArray(label.position);
      expect(Math.abs(g.altitude(at))).toBeLessThan(1e-3);
      g.upAt(at, up);
      expect(new Vector3().fromArray(label.normal!).dot(up)).toBeCloseTo(1, 9);
      g.geographic(at, there);
      const meridian = label.text.endsWith('E') || label.text.endsWith('W');
      // On its line, halfway between two of the others.
      const [own, across] = meridian
        ? [there.longitude, there.latitude]
        : [there.latitude, there.longitude];
      expect(Math.abs(own / step - Math.round(own / step))).toBeLessThan(1e-6);
      const half = across / step - 0.5;
      expect(Math.abs(half - Math.round(half))).toBeLessThan(1e-6);
      // Reading along its line: north up a meridian, east along a parallel.
      const direction = new Vector3().fromArray(label.direction!).normalize();
      const along = meridian
        ? g.north
        : new Vector3().crossVectors(g.north, up);
      expect(direction.dot(along)).toBeGreaterThan(0.95);
    }
  });

  it('puts the labels where the lines are, whatever the view between them', () => {
    const g = globe();
    const key = (l: { text: string; position: number[] }) =>
      `${l.text}|${l.position.map(v => v.toFixed(3)).join(',')}`;
    const a = graticuleLabels(g, 1, { latitude: 58.1, longitude: 1.8 }).map(
      key,
    );
    const b = graticuleLabels(g, 1, { latitude: 57.7, longitude: 2.4 }).map(
      key,
    );
    expect(b).toEqual(a);
    // A line further on: the window moves by a line, the labels it shares stay.
    const c = graticuleLabels(g, 1, { latitude: 59.2, longitude: 1.8 }).map(
      key,
    );
    expect(c).not.toEqual(a);
    const shared = c.filter(label => a.includes(label));
    expect(shared.length).toBeGreaterThan(0.8 * a.length);
  });

  it('labels every second line, from 0°', () => {
    const g = globe();
    const labels = graticuleLabels(
      g,
      0.5,
      { latitude: 58.4, longitude: 1.9 },
      2,
    );
    // Lines 115–119 of latitude, 2–6 of longitude: 116 and 118, and 2, 4 and 6.
    expect(labels).toHaveLength(2 * 2 * 3);
    expect(new Set(labels.map(l => l.text))).toEqual(
      new Set(['58°00′N', '59°00′N', '1°00′E', '2°00′E', '3°00′E']),
    );
  });

  it('keeps every label clear of every other, at any latitude and step', () => {
    const g = globe();
    // A generous width for sans-serif: an em and a half of halo, 0.65 em a character.
    const extent = (text: string, size: number) => ({
      half: (text.length * 0.65 + 2 * 0.07) * size * 0.5,
      halfHeight: 0.65 * size,
    });
    const normal = new Vector3();
    for (const latitude of [0, 30, 58.4, 70])
      for (const step of [1, 1 / 6, 1 / 60]) {
        const size = graticuleLabelSize(step, latitude);
        const labels = graticuleLabels(g, step, { latitude, longitude: 2 }, 6);
        const boxes = labels.map(l => {
          const at = new Vector3().fromArray(l.position);
          normal.fromArray(l.normal!);
          const u = new Vector3().fromArray(l.direction!).normalize();
          const v = new Vector3().crossVectors(normal, u);
          return { at, u, v, text: l.text, ...extent(l.text, size) };
        });
        type Box = (typeof boxes)[number];
        // Apart along an axis: their half-widths along it fall short of their distance.
        const apart = (a: Box, b: Box, axis: Vector3) => {
          const d = Math.abs(b.at.clone().sub(a.at).dot(axis));
          const r = (box: Box) =>
            box.half * Math.abs(box.u.dot(axis)) +
            box.halfHeight * Math.abs(box.v.dot(axis));
          return d > r(a) + r(b);
        };
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const [a, b] = [boxes[i], boxes[j]];
            if (a.at.distanceTo(b.at) > 4 * (a.half + b.half)) continue;
            const clear =
              apart(a, b, a.u) ||
              apart(a, b, a.v) ||
              apart(a, b, b.u) ||
              apart(a, b, b.v);
            expect(
              clear,
              `${a.text} and ${b.text}, ${latitude}°, step ${step}`,
            ).toBe(true);
          }
      }
  });
});
