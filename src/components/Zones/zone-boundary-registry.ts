import { PlanarPolygonGeometry } from '../../sdk';
import {
  ZoneBoundaryEntry,
  ZoneBoundaryRegistry,
  ZoneSeamRegistry,
  ZoneSurfaceClaim,
} from './ZoneContext';
import { resolveSeam, SeamDecision } from './seams';

/** A zone's boundary once it has settled. */
type SettledBoundary = {
  polygon: PlanarPolygonGeometry | null;
  rimSpacing?: number;
  version: number;
};

/**
 * What a {@link ZoneStack} knows about its children: which surfaces each one
 * CLAIMS, and the footprint each one settled on.
 *
 * ⭐ The two are deliberately separate maps with separate lifetimes. Claims change
 * whenever a zone's layers do, and a zone re-registers when they do; its settled
 * boundary must survive that, because publishing it is a different effect keyed on
 * the boundary and would not run again. Dropping the boundary on a re-registration
 * leaves it unresolved for good, and every zone sharing one of its horizons waits
 * on it forever.
 */
export type ZoneClaimStore = {
  claims: Map<string, ZoneSurfaceClaim[]>;
  boundaries: Map<string, SettledBoundary>;
};

export const createZoneClaimStore = (): ZoneClaimStore => ({
  claims: new Map(),
  boundaries: new Map(),
});

/** Register (or update) what a zone claims. */
export function setClaims(
  store: ZoneClaimStore,
  key: string,
  claims: ZoneSurfaceClaim[],
): void {
  store.claims.set(key, claims);
}

/**
 * Withdraw a zone's claims. ⚠️ Deliberately leaves its settled boundary alone —
 * see {@link ZoneClaimStore}. Use {@link releaseZone} when it is really gone.
 */
export function clearClaims(store: ZoneClaimStore, key: string): void {
  store.claims.delete(key);
}

/** Forget a zone entirely, for one that has unmounted. */
export function releaseZone(store: ZoneClaimStore, key: string): void {
  store.claims.delete(key);
  store.boundaries.delete(key);
}

/**
 * Record a zone's settled boundary: a polygon, `null` when it settled on no
 * footprint at all, or `undefined` to return it to unresolved.
 *
 * @returns whether anything actually changed, so an unchanged republish costs no
 *   rebuild
 */
export function publishBoundary(
  store: ZoneClaimStore,
  key: string,
  polygon: PlanarPolygonGeometry | null | undefined,
  rimSpacing?: number,
): boolean {
  if (polygon === undefined) {
    if (!store.boundaries.has(key)) return false;
    store.boundaries.delete(key);
    return true;
  }
  const settled = store.boundaries.get(key);
  if (
    settled &&
    settled.polygon === polygon &&
    settled.rimSpacing === rimSpacing
  ) {
    return false;
  }
  store.boundaries.set(key, {
    polygon,
    rimSpacing,
    // A version rather than the polygon's identity, so a zone consuming this as a
    // CUT has a content key it can memoize on — the registry itself is rebuilt
    // whole on every publish.
    version: (settled?.version ?? 0) + 1,
  });
  return true;
}

/**
 * Turn the claims and settled boundaries into the registry the zones read, and
 * decide who draws each shared horizon.
 *
 * ⭐ Who draws a shared horizon is decided here, from the footprints, rather than
 * declared per layer by the caller. A surface still resolving is left out — the
 * zones claiming it wait rather than build against a guess.
 */
export function buildBoundaryRegistry(store: ZoneClaimStore): {
  registry: ZoneBoundaryRegistry;
  seams: ZoneSeamRegistry;
} {
  const registry: ZoneBoundaryRegistry = new Map();
  store.claims.forEach((claimedSurfaces, key) => {
    const settled = store.boundaries.get(key);
    claimedSurfaces.forEach(({ id, top }) => {
      const entry: ZoneBoundaryEntry = {
        key,
        version: settled?.version ?? 0,
        resolved: store.boundaries.has(key),
        polygon: settled?.polygon ?? null,
        rimSpacing: settled?.rimSpacing,
        top,
      };
      const list = registry.get(id);
      if (list) list.push(entry);
      else registry.set(id, [entry]);
    });
  });

  const seams: ZoneSeamRegistry = new Map();
  registry.forEach((entries, id) => {
    if (entries.length < 2 || entries.some(e => !e.resolved)) return;
    const resolved = resolveSeam(entries);
    const perZone = new Map<string, SeamDecision>();
    entries.forEach((entry, i) => perZone.set(entry.key, resolved[i]));
    seams.set(id, perZone);
  });

  return { registry, seams };
}
