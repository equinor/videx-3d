import { PlanarPolygonGeometry } from '../../sdk';
import {
  ChunkOutlineEntry,
  ChunkOutlineRegistry,
  ChunkSeamRegistry,
  ChunkSurfaceClaim,
} from './ChunkContext';
import { resolveSeam, SeamDecision } from './seams';

/** A chunk's outline once it has settled. */
type SettledOutline = {
  polygon: PlanarPolygonGeometry | null;
  rimSpacing?: number;
  version: number;
};

/**
 * What a {@link ChunkStack} knows about its children: which surfaces each one
 * CLAIMS, and the footprint each one settled on.
 *
 * ⭐ The two are deliberately separate maps with separate lifetimes. Claims change
 * whenever a chunk's layers do, and a chunk re-registers when they do; its settled
 * outline must survive that, because publishing it is a different effect keyed on
 * the outline and would not run again. Dropping the outline on a re-registration
 * leaves it unresolved for good, and every chunk sharing one of its horizons waits
 * on it forever.
 */
export type ChunkClaimStore = {
  claims: Map<string, ChunkSurfaceClaim[]>;
  outlines: Map<string, SettledOutline>;
};

export const createChunkClaimStore = (): ChunkClaimStore => ({
  claims: new Map(),
  outlines: new Map(),
});

/** Register (or update) what a chunk claims. */
export function setClaims(
  store: ChunkClaimStore,
  key: string,
  claims: ChunkSurfaceClaim[],
): void {
  store.claims.set(key, claims);
}

/**
 * Withdraw a chunk's claims. ⚠️ Deliberately leaves its settled outline alone —
 * see {@link ChunkClaimStore}. Use {@link releaseChunk} when it is really gone.
 */
export function clearClaims(store: ChunkClaimStore, key: string): void {
  store.claims.delete(key);
}

/** Forget a chunk entirely, for one that has unmounted. */
export function releaseChunk(store: ChunkClaimStore, key: string): void {
  store.claims.delete(key);
  store.outlines.delete(key);
}

/**
 * Record a chunk's settled outline: a polygon, `null` when it settled on no
 * footprint at all, or `undefined` to return it to unresolved.
 *
 * @returns whether anything actually changed, so an unchanged republish costs no
 *   rebuild
 */
export function publishOutline(
  store: ChunkClaimStore,
  key: string,
  polygon: PlanarPolygonGeometry | null | undefined,
  rimSpacing?: number,
): boolean {
  if (polygon === undefined) {
    if (!store.outlines.has(key)) return false;
    store.outlines.delete(key);
    return true;
  }
  const settled = store.outlines.get(key);
  if (
    settled &&
    settled.polygon === polygon &&
    settled.rimSpacing === rimSpacing
  ) {
    return false;
  }
  store.outlines.set(key, {
    polygon,
    rimSpacing,
    // A version rather than the polygon's identity, so a chunk consuming this as a
    // CUT has a content key it can memoize on — the registry itself is rebuilt
    // whole on every publish.
    version: (settled?.version ?? 0) + 1,
  });
  return true;
}

/**
 * Turn the claims and settled outlines into the registry the chunks read, and
 * decide who draws each shared horizon.
 *
 * ⭐ Who draws a shared horizon is decided here, from the footprints, rather than
 * declared per layer by the caller. A surface still resolving is left out — the
 * chunks claiming it wait rather than build against a guess.
 */
export function buildOutlineRegistry(store: ChunkClaimStore): {
  registry: ChunkOutlineRegistry;
  seams: ChunkSeamRegistry;
} {
  const registry: ChunkOutlineRegistry = new Map();
  store.claims.forEach((claimedSurfaces, key) => {
    const settled = store.outlines.get(key);
    claimedSurfaces.forEach(({ id, top }) => {
      const entry: ChunkOutlineEntry = {
        key,
        version: settled?.version ?? 0,
        resolved: store.outlines.has(key),
        polygon: settled?.polygon ?? null,
        rimSpacing: settled?.rimSpacing,
        top,
      };
      const list = registry.get(id);
      if (list) list.push(entry);
      else registry.set(id, [entry]);
    });
  });

  const seams: ChunkSeamRegistry = new Map();
  registry.forEach((entries, id) => {
    if (entries.length < 2 || entries.some(e => !e.resolved)) return;
    const resolved = resolveSeam(entries);
    const perChunk = new Map<string, SeamDecision>();
    entries.forEach((entry, i) => perChunk.set(entry.key, resolved[i]));
    seams.set(id, perChunk);
  });

  return { registry, seams };
}
