import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { advanceTrack, knots, type Track } from '../../sdk/layers/tracks';
import { geoFrameLocation } from '../../sdk/projection/geo-frame';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { Annotations } from '../Annotations/Annotations';
import { AnnotationsLayer } from '../Annotations/AnnotationsLayer';
import { Scenery } from '../Scenery/Scenery';
import { SceneryOcean } from '../Scenery/SceneryOcean';
import { SceneryStage } from '../Scenery/SceneryStage';
import { Tanker } from '../Tanker/Tanker';
import { World } from '../World/World';
import { TrackLayer } from './TrackLayer';

// Ships about the demo field, as a tracking feed (AIS) would report them: generated, then
// fed a new fix every few seconds — moved on, a little off where dead reckoning put them,
// and turned now and then — which the layer eases into.

const LEVEL = 0;
const DEPTH = 100;
const STAGE_BOUNDS: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];
// Kept within this many metres of the field, inside the stage's flat disc.
const AREA = 5000;
const EARTH_RADIUS = 6371000;
const DEG = Math.PI / 180;
const HOME = geoFrameLocation(demoFrame);

type Ship = Track & { name: string; length: number };

// A small seeded random: the same ships every time.
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  'Nordic Aurora',
  'Stavanger Spirit',
  'North Sea Pioneer',
  'Utsira',
  'Sleipner Star',
  'Viking Tide',
  'Frigg',
  'Heimdal',
  'Gullfaks Trader',
  'Draupner',
  'Ekofisk Voyager',
  'Hugin',
  'Munin',
  'Brage',
  'Troll Carrier',
  'Grane',
];

// Metres east and north of the field's origin.
const offsetOf = (ship: Ship) => [
  (ship.longitude - HOME.longitude) *
  DEG *
  EARTH_RADIUS *
  Math.cos(HOME.latitude * DEG),
  (ship.latitude - HOME.latitude) * DEG * EARTH_RADIUS,
];

function createShips(count: number): Ship[] {
  const next = random(7);
  return Array.from({ length: count }, (_, i) => {
    const r = AREA * Math.sqrt(next());
    const a = next() * 2 * Math.PI;
    return {
      id: i,
      name: NAMES[i % NAMES.length],
      longitude:
        HOME.longitude +
        (r * Math.sin(a)) /
        (EARTH_RADIUS * Math.cos(HOME.latitude * DEG)) /
        DEG,
      latitude: HOME.latitude + (r * Math.cos(a)) / EARTH_RADIUS / DEG,
      speed: knots(6 + next() * 10),
      course: next() * 360,
      length: 150 + next() * 180,
      time: Date.now(),
    };
  });
}

// A new fix for each ship: where it is now, give or take `noise` metres, its course turned
// a little, or back toward the field once it is far out.
function nextFixes(ships: Ship[], noise: number, next: () => number): Ship[] {
  const now = Date.now();
  return ships.map(ship => {
    const at = advanceTrack(ship, (now - (ship.time ?? now)) / 1000);
    const dLat = ((next() - 0.5) * 2 * noise) / EARTH_RADIUS / DEG;
    const dLon =
      ((next() - 0.5) * 2 * noise) /
      (EARTH_RADIUS * Math.cos(at.latitude * DEG)) /
      DEG;
    const moved = {
      ...ship,
      longitude: at.longitude + dLon,
      latitude: at.latitude + dLat,
    };
    const [east, north] = offsetOf(moved);
    let course = (ship.course ?? 0) + (next() - 0.5) * 20;
    if (Math.hypot(east, north) > AREA) {
      const home = (Math.atan2(-east, -north) / DEG + 360) % 360;
      course += (((home - course + 540) % 360) - 180) * 0.5;
    }
    return { ...moved, course: (course + 360) % 360, time: now };
  });
}

type ShipsArgs = {
  count: number;
  moving: boolean;
  feed: boolean;
  feedSeconds: number;
  noise: number;
  smoothing: number;
  labels: boolean;
  buoyancy: boolean;
  maxHeight: number;
};

