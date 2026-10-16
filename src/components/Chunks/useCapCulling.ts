import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { BufferGeometry, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { useReleasedFrame } from '../../hooks/useReleasedFrame';
import { SurfaceChunk, SurfaceChunkMesh } from '../../sdk';
import {
  capVisibilityKey,
  createCapView,
  createIntervalProbe,
  keyOnlyHides,
  releaseCapView,
  visibleCapIndex,
} from './cap-visibility';

const NONE: readonly number[] = [];
const cameraLocal = new Vector3();

function sameItems<T>(a: readonly T[] | null, b: readonly T[] | null) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The build intervals of `chunk` the camera is inside, or within `band` (plus the
 * near plane, which can clip a cap open) of. Polled every frame; re-renders only
 * when the answer changes.
 *
 * @param root an object in the chunk's own frame (its meshes' parent)
 */
export function useCameraIntervals(
  chunk: SurfaceChunk,
  root: RefObject<Object3D | null>,
  enabled: boolean,
  band = 2,
): readonly number[] {
  const probe = useMemo(
    () => (enabled ? createIntervalProbe(chunk) : null),
    [chunk, enabled],
  );
  const [units, setUnits] = useState<readonly number[]>(NONE);
  useReleasedFrame(({ camera }) => {
    let next = NONE;
    if (probe && root.current) {
      camera.getWorldPosition(cameraLocal);
      root.current.worldToLocal(cameraLocal);
      const near = (camera as PerspectiveCamera).near ?? 0;
      const found = probe(
        cameraLocal.x,
        cameraLocal.y,
        cameraLocal.z,
        band + near,
      );
      if (found.length > 0) next = found;
    }
    if (!sameItems(next, units)) setUnits(next);
  });
  return units;
}

type CapEntry = { key: string; geometry: BufferGeometry | null };

type CulledCaps = {
  chunk: SurfaceChunk;
  /** per cap, the key its geometry answers for */
  keys: string[] | null;
  geometries: (BufferGeometry | null)[] | null;
};

/**
 * What to draw for each of `chunk.surfaces`: the cap itself, a view of its
 * visible triangles (see `createCapView`), or `null` for nothing. `null` overall
 * means "draw every cap whole".
 *
 * ⭐ A cap is only re-filtered when the open state of a unit it actually faces
 * changes, so the camera crossing one horizon touches the caps of that unit and
 * nothing else. Until a change is applied, a cap it reveals more of is drawn
 * whole, so a stale result never hides one. A change that only hides keeps the
 * cap's view (more than needed), and is applied one cap per frame.
 *
 * @param tables per surface, its open table (`capOpenTable`), or `null` to draw
 *   it whole; `null` overall to cull nothing
 */
export function useCulledCaps(
  chunk: SurfaceChunk,
  tables: (Uint8Array | null)[] | null,
): (BufferGeometry | null)[] | null {
  const keys = useMemo(
    () =>
      tables
        ? chunk.surfaces.map((surface, i) =>
            tables[i] ? capVisibilityKey(surface, tables[i]) : '',
          )
        : null,
    [chunk, tables],
  );

  const [built, setBuilt] = useState<CulledCaps | null>(null);
  // Mutated in place, never reassigned, so the unmount cleanup can hold them.
  const live = useRef(new Map<SurfaceChunkMesh, CapEntry>());
  const retired = useRef<BufferGeometry[]>([]);
  // Caps drawing more than their key needs, and the frame that swaps one of them.
  const deferred = useRef(new Set<SurfaceChunkMesh>());
  const applyOne = useRef(false);
  const [tick, setTick] = useState(0);
  useReleasedFrame(() => {
    if (deferred.current.size === 0 || applyOne.current) return;
    applyOne.current = true;
    setTick(t => t + 1);
  });

  // ⚠️ Declared BEFORE the effect that retires views: a view retired in this
  // commit may still be on screen until the state it was replaced in commits.
  useEffect(() => {
    const views = retired.current.splice(0);
    views.forEach(releaseCapView);
  }, [built]);

  useEffect(() => {
    const previous = new Map(live.current);
    live.current.clear();
    const due = applyOne.current
      ? deferred.current.values().next().value
      : undefined;
    applyOne.current = false;
    deferred.current.clear();
    const geometries =
      tables && keys
        ? chunk.surfaces.map((surface, i) => {
            const table = tables[i];
            const index = surface.geometry.getIndex();
            if (!table || !surface.above || !surface.below || !index) {
              return surface.geometry;
            }
            let entry = previous.get(surface);
            if (
              entry &&
              entry.key !== keys[i] &&
              surface !== due &&
              keyOnlyHides(entry.key, keys[i])
            ) {
              deferred.current.add(surface);
            } else if (!entry || entry.key !== keys[i]) {
              const visible = visibleCapIndex(
                index.array,
                surface.above,
                surface.below,
                table,
              );
              entry = {
                key: keys[i],
                geometry:
                  visible === index.array
                    ? surface.geometry
                    : visible.length === 0
                      ? null
                      : createCapView(surface.geometry, visible),
              };
            }
            live.current.set(surface, entry);
            return entry.geometry;
          })
        : null;
    for (const [surface, entry] of previous) {
      if (live.current.get(surface) === entry) continue;
      if (entry.geometry && entry.geometry !== surface.geometry) {
        retired.current.push(entry.geometry);
      }
    }
    setBuilt(current =>
      current &&
      current.chunk === chunk &&
      sameItems(current.keys, keys) &&
      sameItems(current.geometries, geometries)
        ? current
        : { chunk, keys, geometries },
    );
  }, [chunk, tables, keys, tick]);

  useEffect(() => {
    const views = live.current;
    const queue = retired.current;
    return () => {
      for (const [surface, entry] of views) {
        if (entry.geometry && entry.geometry !== surface.geometry) {
          releaseCapView(entry.geometry);
        }
      }
      views.clear();
      queue.splice(0).forEach(releaseCapView);
    };
  }, []);

  return useMemo(() => {
    if (!keys || !built || built.chunk !== chunk) return null;
    const { keys: answered, geometries } = built;
    if (!answered || !geometries) return null;
    if (sameItems(answered, keys)) return geometries;
    return chunk.surfaces.map((surface, i) =>
      keyOnlyHides(answered[i], keys[i]) ? geometries[i] : surface.geometry,
    );
  }, [built, chunk, keys]);
}
