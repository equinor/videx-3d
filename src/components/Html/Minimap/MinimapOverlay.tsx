import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cornerStyle } from '../../../common/corner-style';
import {
  altitudeRate,
  boostFactor,
  moveAltitude,
  niceScaleLength,
  type MapOrientation,
} from '../../../sdk/projection/map-view';
import {
  MinimapContext,
  useMinimapFrame,
  type MinimapCenter,
  type MinimapStore,
} from './minimap-context';
import type { MinimapZoom } from './minimap-controller';
import { MinimapCameraIcon, MinimapTargetIcon } from './MinimapIcons';
import {
  altitudeControlTravel,
  resolveMinimapLayout,
  type MinimapAnchor,
  type MinimapItem,
  type MinimapLayout,
  type ResolvedMinimapAltitudeControl,
} from './minimap-layout';

/** `metres` as a short distance: `850 m`, `4.5 km`, `120 km`. */
export function formatMinimapDistance(metres: number) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** A height over the sea: `120 m`, `−1.2 km`, `MSL` within a metre of it. */
export function formatMinimapAltitude(metres: number) {
  if (Math.abs(metres) < 1) return 'MSL';
  return `${metres < 0 ? '−' : ''}${formatMinimapDistance(Math.abs(metres))}`;
}

/**
 * A button a {@link Minimap} can show: `'zoom-in'`, `'zoom-out'`, `'zoom-auto'` (the
 * adaptive zoom) and `'center'` (the camera / target toggle).
 *
 * @group Components
 */
export type MinimapControl = 'zoom-in' | 'zoom-out' | 'zoom-auto' | 'center';

/** Every {@link MinimapControl}, in the order they are shown by default. */
export const MINIMAP_CONTROLS: MinimapControl[] = [
  'zoom-in',
  'zoom-out',
  'zoom-auto',
  'center',
];

// How wide the distance bar aims to be, of the map's width, and at least how many pixels: its
// label sits inside it.
const SCALE_BAR_SHARE = 0.25;
const SCALE_BAR_MIN = 72;
// The longest a frame's step in an altitude drag is taken to be, in seconds: a stalled tab
// does not throw the camera.
const MAX_STEP_SECONDS = 0.1;

const BUTTON: CSSProperties = {
  width: 24,
  height: 24,
  padding: 0,
  font: '14px/1 verdana, sans-serif',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.55)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  borderRadius: 4,
  cursor: 'pointer',
};
const ACTIVE = '#ffd21a';
const IDLE = 'rgba(255, 255, 255, 0.3)';
// One look for every label (the extent, the distance, the altitude): sharp text with a hard
// one-pixel outline all round and a tight core, readable on light ground and dark.
const LABEL: CSSProperties = {
  font: '10px/1.2 verdana, sans-serif',
  color: '#fff',
  textShadow: [
    '-1px -1px 0 #000',
    '0 -1px 0 #000',
    '1px -1px 0 #000',
    '-1px 0 0 #000',
    '1px 0 0 #000',
    '-1px 1px 0 #000',
    '0 1px 0 #000',
    '1px 1px 0 #000',
    '0 0 2px #000',
  ].join(', '),
  pointerEvents: 'none',
};

type CompassProps = {
  orientation: MapOrientation;
  onToggle: () => void;
};

const Compass = ({ orientation, onToggle }: CompassProps) => {
  const needle = useRef<SVGGElement>(null);
  useMinimapFrame(({ northAngle }) => {
    needle.current?.setAttribute(
      'transform',
      `rotate(${(northAngle * 180) / Math.PI} 14 14)`,
    );
  });
  const title =
    orientation === 'north-up'
      ? 'North up: click to point the map where the camera looks'
      : 'Heading up: click to point the map north';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onToggle}
      style={{
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        pointerEvents: 'auto',
      }}
    >
      <svg width={28} height={28} style={{ display: 'block' }}>
        <circle cx={14} cy={14} r={13} fill="rgba(0, 0, 0, 0.45)" />
        <g ref={needle}>
          <path d="M14 3.5 L18 14 L10 14 Z" fill="#ff5a36" />
          <path d="M14 24.5 L18 14 L10 14 Z" fill="#dddddd" />
        </g>
      </svg>
    </button>
  );
};

