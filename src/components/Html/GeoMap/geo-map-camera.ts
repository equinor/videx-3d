import { createContext, useContext } from 'react';
import type { Vec2, Vec3 } from '../../../sdk/types/common';

/**
 * The camera and what it looks at, in the scene: a pose to return to.
 *
 * @group Components
 */
export type GeoMapHome = {
  position: Vec3;
  target: Vec3;
};

/**
 * What a `GeoMapCamera` offers its markers, for one the user drags: whether it can move the
 * camera, holding the map still while they drag, and what a drop does.
 */
export type GeoMapCameraHost = {
  /** whether a marker can be moved: the scene has controls to move, and the host allows it */
  canDrag: () => boolean;
  /** hold the map still, so a marker follows the pointer and not the camera (`true`), or let it follow again */
  freeze: (on: boolean) => void;
  /** a marker was dropped at scene X/Z: move the controls there, and tell the host */
  drop: (kind: 'camera' | 'target', at: Vec2) => void;
};

export const GeoMapCameraContext = createContext<GeoMapCameraHost | null>(null);

/** The enclosing `GeoMapCamera`, for a marker: throws outside one. */
export function useGeoMapCameraHost(hook: string) {
  const host = useContext(GeoMapCameraContext);
  if (!host) throw new Error(`${hook}: not inside a <GeoMapCamera>`);
  return host;
}
