import { Vec3 } from '../sdk';

/**
 * CameraSetPositionEvent name
 */
export const cameraSetPositionEventType = 'camera-set-position' as const;
/**
 * CameraFocusAtPointEvent name
 */
export const cameraFocusAtPointEventType = 'camera-focus-point' as const;

export interface CameraFocusAtPointEventDetails {
  point: Vec3;
  distance?: number;
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

declare global {
  interface WindowEventMap {
    [cameraSetPositionEventType]: CameraSetPositionEvent;
    [cameraFocusAtPointEventType]: CameraFocusAtPointEvent;
  }
}
