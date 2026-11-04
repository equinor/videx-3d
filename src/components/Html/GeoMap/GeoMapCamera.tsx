import { useFrame, useThree } from '@react-three/fiber';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Vector3 } from 'three';
import { globeMapSurface } from '../../../sdk/projection/globe';
import {
  adaptiveMapExtent,
  dropMarkerOn,
  flatMapSurface,
  mapViewUp,
  rayAtSeaLevel,
} from '../../../sdk/projection/map-view';
import type { Vec2, Vec3 } from '../../../sdk/types/common';
import { readCameraTarget, setCameraPose } from '../../../sdk/utils/camera';
import { useWorld } from '../../World/world-context';
import {
  GeoMapCameraContext,
  type GeoMapCameraHost,
  type GeoMapHome,
} from './geo-map-camera';
import { useGeoMap } from './geo-map-context';

/**
 * GeoMapCamera props
 * @expand
 */
export type GeoMapCameraProps = {
  /**
   * what the map follows: the camera; its target — what it looks at, on the sea's level (the
   * controls' target, R3F's `state.controls`, dropped to it; without controls, where the view
   * ray meets the sea); or nothing (`false`), the map staying where the user puts it.
   * Dragged, a following map eases back when let go. Default `false`
   */
  follow?: 'camera' | 'target' | false;
  /**
   * while following, the extent it shows: `'auto'` with the camera's height over the sea
   * (`autoZoomFactor` times it, within `autoZoomRange`), a number of metres across, or
   * nothing to leave the map's own zoom. Default none
   */
  extent?: 'auto' | number;
  /** `'auto'`: metres of map across per metre of height. Default 4 */
  autoZoomFactor?: number;
  /** `'auto'`: the least and the most metres across. Default 1 km to 1000 km */
  autoZoomRange?: [number, number];
  /** while following, turn the map so the camera's heading points up. Default false */
  headingUp?: boolean;
  /**
   * the sea's height in the scene (Y), what heights are measured from. In a `World`, over its
   * globe's sea: far from the field, where the sea curves below Y = 0, still heights over it.
   * Default 0
   */
  level?: number;
  /**
   * whether dropping a marker (`GeoMapCameraMarker`, `GeoMapTargetMarker`) moves the scene's
   * controls (drei's `CameraControls`, which fly there, or `OrbitControls`): the camera
   * marker flies the camera, with its target, to the drop; the target marker re-aims the
   * camera at it. Both keep their heights. Set it to `false` to handle the drop yourself in
   * `onMarkerDrop`. Default `true`
   */
  dragControls?: boolean;
  /** a marker was dropped on the map, at scene X/Z (a drop outside the map, or cancelled, is not reported) */
  onMarkerDrop?: (kind: 'camera' | 'target', at: Vec2) => void;
  /** the pose `home()` sends the camera back to. Default the pose it had at the first frame */
  home?: GeoMapHome;
  /** its markers: `GeoMapCameraMarker`, `GeoMapTargetMarker` */
  children?: ReactNode;
};

/**
 * What a {@link GeoMapCamera}'s ref holds.
 *
 * @group Components
 */
export type GeoMapCameraHandle = {
  /** fly the camera and its target back to the home pose */
  home: () => void;
  /** whether the scene has controls a drop or `home` can move */
  canMove: () => boolean;
};

const position = new Vector3();
const forward = new Vector3();
const up = new Vector3();
const pivot = new Vector3();

// How far off along the ground the view ray's sea-level point is taken, in metres.
const TARGET_REACH = 2e6;

/**
 * The 3D view's camera on a {@link GeoMap}: where it is and which way it looks, for its
 * markers (`GeoMapCameraMarker`, `GeoMapTargetMarker`); the map following it or what it looks
 * at (`follow`), zoomed by its height (`extent` `'auto'`) and turned to its heading
 * (`headingUp`); and the controls moved where a marker is dropped. Place it in a map that
 * sees the `Canvas` — in an `Overlay` — such as a `Minimap`'s, or a full-view map of your
 * own. Each frame the camera does not move costs nothing.
 *
 * @example
 * <Overlay>
 *   <OverlayItem anchor="fill">
 *     <GeoMap layers={layers}>
 *       <GeoMapCamera>
 *         <GeoMapTargetMarker />
 *         <GeoMapCameraMarker />
 *       </GeoMapCamera>
 *     </GeoMap>
 *   </OverlayItem>
 * </Overlay>
 *
 * @group Components
 */
