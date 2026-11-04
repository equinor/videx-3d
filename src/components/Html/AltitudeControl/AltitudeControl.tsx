import { useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Vector3 } from 'three';
import { globeMapSurface } from '../../../sdk/projection/globe';
import {
  altitudeRate,
  boostFactor,
  flatMapSurface,
  moveAltitude,
  setMarkerHeight,
} from '../../../sdk/projection/map-view';
import { readCameraTarget, setCameraPose } from '../../../sdk/utils/camera';
import { useWorld } from '../../World/world-context';
import { GeoMapMarkerIcon } from '../GeoMap/GeoMapIcons';
import { formatHudAltitude, HUD_LABEL, setHudText } from '../hud';
import { OverlayItem } from '../Overlay/OverlayItem';
import {
  useOverlay,
  useOverlayItem,
  type OverlayAnchor,
} from '../Overlay/overlay-context';
import {
  altitudeControlTravel,
  resolveAltitudeControl,
  type AltitudeControlOptions,
} from './altitude-control';

/**
 * AltitudeControl props
 * @expand
 */
export type AltitudeControlProps = AltitudeControlOptions & {
  /**
   * whose height it changes: the camera's, which takes its target along so it looks the same
   * way at the same angle from the new height; or its target's alone, the camera staying.
   * Default `'camera'`
   */
  marker?: 'camera' | 'target';
  /**
   * the sea's height in the scene (Y), what heights are measured from. In a `World`, over its
   * globe's sea: far from the field, where the sea curves below Y = 0, still heights over it.
   * Default 0
   */
  level?: number;
  /** the height now, under the control. Default true */
  readout?: boolean;
  /** in the `Overlay`, where it sits. Default `'left-center'` */
  anchor?: OverlayAnchor;
  /** in the `Overlay`, its order among the items at its anchor. Default 0 */
  order?: number;
  /** names it in the overlay's `layout` */
  id?: string;
};

// The longest a frame's step in a drag is taken to be, in seconds: a stalled tab does not
// throw the camera.
const MAX_STEP_SECONDS = 0.1;
// The knob's width, and its track's: a hit area wider than the groove it runs in.
const KNOB = 14;
const TRACK_WIDTH = 20;
// How long the knob takes to spring back to the middle, in ms.
const SPRING_MS = 160;

const position = new Vector3();
const pivot = new Vector3();

/**
 * A slim vertical control over the 3D view for the height of the camera (or of its target):
 * pull its knob up to climb, down to descend. The knob sets the speed directly, in metres a
 * second, the same at any height, growing with the square of how far it is from the middle up
 * to `maxSpeed` at the end of its travel; held there it accelerates, doubling every
 * `boostTime` seconds up to `boost` times `maxSpeed`, and pulled back from the end it is at once
 * direct again. Let go and it springs back; Escape puts the height back. Pressing the groove
 * brings the knob to the pointer; pressing the knob holds it where it was grabbed.
 *
 * It moves the scene's controls (R3F's `state.controls`: drei's `CameraControls`, or an
 * `OrbitControls`), and is dimmed and inert without them. HTML that needs the `Canvas`'s
 * contexts: in an {@link Overlay} it sits at `anchor`; in a layout of your own (a
 * `CanvasHtml`), where you put it.
 *
 * @example
 * <Overlay>
 *   <AltitudeControl anchor="left-center" maxSpeed={200} />
 * </Overlay>
 *
 * @see `documents/overlay.md`
 * @group Components
 */
export const AltitudeControl = ({
  anchor = 'left-center',
  order = 0,
  id,
  ...props
}: AltitudeControlProps) => {
  const overlay = useOverlay();
  const item = useOverlayItem();
  const gadget = <AltitudeGadget {...props} />;
  // In an overlay, at its anchor; in an item of one, or anywhere else, where it is.
  return overlay && !item ? (
    <OverlayItem anchor={anchor} order={order} id={id}>
      {gadget}
    </OverlayItem>
  ) : (
    gadget
  );
};

