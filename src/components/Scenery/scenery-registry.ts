import { createContext, useContext, useEffect, useLayoutEffect } from 'react';
import type {
  Camera,
  CubeTexture,
  Matrix3,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { SceneryMaterial } from './scenery-material';
import type {
  SceneryAbyssProps,
  SceneryOceanProps,
  SceneryZone,
} from './scenery-model';
import type { SceneryGround } from './scenery-ground';

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
  ocean: SceneryOceanProps | null;
  abyss: SceneryAbyssProps | null;
  cutaway: SceneryCutawayFeature | null;
};

/**
 * What a scenery's layers can show this frame, as its last frame decided: for what draws
 * itself rather than as one of its background's layers.
 */
export type SceneryView = {
  /** the clouds: the sky is drawn and ready, the camera's zone shows it, and they are not hidden (`SceneryDebug.hide`) */
  clouds: boolean;
  /** shadows of what draws itself in the sky are read: the scene's light is the sky's (not below the seabed) */
  shadows: boolean;
  /** the scenery's `renderOrder`: its sea's surface draws at the next one */
  renderOrder: number;
};

/**
 * The shadows of what draws itself in a scenery's sky (`ScenerySkyOverlay.shadow`): over a
 * square about the camera's foot, the share of the light that reaches the ground (r, 0 to 1),
 * texel by texel along `east` and `north` from `-reach` to `reach` about `centre` (world).
 */
export type ScenerySkyShadow = {
  texture: Texture;
  centre: Vector3;
  east: Vector3;
  north: Vector3;
  reach: number;
};

/**
 * What draws itself in a scenery's sky rather than as one of its background's layers (the 3D
 * clouds, `SceneryClouds`) hands its scenery, for the light: what it looks like from the
 * scene, for the bakes of the air over the sea and for the sea to reflect, how much of the
 * scene's light it lets through, and its shadows.
 */
export type ScenerySkyOverlay = {
  /**
   * as seen from the scene all round, by direction (world): premultiplied colour and alpha,
   * without the sky's intensity, with its mipmaps. Drawn by {@link bake}
   */
  texture: CubeTexture;
  /** draw {@link texture} as seen from `position` (world): before each bake of the air */
  bake: (renderer: WebGLRenderer, position: Vector3) => void;
  /** counts changes to what it looks like, but for the sky's own (the sun's): the bakes are drawn again */
  version: number;
  /** how much of the light (the sun's, or the moon's) the scene's light keeps past it, 0 to 1 */
  light: number;
  /** its shadows about the camera, read by the sea and the relief; null for none */
  shadow: ScenerySkyShadow | null;
  /** what the sea reflects of it away from where it was baked */
  reflection: ScenerySkyReflection;
};

/**
 * What the sea reflects of a {@link ScenerySkyOverlay} away from where {@link ScenerySkyOverlay.texture}
 * was baked (sky-ocean.glsl, `skyOceanReflectedClouds`): read by direction alone, the bake
 * blows its clouds up by the camera's height over the sea against their base, and far off the
 * weather is another's.
 */
export type ScenerySkyReflection = {
  /** the lowest clouds' base over the sea (world units) */
  base: number;
  /** the weather far off: a cube map fixed on the Earth of the share under cloud, r low, b middle, a high; null for none */
  map: CubeTexture | null;
  /** world directions into {@link map}'s frame */
  earth: Matrix3;
  /** {@link map}'s texels per world unit, at a face's middle */
  texels: number;
  /** how far the cover far off follows {@link map}, 0 to 1 */
  strength: number;
  /** from the scene's middle (world units), where its own clouds start giving way to {@link map}'s, and where they have */
  near: number;
  far: number;
};

export type SceneryRegistry = {
  /** the scenery's material: every feature's uniforms are its */
  material: SceneryMaterial;
  set: <K extends keyof SceneryFeatures>(
    feature: K,
    value: SceneryFeatures[K],
  ) => void;
  /** kept up to date each frame; the same object for the scenery's life */
  view: SceneryView;
  /** what draws itself in its sky, for the light; null for none. The same object for the scenery's life */
  overlay: { current: ScenerySkyOverlay | null };
  /** the ground under it, from its World's relief (see `SceneryGround`): the same object for the scenery's life */
  ground: SceneryGround;
};

export const SceneryRegistryContext = createContext<SceneryRegistry | null>(
  null,
);

const COMPONENTS: Record<keyof SceneryFeatures, string> = {
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
