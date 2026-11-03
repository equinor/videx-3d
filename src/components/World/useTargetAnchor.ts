import { useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Vector3 } from 'three';
import { Boundary, boundaryKey } from '../../sdk/geometries/boundary';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import {
  TargetAnchor,
  TargetAnchorField,
  TargetAnchorOptions,
  TargetAnchorPicker,
} from '../../sdk/projection/target-anchor';
import {
  cameraPixelSize,
  CameraRest,
  carryCamera,
  readCameraTarget,
} from '../../sdk/utils/camera';
import type { WorldFrameChange } from './World';

/**
 * Options for {@link useTargetAnchor}.
 */
export type UseTargetAnchorOptions = TargetAnchorOptions & {
  /** the fields to anchor to while the target is over one, as their `UtmArea`s have them */
  fields?: readonly TargetAnchorField[];
  /** where it is anchored to begin with, and while off: a field's `id`, or a frame and boundary */
  initial: string | { frame: GeoFrame; boundary?: Boundary };
  /** follow the target. Default true; off, it is anchored as `initial` says */
  enabled?: boolean;
  /** told of each change of the frame, after the camera has been carried through it */
  onFrameChange?: (change: WorldFrameChange) => void;
};

/**
 * What {@link useTargetAnchor} gives the `World`: its `frame` and `boundary` and its
 * `onFrameChange`, spread as they are; and the field anchored, its `id`, or null over none.
 */
export type TargetAnchorState = {
  frame: GeoFrame;
  boundary: Boundary | undefined;
  field: string | null;
  onFrameChange: (change: WorldFrameChange) => void;
};

const NO_FIELDS: readonly TargetAnchorField[] = [];
const target = new Vector3();

/**
 * Anchors a `World` where the camera looks: at the default controls' target (`makeDefault`;
 * drei's `CameraControls`, three's `OrbitControls`), to the field the target is over, or to a
 * map about it over none (see `TargetAnchorPicker`). So no field needs to be chosen, and the
 * scene's origin stays near what is looked at, wherever on the Earth that is.
 *
 * It never takes the controls from the user: it judges only once the camera has come to rest
 * (see `CameraRest`), and a switch changes nothing on screen: the camera, its target and its
 * up are carried to the new frame by where they are on the Earth (`carryCamera`), and the
 * anchor goes to or from a field only when the sea over its disc moves by less than a pixel.
 * Levelling the horizon is left to `useLevelHorizon`.
 *
 * ⚠️ It anchors at the controls' target as it is. Orbit controls zoomed far out, orbited and
 * panned, carry their target far from what is seen, under the ground too (1 985 km below the sea
 * from 602 km up, measured): constrain them (`maxDistance`), keep their target on the ground, or
 * use globe controls for wide views. See documents/georeferencing.md, Going far.
 *
 * Inside the `Canvas`, above the `World` it anchors:
 *
 * @example
 * const anchor = useTargetAnchor({ fields, initial: 'volve' })
 * <World frame={anchor.frame} boundary={anchor.boundary} onFrameChange={anchor.onFrameChange}>
 *   {fields.map(f => <UtmArea key={f.id} id={f.id} frame={f.frame} boundary={f.boundary}>…</UtmArea>)}
 * </World>
 */
export function useTargetAnchor({
  fields = NO_FIELDS,
  initial,
  enabled = true,
  onFrameChange,
  frameAt,
  minDistance,
  maxDistance,
  pixels,
  margin,
}: UseTargetAnchorOptions): TargetAnchorState {
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls);
  const gl = useThree(state => state.gl);
  const height = useThree(state => state.size.height);
  const connected = useThree(state => state.events.connected) as
    | HTMLElement
    | undefined;

  // By their content: fields written inline are new objects every render.
  const fieldsKey = fields
    .map(f => `${f.id}|${JSON.stringify(f.frame)}|${boundaryKey(f.boundary)}`)
    .join(';');
  const picker = useMemo(
    () =>
      new TargetAnchorPicker(fields, {
        frameAt,
        minDistance,
        maxDistance,
        pixels,
        margin,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields by their content
    [fieldsKey, frameAt, minDistance, maxDistance, pixels, margin],
  );

  const initialKey =
    typeof initial === 'string'
      ? initial
      : `${JSON.stringify(initial.frame)}|${boundaryKey(initial.boundary)}`;
  const start = useMemo<TargetAnchor>(() => {
    if (typeof initial !== 'string')
      return {
        frame: initial.frame,
        boundary: initial.boundary ?? null,
        field: null,
      };
    const field = picker.field(initial);
    if (!field)
      throw Error(`useTargetAnchor: no field '${initial}' among its fields`);
    return { frame: field.frame, boundary: field.boundary, field: field.id };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by its content
  }, [initialKey, picker]);
  const [anchor, setAnchor] = useState(start);
  const current = enabled ? anchor : start;
  // While off it is `initial`'s: turned on, it starts from there.
  useLayoutEffect(() => {
    if (!enabled) setAnchor(start);
  }, [enabled, start]);
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });

  // The user taking the controls, where they listen.
  const [rest] = useState(() => new CameraRest());
  const element =
    (controls as { domElement?: HTMLElement } | null)?.domElement ??
    connected ??
    gl.domElement;
  useEffect(() => rest.attach(element), [element, rest]);

  // A switch asked for and not yet made: nothing more is asked until the World has made it.
  const pending = useRef(false);
  useLayoutEffect(() => {
    pending.current = false;
  }, [anchor]);
  // Judged at this rest already: again once the camera has moved, or it is turned on.
  const judged = useRef(false);
  useLayoutEffect(() => {
    judged.current = false;
  }, [enabled]);

  useFrame(() => {
    if (!rest.update(camera)) {
      judged.current = false;
      return;
    }
    if (!enabled || pending.current || judged.current) return;
    judged.current = true;
    if (!readCameraTarget(controls, target))
      target.set(camera.position.x, 0, camera.position.z);
    const next = picker.pick(latest.current, {
      target: [target.x, target.y, target.z],
      camera: [camera.position.x, camera.position.y, camera.position.z],
      pixelSize: distance => cameraPixelSize(camera, height, distance),
    });
    if (!next) return;
    pending.current = true;
    setAnchor(next);
  });

  const told = useRef(onFrameChange);
  useLayoutEffect(() => {
    told.current = onFrameChange;
  });
  const carry = useCallback(
    (change: WorldFrameChange) => {
      carryCamera(change.carry, camera, controls);
      told.current?.(change);
    },
    [camera, controls],
  );

  return {
    frame: current.frame,
    boundary: current.boundary ?? undefined,
    field: current.field,
    onFrameChange: carry,
  };
}
