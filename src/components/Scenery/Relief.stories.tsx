import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import {
  reportReliefProgress,
  reportSceneryProgress,
  SCENERY_DEMO_RELIEF_LABELS,
  SCENERY_DEMO_RELIEF_LAYERS,
  sceneryDecorators,
  sceneryHiddenArgTypes,
  sceneryProgressArgs,
} from '../../storybook/components/scenery-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import type { ProgressArgs } from '../../storybook/decorators/progress-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { GeoRelief } from '../Layers/GeoRelief';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { ScenerySea } from './ScenerySea';

// See documents/relief.md. The demo reliefs are made on demand by `npm run generate-relief`
// (`npm run build-static` runs it) into `public/relief`.

const DEPTH = 100;

type ReliefArgs = {
  layers: string[];
  color: 'flat' | 'ramp';
  contours: boolean;
  water: boolean;
  pixelError: number;
} & ProgressArgs;

const ReliefStory = ({
  layers,
  color,
  contours,
  water,
  pixelError,
}: ReliefArgs) => {
  // Coarse to fine, whatever the order ticked.
  const reliefLayers = useMemo(
    () =>
      SCENERY_DEMO_RELIEF_LAYERS.filter(layer =>
        (layers ?? []).includes(layer.id),
      ),
    [layers],
  );
  return (
    <World frame={demoFrame}>
      {/* The relief's tiles built on a worker of their own. */}
      <SceneryGenerators>
        <Scenery onProgress={reportSceneryProgress}>
          <ScenerySea level={0} depth={DEPTH} water={water} />
        </Scenery>
        <GeoRelief
          layers={reliefLayers}
          depth={DEPTH}
          color={color === 'ramp' ? 'ramp' : undefined}
          contours={contours}
          pixelError={pixelError}
          onProgress={reportReliefProgress}
        />
      </SceneryGenerators>
    </World>
  );
};

/**
 * Land and seabed from Earth relief data (`<GeoRelief>`) under a `Scenery`'s sky and sea, about
 * the demo field. The demo reliefs, from a world relief down to a survey about the field, are
 * merged coarse to fine onto tiles only as fine as the view needs; where none has data, the
 * seabed lies flat at the sea's depth.
 *
 * The reliefs are read from the store (`relief-meta`, `relief-values`; see
 * [Data](/videx-3d/docs/documents/data.html)) and merged by the `sceneryReliefTile` generator
 * (see [Generators](/videx-3d/docs/documents/generators.html)).
 */
const meta = {
  title: 'Components/Scenery/Relief',
  component: ReliefStory,
  decorators: [
    Canvas3dDecorator,
    // The relief's, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    // Past the horizon from 100 km up (1130 km).
    far: 3000000,
    // 60 km over the Norwegian Trench, looking east to the coast and the fjords.
    cameraPosition: [100000, 60000, 30000],
    cameraTarget: [240000, 0, -50000],
    ownLighting: () => true,
  },
  args: {
    ...sceneryProgressArgs,
    layers: SCENERY_DEMO_RELIEF_LAYERS.map(layer => layer.id),
    color: 'ramp',
    contours: false,
    water: true,
    pixelError: 2,
  },
  argTypes: {
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    layers: {
      control: { type: 'check', labels: SCENERY_DEMO_RELIEF_LABELS },
      options: SCENERY_DEMO_RELIEF_LAYERS.map(layer => layer.id),
      description:
        'The reliefs merged (`layers`), coarse to fine: a finer one wins where it has data, faded in from where its data ends. Changing them builds every tile again.',
      table: { category: 'Relief' },
    },
    color: {
      control: { type: 'inline-radio' },
      options: ['flat', 'ramp'],
      description:
        'How it is coloured (`color`): FLAT, the land one colour and the seabed the sea\u2019s; RAMP, the land by height through the terrain ramp (`color="ramp"`). Builds nothing again.',
      table: { category: 'Relief' },
    },
    contours: {
      control: { type: 'boolean' },
      description:
        'Contour lines over it, from the sea\u2019s level (`contours`): every 100 m, a heavier one every 500 m.',
      table: { category: 'Relief' },
    },
    pixelError: {
      control: { type: 'range', min: 0.5, max: 16, step: 0.5 },
      description:
        'The most a tile\u2019s error may show on screen, in pixels (`pixelError`): larger draws coarser tiles.',
      table: { category: 'Relief' },
    },
    water: {
      control: { type: 'boolean' },
      description:
        'The sea\u2019s water (`ScenerySea` `water`). Off, the seabed lies dry: the Norwegian Trench along the coast.',
      table: { category: 'Sea' },
    },
  },
} satisfies Meta<typeof ReliefStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The coast of south-western Norway and its fjords from 60 km up, over the Norwegian Trench.
 * Untick reliefs in `layers` to see what each adds, colour the land by height or in one colour
 * (`color`), draw `contours`, drain the sea (`water`) to see the seabed dry, and raise
 * `pixelError` to draw coarser tiles.
 */
export const Default: Story = {};

/**
 * The whole Earth from some 20 000 km: the world relief, with the finer ones about the field.
 * Zoom in to fly down to the field.
 */
export const Earth: Story = {
  parameters: {
    far: 50000000,
    cameraPosition: [0, 14000000, 14000000],
    // The Earth's centre, so the globe sits in the middle and the controls orbit it.
    cameraTarget: [0, -6371000, 0],
  },
};
