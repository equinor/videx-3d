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
import { Shoes } from './Shoes';

const meta = {
  title: 'Components/Wellbores/Shoes',
  component: Shoes,
} satisfies Meta<typeof Shoes>;

type StoryArgs = React.ComponentProps<typeof Shoes> & { id: string };

export default meta;
type Story = StoryObj<StoryArgs>;

const wellboreId = 'ad215042-03eb-2b7e-e053-c818a488c79a';

export const Default: Story = {
  args: {
    id: wellboreId,
    sizeMultiplier: 10,
    radialSegments: 32,
    color: '#ffbb00',
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
    color: { control: 'color' },
    sizeMultiplier: { control: { type: 'range', min: 1, max: 50, step: 1 } },
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
        <Shoes {...rest} />
      </Wellbore>
    );
  },
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 150, 150],
  },
};
