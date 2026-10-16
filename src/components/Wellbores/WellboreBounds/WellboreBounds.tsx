import { useFrame } from '@react-three/fiber';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { Vec3 } from '../../../sdk/types/common';
import {
  DistanceContext,
  DistanceContextProps,
} from '../../Distance/DistanceContext';
import { wellboreBounds } from './wellbore-bounds-defs';
import {
  prepareWellboreBounds,
  wellboreBoundsDistance,
} from './wellbore-bounds-distance';

/**
 * WellboreBounds props
 * @expand
 */
export type WellboreBoundsProps = {
  id: string;
  fromMsl?: number;
  /**
   * How far the simplified trajectory the distance is measured to may stray from the
   * real one, in metres. Default 100.
   */
  boundsTolerance?: number;
  /**
   * Distances below this are exact (within `boundsTolerance`); beyond it a cheaper value
   * that is never more than the true distance and never less than this. Default 3000.
   */
  exactWithin?: number;
  /** Subtracted from the distance, as if the wellbore were this thick, in metres. Default 0. */
  boundsPadding?: number;
  visible?: boolean;
  priority?: number;
  children?: ReactNode;
};

export type WellboreBoundingSphere = {
  center: Vec3;
  radius: number;
};

export type WellboreBoundsType = {
  /** encloses the whole trajectory */
  main: WellboreBoundingSphere;
  /** the trajectory, simplified to within `boundsTolerance` */
  chain: Vec3[];
};

const vec = new Vector3();

/**
 * This component is used to provide a `DistanceContext` for a `Wellbore`, which allow the use
 * of the `Distance` component to conditionally show/hide other components depending on the distance from the
 * wellbore to the camera.
 *
 * The distance is measured to the trajectory itself (simplified to within `boundsTolerance`)
 * up to `exactWithin`; further out it costs one square root per wellbore.
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
  boundsTolerance = 100,
  exactWithin = 3000,
  boundsPadding = 0,
  visible = false,
  priority = 0,
  children,
}: WellboreBoundsProps) => {
  const boundsRef = useRef<Object3D>(null!);

  const boundsGenerator = useGenerator<Float32Array>(wellboreBounds, priority);

  const [bounds, setBounds] = useState<WellboreBoundsType | null>(null);
  const currentDistanceRef = useMemo<DistanceContextProps>(
    () => ({ current: Infinity, tolerance: 0 }),
    [],
  );
  // What the distance was last worked out from: bounds data, the bounds' world
  // matrix (and its inverse), and the camera's position and zoom.
  const seen = useMemo(
    () => ({
      bounds: null as Float64Array | null,
      world: new Float64Array(16),
      inverse: new Matrix4(),
      eye: new Float64Array(4).fill(NaN),
    }),
    [],
  );

  useEffect(() => {
    if (boundsGenerator) {
      boundsGenerator(id, fromMsl, boundsTolerance).then(boundsData => {
        if (boundsData) {
          const chain: Vec3[] = [];
          for (let i = 4; i + 2 < boundsData.length; i += 3) {
            chain.push([boundsData[i], boundsData[i + 1], boundsData[i + 2]]);
          }
          seen.bounds = prepareWellboreBounds(boundsData);
          seen.eye[0] = NaN;
          setBounds({
            main: {
              center: [boundsData[0], boundsData[1], boundsData[2]],
              radius: boundsData[3],
            },
            chain,
          });
        }
      });
    }
  }, [id, boundsGenerator, fromMsl, boundsTolerance, seen]);

  useEffect(() => {
    seen.eye[0] = NaN;
  }, [exactWithin, boundsPadding, seen]);

  // ⭐ From the world matrix the renderer already updated (a frame behind a parent
  // that moved this frame), not `worldToLocal`, which recomputes every ancestor's
  // matrix: per wellbore, per frame, that was most of this hook's cost.
  useFrame(({ camera }) => {
    const data = seen.bounds;
    const object = boundsRef.current;
    if (!data || !object) return;
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
      data,
      vec.x,
      vec.y,
      vec.z,
      zoom,
      exactWithin,
      boundsPadding,
    );
    currentDistanceRef.tolerance = boundsTolerance / zoom;
  });

  const chainGeometry = useMemo(() => {
    if (!visible || !bounds || bounds.chain.length < 2) return null;
    const { chain } = bounds;
    const positions = new Float32Array((chain.length - 1) * 6);
    for (let i = 1; i < chain.length; i++) {
      positions.set(chain[i - 1], (i - 1) * 6);
      positions.set(chain[i], (i - 1) * 6 + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return geometry;
  }, [visible, bounds]);

  useEffect(() => () => chainGeometry?.dispose(), [chainGeometry]);

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
      {chainGeometry && (
        <lineSegments name="wellbore-bounds-debug" geometry={chainGeometry}>
          <lineBasicMaterial color="yellow" />
        </lineSegments>
      )}
    </object3D>
  );
};
