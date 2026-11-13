import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type { Material } from 'three';
import {
  applyWaterFog,
  sceneWaterBody,
  type WaterBody,
} from '../../sdk/materials/water-body';

/**
 * The water of the scene this is drawn in (`sceneWaterBody`): what the sea there writes, an
 * `Ocean`'s, a `ChunkStack`'s or a `Scenery`'s, wherever it lies in the tree. The library's
 * materials bind it, so what lies in the water fades by it; a host's own can, through
 * `applyWaterFog` or {@link useWaterFog}.
 */
export function useSceneWater(): WaterBody {
  const scene = useThree(state => state.scene);
  return sceneWaterBody(scene);
}

/**
 * Fade what `materials` draw by the scene's water ({@link useSceneWater}, `applyWaterFog`):
 * what lies in the water column fades by its path through it, as under any sea. Applied
 * before the first frame draws them.
 */
export function useWaterFog(...materials: (Material | null | undefined)[]) {
  const water = useSceneWater();
  useLayoutEffect(() => {
    for (const material of materials)
      if (material) applyWaterFog(material, water);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [water, ...materials]);
}
