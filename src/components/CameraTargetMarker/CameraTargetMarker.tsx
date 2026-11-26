import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { PropsWithChildren, useEffect, useMemo, useRef } from 'react';
import { Color, Group, Vector3 } from 'three';
import { createLayers, LAYERS } from '../../layers/layers';

/**
 * Props for CameraTargetMarker
 * @expand
 */
export type CameraTargetMarkerProps = {
  // radius in world units of the camera target marker
  radius?: number;
  // opacity of the rendered marker
  opacity?: number;
  // color of the rendered marker
  color?: number | string | Color;
  // fix/lock the position of the camera target marker to a specific position along the x-axis. Can be useful if you add multiple camera targets
  fixedX?: number;
  // fix/lock the position of the camera target marker to a specific position along the y-axis. Can be useful if you add multiple camera targets
  fixedY?: number;
  // fix/lock the position of the camera target marker to a specific position along the z-axis. Can be useful if you add multiple camera targets
  fixedZ?: number;
  // render order
  renderOrder?: number;
  // depth test
  depthTest?: boolean;
  // depth write
  depthWrite?: boolean;
};

const pos = new Vector3();

/**
 * A marker at the camera's target: a see-through sphere that follows the target of the
 * scene's camera controls (drei's `CameraControls`, set as the default controls) as the view
 * moves, and is hidden without them. It is drawn over the scene, never hidden behind it,
 * unless `depthTest` is on. Lock it on an axis (`fixedX`, `fixedY`, `fixedZ`) to keep it to
 * a line or a plane, a level, say.
 *
 * Pass a child to draw an object of your own instead of the sphere. `radius`, `color`,
 * `opacity`, `depthTest` and `depthWrite` then do nothing: its material is yours to set up.
 *
 * @example
 * <CameraTargetMarker />
 *
 * @group Components
 */
export const CameraTargetMarker = ({
  radius = 3,
  opacity = 0.1,
  color,
  fixedX,
  fixedY,
  fixedZ,
  renderOrder,
  depthTest = false,
  depthWrite = false,
  children,
}: PropsWithChildren<CameraTargetMarkerProps>) => {
  const controls = useThree(state => state.controls);
  const ref = useRef<Group>(null);

  useEffect(() => {
    function onUpdate() {
      const cameraControls = controls as unknown as CameraControls;
      if (cameraControls && ref.current) {
        cameraControls.getTarget(pos);
        ref.current.position.set(
          fixedX || pos.x,
          fixedY || pos.y,
          fixedZ || pos.z,
        );
        ref.current.visible = true;
      } else if (ref.current) {
        ref.current.visible = false;
      }
    }

    if (controls) {
      // @ts-expect-error not type declared
      controls.addEventListener('update', onUpdate);
    }

    onUpdate();

    return () => {
      if (controls) {
        // @ts-expect-error not type declared
        controls.removeEventListener('update', onUpdate);
      }
    };
  }, [controls, fixedX, fixedY, fixedZ]);

  const layers = useMemo(() => {
    return createLayers(LAYERS.OVERLAY);
  }, []);

  return (
    <group ref={ref} visible={false} renderOrder={renderOrder}>
      {!!children && children}
      {!children && (
        <mesh layers={layers}>
          <sphereGeometry args={[radius]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={opacity}
            depthTest={depthTest}
            depthWrite={depthWrite}
          />
        </mesh>
      )}
    </group>
  );
};
