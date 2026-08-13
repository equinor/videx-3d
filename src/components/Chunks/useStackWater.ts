import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  applyOceanBodyProps,
  applyOceanWaterProps,
} from '../Ocean/ocean-material-sync';
import { OceanMaterial } from '../Ocean/ocean-material';
import { OceanVolumeMaterial } from '../Ocean/ocean-volume-material';
import { StackWater } from './chunk-defs';

/** The pair of materials a {@link ChunkStackProps.water} sea is drawn with. */
export type StackWaterMaterials = {
  /** the animated sea surface, for the lid */
  surface: OceanMaterial;
  /** the water body, for the walls at the rim and the shoreline */
  volume: OceanVolumeMaterial;
};

/**
 * Create, drive and dispose the ocean materials for a `ChunkStack`'s sea.
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
  });

  return materials;
}
