import { describe, expect, it } from 'vitest';
import { resolveSeam, SeamClaim } from '../src/components/Chunks/seams';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { polygonRelation } from '../src/sdk/geometries/polygon-outline';

const square = (x0: number, z0: number, x1: number, z1: number) =>
  new PlanarPolygonGeometry([
    [
      [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
    ],
  ]);

const claim = (
  key: string,
  polygon: PlanarPolygonGeometry | null,
  top = false,
): SeamClaim => ({ key, polygon, top, version: 1 });

describe('polygonRelation', () => {
  const outer = square(0, 0, 100, 100);

  it('classifies the four cases', () => {
    expect(polygonRelation(outer, square(20, 20, 80, 80))).toBe('contains');
    expect(polygonRelation(square(20, 20, 80, 80), outer)).toBe('contained');
    expect(polygonRelation(outer, square(200, 0, 300, 100))).toBe('disjoint');
    expect(polygonRelation(outer, square(50, 50, 150, 150))).toBe('overlap');
  });

  it('reads two identical outlines as containment, not as an overlap', () => {
    expect(polygonRelation(outer, square(0, 0, 100, 100))).toBe('contains');
  });

  it('does not call a shared boundary an overlap', () => {
    expect(polygonRelation(outer, square(100, 0, 200, 100))).toBe('disjoint');
  });

  it('excludes a hole', () => {
    const holed = new PlanarPolygonGeometry([
      [
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        [
          [40, 40],
          [60, 40],
          [60, 60],
          [40, 60],
        ],
      ],
    ]);
    expect(polygonRelation(holed, square(45, 45, 55, 55))).toBe('disjoint');
  });
});

describe('resolveSeam', () => {
  it('leaves a lone claim alone', () => {
    const [only] = resolveSeam([claim('a', square(0, 0, 100, 100))]);
    expect(only).toEqual({ draw: true, cuts: [] });
  });

  it('gives the horizon to the wider chunk when it is nobody’s lid', () => {
    const wide = square(0, 0, 100, 100);
    const narrow = square(20, 20, 80, 80);
    const [a, b] = resolveSeam([claim('wide', wide), claim('narrow', narrow)]);

    expect(a.draw).toBe(true);
    expect(a.cuts).toHaveLength(0);
    expect(b.draw).toBe(false);
  });

  it('is insensitive to the order the chunks registered in', () => {
    const wide = square(0, 0, 100, 100);
    const narrow = square(20, 20, 80, 80);
    const [narrowFirst, wideFirst] = resolveSeam([
      claim('narrow', narrow),
      claim('wide', wide),
    ]);

    expect(narrowFirst.draw).toBe(false);
    expect(wideFirst.draw).toBe(true);
  });

  it('lets two chunks side by side both draw', () => {
    const [a, b] = resolveSeam([
      claim('left', square(0, 0, 100, 100)),
      claim('right', square(100, 0, 200, 100)),
    ]);

    expect(a.draw).toBe(true);
    expect(b.draw).toBe(true);
    expect(a.cuts).toHaveLength(0);
    expect(b.cuts).toHaveLength(0);
  });

  it('partitions a partial overlap, cutting the smaller one', () => {
    const big = square(0, 0, 100, 100);
    const small = square(60, 60, 140, 140);
    const [a, b] = resolveSeam([claim('big', big), claim('small', small)]);

    expect(a.draw).toBe(true);
    expect(a.cuts).toHaveLength(0);
    expect(b.draw).toBe(true);
    expect(b.cuts).toEqual([
      { key: 'big', version: 1, polygon: big, rimSpacing: undefined },
    ]);
  });

  it('draws nothing for a chunk with no footprint', () => {
    const [a, b] = resolveSeam([
      claim('a', square(0, 0, 100, 100)),
      claim('none', null),
    ]);

    expect(a.draw).toBe(true);
    expect(b.draw).toBe(false);
  });

  it('gives the horizon to the chunk it is the LID of, however small', () => {
    const wide = square(0, 0, 100, 100);
    const narrow = square(20, 20, 80, 80);
    const [outer, lid] = resolveSeam([
      claim('wide', wide),
      claim('narrow', narrow, true),
    ]);

    // The lid owner draws its own footprint whole; the wider chunk keeps a hole
    // for it, so each part is drawn with the appearance of the block below it.
    expect(lid.draw).toBe(true);
    expect(lid.cuts).toHaveLength(0);
    expect(outer.draw).toBe(true);
    expect(outer.cuts).toEqual([
      { key: 'narrow', version: 1, polygon: narrow, rimSpacing: undefined },
    ]);
  });

  it('leaves the wider chunk nothing when the lid owner contains it', () => {
    const wide = square(0, 0, 100, 100);
    const [lid, inner] = resolveSeam([
      claim('wide', wide, true),
      claim('inner', square(20, 20, 80, 80)),
    ]);

    expect(lid.draw).toBe(true);
    expect(lid.cuts).toHaveLength(0);
    expect(inner.draw).toBe(false);
  });

  it('gives a partial overlap to the lid owner, not to the larger chunk', () => {
    const big = square(0, 0, 100, 100);
    const small = square(60, 60, 140, 140);
    const [b, s] = resolveSeam([
      claim('big', big),
      claim('small', small, true),
    ]);

    expect(s.draw).toBe(true);
    expect(s.cuts).toHaveLength(0);
    expect(b.draw).toBe(true);
    expect(b.cuts).toEqual([
      { key: 'small', version: 1, polygon: small, rimSpacing: undefined },
    ]);
  });

  it('lets two lid owners side by side both draw', () => {
    const [a, b] = resolveSeam([
      claim('left', square(0, 0, 100, 100), true),
      claim('right', square(100, 0, 200, 100), true),
    ]);

    expect(a.draw).toBe(true);
    expect(b.draw).toBe(true);
    expect(a.cuts).toHaveLength(0);
    expect(b.cuts).toHaveLength(0);
  });

  it('orders two lid owners by area, so the wider one keeps the overlap', () => {
    const big = square(0, 0, 100, 100);
    const small = square(60, 60, 140, 140);
    const [b, s] = resolveSeam([
      claim('big', big, true),
      claim('small', small, true),
    ]);

    expect(b.cuts).toHaveLength(0);
    expect(s.cuts).toEqual([
      { key: 'big', version: 1, polygon: big, rimSpacing: undefined },
    ]);
  });

  it('cuts a chunk overlapped by two others with both of them', () => {
    const west = square(0, 0, 100, 100);
    const east = square(120, 0, 220, 100);
    const middle = square(50, 20, 170, 60);
    const [, , m] = resolveSeam([
      claim('west', west),
      claim('east', east),
      claim('middle', middle),
    ]);

    expect(m.draw).toBe(true);
    expect(m.cuts).toHaveLength(2);
  });
});