export const GeoMapCamera = forwardRef<GeoMapCameraHandle, GeoMapCameraProps>(
  (
    {
      follow = false,
      extent,
      autoZoomFactor = 4,
      autoZoomRange,
      headingUp = false,
      level = 0,
      dragControls = true,
      onMarkerDrop,
      home,
      children,
    },
    ref,
  ) => {
    const { controller } = useGeoMap();
    const get = useThree(state => state.get);
    const globe = useWorld()?.globe ?? null;
    const surface = useMemo(
      () => (globe ? globeMapSurface(globe, level) : flatMapSurface(level)),
      [globe, level],
    );
    const [rangeMin, rangeMax] = autoZoomRange ?? [1000, 1000000];

    // What it last told the map, to tell it again only on a change.
    const [last] = useState(() => new Float64Array(14).fill(NaN));
    const lastLonLat = useRef<unknown>(null);
    const firstHome = useRef<GeoMapHome | null>(null);
    const latest = useRef({ dragControls, onMarkerDrop, home, surface });
    useEffect(() => {
      latest.current = { dragControls, onMarkerDrop, home, surface };
    });
    // A change of what it does: tell the map again, even with the camera still.
    useEffect(() => {
      last.fill(NaN);
    }, [
      last,
      follow,
      extent,
      autoZoomFactor,
      rangeMin,
      rangeMax,
      headingUp,
      surface,
    ]);
    // Gone: the map stays where it is, and shows no camera.
    useEffect(
      () => () => {
        controller.setFollow(null);
        controller.setCamera(null);
      },
      [controller],
    );

    useFrame(state => {
      const toLonLat = controller.store.state.toLonLat;
      const { camera, controls } = state;
      camera.getWorldPosition(position);
      camera.getWorldDirection(forward);
      up.set(0, 1, 0).transformDirection(camera.matrixWorld);
      const hasControls = readCameraTarget(controls, pivot);
      const perspective = (camera as { fov?: number }).fov ?? 0;
      const aspect = (camera as { aspect?: number }).aspect ?? 1;
      // Nothing moved: nothing to do.
      const was = last;
      const now = [
        position.x,
        position.y,
        position.z,
        forward.x,
        forward.y,
        forward.z,
        up.x,
        up.y,
        up.z,
        hasControls ? pivot.x : NaN,
        hasControls ? pivot.y : NaN,
        hasControls ? pivot.z : NaN,
        perspective,
        aspect,
      ];
      let same = toLonLat === lastLonLat.current;
      for (let i = 0; same && i < now.length; i++)
        if (!Object.is(now[i], was[i])) same = false;
      if (same) return;
      was.set(now);
      lastLonLat.current = toLonLat;

      // What the camera looks at, on the sea's level: the controls' target dropped to it.
      const eye: Vec3 = [position.x, position.y, position.z];
      const aim: Vec3 = [pivot.x, pivot.y, pivot.z];
      const target: Vec2 = hasControls
        ? surface.foot(aim)
        : rayAtSeaLevel(
            eye,
            [forward.x, forward.y, forward.z],
            level,
            TARGET_REACH,
          );
      if (hasControls && !firstHome.current)
        firstHome.current = { position: eye, target: aim };
      const cameraAt = surface.foot(eye);
      const altitude = surface.altitude(eye);
      const way = mapViewUp(
        'heading-up',
        [forward.x, forward.y, forward.z],
        [up.x, up.y, up.z],
      );
      if (follow) {
        const at = follow === 'target' ? target : cameraAt;
        controller.setFollow({
          center: toLonLat(at[0], at[1]),
          extent:
            extent === 'auto'
              ? adaptiveMapExtent(
                  altitude,
                  [rangeMin, rangeMax],
                  autoZoomFactor,
                )
              : (extent ?? null),
          upScene: headingUp ? way : null,
        });
      }
      controller.setCamera({
        fov: perspective
          ? 2 * Math.atan(Math.tan((perspective * Math.PI) / 360) * aspect)
          : 0,
        forward: way,
        altitude,
        targetAltitude: hasControls ? surface.altitude(aim) : 0,
        camera: cameraAt,
        target,
        follow: follow || null,
      });
      // Drawn in this frame, with the 3D view.
      controller.flush();
    });

    const host = useMemo<GeoMapCameraHost>(() => {
      const canDrag = () =>
        latest.current.dragControls && readCameraTarget(get().controls, pivot);
      return {
        canDrag,
        freeze: on => controller.freeze(on),
        drop: (kind, at) => {
          const { camera, controls } = get();
          if (canDrag()) {
            camera.getWorldPosition(position);
            setCameraPose(
              controls,
              camera,
              dropMarkerOn(
                latest.current.surface,
                kind,
                [position.x, position.y, position.z],
                [pivot.x, pivot.y, pivot.z],
                at,
              ),
            );
          }
          latest.current.onMarkerDrop?.(kind, at);
        },
      };
    }, [controller, get]);

    useImperativeHandle(
      ref,
      () => ({
        home: () => {
          const pose = latest.current.home ?? firstHome.current;
          const { camera, controls } = get();
          if (!pose || !host.canDrag()) return;
          setCameraPose(controls, camera, {
            camera: pose.position,
            target: pose.target,
          });
        },
        canMove: () => host.canDrag(),
      }),
      [get, host],
    );

    return (
      <GeoMapCameraContext.Provider value={host}>
        {children}
      </GeoMapCameraContext.Provider>
    );
  },
);
GeoMapCamera.displayName = 'GeoMapCamera';
