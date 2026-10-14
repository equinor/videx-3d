import {
  RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  Vector3,
} from 'three';
import type { SurfaceChunk, SurfaceChunkMesh } from '../../sdk';
import { createCapView, releaseCapView } from './cap-visibility';
import {
  chunkTileBoxes,
  compactTilePool,
  createTilePool,
  cullTilePool,
  fitsPoolTile,
  flushTilePool,
  orderTileChanges,
  pixelsPerUnit,
  selectTileLevels,
  setPoolTile,
  TilePool,
} from './chunk-lod';

/**
 * Indices rewritten per frame, over every cap: what spreads a big change of view
 * over several frames, the tiles that need detail most going first.
 */
const LOD_FRAME_BUDGET = 2_000_000;

/** A pool this much degenerate is packed again, once no tile is waiting. */
const LOD_COMPACT_WASTE = 0.25;

/** An index drawn at a level per tile, over a cap's attributes. */
type PoolView = {
  view: BufferGeometry;
  index: BufferAttribute;
  pool: TilePool;
};

/** One cap drawn at a level per tile, and its patch at the same levels. */
type LodCap = PoolView & { patch: PoolView | null };

/** What {@link useChunkLod} draws: per cap, its view and its patch's. */
export type ChunkLodViews = {
  caps: Map<SurfaceChunkMesh, BufferGeometry>;
  patches: Map<SurfaceChunkMesh, BufferGeometry>;
};

const NO_PATCH = new Uint32Array(0);

function createPoolView(
  surface: SurfaceChunkMesh,
  lists: ArrayLike<number>[],
  starts: Uint32Array[],
  levels: Uint8Array,
): PoolView {
  const pool = createTilePool(lists, starts, levels);
  const view = createCapView(surface.geometry, pool.index);
  return { view, index: view.getIndex()!, pool };
}

function poolViews(cap: LodCap): PoolView[] {
  return cap.patch ? [cap, cap.patch] : [cap];
}

function releaseLodCap(cap: LodCap) {
  for (const { view } of poolViews(cap)) releaseCapView(view);
}

/** Cull `cap` by `table` (`null` = draw it all); whether its pool changed. */
function cullLodCap(
  cap: LodCap,
  surface: SurfaceChunkMesh,
  table: Uint8Array | null,
): boolean {
  const { above, below } = surface;
  if (!above || !below || (!table && !cap.pool.cull)) return false;
  return cullTilePool(cap.pool, { above, below }, table) > 0;
}

function createLodCap(
  surface: SurfaceChunkMesh,
  levels: Uint8Array,
  table: Uint8Array | null,
): LodCap | null {
  const own = surface.geometry.getIndex();
  if (!own || !surface.levels || !surface.tileStarts) return null;
  const { patchLevels, patchTileStarts } = surface;
  const cap: LodCap = {
    ...createPoolView(
      surface,
      [own.array, ...surface.levels],
      surface.tileStarts,
      levels,
    ),
    // A ceiling draws no patch (see `ChunkMeshes`).
    patch:
      patchLevels && patchTileStarts && !surface.ceiling
        ? createPoolView(
            surface,
            [surface.patchIndex ?? NO_PATCH, ...patchLevels],
            patchTileStarts,
            levels,
          )
        : null,
  };
  // A new buffer is uploaded whole, so apply the hides at once too.
  cullLodCap(cap, surface, table);
  if (cap.pool.cull?.staleCount) compactTilePool(cap.pool);
  for (const { pool, view } of poolViews(cap)) {
    pool.written.length = 0;
    view.setDrawRange(0, pool.end);
  }
  return cap;
}

/** Hand what `cap`'s pools wrote to three, and draw up to their ends. */
function uploadLodCap(cap: LodCap) {
  for (const { pool, index, view } of poolViews(cap)) {
    view.setDrawRange(0, pool.end);
    if (pool.written.length === 0) continue;
    for (let i = 0; i < pool.written.length; i += 2) {
      index.addUpdateRange(pool.written[i], pool.written[i + 1]);
    }
    pool.written.length = 0;
    index.needsUpdate = true;
  }
}

