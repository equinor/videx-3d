import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A value the host may control or leave to the component: `request` asks for a change, which
 * the component takes itself unless the host gives `value`, and tells `onChange` either way.
 *
 * @returns the value shown, the way to ask for a change, and the value as it is now, ahead of
 *   the next render (a toggle clicked twice in a frame toggles twice)
 * @group Hooks
 */
export function useControllable<T>(
  value: T | undefined,
  initial: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void, { readonly current: T }] {
  const [inner, setInner] = useState(initial);
  const controlled = value !== undefined;
  const shown = controlled ? value : inner;
  const latest = useRef({ controlled, onChange });
  const current = useRef(shown);
  useEffect(() => {
    latest.current = { controlled, onChange };
    current.current = shown;
  });
  const request = useCallback((next: T) => {
    current.current = next;
    if (!latest.current.controlled) setInner(next);
    latest.current.onChange?.(next);
  }, []);
  return [shown, request, current];
}
