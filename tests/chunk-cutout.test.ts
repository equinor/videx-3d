import { describe, expect, it } from 'vitest';
import {
  CutoutSource,
  resolveCutoutSource,
} from '../src/components/Chunks/cutout';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';

const polygon = new PlanarPolygonGeometry([
  [
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  ],
]);

const stackWellbores: CutoutSource = {
  kind: 'wellbores',
  wellbores: ['a', 'b'],
  options: { radius: 800, feather: 2 },
};

describe('resolveCutoutSource', () => {
  it('inherits the stack source for "inherit"', () => {
    expect(resolveCutoutSource('inherit', stackWellbores)).toBe(stackWellbores);
    expect(resolveCutoutSource('inherit', null)).toBeNull();
  });

  it('wraps a bare polygon geometry as a polygon source', () => {
    const r = resolveCutoutSource(polygon, null);
    expect(r).toEqual({ kind: 'polygon', polygon });
  });

  it('uses an explicit polygon source as-is', () => {
    const src: CutoutSource = { kind: 'polygon', polygon };
    expect(resolveCutoutSource(src, stackWellbores)).toBe(src);
  });

  it('merges a partial override over the stack wellbore source', () => {
    // options only -> inherit wellbores, merge options (override wins per key)
    const r = resolveCutoutSource(
      { kind: 'wellbores', options: { radius: 1500 } },
      stackWellbores,
    );
    expect(r).toEqual({
      kind: 'wellbores',
      wellbores: ['a', 'b'],
      options: { radius: 1500, feather: 2 },
    });
  });

  it('lets an override supply its own wellbores while inheriting options', () => {
    const r = resolveCutoutSource(
      { kind: 'wellbores', wellbores: ['c'] },
      stackWellbores,
    );
    expect(r).toEqual({
      kind: 'wellbores',
      wellbores: ['c'],
      options: { radius: 800, feather: 2 },
    });
  });

  it('returns null when a wellbore override has no wells and the stack has none', () => {
    expect(
      resolveCutoutSource(
        { kind: 'wellbores', options: { radius: 500 } },
        null,
      ),
    ).toBeNull();
    // stack is a polygon -> no wellbores to inherit
    expect(
      resolveCutoutSource(
        { kind: 'wellbores', options: { radius: 500 } },
        { kind: 'polygon', polygon },
      ),
    ).toBeNull();
  });
});
