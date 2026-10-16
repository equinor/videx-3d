import { useLayoutEffect, useRef, useState } from 'react';
import { RenderCallback, useFrame } from '@react-three/fiber';

type Holder = { current: RenderCallback | null };

// Module scope, so the relay closes over the holder and nothing of the component.
function relay(holder: Holder): RenderCallback {
  return (state, delta, frame) => holder.current?.(state, delta, frame);
}

/**
 * `useFrame`, letting go of the callback when the component unmounts.
 *
 * ⚠️ R3F's store keeps its INITIAL state, whose `internal.subscribers` array is
 * the live one until the first unsubscribe replaces it — and is never touched
 * again. A callback registered before then stays referenced for the life of the
 * canvas, and with it every variable of the scope it was created in (a whole
 * chunk, for `ChunkMeshes`). Here R3F only ever holds the relay.
 */
export function useReleasedFrame(callback: RenderCallback, priority = 0) {
  const holder = useRef<RenderCallback | null>(null);
  const [frame] = useState(() => relay(holder));
  useLayoutEffect(() => {
    holder.current = callback;
  });
  useLayoutEffect(
    () => () => {
      holder.current = null;
    },
    [],
  );
  useFrame(frame, priority);
}
