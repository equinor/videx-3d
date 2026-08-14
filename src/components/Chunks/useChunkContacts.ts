import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../hooks/useData';
import {
  ChunkContact,
  ChunkContactMap,
  ChunkContactTexture,
  UtmToScene,
  buildContactMap,
  styleContact,
} from './chunk-contacts';

/**
 * Load each contact's grid and prepare it for the chunk shaders.
 *
 * ⭐ Entirely in the appearance layer: a contact never enters a build spec, so
 * changing, restyling or swapping one costs a texture upload at most and never a
 * geometry rebuild. That is what makes sweeping realisations affordable.
 *
 * ⚠️ The textures are cached by SURFACE id, so restyling a contact rebuilds only
 * the handful of small objects the uniforms need — not the grid.
 */
export function useChunkContacts(
  contacts: ChunkContact[] | undefined,
  utmToScene: UtmToScene | undefined,
): ChunkContactTexture[] | null {
  const store = useData();
  const maps = useRef(new Map<string, ChunkContactMap>());
  const [ready, setReady] = useState(0);

  const ids = contacts?.map(c => c.surface.id).join('|') ?? '';

  useEffect(() => {
    if (!store || !utmToScene || !contacts?.length) return;
    let cancelled = false;
    (async () => {
      const wanted = new Map(contacts.map(c => [c.surface.id, c.surface]));
      let added = false;
      for (const [id, surface] of wanted) {
        if (maps.current.has(id)) continue;
        const values = await store.get<Float32Array>('surface-values', id);
        if (cancelled) return;
        if (!values) continue;
        maps.current.set(id, buildContactMap(surface, values, utmToScene));
        added = true;
      }
      // A contact no longer declared keeps its texture alive until unmount
      // otherwise, and these are full grids.
      for (const [id, map] of maps.current) {
        if (wanted.has(id)) continue;
        map.texture.dispose();
        maps.current.delete(id);
        added = true;
      }
      if (added) setReady(n => n + 1);
    })();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed by surface ids
  }, [store, utmToScene, ids]);

  const cache = maps.current;
  useEffect(
    () => () => {
      for (const map of cache.values()) map.texture.dispose();
      cache.clear();
    },
    [cache],
  );

  return useMemo(() => {
    if (!contacts?.length) return null;
    const built = contacts
      .map(contact => {
        const map = maps.current.get(contact.surface.id);
        return map ? styleContact(contact, map) : null;
      })
      .filter((c): c is ChunkContactTexture => !!c);
    return built.length ? built : null;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `ready` tracks the cache
  }, [contacts, ready]);
}
