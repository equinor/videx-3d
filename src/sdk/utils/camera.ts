import {
  Camera,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import type { GlobeCarry } from '../projection/place-frame';

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

// Controls that take a new camera up and place the camera themselves: camera-controls (drei's
// `CameraControls`).
type UpAwareControls = {
  updateCameraUp(): void;
  getPosition(out: Vector3, receiveEndValue?: boolean): Vector3;
  setPosition(
    x: number,
    y: number,
    z: number,
    enableTransition?: boolean,
  ): unknown;
  setLookAt(
    positionX: number,
    positionY: number,
    positionZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition?: boolean,
  ): unknown;
};

function upAware(controls: unknown): UpAwareControls | null {
  const c = controls as Partial<UpAwareControls> | null;
  return c &&
    typeof c.updateCameraUp === 'function' &&
    typeof c.getPosition === 'function' &&
    typeof c.setPosition === 'function' &&
    typeof c.setLookAt === 'function'
    ? (c as UpAwareControls)
    : null;
}

// Controls holding their target as a vector, aiming the camera at it as they update: three's
// `OrbitControls` and `MapControls`.
type TargetControls = { target: Vector3; update?: () => unknown };

function targetHolding(controls: unknown): TargetControls | null {
  const c = controls as
    | (Partial<TargetControls> & { getTarget?: unknown })
    | null;
  return c && c.target?.isVector3 && typeof c.getTarget !== 'function'
    ? (c as TargetControls)
    : null;
}

const aimAt = new Vector3();
const viewDirection = new Vector3();
const placedAt = new Vector3();

/**
 * Set the camera's `up`, keeping where it is and what it looks at: camera-controls (drei's
 * `CameraControls`) are re-based on it (`updateCameraUp`), their orbit then turning about it;
 * other controls' camera is aimed at their target again with it (three's `OrbitControls` keep
 * orbiting about the up they were made with); with none, the camera turns about its view.
 * For a camera at rest: camera-controls' movement under way is set to where it is.
 *
 * @group Utils
 */
export function applyCameraUp(camera: Camera, controls: unknown, up: Vector3) {
  const aware = upAware(controls);
  if (aware) {
    aware.getPosition(placedAt, false);
    camera.up.copy(up);
    aware.updateCameraUp();
    aware.setPosition(placedAt.x, placedAt.y, placedAt.z, false);
    return;
  }
  if (!readCameraTarget(controls, aimAt))
    aimAt.copy(camera.position).add(camera.getWorldDirection(viewDirection));
  camera.up.copy(up);
  camera.lookAt(aimAt);
  camera.updateMatrixWorld();
}

/**
 * Carry the camera, its controls' target and its up through a change of a `World`'s frame, by
 * where they are on the Earth (`WorldFrameChange.carry`): the view does not move. For
 * camera-controls (drei's `CameraControls`), for controls holding their `target` (three's
 * `OrbitControls`), and for a camera with none, whose view direction is carried instead.
 *
 * @group Utils
 */
export function carryCamera(
  carry: GlobeCarry,
  camera: Camera,
  controls?: unknown,
) {
  const aware = upAware(controls);
  const position = aware
    ? aware.getPosition(new Vector3(), false)
    : camera.position.clone();
  const target = new Vector3();
  const hasTarget = readCameraTarget(controls, target);
  const up = carry.direction(camera.up, position, new Vector3());
  const view = hasTarget
    ? null
    : carry.direction(
        camera.getWorldDirection(new Vector3()),
        position,
        new Vector3(),
      );
  carry.point(position, position);
  camera.up.copy(up);
  if (aware && hasTarget) {
    carry.point(target, target);
    aware.updateCameraUp();
    void aware.setLookAt(
      position.x,
      position.y,
      position.z,
      target.x,
      target.y,
      target.z,
      false,
    );
    return;
  }
  camera.position.copy(position);
  if (hasTarget) {
    carry.point(target, target);
    const held = targetHolding(controls);
    held?.target.copy(target);
    camera.lookAt(target);
    held?.update?.();
  } else {
    camera.lookAt(position.add(view!));
  }
  camera.updateMatrixWorld();
}

/**
 * Put the camera at `pose.camera` looking at `pose.target` through the installed controls:
 * camera-controls (drei's `CameraControls`) fly there with their transition unless `smooth` is
 * off; controls holding their `target` (three's `OrbitControls`) are set at once. Points in the
 * scene. A camera with neither is left alone: nothing would keep the new pose.
 *
 * @returns whether the controls took the pose
 *
 * @group Utils
 */
export function setCameraPose(
  controls: unknown,
  camera: Camera,
  pose: {
    camera: readonly [number, number, number];
    target: readonly [number, number, number];
  },
  smooth = true,
): boolean {
  const c = controls as {
    setLookAt?: (
      positionX: number,
      positionY: number,
      positionZ: number,
      targetX: number,
      targetY: number,
      targetZ: number,
      enableTransition?: boolean,
    ) => unknown;
  } | null;
  if (typeof c?.setLookAt === 'function') {
    void c.setLookAt(...pose.camera, ...pose.target, smooth);
    return true;
  }
  const held = targetHolding(controls);
  if (!held) return false;
  camera.position.set(...pose.camera);
  held.target.set(...pose.target);
  camera.lookAt(held.target);
  held.update?.();
  return true;
}

/**
 * The size of a screen pixel, in scene units, `distance` from a camera whose view is `height`
 * pixels high: for a perspective camera it grows with the distance; for an orthographic one
 * it is the same everywhere.
 *
 * @group Utils
 */
export function cameraPixelSize(
  camera: Camera,
  height: number,
  distance: number,
): number {
  const perspective = camera as PerspectiveCamera;
  if (perspective.isPerspectiveCamera)
    return (
      (2 * distance * Math.tan((perspective.fov * Math.PI) / 360)) /
      (perspective.zoom * height)
    );
  const ortho = camera as OrthographicCamera;
  if (ortho.isOrthographicCamera)
    return (ortho.top - ortho.bottom) / (ortho.zoom * height);
  return (2 * distance * Math.tan(Math.PI / 6)) / height;
}

/**
 * Options for {@link CameraRest}.
 *
 * @group Utils
 */
export type CameraRestOptions = {
  /** how many frames in a row the camera must not move. Default 10 */
  frames?: number;
  /** how long after the last turn of the mouse wheel, in ms, it can be at rest. Default 300 */
  wheel?: number;
};

/**
 * Tells when the camera is at rest: no pointer held down on the controls' element, no turn of
 * the mouse wheel for a moment, and the camera not moved for a few frames in a row, so the
 * glide after a drag counts as moving, and keys and any kind of controls are covered. What
 * changes the camera of its own accord — levelling it, carrying it to another frame — waits for
 * this, so it never takes the controls from the user's hand; and stops when they take it
 * ({@link onInteract}).
 *
 * @group Utils
 */
export class CameraRest {
  private readonly frames: number;
  private readonly wheel: number;
  private readonly held = new Set<number>();
  private wheelAt = -Infinity;
  private still = 0;
  private rested = false;
  private restedNow = false;
  private seen = false;
  private readonly last = new Matrix4();
  private readonly listeners = new Set<() => void>();

  constructor({ frames = 10, wheel = 300 }: CameraRestOptions = {}) {
    this.frames = frames;
    this.wheel = wheel;
  }

  /**
   * Listen for the user taking the controls on `element` (the controls' own, where they listen):
   * pointers held down, and the wheel. Returns the release.
   */
  attach(element: HTMLElement): () => void {
    const down = (event: PointerEvent) => {
      this.held.add(event.pointerId);
      this.interact();
    };
    const up = (event: PointerEvent) => {
      this.held.delete(event.pointerId);
    };
    const wheel = () => {
      this.wheelAt = performance.now();
      this.interact();
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.held.clear();
    };
  }

  /** Told the moment the user takes the controls. Returns the release. */
  onInteract(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** a pointer is held down on the controls, or the wheel was turned a moment ago */
  get interacting(): boolean {
    return this.held.size > 0 || performance.now() - this.wheelAt < this.wheel;
  }

  /** the camera is at rest, as of the last {@link update} */
  get atRest(): boolean {
    return this.rested;
  }

  /** it came to rest at the last {@link update}: once per rest */
  get justRested(): boolean {
    return this.restedNow;
  }

  /** Once a frame, after the controls have moved the camera: whether it is at rest now. */
  update(camera: Camera): boolean {
    camera.updateMatrixWorld();
    const moved = !this.seen || !sameMatrix(this.last, camera.matrixWorld);
    this.last.copy(camera.matrixWorld);
    this.seen = true;
    this.still = moved || this.interacting ? 0 : this.still + 1;
    const was = this.rested;
    this.rested = this.still >= this.frames;
    this.restedNow = this.rested && !was;
    return this.rested;
  }

  /**
   * Take the camera as it is now for unmoved: after a change of one's own (a step of levelling),
   * so it does not count as the user moving it.
   */
  accept(camera: Camera) {
    camera.updateMatrixWorld();
    this.last.copy(camera.matrixWorld);
  }

  private interact() {
    this.still = 0;
    this.rested = false;
    for (const listener of this.listeners) listener();
  }
}

// Whether two camera matrices are the same but for rounding: its turn to a millionth, its place
// to a millionth of its distance from the origin (4 cm 40 km out).
function sameMatrix(a: Matrix4, b: Matrix4) {
  const x = a.elements;
  const y = b.elements;
  for (let i = 0; i < 12; i++) if (Math.abs(x[i] - y[i]) > 1e-6) return false;
  const reach = 1e-6 * Math.max(1, Math.hypot(y[12], y[13], y[14]));
  for (let i = 12; i < 15; i++) if (Math.abs(x[i] - y[i]) > reach) return false;
  return true;
}

const turn = new Quaternion();
const partly = new Quaternion();
const eased = new Vector3();

/**
 * Turns a camera's `up` to another over a while, eased in and out (`applyCameraUp` each
 * frame): its view rolls smoothly where it is, instead of at once. For a camera at rest (see
 * {@link CameraRest}): {@link cancel} it when the user takes the controls.
 *
 * @group Utils
 */
export class CameraUpTransition {
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private start = 0;
  private duration = 0;
  private active = false;

  /** it is under way */
  get running(): boolean {
    return this.active;
  }

  /** where it is going; read only */
  get goal(): Vector3 {
    return this.to;
  }

  /** Start from `from` (the camera's up now) to `to`, over `duration` ms from `now`. */
  begin(from: Vector3, to: Vector3, duration: number, now: number) {
    this.from.copy(from).normalize();
    this.to.copy(to).normalize();
    this.start = now;
    this.duration = duration;
    this.active = true;
  }

  /** One frame: the camera's up set where the turn has eased to. Returns whether it goes on. */
  step(camera: Camera, controls: unknown, now: number): boolean {
    if (!this.active) return false;
    const t =
      this.duration > 0
        ? Math.min(Math.max((now - this.start) / this.duration, 0), 1)
        : 1;
    const e = t * t * (3 - 2 * t);
    turn.setFromUnitVectors(this.from, this.to);
    partly.identity().slerp(turn, e);
    applyCameraUp(
      camera,
      controls,
      eased.copy(this.from).applyQuaternion(partly),
    );
    if (t >= 1) this.active = false;
    return this.active;
  }

  /** Stop where it is. */
  cancel() {
    this.active = false;
  }
}
