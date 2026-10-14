import { Camera } from 'three';

/**
 * What the last pick saw, so the `EventEmitter` can tell each frame, cheaply,
 * whether another one would see anything different.
 *
 * @internal
 */
export type PickSchedule = {
  /** a pick was asked for (see `EventEmitterContextProps.update`) */
  requested: boolean;
  /** whether anything has been picked yet */
  picked: boolean;
  /** the pointer (NDC) at the last pick */
  x: number;
  y: number;
  /** the listener set at the last pick (see `PickingHelper.version`) */
  version: number;
  /** the camera's world and projection matrices at the last pick */
  camera: Float64Array;
  /** the camera's matrices last frame (see {@link observeCamera}) */
  frame: Float64Array;
  /** the camera has not moved since last frame */
  cameraStill: boolean;
  /** no pick starts before this (`performance.now()`, ms; see {@link markRead}) */
  notBefore: number;
};

/**
 * A pick waits this many times its last read back before the next one may start,
 * so reading back takes at most a fifth of the main thread. A read back waits for
 * the GPU: under a saturated GPU it costs about a frame, otherwise next to nothing.
 *
 * @internal
 */
export const PICK_READ_WAIT = 4;

/** @internal */
export function createPickSchedule(): PickSchedule {
  return {
    requested: false,
    picked: false,
    x: 0,
    y: 0,
    version: -1,
    camera: new Float64Array(32),
    frame: new Float64Array(32),
    cameraStill: false,
    notBefore: 0,
  };
}

function cameraDiffers(seen: Float64Array, camera: Camera): boolean {
  const world = camera.matrixWorld.elements;
  const projection = camera.projectionMatrix.elements;
  for (let i = 0; i < 16; i++) {
    if (world[i] !== seen[i] || projection[i] !== seen[16 + i]) return true;
  }
  return false;
}

function keepCamera(seen: Float64Array, camera: Camera) {
  seen.set(camera.matrixWorld.elements, 0);
  seen.set(camera.projectionMatrix.elements, 16);
}

/**
 * Note where the camera is this frame. Call once per frame, before
 * {@link pickDue}.
 *
 * @internal
 */
export function observeCamera(schedule: PickSchedule, camera: Camera): void {
  schedule.cameraStill = !cameraDiffers(schedule.frame, camera);
  if (!schedule.cameraStill) keepCamera(schedule.frame, camera);
}

/**
 * Whether to pick now: one was asked for, or the pointer or the listeners changed
 * since the last pick, or the camera did and has since stopped — and the last
 * read back has been waited out (see {@link PICK_READ_WAIT}).
 *
 * @internal
 */
export function pickDue(
  schedule: PickSchedule,
  pointer: { x: number; y: number },
  camera: Camera,
  version: number,
  now: number,
): boolean {
  if (now < schedule.notBefore) return false;
  if (schedule.requested || !schedule.picked) return true;
  if (pointer.x !== schedule.x || pointer.y !== schedule.y) return true;
  if (version !== schedule.version) return true;
  // Not while it moves: what is under the pointer is picked once it stops.
  return schedule.cameraStill && cameraDiffers(schedule.camera, camera);
}

/**
 * Record what the pick about to run sees.
 *
 * @internal
 */
export function markPicked(
  schedule: PickSchedule,
  pointer: { x: number; y: number },
  camera: Camera,
  version: number,
): void {
  schedule.requested = false;
  schedule.picked = true;
  schedule.x = pointer.x;
  schedule.y = pointer.y;
  schedule.version = version;
  keepCamera(schedule.camera, camera);
}

/**
 * Record a read back that took `readMs`, finished at `now`.
 *
 * @internal
 */
export function markRead(
  schedule: PickSchedule,
  now: number,
  readMs: number,
): void {
  schedule.notBefore = now + PICK_READ_WAIT * readMs;
}
