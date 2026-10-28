import { createContext, useContext, useEffect, useRef } from 'react';
import type { OceanContact, OceanMaterial } from './ocean-material';
import { toOceanPlane, type OceanPlane } from './ocean-sampler';

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

/** How an {@link OceanContactUploader} hands its footprints over. */
export type OceanContactUpload = {
  /**
   * The plane the waves are laid out in, when it is not the frame's own X/Z (a
   * `Scenery`'s): each footprint's centre and heading are taken into it.
   */
  plane?: OceanPlane;
  /**
   * Where the view is from, in the footprints' frame (the camera): with more footprints
   * than the material draws ({@link OceanMaterial.contactCount}), the nearest are kept.
   * Without it, the first registered.
   */
  from?: { x: number; z: number };
};

/** An {@link OceanContactRegistry} that also uploads the registered footprints. */
export interface OceanContactUploader extends OceanContactRegistry {
  /** Read every source and write the footprints into `material`; call once a frame. Free while none is registered. */
  upload(material: OceanMaterial, options?: OceanContactUpload): void;
}

/**
 * A registry for the floating children of whatever draws an {@link OceanMaterial}'s
 * water: provide it through {@link OceanContactContext}, and `upload` it each frame.
 */
export function createOceanContactRegistry(): OceanContactUploader {
  const sources = new Set<OceanContactSource>();
  const scratch: OceanContact[] = [];
  const distances: number[] = [];
  // The footprints taken into the plane: the sources' own are left as they are.
  const planed: OceanContact[] = [];
  const at = { x: 0, z: 0 };
  return {
    register(source) {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    upload(material, options) {
      if (sources.size === 0) {
        if ((material.uniforms.uContactCount.value as number) > 0)
          material.clearContacts();
        return;
      }
      const from = options?.from;
      scratch.length = 0;
      distances.length = 0;
      for (const source of sources) {
        const contact = source();
        if (!contact) continue;
        scratch.push(contact);
        if (from)
          distances.push(Math.hypot(contact.x - from.x, contact.z - from.z));
      }
      const count = Math.min(scratch.length, material.contactCount);
      if (from && scratch.length > count) nearestFirst(scratch, distances, count);
      const plane = options?.plane;
      if (plane) {
        for (let i = 0; i < count; i++) {
          const own = scratch[i];
          const into = (planed[i] ??= { ...own });
          Object.assign(into, own);
          toOceanPlane(plane, own.x, own.z, into);
          // The bow's way, (cos, -sin) of the heading in X/Z, taken into the plane too.
          toOceanPlane(plane, Math.cos(own.heading), -Math.sin(own.heading), at);
          into.heading = Math.atan2(-at.z, at.x);
          scratch[i] = into;
        }
      }
      scratch.length = count;
      material.setContacts(scratch);
    },
  };
}

// The `count` nearest of `contacts` to the front, by `distances` (partial selection: a
// few dozen at most, so it allocates nothing and sorts nothing it need not).
function nearestFirst(
  contacts: OceanContact[],
  distances: number[],
  count: number,
) {
  for (let i = 0; i < count; i++) {
    let best = i;
    for (let j = i + 1; j < contacts.length; j++) {
      if (distances[j] < distances[best]) best = j;
    }
    if (best === i) continue;
    const contact = contacts[i];
    contacts[i] = contacts[best];
    contacts[best] = contact;
    const distance = distances[i];
    distances[i] = distances[best];
    distances[best] = distance;
  }
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
