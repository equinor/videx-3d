import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useMemo, useState } from 'react';
import { CameraFlyToEvent } from '../../events/camera-events';
import { geoFrameFromCrs } from '../../sdk/projection/geo-frame';
import {
  sceneryArgs,
  SceneryArgs,
  sceneryArgTypes,
  sceneryDecorators,
  sceneryPropsFromArgs,
  sceneryProgressArgs,
  sceneryReliefArgs,
  SceneryReliefArgs,
  sceneryReliefArgTypes,
  sceneryReliefFromArgs,
} from '../../storybook/components/scenery-controls';
import {
  SCENERY_DEBUG_HIGH_ALTITUDES,
  SceneryDebugPanel,
  useSceneryTimelapse,
} from '../../storybook/components/scenery-debug-panel';
import { SceneryArgsFeatures } from '../../storybook/components/scenery-features';
import { SceneryStoryRendering } from '../../storybook/components/scenery-story-rendering';
import { demoCrs } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import {
  ProgressArgs,
  progressArgTypes,
} from '../../storybook/decorators/progress-decorator';
import { useSurfaceMeta } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { EventEmitter } from '../EventEmitter/EventEmitter';
import { EventEmitterCallbackEvent } from '../EventEmitter/EventEmitterContext';
import { GeoRelief } from '../Layers/GeoRelief';
import { Surface } from '../Surfaces/Surface';
import { UtmArea, UtmPosition } from '../UtmArea';
import { Trajectory } from '../Wellbores/Trajectory/Trajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';
import { Wells } from '../Wellbores/Wells/Wells';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { SceneryStage } from './SceneryStage';
import type { SceneryStageBounds } from './scenery-stage';

// The void as a hollow in the crust under the field (SceneryAbyss's `hollow`), with the field's
// wellbores and a horizon to look at: peel the clouds, the sea and the seabed off and look into
// it from the field, from high up and from space; or put the seabed back and go under it.
// Click a wellbore to fly to it.

const DEPTH = 100;
const BOUNDS: SceneryStageBounds = [-10000, -10000, 10000, 10000];
// Where the field lies: its UtmArea's map, the World's anchor and the hollow's middle.
const crs = demoCrs;
const frame = geoFrameFromCrs(crs);
// The Hugin Fm. top: the reservoir, some 3 km down.
const SURFACE_ID = '1f7c7090ce5eaa5b2aa31e8093c7c3f7';

const colorScale = scaleOrdinal([
  'tomato',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab',
]);

type HollowArgs = {
  panel: boolean;
  wells: boolean;
  wellSize: number;
  surface: boolean;
} & SceneryArgs &
  SceneryReliefArgs &
  ProgressArgs;

// The field's wellbores and its reservoir's top. A click on a wellbore flies the camera to
// where it was clicked: out, across and in (CameraFlyToEvent), the Canvas3dDecorator's
// CameraManager doing the flying.
const Field = ({ args }: { args: HollowArgs }) => {
  const wellbores = useWellboreHeaders();
  const surfaces = useSurfaceMeta();
  const [selected, setSelected] = useState(storyArgs.defaultWellbore);
  const included = useMemo(() => wellbores.map(d => d.id), [wellbores]);
  const surface = useMemo(
    () => surfaces.find(d => d.id === SURFACE_ID) ?? null,
    [surfaces],
  );
  return (
    <UtmArea crsInstance={crs} origin={crs.originUtm}>
      {args.surface && surface && (
        <UtmPosition
          easting={surface.header.xori}
          northing={surface.header.yori}
        >
          <Surface
            meta={surface}
            useColorRamp
            colorRamp={3}
            rampMin={surface.displayMin}
            rampMax={surface.displayMax}
            contours={{ interval: 25, major: 0 }}
          />
        </UtmPosition>
      )}
      {args.wells && (
        <Wells
          wellbores={wellbores}
          included={included}
          renderWellbore={(wellbore, fromMsl) => (
            <UtmPosition
              easting={wellbore.easting}
              northing={wellbore.northing}
            >
              <Wellbore
                id={wellbore.id}
                fromMsl={fromMsl}
                onPointerClick={(event: EventEmitterCallbackEvent) => {
                  setSelected(event.ref);
                  if (!event.position) return;
                  dispatchEvent(
                    new CameraFlyToEvent({
                      destination: {
                        target: event.position,
                        distance: 6000,
                        polar: 65,
                      },
                      retreat: { factor: 1.5, max: 60000 },
                    }),
                  );
                }}
                onPointerEnter={(event: EventEmitterCallbackEvent) => {
                  event.domElement.style.cursor = 'pointer';
                }}
                onPointerLeave={(event: EventEmitterCallbackEvent) => {
                  event.domElement.style.cursor = '';
                }}
              >
                <Trajectory
                  radius={
                    (wellbore.id === selected ? 0.2 : 0.1) * args.wellSize
                  }
                  color={colorScale(wellbore.well)}
                />
              </Wellbore>
            </UtmPosition>
          )}
        />
      )}
    </UtmArea>
  );
};

