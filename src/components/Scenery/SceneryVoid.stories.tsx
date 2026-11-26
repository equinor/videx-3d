import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  reportReliefProgress,
  reportSceneryProgress,
  SCENERY_DEMO_RELIEF_LAYERS,
  sceneryDecorators,
  sceneryHiddenArgTypes,
  sceneryProgressArgs,
} from '../../storybook/components/scenery-controls';
import { SceneryDemoField } from '../../storybook/components/scenery-features';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import type { ProgressArgs } from '../../storybook/decorators/progress-decorator';
import storyArgs from '../../storybook/story-args.json';
import { GeoRelief } from '../Layers/GeoRelief';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { ScenerySea } from './ScenerySea';
import { SceneryStage } from './SceneryStage';
import { SceneryVoid } from './SceneryVoid';
import { sceneryDefaults, type SceneryHollowStyle } from './scenery-model';
import type { SceneryStageBounds } from './scenery-stage';

// See documents/void.md.

// The field's water depth: the sea's seabed, the void's lid.
const DEPTH = storyArgs.waterDepth;
// The stage's area, scene X/Z about the field's origin: wide enough to hold its wellbores.
const FIELD_BOUNDS: SceneryStageBounds = [-10000, -10000, 10000, 10000];

type VoidArgs = {
  water: boolean;
  relief: boolean;
  hollow: boolean;
  open: boolean;
  hollowStyle: SceneryHollowStyle;
  hollowRadius: number;
  hollowFloorDepth: number;
  hollowRimWander: number;
  hollowTerraces: number;
} & ProgressArgs;

const VoidStory = ({
  water,
  relief,
  hollow,
  open,
  hollowStyle,
  hollowRadius,
  hollowFloorDepth,
  hollowRimWander,
  hollowTerraces,
}: VoidArgs) => (
  <World frame={demoFrame}>
    <Scenery onProgress={reportSceneryProgress}>
      <ScenerySea level={0} depth={DEPTH} water={water} />
      <SceneryVoid
        hollow={
          hollow && {
            open,
            style: hollowStyle,
            radius: hollowRadius,
            floorDepth: hollowFloorDepth,
            rimWander: hollowRimWander,
            terraces: hollowTerraces,
          }
        }
      />
      <SceneryStage boundary={FIELD_BOUNDS} />
    </Scenery>
    {relief && (
      <GeoRelief
        layers={SCENERY_DEMO_RELIEF_LAYERS}
        depth={DEPTH}
        onProgress={reportReliefProgress}
      />
    )}
    <SceneryDemoField reservoir />
  </World>
);

const toggle = (category: string, description: string) => ({
  control: { type: 'boolean' as const },
  description,
  table: { category },
});

const range = (
  min: number,
  max: number,
  step: number,
  description: string,
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  table: { category: 'Void' },
  if: { arg: 'hollow' },
});

/**
 * The void under a `Scenery`'s seabed (`<SceneryVoid>`). By default it is a hollow in the crust
 * about the field: crater walls down to a floor some 35 km under the seabed. Opening it
 * (`hollow.open`) peels the seabed away inside its rim, with no sea over it, so the data under
 * the field is seen against the crater.
 *
 * With `hollow={false}` it is the plain void: an endless lid overhead and a bottomless gradient
 * below the horizon. Changing any of it recompiles and bakes nothing.
 */
const meta = {
  title: 'Components/Scenery/SceneryVoid',
  component: VoidStory,
  decorators: [
    Canvas3dDecorator,
    // The surfaces' and the relief's, read from the store by generators.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    // From the field to the whole hollow.
    far: 50000000,
    // Over the field from some 6 km, looking down past its wellbores into the hollow.
    cameraPosition: [-10000, 6000, 9000],
    cameraTarget: [0, -2500, 0],
    ownLighting: () => true,
  },
  args: {
    ...sceneryProgressArgs,
    // Peeled: no water, the seabed open over the hollow.
    water: false,
    relief: true,
    hollow: true,
    open: true,
    hollowStyle: sceneryDefaults.void.hollow.style,
    hollowRadius: sceneryDefaults.void.hollow.radius,
    hollowFloorDepth: sceneryDefaults.void.hollow.floorDepth,
    hollowRimWander: sceneryDefaults.void.hollow.rimWander,
    hollowTerraces: sceneryDefaults.void.hollow.terraces,
  },
  argTypes: {
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    water: toggle(
      'Sea',
      'The sea\u2019s water (`ScenerySea` `water`): on, the void is seen through it.',
    ),
    relief: toggle(
      'Relief',
      'The relief (`GeoRelief`), the sea\u2019s seabed: the demo reliefs about the field, land and seabed, cut away over the open hollow. Off, there is no seabed, and the hollow lies open, with no sea over it. Made on demand by `npm run generate-relief`.',
    ),
    hollow: toggle(
      'Void',
      'The void as a hollow in the crust under the field (`hollow`). Off, the plain void: an endless lid and a bottomless gradient.',
    ),
    open: {
      ...toggle(
        'Void',
        'Peel the seabed over the hollow (`hollow.open`): the relief is cut away inside its rim and stays whole around it. Off, the seabed is the void\u2019s lid: fly under it to see the void closed.',
      ),
      if: { arg: 'hollow' },
    },
    hollowStyle: {
      control: { type: 'inline-radio' },
      options: ['calm', 'molten', 'simple'],
      description:
        'How it looks (`hollow.style`): CALM, grey rock and dark cracks, a sober backdrop; MOLTEN, a warm floor, its cracks glowing and pulsing; SIMPLE, a diagram, an even slope with depth lines.',
      table: { category: 'Void' },
      if: { arg: 'hollow' },
    },
    hollowRadius: range(
      50000,
      1500000,
      10000,
      'Its rim\u2019s radius along the sea from the field, in metres (`hollow.radius`): at 100 km (the default) it lies at the horizon from some 800 m over the field.',
    ),
    hollowFloorDepth: range(
      5000,
      100000,
      1000,
      'Depth of its floor under the seabed, in metres (`hollow.floorDepth`): about where the mantle begins.',
    ),
    hollowRimWander: range(
      0,
      0.2,
      0.002,
      'How far its rim wanders in and out of its radius, at most, as a share of it (`hollow.rimWander`): bays and headlands, and a ragged edge. 0 for a round rim. The simple style\u2019s is always round. Rebuilds its geometry.',
    ),
    hollowTerraces: range(
      0,
      1,
      0.05,
      'How strongly its walls step down in terraces (`hollow.terraces`): 0 an even face, its buttresses and gullies kept; 1 flat benches between sheer faces. Not the simple style\u2019s even slope. Rebuilds its geometry.',
    ),
  },
} satisfies Meta<typeof VoidStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Over the demo field from some 6 km, the hollow open and the sea drained: the field's
 * wellbores and reservoir against the crater below. Try each `hollowStyle`, shape the hollow
 * (`hollowRadius`, `hollowFloorDepth`, `hollowRimWander`, `hollowTerraces`), or close it
 * (`open`) and fly under the seabed.
 */
export const Default: Story = {};

/**
 * The whole hollow from 400 km up over the field, with the land about it: the place to judge
 * its `hollowRadius` and the bays and headlands of its rim (`hollowRimWander`).
 */
export const Hollow: Story = {
  parameters: {
    cameraPosition: [0, 400000, 480000],
    cameraTarget: [0, 0, 0],
  },
};
