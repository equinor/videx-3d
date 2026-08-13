import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  applyOceanBodyProps,
  applyOceanWaterProps,
} from '../Ocean/ocean-material-sync';
import { OceanMaterial } from '../Ocean/ocean-material';
import { OceanVolumeMaterial } from '../Ocean/ocean-volume-material';
import { ChunkLayer } from './chunk-defs';

/** The pair of materials a {@link ChunkLayer.water} layer is drawn with. */
export type ChunkWaterMaterials = {
  /** the animated sea surface, for the layer's cap */
  surface: OceanMaterial;
  /** the water body, for the volume below the layer */
  volume: OceanVolumeMaterial;
};

/**
 * Create, drive and dispose the ocean materials for every {@link ChunkLayer.water}
 * layer, keyed by layer index.
 *
 * ⚠️ The materials are created once per water layer and then have their UNIFORMS
 * updated — unlike the rest of a chunk's appearance, which is rebuilt on every
 * change so the OIT pass re-classifies it. A sea state is swept continuously, and
 * rebuilding a `ShaderMaterial` recompiles its program.
 *
 * @param layers the chunk's layers, in order
 * @param surfaceOpacity the chunk's cap opacity, unless the layer overrides it
 * @param wallOpacity the chunk's volume opacity, unless the layer overrides it
 *
 * @group Components
 */
export function useChunkWater(
  layers: ChunkLayer[],
  surfaceOpacity: number,
  wallOpacity: number,
  wireframe = false,
): Map<number, ChunkWaterMaterials> {
  const waterKey = layers.map(l => (l.water ? 1 : 0)).join('');

  const materials = useMemo(() => {
    const map = new Map<number, ChunkWaterMaterials>();
    layers.forEach((layer, i) => {
      if (!layer.water) return;
      map.set(i, {
        surface: new OceanMaterial(),
        // A chunk's interval wall measures its vertical coordinate in metres, so
        // the walls read their unit-relative height from `wallV` instead.
        volume: new OceanVolumeMaterial({ wallAttribute: true }),
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by which layers are water; the props are synced below
  }, [waterKey]);

  useEffect(() => {
    return () =>
      materials.forEach(({ surface, volume }) => {
        surface.dispose();
        volume.dispose();
      });
  }, [materials]);

  useEffect(() => {
    materials.forEach(({ surface, volume }, i) => {
      const layer = layers[i];
      if (!layer?.water) return;
      applyOceanWaterProps(surface, {
        ...layer.water,
        opacity: layer.opacity ?? surfaceOpacity,
      });
      // The body shares the surface's wave tables by reference, so its top edge
      // follows the same swells.
      applyOceanBodyProps(
        volume,
        { ...layer.water, opacity: layer.opacity ?? wallOpacity },
        surface,
      );
      surface.wireframe = wireframe;
      volume.wireframe = wireframe;
    });
  }, [materials, layers, surfaceOpacity, wallOpacity, wireframe]);

  useFrame((_, delta) => {
    materials.forEach(({ surface, volume }) => {
      surface.time += delta;
      volume.time += delta;
    });
  });

  return materials;
}
