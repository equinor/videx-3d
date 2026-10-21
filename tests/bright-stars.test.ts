import { describe, expect, it } from 'vitest';
import {
  SKY_STAR_MARGIN,
  skyStarCatalogue,
  skyStarCell,
} from '../src/components/Sky/sky-star-catalogue';
import { brightStars } from '../src/sdk/utils/bright-stars';

const direction = (ra: number, dec: number) => {
  const a = (ra * Math.PI) / 180;
  const d = (dec * Math.PI) / 180;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
};

describe('brightStars', () => {
  const stars = brightStars();

  it('holds the stars to magnitude 5, brightest first', () => {
    expect(stars.count).toBeGreaterThan(1500);
    expect(Math.max(...stars.magnitude)).toBeLessThanOrEqual(5.02);
    for (let i = 1; i < stars.count; i++)
      expect(stars.magnitude[i]).toBeGreaterThanOrEqual(stars.magnitude[i - 1]);
  });

  it('starts with Sirius, where and as bright as it is', () => {
    expect(stars.magnitude[0]).toBeCloseTo(-1.46, 1);
    expect(stars.rightAscension[0]).toBeCloseTo(101.287, 2);
    expect(stars.declination[0]).toBeCloseTo(-16.716, 2);
    expect(stars.colorIndex[0]).toBeCloseTo(0, 1);
  });
});

describe('skyStarCatalogue', () => {
  const catalogue = skyStarCatalogue();
  const stars = brightStars();
  const n = catalogue.cellsPerEdge;
  const listed = (x: number, y: number, z: number) => {
    const [face, column, row] = skyStarCell(x, y, z, n);
    const cell = (face * n + row) * n + column;
    const first = catalogue.cells[cell * 2];
    const entries: number[][] = [];
    for (let k = first; k < first + catalogue.cells[cell * 2 + 1]; k++) {
      const v = catalogue.list.slice(k * 4, k * 4 + 3);
      const length = Math.hypot(...v);
      entries.push([...v].map(c => c / length));
    }
    return entries;
  };

  it('keeps cells small', () => {
    expect(catalogue.mostInCell).toBeLessThanOrEqual(16);
  });

  it('lists every star within its margin of a direction in that direction’s cell', () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const near = Math.cos(SKY_STAR_MARGIN * 0.95);
    for (let trial = 0; trial < 2000; trial++) {
      // About a random star, up to just inside its margin.
      const i = Math.floor(random() * stars.count);
      const offset = SKY_STAR_MARGIN * 0.95 * Math.sqrt(random());
      const turn = random() * 360;
      const d = direction(
        stars.rightAscension[i] +
          (offset * 180 * Math.cos(turn)) /
            Math.PI /
            Math.max(Math.cos((stars.declination[i] * Math.PI) / 180), 0.05),
        stars.declination[i] + (offset * 180 * Math.sin(turn)) / Math.PI,
      );
      const entries = listed(d[0], d[1], d[2]);
      for (let j = 0; j < stars.count; j++) {
        const s = direction(stars.rightAscension[j], stars.declination[j]);
        if (s[0] * d[0] + s[1] * d[1] + s[2] * d[2] < near) continue;
        const found = entries.some(
          e => e[0] * s[0] + e[1] * s[1] + e[2] * s[2] > 1 - 1e-9,
        );
        expect(found).toBe(true);
      }
    }
  });

  it('carries each star’s colour in its direction’s length', () => {
    const [x, y, z] = catalogue.list.slice(0, 3);
    const length = Math.hypot(x, y, z);
    const bv = length - 2;
    expect(bv).toBeGreaterThanOrEqual(-0.5);
    expect(bv).toBeLessThanOrEqual(2.1);
  });
});