const HollowStory = (storyArgs: HollowArgs) => {
  const { args, timelapse } = useSceneryTimelapse(storyArgs);
  const relief = sceneryReliefFromArgs(args);
  return (
    <EventEmitter>
      <World frame={frame} globe={args.globe}>
        <SceneryStoryRendering args={args} />
        {args.panel && (
          <SceneryDebugPanel
            args={args}
            timelapse={timelapse}
            altitudes={SCENERY_DEBUG_HIGH_ALTITUDES}
          />
        )}
        <Scenery {...sceneryPropsFromArgs(args)}>
          <SceneryArgsFeatures
            args={args}
            ocean={{ level: 0, depth: DEPTH }}
            abyss={{}}
          />
          <SceneryStage boundary={BOUNDS} />
        </Scenery>
        {relief && <GeoRelief {...relief} depth={DEPTH} />}
        <Field args={args} />
      </World>
    </EventEmitter>
  );
};

const meta = {
  title: 'Spikes/Scenery/Hollow',
  component: HollowStory,
  decorators: [
    Canvas3dDecorator,
    // The relief's, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    // From under the seabed to the whole Earth.
    far: 50000000,
    // Over the field from some 6 km, 14 km off, looking down at the wells into the hollow.
    cameraPosition: [-10000, 6000, 9000],
    cameraTarget: [0, -2500, 0],
    ownLighting: () => true,
  },
  argTypes: {
    ...sceneryArgTypes({ debug: true }),
    ...sceneryReliefArgTypes(),
    ...progressArgTypes,
    panel: {
      control: { type: 'boolean' },
      description:
        'Buttons over the canvas: the camera\u2019s height, moves to set altitudes up to 4000 km, views, and a timelapse of the sun.',
      table: { category: 'Debug' },
    },
    wells: {
      control: { type: 'boolean' },
      description: 'The field\u2019s wellbores. Click one to fly to it.',
      table: { category: 'Field' },
    },
    wellSize: {
      control: { type: 'range', min: 1, max: 200, step: 1 },
      description: 'How thick the wellbores are drawn.',
      table: { category: 'Field' },
    },
    surface: {
      control: { type: 'boolean' },
      description: 'The Hugin Fm. top, the reservoir some 3 km down.',
      table: { category: 'Field' },
    },
  },
  args: {
    ...sceneryArgs,
    ...sceneryReliefArgs,
    ...sceneryProgressArgs,
    // Peeled down to the void: no water, no seabed.
    skyWater: false,
    skySeabed: false,
    relief: true,
    stats: true,
    panel: false,
    wells: true,
    wellSize: 50,
    surface: true,
  },
} satisfies Meta<typeof HollowStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Over the field from some 6 km, the seabed peeled: the wells over the hollow. */
export const Default: Story = {};

/** From 1500 km up, over the field. */
export const High: Story = {
  parameters: {
    cameraPosition: [0, 1500000, 1800000],
    cameraTarget: [0, 0, 0],
  },
};

/** The whole Earth from some 20 000 km. */
export const Earth: Story = {
  parameters: {
    cameraPosition: [0, 14000000, 14000000],
    cameraTarget: [0, 0, 0],
  },
};

/** With the seabed on, from 2 km under it: the closed void, lit by its floor. */
export const Inside: Story = {
  args: { skySeabed: true, skyWater: true },
  parameters: {
    cameraPosition: [-12000, -2100, 4000],
    cameraTarget: [600, -2600, -1200],
  },
};
