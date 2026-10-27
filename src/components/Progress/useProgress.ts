import { useSyncExternalStore } from 'react';
import { ProgressSnapshot, ProgressStore } from './progress-store';

/**
 * Read a {@link ProgressStore}. Re-renders only the component that calls it — keep it
 * out of the component that renders the canvas, or every progress report re-renders the
 * whole scene.
 *
 * @see {@link describeProgress} to turn the snapshot into display text
 *
 * @group Components
 */
export function useProgress(store: ProgressStore): ProgressSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
