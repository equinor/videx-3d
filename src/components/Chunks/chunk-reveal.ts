import { BufferGeometry } from 'three';
import { SurfaceChunk } from '../../sdk';

/**
 * Bytes of GPU upload to allow per frame when a chunk is revealed. three uploads
 * a geometry the first time it is drawn, so drawing a whole field-scale chunk at
 * once (~200 MB) stalls one frame for a few hundred milliseconds.
 */
export const CHUNK_REVEAL_BYTES_PER_FRAME = 16 * 2 ** 20;

/**
 * The bytes drawing `geometry` would upload, counting a buffer already in `seen`
 * as free: a stack's caps share their `xz` attribute and often their index.
 */
export function geometryUploadBytes(
  geometry: BufferGeometry,
  seen: Set<ArrayBufferLike>,
): number {
  let bytes = 0;
  const add = (array: ArrayLike<number> & { buffer: ArrayBufferLike }) => {
    if (seen.has(array.buffer)) return;
    seen.add(array.buffer);
    bytes += (array as unknown as ArrayBufferView).byteLength;
  };
  for (const name in geometry.attributes) {
    add(geometry.attributes[name].array as Float32Array);
  }
  const index = geometry.getIndex();
  if (index) add(index.array as Uint32Array);
  return bytes;
}

/** One thing to reveal: what identifies it, and the bytes drawing it uploads. */
export type RevealItem<K = unknown> = { key: K; cost: number };

/**
 * One reveal item per layer of `chunk` in `ready`, in that order: its caps and its
 * walls go together. A buffer several layers share is charged to the first.
 */
export function chunkLayerReveal(
  chunk: SurfaceChunk,
  ready: readonly number[],
): RevealItem<number>[] {
  const seen = new Set<ArrayBufferLike>();
  return ready.map(layer => {
    let cost = 0;
    for (const mesh of chunk.surfaces) {
      if (mesh.layer === layer)
        cost += geometryUploadBytes(mesh.geometry, seen);
    }
    for (const mesh of chunk.walls) {
      if (mesh.layer === layer)
        cost += geometryUploadBytes(mesh.geometry, seen);
    }
    return { key: layer, cost };
  });
}

/** Every layer `chunk` draws a mesh for, ascending. */
export function chunkLayers(chunk: SurfaceChunk): number[] {
  const layers = new Set<number>();
  for (const mesh of chunk.surfaces) layers.add(mesh.layer);
  for (const mesh of chunk.walls) layers.add(mesh.layer);
  return [...layers].sort((a, b) => a - b);
}
