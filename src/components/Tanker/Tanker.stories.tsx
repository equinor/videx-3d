import type { ArgTypes, Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { createOceanPlane } from '../../sdk/geometries/ocean-geometry';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Ocean } from '../Ocean';
import { Tanker, type TankerProps } from './Tanker';

type StoryArgs = TankerProps & {
  showOcean: boolean;
  waterOpacity: number;
  windSpeed: number;
};

const hullDefaults = {
  length: 253, // Aframax typical length in meters
  width: 44.2, // Aframax typical beam in meters
  height: 20, // moulded depth keel-to-deck
  waterline: 13, // draft (≈7 m freeboard, partly-laden look)
  lengthSegments: 128,
  profileSegments: 16,
  bowLength: 0.2, // fraction of ship length occupied by the bow
  bowRoundness: 0.6, // 0 = sharp stem, 1 = full/rounded bow at deck level
  details: 'high' as const,
  lowerHullColor: '#7a2b1c',
  upperHullColor: '#23303a',
  deckColor: '#3a7a40',
  stripeColor: '#0d1b2a',
  superstructureColor: '#d8d8d8',
  buoyancy: true,
  weight: 120000,
  contactFoam: true,
  contactFoamIntensity: 1,
  contactFoamEndFalloff: 0.6,
};

const meta = {
  title: 'Components/Misc/Tanker',
  component: Tanker,
  argTypes: {
    length: { control: { type: 'range', min: 50, max: 400, step: 1 } },
    width: { control: { type: 'range', min: 10, max: 80, step: 0.1 } },
    height: { control: { type: 'range', min: 5, max: 40, step: 0.1 } },
    waterline: { control: { type: 'range', min: 2, max: 30, step: 0.1 } },
    lengthSegments: { control: { type: 'range', min: 2, max: 256, step: 1 } },
    profileSegments: { control: { type: 'range', min: 2, max: 64, step: 1 } },
    bowLength: { control: { type: 'range', min: 0.05, max: 0.45, step: 0.01 } },
    bowRoundness: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    details: {
      control: { type: 'inline-radio' },
      options: ['low', 'medium', 'high'],
    },
    lowerHullColor: { control: 'color' },
    upperHullColor: { control: 'color' },
    deckColor: { control: 'color' },
    stripeColor: { control: 'color' },
    superstructureColor: { control: 'color' },
    wireframe: { control: 'boolean' },
    buoyancy: { control: 'boolean' },
    weight: { control: { type: 'range', min: 10000, max: 400000, step: 1000 } },
    contactFoam: { control: 'boolean' },
    contactFoamIntensity: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    contactFoamEndFalloff: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    showOcean: { control: 'boolean' },
    waterOpacity: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    windSpeed: { control: { type: 'range', min: 0, max: 25, step: 0.5 } },
  } as ArgTypes<StoryArgs>,
} satisfies Meta<typeof Tanker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    ...hullDefaults,
    wireframe: false,
    showOcean: true,
    waterOpacity: 0.85,
    windSpeed: 12,
  } as StoryArgs,
  parameters: {
    autoClear: true,
    cameraPosition: [80, 200, 150],
  },
  render: args => {
    const { showOcean, waterOpacity, windSpeed, ...tankerArgs } =
      args as StoryArgs;
    const oceanGeo = useMemo(
      () => createOceanPlane({ size: 1000, surfaceSegments: 64 }),
      [],
    );
    return (
      <>
        <axesHelper />
        {showOcean ? (
          <Ocean
            geometry={oceanGeo}
            windSpeed={windSpeed}
            waterOpacity={waterOpacity}
            displacement
          >
            <Tanker {...tankerArgs} />
          </Ocean>
        ) : (
          <Tanker {...tankerArgs} />
        )}
      </>
    );
  },
  decorators: [Canvas3dDecorator],
};
