import { Vec3 } from '../sdk';
// Type only: the manager imports the event NAMES from here, so a value import
// would close the cycle.
import type { CameraFlyPlan } from '../sdk/managers/CameraManager';

/**
 * CameraSetPositionEvent name
 */
export const cameraSetPositionEventType = 'camera-set-position' as const;
/**
 * CameraFocusAtPointEvent name
 */
export const cameraFocusAtPointEventType = 'camera-focus-point' as const;
/**
 * CameraLookAtEvent name
 */
export const cameraLookAtEventType = 'camera-look-at' as const;
/**
 * CameraFlyToEvent name
 */
export const cameraFlyToEventType = 'camera-fly-to' as const;

export interface CameraFocusAtPointEventDetails {
  point: Vec3;
  distance?: number;
  callback?: () => void;
}

export interface CameraLookAtEventDetails {
  /** where the camera goes */
  position: Vec3;
  /** what it points at */
  target: Vec3;
  /** animate there. Default true; false lands exactly, in one frame. */
  transition?: boolean;
  callback?: () => void;
}

export interface CameraFlyToEventDetails extends CameraFlyPlan {
  callback?: () => void;
}

/**
 * Set the camera at the specified position
 * @event
 */
export class CameraSetPositionEvent extends CustomEvent<Vec3> {
  constructor(detail: Vec3) {
    super(cameraSetPositionEventType, { detail });
  }
}

/**
 * Focus the camera at the specified point
 * @event
 */
export class CameraFocusAtPointEvent extends CustomEvent<CameraFocusAtPointEventDetails> {
  constructor(detail: CameraFocusAtPointEventDetails) {
    super(cameraFocusAtPointEventType, { detail });
  }
}

/**
 * Place the camera at a position looking at a target.
 *
 * ⭐ Unlike {@link CameraFocusAtPointEvent}, which keeps the current heading and
 * only flies closer, this states the whole pose — so it is repeatable, and with
 * `transition: false` it is deterministic.
 * @event
 */
export class CameraLookAtEvent extends CustomEvent<CameraLookAtEventDetails> {
  constructor(detail: CameraLookAtEventDetails) {
    super(cameraLookAtEventType, { detail });
  }
}

/**
 * Travel to a new view the long way round — pull back, swing across, come in.
 *
 * ⭐⭐ The leg structure is the point: `destination` may be a FUNCTION, which is
 * asked only once the camera has retreated. That is the window in which whatever
 * is being flown to can be torn down and rebuilt, out at arm's length, instead of
 * in front of the lens. See {@link CameraFlyPlan}.
 * @event
 */
export class CameraFlyToEvent extends CustomEvent<CameraFlyToEventDetails> {
  constructor(detail: CameraFlyToEventDetails) {
    super(cameraFlyToEventType, { detail });
  }
}

declare global {
  interface WindowEventMap {
    [cameraSetPositionEventType]: CameraSetPositionEvent;
    [cameraFocusAtPointEventType]: CameraFocusAtPointEvent;
    [cameraLookAtEventType]: CameraLookAtEvent;
    [cameraFlyToEventType]: CameraFlyToEvent;
  }
}
