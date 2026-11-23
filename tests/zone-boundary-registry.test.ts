import { describe, expect, it } from 'vitest';
import {
  buildBoundaryRegistry,
  clearClaims,
  createZoneClaimStore,
  publishBoundary,
  releaseZone,
  setClaims,
} from '../src/components/Zones/zone-boundary-registry';
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
  store: ReturnType<typeof createZoneClaimStore>,
  id: string,
) =>
  (buildBoundaryRegistry(store).registry.get(id) ?? []).map(e => [
    e.key,
    e.resolved,
  ]);

describe('zone boundary registry', () => {
  it('reports a zone as unresolved until it publishes a boundary', () => {
    const store = createZoneClaimStore();
    setClaims(store, 'a', [{ id: 'top', top: true }]);
    expect(resolvedOf(store, 'top')).toEqual([['a', false]]);

    publishBoundary(store, 'a', square(100));
    expect(resolvedOf(store, 'top')).toEqual([['a', true]]);
  });

  // ⭐ The deadlock this exists to prevent: a zone re-registers whenever its
  // layers change, and publishing its boundary is a SEPARATE effect keyed on the
  // boundary. If withdrawing the claims took the boundary with them, the boundary
  // would never be republished, and every zone sharing one of its horizons would
  // wait on it forever.
  it('keeps a published boundary across a re-registration', () => {
    const store = createZoneClaimStore();
    setClaims(store, 'a', [{ id: 'top', top: true }]);
    publishBoundary(store, 'a', square(100));

    clearClaims(store, 'a');
    setClaims(store, 'a', [
      { id: 'top', top: true },
      { id: 'base', top: false },
    ]);

    expect(resolvedOf(store, 'top')).toEqual([['a', true]]);
    expect(resolvedOf(store, 'base')).toEqual([['a', true]]);
  });

  it('forgets a zone that is released', () => {
    const store = createZoneClaimStore();
    setClaims(store, 'a', [{ id: 'top', top: true }]);
    publishBoundary(store, 'a', square(100));

    releaseZone(store, 'a');
    expect(buildBoundaryRegistry(store).registry.size).toBe(0);

    setClaims(store, 'a', [{ id: 'top', top: true }]);
    expect(resolvedOf(store, 'top')).toEqual([['a', false]]);
  });

  it('decides a shared horizon only once every claimant has settled', () => {
    const store = createZoneClaimStore();
    setClaims(store, 'a', [{ id: 'shared', top: true }]);
    setClaims(store, 'b', [{ id: 'shared', top: true }]);
    publishBoundary(store, 'a', square(1000));

    expect(buildBoundaryRegistry(store).seams.has('shared')).toBe(false);

    publishBoundary(store, 'b', square(100));
    const seams = buildBoundaryRegistry(store).seams.get('shared');
    expect(seams?.size).toBe(2);
    // Exactly one of the two draws it.
    expect([...seams!.values()].filter(d => d.draw)).toHaveLength(1);
  });

  it('only reports a change when the published boundary differs', () => {
    const store = createZoneClaimStore();
    const polygon = square(100);
    setClaims(store, 'a', [{ id: 'top', top: true }]);

    expect(publishBoundary(store, 'a', polygon)).toBe(true);
    expect(publishBoundary(store, 'a', polygon)).toBe(false);
    expect(publishBoundary(store, 'a', polygon, 50)).toBe(true);
    expect(publishBoundary(store, 'a', undefined)).toBe(true);
    expect(publishBoundary(store, 'a', undefined)).toBe(false);
  });
});
