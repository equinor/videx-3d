import { createContext, useContext, useEffect, useRef } from 'react';
import { OceanContact } from './ocean-material';

/**
 * A function returning a floating object's current contact footprint (in the
 * ocean's local frame), or `null` when it is temporarily not touching the water
 * (so it can be skipped). Read every frame by the enclosing `<Ocean>`, so it
 * should reflect the object's live position/heading.
 */
export type OceanContactSource = () => OceanContact | null;

/**
 * Registry provided by an `<Ocean>` so its floating children can contribute
 * contact-foam footprints. Floating components register a source and are
 * unregistered automatically on unmount.
 */
export interface OceanContactRegistry {
  /** Register a footprint source; returns a function that unregisters it. */
  register(source: OceanContactSource): () => void;
}

/**
 * Context carrying the enclosing `<Ocean>`'s {@link OceanContactRegistry}, or
 * `null` when the component is not rendered inside an `<Ocean>`.
 */
export const OceanContactContext = createContext<OceanContactRegistry | null>(
  null,
);

/**
 * Register a floating object's contact footprint with the enclosing `<Ocean>`
 * so it spreads foam where it meets the water. Reusable by any floating
 * component: pass a function that returns the object's current footprint (centre,
 * heading and half-extents) each frame.
 *
 * No-op when there is no enclosing `<Ocean>` or when `enabled` is `false`. The
 * source function is read through a ref, so it can close over changing values
 * without re-registering every render.
 *
 * @example
 * useOceanContact(
 *   () => ({ x, z, heading, halfLength, halfWidth, foamWidth }),
 *   enabled,
 * );
 */
export function useOceanContact(
  getContact: OceanContactSource,
  enabled = true,
): void {
  const registry = useContext(OceanContactContext);
  const sourceRef = useRef(getContact);

  // Keep the ref pointing at the latest source without re-registering.
  useEffect(() => {
    sourceRef.current = getContact;
  });

  useEffect(() => {
    if (!registry || !enabled) return;
    return registry.register(() => sourceRef.current());
  }, [registry, enabled]);
}
