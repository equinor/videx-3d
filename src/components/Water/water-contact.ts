import { createContext, useContext, useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import type { WaterContact, WaterMaterial } from './water-material';
import { toWaterPlane, type WaterPlane } from './water-sampler';

// A footprint's centre in the world, from the frame it is given in, at its level there.
function inWorld(contact: WaterContact, target: Vector3): Vector3 {
  const frame = contact.frame!;
  frame.updateWorldMatrix(true, false);
  return target.set(contact.x, 0, contact.z).applyMatrix4(frame.matrixWorld);
}

/**
 * A function returning a floating object's current contact footprint (in the
 * ocean's local frame), or `null` when it is temporarily not touching the water
 * (so it can be skipped). Read every frame by the enclosing `<Water>`, so it
 * should reflect the object's live position/heading.
 */
export type WaterContactSource = () => WaterContact | null;

/**
 * Registry provided by a `<Water>` so its floating children can contribute
 * contact-foam footprints. Floating components register a source and are
 * unregistered automatically on unmount.
 */
export interface WaterContactRegistry {
  /** Register a footprint source; returns a function that unregisters it. */
  register(source: WaterContactSource): () => void;
}

/** How an {@link WaterContactUploader} hands its footprints over. */
export type WaterContactUpload = {
  /**
   * The plane the waves are laid out in, when it is not the frame's own X/Z (a
   * `Scenery`'s): each footprint's centre and heading are taken into it, one given in a
   * frame of its own (`WaterContact.frame`) through the world.
   */
  plane?: WaterPlane;
  /**
   * Where the view is from, in the footprints' frame (the camera): with more footprints
   * than the material draws ({@link WaterMaterial.contactCount}), the nearest are kept.
   * Without it, the first registered.
   */
  from?: { x: number; z: number };
};

/** An {@link WaterContactRegistry} that also uploads the registered footprints. */
export interface WaterContactUploader extends WaterContactRegistry {
  /** Read every source and write the footprints into `material`; call once a frame. Free while none is registered. */
  upload(material: WaterMaterial, options?: WaterContactUpload): void;
}

/**
 * A registry for the floating children of whatever draws an {@link WaterMaterial}'s
 * water: provide it through {@link WaterContactContext}, and `upload` it each frame.
 */
export function createWaterContactRegistry(): WaterContactUploader {
  const sources = new Set<WaterContactSource>();
  const scratch: WaterContact[] = [];
  const distances: number[] = [];
  // The footprints taken into the plane: the sources' own are left as they are.
  const planed: WaterContact[] = [];
  const at = { x: 0, z: 0 };
  const world = new Vector3();
  const bow = new Vector3();
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
      const plane = options?.plane;
      scratch.length = 0;
      distances.length = 0;
      for (const source of sources) {
        const contact = source();
        if (!contact) continue;
        scratch.push(contact);
        if (!from) continue;
        // One placed in a frame of its own (on a globe), by where it lies in the world.
        if (plane && contact.frame) {
          inWorld(contact, world);
          distances.push(Math.hypot(world.x - from.x, world.z - from.z));
        } else
          distances.push(Math.hypot(contact.x - from.x, contact.z - from.z));
      }
      const count = Math.min(scratch.length, material.contactCount);
      if (from && scratch.length > count)
        nearestFirst(scratch, distances, count);
      if (plane) {
        for (let i = 0; i < count; i++) {
          const own = scratch[i];
          const into = (planed[i] ??= { ...own });
          Object.assign(into, own);
          if (own.frame) {
            // From its own frame through the world into the plane, as the shaders take a
            // point of the sea (its dot with east and north, height and all).
            inWorld(own, world);
            into.x = world.dot(plane.east);
            into.z = -world.dot(plane.north);
            bow
              .set(Math.cos(own.heading), 0, -Math.sin(own.heading))
              .transformDirection(own.frame.matrixWorld);
            into.heading = Math.atan2(
              bow.dot(plane.north),
              bow.dot(plane.east),
            );
          } else {
            toWaterPlane(plane, own.x, own.z, into);
            // The bow's way, (cos, -sin) of the heading in X/Z, taken into the plane too.
            toWaterPlane(
              plane,
              Math.cos(own.heading),
              -Math.sin(own.heading),
              at,
            );
            into.heading = Math.atan2(-at.z, at.x);
          }
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
  contacts: WaterContact[],
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
 * Context carrying the enclosing `<Water>`'s {@link WaterContactRegistry}, or
 * `null` when the component is not rendered inside a `<Water>`.
 */
export const WaterContactContext = createContext<WaterContactRegistry | null>(
  null,
);

/**
 * Register a floating object's contact footprint with the enclosing `<Water>`
 * so it spreads foam where it meets the water. Reusable by any floating
 * component: pass a function that returns the object's current footprint (centre,
 * heading and half-extents) each frame.
 *
 * No-op when there is no enclosing `<Water>` or when `enabled` is `false`. The
 * source function is read through a ref, so it can close over changing values
 * without re-registering every render.
 *
 * @example
 * useWaterContact(
 *   () => ({ x, z, heading, halfLength, halfWidth, foamWidth }),
 *   enabled,
 * );
 */
export function useWaterContact(
  getContact: WaterContactSource,
  enabled = true,
): void {
  const registry = useContext(WaterContactContext);
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