/** Whether {@link useChunkLod} draws `chunk` by tiles: it has levels, and LOD is on. */
export function chunkLodActive(
  chunk: SurfaceChunk,
  pixelError: number,
  forced: number,
): boolean {
  return (
    !!chunk.metrics.lodErrors &&
    (forced > 0 || pixelError > 0) &&
    chunk.surfaces.some(s => s.levels && s.tileStarts)
  );
}

/**
 * Draw every cap of `chunk` at a level of detail per tile, chosen each frame so
 * a level's height error stays under `pixelError` pixels on screen (or `forced`
 * everywhere). A frame redraws tiles until {@link LOD_FRAME_BUDGET} indices are
 * written, those needing detail most first, so a big change of view converges
 * over a few frames instead of stalling one. Returns the geometry to draw per
 * cap, and per cap with a patch the patch's at the same levels, or `null` when the
 * chunk has no levels, LOD is off or the caps are not built yet.
 *
 * Buried triangles are culled by `tables` (per cap, as `useCulledCaps` takes
 * them): per triangle at full detail, and a coarser tile only where none of its
 * full-detail triangles shows — the coarser levels have no neighbours of their own.
 * What a change of table reveals is drawn before the next frame; what it only
 * hides is applied within the budget (see `cullTilePool`).
 *
 * ⚠️ The views share the caps' attributes; only their index is their own. A tile
 * drawn coarser shades from the cap's normal map, which `tileValues` (one texel
 * per tile, 0 = full level) tells the material; it reads all 0 while LOD is off.
 */
