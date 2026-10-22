import { useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import {
  skyAbyssFromArgs,
  skyArgs,
  SkyArgs,
  skyArgTypes,
  skyDecorators,
  skyOceanFromArgs,
  skyPropsFromArgs,
  skyReliefArgs,
  SkyReliefArgs,
  skyReliefArgTypes,
  skyReliefFrame,
  skyReliefFromArgs,
  skySunPosition,
} from '../../storybook/components/sky-controls';
import {
  formatSkyHour,
  useSunClock,
} from '../../storybook/components/sky-debug-panel';
import { SkyStoryRendering } from '../../storybook/components/sky-story-rendering';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
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
  tanker: boolean;
} & SkyArgs &
  SkyReliefArgs;

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
  const { hour } = useSunClock(args.sunHour, args.playing, args.speed);

  const sunArgs = { ...args, sunFromTime: true, sunHour: hour };
  const { elevation } = skySunPosition(sunArgs);
  // Kept out of the clock's re-render every frame.
  const tanker = useMemo(
    () => args.tanker && <Tanker position={[0, 0, -900]} />,
    [args.tanker],
  );

  return (
    <>
      <SkyStoryRendering args={args} />
      <Sky
        {...skyPropsFromArgs(sunArgs)}
        abyss={skyAbyssFromArgs(args)}
        ocean={{ ...skyOceanFromArgs(args), level: 0, depth: DEPTH }}
      >
        <SkyBoxStage
          bounds={BOUNDS}
          relief={skyReliefFromArgs(args, skyReliefFrame(args))}
        />
        {tanker}
      </Sky>
      <ClockOverlay
        text={`${args.sunDate}  ${formatSkyHour(hour)} solar time  sun ${elevation.toFixed(1)}\u00b0`}
      />
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
  decorators: [
    Canvas3dDecorator,
    // The relief's, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...skyDecorators,
  ],
  parameters: {
    scale: 1000,
    // Past the horizon from 100 km up (1130 km), so the stage and its relief reach it.
    far: 3000000,
    // Low over the water, looking south and a little up: the sun crosses the view about noon.
    cameraPosition: [0, 40, -1500],
    cameraTarget: [0, 360, 0],
    ownLighting: () => true,
  },
  argTypes: {
    ...skyArgTypes(),
    ...skyReliefArgTypes(),
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
    // The clock always sets the sun.
    sunFromTime: hidden,
    sunAzimuth: hidden,
    sunElevation: hidden,
    tanker: {
      control: { type: 'boolean' },
      description:
        'A tanker riding the sky’s waves, with a foam collar where it meets the water: inside a `Sky`, floating components work as inside an `Ocean`.',
      table: { category: 'Sea' },
    },
  },
  args: {
    ...skyArgs,
    ...skyReliefArgs,
    playing: true,
    speed: 0.5,
    sunFromTime: true,
    sunHour: 5,
    clouds: true,
    // Sooner than the Sky's own 1000, so the light keeps up with the sun.
    captureMaxWait: 250,
    tanker: true,
  },
} satisfies Meta<typeof SkyTimelapse>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Timelapse: Story = {};
