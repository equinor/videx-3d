import { createContext, useContext, useEffect, useRef } from 'react';
import type { OceanContact, OceanMaterial } from './ocean-material';

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

/** An {@link OceanContactRegistry} that also uploads the registered footprints. */
export interface OceanContactUploader extends OceanContactRegistry {
  /** Read every source and write the footprints into `material`; call once a frame. Free while none is registered. */
  upload(material: OceanMaterial): void;
}

/**
 * A registry for the floating children of whatever draws an {@link OceanMaterial}'s
 * water: provide it through {@link OceanContactContext}, and `upload` it each frame.
 */
export function createOceanContactRegistry(): OceanContactUploader {
  const sources = new Set<OceanContactSource>();
  const scratch: OceanContact[] = [];
  return {
    register(source) {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    upload(material) {
      if (sources.size > 0) {
        scratch.length = 0;
        for (const source of sources) {
          const contact = source();
          if (contact) scratch.push(contact);
        }
        material.setContacts(scratch);
      } else if ((material.uniforms.uContactCount.value as number) > 0) {
        material.clearContacts();
      }
    },
  };
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
