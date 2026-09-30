import { Vector3 } from 'three';

/**
 * Reading the installed camera controls without knowing which ones they are.
 *
 * ⭐ The library must not dictate the host's R3F setup, so anything that follows
 * the camera has to cope with whatever is in `state.controls` — or with nothing at
 * all.
 *
 * @module
 */

/**
 * The camera target, from whatever controls are installed as the default —
 * `CameraControls` hands it out through `getTarget`, `OrbitControls` holds it as a
 * plain `target`.
 *
 * @returns false when there is no target to read, leaving `out` untouched
 *
 * @group Utils
 */
export function readCameraTarget(controls: unknown, out: Vector3) {
  const source = controls as {
    getTarget?: (out: Vector3) => Vector3;
    target?: Vector3;
  } | null;
  if (!source) return false;
  if (typeof source.getTarget === 'function') {
    source.getTarget(out);
    return true;
  }
  if (source.target?.isVector3) {
    out.copy(source.target);
    return true;
  }
  return false;
}
