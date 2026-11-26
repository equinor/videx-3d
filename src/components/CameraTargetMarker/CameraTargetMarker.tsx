import { useThree } from '@react-three/fiber';
import { PropsWithChildren, useEffect, useMemo, useRef } from 'react';
import { Color, Group, Vector3 } from 'three';
import { createLayers, LAYERS } from '../../layers/layers';

/**
 * Props for CameraTargetMarker
 * @expand
 */
export type CameraTargetMarkerProps = {
  /** The sphere's radius, in world units. Default 3. */
  radius?: number;
  /** The sphere's opacity (0..1). Default 0.1. */
  opacity?: number;
  /** The sphere's colour. */
  color?: number | string | Color;
  /** Keep the marker at this x, whatever the target's: on a line or a plane with the others. */
  fixedX?: number;
  /** Keep the marker at this y, whatever the target's: at a level, say. */
  fixedY?: number;
  /** Keep the marker at this z, whatever the target's. */
  fixedZ?: number;
  /** The marker's render order. */
  renderOrder?: number;
  /** Whether the sphere is hidden behind what is in front of it. Default false: drawn over the scene. */
  depthTest?: boolean;
  /** Whether the sphere writes depth. Default false. */
  depthWrite?: boolean;
};

const pos = new Vector3();

// The default controls' target: drei's `CameraControls` hands it out (`getTarget`), three's
// `OrbitControls`, `MapControls` and their kind keep it as `target`.
type TargetControls = {
  getTarget?: (out: Vector3) => Vector3;
  target?: unknown;
};

function controlsTarget(controls: unknown, out: Vector3) {
  const c = controls as TargetControls | null;
  if (typeof c?.getTarget === 'function') {
    c.getTarget(out);
    return true;
  }
  if (c?.target instanceof Vector3) {
    out.copy(c.target);
    return true;
  }
  return false;
}

/**
 * A marker at the camera's target: a see-through sphere that follows the target of the
 * scene's default camera controls as the view moves: drei's `CameraControls`, or controls
 * with a `target` such as `OrbitControls` and `MapControls`. Without such controls it is
 * hidden. It is drawn over the scene, never hidden behind it, unless `depthTest` is on. Lock
 * it on an axis (`fixedX`, `fixedY`, `fixedZ`) to keep it to a line or a plane, a level, say.
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
      if (!ref.current) return;
      if (controlsTarget(controls, pos)) {
        ref.current.position.set(
          fixedX ?? pos.x,
          fixedY ?? pos.y,
          fixedZ ?? pos.z,
        );
        ref.current.visible = true;
      } else {
        ref.current.visible = false;
      }
    }

    // CameraControls says 'update' as it moves, OrbitControls and its kind 'change'.
    if (controls) {
      // @ts-expect-error not type declared
      controls.addEventListener('update', onUpdate);
      // @ts-expect-error not type declared
      controls.addEventListener('change', onUpdate);
    }

    onUpdate();

    return () => {
      if (controls) {
        // @ts-expect-error not type declared
        controls.removeEventListener('update', onUpdate);
        // @ts-expect-error not type declared
        controls.removeEventListener('change', onUpdate);
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
