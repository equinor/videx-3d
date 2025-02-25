import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, Group, Vector3 } from 'three'

/**
 * Props for CameraTargetMarker
 * @expand
 */
export type CameraTargetMarkerProps = {
  // radius in world units of the camera target marker
  radius?: number
  // opacity of the rendered marker
  opacity?: number,
  // color of the rendered marker
  color?: number | string | Color
  // fix/lock the position of the camera target marker to a specific position along the x-axis. Can be useful if you add multiple camera targets
  fixedX?: number
  // fix/lock the position of the camera target marker to a specific position along the y-axis. Can be useful if you add multiple camera targets
  fixedY?: number
  // fix/lock the position of the camera target marker to a specific position along the z-axis. Can be useful if you add multiple camera targets
  fixedZ?: number
  // render order
  renderOrder?: number
}

const pos = new Vector3()

/**
 * A simple component for indicating the current camera target.
 * 
 * @example
 * <CameraTargetMarker />
 * 
 * @group Components
 */
export const CameraTargetMarker = ({ radius = 3, opacity = 0.1, color, fixedX, fixedY, fixedZ, renderOrder = 1000 }: CameraTargetMarkerProps) => {
  const { controls } = useThree()
  const ref = useRef<Group>(null)

  useEffect(() => {
    function onUpdate() {
      const cameraControls = controls as unknown as CameraControls
      if (cameraControls && ref.current) {
        cameraControls.getTarget(pos)
        ref.current.position.set(fixedX || pos.x, fixedY || pos.y, fixedZ || pos.z)
        ref.current.visible = true
      } else if (ref.current) {
        ref.current.visible = false
      }
    }

    if (controls) {
      // @ts-expect-error not type declared
      controls.addEventListener('update', onUpdate)
    }

    onUpdate()

    return () => {
      if (controls) {
        // @ts-expect-error not type declared
        controls.removeEventListener('update', onUpdate)
      }
    }
  }, [controls, fixedX, fixedY, fixedZ])

  return (
    <group ref={ref} visible={false} renderOrder={renderOrder}>
      <mesh>
        <sphereGeometry args={[radius]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  )
}