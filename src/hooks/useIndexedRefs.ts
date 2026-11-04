import { useCallback, useRef } from 'react';

/**
 * Elements rendered from a list, addressed by their index: `nodes.current[i]`.
 *
 * `refAt(i)` hands out one ref callback per index and keeps it across renders, where an
 * inline `ref={node => ...}` is a new callback each render that React detaches and
 * re-attaches.
 */
export function useIndexedRefs<T>() {
  const nodes = useRef<(T | null)[]>([]);
  const setters = useRef<((node: T | null) => void)[]>([]);
  const refAt = useCallback(
    (i: number) =>
      (setters.current[i] ??= (node: T | null) => {
        nodes.current[i] = node;
      }),
    [],
  );
  return [nodes, refAt] as const;
}
