import { useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CHUNK_REVEAL_BYTES_PER_FRAME, RevealItem } from './chunk-reveal';

const NOTHING: ReadonlySet<never> = new Set();

/**
 * Which of `items` (in reveal order) to show: a few more each frame, within
 * `budget` bytes, and always at least one. Tracked by `key`, so items appended
 * later (a streamed chunk) keep what is already shown. A new `epoch` starts over.
 */
export function useStaggeredReveal<K>(
  items: readonly RevealItem<K>[],
  epoch?: unknown,
  budget = CHUNK_REVEAL_BYTES_PER_FRAME,
): ReadonlySet<K> {
  const [state, setState] = useState<{ epoch: unknown; shown: ReadonlySet<K> }>(
    () => ({ epoch, shown: NOTHING }),
  );
  const shown = state.epoch === epoch ? state.shown : NOTHING;
  useFrame(() => {
    if (items.every(item => shown.has(item.key))) return;
    // From the LATEST state: a frame can run before the last advance re-rendered.
    setState(current => {
      const prior = current.epoch === epoch ? current.shown : NOTHING;
      const next = new Set<K>();
      let spent = 0;
      let added = 0;
      let full = false;
      for (const item of items) {
        if (prior.has(item.key)) {
          next.add(item.key);
          continue;
        }
        if (full) continue;
        if (added > 0 && spent + item.cost > budget) {
          full = true;
          continue;
        }
        next.add(item.key);
        spent += item.cost;
        added++;
      }
      return { epoch, shown: next };
    });
  });
  return shown;
}
