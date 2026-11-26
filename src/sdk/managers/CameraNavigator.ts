import { Camera, Ray, Raycaster, Vector2, Vector3 } from 'three';
import { applyCameraUp, type CameraView } from '../utils/camera';
import {
  type CameraKeyPress,
  type CameraModifier,
  type CameraModifiers,
  type CameraNavigationBindings,
  type CameraNavigationBindingsInput,
  type CameraNavigationKeyAction,
  heldCameraKey,
  isControlTarget,
  matchCameraKey,
  type ParsedCameraKey,
  parseCameraKey,
  resolveCameraBindings,
} from './camera-bindings';

/**
 * The camera controls a {@link CameraNavigator} drives: drei's `CameraControls`
 * (camera-controls) have all of it.
 *
 * @group Managers
 */
export type NavigableControls = {
  enabled: boolean;
  getPosition(out: Vector3, receiveEndValue?: boolean): Vector3;
  getTarget(out: Vector3, receiveEndValue?: boolean): Vector3;
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

/**
 * The controls as {@link NavigableControls}, or null when they cannot be driven that way
 * (three's `OrbitControls`, or none).
 *
 * @group Managers
 */
export function navigableControls(controls: unknown): NavigableControls | null {
  const c = controls as Partial<NavigableControls> | null;
  return c &&
    typeof c.getPosition === 'function' &&
    typeof c.getTarget === 'function' &&
    typeof c.setLookAt === 'function' &&
    typeof c.enabled === 'boolean'
    ? (c as NavigableControls)
    : null;
}

/**
 * What a {@link CameraNavigator} is doing: orbiting (the controls' own), flying (the mouse
 * turns the view) or placing a new target.
 *
 * @group Managers
 */
export type CameraNavigationMode = 'orbit' | 'fly' | 'target';

/**
 * What a {@link CameraNavigator} tells its host, for what it shows (`onChange`).
 *
 * @group Managers
 */
export type CameraNavigatorState = {
  mode: CameraNavigationMode;
  /** the speed, as a factor of `speed` (1, 2, 4 … or ½, ¼ …) */
  speed: number;
  /** the keys are to be shown */
  help: boolean;
  /** a short notice ("View 3 saved"), or null */
  message: string | null;
  /** counts the notices, so the same one twice is told twice */
  messageCount: number;
};

/**
 * Options of a {@link CameraNavigator}.
 *
 * @group Managers
 */
export type CameraNavigatorOptions = {
  /** changes to the default keys (`DEFAULT_CAMERA_BINDINGS`) */
  bindings?: CameraNavigationBindingsInput;
  /** metres a second, at speed 1. Default 200 */
  speed?: number;
  /** how many times faster while `boost` (Shift) is held. Default 4 */
  sprint?: number;
  /** metres ahead the target is kept while moving, and placed at in target mode. Default 1000 */
  distance?: number;
  /** degrees the view turns per pixel the mouse moves in fly mode. Default 0.15 */
  lookSpeed?: number;
  /** up at a point: the scene's +Y without it */
  upAt?: (point: Vector3, out: Vector3) => Vector3;
  /** north, level, at a point: the scene's −Z without it */
  northAt?: (point: Vector3, out: Vector3) => Vector3;
  /** the view `home` goes to; null for the view at the first frame */
  home?: () => CameraView | null;
  /** where `goThere` (Alt+click) takes the camera, for a view along `ray`; null for nowhere */
  goThere?: (ray: Ray) => CameraView | null;
  /** told whenever its state changes */
  onChange?: (state: CameraNavigatorState) => void;
};

/** Notices are kept this long, in seconds, by a host that shows them. */
export const CAMERA_NAVIGATOR_NOTICE = 1.5;

const HISTORY = 50;
const SPEED_LEVELS = [-12, 16] as const;
const STEEPEST = (89 * Math.PI) / 180;
const UP_DRIFT = Math.cos((0.2 * Math.PI) / 180);

const HELD_ACTIONS = [
  'forward',
  'backward',
  'left',
  'right',
  'up',
  'down',
  'targetForward',
  'targetBackward',
  'targetLeft',
  'targetRight',
] as const;

const position = new Vector3();
const target = new Vector3();
const forward = new Vector3();
const right = new Vector3();
const up = new Vector3();
const move = new Vector3();
const heading = new Vector3();
const scratch = new Vector3();
const ndc = new Vector2();
const raycaster = new Raycaster();

/**
 * Keyboard and mouse navigation for a camera with orbit controls (drei's `CameraControls`):
 * move with keys, turn the view with the mouse (fly mode), place a new target, jump home and
 * back, keep views on number keys, and go where you click over a globe. Every key can be
 * changed (`bindings`; the defaults in `DEFAULT_CAMERA_BINDINGS`). The `CameraNavigation`
 * component sets one up in a React Three Fiber scene; elsewhere, {@link attach} it to the
 * canvas and call {@link update} each frame.
 *
 * Moving keeps the target `distance` ahead, so the view orbits a point in front of the camera
 * once you stop. Over a globe, give it `upAt` and `northAt`: up and down, level and north are
 * then the globe's where the camera is, and the camera's up follows it.
 *
 * @see documents/camera-navigation.md
 *
 * @group Managers
 */
export class CameraNavigator {
  private bindings: CameraNavigationBindings;
  private keys: Record<CameraNavigationKeyAction, ParsedCameraKey[]>;
  // The keys that move the marker, which move only it in target mode.
  private markerKeys: Set<string>;
  private options: CameraNavigatorOptions;
  private readonly held = new Map<string, string>();
  private readonly modifiers: CameraModifiers = {
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };
  private speedLevel = 0;
  private current: CameraNavigationMode = 'orbit';
  private readonly history: CameraView[] = [];
  private readonly slots = new Map<number, CameraView>();
  private moving = false;
  private lookX = 0;
  private lookY = 0;
  private controlsEnabled = true;
  private helpShown = false;
  private message: string | null = null;
  private messageCount = 0;
  private start: CameraView | null = null;
  private element: HTMLElement | null = null;
  /** The marker's place in target mode; read only. */
  readonly marker = new Vector3();

  constructor(
    readonly camera: Camera,
    readonly controls: NavigableControls,
    options: CameraNavigatorOptions = {},
  ) {
    this.options = options;
    this.bindings = resolveCameraBindings(options.bindings);
    this.keys = parseBindings(this.bindings);
    this.markerKeys = markerKeysOf(this.keys);
  }

  /** Change its options; the keys only when `bindings` is given. */
  setOptions(options: CameraNavigatorOptions) {
    const rebind = options.bindings !== this.options.bindings;
    this.options = options;
    if (rebind) {
      this.bindings = resolveCameraBindings(options.bindings);
      this.keys = parseBindings(this.bindings);
      this.markerKeys = markerKeysOf(this.keys);
    }
  }

  /** the keys in use */
  get keyBindings(): Readonly<CameraNavigationBindings> {
    return this.bindings;
  }

  /** what it is doing */
  get mode(): CameraNavigationMode {
    return this.current;
  }

  /** the speed, as a factor of `speed` */
  get speed(): number {
    return 2 ** this.speedLevel;
  }

  /** the keys are shown */
  get help(): boolean {
    return this.helpShown;
  }

  /** the views gone back from with {@link previous}, last first; read only */
  get views(): readonly CameraView[] {
    return this.history;
  }

  /**
   * Listen to the keys (on `element`'s window) and the pointer (on `element`, the canvas):
   * the keys only while nothing else has the focus (a field, a button, a focusable control of
   * its own). Returns the release.
   */
  attach(element: HTMLElement): () => void {
    this.element = element;
    const view = element.ownerDocument.defaultView ?? window;
    const document = element.ownerDocument;
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isControlTarget(event.target)) return;
      if (this.keyDown(event, event.repeat)) event.preventDefault();
    };
    const keyUp = (event: KeyboardEvent) => {
      this.keyUp(event);
      // Alt pressed and let go alone takes the focus to the browser's menu (Windows).
      if (event.key === 'Alt' && !isControlTarget(event.target))
        event.preventDefault();
    };
    const blur = () => this.release();
    // Before the controls' and the scene's own listeners on the canvas: a click this takes is
    // not also a start of an orbit, or a pick.
    const pointerDown = (event: PointerEvent) => {
      this.setModifiers(event);
      if (event.button !== 0) return;
      if (this.pointerDown(event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const pointerMove = (event: PointerEvent) => {
      if (this.current === 'fly') this.look(event.movementX, event.movementY);
    };
    const lockChange = () => {
      if (this.current === 'fly' && document.pointerLockElement !== element)
        this.setFlyMode(false);
    };
    view.addEventListener('keydown', keyDown);
    view.addEventListener('keyup', keyUp);
    view.addEventListener('blur', blur);
    element.addEventListener('pointerdown', pointerDown, { capture: true });
    element.addEventListener('pointermove', pointerMove);
    document.addEventListener('pointerlockchange', lockChange);
    return () => {
      view.removeEventListener('keydown', keyDown);
      view.removeEventListener('keyup', keyUp);
      view.removeEventListener('blur', blur);
      element.removeEventListener('pointerdown', pointerDown, {
        capture: true,
      });
      element.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerlockchange', lockChange);
      this.release();
      if (this.current !== 'orbit') this.endMode();
      this.element = null;
    };
  }

  /**
   * A key pressed (for a host that routes keys itself; {@link attach} does it for a canvas).
   *
   * @returns whether it was taken: the host should then keep the browser from acting on it
   */
  keyDown(press: CameraKeyPress, repeat = false): boolean {
    this.setModifiers(press);
    if (!repeat) this.held.set(press.code, press.key);
    const action = (name: CameraNavigationKeyAction) =>
      this.keys[name].some(key => matchCameraKey(key, press) !== false);
    const digit = (name: CameraNavigationKeyAction) => {
      for (const key of this.keys[name]) {
        const match = matchCameraKey(key, press);
        if (typeof match === 'number') return match;
      }
      return null;
    };
    // Moving keys are taken, so the page does not scroll by them.
    const heldKey = HELD_ACTIONS.some(name => action(name));
    if (repeat) return heldKey || action('faster') || action('slower');

    if (this.current === 'target') {
      if (action('targetSet') || action('targetMode')) {
        this.setTarget();
        return true;
      }
      if (action('cancel')) {
        this.setTargetMode(false);
        return true;
      }
    }
    if (this.current === 'fly' && (action('cancel') || action('flyMode'))) {
      this.setFlyMode(false);
      return true;
    }
    const saved = digit('saveView');
    if (saved !== null) {
      this.save(saved);
      return true;
    }
    const recalled = digit('recallView');
    if (recalled !== null) {
      this.recall(recalled);
      return true;
    }
    if (action('home')) this.home();
    else if (action('previous')) this.previous();
    else if (action('faster')) this.changeSpeed(1);
    else if (action('slower')) this.changeSpeed(-1);
    else if (action('flyMode')) this.setFlyMode(true);
    else if (action('targetMode')) this.setTargetMode(true);
    else if (action('level')) this.level();
    else if (action('north')) this.faceNorth();
    else if (action('help')) this.toggleHelp();
    else return heldKey || press.key === 'Alt';
    return true;
  }

  /** A key let go (see {@link keyDown}). */
  keyUp(press: CameraKeyPress) {
    this.setModifiers(press);
    this.held.delete(press.code);
  }

  /** Let go of every key, as when the window loses the focus. */
  release() {
    this.held.clear();
    this.modifiers.shiftKey = false;
    this.modifiers.altKey = false;
    this.modifiers.ctrlKey = false;
    this.modifiers.metaKey = false;
  }

  /**
   * The main button pressed on the canvas at `clientX`, `clientY`: in target mode, sets the
   * target; with `goThere` (Alt) held, goes there.
   *
   * @returns whether it was taken: the host should then keep the controls and the scene from it
   */
  pointerDown(clientX: number, clientY: number): boolean {
    if (this.current === 'target') {
      this.setTarget();
      return true;
    }
    if (!this.options.goThere || !this.isHeld(this.bindings.goThere))
      return false;
    const view = this.goThereAt(clientX, clientY);
    if (!view) return false;
    this.jump(view);
    return true;
  }

  /** Turn the view in fly mode, by the mouse's movement in pixels. */
  look(dx: number, dy: number) {
    this.lookX += dx;
    this.lookY += dy;
  }

  /** One frame, `delta` seconds after the last: move by the keys held. */
  update(delta: number) {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.controls.getPosition(position);
    this.controls.getTarget(target);
    if (!this.start) this.start = this.view();
    this.frame(position, target, forward, right, up);

    if (this.current === 'fly' && (this.lookX !== 0 || this.lookY !== 0)) {
      this.turnView(forward, up);
      this.lookX = 0;
      this.lookY = 0;
      target.copy(position).addScaledVector(forward, this.distance);
      this.place(position, target);
      this.frame(position, target, forward, right, up);
    }

    const speed =
      (this.options.speed ?? 200) *
      this.speed *
      (this.isHeld(this.bindings.boost) ? (this.options.sprint ?? 4) : 1);
    const step = speed * dt;

    if (this.current === 'target') {
      move.set(0, 0, 0);
      if (this.isDown('targetForward')) move.add(forward);
      if (this.isDown('targetBackward')) move.sub(forward);
      if (this.isDown('targetRight')) move.add(right);
      if (this.isDown('targetLeft')) move.sub(right);
      if (move.lengthSq() > 0)
        this.marker.addScaledVector(move.normalize(), step);
    }

    move.set(0, 0, 0);
    if (this.isDown('forward')) move.add(forward);
    if (this.isDown('backward')) move.sub(forward);
    if (this.isDown('right')) move.add(right);
    if (this.isDown('left')) move.sub(right);
    if (this.isDown('up')) move.add(up);
    if (this.isDown('down')) move.sub(up);
    if (
      move.lengthSq() === 0 ||
      this.modifiers.ctrlKey ||
      this.modifiers.metaKey
    ) {
      this.moving = false;
      return;
    }
    if (!this.moving) {
      // The target `distance` ahead while moving, so the view turns about it once stopped.
      target.copy(position).addScaledVector(forward, this.distance);
      this.moving = true;
    }
    move.normalize().multiplyScalar(step);
    position.add(move);
    target.add(move);
    this.place(position, target);
    this.followUp(position);
  }

  /** Go to `view`, remembering where it was for {@link previous}. */
  jump(view: CameraView) {
    this.remember();
    if (this.current === 'target') this.endMode();
    this.apply(view);
    this.moving = false;
  }

  /** Back to the view before the last jump; again, further back. */
  previous() {
    const view = this.history.pop();
    if (!view) {
      this.notify('No earlier view');
      return;
    }
    if (this.current === 'target') this.endMode();
    this.apply(view);
    this.moving = false;
  }

  /** Home: the `home` view, or the view at the first frame. */
  home() {
    const view = this.options.home?.() ?? this.start;
    if (view) this.jump(view);
  }

  /** Keep the view now on `slot` (0–9), while this navigator lives. */
  save(slot: number) {
    this.slots.set(slot, this.view());
    this.notify(`View ${slot} saved`);
  }

  /** Go to the view kept on `slot`. */
  recall(slot: number) {
    const view = this.slots.get(slot);
    if (!view) {
      this.notify(`No view on ${slot}`);
      return;
    }
    this.jump(view);
    this.notify(`View ${slot}`);
  }

  /** Level the view: the same heading, the horizon straight ahead. */
  level() {
    this.controls.getPosition(position);
    this.controls.getTarget(target);
    this.frame(position, target, forward, right, up);
    heading.copy(forward).addScaledVector(up, -forward.dot(up));
    // Looking straight down or up: the way the top of the view faces.
    if (heading.lengthSq() < 1e-8) heading.copy(up).cross(right);
    const reach = Math.max(position.distanceTo(target), 1);
    this.jump({
      position: position.toArray(),
      target: target
        .copy(position)
        .addScaledVector(heading.normalize(), reach)
        .toArray(),
      up: up.toArray(),
    });
  }

  /** Face north: the same angle above or below the horizon. */
  faceNorth() {
    this.controls.getPosition(position);
    this.controls.getTarget(target);
    this.frame(position, target, forward, right, up);
    const pitch = Math.asin(Math.min(Math.max(forward.dot(up), -1), 1));
    if (this.options.northAt) this.options.northAt(position, heading);
    else heading.set(0, 0, -1);
    heading.addScaledVector(up, -heading.dot(up)).normalize();
    const reach = Math.max(position.distanceTo(target), 1);
    forward
      .copy(heading)
      .multiplyScalar(Math.cos(pitch))
      .addScaledVector(up, Math.sin(pitch));
    this.jump({
      position: position.toArray(),
      target: target.copy(position).addScaledVector(forward, reach).toArray(),
      up: up.toArray(),
    });
  }

  /**
   * Fly mode on or off: the controls pause, and the mouse turns the view where the camera is
   * (the pointer captured where the browser allows it, else as it moves over the canvas).
   */
  setFlyMode(on: boolean) {
    if (on === (this.current === 'fly')) return;
    if (!on) {
      this.endMode();
      return;
    }
    if (this.current === 'target') this.endMode();
    this.beginMode('fly');
    // The target ahead, so the view turns about the camera.
    this.controls.getPosition(position);
    this.controls.getTarget(target);
    this.frame(position, target, forward, right, up);
    this.place(
      position,
      target.copy(position).addScaledVector(forward, this.distance),
    );
    const element = this.element as
      | (HTMLElement & { requestPointerLock?: () => unknown })
      | null;
    try {
      const request = element?.requestPointerLock?.();
      if (request instanceof Promise) request.catch(() => {});
    } catch {
      // Refused: the mouse turns the view as it moves over the canvas instead.
    }
  }

  /**
   * Target mode on or off: the controls pause, and a marker `distance` ahead is moved by the
   * keys; {@link setTarget} makes it the target.
   */
  setTargetMode(on: boolean) {
    if (on === (this.current === 'target')) return;
    if (!on) {
      this.endMode();
      return;
    }
    if (this.current === 'fly') this.endMode();
    this.controls.getPosition(position);
    this.controls.getTarget(target);
    this.frame(position, target, forward, right, up);
    this.marker.copy(position).addScaledVector(forward, this.distance);
    this.beginMode('target');
  }

  /** In target mode: the marker becomes the target, the camera staying where it is. */
  setTarget() {
    if (this.current !== 'target') return;
    this.controls.getPosition(position);
    const view: CameraView = {
      position: position.toArray(),
      target: this.marker.toArray(),
      up: this.camera.up.toArray(),
    };
    this.endMode();
    this.jump(view);
  }

  /** Show or hide the keys. */
  toggleHelp() {
    this.helpShown = !this.helpShown;
    this.changed();
  }

  /** The view now. */
  view(): CameraView {
    this.controls.getPosition(scratch);
    const view: CameraView = {
      position: scratch.toArray(),
      target: this.controls.getTarget(scratch).toArray(),
      up: this.camera.up.toArray(),
    };
    return view;
  }

  private get distance() {
    return this.options.distance ?? 1000;
  }

  private isHeld(modifier: CameraModifier | null) {
    if (!modifier) return false;
    if (modifier === 'Shift') return this.modifiers.shiftKey;
    if (modifier === 'Alt') return this.modifiers.altKey;
    if (modifier === 'Ctrl') return this.modifiers.ctrlKey;
    return this.modifiers.metaKey;
  }

  // An action's key held. In target mode the keys that move the marker move only it; out of
  // it, the marker's actions are idle.
  private isDown(action: (typeof HELD_ACTIONS)[number]) {
    const marker = action.startsWith('target');
    if (marker && this.current !== 'target') return false;
    const keys =
      this.current === 'target' && !marker
        ? this.keys[action].filter(key => !this.markerKeys.has(keyId(key)))
        : this.keys[action];
    return heldCameraKey(keys, this.held);
  }

  private setModifiers(state: CameraModifiers) {
    this.modifiers.shiftKey = state.shiftKey;
    this.modifiers.altKey = state.altKey;
    this.modifiers.ctrlKey = state.ctrlKey;
    this.modifiers.metaKey = state.metaKey;
  }

  // The view's frame at `p` looking at `t`: forward, right and up there (the globe's).
  private frame(
    p: Vector3,
    t: Vector3,
    outForward: Vector3,
    outRight: Vector3,
    outUp: Vector3,
  ) {
    if (this.options.upAt) this.options.upAt(p, outUp).normalize();
    else outUp.set(0, 1, 0);
    outForward.subVectors(t, p);
    if (outForward.lengthSq() < 1e-12)
      this.camera.getWorldDirection(outForward);
    outForward.normalize();
    outRight.crossVectors(outForward, outUp);
    if (outRight.lengthSq() < 1e-10)
      outRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    outRight.normalize();
  }

  // Turn `dir` by the mouse's movement: about up, and toward or away from it.
  private turnView(dir: Vector3, upward: Vector3) {
    const rate = ((this.options.lookSpeed ?? 0.15) * Math.PI) / 180;
    const pitch = Math.asin(Math.min(Math.max(dir.dot(upward), -1), 1));
    heading.copy(dir).addScaledVector(upward, -dir.dot(upward));
    if (heading.lengthSq() < 1e-10)
      heading.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    heading.addScaledVector(upward, -heading.dot(upward)).normalize();
    heading.applyAxisAngle(upward, -this.lookX * rate);
    const turned = Math.min(
      Math.max(pitch - this.lookY * rate, -STEEPEST),
      STEEPEST,
    );
    dir
      .copy(heading)
      .multiplyScalar(Math.cos(turned))
      .addScaledVector(upward, Math.sin(turned));
  }

  private place(p: Vector3, t: Vector3) {
    void this.controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
  }

  // Over a globe, the camera's up turned to the globe's where it has moved to.
  private followUp(p: Vector3) {
    if (!this.options.upAt) return;
    this.options.upAt(p, up).normalize();
    if (this.camera.up.dot(up) < UP_DRIFT)
      applyCameraUp(this.camera, this.controls, up);
  }

  private apply(view: CameraView) {
    if (view.up)
      applyCameraUp(this.camera, this.controls, scratch.set(...view.up));
    void this.controls.setLookAt(...view.position, ...view.target, false);
  }

  private remember() {
    this.history.push(this.view());
    if (this.history.length > HISTORY) this.history.shift();
  }

  private goThereAt(clientX: number, clientY: number): CameraView | null {
    const goThere = this.options.goThere;
    const element = this.element;
    if (!goThere || !element) return null;
    const rect = element.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, this.camera);
    return goThere(raycaster.ray);
  }

  private changeSpeed(by: number) {
    this.speedLevel = Math.min(
      Math.max(this.speedLevel + by, SPEED_LEVELS[0]),
      SPEED_LEVELS[1],
    );
    const factor = this.speed;
    this.notify(
      `Speed ${factor >= 1 ? factor : `1/${Math.round(1 / factor)}`}×`,
    );
  }

  private beginMode(mode: CameraNavigationMode) {
    this.controlsEnabled = this.controls.enabled;
    this.controls.enabled = false;
    this.current = mode;
    this.lookX = 0;
    this.lookY = 0;
    this.changed();
  }

  private endMode() {
    const was = this.current;
    this.current = 'orbit';
    this.controls.enabled = this.controlsEnabled;
    const document = this.element?.ownerDocument;
    if (was === 'fly' && document?.pointerLockElement === this.element)
      document.exitPointerLock?.();
    this.changed();
  }

  private notify(message: string) {
    this.message = message;
    this.messageCount++;
    this.changed();
  }

  private changed() {
    this.options.onChange?.({
      mode: this.current,
      speed: this.speed,
      help: this.helpShown,
      message: this.message,
      messageCount: this.messageCount,
    });
  }
}

function parseBindings(
  bindings: CameraNavigationBindings,
): Record<CameraNavigationKeyAction, ParsedCameraKey[]> {
  const parsed = {} as Record<CameraNavigationKeyAction, ParsedCameraKey[]>;
  for (const [action, keys] of Object.entries(bindings)) {
    if (action === 'boost' || action === 'goThere') continue;
    parsed[action as CameraNavigationKeyAction] = (keys as string[]).map(
      parseCameraKey,
    );
  }
  return parsed;
}

const keyId = (key: ParsedCameraKey) => `${key.code ?? ''}|${key.key ?? ''}`;

function markerKeysOf(
  keys: Record<CameraNavigationKeyAction, ParsedCameraKey[]>,
): Set<string> {
  return new Set(
    [
      ...keys.targetForward,
      ...keys.targetBackward,
      ...keys.targetLeft,
      ...keys.targetRight,
    ].map(keyId),
  );
}
