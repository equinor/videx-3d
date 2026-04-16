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
import { WellboreSeismicSection } from './WellboreSeismicSection';

const meta = {
  title: 'Components/Wellbores/SeismicSection',
  component: Wellbore,
} satisfies Meta<typeof Wellbore>;

type StoryArgs = React.ComponentProps<typeof WellboreSeismicSection> & {
  id: string;
};

export default meta;
type Story = StoryObj<StoryArgs>;

const wellboreId = storyArgs.defaultWellbore;

export const Default: Story = {
  args: {
    id: wellboreId,
    stepSize: 3,
    extension: 1000,
    minSize: 1000,
    opacity: 1,
    rangeOffset: 0,
    colorRampIndex: 6,
    defaultExtensionAngle: 0,
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
    stepSize: {
      control: { type: 'range', min: 0.1, max: 100, step: 0.1 },
    },
    opacity: {
      control: { type: 'range', min: 0.1, max: 1, step: 0.1 },
    },
    rangeOffset: {
      control: { type: 'range', min: -0.99, max: 2, step: 0.01 },
    },
    colorRampIndex: {
      options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      control: {
        type: 'select',
        labels: {
          '0': 'rainbow',
          '1': 'jet',
          '2': 'portland',
          '3': 'earth',
          '4': 'plasma',
          '5': 'salinity',
          '6': 'seismic',
          '7': 'seismic2',
          '8': 'spectrum',
          '9': 'gray',
        },
      },
    },
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

    return (
      <>
        <Wellbore id={args.id}>
          <WellboreSeismicSection {...args} />
          <TubeTrajectory color="crimson" radius={5} />
        </Wellbore>
      </>
    );
  },
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 150, 0],
  },
};