// The ground across the map's shorter side.
const Extent = () => {
  const extent = useRef<HTMLDivElement>(null);
  useMinimapFrame(({ extent: across }) => {
    if (extent.current)
      extent.current.textContent = formatMinimapDistance(across);
  });
  return <div ref={extent} style={LABEL} />;
};

// A bar of a round length with its own inside it: what a stretch of the map measures.
const Distance = () => {
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useMinimapFrame(({ view }) => {
    const { metres, pixels } = niceScaleLength(
      view.metresPerPixel,
      Math.max(view.size[0] * SCALE_BAR_SHARE, SCALE_BAR_MIN),
    );
    if (bar.current) bar.current.style.width = `${pixels}px`;
    if (label.current)
      label.current.textContent = formatMinimapDistance(metres);
  });
  return (
    <div
      ref={bar}
      style={{
        ...LABEL,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        boxSizing: 'border-box',
        borderLeft: '1.5px solid #fff',
        borderRight: '1.5px solid #fff',
        borderBottom: '1.5px solid #fff',
        // The label sits on the bottom line.
        paddingBottom: 1,
        filter: 'drop-shadow(0 0 1px #000)',
        minHeight: 13,
      }}
    >
      <span ref={label} />
    </div>
  );
};

// The height over the sea of what the map is centred on, as plain text like the extent: a
// display; the altitude control changes it.
const Altitude = ({ center }: { center: MinimapCenter }) => {
  const marker = center === 'target' ? 'target' : 'camera';
  const label = useRef<HTMLSpanElement>(null);
  useMinimapFrame(({ altitude, targetAltitude }) => {
    if (label.current)
      label.current.textContent = formatMinimapAltitude(
        marker === 'target' ? targetAltitude : altitude,
      );
  });
  return (
    <div
      title={`Height of the ${marker} over the sea`}
      style={{
        ...LABEL,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px',
      }}
    >
      <svg
        width={12}
        height={12}
        viewBox="-6 -6 12 12"
        style={{ display: 'block' }}
      >
        {marker === 'target' ? (
          <MinimapTargetIcon size={10} color="#ffffff" />
        ) : (
          <MinimapCameraIcon size={10} color="#ffffff" />
        )}
      </svg>
      <span ref={label} />
    </div>
  );
};

// The knob's width, and its track's: a hit area wider than the groove it runs in.
const KNOB = 14;
const TRACK_WIDTH = 20;
// How long the knob takes to spring back to the middle, in ms.
const SPRING_MS = 160;

type AltitudeControlProps = {
  options: ResolvedMinimapAltitudeControl;
  center: MinimapCenter;
};