const AltitudeGadget = ({
  marker = 'camera',
  level = 0,
  readout = true,
  ...options
}: Omit<AltitudeControlProps, 'anchor' | 'order' | 'id'>) => {
  const get = useThree(state => state.get);
  const viewHeight = useThree(state => state.size.height);
  const globe = useWorld()?.globe ?? null;
  const surface = useMemo(
    () => (globe ? globeMapSurface(globe, level) : flatMapSurface(level)),
    [globe, level],
  );
  // The options by value: an object written inline is a new one each render.
  const optionsKey = JSON.stringify(options);
  const resolved = useMemo(
    () => resolveAltitudeControl(JSON.parse(optionsKey)),
    [optionsKey],
  );
  const travel = altitudeControlTravel(resolved.dragRange, viewHeight);

  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const enabled = useRef<boolean | null>(null);
  const [dragging, setDragging] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  // A drag ends with the gadget.
  useEffect(() => () => stop.current?.(), []);

  // The height of the marker over the sea now, or null without controls to read a target from.
  const heightNow = useCallback((): number | null => {
    const { camera, controls } = get();
    if (marker === 'target')
      return readCameraTarget(controls, pivot)
        ? surface.altitude([pivot.x, pivot.y, pivot.z])
        : null;
    camera.getWorldPosition(position);
    return surface.altitude([position.x, position.y, position.z]);
  }, [get, marker, surface]);

  // The marker set to `metres` over the sea: the camera takes its target along, the target
  // alone leaves the camera.
  const setAltitude = useCallback(
    (metres: number) => {
      const { camera, controls } = get();
      if (!readCameraTarget(controls, pivot)) return;
      camera.getWorldPosition(position);
      setCameraPose(
        controls,
        camera,
        setMarkerHeight(
          surface,
          marker,
          [position.x, position.y, position.z],
          [pivot.x, pivot.y, pivot.z],
          metres,
        ),
        false,
      );
    },
    [get, marker, surface],
  );

  // Per frame, through refs: whether there are controls to move, and the readout.
  useFrame(() => {
    const can = readCameraTarget(get().controls, pivot);
    if (can !== enabled.current && track.current) {
      enabled.current = can;
      track.current.style.pointerEvents = can ? 'auto' : 'none';
      track.current.style.opacity = can ? '1' : '0.35';
    }
    if (readout) {
      const height = heightNow();
      setHudText(
        label.current,
        height === null ? '–' : formatHudAltitude(height),
      );
    }
  });

  // Put the knob `offset` pixels from the middle (positive down): the fill from the middle to
  // it, heavier the harder the push.
  const place = useCallback(
    (offset: number, push: number) => {
      if (knob.current)
        knob.current.style.transform = `translateY(${offset}px) scale(${1 + 0.15 * push})`;
      if (fill.current) {
        fill.current.style.top = `${travel + KNOB / 2 + Math.min(offset, 0)}px`;
        fill.current.style.height = `${Math.abs(offset)}px`;
        fill.current.style.opacity = String(0.35 + 0.65 * push);
      }
    },
    [travel],
  );

  const onDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const first = heightNow();
      if (event.button !== 0 || first === null || !track.current) return;
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      event.stopPropagation();
      const rect = track.current.getBoundingClientRect();
      const middle = rect.top + travel + KNOB / 2;
      // On the knob it stays where it was grabbed; elsewhere on the groove it comes to the pointer.
      const knobAt =
        middle + (parseFloat(knob.current?.dataset.offset ?? '0') || 0);
      const grab =
        Math.abs(event.clientY - knobAt) <= KNOB / 2 + 3
          ? event.clientY - knobAt
          : 0;
      const range: [number, number] = [resolved.min, resolved.max];
      // The height it has been taken to, kept here: what is read back lags the controls.
      let height = first;
      let offset = 0;
      // How long the knob has been at the end of its travel, in one direction: the boost.
      let held = 0;
      let heldWay = 0;
      let last = performance.now();
      let frame = 0;
      const pull = (y: number) => {
        offset = Math.max(-travel, Math.min(y - middle - grab, travel));
      };
      pull(event.clientY);
      if (knob.current) knob.current.style.transition = 'none';
      setDragging(true);

      const tick = (now: number) => {
        const dt = Math.min((now - last) / 1000, MAX_STEP_SECONDS);
        last = now;
        // The knob sets the speed directly; only at the end of its travel does it speed up.
        const rate = altitudeRate(-offset, travel);
        const atEnd = Math.abs(offset) >= travel - 0.5;
        const way = Math.sign(-offset);
        if (atEnd && way === heldWay) {
          held += dt;
        } else {
          held = 0;
          heldWay = atEnd ? way : 0;
        }
        const velocity =
          rate *
          resolved.maxSpeed *
          (atEnd ? boostFactor(held, resolved.boostTime, resolved.boost) : 1);
        if (velocity !== 0) {
          height = moveAltitude(height, velocity, dt, range);
          setAltitude(height);
        }
        if (knob.current) knob.current.dataset.offset = String(offset);
        place(offset, Math.abs(rate));
        frame = requestAnimationFrame(tick);
      };
      const onMove = (move: PointerEvent) => pull(move.clientY);
      const onKey = (key: KeyboardEvent) => {
        if (key.key !== 'Escape') return;
        setAltitude(first);
        end();
      };
      const end = () => {
        cancelAnimationFrame(frame);
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', end);
        element.removeEventListener('pointercancel', end);
        window.removeEventListener('keydown', onKey);
        stop.current = null;
        // The spring: back to the middle.
        if (knob.current) {
          knob.current.style.transition = `transform ${SPRING_MS}ms ease-out`;
          knob.current.dataset.offset = '0';
        }
        place(0, 0);
        setDragging(false);
      };
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', end);
      element.addEventListener('pointercancel', end);
      window.addEventListener('keydown', onKey);
      stop.current = end;
      frame = requestAnimationFrame(tick);
    },
    [heightNow, travel, resolved, place, setAltitude],
  );

  const length = 2 * travel + KNOB;
  const edge = '0 0 0 1px rgba(0, 0, 0, 0.5)';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={track}
        title={`Altitude: pull up to climb, down to descend (the ${marker}'s height)`}
        onPointerDown={onDown}
        style={{
          position: 'relative',
          width: TRACK_WIDTH,
          height: length,
          // Inert until a frame finds controls to move.
          pointerEvents: 'none',
          opacity: 0.35,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      >
        {/* the groove, its two ends and its middle */}
        <div
          style={{
            position: 'absolute',
            left: TRACK_WIDTH / 2 - 1,
            top: KNOB / 2,
            width: 2,
            height: 2 * travel,
            borderRadius: 1,
            background: 'rgba(255, 255, 255, 0.4)',
            boxShadow: edge,
          }}
        />
        {[0, travel, 2 * travel].map(at => (
          <div
            key={at}
            style={{
              position: 'absolute',
              left: TRACK_WIDTH / 2 - (at === travel ? 5 : 4),
              top: KNOB / 2 + at - 1,
              width: at === travel ? 10 : 8,
              height: 2,
              borderRadius: 1,
              background: 'rgba(255, 255, 255, 0.7)',
              boxShadow: edge,
            }}
          />
        ))}
        <div
          ref={fill}
          style={{
            position: 'absolute',
            left: TRACK_WIDTH / 2 - 1.5,
            top: travel + KNOB / 2,
            width: 3,
            height: 0,
            borderRadius: 1.5,
            background: resolved.color,
            opacity: 0.35,
          }}
        />
        <div
          ref={knob}
          data-offset="0"
          style={{
            position: 'absolute',
            left: (TRACK_WIDTH - KNOB) / 2,
            top: travel,
            width: KNOB,
            height: KNOB,
            boxSizing: 'border-box',
            borderRadius: '50%',
            background: resolved.color,
            border: '1.5px solid rgba(0, 0, 0, 0.6)',
            boxShadow: '0 0 3px rgba(0, 0, 0, 0.6)',
          }}
        />
      </div>
      {readout && (
        <div
          title={`Height of the ${marker} over the sea`}
          style={{
            ...HUD_LABEL,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <GeoMapMarkerIcon marker={marker} box={12} size={10} />
          <span ref={label} />
        </div>
      )}
    </div>
  );
};
