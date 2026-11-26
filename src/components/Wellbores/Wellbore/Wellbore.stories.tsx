import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { WellboreSelectedEvent } from '../../../events/wellbore-events';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import storyArgs from '../../../storybook/story-args.json';
import { BasicTrajectory } from '../BasicTrajectory/BasicTrajectory';
import { Wellbore } from './Wellbore';

const meta = {
  title: 'Components/Wellbores/Wellbore',
  component: Wellbore,
} satisfies Meta<typeof Wellbore>;

type StoryArgs = React.ComponentProps<typeof Wellbore>;

export default meta;
type Story = StoryObj<StoryArgs>;

const wellboreId = storyArgs.defaultWellbore;

/**
 * A `Wellbore` draws nothing itself: it loads a wellbore (`id`) and hands it to the components
 * inside it, here a `BasicTrajectory`. `segmentsPerMeter` sets how finely they follow the
 * trajectory.
 */
export const Default: Story = {
  args: {
    id: wellboreId,
    segmentsPerMeter: 0.1,
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
  },
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: args.id }));
    }, [args.id]);

    return (
      <>
        <Wellbore {...args}>
          <BasicTrajectory />
        </Wellbore>
      </>
    );
  },
  parameters: {
    autoClear: true,
    scale: 100,
  },
};
