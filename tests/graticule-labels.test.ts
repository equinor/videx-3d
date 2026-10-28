import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  graticuleMeridianChain,
  graticuleMeridianThinning,
} from '../src/sdk/materials/graticule';
import {
  GRATICULE_LABEL_SMOOTH_MAX,
  graticuleLabelCentre,
  graticuleLabelColumns,
  graticuleLabelPattern,
  graticuleLabelPeriod,
  graticuleLabels,
  graticuleLabelSize,
  graticuleLabelSpacing,
  graticuleLabelStep,
  graticuleLabelText,
  graticuleLabelThinning,
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
      { reach: 2, density: 1, reference: 58.4 },
    );
    expect(labels.length).toBeGreaterThan(0);
    const there = { latitude: 0, longitude: 0 };
    const up = new Vector3();
    for (const label of labels) {
      const at = new Vector3().fromArray(label.position);
      expect(Math.abs(g.altitude(at))).toBeLessThan(1e-3);
      g.upAt(at, up);
      expect(new Vector3().fromArray(label.normal!).dot(up)).toBeCloseTo(1, 9);
      g.geographic(at, there);
      const meridian = !/[NS]$/.test(label.text);
      // On its line, halfway between two of the others drawn across it: parallels, or the
      // meridians drawn either side of a parallel, the narrower cells' (thinned poleward).
      const [own, across] = meridian
        ? [there.longitude, there.latitude]
        : [there.latitude, there.longitude];
      expect(Math.abs(own / step - Math.round(own / step))).toBeLessThan(1e-6);
      const index = Math.round(there.latitude / step);
      const cell = meridian
        ? step
        : step *
          Math.min(
            ...[index - 1, index]
              .map(band => graticuleMeridianThinning(step, band))
              .filter(m => m > 0),
          );
      const half = across / cell - 0.5;
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

  it('names every line in view, each once a period along it, the names staggered', () => {
    const g = globe();
    const there = { latitude: 0, longitude: 0 };
    for (const density of [1, 0.5]) {
      const k = graticuleLabelPeriod(density);
      const labels = graticuleLabels(
        g,
        1,
        { latitude: 58.4, longitude: 2 },
        { density, reference: 58.4 },
      );
      // Where along its line each name is, in steps.
      const along = new Map<string, number[]>();
      for (const label of labels) {
        g.geographic(new Vector3().fromArray(label.position), there);
        const meridian = !/[NS]$/.test(label.text);
        const at = meridian ? there.latitude : there.longitude;
        along.set(label.text, [...(along.get(label.text) ?? []), at]);
      }
      // Every line within a period of the view's centre.
      for (let i = 58 - k; i <= 58 + k; i++)
        expect(along.has(graticuleLabelText(i, 1, 'lat')), `${i}°`).toBe(true);
      for (let j = 2 - k; j <= 2 + k; j++)
        expect(along.has(graticuleLabelText(j, 1, 'lon')), `${j}°`).toBe(true);
      // No nearer than a period apart along its line, and a parallel's names a column
      // wider, poleward, for each time the meridians are thinned. A meridian's names change
      // phase where its rows are thinned differently: two cells apart there at the least.
      const zone = (latitude: number) =>
        graticuleLabelColumns(1, Math.floor(latitude), 58.4);
      for (const [text, places] of along) {
        places.sort((a, b) => a - b);
        const parallel = /[NS]$/.test(text);
        const m = parallel ? zone(parseFloat(text)) : 1;
        for (let n = 1; n < places.length; n++) {
          const same = parallel || zone(places[n]) === zone(places[n - 1]);
          expect(places[n] - places[n - 1], text).toBeGreaterThan(
            (same ? k * m : 2) - 1e-6,
          );
        }
      }
    }
  });

  it('spreads the names over the cells rather than in diagonal bands, never meeting', () => {
    for (let k = 4; k <= 40; k++) {
      const { s, t, h } = graticuleLabelPattern(k);
      expect((s * t) % k).toBe(1);
      const mod = (a: number) => ((a % k) + k) % k;
      for (let i = 0; i < k; i++)
        for (const j of [s * i, s * i + 1]) {
          const row = mod(t * j + h);
          expect([mod(i), mod(i - 1)]).not.toContain(row);
        }
    }
    // Wider apart than a diagonal step (√2 cells) once there is room.
    for (let k = 8; k <= 40; k++) {
      const { s } = graticuleLabelPattern(k);
      const mod = (a: number) => ((a % k) + k) % k;
      let nearest = Infinity;
      for (let i = 1; i < k; i++) {
        const dx = Math.abs(mod(s * i + k / 2) - k / 2);
        const dy = Math.abs(mod(i + k / 2) - k / 2);
        nearest = Math.min(nearest, Math.hypot(dx, dy));
      }
      expect(nearest, `k ${k}, s ${s}`).toBeGreaterThan(2);
    }
  });

  it('names a meridian only where it is drawn, as the lines thin toward the poles', () => {
    const g = globe();
    const there = { latitude: 0, longitude: 0 };
    for (const step of [10, 1, 0.5, 1 / 6])
      for (const latitude of [62, 75, 88, -88]) {
        const labels = graticuleLabels(
          g,
          step,
          { latitude, longitude: 2 },
          { density: 1, reference: 58.4 },
        );
        const meridians = labels.filter(label => !/[NS]$/.test(label.text));
        for (const label of meridians) {
          g.geographic(new Vector3().fromArray(label.position), there);
          const band = Math.floor(there.latitude / step);
          const m = graticuleMeridianThinning(step, band);
          const j = Math.round(there.longitude / step);
          expect(m > 0 && j % m === 0, `${label.text}, ${step}°`).toBe(true);
        }
      }
  });

  it('thins the meridians named toward the poles as the lines do, never closer than 4/5', () => {
    const DEG = Math.PI / 180;
    for (const step of [1, 1 / 6, 1 / 60]) {
      const chain = graticuleMeridianChain(step);
      let previous = 1;
      for (let latitude = 0; latitude < 89.9; latitude += 0.25) {
        const m = graticuleLabelThinning(step, latitude, 58.4);
        expect(chain).toContain(m);
        expect(m % previous).toBe(0);
        previous = m;
        expect(latitude > 58.4 || m === 1, `${latitude}°`).toBe(true);
        // Unless round the Earth in as few columns as the lines thin to.
        expect(
          m === chain[chain.length - 1] ||
            m * Math.cos(latitude * DEG) >= 0.8 * Math.cos(58.4 * DEG) - 1e-9,
          `${latitude}°, step ${step}`,
        ).toBe(true);
      }
    }
  });

  it('keeps every label clear of every other, at any latitude, step and density, drawn smooth too', () => {
    const g = globe();
    // A generous width for sans-serif: an em and a half of halo, 0.65 em a character.
    const extent = (text: string, size: number) => ({
      half: (text.length * 0.65 + 2 * 0.07) * size * 0.5,
      halfHeight: 0.65 * size,
    });
    const normal = new Vector3();
    // Stepped, and as large as smooth sizing grows them; sized at the field's latitude, the
    // view anywhere up to the pole.
    const views = [
      [0, 0],
      [30, 30],
      [58.4, 58.4],
      [70, 58.4],
      [80, 58.4],
      [88, 58.4],
      [-75, 58.4],
    ];
    for (const scale of [1, GRATICULE_LABEL_SMOOTH_MAX])
      for (const density of [1, 0.5])
        for (const [latitude, reference] of views)
          for (const step of [1, 1 / 6, 1 / 60]) {
            const size = graticuleLabelSize(step, reference) * scale;
            const labels = graticuleLabels(
              g,
              step,
              { latitude, longitude: 2 },
              { reach: 6, density, reference },
            );
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
                  `${a.text} and ${b.text}, ${latitude}°, step ${step}, ×${scale}, density ${density}`,
                ).toBe(true);
              }
          }
  });
});

