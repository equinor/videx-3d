import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  skyCutawayArgs,
  SkyCutawayArgs,
  skyCutawayArgTypes,
  skyCutawayDecorator,
  skyCutawayFromArgs,
} from '../../storybook/components/sky-cutaway-controls';
import {
  skyCloudsFromArgs,
  skyMoonFromArgs,
  skyStarsFromArgs,
  skySunArgs,
  SkySunArgs,
  skySunArgTypes,
  skySunFromArgs,
  skySunPosition,
} from '../../storybook/components/sky-sun-controls';
import {
  RendererToneMapping,
  toneMappingArgs,
  ToneMappingArgs,
  toneMappingArgTypes,
} from '../../storybook/components/tone-mapping-controls';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { RenderStats } from '../Html/RenderStats/RenderStats';
import { DEFAULT_OCEAN_WATER_OPACITY } from '../Ocean/ocean-material';
import { Tanker } from '../Tanker/Tanker';
import { Sky } from './Sky';
import { SkyBoxStage } from './SkyBoxStage';
import { SkyStageBounds } from './sky-stage';

// A day over the sea in a few seconds: the sun follows the clock from a date and a place,
// and the moon, the stars and the light follow the sun.

const DEPTH = 100;
const BOUNDS: SkyStageBounds = [-5000, -5000, 5000, 5000];

type TimelapseArgs = {
  playing: boolean;
  speed: number;
  captureMaxWait: number;
  waterOpacity: number;
  windSpeed: number;
  foamAmount: number;
  air: boolean;
  stats: boolean;
  showEnvironment: boolean;
  tanker: boolean;
} & SkySunArgs &
  SkyCutawayArgs &
  ToneMappingArgs;

const formatHour = (hour: number) => {
  const minutes = Math.floor(hour * 60) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
};

// A line of text over the canvas, outside the scene.
const ClockOverlay = ({ text }: { text: string }) => {
  const gl = useThree(state => state.gl);
  const [element] = useState(() => document.createElement('div'));
  useEffect(() => {
    Object.assign(element.style, {
      position: 'absolute',
      left: '10px',
      top: '10px',
      padding: '4px 8px',
      font: '13px monospace',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.45)',
      borderRadius: '3px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    (gl.domElement.parentElement ?? document.body).appendChild(element);
    return () => element.remove();
  }, [gl, element]);
  useEffect(() => {
    element.textContent = text;
  }, [element, text]);
  return null;
};

const SkyTimelapse = (args: TimelapseArgs) => {
  const [hour, setHour] = useState(args.sunHour);
  const clock = useRef(args.sunHour);
  // A new start hour sets the clock.
  useEffect(() => {
    clock.current = args.sunHour;
    setHour(args.sunHour);
  }, [args.sunHour]);
  useFrame((_, delta) => {
    if (!args.playing || args.speed <= 0) return;
    // Capped, so the frame after a stall does not skip hours.
    clock.current = (clock.current + Math.min(delta, 0.1) * args.speed) % 24;
    setHour(clock.current);
  });

  const sunArgs = { ...args, sunFromTime: true, sunHour: hour };
  const { elevation } = skySunPosition(sunArgs);
  // Kept out of the clock's re-render every frame.
  const tanker = useMemo(
    () => args.tanker && <Tanker position={[0, 0, -900]} />,
    [args.tanker],
  );

  return (
    <>
      <RendererToneMapping
        toneMapping={args.toneMapping}
        exposure={args.exposure}
      />
      <Sky
        abyss
        ocean={{
          level: 0,
          depth: DEPTH,
          waterOpacity: args.waterOpacity,
          windSpeed: args.windSpeed,
          foamAmount: args.foamAmount,
        }}
        sun={skySunFromArgs(sunArgs)}
        moon={skyMoonFromArgs(args)}
        stars={skyStarsFromArgs(args)}
        clouds={skyCloudsFromArgs(args)}
        air={args.air}
        cutaway={skyCutawayFromArgs(args)}
        capture={{ maxWait: args.captureMaxWait }}
        debug={args.showEnvironment ? { environment: true } : undefined}
      >
        <SkyBoxStage bounds={BOUNDS} />
        {tanker}
      </Sky>
      <ClockOverlay
        text={`${args.sunDate}  ${formatHour(hour)} solar time  sun ${elevation.toFixed(1)}\u00b0`}
      />
      {args.stats && <RenderStats origin="bottom-left" />}
    </>
  );
};

const range = (
  min: number,
  max: number,
  step: number,
  category: string,
  description: string,
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  table: { category },
});

