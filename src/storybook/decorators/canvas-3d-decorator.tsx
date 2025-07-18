import { CameraControls, Environment } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import { cameraManager } from '../../sdk/managers/CameraManager'
import { PI2 } from '../../sdk/utils/trigonometry'

export const Canvas3dDecorator = (Story: any, { parameters }: any) => {
  const scale = parameters.scale || 100

  const initControls = useCallback((controls: CameraControls) => {
    cameraManager.setControls(controls)
    if (parameters.cameraTarget) cameraManager.setTarget(parameters.cameraTarget)
  }, [parameters.cameraTarget])

  useEffect(() => {
    if (cameraManager.controls && parameters.cameraTarget) {
      cameraManager.setTarget(parameters.cameraTarget)
    }
  }, [parameters.cameraTarget])

  return (
    <Canvas
      camera={{
        near: 0.1,
        far: 1000 * scale,
        position: parameters.cameraPosition || [-1 * scale, 1 * scale, -1 * scale],
        fov: 30,
      }}
      gl={{ logarithmicDepthBuffer: true, autoClear: !!parameters.autoClear, stencil: false, pixelRatio: parameters.pixelRatio || devicePixelRatio }}
      style={{
        backgroundColor: parameters.background || '#000',
        position: 'absolute',
        height: 'auto',
        bottom: 0,
        top: 0,
        left: 0,
        right: 0,
      }}
    >
      <ambientLight intensity={0.2} />
      <directionalLight
        castShadow
        position={[-1, 2, -3]}
        intensity={1.2}
      />

      <Environment
        preset='studio'
        environmentIntensity={1.}
        backgroundRotation={[0, PI2, 0]}
      />
      <Story />
      {/* <axesHelper args={[1000]} /> */}
      <CameraControls ref={initControls} makeDefault />
    </Canvas>
  )
}