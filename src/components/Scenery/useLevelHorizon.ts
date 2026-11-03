import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { MathUtils, Vector3 } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import {
  applyCameraUp,
  CameraRest,
  CameraUpTransition,
} from '../../sdk/utils/camera';
import { useWorld } from '../World/world-context';
import { useSceneryOcean } from './scenery-context';

/**
 * When {@link useLevelHorizon} levels the camera: `'rest'` once it has come to rest, its view
 * rolled level over a moment; `'continuous'` all the while it moves, a little each frame.
 */
export type LevelHorizonMode = 'rest' | 'continuous';

/**
 * Options for {@link useLevelHorizon}.
 */
export type LevelHorizonOptions = {
  /** level the camera's horizon. Default true; turned off, the camera's own `up` is put back */
  enabled?: boolean;
  /** the globe to level by; default the enclosing `Scenery`'s, or the enclosing `World`'s */
  globe?: Globe;
  /**
   * the highest the camera is levelled from, in scene units over the globe: above it the up
   * is held as it was, since looking straight down from space the up runs along the view and a
   * roll has no meaning. For oblique views from space, raise it (`Infinity`). Default 100 000
   */
  below?: number;
  /**
   * When it levels. `'rest'` (default): only once the camera has come to rest, the user's hands
   * off the controls (see `CameraRest`), rolling the view level over `duration`: while it moves
   * it is exactly as the user drives it, its horizon tilting by the angle travelled round the
   * Earth (0.9° per 100 km), then levelled. `'continuous'`: the horizon kept level all the
   * while, rolling as the camera crosses the Earth's curve, a few thousandths of a degree a
   * frame; the controls' orbit is re-based on the new up only at rest, so until then it
   * turns about the up it had then.
   */
  mode?: LevelHorizonMode;
  /** how far, in degrees, the up may be off level at rest before it is levelled. Default 0.05 */
  tolerance?: number;
  /** how long, in ms, the view takes to roll level at rest. Default 600 */
  duration?: number;
};

const scratch = new Vector3();

/**
 * Keeps the camera's horizon level wherever it is on the globe: its `up` is set to the up
 * the sky is seen by there (`Globe.lookUp`), the scene's over the field and the globe's far
 * off, eased between so nothing turns at the field's edge. Without it a camera far from the
 * field keeps the field's up, and its horizon tilts by the angle round the Earth.
 *
 * It never takes the controls from the user: by default it levels only once the camera has
 * come to rest, and rolls the view level over a moment, stopping where it is the instant the
 * user takes the controls again (see `mode` for levelling all the while instead).
 *
 * The library never changes a camera or its controls unless asked: this is the asking. With
 * the scene's default controls (`makeDefault`) taking a new up — camera-controls, drei's
 * `CameraControls` — their orbit is re-based on it, keeping where the camera is and where it
 * looks. Controls that read the up only when made, as three's `OrbitControls`, keep orbiting
 * about that up: their view is levelled, but their orbit is not. Turned off or unmounted, the
 * camera's own up is put back.
 *
 * Call it inside a `World` or a `Scenery`, or pass the `globe`.
 */
export function useLevelHorizon({
  enabled = true,
  globe,
  below = 100000,
  mode = 'rest',
  tolerance = 0.05,
  duration = 600,
}: LevelHorizonOptions = {}) {
  const material = useSceneryOcean()?.material ?? null;
  const world = useWorld();
  const levelling = globe ?? material?.globe ?? world?.globe ?? null;
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls);
  const gl = useThree(state => state.gl);
  const connected = useThree(state => state.events.connected) as
    | HTMLElement
    | undefined;
  const [rest] = useState(() => new CameraRest());
  const [transition] = useState(() => new CameraUpTransition());
  // The up the controls' orbit was last based on: in `'continuous'` the camera's runs ahead of
  // it while it moves.
  const [based] = useState(() => new Vector3());

  // The user taking the controls: where they listen, and the levelling under way stopped.
  const element =
    (controls as { domElement?: HTMLElement } | null)?.domElement ??
    connected ??
    gl.domElement;
  useEffect(() => {
    if (!enabled) return;
    const release = rest.attach(element);
    const stop = rest.onInteract(() => transition.cancel());
    return () => {
      release();
      stop();
    };
  }, [enabled, element, rest, transition]);

  // The camera's own up, put back when turned off.
  useEffect(() => {
    if (!enabled || !levelling) return;
    const own = camera.up.clone();
    based.copy(camera.up);
    return () => {
      transition.cancel();
      if (!camera.up.equals(own)) applyCameraUp(camera, controls, own);
    };
  }, [enabled, levelling, camera, controls, based, transition]);

  useFrame(() => {
    if (!enabled || !levelling) return;
    const now = performance.now();
    const atRest = rest.update(camera);
    if (transition.running) {
      transition.step(camera, controls, now);
      based.copy(camera.up);
      rest.accept(camera);
      return;
    }
    if (levelling.altitude(camera.position) > below) return;
    const level = levelling.lookUp(camera.position, scratch);
    if (!atRest) {
      // Rolled level as it moves: the controls aim the camera with its up each time they move
      // it, and their drag is left alone.
      if (mode === 'continuous' && camera.up.angleTo(level) > 1e-7)
        camera.up.copy(level);
      return;
    }
    if (camera.up.angleTo(level) > tolerance * MathUtils.DEG2RAD) {
      transition.begin(camera.up, level, duration, now);
      return;
    }
    // The orbit re-based on the up the camera already has: nothing on screen changes.
    if (!based.equals(camera.up)) {
      applyCameraUp(camera, controls, camera.up.clone());
      based.copy(camera.up);
      rest.accept(camera);
    }
  });
}
