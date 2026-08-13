import { CameraControls } from '@react-three/drei';
import { Vector3 } from 'three';
import {
  cameraFocusAtPointEventType,
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

    addEventListener(cameraSetPositionEventType, onSetPosition);
    addEventListener(cameraFocusAtPointEventType, onFocusPoint);

    this.removeEventlisteners = () => {
      removeEventListener(cameraSetPositionEventType, onSetPosition);
      removeEventListener(cameraFocusAtPointEventType, onFocusPoint);
    };
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
