import { describe, expect, it } from 'vitest';
import {
  geoDistance,
  greatCircleSteps,
  joinNearestEnd,
  simplifyGeoLine,
  type LonLat,
} from '../src/sdk/layers/geo-lines';
import { geoTileKeyAt } from '../src/sdk/tiles/geo-tile-keys';
import {
  composeTileOffsets,
  tileAncestors,
  tilesUnder,
} from '../src/sdk/tiles/tile-cover';
import { tileChildren, tileParent } from '../src/sdk/tiles/tile-keys';
import { tileOffsetIn } from '../src/sdk/tiles/tile-transitions';

describe('geo-lines', () => {
  it('measures great-circle distances', () => {
    // A degree of latitude, about 111.2 km on the mean sphere.
    expect(geoDistance([2, 58], [2, 59])).toBeCloseTo(111195, -1);
    // Along a parallel at 60°, half as far.
    expect(geoDistance([0, 60], [1, 60])).toBeCloseTo(55597, -2);
  });

  it('steps along the great circle, ending at the end', () => {
    const a: LonLat = [1.9, 58.4];
    const b: LonLat = [5.5, 59.3];
    const steps = greatCircleSteps(a, b, 1000);
    expect(steps.at(-1)).toEqual(b);
    const total = geoDistance(a, b);
    expect(steps.length).toBe(Math.ceil(total / 1000));
    let previous = a;
    for (const step of steps) {
      expect(geoDistance(previous, step)).toBeLessThanOrEqual(1000.5);
      previous = step;
    }
  });

  it('joins a line’s nearest free end to each facility', () => {
    const parts: LonLat[][] = [
      [
        [2.0, 58.0],
        [2.5, 58.2],
      ],
    ];
    const used = new Set<string>();
    // 500 m short of the start's facility, south of it.
    const from: LonLat = [2.0, 58.0 - 500 / 111195];
    const to: LonLat = [2.6, 58.2];
    expect(joinNearestEnd(parts, from, used)).toBeCloseTo(500, 0);
    expect(parts[0][0]).toEqual(from);
    const gap = joinNearestEnd(parts, to, used);
    expect(gap).toBeGreaterThan(5000);
    expect(parts[0].at(-1)).toEqual(to);
    // Both ends are taken: a third facility is not joined.
    expect(joinNearestEnd(parts, [2.0, 58.0], used)).toBe(-1);
  });

  it('leaves a line too far from a facility as it is', () => {
    const parts: LonLat[][] = [
      [
        [2.0, 58.0],
        [2.1, 58.0],
      ],
    ];
    const used = new Set<string>();
    expect(joinNearestEnd(parts, [5, 60], used, { maxGap: 60000 })).toBe(-1);
    expect(parts[0]).toHaveLength(2);
    expect(used.size).toBe(0);
  });

  it('takes an end already at its facility without moving it', () => {
    const parts: LonLat[][] = [
      [
        [2.0, 58.0],
        [2.1, 58.0],
      ],
    ];
    const used = new Set<string>();
    expect(joinNearestEnd(parts, [2.1, 58.0], used)).toBe(0);
    expect(parts[0]).toHaveLength(2);
    expect(used.has('0:end')).toBe(true);
  });

  it('simplifies a line within its tolerance, keeping its ends', () => {
    const line: LonLat[] = [];
    for (let i = 0; i <= 100; i++)
      line.push([2 + i * 0.01, 58 + 0.0001 * Math.sin(i)]);
    line[50] = [2.5, 58.05];
    const simple = simplifyGeoLine(line, 0.001);
    expect(simple[0]).toEqual(line[0]);
    expect(simple.at(-1)).toEqual(line.at(-1));
    expect(simple).toContainEqual([2.5, 58.05]);
    expect(simple.length).toBeLessThan(10);
  });
});

describe('tile-cover', () => {
  const key = geoTileKeyAt(8, 2.0, 58.4);

  it('finds the one tile drawn over all of a tile: itself or an ancestor', () => {
    const parent = tileParent(tileParent(key));
    const drawn = new Set([parent]);
    expect(tilesUnder(key, drawn, tileAncestors(drawn))).toEqual([
      { square: key, under: parent },
    ]);
    const self = new Set([key]);
    expect(tilesUnder(key, self, tileAncestors(self))).toEqual([
      { square: key, under: key },
    ]);
  });

  it('finds the finer tiles drawn under a tile, square by square', () => {
    const [a, b, c, d] = tileChildren(key);
    const finer = tileChildren(d);
    const drawn = new Set([a, b, c, ...finer]);
    const covers = tilesUnder(key, drawn, tileAncestors(drawn));
    expect(covers.map(({ square }) => square).sort()).toEqual(
      [a, b, c, ...finer].sort(),
    );
    for (const { square, under } of covers) expect(square).toBe(under);
    // Nothing drawn anywhere near: nothing.
    const elsewhere = new Set([geoTileKeyAt(8, 20, 40)]);
    expect(tilesUnder(key, elsewhere, tileAncestors(elsewhere))).toEqual([]);
  });

  it('composes offsets as tileOffsetIn gives them across two ancestors', () => {
    const child = tileChildren(tileChildren(key)[3])[1];
    const middle = tileParent(child);
    const top = tileParent(tileParent(middle));
    const composed = composeTileOffsets(
      tileOffsetIn(child, middle),
      tileOffsetIn(middle, top),
    );
    const direct = tileOffsetIn(child, top);
    composed.forEach((value, i) => expect(value).toBeCloseTo(direct[i], 12));
  });
});
