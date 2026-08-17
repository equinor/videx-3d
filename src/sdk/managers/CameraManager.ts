import { CameraControls } from '@react-three/drei';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  cameraFocusAtPointEventType,
  cameraLookAtEventType,
  cameraSetPositionEventType,
} from '../../events/camera-events';
import { Vec3 } from '../types/common';

const cameraTarget = new Vector3();
const cameraPosition = new Vector3();
const direction = new Vector3();
const v1 = new Vector3();
const v2 = new Vector3();

/**
 * Closest a fly-to may end up, as a share of the distance asked for. Relative
 * rather than absolute because this runs at anything from metres to tens of km.
 */
const MIN_FOCUS_FRACTION = 0.05;

/**
 * Take the shortest way round to the camera's new heading.
 *
 * ⭐ It has to run AFTER whatever set the destination. `normalizeRotations` wraps
 * the DESTINATION angle into (-π, π] and then shifts the CURRENT one by whole
 * turns to land within π of it — so calling it first normalizes the angle that is
 * about to be overwritten, and achieves nothing. Meanwhile the current azimuth
 * accumulates as the user orbits (two turns of dragging is ~12.6 rad), so without
 * this the camera unwinds those turns on its way to the target.
 *
 * Shifting the current angle by whole turns is visually identical, so it is safe
 * to do while a transition is already running.
 */
function normalizeRotations(controls: CameraControls) {
  controls.normalizeRotations();
}

async function focusAtPoint(
  point: Vec3,
  distance: number,
  controls: CameraControls,
) {
  cameraTarget.set(...point);
  controls.getPosition(cameraPosition);
  direction.subVectors(cameraTarget, cameraPosition);
  // Never pull back farther than we already are, than was asked for, or than the
  // distance to the point itself — flying to something nearby should not zoom out.
  const pullBack = Math.min(
    controls.distance,
    distance,
    direction.length() * 1.5,
  );
  // ⚠️ ... but clicking what the camera is already looking at makes that distance
  // zero, which would put it inside the geometry.
  const useDistance = Math.max(
    pullBack,
    controls.minDistance,
    distance * MIN_FOCUS_FRACTION,
  );
  direction.normalize();
  cameraPosition.copy(cameraTarget).addScaledVector(direction, -useDistance);

  const transition = controls.setLookAt(
    cameraPosition.x,
    cameraPosition.y,
    cameraPosition.z,
    cameraTarget.x,
    cameraTarget.y,
    cameraTarget.z,
    true,
  );
  normalizeRotations(controls);
  return transition;
}

function setPosition(point: Vec3, controls: CameraControls) {
  v1.set(...point);

  controls.getTarget(cameraTarget);

  v2.subVectors(cameraTarget, v1);

  controls.getPosition(cameraPosition);
  cameraPosition.sub(v2);
  controls.setPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);
  controls.setTarget(v1.x, v1.y, v1.z);
  normalizeRotations(controls);
}

export class CameraManager {
  controls: CameraControls | null = null;
  removeEventlisteners: (() => void) | null = null;

  constructor() {
    this.setControls = this.setControls.bind(this);
  }
  private addEventListeners() {
    const onSetPosition = (event: any) => {
      if (this.controls) {
        setPosition(event.detail as Vec3, this.controls);
      }
    };

    const onFocusPoint = (event: any) => {
      if (this.controls) {
        const callback = event.detail.callback;
        focusAtPoint(
          event.detail.point as Vec3,
          event.detail.distance || 200,
          this.controls,
        ).then(() => {
          if (callback) callback();
        });
      }
    };

    const onLookAt = (event: any) => {
      const detail = event.detail;
      this.lookAt(detail).then(() => {
        if (detail.callback) detail.callback();
      });
    };

    addEventListener(cameraSetPositionEventType, onSetPosition);
    addEventListener(cameraFocusAtPointEventType, onFocusPoint);
    addEventListener(cameraLookAtEventType, onLookAt);

    this.removeEventlisteners = () => {
      removeEventListener(cameraSetPositionEventType, onSetPosition);
      removeEventListener(cameraFocusAtPointEventType, onFocusPoint);
      removeEventListener(cameraLookAtEventType, onLookAt);
    };
  }

  /**
   * Put the camera at `position` looking at `target`.
   *
   * @returns a promise that resolves when the move is done — immediately when
   *   `transition` is false
   */
  async lookAt(options: {
    position: Vec3;
    target: Vec3;
    transition?: boolean;
  }): Promise<void> {
    const controls = this.controls;
    if (!controls) return;
    const [px, py, pz] = options.position;
    const [tx, ty, tz] = options.target;
    const transition = controls.setLookAt(
      px,
      py,
      pz,
      tx,
      ty,
      tz,
      options.transition !== false,
    );
    normalizeRotations(controls);
    await transition;
  }

