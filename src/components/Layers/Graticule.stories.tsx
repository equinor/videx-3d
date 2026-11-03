import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  reportReliefProgress,
  SCENERY_DEMO_RELIEF_LAYERS,
} from '../../storybook/components/scenery-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { Scenery } from '../Scenery/Scenery';
import { SceneryOcean } from '../Scenery/SceneryOcean';
import { SceneryStage } from '../Scenery/SceneryStage';
import { World } from '../World/World';
import { GeoGraticule } from './GeoGraticule';
import { GeoRelief } from './GeoRelief';

// Lines on the Earth about the demo field at Volve, with a Scenery or in a World alone, over
// the relief or with none.

const LEVEL = 0;
const DEPTH = 100;
const STAGE_BOUNDS: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];

type GraticuleArgs = {
  scenery: boolean;
  water: boolean;
  relief: boolean;
  drape: boolean;
  height: number;
  latLon: boolean;
  interval: number;
  minSpacing: number;
  latLonLabels: boolean;
  utm: boolean;
  utmLabels: boolean;
  timeZones: boolean;
  timeZoneLabels: boolean;
  color: string;
  thickness: number;
  opacity: number;
  maxHeight: number;
};

const GraticuleStory = ({
  scenery,
  water,
  relief,
  drape,
  height,
  latLon,
  interval,
  minSpacing,
  latLonLabels,
  utm,
  utmLabels,
  timeZones,
  timeZoneLabels,
  color,
  thickness,
  opacity,
  maxHeight,
}: GraticuleArgs) => {
  const lines = { color, thickness };
  const graticule = (
    <GeoGraticule
      latLon={
        latLon && {
          ...lines,
          interval: interval > 0 ? interval : undefined,
          minSpacing,
        }
      }
      utm={utm && { color: '#ffd23f', thickness }}
      timeZones={timeZones && { color: '#7fd6ff', thickness }}
      labels={{
        latLon: latLonLabels,
        utm: utmLabels,
        timeZones: timeZoneLabels,
      }}
      drape={drape}
      height={height}
      opacity={opacity}
      maxHeight={maxHeight > 0 ? maxHeight : undefined}
    />
  );
  return (
    <World frame={demoFrame}>
      <SceneryGenerators>
        {scenery ? (
          <Scenery>
            <SceneryOcean level={LEVEL} depth={DEPTH} water={water} />
            <SceneryStage boundary={STAGE_BOUNDS} />
            {graticule}
          </Scenery>
        ) : (
          graticule
        )}
        <GeoRelief
          layers={relief ? SCENERY_DEMO_RELIEF_LAYERS : []}
          depth={DEPTH}
          color={{ ramp: 'terrain' }}
          onProgress={reportReliefProgress}
        />
      </SceneryGenerators>
    </World>
  );
};

const meta = {
  title: 'Components/Layers/Graticule',
  component: GraticuleStory,
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    cameraPosition: [0, 60000, 90000],
    cameraTarget: [0, LEVEL, 0],
    // With a Scenery its sky lights the scene; without, the decorator's lights.
    ownLighting: (args: GraticuleArgs) => args.scenery,
  },
  args: {
    scenery: true,
    water: true,
    relief: true,
    drape: true,
    height: 0,
    latLon: true,
    interval: 0,
    minSpacing: 120,
    latLonLabels: true,
    utm: true,
    utmLabels: false,
    timeZones: false,
    timeZoneLabels: false,
    color: '#ffffff',
    thickness: 1.5,
    opacity: 1,
    maxHeight: 0,
  },
  argTypes: {
    scenery: {
      description:
        'Inside a `Scenery` (over its sea), or in a `World` alone: the lines need no `Scenery`.',
      table: { category: 'Scene' },
    },
    water: {
      description:
        'The `Scenery`’s sea has water: the lines lie on its surface over the sea, and are hidden from in the water. Without, they lie on the dry seabed.',
      table: { category: 'Scene' },
      if: { arg: 'scenery' },
    },
    relief: {
      description: 'The relief (`GeoRelief`): land and seabed to lie on.',
      table: { category: 'Scene' },
    },
    drape: {
      description:
        'Lie on the relief as drawn; off, flat at `height` over the sea everywhere.',
      table: { category: 'Layer' },
    },
    height: {
      control: { type: 'range', min: -400, max: 1000, step: 10 },
      description:
        'Metres over the sea’s level where the lines lie flat: no relief, or `drape` off.',
      table: { category: 'Layer' },
    },
    latLon: {
      description: 'Latitude and longitude.',
      table: { category: 'Lines' },
    },
    interval: {
      control: { type: 'range', min: 0, max: 10, step: 0.5 },
      description: 'Degrees between lines (0: following the zoom).',
      table: { category: 'Lines' },
      if: { arg: 'latLon' },
    },
    minSpacing: {
      control: { type: 'range', min: 40, max: 400, step: 10 },
      description:
        'Following the zoom, how far apart the lines are at the least where the view is centred, in pixels.',
      table: { category: 'Lines' },
      if: { arg: 'latLon' },
    },
    latLonLabels: {
      description: 'Each line’s name on the sea along it.',
      table: { category: 'Lines' },
      if: { arg: 'latLon' },
    },
    utm: {
      description: 'The UTM zones’ edges and latitude bands.',
      table: { category: 'Lines' },
    },
    utmLabels: {
      description: 'Each UTM zone’s name in its cells.',
      table: { category: 'Lines' },
      if: { arg: 'utm' },
    },
    timeZones: {
      description: 'The nautical time zones, and the date line.',
      table: { category: 'Lines' },
    },
    timeZoneLabels: {
      description: 'Each time zone’s offset in its cells.',
      table: { category: 'Lines' },
      if: { arg: 'timeZones' },
    },
    color: {
      control: { type: 'color' },
      description: 'Latitude and longitude’s.',
      table: { category: 'Style' },
    },
    thickness: {
      control: { type: 'range', min: 0.5, max: 6, step: 0.25 },
      description: 'Width in screen pixels, at any distance.',
      table: { category: 'Style' },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'The whole layer’s.',
      table: { category: 'Style' },
    },
    maxHeight: {
      control: { type: 'range', min: 0, max: 20000000, step: 100000 },
      description:
        'Above this camera height over the sea the lines fade out (0: never).',
      table: { category: 'Visibility' },
    },
  },
} satisfies Meta<typeof GraticuleStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WorldOnly: Story = {
  name: 'World only',
  args: { scenery: false },
};

export const NoRelief: Story = {
  name: 'World only, no relief',
  args: { scenery: false, relief: false },
};
