import { useFrame } from '@react-three/fiber';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { Vec3 } from '../../../sdk/types/common';
import { DistanceContext } from '../../Distance/DistanceContext';
import { wellboreBounds } from './wellbore-bounds-defs';
import { wellboreBoundsDistance } from './wellbore-bounds-distance';

/**
 * WellboreBounds props
 * @expand
 */
export type WellboreBoundsProps = {
  id: string;
  fromMsl?: number;
  boundsSampleSize?: number;
  visible?: boolean;
  priority?: number;
  children?: ReactNode;
};

export type WellboreBoundingSphere = {
  center: Vec3;
  radius: number;
};

export type WellboreBoundsType = {
  main: WellboreBoundingSphere;
  sampled: WellboreBoundingSphere[];
};

const vec = new Vector3();

/**
 * This component is used to provide a `DistanceContext` for a `Wellbore`, which allow the use
 * of the `Distance` component to conditionally show/hide other components depending on the distance from the
 * wellbore to the camera.
 *
 * @example
 * <Wellbore id={wellboreId}>
 *   <WellboreBounds id={wellboreId}>
 *     <Trajectory />
 *   </WellboreBounds>
 * </Wellbore>
 *
 * @remarks
 * This component does not use the `WellboreContext` to retrieve the wellbore id, and must be provided as a prop.
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-wellborebounds--docs)
 * @see {@link Trajectory}
 * @see {@link Distance}
 * @see {@link DistanceContext}
 *
 * @group Components
 */
export const WellboreBounds = ({
  id,
  fromMsl,
  boundsSampleSize = 250,
  visible = false,
  priority = 0,
  children,
}: WellboreBoundsProps) => {
  const boundsRef = useRef<Object3D>(null!);

  const boundsGenerator = useGenerator<Float32Array>(wellboreBounds, priority);

  const [bounds, setBounds] = useState<WellboreBoundsType | null>(null);
  const currentDistanceRef = useMemo<{ current: number }>(
    () => ({ current: Infinity }),
    [],
  );
  // What the distance was last worked out from: bounds data, the bounds' world
  // matrix (and its inverse), and the camera's position and zoom.
  const seen = useMemo(
    () => ({
      spheres: null as Float32Array | null,
      world: new Float64Array(16),
      inverse: new Matrix4(),
      eye: new Float64Array(4).fill(NaN),
    }),
    [],
  );

  useEffect(() => {
    if (boundsGenerator) {
      boundsGenerator(id, fromMsl, boundsSampleSize).then(boundsData => {
        if (boundsData) {
          const generatedBounds: WellboreBoundsType = {
            main: {
              center: [boundsData[0], boundsData[1], boundsData[2]],
              radius: boundsData[3],
            },
            sampled: [],
          };

          for (let i = 4; i < boundsData.length; i += 4) {
            generatedBounds.sampled.push({
              center: [boundsData[i], boundsData[i + 1], boundsData[i + 2]],
              radius: boundsData[i + 3],
            });
          }
          seen.spheres = boundsData;
          seen.eye[0] = NaN;
          setBounds(generatedBounds);
        }
      });
    }
  }, [id, boundsGenerator, fromMsl, boundsSampleSize, seen]);

  // ⭐ From the world matrix the renderer already updated (a frame behind a parent
  // that moved this frame), not `worldToLocal`, which recomputes every ancestor's
  // matrix: per wellbore, per frame, that was most of this hook's cost.
  useFrame(({ camera }) => {
    const spheres = seen.spheres;
    const object = boundsRef.current;
    if (!spheres || !object) return;
    const world = object.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) {
      if (world[i] !== seen.world[i]) {
        moved = true;
        break;
      }
    }
    if (moved) {
      seen.world.set(world);
      seen.inverse.copy(object.matrixWorld).invert();
    }
    const eye = camera.position;
    const zoom = (camera as PerspectiveCamera).zoom;
    if (
      !moved &&
      eye.x === seen.eye[0] &&
      eye.y === seen.eye[1] &&
      eye.z === seen.eye[2] &&
      zoom === seen.eye[3]
    ) {
      return;
    }
    seen.eye[0] = eye.x;
    seen.eye[1] = eye.y;
    seen.eye[2] = eye.z;
    seen.eye[3] = zoom;
    vec.copy(eye).applyMatrix4(seen.inverse);
    currentDistanceRef.current = wellboreBoundsDistance(
      spheres,
      vec.x,
      vec.y,
      vec.z,
      zoom,
    );
  });

  return (
    <object3D name="wellbore-bounds" ref={boundsRef}>
      <DistanceContext.Provider value={currentDistanceRef}>
        {children}
      </DistanceContext.Provider>
      {
        // for debug purposes
        visible && bounds && (
          <mesh name="wellbore-bounds-debug" position={bounds.main.center}>
            <sphereGeometry args={[bounds.main.radius, 32, 16]} />
            <meshBasicMaterial
              color="green"
              wireframe
              transparent
              opacity={0.1}
            />
          </mesh>
        )
      }
      {visible &&
        bounds &&
        bounds.sampled.map((s, i) => (
          <mesh name="wellbore-bounds-debug" key={i} position={s.center}>
            <sphereGeometry args={[s.radius, 16, 8]} />
            <meshBasicMaterial
              color="gray"
              wireframe
              transparent
              opacity={0.25}
            />
          </mesh>
        ))}
    </object3D>
  );
};