const hidden = { table: { disable: true } };

const meta = {
  title: 'Components/Misc/Sky',
  component: SkyTimelapse,
  decorators: [Canvas3dDecorator, skyCutawayDecorator],
  parameters: {
    scale: 1000,
    // Low over the water, looking south and a little up: the sun crosses the view about noon.
    cameraPosition: [0, 40, -1500],
    cameraTarget: [0, 360, 0],
    ownLighting: () => true,
  },
  argTypes: {
    ...skySunArgTypes(),
    playing: {
      control: { type: 'boolean' },
      description: 'Run the clock.',
      table: { category: 'Timelapse' },
    },
    speed: range(
      0,
      6,
      0.05,
      'Timelapse',
      'Hours of the day per second. The day loops.',
    ),
    sunHour: range(
      0,
      24,
      0.05,
      'Timelapse',
      'The hour the clock starts at, local solar time: 12 is noon. Changing it sets the clock.',
    ),
    sunDate: {
      control: { type: 'text' },
      description: 'The date, as `YYYY-MM-DD`.',
      table: { category: 'Timelapse' },
    },
    sunLatitude: range(
      -90,
      90,
      0.1,
      'Timelapse',
      'Degrees north. Far north in June the sun never sets; in December it never rises.',
    ),
    sunLongitude: range(-180, 180, 0.1, 'Timelapse', 'Degrees east.'),
    captureMaxWait: range(
      0,
      2000,
      50,
      'Timelapse',
      'Longest the environment and the light probe go without a bake while the sun moves, in milliseconds. Lower lights the scene more smoothly, at more cost.',
    ),
    sunFromTime: hidden,
    sunAzimuth: hidden,
    sunElevation: hidden,
    waterOpacity: range(0, 1, 0.01, 'Sea', 'The water\u2019s own opacity.'),
    windSpeed: range(0, 25, 0.5, 'Sea', 'Drives the waves, in m/s.'),
    foamAmount: range(0, 1, 0.01, 'Sea', 'Whitecaps on the waves.'),
    air: {
      control: { type: 'boolean' },
      description:
        'The air thins with height: climbing, the sky deepens and its haze closes onto the horizon. Seen from low down, the far sea fades into the horizon.',
      table: { category: 'Sky' },
    },
    ...skyCutawayArgTypes(),
    ...toneMappingArgTypes(),
    tanker: {
      control: { type: 'boolean' },
      description:
        'A tanker riding the sky’s waves, with a foam collar where it meets the water: inside a `Sky`, floating components work as inside an `Ocean`.',
      table: { category: 'Sea' },
    },
    stats: {
      control: { type: 'boolean' },
      description:
        'GPU time, frame time and FPS, draw calls, triangles and resident geometries, textures and programs.',
      table: { category: 'Debug' },
    },
    showEnvironment: {
      control: { type: 'boolean' },
      description:
        'The environment\u2019s bake for the zone in view as its six faces, lower right: `+Y` over `-X -Z +X +Z`, `-Y` under. Watch it follow the sun.',
      table: { category: 'Debug' },
    },
  },
  args: {
    ...skySunArgs,
    ...skyCutawayArgs,
    ...toneMappingArgs,
    playing: true,
    speed: 0.5,
    sunFromTime: true,
    sunHour: 5,
    clouds: true,
    // Sooner than the Sky's own 1000, so the light keeps up with the sun.
    captureMaxWait: 250,
    waterOpacity: DEFAULT_OCEAN_WATER_OPACITY,
    windSpeed: 10,
    foamAmount: 0.5,
    air: true,
    stats: false,
    showEnvironment: false,
    tanker: true,
  },
} satisfies Meta<typeof SkyTimelapse>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Timelapse: Story = {};
