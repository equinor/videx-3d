import type { Meta, StoryObj } from '@storybook/react'
import { Wellbore } from '../Wellbore/Wellbore'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { useEffect } from 'react'
import { PerformanceDecorator } from '../../../storybook/decorators/performance-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'
import { AnnotationsDecorator } from '../../../storybook/decorators/annotations-decorator'
import { TubeTrajectory } from './TubeTrajectory'
import storyArgs from '../../../storybook/story-args.json'

const meta = {
  title: 'Components/Wellbores/TubeTrajectory',
  component: Wellbore,
} satisfies Meta<typeof Wellbore>

type StoryArgs = React.ComponentProps<typeof TubeTrajectory> & { id: string }

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore

export const Default: Story = {
  args: {
    id: wellboreId,
    radius: 1,
    color: 'lime'
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
  },
  decorators: [
    PerformanceDecorator,
    AnnotationsDecorator,
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
        <Wellbore id={args.id}>
          <TubeTrajectory {...args} />
        </Wellbore>
      </>
    )
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 1500, 2000],
  }
}
