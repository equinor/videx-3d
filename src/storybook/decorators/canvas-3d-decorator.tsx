import { CameraControls, Environment } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import { CameraManager } from '../../sdk/managers/CameraManager'
import { PI2 } from '../../sdk/utils/trigonometry'

export const Canvas3dDecorator = (Story: any, { parameters }: any) => {
  const scale = parameters.scale || 100
  const cameraManager = useRef(new CameraManager())

  const initControls = useCallback((controls: CameraControls) => {
    if (cameraManager.current) {
      cameraManager.current.setControls(controls)
      if (parameters.cameraTarget) cameraManager.current.setTarget(parameters.cameraTarget)
    }
  }, [parameters.cameraTarget])

  useEffect(() => {
    if (cameraManager.current.controls && parameters.cameraTarget) {
      cameraManager.current.setTarget(parameters.cameraTarget)
    }
  }, [parameters.cameraTarget])

  useEffect(() => () => {
    if (cameraManager.current) {
      cameraManager.current.dispose()
    }
  }, [])

  return (
    <Canvas
      camera={{
        near: 0.1,
        far: 1000 * scale,
        position: parameters.cameraPosition || [-1 * scale, 1 * scale, -1 * scale],
        fov: 30,
      }}
      dpr={parameters.pixelRatio || devicePixelRatio}
      gl={{ logarithmicDepthBuffer: true, autoClear: !!parameters.autoClear, stencil: false, antialias: true }}
      style={{
        backgroundColor: parameters.background || '#000',
        position: 'absolute',
        height: 'auto',
        bottom: 0,
        top: 0,
        left: 0,
        right: 0,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(parameters.background)
        gl.setClearAlpha(1)
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