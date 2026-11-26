import type { Globe } from '../../sdk/projection/globe';
import type { SceneryReliefHub } from '../Scenery/scenery-relief-hub';

/**
 * What a {@link World} drawn in a scene shares with what lies outside it there (a
 * `CameraNavigation` set up beside the story, say): its globe, and its relief's tiles as drawn.
 */
export type SceneWorld = {
  globe: Globe;
  tiles: SceneryReliefHub;
};

const WORLDS = new WeakMap<object, SceneWorld>();

/** The {@link World} drawn in `scene`, or null without one. */
export function sceneWorld(scene: object): SceneWorld | null {
  return WORLDS.get(scene) ?? null;
}

/** A {@link World} tells `scene` it is drawn there; returns the release. */
export function registerSceneWorld(
  scene: object,
  world: SceneWorld,
): () => void {
  WORLDS.set(scene, world);
  return () => {
    if (WORLDS.get(scene) === world) WORLDS.delete(scene);
  };
}
