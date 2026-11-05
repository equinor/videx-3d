import { useFrame, useThree } from '@react-three/fiber';
import { Ref, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Camera, Plane, Ray, Sphere, Vector2, Vector3 } from 'three';
import { SCENERY_EARTH_RADIUS } from '../../components/Scenery/scenery-model';
import { useWorldRelief } from '../../components/World/world-relief';
import { CameraLookAtEvent } from '../../events/camera-events';
import { Vec3 } from '../../sdk';
import type { Globe } from '../../sdk/projection/globe';
import { applyCameraUp } from '../../sdk/utils/camera';
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
/**
 * {@link SceneryDebugPanelProps.altitudes} on from 100 km to where weather systems are seen
 * whole.
 */
export const SCENERY_DEBUG_HIGH_ALTITUDES: [string, number][] = [
  ...ALTITUDES,
  ['400 km', 400000],
  ['1000 km', 1000000],
  ['4000 km', 4000000],
];
const SPEEDS = [0.25, 1, 3];
// The whole Earth's view: this high over the point under the camera.
const EARTH_VIEW_HEIGHT = 4000000;

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

/**
 * Where a double-click on the ground or the sea takes the camera ({@link SceneryDebugPanelProps}):
 * `height` over the ground there (the highest within a kilometre, or the sea), looking along
 * the view's bearing at a point `ahead` on and `lookAt` over the sea, never below the
 * camera, its horizon level.
 */
export type SceneryDebugFly = {
  height: number;
  lookAt: number;
  ahead: number;
};

export type SceneryDebugPanelProps = {
  /** what the sky is drawn from: the sun, and whether its horizon is curved */
  args: SceneryArgs;
  /** the sea's height. Default 0. */
  level?: number;
  /** places to move over, `[x, z]` by name */
  positions?: Record<string, [number, number]>;
  timelapse?: SceneryDebugTimelapse;
  /** the altitudes to move to, by name. Default 2 m to 100 km */
  altitudes?: [string, number][];
  /** double-click the ground or the sea to go there (see {@link SceneryDebugFly}) */
  fly?: SceneryDebugFly;
};

const ndc = new Vector2();
const ray = new Ray();
const sphere = new Sphere();
const plane = new Plane();
const hit = new Vector3();
const probe = new Vector3();
const geographic = { latitude: 0, longitude: 0 };

// The ground's height over the sea (metres), by longitude and latitude; null where unknown.
type HeightAt = (longitude: number, latitude: number) => number | null;

// What a double-click lands on over the globe at scene point `p`: the relief's ground, or
// the sea over it or where there is none.
const surfaceUnder = (globe: Globe, heightAt: HeightAt, p: Vector3) => {
  globe.geographic(p, geographic);
  return Math.max(heightAt(geographic.longitude, geographic.latitude) ?? 0, 0);
};

// How far along `ray` it comes down to `height` over the sea: on the globe's sphere (beyond
// the disc; over it the sea's plane lies lower, which the margins below take in), or its
// plane while the globe is off. 0 from below it; where the ray never comes down to it,
// where it comes closest (on the globe) or null.
function reachAlong(globe: Globe, level: number, height: number) {
  if (globe.enabled) {
    const radius = globe.radius + height;
    if (ray.origin.distanceTo(globe.centre) <= radius) return 0;
    if (ray.intersectSphere(sphere.set(globe.centre, radius), hit))
      return ray.origin.distanceTo(hit);
    return Math.max(
      probe.subVectors(globe.centre, ray.origin).dot(ray.direction),
      0,
    );
  }
  if (globe.altitude(ray.origin) <= height) return 0;
  if (ray.intersectPlane(plane.set(SCENE_UP, -(level + height)), hit))
    return ray.origin.distanceTo(hit);
  return null;
}

// Where the view along `ray` first meets the relief's ground or the sea: stepped from where
// it comes down to `highest` to just past where it meets the sea, then halved. Null where it
// meets neither.
function traceSurface(
  globe: Globe,
  heightAt: HeightAt,
  level: number,
  highest: number,
): Vector3 | null {
  const below = (t: number) => {
    ray.at(t, probe);
    return globe.altitude(probe) <= surfaceUnder(globe, heightAt, probe);
  };
  const start = reachAlong(globe, level, highest + FLY_SEA_MARGIN);
  const end = reachAlong(globe, level, -FLY_SEA_MARGIN);
  if (start === null || end === null || end <= start) return null;
  const steps = 384;
  let previous = start;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    if (below(t)) {
      if (i === 0) return ray.at(t, new Vector3());
      let a = previous;
      let b = t;
      for (let k = 0; k < 24; k++) {
        const m = 0.5 * (a + b);
        if (below(m)) b = m;
        else a = m;
      }
      return ray.at(b, new Vector3());
    }
    previous = t;
  }
  return null;
}

// Metres below the sea the trace goes on to: over the disc the sea's plane lies below the
// globe's sphere (by under a kilometre for a disc of 100 km).
const FLY_SEA_MARGIN = 2000;
// Around a double-click's point, how far out the camera is kept clear of the ground.
const FLY_CLEAR = [500, 1000];

/**
 * Buttons over the canvas, top right, for a sky story: the camera's height, moves to set
 * altitudes, places and views, and a timelapse. A move keeps the view's angle to the horizon.
 * With `fly`, a double-click on the ground or the sea takes the camera there.
 */
