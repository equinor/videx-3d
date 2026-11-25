import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  reportSceneryProgress,
  sceneryDecorators,
  sceneryHiddenArgTypes,
  sceneryProgressArgs,
} from '../../storybook/components/scenery-controls';
import {
  SceneryCutawayArgs,
  sceneryCutawayArgTypes,
  sceneryCutawayArgs,
} from '../../storybook/components/scenery-cutaway-controls';
import { SceneryDemoField } from '../../storybook/components/scenery-features';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import type { ProgressArgs } from '../../storybook/decorators/progress-decorator';
import storyArgs from '../../storybook/story-args.json';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { SceneryCutaway } from './SceneryCutaway';
import { ScenerySea } from './ScenerySea';
import { SceneryStage } from './SceneryStage';
import type { SceneryStageBounds } from './scenery-stage';

// A cut through the sea (`<SceneryCutaway>`, documents/scenery.md): the water and the seabed in
// front of the view taken away, so the field under them, its wellbores and its reservoir, is seen
// clearly; a rim marks the cut's edge and a shadow falls inside it. It follows the camera. Drag
// the grip on the rim to move the edge; a double click puts it back.

// The field's water depth: the sea's seabed.
const DEPTH = storyArgs.waterDepth;
// The stage's area, scene X/Z about the field's origin: wide enough to hold its wellbores.
const FIELD_BOUNDS: SceneryStageBounds = [-10000, -10000, 10000, 10000];

type CutawayArgs = Pick<
  SceneryCutawayArgs,
  | 'cutaway'
  | 'cutawayWater'
  | 'cutawaySeabed'
  | 'cutawayReach'
  | 'cutawayOffset'
  | 'cutawayHandle'
  | 'onCutawayOffset'
> &
  ProgressArgs;

const CutawayStory = ({
  cutaway,
  cutawayWater,
  cutawaySeabed,
  cutawayReach,
  cutawayOffset,
  cutawayHandle,
  onCutawayOffset,
}: CutawayArgs) => (
  <World frame={demoFrame}>
    <Scenery onProgress={reportSceneryProgress}>
      <ScenerySea level={0} depth={DEPTH} />
      <SceneryStage boundary={FIELD_BOUNDS} />
      {cutaway && (
        <SceneryCutaway
          water={cutawayWater}
          seabed={cutawaySeabed}
          reach={cutawayReach}
          offset={cutawayOffset}
          handle={cutawayHandle}
          // The grip's drag, written back into `cutawayOffset` (`sceneryCutawayDecorator`).
          onOffsetChange={onCutawayOffset}
        />
      )}
    </Scenery>
    <SceneryDemoField reservoir />
  </World>
);

const cutawayArgTypes = sceneryCutawayArgTypes();

/**
 * A cut through a `Scenery`'s sea in front of the view (`<SceneryCutaway>`), so what lies
 * under the water and the seabed is seen clearly. The scene itself is never cut.
 */
const meta = {
  title: 'Components/Scenery/SceneryCutaway',
  component: CutawayStory,
  decorators: [
    Canvas3dDecorator,
    // The surfaces', read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    // Past the horizon from 100 km up (1130 km).
    far: 3000000,
    // Over the field from 2 km, looking down along its wellbores.
    cameraPosition: [-6000, 2000, 6000],
    cameraTarget: [0, -1500, 0],
    ownLighting: () => true,
  },
  args: {
    ...sceneryProgressArgs,
    cutaway: true,
    cutawayWater: sceneryCutawayArgs.cutawayWater,
    cutawaySeabed: sceneryCutawayArgs.cutawaySeabed,
    cutawayReach: sceneryCutawayArgs.cutawayReach,
    cutawayOffset: sceneryCutawayArgs.cutawayOffset,
    cutawayHandle: sceneryCutawayArgs.cutawayHandle,
  },
  argTypes: {
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    cutaway: cutawayArgTypes.cutaway,
    cutawayWater: cutawayArgTypes.cutawayWater,
    cutawaySeabed: cutawayArgTypes.cutawaySeabed,
    cutawayReach: cutawayArgTypes.cutawayReach,
    cutawayOffset: cutawayArgTypes.cutawayOffset,
    cutawayHandle: cutawayArgTypes.cutawayHandle,
    onCutawayOffset: { table: { disable: true } },
  },
} satisfies Meta<typeof CutawayStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Over the field from 2 km: the sea cut away in front of the view, the field under it. */
export const Default: Story = {};
