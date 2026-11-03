import { useMemo } from 'react';
import { Boundary, boundaryKey } from '../sdk/geometries/boundary';

/**
 * `boundary`, the same object while its shape is the same: one written inline is a new
 * object every render. Null for none.
 */
export function useStableBoundary(
  boundary: Boundary | null | undefined,
): Boundary | null {
  const key = boundaryKey(boundary);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by its shape above
  return useMemo(() => boundary ?? null, [key]);
}
