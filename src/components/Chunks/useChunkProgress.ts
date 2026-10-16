import { useSyncExternalStore } from 'react';
import { ChunkProgressSnapshot, ChunkProgressStore } from './chunk-progress';

/**
 * Read a {@link ChunkProgressStore}. Re-renders only the component that calls
 * it — keep it out of the component that renders the canvas, or every progress
 * report re-renders the whole scene.
 *
 * @see {@link describeChunkProgress} to turn the snapshot into display text
 *
 * @group Components
 */
export function useChunkProgress(
  store: ChunkProgressStore,
): ChunkProgressSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
