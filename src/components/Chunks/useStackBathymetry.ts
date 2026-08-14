import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../../hooks/useData';
import { SurfaceMeta } from '../../sdk';
import {
  ChunkDepthMap,
  UtmToScene,
  buildSurfaceDepthMap,
} from './chunk-depth-map';

/**
 * Load the sea bed's grid and prepare it for the chunk shaders' water tint.
 *
 * ⭐ Appearance layer, like `useChunkContacts`: the bathymetry never enters a
 * build spec, so it costs one texture upload and no geometry rebuild.
 *
 * ⚠️ The surface is the COLUMN's shallowest, i.e. the same one the sea's own
 * geometry ends against — a second opinion about where the bed is would show as a
 * mismatch along the whole shoreline.
 */
export function useStackBathymetry(
  surface: SurfaceMeta | undefined,
  utmToScene: UtmToScene | undefined,
): ChunkDepthMap | null {
  const store = useData();
  const held = useRef<{ id: string; map: ChunkDepthMap } | null>(null);
  const [, bump] = useState(0);

  const drop = useCallback(() => {
    if (!held.current) return;
    held.current.map.texture.dispose();
    held.current = null;
  }, []);

  const id = surface?.id;

  useEffect(() => {
    if (!store || !utmToScene || !surface) {
      if (held.current) {
        drop();
        bump(n => n + 1);
      }
      return;
    }
    if (held.current?.id === surface.id) return;
    let cancelled = false;
    (async () => {
      const values = await store.get<Float32Array>(
        'surface-values',
        surface.id,
      );
      if (cancelled || !values) return;
      drop();
      held.current = {
        id: surface.id,
        map: buildSurfaceDepthMap(surface, values, utmToScene),
      };
      bump(n => n + 1);
    })();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed by surface id
  }, [store, utmToScene, id]);

  useEffect(() => () => drop(), [drop]);

  const current = held.current;
  return current && current.id === id ? current.map : null;
}
