import { describe, expect, it } from 'vitest';
import { tileChildren, tileKey } from '../src/sdk/tiles/tile-keys';
import {
  tileOffsetIn,
  TileTransitions,
  type TileTransitionDraw,
} from '../src/sdk/tiles/tile-transitions';

const parent = tileKey(3, 2, 5);
const children = tileChildren(parent);
const grandchildren = tileChildren(children[0]);
const all = () => true;
const tiles = { isIn: all };
const byKey = (draw: TileTransitionDraw[]) =>
  new Map(draw.map(d => [d.key, d]));

describe('TileTransitions', () => {
  it('fades a first tile in, and settles', () => {
    const t = new TileTransitions(300);
    let draw = t.update([parent], 0, tiles);
    expect(draw).toEqual([{ key: parent, from: null, blend: 0 }]);
    expect(t.active).toBe(true);
    draw = t.update([parent], 150, tiles);
    expect(draw[0].blend).toBeCloseTo(0.5);
    draw = t.update([parent], 300, tiles);
    expect(draw).toEqual([{ key: parent, from: null, blend: 1 }]);
    expect(t.active).toBe(false);
  });

  it('shows a first tile at once without fade-in', () => {
    const t = new TileTransitions(300, false);
    expect(t.update([parent], 0, tiles)).toEqual([
      { key: parent, from: null, blend: 1 },
    ]);
    expect(t.active).toBe(false);
  });

  it('blends a split from the parent, keeping the parent in', () => {
    const t = new TileTransitions(300, false);
    t.update([parent], 0, tiles);
    let draw = byKey(t.update(children, 1000, tiles));
    expect(draw.has(parent)).toBe(false);
    for (const child of children)
      expect(draw.get(child)).toEqual({ key: child, from: parent, blend: 0 });
    expect(t.keep).toEqual([parent]);
    draw = byKey(t.update(children, 1150, tiles));
    expect(draw.get(children[0])!.blend).toBeCloseTo(0.5);
    draw = byKey(t.update(children, 1300, tiles));
    expect(draw.get(children[0])).toEqual({
      key: children[0],
      from: null,
      blend: 1,
    });
    expect(t.keep).toEqual([]);
    expect(t.active).toBe(false);
  });

  it('blends from the nearest drawn ancestor across levels', () => {
    const t = new TileTransitions(300, false);
    t.update([parent], 0, tiles);
    const draw = byKey(
      t.update([...grandchildren, ...children.slice(1)], 1000, tiles),
    );
    expect(draw.get(grandchildren[2])!.from).toBe(parent);
    expect(draw.get(children[3])!.from).toBe(parent);
  });

  it('holds the children on a merge, blending back, then draws the parent', () => {
    const t = new TileTransitions(300, false);
    t.update(children, 0, tiles);
    let draw = byKey(t.update([parent], 1000, tiles));
    expect(draw.has(parent)).toBe(false);
    for (const child of children)
      expect(draw.get(child)).toEqual({ key: child, from: parent, blend: 1 });
    expect(new Set(t.keep)).toEqual(new Set([parent, ...children]));
    draw = byKey(t.update([parent], 1150, tiles));
    expect(draw.get(children[1])!.blend).toBeCloseTo(0.5);
    expect(t.active).toBe(true);
    draw = byKey(t.update([parent], 1300, tiles));
    expect([...draw.keys()]).toEqual([parent]);
    expect(draw.get(parent)).toEqual({ key: parent, from: null, blend: 1 });
    expect(t.active).toBe(false);
  });

  it('merges at once when what is drawn does not cover the parent', () => {
    const t = new TileTransitions(300, false);
    t.update(children.slice(0, 3), 0, tiles);
    const draw = t.update([parent], 1000, tiles);
    expect(draw).toEqual([{ key: parent, from: null, blend: 1 }]);
  });

  it('counts blank tiles as covered', () => {
    const t = new TileTransitions(300, false);
    t.update(children.slice(0, 3), 0, tiles);
    const draw = byKey(
      t.update([parent], 1000, {
        isIn: all,
        isBlank: key => key === children[3],
      }),
    );
    expect(draw.has(parent)).toBe(false);
    expect(draw.get(children[0])!.from).toBe(parent);
  });

  it('takes a merge undone on from where its blend is', () => {
    const t = new TileTransitions(300, false);
    t.update(children, 0, tiles);
    t.update([parent], 1000, tiles);
    // Half way back toward the parent, then the children are chosen again.
    let draw = byKey(t.update(children, 1150, tiles));
    expect(draw.has(parent)).toBe(false);
    expect(draw.get(children[0])).toEqual({
      key: children[0],
      from: parent,
      blend: 0.5,
    });
    draw = byKey(t.update(children, 1300, tiles));
    expect(draw.get(children[0])!.blend).toBeCloseTo(1);
    expect(t.active).toBe(false);
  });

  it('drops a source no longer in, showing the tile as it is', () => {
    const t = new TileTransitions(300, false);
    t.update([parent], 0, tiles);
    t.update(children, 1000, tiles);
    const draw = t.update(children, 1100, { isIn: key => key !== parent });
    expect(draw.every(d => d.from === null && d.blend === 1)).toBe(true);
  });

  it('swaps fixed tiles at once, neither blending nor holding', () => {
    const t = new TileTransitions(300, false);
    const fixed = { isIn: all, fixed: () => true };
    t.update([parent], 0, fixed);
    expect(
      t
        .update(children, 1000, fixed)
        .every(d => d.from === null && d.blend === 1),
    ).toBe(true);
    expect(t.update([parent], 2000, fixed)).toEqual([
      { key: parent, from: null, blend: 1 },
    ]);
    expect(t.active).toBe(false);
  });

  it('keeps a tile drawn until all the tiles chosen in its place are in', () => {
    const t = new TileTransitions(300, false);
    t.update([parent], 0, tiles);
    // The children chosen, none in: the parent stays.
    let inSet = new Set([parent]);
    let isIn = (key: number) => inSet.has(key);
    expect(t.update(children, 1000, { isIn })).toEqual([
      { key: parent, from: null, blend: 1 },
    ]);
    expect(t.keep).toEqual([parent]);
    // Three in: still the parent alone, nothing drawn twice.
    inSet = new Set([parent, ...children.slice(0, 3)]);
    isIn = key => inSet.has(key);
    expect(t.update(children, 1100, { isIn }).map(d => d.key)).toEqual([
      parent,
    ]);
    // All in: the children, blending from it.
    inSet = new Set([parent, ...children]);
    isIn = key => inSet.has(key);
    const draw = byKey(t.update(children, 1200, { isIn }));
    expect(draw.has(parent)).toBe(false);
    expect(draw.get(children[2])).toEqual({
      key: children[2],
      from: parent,
      blend: 0,
    });
  });

  it('replaces a stand-in once what is chosen of it is in, the rest out of view', () => {
    const t = new TileTransitions(300, false);
    t.update([parent], 0, tiles);
    // Only two tiles chosen (the rest out of view), both in, one two levels down.
    const deep = tileChildren(children[3])[1];
    const chosen = [children[0], deep];
    const draw = byKey(t.update(chosen, 1000, tiles));
    expect(draw.has(parent)).toBe(false);
    expect(draw.get(deep)!.from).toBe(parent);
  });

  it('counts blank tiles as covering a stand-in', () => {
    const t = new TileTransitions(300, false);
    t.update([parent], 0, tiles);
    const inSet = new Set([parent, ...children.slice(0, 3)]);
    const draw = byKey(
      t.update(children, 1000, {
        isIn: key => inSet.has(key),
        isBlank: key => key === children[3],
      }),
    );
    expect(draw.has(parent)).toBe(false);
    expect(draw.get(children[0])!.from).toBe(parent);
  });

  it('keeps the children drawn while the parent they merge into loads', () => {
    const t = new TileTransitions(300, false);
    t.update(children, 0, tiles);
    let isIn = (key: number) => key !== parent;
    expect(
      t
        .update([parent], 1000, { isIn })
        .map(d => d.key)
        .sort(),
    ).toEqual([...children].sort());
    isIn = all;
    // In: held, blending back toward it.
    const draw = byKey(t.update([parent], 1100, { isIn }));
    expect(draw.get(children[0])).toEqual({
      key: children[0],
      from: parent,
      blend: 1,
    });
  });

  it('does not bring in a tile that may not be drawn, but keeps one drawn as a stand-in', () => {
    const t = new TileTransitions(300, false);
    // Chosen, in, but too coarse to bring in: nothing.
    const coarse = { isIn: all, drawable: (key: number) => key !== parent };
    expect(t.update([parent], 0, coarse)).toEqual([]);
    // Drawn before it became too coarse: kept, while its children load.
    t.update([parent], 1000, tiles);
    const inSet = new Set([parent]);
    expect(
      t.update(children, 2000, {
        isIn: key => inSet.has(key),
        drawable: key => inSet.has(key) && key !== parent,
      }),
    ).toEqual([{ key: parent, from: null, blend: 1 }]);
  });

  it('lets go at once of what is no longer chosen at all', () => {
    const t = new TileTransitions(300, false);
    t.update([parent], 0, tiles);
    const elsewhere = tileKey(3, 7, 1);
    expect(t.update([elsewhere], 1000, tiles)).toEqual([
      { key: elsewhere, from: null, blend: 1 },
    ]);
  });

  it('swaps at once with no duration', () => {
    const t = new TileTransitions(0);
    t.update([parent], 0, tiles);
    expect(t.update(children, 1, tiles).every(d => d.blend === 1)).toBe(true);
    expect(t.update([parent], 2, tiles)).toEqual([
      { key: parent, from: null, blend: 1 },
    ]);
    expect(t.active).toBe(false);
  });
});

describe('tileOffsetIn', () => {
  it('places a tile in an ancestor, levels up', () => {
    expect(tileOffsetIn(children[3], parent)).toEqual([0.5, 0.5, 0.5]);
    expect(tileOffsetIn(tileChildren(children[3])[2], parent)).toEqual([
      0.5, 0.75, 0.25,
    ]);
    expect(tileOffsetIn(parent, parent)).toEqual([0, 0, 1]);
  });
});
