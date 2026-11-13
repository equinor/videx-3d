import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import {
  CAMERA_PROBE_ORDER,
  type CameraProbe,
  type CameraSiteStore,
  sceneCameraSite,
} from '../sdk/utils/camera-site';

/**
 * Where the camera is ({@link CameraSiteStore} of the scene this is drawn in): ask it with
 * `get(camera)` in a frame callback or as a material renders.
 */
export function useCameraSite(): CameraSiteStore {
  const scene = useThree(state => state.scene);
  return sceneCameraSite(scene);
}

/**
 * Tell the scene's camera site what this knows of where the camera is: `probe` runs at most
 * once a frame (per camera), at `order` ({@link CAMERA_PROBE_ORDER}), when something first
 * asks. Keep it stable (`useCallback`): a new one is registered afresh. `null`, none.
 *
 * Starts the site's frame after the camera's controls have moved the camera (they run at
 * priority -1) and before every other frame callback.
 */
export function useCameraProbe(
  probe: CameraProbe | null,
  order: number = CAMERA_PROBE_ORDER.water,
): CameraSiteStore {
  const store = useCameraSite();
  useLayoutEffect(
    () => (probe ? store.probe(probe, order) : undefined),
    [store, probe, order],
  );
  useFrame(() => store.tick(), -0.5);
  return store;
}