export const SceneryDebugPanel = ({
  args,
  level = 0,
  positions,
  timelapse,
  altitudes = ALTITUDES,
  fly,
}: SceneryDebugPanelProps) => {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const controls = useThree(state => state.controls);
  // The World's relief, for a double-click to land on its ground.
  const relief = useWorldRelief();
  const root = useRef<Root | null>(null);
  const readout = useRef<HTMLDivElement>(null);
  const since = useRef(0);
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

  // A double-click: over the ground or the sea where the view meets it, `fly.height` up,
  // looking along the view's bearing at a point `fly.ahead` on and `fly.lookAt` up, the up
  // there first so the controls orbit level about it.
  const flyTo = (event: MouseEvent) => {
    if (!fly) return;
    const rect = gl.domElement.getBoundingClientRect();
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction
      .set(ndc.x, ndc.y, 0.5)
      .unproject(camera)
      .sub(ray.origin)
      .normalize();
    const g = currentGlobe();
    const ground = relief?.tiles.current ?? null;
    const heightAt = g?.frame && ground ? ground.heightAt : null;
    let found: Vector3 | null = null;
    if (g && heightAt)
      found = traceSurface(g, heightAt, level, Math.max(ground?.highest ?? 0, 0));
    else if (
      g && g.enabled
        ? ray.intersectSphere(sphere.set(g.centre, g.radius), hit)
        : ray.intersectPlane(plane.set(SCENE_UP, -level), hit)
    )
      found = hit.clone();
    if (!found) return;
    const foot = g ? g.foot(found, new Vector3()) : found.clone();
    // Clear of the ground about it: the highest within FLY_CLEAR, or the sea.
    let surface = 0;
    if (g && heightAt) {
      for (const radius of [0, ...FLY_CLEAR]) {
        for (let k = 0; k < (radius ? 8 : 1); k++) {
          const angle = (k * Math.PI) / 4;
          g.place(
            foot.x + radius * Math.cos(angle),
            foot.z + radius * Math.sin(angle),
            0,
            probe,
          );
          surface = Math.max(surface, surfaceUnder(g, heightAt, probe));
        }
      }
    }
    const height = surface + fly.height;
    const position = g
      ? g.place(foot.x, foot.z, height, new Vector3())
      : new Vector3(foot.x, level + height, foot.z);
    const up = upAt(g, position);
    const heading = ray.direction
      .clone()
      .addScaledVector(up, -ray.direction.dot(up));
    if (heading.lengthSq() < 1e-8) heading.copy(cameraView(camera, up).heading);
    heading.normalize();
    const target = position
      .clone()
      .addScaledVector(heading, fly.ahead)
      .addScaledVector(up, Math.max(fly.lookAt - height, 0));
    applyCameraUp(
      camera,
      controls,
      g ? g.lookUp(position, new Vector3()) : SCENE_UP.clone(),
    );
    dispatchEvent(
      new CameraLookAtEvent({
        position: position.toArray(),
        target: target.toArray(),
        transition: false,
      }),
    );
  };
  const onDoubleClick = useRef(flyTo);
  useEffect(() => {
    onDoubleClick.current = flyTo;
  });
  useEffect(() => {
    const element = gl.domElement;
    const listener = (event: MouseEvent) => onDoubleClick.current(event);
    element.addEventListener('dblclick', listener);
    return () => element.removeEventListener('dblclick', listener);
  }, [gl]);

  // The whole Earth: EARTH_VIEW_HEIGHT over the point under the camera, looking at the Earth's
  // centre, its up along the Earth's axis, so the controls orbit the globe about its poles.
  const toEarth = () => {
    const g = currentGlobe();
    if (!g || !g.enabled) return;
    const centre = g.centre;
    const conformal = g.uniforms.uGlobeSphere.value;
    // The axis from the conformal sphere's latitude at the disc's centre: sin of it along the
    // up there, cos along true north. Without a frame, the scene's up.
    const axis =
      conformal.w > 0.5
        ? g.up
            .clone()
            .multiplyScalar(conformal.x)
            .addScaledVector(g.north, conformal.y)
        : g.up.clone();
    axis.normalize();
    const out = camera.position.clone().sub(centre);
    if (out.lengthSq() < 1) out.copy(g.up);
    out.normalize();
    // Never straight down the axis, where the orbit has no bearing.
    if (Math.abs(out.dot(axis)) > 0.995)
      out.addScaledVector(new Vector3().crossVectors(axis, g.north).normalize(), 0.1).normalize();
    const position = centre
      .clone()
      .addScaledVector(out, g.radius + EARTH_VIEW_HEIGHT);
    applyCameraUp(camera, controls, axis);
    dispatchEvent(
      new CameraLookAtEvent({
        position: position.toArray(),
        target: centre.toArray(),
        transition: false,
      }),
    );
  };

  const rows: PanelRow[] = [
    {
      label: 'readout',
      buttons: [
        {
          label: showReadout ? 'on' : 'off',
          title:
            'The camera’s height above the sea, the horizon’s dip and the sun’s elevation.',
          on: showReadout,
          click: () => setShowReadout(!showReadout),
        },
      ],
    },
    {
      label: 'altitude',
      buttons: altitudes.map(([label, height]) => ({
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
      ...(args.globe
        ? [
            {
              label: 'earth',
              title:
                'The whole Earth from 4000 km, looking at its centre: orbit it about its poles',
              click: toEarth,
            },
          ]
        : []),
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
    element.textContent =
      `height ${formatHeight(height)}  dip ${(dip(height) / RAD).toFixed(2)}°` +
      `  sun ${sun.elevation.toFixed(1)}°${clock}` +
      (fly ? '\ndouble-click the ground or the sea: fly there' : '');
  });

  return null;
};
