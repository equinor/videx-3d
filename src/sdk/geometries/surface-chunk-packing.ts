import { BufferAttribute, BufferGeometry } from 'three';
import {
  packBufferGeometry,
  PackedBufferGeometry,
  unpackBufferGeometry,
} from './packing';
import {
  SurfaceChunk,
  SurfaceChunkBoundary,
  SurfaceChunkMesh,
  SurfaceChunkMetrics,
} from './surface-chunk';
import { StackSectionSource } from './surface-section';

/**
 * A {@link SurfaceChunkMesh} packed for transfer across a worker boundary.
 *
 * ⭐ Derived from the mesh type rather than restated, and packed by SPREAD, so a
 * field added to a mesh survives the trip without anyone remembering to add it
 * here. Restating the fields compiles perfectly well and silently drops the rest —
 * extra properties on the source object are legal, so nothing warns.
 */
export type PackedSurfaceChunkMesh = Omit<SurfaceChunkMesh, 'geometry'> & {
  geometry: PackedBufferGeometry;
};

/**
 * A {@link SurfaceChunk} with every `BufferGeometry` replaced by a
 * {@link PackedBufferGeometry}, so the whole chunk can be returned from a worker
 * generator with its buffers transferred. Use {@link packSurfaceChunk} to build
 * one (in the worker) and {@link unpackSurfaceChunk} to restore it (on the main
 * thread).
 *
 * @group Geometries
 */
export type PackedSurfaceChunk = {
  surfaces: PackedSurfaceChunkMesh[];
  walls: PackedSurfaceChunkMesh[];
  section?: StackSectionSource;
  boundaries?: SurfaceChunkBoundary[];
  metrics: SurfaceChunkMetrics;
  /**
   * The meshes were streamed as packets (see `SurfaceChunkPacket`); this carries
   * the metrics only, and how many cap packets were sent — a cap that collapsed
   * entirely sends none, so the base packet's count is an upper bound.
   */
  streamed?: { caps: number };
};

/**
 * Pack a built {@link SurfaceChunk} for transfer from a worker: every geometry is
 * packed and its underlying buffers collected into the returned transfer list (so
 * they move zero-copy via `comlink`'s `transfer`). Colours and metrics are carried
 * as plain data.
 *
 * @group Geometries
 */
export function packSurfaceChunk(
  chunk: SurfaceChunk,
): [PackedSurfaceChunk, ArrayBufferLike[]] {
  const transferables: ArrayBufferLike[] = [];

  const packGeo = (geometry: BufferGeometry): PackedBufferGeometry => {
    const [packed, buffers] = packBufferGeometry(geometry);
    transferables.push(...buffers);
    return packed;
  };

  const packed: PackedSurfaceChunk = {
    surfaces: chunk.surfaces.map(s => ({
      ...s,
      geometry: packGeo(s.geometry),
    })),
    walls: chunk.walls.map(w => ({ ...w, geometry: packGeo(w.geometry) })),
    section: chunk.section,
    boundaries: chunk.boundaries,
    metrics: chunk.metrics,
  };

  // Carried by SPREAD above; only the transfer needs saying.
  for (const s of chunk.surfaces) {
    if (s.patchIndex) transferables.push(s.patchIndex.buffer);
    s.levels?.forEach(level => transferables.push(level.buffer));
    s.tileStarts?.forEach(starts => transferables.push(starts.buffer));
    s.patchLevels?.forEach(level => transferables.push(level.buffer));
    s.patchTileStarts?.forEach(starts => transferables.push(starts.buffer));
    if (s.normalMap) transferables.push(s.normalMap.data.buffer);
    if (s.above) transferables.push(s.above.buffer);
    if (s.below) transferables.push(s.below.buffer);
  }

  // The section shares buffers with the geometries above — the shared triangle
  // index, and any layer's `inferred` attribute — so the caller's transfer list has
  // to be deduped either way (a repeated buffer is a DataCloneError).
  if (chunk.section) {
    const { positionsXZ, indices, heights, intervals, gaps, inferred } =
      chunk.section;
    transferables.push(positionsXZ.buffer, indices.buffer);
    for (const y of heights) transferables.push(y.buffer);
    for (const members of intervals)
      if (members) transferables.push(members.buffer);
    for (const members of gaps ?? [])
      if (members) transferables.push(members.buffer);
    if (inferred)
      for (const marks of inferred) transferables.push(marks.buffer);
    const index = chunk.section.index;
    if (index) {
      transferables.push(
        index.starts.buffer,
        index.items.buffer,
        index.boxX.buffer,
        index.boxZ.buffer,
      );
    }
  }

  return [packed, transferables];
}

/**
 * Restore a {@link SurfaceChunk} from a {@link PackedSurfaceChunk} (the inverse of
 * {@link packSurfaceChunk}), rebuilding each `BufferGeometry` on the main thread.
 * The caller owns the returned geometries (dispose them when done).
 *
 * @group Geometries
 */
export function unpackSurfaceChunk(packed: PackedSurfaceChunk): SurfaceChunk {
  // ⭐ The caps share one `xz` and often one index: one attribute object each, or
  // three uploads them once per cap.
  const shared = new Map<ArrayBufferLike, BufferAttribute>();
  return {
    surfaces: packed.surfaces.map(s => ({
      ...s,
      geometry: unpackBufferGeometry(s.geometry, shared),
    })),
    walls: packed.walls.map(w => ({
      ...w,
      geometry: unpackBufferGeometry(w.geometry, shared),
    })),
    section: packed.section,
    boundaries: packed.boundaries,
    metrics: packed.metrics,
  };
}
