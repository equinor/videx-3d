import { useFrame } from '@react-three/fiber';
import { ReactNode, useMemo, useRef } from 'react';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { BoundsShape, distanceToBounds } from '../../sdk';
import { DistanceContext } from './DistanceContext';

// Shared scratch — R3F runs frame callbacks sequentially, so reuse is safe.
const _cam = new Vector3();

/**
 * Bounds props
 * @expand
 */
export type BoundsProps = BoundsShape & {
  children?: ReactNode;
};

/**
 * A generic provider of the {@link DistanceContext}, so the {@link Distance} component
 * (and anything else reading the context) can be used for ANY object — not just
 * wellbores. Supply a bounding `sphere`, `box` or a single `position` and `Bounds`
 * publishes the camera's distance to it each frame, measured in this component's local
 * space and divided by `camera.zoom` (matching {@link WellboreBounds}, so `Distance`'s
 * `min`/`max` behave identically).
 *
 * If more than one shape is provided the precedence is `sphere` > `box` > `position`.
 * With none, the distance stays `Infinity` (so distance-gated children remain hidden).
 *
 * @example
 * <Bounds sphere={{ center: [0, 0, 0], radius: 5 }}>
 *   <Distance min={0} max={50}>
 *     <mesh>
 *       <sphereGeometry />
 *       <meshStandardMaterial color="red" />
 *     </mesh>
 *   </Distance>
 * </Bounds>
 *
 * @see {@link Distance}
 * @see {@link DistanceContext}
 * @see {@link WellboreBounds}
 *
 * @group Components
 */
export const Bounds = ({ sphere, box, position, children }: BoundsProps) => {
  const ref = useRef<Group>(null!);
  const currentDistanceRef = useMemo<{ current: number }>(
    () => ({ current: Infinity }),
    [],
  );

  useFrame(({ camera }) => {
    if (!ref.current) return;

    // Camera position in this component's local frame, so the supplied bounds are
    // interpreted in local coordinates (respecting parent transforms).
    _cam.copy(camera.position);
    ref.current.worldToLocal(_cam);

    // Divide by zoom so orthographic zoom scales the effective distance (as apparent
    // size grows), keeping the same min/max semantics as WellboreBounds. The distance
    // math is a pure, three.js-free helper (see distanceToBounds) so it is unit tested.
    const zoom = (camera as PerspectiveCamera).zoom || 1;
    currentDistanceRef.current =
      distanceToBounds([_cam.x, _cam.y, _cam.z], { sphere, box, position }) /
      zoom;
  });

  return (
    <group ref={ref}>
      <DistanceContext.Provider value={currentDistanceRef}>
        {children}
      </DistanceContext.Provider>
    </group>
  );
};
