import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  OceanContactRegistry,
  OceanContactSource,
} from '../Ocean/ocean-contact';
import {
  applyOceanBodyProps,
  applyOceanWaterProps,
} from '../Ocean/ocean-material-sync';
import { OceanContact, OceanMaterial } from '../Ocean/ocean-material';
import { createOceanSampler, OceanSampler } from '../Ocean/ocean-sampler';
import { OceanVolumeMaterial } from '../Ocean/ocean-volume-material';
import { StackWater } from './chunk-defs';

/** What a {@link ChunkStackProps.water} sea is drawn and sampled with. */
export type StackWaterMaterials = {
  /** the animated sea surface, for the lid */
  surface: OceanMaterial;
  /** the water body, for the walls at the rim and the shoreline */
  volume: OceanVolumeMaterial;
  /**
   * The wave field, for floating objects. Heights come back ABSOLUTE in the
   * stack's frame (sea level included), so a floater needs no sea-level parent
   * group of its own.
   */
  sampler: OceanSampler;
  /** where floating children register their contact-foam footprints */
  contacts: OceanContactRegistry;
};

/**
 * Create, drive and dispose the ocean materials for a `ChunkStack`'s sea, and
 * with them the two things its floating children need: the wave sampler and the
 * contact-foam registry.
 *
 * ⚠️ The materials are created ONCE and then have their UNIFORMS updated — unlike
 * the rest of a chunk's appearance, which is rebuilt on every change so the OIT
 * pass re-classifies it. A sea state is swept continuously, and rebuilding a
 * `ShaderMaterial` recompiles its program.
 *
 * @group Components
 */
export function useStackWater(
  water: StackWater | undefined,
  wireframe = false,
): StackWaterMaterials | null {
  const enabled = !!water;
  const level = -(water?.depth ?? 0);

  const contactSources = useRef<Set<OceanContactSource>>(new Set());
  const contactScratch = useRef<OceanContact[]>([]);
  const contacts = useMemo<OceanContactRegistry>(
    () => ({
      register(source) {
        contactSources.current.add(source);
        return () => {
          contactSources.current.delete(source);
        };
      },
    }),
    [],
  );

  const materials = useMemo(() => {
    if (!enabled) return null;
    return {
      surface: new OceanMaterial(),
      // A chunk's interval wall measures its vertical coordinate in metres, so
      // the walls read their unit-relative height from `wallV` instead.
      volume: new OceanVolumeMaterial({ wallAttribute: true }),
    };
  }, [enabled]);

  useEffect(() => {
    if (!materials) return;
    return () => {
      materials.surface.dispose();
      materials.volume.dispose();
    };
  }, [materials]);

  useEffect(() => {
    if (!materials || !water) return;
    const opacity = water.opacity ?? 1;
    applyOceanWaterProps(materials.surface, { ...water, opacity });
    // The body shares the surface's wave tables by reference, so its top edge
    // follows the same swells.
    applyOceanBodyProps(
      materials.volume,
      { ...water, opacity },
      materials.surface,
    );
    materials.surface.wireframe = wireframe;
    materials.volume.wireframe = wireframe;
  }, [materials, water, wireframe]);

  useFrame((_, delta) => {
    if (!materials) return;
    materials.surface.time += delta;
    materials.volume.time += delta;

    // Collect the registered floating-object footprints and upload them as
    // contact foam. Skipped entirely when nothing is registered, so a sea with no
    // floating children costs nothing per frame.
    const sources = contactSources.current;
    if (sources.size > 0) {
      const scratch = contactScratch.current;
      scratch.length = 0;
      for (const source of sources) {
        const contact = source();
        if (contact) scratch.push(contact);
      }
      materials.surface.setContacts(scratch);
    } else if ((materials.surface.uniforms.uContactCount.value as number) > 0) {
      materials.surface.clearContacts();
    }
  });

  return useMemo(
    () =>
      materials
        ? {
            ...materials,
            sampler: createOceanSampler(materials.surface, level),
            contacts,
          }
        : null,
    [materials, level, contacts],
  );
}
