import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  isControlTarget,
  matchCameraKey,
  parseCameraKey,
  resolveCameraBindings,
} from '../src/sdk/managers/camera-bindings';
import {
  CameraNavigator,
  type CameraNavigatorOptions,
} from '../src/sdk/managers/CameraNavigator';

// Controls that take a pose at once, as camera-controls do without a transition.
class FakeControls {
  enabled = true;
  readonly position = new Vector3();
  readonly target = new Vector3();
  constructor(private readonly camera: PerspectiveCamera) {}
  getPosition(out: Vector3) {
    return out.copy(this.position);
  }
  getTarget(out: Vector3) {
    return out.copy(this.target);
  }
  setLookAt(
    px: number,
    py: number,
    pz: number,
    tx: number,
    ty: number,
    tz: number,
  ) {
    this.position.set(px, py, pz);
    this.target.set(tx, ty, tz);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}

const press = (
  code: string,
  key = '',
  modifiers: Partial<
    Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>
  > = {},
) => ({
  code,
  key,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...modifiers,
});

// A camera at the origin looking along -Z at a target 500 m away.
function setUp(options: CameraNavigatorOptions = {}) {
  const camera = new PerspectiveCamera();
  const controls = new FakeControls(camera);
  controls.setLookAt(0, 0, 0, 0, 0, -500);
  const navigator = new CameraNavigator(camera, controls, options);
  navigator.update(0);
  return { camera, controls, navigator };
}

// A vector's coordinates to `digits` places, for comparing (-0 as 0).
const xyz = (v: Vector3, digits = 6) =>
  v.toArray().map(c => Number(c.toFixed(digits)) + 0);
const at = (x: number, y: number, z: number, digits = 6) =>
  xyz(new Vector3(x, y, z), digits);

describe('camera bindings', () => {
  it('matches keys by code, character, modifiers and digit', () => {
    const save = parseCameraKey('Alt+Digit#');
    expect(matchCameraKey(save, press('Digit3', '3', { altKey: true }))).toBe(
      3,
    );
    expect(matchCameraKey(save, press('Digit3', '3'))).toBe(false);
    expect(matchCameraKey(parseCameraKey('Digit#'), press('Digit7', '7'))).toBe(
      7,
    );
    // A character, typed with Shift on most layouts, still matches.
    expect(
      matchCameraKey(
        parseCameraKey('?'),
        press('Slash', '?', { shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      matchCameraKey(
        parseCameraKey('+'),
        press('Equal', '+', { shiftKey: true }),
      ),
    ).toBe(true);
    // Ctrl, Alt and Meta exactly as asked.
    expect(
      matchCameraKey(
        parseCameraKey('KeyL'),
        press('KeyL', 'l', { ctrlKey: true }),
      ),
    ).toBe(false);
    expect(
      matchCameraKey(
        parseCameraKey('Ctrl+KeyL'),
        press('KeyL', 'l', { ctrlKey: true }),
      ),
    ).toBe(true);
  });

  it('turns an action off with false, and keeps the others', () => {
    const bindings = resolveCameraBindings({
      north: false,
      up: 'KeyE',
      goThere: false,
    });
    expect(bindings.north).toEqual([]);
    expect(bindings.up).toEqual(['KeyE']);
    expect(bindings.goThere).toBeNull();
    expect(bindings.forward).toEqual(['KeyW']);
  });

  it('leaves keys to fields, buttons and focusable controls', () => {
    const element = (tagName: string, tabindex: string | null = null) => ({
      tagName,
      isContentEditable: false,
      getAttribute: () => tabindex,
    });
    expect(isControlTarget(element('INPUT') as unknown as EventTarget)).toBe(
      true,
    );
    expect(isControlTarget(element('BUTTON') as unknown as EventTarget)).toBe(
      true,
    );
    expect(isControlTarget(element('svg', '0') as unknown as EventTarget)).toBe(
      true,
    );
    expect(isControlTarget(element('BODY') as unknown as EventTarget)).toBe(
      false,
    );
    expect(
      isControlTarget(element('CANVAS', '0') as unknown as EventTarget),
    ).toBe(false);
  });
});

describe('CameraNavigator', () => {
  it('moves along the view at its speed, the target kept ahead', () => {
    const { controls, navigator } = setUp();
    navigator.keyDown(press('KeyW', 'w'));
    navigator.update(0.1);
    expect(xyz(controls.position)).toEqual(at(0, 0, -20));
    expect(xyz(controls.target)).toEqual(at(0, 0, -1020));
    // Shift held: four times faster; + doubles the speed.
    navigator.keyDown(press('ShiftLeft', 'Shift', { shiftKey: true }));
    navigator.keyDown(press('Equal', '+', { shiftKey: true }));
    navigator.update(0.1);
    expect(xyz(controls.position)).toEqual(at(0, 0, -180));
    navigator.keyUp(press('KeyW', 'w', { shiftKey: true }));
    navigator.update(0.1);
    expect(xyz(controls.position)).toEqual(at(0, 0, -180));
  });

  it('goes back through the views it jumped from', () => {
    const { controls, navigator } = setUp();
    navigator.save(1);
    navigator.jump({ position: [100, 0, 0], target: [100, 0, -100] });
    navigator.jump({ position: [200, 0, 0], target: [200, 0, -100] });
    navigator.recall(1);
    expect(xyz(controls.position)).toEqual(at(0, 0, 0));
    navigator.previous();
    expect(xyz(controls.position)).toEqual(at(200, 0, 0));
    navigator.previous();
    expect(xyz(controls.position)).toEqual(at(100, 0, 0));
    // Home without a `home`: the view at the first frame.
    navigator.home();
    expect(xyz(controls.target)).toEqual(at(0, 0, -500));
  });

  it('turns the view where the camera is in fly mode', () => {
    const { controls, navigator } = setUp({ lookSpeed: 0.15 });
    navigator.setFlyMode(true);
    expect(controls.enabled).toBe(false);
    // 600 px right at 0.15°/px: 90° to the right, from -Z to +X.
    navigator.look(600, 0);
    navigator.update(0.016);
    expect(xyz(controls.position)).toEqual(at(0, 0, 0));
    expect(xyz(controls.target, 3)).toEqual(at(1000, 0, 0, 3));
    navigator.keyDown(press('Escape', 'Escape'));
    expect(navigator.mode).toBe('orbit');
    expect(controls.enabled).toBe(true);
  });

  it('places a new target with the arrows, the camera staying put', () => {
    const { controls, navigator } = setUp();
    navigator.keyDown(press('KeyT', 't'));
    expect(navigator.mode).toBe('target');
    expect(xyz(navigator.marker)).toEqual(at(0, 0, -1000));
    // ↑ moves the marker forward, not the camera up.
    navigator.keyDown(press('ArrowUp', 'ArrowUp'));
    navigator.update(0.1);
    expect(xyz(navigator.marker)).toEqual(at(0, 0, -1020));
    expect(xyz(controls.position)).toEqual(at(0, 0, 0));
    navigator.keyUp(press('ArrowUp', 'ArrowUp'));
    navigator.keyDown(press('Enter', 'Enter'));
    expect(navigator.mode).toBe('orbit');
    expect(xyz(controls.target)).toEqual(at(0, 0, -1020));
    navigator.previous();
    expect(xyz(controls.target)).toEqual(at(0, 0, -500));
    // Esc leaves it as it was.
    navigator.setTargetMode(true);
    navigator.keyDown(press('Escape', 'Escape'));
    expect(xyz(controls.target)).toEqual(at(0, 0, -500));
  });

  it('levels the horizon and faces north about the up it is given', () => {
    // Z up, as over a globe where up is not the scene's.
    const up = new Vector3(0, 0, 1);
    const { camera, controls, navigator } = setUp({
      upAt: (_, out) => out.copy(up),
      northAt: (_, out) => out.set(0, 1, 0),
    });
    controls.setLookAt(0, 0, 0, 300, 0, 400);
    navigator.level();
    expect(xyz(controls.target)).toEqual(at(500, 0, 0));
    expect(xyz(camera.up)).toEqual(at(0, 0, 1));
    // 30° up, facing east: north keeps the 30°.
    controls.setLookAt(
      0,
      0,
      0,
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6),
    );
    navigator.faceNorth();
    expect(xyz(controls.target.clone().normalize())).toEqual(
      at(0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)),
    );
  });
});
