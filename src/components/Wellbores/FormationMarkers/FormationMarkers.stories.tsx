import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { WellboreSelectedEvent } from '../../../events/wellbore-events';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import storyArgs from '../../../storybook/story-args.json';
import { TubeTrajectory } from '../TubeTrajectory';
import { Wellbore } from '../Wellbore/Wellbore';
import { FormationMarkers } from './FormationMarkers';

const meta = {
  title: 'Components/Wellbores/FormationMarkers',
  component: FormationMarkers,
} satisfies Meta<typeof FormationMarkers>;

type StoryArgs = React.ComponentProps<typeof FormationMarkers> & { id: string };

export default meta;
type Story = StoryObj<StoryArgs>;

const wellboreId = storyArgs.defaultWellbore;
const stratcolumnId = storyArgs.defaultStratColumn;

export const Default: Story = {
  args: {
    id: wellboreId,
    stratColumnId: stratcolumnId,
    radialSegments: 10,
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
    radialSegments: { control: { type: 'range', min: 3, max: 64, step: 1 } },
  },
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: args.id }));
    }, [args.id]);

    const { id, ...rest } = args;

    return (
      <Wellbore id={id}>
        <TubeTrajectory radius={1} color="teal" />
        <FormationMarkers {...rest} />
      </Wellbore>
    );
  },
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 150, 150],
  },
};