  /**
   * Place the camera in SPHERICAL terms around a target.
   *
   * ⭐ Degrees and metres, because that is the form a pose can be written down in
   * and reproduced — a position vector cannot be reasoned about at a glance, which
   * is what makes framing a view by hand a matter of trial and error.
   *
   * `azimuth` is measured from +X toward +Z, `polar` from straight down (0) to the
   * horizon (90) and on to straight up (180).
   */
  async orbit(options: {
    azimuth: number;
    polar: number;
    distance: number;
    target?: Vec3;
    transition?: boolean;
  }): Promise<void> {
    const controls = this.controls;
    if (!controls) return;
    if (options.target) cameraTarget.set(...options.target);
    else controls.getTarget(cameraTarget);

    const azimuth = (options.azimuth * Math.PI) / 180;
    const polar = (options.polar * Math.PI) / 180;
    const sinPolar = Math.sin(polar);
    const position: Vec3 = [
      cameraTarget.x + options.distance * sinPolar * Math.cos(azimuth),
      cameraTarget.y + options.distance * Math.cos(polar),
      cameraTarget.z + options.distance * sinPolar * Math.sin(azimuth),
    ];
    return this.lookAt({
      position,
      target: [cameraTarget.x, cameraTarget.y, cameraTarget.z],
      transition: options.transition,
    });
  }

  /**
   * Fit an axis-aligned box to the view.
   *
   * The distance is derived from the box's bounding sphere against the camera's
   * own vertical fov and aspect, so the whole box is inside the frustum whichever
   * way it is being looked at.
   */
  async frame(
    box: { min: Vec3; max: Vec3 },
    options: {
      azimuth?: number;
      polar?: number;
      padding?: number;
      transition?: boolean;
    } = {},
  ): Promise<void> {
    const controls = this.controls;
    if (!controls) return;
    const target: Vec3 = [
      (box.min[0] + box.max[0]) * 0.5,
      (box.min[1] + box.max[1]) * 0.5,
      (box.min[2] + box.max[2]) * 0.5,
    ];
    const radius =
      0.5 *
      Math.hypot(
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
    const camera = controls.camera as PerspectiveCamera;
    const fov = ((camera.fov ?? 60) * Math.PI) / 180;
    // The horizontal half-angle is the binding one on a narrow window.
    const halfAngle = Math.min(
      fov * 0.5,
      Math.atan(Math.tan(fov * 0.5) * (camera.aspect ?? 1)),
    );
    const distance = (radius / Math.sin(halfAngle)) * (options.padding ?? 1.1);

    const current = this.pose();
    return this.orbit({
      azimuth: options.azimuth ?? current?.azimuth ?? 225,
      polar: options.polar ?? current?.polar ?? 60,
      distance,
      target,
      transition: options.transition,
    });
  }

  /**
   * Where the camera is now, in the form {@link CameraManager.orbit} takes.
   *
   * ⭐ Degrees, so a view worth keeping can be read off and pasted straight back
   * into a story's `parameters` or into another `orbit` call.
   */
  pose(): {
    position: Vec3;
    target: Vec3;
    azimuth: number;
    polar: number;
    distance: number;
  } | null {
    const controls = this.controls;
    if (!controls) return null;
    controls.getPosition(cameraPosition);
    controls.getTarget(cameraTarget);
    direction.subVectors(cameraPosition, cameraTarget);
    const distance = direction.length();
    return {
      position: [cameraPosition.x, cameraPosition.y, cameraPosition.z],
      target: [cameraTarget.x, cameraTarget.y, cameraTarget.z],
      azimuth: (Math.atan2(direction.z, direction.x) * 180) / Math.PI,
      polar:
        distance > 0 ? (Math.acos(direction.y / distance) * 180) / Math.PI : 0,
      distance,
    };
  }

  /** Resolves once the controls have come to rest. */
  settled(): Promise<void> {
    const controls = this.controls;
    if (!controls) return Promise.resolve();
    return new Promise(resolve => {
      const check = () => {
        if (!controls.active) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  async setTarget(target: Vec3) {
    const controls = this.controls;
    if (controls) {
      cameraTarget.set(...target);
      controls.getPosition(cameraPosition);
      direction.subVectors(cameraTarget, cameraPosition);
      direction.normalize();
      const transition = controls.setLookAt(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z,
        cameraTarget.x,
        cameraTarget.y,
        cameraTarget.z,
        true,
      );
      normalizeRotations(controls);
      return transition;
    }
    return null;
  }

  setControls(controls: CameraControls) {
    this.controls = controls;
    if (this.removeEventlisteners) {
      this.removeEventlisteners();
    }
    this.addEventListeners();
  }

  dispose() {
    this.controls = null;
    if (this.removeEventlisteners) {
      this.removeEventlisteners();
    }
  }
}
