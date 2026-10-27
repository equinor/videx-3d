import { useFrame, useThree } from '@react-three/fiber';
import { Ref, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Camera, Mesh, Object3D, Vector3 } from 'three';
import { SCENERY_EARTH_RADIUS } from '../../components/Scenery/scenery-model';
import { CameraLookAtEvent } from '../../events/camera-events';
import { Vec3 } from '../../sdk';
import type { Globe } from '../../sdk/projection/globe';
import { directionFromCompass } from '../../sdk/utils/vector-operations';
import { findSceneGlobe } from '../debug/globe';
import { SceneryArgs, sceneryArgs, skySunPosition } from './scenery-controls';

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
 * A timelapse of a story's sun, for {@link SceneryDebugPanel}: `args` with the sun set by the
 * clock once it has run, until it is reset.
 */
export function useSceneryTimelapse<T extends SceneryArgs>(args: T) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Storybook drops the time and place from the args while the sun is set by hand.
  const start = args.sunHour ?? sceneryArgs.sunHour;
  const clock = useSunClock(start, playing, speed);
  const timed = playing || clock.hour !== start;
  const timelapse: SceneryDebugTimelapse = {
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
          sunDate: args.sunDate ?? sceneryArgs.sunDate,
          sunHour: clock.hour,
          sunLatitude: args.sunLatitude ?? sceneryArgs.sunLatitude,
          sunLongitude: args.sunLongitude ?? sceneryArgs.sunLongitude,
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

const SCENE_UP = new Vector3(0, 1, 0);

// Up where the camera is: the globe's there, else the scene's.
const upAt = (globe: Globe | null, position: Vector3) =>
  globe ? globe.upAt(position, new Vector3()) : SCENE_UP.clone();

// The camera's bearing over the sea and its angle above the horizontal, about `up`.
function cameraView(camera: Camera, up: Vector3) {
  const forward = camera.getWorldDirection(new Vector3());
  const along = forward.dot(up);
  const heading = forward.clone().addScaledVector(up, -along);
  // Looking straight down the bearing is the top of the screen.
  if (heading.lengthSq() < 1e-6) {
    heading.set(0, 1, 0).applyQuaternion(camera.quaternion);
    heading.addScaledVector(up, -heading.dot(up));
  }
  if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1);
  return {
    heading: heading.normalize(),
    pitch: Math.asin(Math.min(Math.max(along, -1), 1)),
  };
}

function lookFrom(
  position: Vec3,
  heading: Vector3,
  pitch: number,
  up: Vector3 = SCENE_UP,
) {
  const angle = Math.min(Math.max(pitch, -STEEPEST), STEEPEST);
  const level = REACH * Math.cos(angle);
  const rise = REACH * Math.sin(angle);
  dispatchEvent(
    new CameraLookAtEvent({
      position,
      target: [
        position[0] + level * heading.x + rise * up.x,
        position[1] + level * heading.y + rise * up.y,
        position[2] + level * heading.z + rise * up.z,
      ],
      transition: false,
    }),
  );
}

export type SceneryDebugTimelapse = {
  playing: boolean;
  speed: number;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  /** set the clock back to the story's hour */
  reset: () => void;
};

export type SceneryDebugPanelProps = {
  /** what the sky is drawn from: the sun, and whether its horizon is curved */
  args: SceneryArgs;
  /** the sea's height. Default 0. */
  level?: number;
  /** places to move over, `[x, z]` by name */
  positions?: Record<string, [number, number]>;
  timelapse?: SceneryDebugTimelapse;
};

/**
 * Buttons over the canvas, top right, for a sky story: the camera's height, moves to set
 * altitudes, places and views, and a timelapse. A move keeps the view's angle to the horizon.
 */
export const SceneryDebugPanel = ({
  args,
  level = 0,
  positions,
  timelapse,
}: SceneryDebugPanelProps) => {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const root = useRef<Root | null>(null);
  const readout = useRef<HTMLDivElement>(null);
  const since = useRef(0);
  const walls = useRef<Object3D | undefined>(undefined);
  const [showReadout, setShowReadout] = useState(true);

  const sun = skySunPosition(args);

  // The sky's globe, found again whenever there is none yet.
  const globe = useRef<Globe | null>(null);
  const currentGlobe = () => {
    if (!globe.current) globe.current = findSceneGlobe(scene);
    return globe.current;
  };
  const dip = (height: number) => {
    const R = currentGlobe()?.radius ?? SCENERY_EARTH_RADIUS;
    return args.globe && height > 0 ? Math.acos(R / (R + height)) : 0;
  };
  // The map point under the camera and its height over the sea: over the globe with one.
  const where = () => {
    const g = currentGlobe();
    if (!g)
      return {
        x: camera.position.x,
        z: camera.position.z,
        height: camera.position.y - level,
      };
    const foot = g.foot(camera.position, new Vector3());
    return { x: foot.x, z: foot.z, height: g.altitude(camera.position) };
  };

  // Over `x, z` at `height` above the sea (on the globe), `under` below the horizon along
  // `heading`, levelled about the up there.
  const moveTo = (
    x: number,
    z: number,
    height: number,
    heading: Vector3,
    under: number,
  ) => {
    const g = currentGlobe();
    const position = g
      ? g.place(x, z, height, new Vector3())
      : new Vector3(x, level + height, z);
    const up = upAt(g, position);
    const bearing = heading.clone().addScaledVector(up, -heading.dot(up));
    if (bearing.lengthSq() < 1e-12) bearing.copy(heading);
    lookFrom(position.toArray(), bearing.normalize(), -dip(height) - under, up);
  };

  const move = (to: { x?: number; z?: number; height?: number }) => {
    const { heading, pitch } = cameraView(
      camera,
      upAt(currentGlobe(), camera.position),
    );
    const here = where();
    moveTo(
      to.x ?? here.x,
      to.z ?? here.z,
      to.height ?? here.height,
      heading,
      -pitch - dip(here.height),
    );
  };

  const look = (under: number, heading?: Vector3) => {
    const here = where();
    moveTo(
      here.x,
      here.z,
      here.height,
      heading ??
        cameraView(camera, upAt(currentGlobe(), camera.position)).heading,
      under,
    );
  };

  const toSun = (away: boolean) => {
    const up = upAt(currentGlobe(), camera.position);
    const sunWay = new Vector3(
      ...directionFromCompass(sun.azimuth, sun.elevation),
    );
    const heading = sunWay.clone().addScaledVector(up, -sunWay.dot(up));
    if (heading.lengthSq() < 1e-6) heading.copy(cameraView(camera, up).heading);
    heading.normalize();
    if (away) look(0, heading.negate());
    else
      lookFrom(
        camera.position.toArray(),
        heading,
        Math.asin(Math.min(Math.max(sunWay.dot(up), -1), 1)),
        up,
      );
  };

  const rows: PanelRow[] = [
    {
      label: 'readout',
      buttons: [
        {
          label: showReadout ? 'on' : 'off',
          title:
            'The camera’s height above the sea, the horizon’s dip, the sun’s elevation, and the triangles the void’s walls are drawn with.',
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
    const height = where().height;
    const clock = args.sunFromTime ? `  ${formatSkyHour(args.sunHour)}` : '';
    if (!walls.current?.parent)
      walls.current = scene.getObjectByName('sky:abyss-walls');
    const mesh = walls.current as Mesh | undefined;
    const triangles =
      mesh?.visible && mesh.geometry.index
        ? Math.min(mesh.geometry.drawRange.count, mesh.geometry.index.count) / 3
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