describe('graticuleLabelCentre', () => {
  const DEG = Math.PI / 180;

  it('centres on where the view meets the sea, or past the horizon, on the horizon', () => {
    const g = globe();
    const height = 1e6;
    const camera = g.place(0, 0, height, new Vector3());
    const under = g.geographic(camera, { latitude: 0, longitude: 0 });
    const down = new Vector3(0, -1, 0);
    const centre = graticuleLabelCentre(g, camera, down);
    expect(centre.latitude).toBeCloseTo(under.latitude, 3);
    expect(centre.longitude).toBeCloseTo(under.longitude, 3);

    // Level, or above it, to the north: the horizon there, an arc of acos(R / (R + h)).
    const arc = Math.acos(g.radius / (g.radius + height)) / DEG;
    for (const lift of [0, 0.3, 2]) {
      const dir = g.north.clone().addScaledVector(g.up, lift);
      const horizon = graticuleLabelCentre(g, camera, dir);
      expect(Math.abs(horizon.latitude - under.latitude - arc)).toBeLessThan(
        0.5,
      );
      expect(Math.abs(horizon.longitude - under.longitude)).toBeLessThan(0.5);
    }

    // Straight up: under the camera.
    const up = graticuleLabelCentre(g, camera, new Vector3(0, 1, 0));
    expect(up.latitude).toBeCloseTo(under.latitude, 6);
    expect(up.longitude).toBeCloseTo(under.longitude, 6);
  });
});

describe('graticuleLabelStep', () => {
  it('follows the step the lines are seen at, held either side of the switch', () => {
    // 10′ drawn, 5′ fading in.
    const [step, finer] = [1 / 6, 1 / 12];
    expect(graticuleLabelStep(step, finer, 0.3)).toBe(step);
    expect(graticuleLabelStep(step, finer, 0.6)).toBe(finer);
    // Between the two: as it was.
    expect(graticuleLabelStep(step, finer, 0.5, step)).toBe(step);
    expect(graticuleLabelStep(step, finer, 0.5, finer)).toBe(finer);
    expect(graticuleLabelStep(step, finer, 0.4, finer)).toBe(step);
    // The finest step: nothing finer.
    expect(graticuleLabelStep(1 / 60, 1 / 60, 0)).toBe(1 / 60);
  });
});

describe('graticuleLabelSpacing', () => {
  it('meets each step at either end of its fade, and never jumps between steps', () => {
    expect(graticuleLabelSpacing(10, 5, 0)).toBe(10);
    expect(graticuleLabelSpacing(10, 5, 1)).toBeCloseTo(5, 12);
    // Halfway on a log scale.
    expect(graticuleLabelSpacing(30, 10, 0.5)).toBeCloseTo(Math.sqrt(300), 9);
    // Where 10′ fully faded in hands over to 10′ drawn, 5′ to come: the same spacing.
    expect(graticuleLabelSpacing(30, 10, 1)).toBeCloseTo(
      graticuleLabelSpacing(10, 5, 0),
      12,
    );
  });
});
