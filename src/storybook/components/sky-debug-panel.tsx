import { useFrame, useThree } from '@react-three/fiber';
import { Ref, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Camera, Mesh, Object3D, Vector3 } from 'three';
import { SKY_EARTH_RADIUS } from '../../components/Sky/sky-model';
import { CameraLookAtEvent } from '../../events/camera-events';
import { Vec3 } from '../../sdk';
import { directionFromCompass } from '../../sdk/utils/vector-operations';
import { SkyArgs, skyArgs, skySunPosition } from './sky-controls';

/** `hour` of the day as `hh:mm`. */
export const formatSkyHour = (hour: number) => {
  const minutes = Math.floor(hour * 60) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
};

/**
 * A clock from `start`, in local solar hours, running `speed` hours a second while
 * `playing`. A new `start` sets it, and so does `reset`.
 */
export function useSunClock(start: number, playing: boolean, speed: number) {
  const [hour, setHour] = useState(start);
  const clock = useRef(start);
  const reset = useCallback(() => {
    clock.current = start;
    setHour(start);
  }, [start]);
  useEffect(reset, [reset]);
  useFrame((_, delta) => {
    if (!playing || speed <= 0) return;
    // Capped, so the frame after a stall does not skip hours.
    clock.current = (clock.current + Math.min(delta, 0.1) * speed) % 24;
    setHour(clock.current);
  });
  return { hour, reset };
}

/**
 * A timelapse of a story's sun, for {@link SkyDebugPanel}: `args` with the sun set by the
 * clock once it has run, until it is reset.
 */
export function useSkyTimelapse<T extends SkyArgs>(args: T) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Storybook drops the time and place from the args while the sun is set by hand.
  const start = args.sunHour ?? skyArgs.sunHour;
  const clock = useSunClock(start, playing, speed);
  const timed = playing || clock.hour !== start;
  const timelapse: SkyDebugTimelapse = {
    playing,
    speed,
    setPlaying,
    setSpeed,
    reset: clock.reset,
  };
  return {
    args: timed
      ? {
          ...args,
          sunFromTime: true,
          sunDate: args.sunDate ?? skyArgs.sunDate,
          sunHour: clock.hour,
          sunLatitude: args.sunLatitude ?? skyArgs.sunLatitude,
          sunLongitude: args.sunLongitude ?? skyArgs.sunLongitude,
        }
      : args,
    timelapse,
  };
}

const RAD = Math.PI / 180;
const STEEPEST = 89.9 * RAD;
// The target sits this close, so orbiting turns the view about the camera.
const REACH = 1000;
const ALTITUDES: [string, number][] = [
  ['2 m', 2],
  ['40 m', 40],
  ['500 m', 500],
  ['3 km', 3000],
  ['10 km', 10000],
  ['20 km', 20000],
  ['45 km', 45000],
  ['100 km', 100000],
];
const SPEEDS = [0.25, 1, 3];

const PANEL = {
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  padding: '6px',
  font: '12px sans-serif',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.45)',
  borderRadius: '3px',
} as const;
const ROW = { display: 'flex', alignItems: 'center', gap: '3px' } as const;
const LABEL = { width: '62px' } as const;
const READOUT = { font: '12px monospace', whiteSpace: 'pre' } as const;
const BUTTON = {
  fontSize: '11px',
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  padding: '1px 5px',
} as const;
const ON = { ...BUTTON, fontWeight: 'bold' } as const;

type PanelButton = {
  label: string;
  title?: string;
  on?: boolean;
  click: () => void;
};
type PanelRow = { label: string; buttons: PanelButton[] };

const PanelView = ({
  rows,
  readout,
}: {
  rows: PanelRow[];
  readout: Ref<HTMLDivElement> | null;
}) => (
  <div style={PANEL}>
    {readout && <div ref={readout} style={READOUT} />}
    {rows.map(row => (
      <div key={row.label} style={ROW}>
        <span style={LABEL}>{row.label}</span>
        {row.buttons.map(button => (
          <button
            key={button.label}
            title={button.title}
            style={button.on ? ON : BUTTON}
            onClick={button.click}
          >
            {button.label}
          </button>
        ))}
      </div>
    ))}
  </div>
);

const formatHeight = (height: number) =>
  Math.abs(height) < 1000
    ? `${height.toFixed(0)} m`
    : `${(height / 1000).toFixed(2)} km`;

// The camera's bearing over the sea and its angle above the horizontal.
function cameraView(camera: Camera) {
  const forward = camera.getWorldDirection(new Vector3());
  const heading = new Vector3(forward.x, 0, forward.z);
  // Looking straight down the bearing is the top of the screen.
  if (heading.lengthSq() < 1e-6)
    heading.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);
  if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1);
  return {
    heading: heading.normalize(),
    pitch: Math.asin(Math.min(Math.max(forward.y, -1), 1)),
  };
}

function lookFrom(position: Vec3, heading: Vector3, pitch: number) {
  const angle = Math.min(Math.max(pitch, -STEEPEST), STEEPEST);
  const level = REACH * Math.cos(angle);
  dispatchEvent(
    new CameraLookAtEvent({
      position,
      target: [
        position[0] + level * heading.x,
        position[1] + REACH * Math.sin(angle),
        position[2] + level * heading.z,
      ],
      transition: false,
    }),
  );
}

export type SkyDebugTimelapse = {
  playing: boolean;
  speed: number;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  /** set the clock back to the story's hour */
  reset: () => void;
};