// A slim vertical control fixed on the map, for the height of what the map is centred on:
// pull its knob up to climb, down to descend, and the further from the middle, the faster
// (as the square of the distance, up to the ends of the groove). Let go and it springs back.
// Pressing the groove brings the knob to the pointer; pressing the knob holds it where it was
// grabbed. Escape puts the height back.
const AltitudeControl = ({ options, center }: AltitudeControlProps) => {
  const store = useContext(MinimapContext);
  const kind = center === 'target' ? 'target' : 'camera';
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const [travel, setTravel] = useState(() =>
    altitudeControlTravel(options.dragRange, store?.state.view.size[1] ?? 300),
  );
  const [enabled, setEnabled] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  // A map resized shortens or lengthens the groove; the controls may come or go.
  useMinimapFrame(state => {
    const next = altitudeControlTravel(options.dragRange, state.view.size[1]);
    setTravel(was => (was === next ? was : next));
    const can = store?.host.canDrag() ?? false;
    setEnabled(was => (was === can ? was : can));
  });
  // A drag ends with the item.
  useEffect(() => () => stop.current?.(), []);
  if (!store) return null;

  // Put the knob `offset` pixels from the middle (positive down): the fill from the middle to
  // it, heavier the harder the push.
  const place = (offset: number, push: number) => {
    if (knob.current)
      knob.current.style.transform = `translateY(${offset}px) scale(${1 + 0.15 * push})`;
    if (fill.current) {
      fill.current.style.top = `${travel + KNOB / 2 + Math.min(offset, 0)}px`;
      fill.current.style.height = `${Math.abs(offset)}px`;
      fill.current.style.opacity = String(0.35 + 0.65 * push);
    }
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !store.host.canDrag() || !track.current) return;
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
    const start = store.state;
    const first = kind === 'target' ? start.targetAltitude : start.altitude;
    const range: [number, number] = [options.min, options.max];
    // The height it has been taken to, in metres: the state is only told of a change past a
    // few centimetres, so it is kept here.
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
        options.maxSpeed *
        (atEnd ? boostFactor(held, options.boostTime, options.boost) : 1);
      if (velocity !== 0) {
        height = moveAltitude(height, velocity, dt, range);
        store.host.setAltitude(kind, height, false);
      }
      if (knob.current) knob.current.dataset.offset = String(offset);
      place(offset, Math.abs(rate));
      frame = requestAnimationFrame(tick);
    };
    const onMove = (move: PointerEvent) => pull(move.clientY);
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return;
      store.host.setAltitude(kind, first, false);
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
  };

  const length = 2 * travel + KNOB;
  const edge = '0 0 0 1px rgba(0, 0, 0, 0.5)';
  return (
    <div
      ref={track}
      title={`Altitude control: pull up to climb, down to descend (the ${kind}'s height)`}
      onPointerDown={onDown}
      style={{
        position: 'relative',
        width: TRACK_WIDTH,
        height: length,
        pointerEvents: enabled ? 'auto' : 'none',
        opacity: enabled ? 1 : 0.35,
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
          background: options.color,
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
          background: options.color,
          border: '1.5px solid rgba(0, 0, 0, 0.6)',
          boxShadow: '0 0 3px rgba(0, 0, 0, 0.6)',
        }}
      />
    </div>
  );
};

type MinimapOverlayProps = {
  store: MinimapStore;
  zoom: MinimapZoom;
  center: MinimapCenter;
  orientation: MapOrientation;
  controls: readonly MinimapControl[];
  compass: boolean;
  /** show the altitude readout */
  altitude: boolean;
  /** the altitude control, or null to leave it out */
  altitudeControl: ResolvedMinimapAltitudeControl | null;
  layout?: MinimapLayout;
  onStep: (direction: 1 | -1) => void;
  onAuto: () => void;
  onToggleOrientation: () => void;
  onToggleCenter: () => void;
  onReset: () => void;
  children?: ReactNode;
};

// The CSS that anchors a container: a corner, or the middle of an edge.
function anchorStyle(anchor: MinimapAnchor): CSSProperties {
  if (anchor === 'top-center')
    return { top: 6, left: '50%', transform: 'translateX(-50%)' };
  if (anchor === 'bottom-center')
    return { bottom: 6, left: '50%', transform: 'translateX(-50%)' };
  if (anchor === 'left-center')
    return { left: 6, top: '50%', transform: 'translateY(-50%)' };
  if (anchor === 'right-center')
    return { right: 6, top: '50%', transform: 'translateY(-50%)' };
  return cornerStyle(anchor, [6, 6]);
}

/**
 * What a {@link Minimap} draws over its relief, in a React root of its own: the layers
 * (`children`, in one SVG), and its items, set at the anchors the layout gives them: the
 * compass, the altitude readout and control, the buttons, the extent and the distance bar.
 */