export function useChunkLod(
  chunk: SurfaceChunk,
  root: RefObject<Group | null>,
  pixelError: number,
  forced: number,
  tables: (Uint8Array | null)[] | null,
  tileValues?: DataTexture,
): ChunkLodViews | null {
  const errors = chunk.metrics.lodErrors;
  const tiling = chunk.metrics.tiling;
  const active = chunkLodActive(chunk, pixelError, forced);
  const tiles =
    chunk.surfaces.find(s => s.tileStarts)?.tileStarts![0].length ?? 1;

  // Per chunk, the level of each tile (shared by every cap).
  const state = useRef<{ levels: Uint8Array; applied: Uint8Array } | null>(
    null,
  );
  const cache = useRef(new Map<SurfaceChunkMesh, LodCap>());
  const [built, setBuilt] = useState<{
    surfaces: SurfaceChunkMesh[];
    lod: ChunkLodViews;
  } | null>(null);

  const boxes = useMemo(() => {
    if (!active) return null;
    const bounds = new Box3();
    for (const s of chunk.surfaces) {
      if (s.geometry.boundingBox) bounds.union(s.geometry.boundingBox);
    }
    return tiling
      ? chunkTileBoxes(tiling, bounds.min.y, bounds.max.y)
      : [bounds];
  }, [active, chunk.surfaces, tiling]);

  // A layout effect, so a cap that just came into view is culled open before the
  // next frame draws it.
  const tablesRef = useRef(tables);
  useLayoutEffect(() => {
    tablesRef.current = tables;
    chunk.surfaces.forEach((surface, i) => {
      const cap = cache.current.get(surface);
      if (cap && cullLodCap(cap, surface, tables?.[i] ?? null)) {
        uploadLodCap(cap);
      }
    });
  }, [chunk.surfaces, tables]);

  // An effect, not a memo: a remount (StrictMode, Fast Refresh) runs the cleanup
  // below, and only an effect runs again to rebuild what it released.
  useEffect(() => {
    const caps = cache.current;
    const live = new Set(active ? chunk.surfaces : []);
    for (const [surface, cap] of caps) {
      if (live.has(surface)) continue;
      releaseLodCap(cap);
      caps.delete(surface);
    }
    if (!active) {
      setBuilt(null);
      return;
    }
    if (!state.current || state.current.levels.length !== tiles - 1) {
      const start = Math.min(forced, errors!.length - 1);
      state.current = {
        levels: new Uint8Array(tiles - 1).fill(start),
        applied: new Uint8Array(tiles - 1).fill(start),
      };
    }
    const lod: ChunkLodViews = { caps: new Map(), patches: new Map() };
    chunk.surfaces.forEach((surface, i) => {
      let cap = caps.get(surface);
      if (!cap) {
        const made = createLodCap(
          surface,
          state.current!.applied,
          tablesRef.current?.[i] ?? null,
        );
        if (!made) return;
        caps.set(surface, made);
        cap = made;
      }
      lod.caps.set(surface, cap.view);
      if (cap.patch) lod.patches.set(surface, cap.patch.view);
    });
    setBuilt({ surfaces: chunk.surfaces, lod });
  }, [active, chunk.surfaces, tiles, forced, errors]);
  useEffect(() => {
    const caps = cache.current;
    return () => {
      caps.forEach(releaseLodCap);
      caps.clear();
    };
  }, []);
  const views =
    active && built?.surfaces === chunk.surfaces ? built.lod : null;

  const eye = useMemo(() => new Vector3(), []);
  const perTile = useMemo(
    () => ({
      scales: new Float32Array(Math.max(tiles - 1, 0)),
      excess: new Float32Array(Math.max(tiles - 1, 0)),
    }),
    [tiles],
  );
  const painted = useRef<DataTexture | null>(null);
  useEffect(() => {
    if (views || !tileValues) return;
    (tileValues.image.data as Uint8Array).fill(0);
    tileValues.needsUpdate = true;
    painted.current = null;
  }, [views, tileValues]);
  useFrame(({ camera, size }) => {
    const current = state.current;
    const group = root.current;
    if (!views || !boxes || !current || !group || !errors) return;
    const { levels, applied } = current;
    const { scales, excess } = perTile;
    if (forced > 0) {
      levels.fill(Math.min(forced, errors.length - 1));
    } else {
      camera.getWorldPosition(eye);
      group.worldToLocal(eye);
      selectTileLevels(
        boxes,
        eye,
        pixelsPerUnit(camera, size.height),
        errors,
        pixelError,
        levels,
        scales,
        group.matrixWorld,
      );
    }
    // The error each tile shows now, in pixels: what decides which goes first.
    for (let t = 0; t < applied.length; t++) {
      excess[t] = errors[applied[t]] * scales[t];
    }
    const caps = [...cache.current.values()];
    const pools: TilePool[] = [];
    for (const cap of caps) for (const { pool } of poolViews(cap)) pools.push(pool);
    let budget = LOD_FRAME_BUDGET;
    let redrawn = false;
    const order = orderTileChanges(levels, applied, excess);
    let done = 0;
    for (const t of order) {
      if (budget <= 0) break;
      const k = levels[t];
      // A pool with no room is packed first, within the budget; the tile waits.
      let waiting = false;
      for (const pool of pools) {
        if (fitsPoolTile(pool, t, k)) continue;
        if (budget <= 0) {
          waiting = true;
          break;
        }
        budget -= compactTilePool(pool);
      }
      if (waiting) break;
      // Every cap together, or a coarse cap could cross a finer one beside it.
      for (const pool of pools) budget -= setPoolTile(pool, t, k);
      applied[t] = k;
      redrawn = true;
      done++;
    }
    // What a culling change only hid, while the budget lasts.
    for (const { pool } of caps) {
      if (budget <= 0) break;
      budget -= flushTilePool(pool, budget);
    }
    // Nothing waiting: squeeze the degenerates out, while the budget lasts.
    if (done === order.length) {
      for (const pool of pools) {
        if (pool.live > budget) continue;
        if (pool.end - pool.live > LOD_COMPACT_WASTE * pool.end) {
          budget -= compactTilePool(pool);
        }
      }
    }
    for (const cap of caps) uploadLodCap(cap);
    if (!redrawn && painted.current === (tileValues ?? null)) return;
    painted.current = tileValues ?? null;
    if (tileValues) {
      const data = tileValues.image.data as Uint8Array;
      const top = Math.max(1, errors.length - 1);
      for (let t = 0; t < applied.length && t < data.length; t++) {
        data[t] = Math.round((255 * applied[t]) / top);
      }
      tileValues.needsUpdate = true;
    }
  });

  return views;
}
