import { describe, expect, it } from 'vitest';
import {
  buildOutlineRegistry,
  clearClaims,
  createChunkClaimStore,
  publishOutline,
  releaseChunk,
  setClaims,
} from '../src/components/Chunks/chunk-outline-registry';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';

/** A square of `size`, centred on the origin. */
const square = (size: number) => {
  const h = size / 2;
  return new PlanarPolygonGeometry(
    [
      [
        [
          [-h, -h],
          [h, -h],
          [h, h],
          [-h, h],
          [-h, -h],
        ],
      ],
    ],
    [0, 0],
  );
};

const resolvedOf = (
  store: ReturnType<typeof createChunkClaimStore>,
  id: string,
) =>
  (buildOutlineRegistry(store).registry.get(id) ?? []).map(e => [
    e.key,
    e.resolved,
  ]);

describe('chunk outline registry', () => {
  it('reports a chunk as unresolved until it publishes an outline', () => {
    const store = createChunkClaimStore();
    setClaims(store, 'a', [{ id: 'top', top: true }]);
    expect(resolvedOf(store, 'top')).toEqual([['a', false]]);

    publishOutline(store, 'a', square(100));
    expect(resolvedOf(store, 'top')).toEqual([['a', true]]);
  });

  // ⭐ The deadlock this exists to prevent: a chunk re-registers whenever its
  // layers change, and publishing its outline is a SEPARATE effect keyed on the
  // outline. If withdrawing the claims took the outline with them, the outline
  // would never be republished, and every chunk sharing one of its horizons would
  // wait on it forever.
  it('keeps a published outline across a re-registration', () => {
    const store = createChunkClaimStore();
    setClaims(store, 'a', [{ id: 'top', top: true }]);
    publishOutline(store, 'a', square(100));

    clearClaims(store, 'a');
    setClaims(store, 'a', [
      { id: 'top', top: true },
      { id: 'base', top: false },
    ]);

    expect(resolvedOf(store, 'top')).toEqual([['a', true]]);
    expect(resolvedOf(store, 'base')).toEqual([['a', true]]);
  });

  it('forgets a chunk that is released', () => {
    const store = createChunkClaimStore();
    setClaims(store, 'a', [{ id: 'top', top: true }]);
    publishOutline(store, 'a', square(100));

    releaseChunk(store, 'a');
    expect(buildOutlineRegistry(store).registry.size).toBe(0);

    setClaims(store, 'a', [{ id: 'top', top: true }]);
    expect(resolvedOf(store, 'top')).toEqual([['a', false]]);
  });

  it('decides a shared horizon only once every claimant has settled', () => {
    const store = createChunkClaimStore();
    setClaims(store, 'a', [{ id: 'shared', top: true }]);
    setClaims(store, 'b', [{ id: 'shared', top: true }]);
    publishOutline(store, 'a', square(1000));

    expect(buildOutlineRegistry(store).seams.has('shared')).toBe(false);

    publishOutline(store, 'b', square(100));
    const seams = buildOutlineRegistry(store).seams.get('shared');
    expect(seams?.size).toBe(2);
    // Exactly one of the two draws it.
    expect([...seams!.values()].filter(d => d.draw)).toHaveLength(1);
  });

  it('only reports a change when the published outline differs', () => {
    const store = createChunkClaimStore();
    const polygon = square(100);
    setClaims(store, 'a', [{ id: 'top', top: true }]);

    expect(publishOutline(store, 'a', polygon)).toBe(true);
    expect(publishOutline(store, 'a', polygon)).toBe(false);
    expect(publishOutline(store, 'a', polygon, 50)).toBe(true);
    expect(publishOutline(store, 'a', undefined)).toBe(true);
    expect(publishOutline(store, 'a', undefined)).toBe(false);
  });
});
