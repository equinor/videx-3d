import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'
import { Canvas3dWebGLDecorator } from '../../../storybook/decorators/canvas-3d-webgl-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { Wellbore } from '../Wellbore/Wellbore'
import { TubeTrajectory } from './TubeTrajectory'

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
    Canvas3dWebGLDecorator,
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
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 150, 150],
  }
}
