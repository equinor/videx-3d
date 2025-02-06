import type { Meta, StoryObj } from '@storybook/react'
import storyArgs from '../../../storybook/story-args.json'
import { Wellbore } from './Wellbore'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { useEffect } from 'react'
import { PerformanceDecorator } from '../../../storybook/decorators/performance-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'

const meta = {
  title: 'Components/Wellbores/Wellbore',
  component: Wellbore,
} satisfies Meta<typeof Wellbore>

type StoryArgs = React.ComponentProps<typeof Wellbore>

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore

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
    PerformanceDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: args.id }))
    }, [args.id])

    return (
      <>
        <Wellbore {...args}>
       
        </Wellbore>
      </>
    )
  },
  parameters: {
    scale: 100
  }
}