export const MinimapOverlay = ({
  store,
  zoom,
  center,
  orientation,
  controls,
  compass,
  altitude,
  altitudeControl,
  layout,
  onStep,
  onAuto,
  onToggleOrientation,
  onToggleCenter,
  onReset,
  children,
}: MinimapOverlayProps) => {
  const zoomIn = useCallback(() => onStep(1), [onStep]);
  const zoomOut = useCallback(() => onStep(-1), [onStep]);
  const auto = zoom === 'auto';
  const onTarget = center === 'target';
  const buttons: Record<MinimapControl, ReactNode> = {
    'zoom-in': (
      <button
        key="zoom-in"
        type="button"
        style={BUTTON}
        title="Zoom in"
        aria-label="Zoom in"
        onClick={zoomIn}
      >
        +
      </button>
    ),
    'zoom-out': (
      <button
        key="zoom-out"
        type="button"
        style={BUTTON}
        title="Zoom out"
        aria-label="Zoom out"
        onClick={zoomOut}
      >
        −
      </button>
    ),
    'zoom-auto': (
      <button
        key="zoom-auto"
        type="button"
        style={{
          ...BUTTON,
          fontSize: 11,
          borderColor: auto ? ACTIVE : IDLE,
          color: auto ? ACTIVE : '#fff',
        }}
        title="Zoom with the camera's height"
        aria-label="Automatic zoom"
        aria-pressed={auto}
        onClick={onAuto}
      >
        A
      </button>
    ),
    center: (
      <button
        key="center"
        type="button"
        style={BUTTON}
        title={
          (onTarget
            ? 'Centred on what the camera looks at: click to centre on the camera'
            : 'Centred on the camera: click to centre on what it looks at') +
          '. Double-click to send the camera home.'
        }
        aria-label={onTarget ? 'Centred on target' : 'Centred on camera'}
        aria-pressed={onTarget}
        onClick={onToggleCenter}
        onDoubleClick={onReset}
      >
        <svg
          width={22}
          height={22}
          viewBox="-11 -11 22 22"
          style={{ display: 'block' }}
        >
          {onTarget ? (
            <MinimapTargetIcon size={16} color="#ffffff" />
          ) : (
            <MinimapCameraIcon size={16} color="#ffffff" />
          )}
        </svg>
      </button>
    ),
  };

  const shown: MinimapItem[] = ['extent', 'distance'];
  if (compass) shown.unshift('compass');
  if (altitude) shown.push('altitude');
  if (altitudeControl) shown.push('altitudeControl');
  if (controls.length > 0) shown.push('controls');
  const groups = resolveMinimapLayout(shown, layout);

  const item = (name: MinimapItem, direction: 'row' | 'column') => {
    switch (name) {
      case 'compass':
        return (
          <Compass
            key={name}
            orientation={orientation}
            onToggle={onToggleOrientation}
          />
        );
      case 'altitude':
        return <Altitude key={name} center={center} />;
      case 'altitudeControl':
        return altitudeControl ? (
          <AltitudeControl
            key={name}
            options={altitudeControl}
            center={center}
          />
        ) : null;
      case 'controls':
        return (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: direction,
              gap: 3,
              pointerEvents: 'auto',
            }}
          >
            {controls.map(control => buttons[control])}
          </div>
        );
      case 'extent':
        return <Extent key={name} />;
      default:
        return <Distance key={name} />;
    }
  };

  return (
    <MinimapContext.Provider value={store}>
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {children}
      </svg>
      {[...groups].map(([anchor, entries]) => (
        <div
          key={anchor}
          style={{
            position: 'absolute',
            ...anchorStyle(anchor),
            display: 'flex',
            // The first nearest the edge.
            flexDirection: anchor.startsWith('bottom')
              ? 'column-reverse'
              : 'column',
            alignItems:
              anchor === 'top-center' || anchor === 'bottom-center'
                ? 'center'
                : anchor.endsWith('left') || anchor === 'left-center'
                  ? 'flex-start'
                  : 'flex-end',
            gap: 4,
            pointerEvents: 'none',
          }}
        >
          {entries.map(({ item: name, direction }) => item(name, direction))}
        </div>
      ))}
    </MinimapContext.Provider>
  );
};
