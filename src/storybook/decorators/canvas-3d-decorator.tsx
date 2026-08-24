import { CameraControls, Environment } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useState } from 'react';
import { Color, NoToneMapping } from 'three';
import { PI2 } from '../../sdk';
import { CameraManager } from '../../sdk/managers/CameraManager';
import {
  getStoryArgs,
  registerVidex3d,
  sceneBounds,
  setStoryArgs,
  waitForStableScene,
} from '../debug/videx3d';

/**
 * Publishes `window.videx3d` for Storybook-driven inspection.
 *
 * ⚠️ Must live INSIDE the canvas — the scene only exists here, and `ready()` and
 * `bounds()` are both about the scene rather than the camera.
 */
const Videx3dBridge = ({ manager }: { manager: CameraManager }) => {
  const scene = useThree(state => state.scene);
  useEffect(
    () =>
      registerVidex3d({
        camera: manager,
        scene,
        ready: options => waitForStableScene(scene, options),
        bounds: () => sceneBounds(scene),
        setArgs: setStoryArgs,
        getArgs: getStoryArgs,
      }),
    [scene, manager],
  );
  return null;
};

export const Canvas3dDecorator = (Story: any, { parameters }: any) => {
  const scale = parameters.scale || 100;
  // Lazy initialiser, NOT `useRef(new CameraManager())` — that argument is
  // evaluated on every render and only the first result is ever kept.
  const [cameraManager] = useState(() => new CameraManager());

  const initControls = useCallback(
    (controls: CameraControls | null) => {
      cameraManager.setControls(controls);
      if (controls && parameters.cameraTarget)
        cameraManager.setTarget(parameters.cameraTarget);
    },
    [cameraManager, parameters.cameraTarget],
  );

  useEffect(() => {
    if (cameraManager.controls && parameters.cameraTarget) {
      cameraManager.setTarget(parameters.cameraTarget);
    }
  }, [cameraManager, parameters.cameraTarget]);

  useEffect(() => () => cameraManager.dispose(), [cameraManager]);

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
        antialias: !parameters.msaaDisabled,
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
      <directionalLight position={[-1, 2, -3]} intensity={1.2} />
      {/* ⚠️ Served from `public/`, NOT drei's `preset`. A preset fetches its HDR
          from raw.githubusercontent.com at runtime, and a 429 or an offline
          machine throws inside <Canvas>, replacing every 3D story with an error
          boundary. */}
      <Environment
        files="/hdri/studio_small_03_1k.hdr"
        environmentIntensity={0.5}
        backgroundRotation={[0, PI2, 0]}
      />

      <Story />
      {/* <axesHelper args={[1000]} /> */}
      <Videx3dBridge manager={cameraManager} />
      <CameraControls ref={initControls} makeDefault />
    </Canvas>
  );
};
