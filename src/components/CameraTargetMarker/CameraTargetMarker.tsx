import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, Group, Vector3 } from 'three'

/**
 * Props for CameraTargetMarker
 * @expand
 */
export type CameraTargetMarkerProps = {
  radius?: number
  opacity?: number,
  color?: number | string | Color
  fixedX?: number
  fixedY?: number
  fixedZ?: number
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