import { useFrame } from '@react-three/fiber';
import { PropsWithChildren, useLayoutEffect, useRef } from 'react';
import { Group, Matrix4 } from 'three';
import type { GeoFramePlacement } from '../../sdk/projection/geo-frame';
import {
  geoFrameMatrix,
  setObjectMatrix,
} from '../../sdk/projection/place-frame';
import type { WorldState } from '../World/world-context';

const placing = new Matrix4();

/**
 * Its children on the `World`'s Earth by `placement` (`placeGeoPoint`, `placeMapPoint`): on
 * its globe, upright, and `altitude` up there, placed again only once the placement or the
 * globe changes (a switch of the anchor). Shared by `Wgs84Position` and `UtmPosition` with no
 * `UtmArea` around them.
 *
 * @internal
 */
export const EarthPlacement = ({
  world,
  placement,
  altitude,
  children,
}: PropsWithChildren<{
  world: WorldState;
  placement: GeoFramePlacement;
  altitude: number;
}>) => {
  const group = useRef<Group>(null);
  // What it was last placed by.
  const placed = useRef<{
    placement: GeoFramePlacement | null;
    version: number;
  }>({ placement: null, version: -1 });
  const place = () => {
    const object = group.current;
    const { globe } = world;
    const last = placed.current;
    if (
      !object ||
      (last.placement === placement && last.version === globe.version)
    )
      return;
    last.placement = placement;
    last.version = globe.version;
    setObjectMatrix(object, geoFrameMatrix(placement, globe, placing));
  };
  // Before its first frame is drawn, and each frame after, as the World's globe may change.
  useLayoutEffect(place);
  useFrame(place);

  return (
    <group ref={group}>
      <group position={[0, altitude, 0]}>{children}</group>
    </group>
  );
};