export type SkyDebugPanelProps = {
  /** what the sky is drawn from: the sun, and whether its horizon is curved */
  args: SkyArgs;
  /** the sea's height. Default 0. */
  level?: number;
  /** places to move over, `[x, z]` by name */
  positions?: Record<string, [number, number]>;
  timelapse?: SkyDebugTimelapse;
};

/**
 * Buttons over the canvas, top right, for a sky story: the camera's height, moves to set
 * altitudes, places and views, and a timelapse. A move keeps the view's angle to the horizon.
 */
export const SkyDebugPanel = ({
  args,
  level = 0,
  positions,
  timelapse,
}: SkyDebugPanelProps) => {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const root = useRef<Root | null>(null);
  const readout = useRef<HTMLDivElement>(null);
  const since = useRef(0);
  const walls = useRef<Object3D | undefined>(undefined);
  const [showReadout, setShowReadout] = useState(true);

  const sun = skySunPosition(args);
  const dip = (height: number) =>
    args.curvedHorizon && height > 0
      ? Math.acos(SKY_EARTH_RADIUS / (SKY_EARTH_RADIUS + height))
      : 0;

  // Over `x, z` at `height` above the sea, `under` below the horizon along `heading`.
  const moveTo = (
    x: number,
    z: number,
    height: number,
    heading: Vector3,
    under: number,
  ) => lookFrom([x, level + height, z], heading, -dip(height) - under);

  const move = (to: { x?: number; z?: number; height?: number }) => {
    const { heading, pitch } = cameraView(camera);
    const height = camera.position.y - level;
    moveTo(
      to.x ?? camera.position.x,
      to.z ?? camera.position.z,
      to.height ?? height,
      heading,
      -pitch - dip(height),
    );
  };

  const look = (under: number, heading?: Vector3) => {
    const height = camera.position.y - level;
    moveTo(
      camera.position.x,
      camera.position.z,
      height,
      heading ?? cameraView(camera).heading,
      under,
    );
  };

  const toSun = (away: boolean) => {
    const [x, y, z] = directionFromCompass(sun.azimuth, sun.elevation);
    const heading = new Vector3(x, 0, z);
    if (heading.lengthSq() < 1e-6) heading.copy(cameraView(camera).heading);
    heading.normalize();
    if (away) look(0, heading.negate());
    else lookFrom(camera.position.toArray(), heading, Math.asin(y));
  };

  const rows: PanelRow[] = [
    {
      label: 'readout',
      buttons: [
        {
          label: showReadout ? 'on' : 'off',
          title: 'The camera’s height above the sea, the horizon’s dip, the sun’s elevation, and the triangles the void’s walls are drawn with.',
          on: showReadout,
          click: () => setShowReadout(!showReadout),
        },
      ],
    },
    {
      label: 'altitude',
      buttons: ALTITUDES.map(([label, height]) => ({
        label,
        click: () => move({ height }),
      })),
    },
  ];
  if (positions)
    rows.push({
      label: 'position',
      buttons: Object.entries(positions).map(([label, [x, z]]) => ({
        label,
        click: () => move({ x, z }),
      })),
    });
  rows.push({
    label: 'view',
    buttons: [
      { label: 'horizon', click: () => look(0) },
      {
        label: '30° down',
        title: '30° below the horizon',
        click: () => look(30 * RAD),
      },
      { label: 'down', click: () => look(Math.PI / 2) },
      { label: 'sun', click: () => toSun(false) },
      {
        label: 'away',
        title: 'The horizon away from the sun',
        click: () => toSun(true),
      },
    ],
  });
  if (timelapse)
    rows.push({
      label: 'timelapse',
      buttons: [
        {
          label: timelapse.playing ? 'pause' : 'play',
          on: timelapse.playing,
          click: () => timelapse.setPlaying(!timelapse.playing),
        },
        {
          label: 'reset',
          title: 'Back to the story’s hour and sun',
          click: timelapse.reset,
        },
        ...SPEEDS.map(speed => ({
          label: `${speed} h/s`,
          on: timelapse.speed === speed,
          click: () => timelapse.setSpeed(speed),
        })),
      ],
    });

  useEffect(() => {
    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'absolute',
      top: '10px',
      right: '10px',
      zIndex: '10',
    });
    (gl.domElement.parentElement ?? document.body).appendChild(host);
    const created = createRoot(host);
    root.current = created;
    return () => {
      root.current = null;
      created.unmount();
      host.remove();
    };
  }, [gl]);

  // Every render: the buttons close over this render's camera and sun.
  useEffect(() => {
    root.current?.render(
      <PanelView rows={rows} readout={showReadout ? readout : null} />,
    );
  });

  useFrame((_, delta) => {
    since.current += delta;
    const element = readout.current;
    if (!element || since.current < 0.1) return;
    since.current = 0;
    const height = camera.position.y - level;
    const clock = args.sunFromTime ? `  ${formatSkyHour(args.sunHour)}` : '';
    if (!walls.current?.parent)
      walls.current = scene.getObjectByName('sky:abyss-walls');
    const mesh = walls.current as Mesh | undefined;
    const triangles =
      mesh?.visible && mesh.geometry.index
        ? Math.min(mesh.geometry.drawRange.count, mesh.geometry.index.count) /
          3
        : 0;
    const wallText = mesh
      ? `  walls ${triangles > 0 ? `${(triangles / 1000).toFixed(1)}k tris` : 'off'}`
      : '';
    element.textContent =
      `height ${formatHeight(height)}  dip ${(dip(height) / RAD).toFixed(2)}°` +
      `  sun ${sun.elevation.toFixed(1)}°${clock}${wallText}`;
  });

  return null;
};
