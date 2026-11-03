import { createContext, useContext, useEffect, useLayoutEffect } from 'react';
import type { Camera } from 'three';
import type { SceneryMaterial } from './scenery-material';
import type {
  SceneryAbyssProps,
  SceneryCloudsProps,
  SceneryOceanProps,
  SceneryZone,
} from './scenery-model';

/**
 * A cutaway's work each frame, run by its scenery where the cut's place is known: after the
 * camera's height and zone, before the walls take the cut. Returns whether it cuts the
 * seabed now, which opens the void to the view from above.
 */
export type SceneryCutawayFrame = (
  camera: Camera,
  delta: number,
  height: number,
  zone: SceneryZone,
) => boolean;

/** What a `SceneryCutaway` hands its scenery. */
export type SceneryCutawayFeature = {
  /** how much of the water it cuts: the scene is lit as from above the water while any */
  water: number;
  frame: SceneryCutawayFrame;
};

/** What a scenery's feature components hand it, each null while there is none. */
export type SceneryFeatures = {
  clouds: SceneryCloudsProps | null;
  ocean: SceneryOceanProps | null;
  abyss: SceneryAbyssProps | null;
  cutaway: SceneryCutawayFeature | null;
};

export type SceneryRegistry = {
  /** the scenery's material: every feature's uniforms are its */
  material: SceneryMaterial;
  set: <K extends keyof SceneryFeatures>(
    feature: K,
    value: SceneryFeatures[K],
  ) => void;
};

export const SceneryRegistryContext = createContext<SceneryRegistry | null>(
  null,
);

const COMPONENTS: Record<keyof SceneryFeatures, string> = {
  clouds: 'SceneryClouds',
  ocean: 'SceneryOcean',
  abyss: 'SceneryAbyss',
  cutaway: 'SceneryCutaway',
};

/**
 * Hand `value` to the enclosing `Scenery` as its `feature` for as long as this is mounted.
 * Laid in before paint, so the scenery draws it from the first frame. Null outside one.
 */
export function useSceneryFeature<K extends keyof SceneryFeatures>(
  feature: K,
  value: SceneryFeatures[K],
) {
  const registry = useContext(SceneryRegistryContext);
  useEffect(() => {
    if (!registry && import.meta.env.DEV)
      console.warn(`${COMPONENTS[feature]} draws nothing outside a Scenery`);
  }, [registry, feature]);
  useLayoutEffect(() => {
    registry?.set(feature, value);
  }, [registry, feature, value]);
  useLayoutEffect(() => {
    if (!registry) return;
    return () => registry.set(feature, null);
  }, [registry, feature]);
  return registry;
}
