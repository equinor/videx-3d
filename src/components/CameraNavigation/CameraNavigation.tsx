import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mesh, Ray, Vector3 } from 'three';
import { createLayers, LAYERS } from '../../layers/layers';
import type { CameraNavigationBindingsInput } from '../../sdk/managers/camera-bindings';
import {
  CameraNavigator,
  type CameraNavigatorOptions,
  type CameraNavigatorState,
  navigableControls,
} from '../../sdk/managers/CameraNavigator';
import {
  earthView,
  northAt,
  overlookView,
  traceGlobeSurface,
} from '../../sdk/projection/globe-views';
import { cameraPixelSize, type CameraView } from '../../sdk/utils/camera';
import { sceneWorld } from '../World/world-scene';
import { NavigationUi } from './navigation-ui';
import { registerSceneNavigator } from './scene-navigator';

/**
 * Props for {@link CameraNavigation}.
 *
 * @expand
 */
export type CameraNavigationProps = {
  /** Changes to the default keys (`DEFAULT_CAMERA_BINDINGS`): an action's keys, or `false` to turn it off. */
  bindings?: CameraNavigationBindingsInput;
  /** Metres a second at speed 1; + and - double and halve it. Default 200. */
  speed?: number;
  /** How many times faster while Shift is held. Default 4. */
  sprint?: number;
  /** Metres ahead the target is kept while moving, and placed at in target mode. Default 1000. */
  distance?: number;
  /** Degrees the view turns per pixel the mouse moves in fly mode. Default 0.15. */
  lookSpeed?: number;
  /** The view Home goes to without a curved globe. Default: the view at the first frame. */
  home?: CameraView;
  /** Listen to the keys and the pointer. Default true. */
  enabled?: boolean;
  /** Show the keys from the start. Default false. */
  help?: boolean;
};

const SCENE_UP = new Vector3(0, 1, 0);
const SCENE_NORTH = new Vector3(0, 0, -1);
// The target marker's radius, as a share of `distance` (20 m at 1 km): a size in metres, so it
// shrinks as it moves away and grows as it comes near.
const MARKER_SIZE = 0.02;
// Never smaller on screen than this radius, in pixels, so it stays in sight far off.
const MARKER_MIN_PIXELS = 3;

/**
 * Keyboard and mouse navigation for the scene's camera, on top of its orbit controls:
 *
 * - W/A/S/D move, ↑/↓ and PgUp/PgDn go up and down, Shift held moves faster, + and - double
 *   and halve the speed;
 * - F: fly mode, the mouse turns the view where the camera is (Esc or F leaves it);
 * - T: target mode, the arrows move a marker, and a click, Enter or T makes it the target
 *   (Esc cancels);
 * - Alt+click: over a `World`, go to the ground or the sea where you click;
 * - Home: over a curved globe, the whole Earth; otherwise `home`, or the view it started in.
 *   Backspace goes back to the view before a jump;
 * - Alt+0–9 keeps the view on a number key, 0–9 goes back to it;
 * - L levels the horizon, N faces north, ? shows the keys.
 *
 * Every key can be changed (`bindings`). It needs drei's `CameraControls` as the default
 * controls (`makeDefault`); with other controls, or none, it does nothing. Over a `World`, up,
 * north and the camera's up are the globe's where the camera is. Keys are taken only while
 * nothing else has the focus (a field, a button, a control of its own), so a click in the view
 * gives them back.
 *
 * @example
 * <Canvas>
 *   <CameraControls makeDefault />
 *   <CameraNavigation help />
 * </Canvas>
 *
 * @see [Camera navigation](/videx-3d/docs/documents/camera-navigation.html)
 * @see {@link CameraNavigator}
 *
 * @group Components
 */
export const CameraNavigation = ({
  bindings,
  speed,
  sprint,
  distance,
  lookSpeed,
  home,
  enabled = true,
  help = false,
}: CameraNavigationProps) => {
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const height = useThree(state => state.size.height);
  const [navigator, setNavigator] = useState<CameraNavigator | null>(null);
  const marker = useRef<Mesh>(null);
  const markerLayers = useMemo(() => createLayers(LAYERS.OVERLAY), []);
  // What shows the navigator's state, made with it.
  const show = useRef<((state: CameraNavigatorState) => void) | null>(null);

  // The props as last given, for what the navigator asks between renders.
  const props = useRef({ home, distance });
  useLayoutEffect(() => {
    props.current = { home, distance };
  });

  const options = useMemo<CameraNavigatorOptions>(
    () => ({
      bindings,
      speed,
      sprint,
      distance,
      lookSpeed,
      upAt: (point, out) => {
        const world = sceneWorld(scene);
        return world ? world.globe.upAt(point, out) : out.copy(SCENE_UP);
      },
      northAt: (point, out) => {
        const world = sceneWorld(scene);
        return world ? northAt(world.globe, point, out) : out.copy(SCENE_NORTH);
      },
      home: () => {
        const world = sceneWorld(scene);
        if (world?.globe.enabled)
          return earthView(world.globe, camera.position);
        return props.current.home ?? null;
      },
      goThere: (ray: Ray) => {
        const world = sceneWorld(scene);
        if (!world) return null;
        const drawn = world.tiles.current;
        const heightAt = drawn?.heightAt ?? null;
        const point = traceGlobeSurface(
          world.globe,
          ray,
          heightAt,
          drawn?.highest ?? 0,
        );
        if (!point) return null;
        return overlookView(
          world.globe,
          heightAt,
          point,
          ray.direction,
          props.current.distance ?? 1000,
        );
      },
    }),
    [bindings, speed, sprint, distance, lookSpeed, scene, camera],
  );

  useEffect(() => {
    const navigable = enabled ? navigableControls(controls) : null;
    const parent = gl.domElement.parentElement;
    if (!navigable || !parent) return;
    const ui = new NavigationUi(parent);
    const created = new CameraNavigator(camera, navigable, {});
    show.current = state =>
      ui.update(state, created.keyBindings, !!sceneWorld(scene));
    const detach = created.attach(gl.domElement);
    const release = registerSceneNavigator(scene, created);
    setNavigator(created);
    return () => {
      detach();
      release();
      ui.dispose();
      show.current = null;
      setNavigator(null);
    };
  }, [camera, controls, gl, scene, enabled]);

  // The props reach it without starting it again.
  useLayoutEffect(() => {
    navigator?.setOptions({
      ...options,
      onChange: state => show.current?.(state),
    });
  }, [navigator, options]);

  // Show the keys from the start, as `help` asks.
  useEffect(() => {
    if (navigator && help && !navigator.help) navigator.toggleHelp();
  }, [navigator, help]);

  // Before the controls' own frame (-1), so a move shows in the frame it is made.
  useFrame((_, delta) => {
    if (!navigator) return;
    navigator.update(delta);
    const mesh = marker.current;
    if (!mesh) return;
    mesh.visible = navigator.mode === 'target';
    if (mesh.visible) {
      mesh.position.copy(navigator.marker);
      const reach = camera.position.distanceTo(navigator.marker);
      mesh.scale.setScalar(
        Math.max(
          (distance ?? 1000) * MARKER_SIZE,
          cameraPixelSize(camera, height, reach) * MARKER_MIN_PIXELS,
        ),
      );
    }
  }, -2);

  return (
    <mesh
      ref={marker}
      visible={false}
      layers={markerLayers}
      renderOrder={1000}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial
        color="#ffd54f"
        transparent
        opacity={0.9}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
};
