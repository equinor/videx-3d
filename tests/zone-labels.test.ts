import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  graticuleZoneLabels,
  graticuleZoneLabelSize,
  timeZoneCells,
  timeZoneLabelText,
  utmZoneCells,
  utmZoneLabelText,
  type GraticuleZoneCell,
} from '../src/components/Scenery/scenery-zone-labels';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import { Globe } from '../src/sdk/projection/globe';

const globe = () => {
  const g = new Globe();
  g.setDisc([-4000, -4000, 4000, 4000]);
  g.setFrame({
    projection: getProjectionDefFromUtmZone('31N'),
    origin: [434500, 6478000],
  });
  return g;
};

// The cells of each row, west to east.
const rows = (cells: readonly GraticuleZoneCell[]) => {
  const by = new Map<number, GraticuleZoneCell[]>();
  for (const cell of cells)
    by.set(cell.south, [...(by.get(cell.south) ?? []), cell]);
  for (const row of by.values()) row.sort((a, b) => a.west - b.west);
  return [...by.entries()].sort((a, b) => a[0] - b[0]);
};

// Each row from 180°W to 180°E with no gap or overlap, the rows from 80°S to 84°N.
const expectTiles = (cells: readonly GraticuleZoneCell[]) => {
  let south = -80;
  for (const [rowSouth, row] of rows(cells)) {
    expect(rowSouth).toBe(south);
    let west = -180;
    for (const cell of row) {
      expect(cell.west, `${cell.text} at ${cell.south}°`).toBe(west);
      expect(cell.east).toBeGreaterThan(cell.west);
      expect(cell.south).toBe(rowSouth);
      west = cell.east;
    }
    expect(west).toBe(180);
    south = row[0].north;
  }
  expect(south).toBe(84);
};

describe('utmZoneCells', () => {
  it('tiles 80°S to 84°N by zones and latitude bands', () => {
    const cells = utmZoneCells();
    expectTiles(cells);
    // 60 zones in 20 bands, but 32X, 34X and 36X.
    expect(cells).toHaveLength(60 * 20 - 3);
  });

  it('names the zones as their projections are, and keeps Norway’s and Svalbard’s', () => {
    const cells = utmZoneCells();
    const at = (south: number, text: string) =>
      cells
        .filter(c => c.south === south && c.text === text)
        .map(c => [c.west, c.east]);
    // Band M, 8°S to 0°: south; N, 0° to 8°N: north.
    expect(at(-8, '31S')).toEqual([[0, 6]]);
    expect(at(0, '31N')).toEqual([[0, 6]]);
    // Band V: 31V 0°–3°E, 32V 3°–12°E.
    expect(at(56, '31N')).toEqual([[0, 3]]);
    expect(at(56, '32N')).toEqual([[3, 12]]);
    // Band X, 72°N to 84°N: 31X, 33X, 35X and 37X, no 32X, 34X or 36X.
    expect(at(72, '31N')).toEqual([[0, 9]]);
    expect(at(72, '32N')).toEqual([]);
    expect(at(72, '33N')).toEqual([[9, 21]]);
    expect(at(72, '35N')).toEqual([[21, 33]]);
    expect(at(72, '37N')).toEqual([[33, 42]]);
    expect(cells.find(c => c.south === 72)!.north).toBe(84);
  });
});

describe('timeZoneCells', () => {
  it('tiles the Earth in 15° zones, the date line splitting UTC±12', () => {
    const cells = timeZoneCells();
    expectTiles(cells);
    const row = rows(cells)[0][1];
    expect(row.map(c => c.text)).toHaveLength(25);
    expect(row[0]).toMatchObject({
      west: -180,
      east: -172.5,
      text: 'UTC\u221212',
    });
    expect(row[12]).toMatchObject({ west: -7.5, east: 7.5, text: 'UTC±0' });
    expect(row[24]).toMatchObject({ west: 172.5, east: 180, text: 'UTC+12' });
  });
});

describe('zone label text', () => {
  it('names zones and offsets', () => {
    expect(utmZoneLabelText(32, false)).toBe('32N');
    expect(utmZoneLabelText(23, true)).toBe('23S');
    expect(timeZoneLabelText(1)).toBe('UTC+1');
    expect(timeZoneLabelText(-3)).toBe('UTC\u22123');
    expect(timeZoneLabelText(0)).toBe('UTC±0');
  });
});

describe('graticuleZoneLabels', () => {
  it('names each cell at its middle, flat on the sea, reading east', () => {
    const g = globe();
    const cells = utmZoneCells().filter(c => c.south === 56);
    const labels = graticuleZoneLabels(g, cells);
    const there = { latitude: 0, longitude: 0 };
    const up = new Vector3();
    labels.forEach((label, i) => {
      const at = new Vector3().fromArray(label.position);
      expect(Math.abs(g.altitude(at))).toBeLessThan(1e-3);
      g.geographic(at, there);
      expect(there.latitude).toBeCloseTo(60, 6);
      expect(there.longitude).toBeCloseTo(
        (cells[i].west + cells[i].east) / 2,
        6,
      );
      g.upAt(at, up);
      // East there: square to north there, which far round the globe is not the field's.
      const north = g
        .geodetic(
          60 + 1e-3,
          (cells[i].west + cells[i].east) / 2,
          0,
          new Vector3(),
        )
        .sub(at)
        .normalize();
      const east = new Vector3().crossVectors(north, up);
      expect(
        new Vector3().fromArray(label.direction!).normalize().dot(east),
      ).toBeGreaterThan(0.95);
      expect(label.size).toBe(graticuleZoneLabelSize(cells[i]));
    });
  });

  it('fits each name in its cell, clear of every other, at any latitude', () => {
    const g = globe();
    for (const cells of [utmZoneCells(), timeZoneCells()]) {
      // Near the field and the date line, every row: neighbours across zones and bands.
      const near = cells.filter(
        c => (c.west < 20 && c.east > -20) || c.east > 160 || c.west < -160,
      );
      const labels = graticuleZoneLabels(g, near);
      // A generous width for sans-serif: an em and a half of halo, 0.65 em a character.
      const boxes = labels.map(l => {
        const size = l.size!;
        const at = new Vector3().fromArray(l.position);
        const n = new Vector3().fromArray(l.normal!);
        const u = new Vector3().fromArray(l.direction!).normalize();
        const v = new Vector3().crossVectors(n, u);
        return {
          at,
          u,
          v,
          text: l.text,
          half: (l.text.length * 0.65 + 0.14) * size * 0.5,
          halfHeight: 0.65 * size,
        };
      });
      type Box = (typeof boxes)[number];
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
          expect(clear, `${a.text} and ${b.text}`).toBe(true);
        }
      // And inside its own cell east–west, at its poleward edge.
      near.forEach((cell, i) => {
        const poleward = Math.max(Math.abs(cell.south), Math.abs(cell.north));
        const across =
          (cell.east - cell.west) *
          Math.cos((poleward * Math.PI) / 180) *
          ((Math.PI / 180) * 6371008.8);
        expect(2 * boxes[i].half, cell.text).toBeLessThan(across);
      });
    }
  });
});
