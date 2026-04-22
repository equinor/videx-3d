import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { WellboreSelectedEvent } from '../../../events/wellbore-events';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { PerformanceDecorator } from '../../../storybook/decorators/performance-decorator';
import storyArgs from '../../../storybook/story-args.json';
import { BasicTrajectory } from '../BasicTrajectory';
import { CompletionTools } from '../CompletionTools';
import { Wellbore, WellboreProps } from '../Wellbore';
import { Casings } from './Casings';


const meta = {
  title: 'Components/Wellbores/Casings',
  component: Casings,
} satisfies Meta<typeof Casings>;

type StoryArgs = React.ComponentProps<typeof Casings> & WellboreProps & {
  showCompletion: boolean
};

export default meta;
type Story = StoryObj<StoryArgs>;

const wellboreId = storyArgs.defaultWellbore;

export const Default: Story = {
  args: {
    id: wellboreId,
    sliceAngle: 0,
    sliceOffset: 0,
    autoSlicePosition: false,
    segmentsPerMeter: 0.1,
    radialSegments: 32,
    sizeMultiplier: 1,
    shoeFactor: 1.5,
    showCompletion: false,
    opacity: 1
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
    sliceAngle: {
      control: { type: 'range', min: 0, max: Math.ceil(Math.PI), step: 0.05 }
    },
    sliceOffset: {
      control: { type: 'range', min: 0, max: Math.ceil(Math.PI * 2), step: 0.05 }
    },
    autoSlicePosition: {
      control: { type: 'boolean' }
    },
    showCompletion: {
      control: { type: 'boolean' }
    },
    opacity: {
      control: { type: 'range', min: 0.1, max: 1, step: 0.1 }
    }

  },
  decorators: [
    PerformanceDecorator,
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
        <Wellbore id={args.id} segmentsPerMeter={args.segmentsPerMeter}>
          <BasicTrajectory />
          {args.showCompletion && <CompletionTools sizeMultiplier={args.sizeMultiplier} />}
          <Casings
            sizeMultiplier={args.sizeMultiplier}
            radialSegments={args.radialSegments}
            shoeFactor={args.shoeFactor}
            sliceAngle={args.sliceAngle}
            sliceOffset={args.sliceOffset}
            autoSlicePosition={args.autoSlicePosition}
            opacity={args.opacity}
          />
          {/* <WellboreRibbon>
            <ClippingStripe width={1.5} offset={0} />
          </WellboreRibbon> */}
        </Wellbore>
      </>
    );
  },
  parameters: {
    autoClear: true,
    scale: 100,
  },
};
