import { CameraControls, Environment } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { Color, NoToneMapping } from 'three';
import { PI2 } from '../../sdk';
import { CameraManager } from '../../sdk/managers/CameraManager';

export const Canvas3dDecorator = (Story: any, { parameters }: any) => {
  const scale = parameters.scale || 100;
  const cameraManager = useRef(new CameraManager());

  const initControls = useCallback(
    (controls: CameraControls) => {
      if (cameraManager.current) {
        cameraManager.current.setControls(controls);
        if (parameters.cameraTarget)
          cameraManager.current.setTarget(parameters.cameraTarget);
      }
    },
    [parameters.cameraTarget],
  );

  useEffect(() => {
    if (cameraManager.current.controls && parameters.cameraTarget) {
      cameraManager.current.setTarget(parameters.cameraTarget);
    }
  }, [parameters.cameraTarget]);

  useEffect(
    () => () => {
      if (cameraManager.current) {
        cameraManager.current.dispose();
      }
    },
    [],
  );

  return (
    <Canvas
      camera={{
        near: 0.1,
        far: 500 * scale,
        position: parameters.cameraPosition || [
          -1 * scale,
          1 * scale,
          -1 * scale,
        ],
        fov: 60,
      }}
      dpr={Math.min(2, parameters.pixelRatio || devicePixelRatio)}
      gl={{
        logarithmicDepthBuffer: true,
        autoClear: !!parameters.autoClear,
        antialias: false,
        powerPreference: 'high-performance',
        toneMapping: NoToneMapping,
      }}
      style={{
        backgroundColor: parameters.background || '#000',
        position: 'absolute',
        height: 'auto',
        bottom: 0,
        top: 0,
        left: 0,
        right: 0,
      }}
      onCreated={({ scene }) => {
        if (parameters.background) {
          scene.background = new Color(parameters.background);
        }
      }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight castShadow position={[-1, 2, -3]} intensity={3.2} />
      <Environment
        preset="studio"
        environmentIntensity={1}
        backgroundRotation={[0, PI2, 0]}
      />

      <Story />
      {/* <axesHelper args={[1000]} /> */}
      <CameraControls ref={initControls} makeDefault />
    </Canvas>
  );
};
