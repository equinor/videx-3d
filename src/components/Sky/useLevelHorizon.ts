import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Camera, MathUtils, Vector3 } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import { useWorld } from '../World/world-context';
import { useSkyOcean } from './sky-context';

/**
 * Options for {@link useLevelHorizon}.
 */
export type LevelHorizonOptions = {
  /** level the camera's horizon. Default true; turned off, the camera's own `up` is put back */
  enabled?: boolean;
  /** the globe to level by; default the enclosing `Sky`'s, or the enclosing `World`'s */
  globe?: Globe;
  /**
   * the highest the camera is levelled from, in scene units over the globe: above it the up
   * is held as it was, since from space the up there runs along a view down at the Earth.
   * Default 100 000
   */
  below?: number;
  /**
   * how far, in degrees, the up turns before it is set again: each time the controls'
   * orbit is re-based on it. Default 0.25
   */
  step?: number;
};

// Controls that take a new camera up, as camera-controls (drei's `CameraControls`) does.
type UpAwareControls = {
  updateCameraUp(): void;
  getPosition(out: Vector3, receiveEndValue?: boolean): Vector3;
  setPosition(
    x: number,
    y: number,
    z: number,
    enableTransition?: boolean,
  ): unknown;
};

function upAware(controls: unknown): UpAwareControls | null {
  const c = controls as Partial<UpAwareControls> | null;
  return c &&
    typeof c.updateCameraUp === 'function' &&
    typeof c.getPosition === 'function' &&
    typeof c.setPosition === 'function'
    ? (c as UpAwareControls)
    : null;
}

const now = new Vector3();
const end = new Vector3();

// Set the camera's up, and re-base the controls' orbit on it where they can take it: where
// the camera is, and where it was heading.
function setCameraUp(camera: Camera, controls: unknown, up: Vector3) {
  const aware = upAware(controls);
  if (!aware) {
    camera.up.copy(up);
    return;
  }
  aware.getPosition(now, false);
  aware.getPosition(end, true);
  camera.up.copy(up);
  aware.updateCameraUp();
  aware.setPosition(now.x, now.y, now.z, false);
  aware.setPosition(end.x, end.y, end.z, true);
}

/**
 * Keeps the camera's horizon level wherever it is on the globe: its `up` is set to the up
 * the sky is seen by there (`Globe.lookUp`), the scene's over the field and the globe's far
 * off, eased between so nothing turns at the field's edge. Without it a camera far from the
 * field keeps the field's up, and its horizon tilts by the angle round the Earth.
 *
 * The library never changes a camera or its controls unless asked: this is the asking. With
 * the scene's default controls (`makeDefault`) taking a new up — camera-controls, drei's
 * `CameraControls` — their orbit is re-based on it, keeping where the camera is and where it
 * is heading. Controls that read the up only when made, as three's `OrbitControls`, are not
 * levelled by it. Turned off or unmounted, the camera's own up is put back.
 *
 * Call it inside the `Sky` or a `World` holding one, or pass the `globe`.
 */
export function useLevelHorizon({
  enabled = true,
  globe,
  below = 100000,
  step = 0.25,
}: LevelHorizonOptions = {}) {
  const material = useSkyOcean()?.material ?? null;
  const world = useWorld();
  const levelling = globe ?? material?.globe ?? world?.globe ?? null;
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls);
  const scratch = useRef(new Vector3());

  // The camera's own up, put back when turned off.
  useEffect(() => {
    if (!enabled || !levelling) return;
    const own = camera.up.clone();
    return () => {
      if (!camera.up.equals(own)) setCameraUp(camera, controls, own);
    };
  }, [enabled, levelling, camera, controls]);

  useFrame(() => {
    if (!enabled || !levelling) return;
    if (levelling.altitude(camera.position) > below) return;
    const up = levelling.lookUp(camera.position, scratch.current);
    if (camera.up.angleTo(up) < step * MathUtils.DEG2RAD) return;
    setCameraUp(camera, controls, up);
  });
}