const ShipsStory = ({
  count,
  moving,
  feed,
  feedSeconds,
  noise,
  smoothing,
  labels,
  buoyancy,
  maxHeight,
}: ShipsArgs) => {
  const [ships, setShips] = useState(() => createShips(count));
  useEffect(() => setShips(createShips(count)), [count]);
  // The feed: new fixes every few seconds while the ships move.
  useEffect(() => {
    if (!feed || !moving) return;
    const next = random(11);
    const timer = setInterval(
      () => setShips(current => nextFixes(current, noise, next)),
      feedSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [feed, moving, feedSeconds, noise]);
  const annotations = useMemo(
    () =>
      labels
        ? {
          layer: 'ships',
          text: (ship: Ship) =>
            `${ship.name} · ${(((ship.speed ?? 0) * 3600) / 1852).toFixed(1)} kn`,
          height: 40,
        }
        : undefined,
    [labels],
  );

  return (
    <World frame={demoFrame}>
      <SceneryGenerators>
        <Annotations maxVisible={50}>
          <AnnotationsLayer id="ships" name="Ships" maxDistance={40000} distanceFactor={1000} />
          <Scenery>
            <SceneryOcean level={LEVEL} depth={DEPTH} />
            <SceneryStage bounds={STAGE_BOUNDS} />
            <TrackLayer
              tracks={ships}
              extrapolate={moving}
              smoothing={smoothing}
              annotations={annotations}
              maxHeight={maxHeight > 0 ? maxHeight : undefined}
            >
              {(ship, ref) => (
                <Tanker
                  ref={ref}
                  length={ship.length}
                  width={ship.length * 0.17}
                  details="low"
                  lengthSegments={48}
                  buoyancy={buoyancy}
                />
              )}
            </TrackLayer>
          </Scenery>
        </Annotations>
      </SceneryGenerators>
    </World>
  );
};

const meta = {
  title: 'Components/Layers/Tracks',
  component: ShipsStory,
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    cameraPosition: [2500, 1800, 4500],
    cameraTarget: [0, LEVEL, 0],
    ownLighting: () => true,
  },
  args: {
    count: 12,
    moving: true,
    feed: true,
    feedSeconds: 5,
    noise: 30,
    smoothing: 2,
    labels: true,
    buoyancy: true,
    maxHeight: 60000,
  },
  argTypes: {
    count: {
      control: { type: 'range', min: 1, max: 40, step: 1 },
      table: { category: 'Data' },
    },
    moving: {
      description:
        'Carried on along their speed and course between fixes (dead reckoning); off, each stays at its fix.',
      table: { category: 'Tracks' },
    },
    feed: {
      description:
        'A new fix for every ship every few seconds, as a live feed would send.',
      table: { category: 'Data' },
    },
    feedSeconds: {
      control: { type: 'range', min: 1, max: 30, step: 1 },
      table: { category: 'Data' },
    },
    noise: {
      control: { type: 'range', min: 0, max: 200, step: 5 },
      description:
        'Metres each fix is off where dead reckoning put the ship: what the layer eases out.',
      table: { category: 'Data' },
    },
    smoothing: {
      control: { type: 'range', min: 0, max: 10, step: 0.5 },
      description: 'Seconds to ease into a new fix (0: jump).',
      table: { category: 'Tracks' },
    },
    labels: {
      description: 'A label per ship on an `Annotations` layer, following it.',
      table: { category: 'Tracks' },
    },
    buoyancy: {
      description: 'The tankers ride the waves.',
      table: { category: 'Tracks' },
    },
    maxHeight: {
      control: { type: 'range', min: 0, max: 200000, step: 1000 },
      description:
        'Above this camera height over the sea the ships are hidden (0: never).',
      table: { category: 'Visibility' },
    },
  },
} satisfies Meta<typeof ShipsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ships: Story = {};
