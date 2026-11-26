import type { CameraNavigator } from '../../sdk/managers/CameraNavigator';

const NAVIGATORS = new WeakMap<object, CameraNavigator>();

/**
 * The navigator of the `CameraNavigation` in `scene`, or null without one: for buttons of a
 * host's own that jump the camera the same way (and so can be gone back from).
 */
export function sceneCameraNavigator(scene: object): CameraNavigator | null {
  return NAVIGATORS.get(scene) ?? null;
}

/** A `CameraNavigation` tells `scene` its navigator; returns the release. */
export function registerSceneNavigator(
  scene: object,
  navigator: CameraNavigator,
): () => void {
  NAVIGATORS.set(scene, navigator);
  return () => {
    if (NAVIGATORS.get(scene) === navigator) NAVIGATORS.delete(scene);
  };
}
