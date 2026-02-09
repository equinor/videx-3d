import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { PropsWithChildren, useEffect, useRef } from 'react';
import { Color, Group, Vector3 } from 'three';

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
 * A simple component for indicating the current camera target.
 *
 * NOTE: You may pass a child node to this component if you want to use a custom object representing the camera target. If you do, you'll have to
 * manage the material settings yourself, as depthTest and depthWrite only have an effect on the default object's material.
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

  return (
    <group ref={ref} visible={false} renderOrder={renderOrder}>
      {!!children && children}
      {!children && (
        <mesh>
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
