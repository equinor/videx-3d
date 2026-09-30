import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { IUniform, Vector4 } from 'three';
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
import { ChunkDepthMap } from './chunk-depth-map';
import { StackWater } from './chunk-defs';
import { ChunkFenceUniforms } from './chunk-material';

/** What a {@link ChunkStackProps.water} sea is drawn and sampled with. */
export type StackWaterMaterials = {
  /** the animated sea surface, for the lid */
  surface: OceanMaterial;
  /** the water body, for the walls at the rim and the shoreline */
  volume: OceanVolumeMaterial;
  /**
   * The water body again, UNCUT, for the face that closes it at a section or a
   * fence. `null` when the stack declares no cut.
   *
   * ⚠️ A separate material because the face lies exactly ON the cut: testing it
   * against the very thing it exists to close punches holes along its length. The
   * block's own faces are built the same way.
   */
  face: OceanVolumeMaterial | null;
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
  sectionPlane?: IUniform<Vector4>,
  bathymetry?: ChunkDepthMap | null,
  fence?: ChunkFenceUniforms,
  cut = false,
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

  // ⚠️ The section is a DEFINE, so cutting the sea or leaving it whole means new
  // materials. That is a discrete choice, unlike the sea state, which is swept.
  // ⚠️ The fence is one too; its uniforms carry the live curve, so only turning the
  // cut on or off reaches here.
  // ⚠️ So is the bathymetry, which arrives asynchronously — one rebuild, once.
  const materials = useMemo(() => {
    if (!enabled) return null;
    return {
      surface: new OceanMaterial({
        sectionPlane,
        fence,
        bathymetry: bathymetry ?? undefined,
      }),
      // A chunk's interval wall measures its vertical coordinate in metres, so
      // the walls read their unit-relative height from `wallV` instead.
      volume: new OceanVolumeMaterial({
        wallAttribute: true,
        sectionPlane,
        fence,
      }),
      face: cut ? new OceanVolumeMaterial({ wallAttribute: true }) : null,
    };
  }, [enabled, sectionPlane, fence, bathymetry, cut]);

  useEffect(() => {
    if (!materials) return;
    return () => {
      materials.surface.dispose();
      materials.volume.dispose();
      materials.face?.dispose();
    };
  }, [materials]);

  useEffect(() => {
    if (!materials || !water) return;
    const opacity = water.opacity ?? 1;
    applyOceanWaterProps(materials.surface, { ...water, opacity });
    // The bed grid is in the stack's frame, so the level it is measured against
    // has to be too.
    materials.surface.waterLevel = level;
    // The body shares the surface's wave tables by reference, so its top edge
    // follows the same swells.
    applyOceanBodyProps(
      materials.volume,
      { ...water, opacity },
      materials.surface,
    );
    if (materials.face)
      applyOceanBodyProps(
        materials.face,
        { ...water, opacity },
        materials.surface,
      );
    materials.surface.wireframe = wireframe;
    materials.volume.wireframe = wireframe;
    if (materials.face) materials.face.wireframe = wireframe;
  }, [materials, water, wireframe, level]);

  useFrame((_, delta) => {
    if (!materials) return;
    materials.surface.time += delta;
    materials.volume.time += delta;
    if (materials.face) materials.face.time += delta;

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
