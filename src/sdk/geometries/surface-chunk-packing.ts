import { BufferGeometry } from 'three';
import {
  packBufferGeometry,
  PackedBufferGeometry,
  unpackBufferGeometry,
} from './packing';
import {
  SurfaceChunk,
  SurfaceChunkGroup,
  SurfaceChunkMetrics,
} from './surface-chunk';

/**
 * A {@link SurfaceChunkGroup} whose meshes have been packed for transfer across a
 * worker boundary (each `BufferGeometry` -> {@link PackedBufferGeometry}).
 *
 * @group Geometries
 */
export type PackedSurfaceChunkGroup = {
  surfaces: { geometry: PackedBufferGeometry; color: string }[];
  walls: { geometry: PackedBufferGeometry; color: string }[];
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
  surfaces: { geometry: PackedBufferGeometry; layer: number }[];
  walls: { geometry: PackedBufferGeometry; layer: number }[];
  basement?: PackedSurfaceChunkGroup;
  oceanTop?: {
    surface: PackedBufferGeometry;
    body: PackedBufferGeometry;
    bed?: PackedBufferGeometry;
  };
  metrics: SurfaceChunkMetrics;
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

  const packGroup = (group: SurfaceChunkGroup): PackedSurfaceChunkGroup => ({
    surfaces: group.surfaces.map(s => ({
      geometry: packGeo(s.geometry),
      color: s.color,
    })),
    walls: group.walls.map(w => ({
      geometry: packGeo(w.geometry),
      color: w.color,
    })),
  });

  const packed: PackedSurfaceChunk = {
    surfaces: chunk.surfaces.map(s => ({
      geometry: packGeo(s.geometry),
      layer: s.layer,
    })),
    walls: chunk.walls.map(w => ({
      geometry: packGeo(w.geometry),
      layer: w.layer,
    })),
    basement: chunk.basement ? packGroup(chunk.basement) : undefined,
    oceanTop: chunk.oceanTop
      ? {
          surface: packGeo(chunk.oceanTop.surface),
          body: packGeo(chunk.oceanTop.body),
          bed: chunk.oceanTop.bed ? packGeo(chunk.oceanTop.bed) : undefined,
        }
      : undefined,
    metrics: chunk.metrics,
  };

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
  const unpackGroup = (group: PackedSurfaceChunkGroup): SurfaceChunkGroup => ({
    surfaces: group.surfaces.map(s => ({
      geometry: unpackBufferGeometry(s.geometry),
      color: s.color,
    })),
    walls: group.walls.map(w => ({
      geometry: unpackBufferGeometry(w.geometry),
      color: w.color,
    })),
  });

  return {
    surfaces: packed.surfaces.map(s => ({
      geometry: unpackBufferGeometry(s.geometry),
      layer: s.layer,
    })),
    walls: packed.walls.map(w => ({
      geometry: unpackBufferGeometry(w.geometry),
      layer: w.layer,
    })),
    basement: packed.basement ? unpackGroup(packed.basement) : undefined,
    oceanTop: packed.oceanTop
      ? {
          surface: unpackBufferGeometry(packed.oceanTop.surface),
          body: unpackBufferGeometry(packed.oceanTop.body),
          bed: packed.oceanTop.bed
            ? unpackBufferGeometry(packed.oceanTop.bed)
            : undefined,
        }
      : undefined,
    metrics: packed.metrics,
  };
}
