import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'
import { AnnotationsDecorator } from '../../../storybook/decorators/annotations-decorator'
import { Canvas3dWebGLDecorator } from '../../../storybook/decorators/canvas-3d-webgl-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { BasicTrajectory } from '../BasicTrajectory/BasicTrajectory'
import { Wellbore } from '../Wellbore/Wellbore'
import { WellboreLabel } from './WellboreLabel'

const meta = {
  title: 'Components/Wellbores/WellboreLabel',
  component: WellboreLabel,
} satisfies Meta<typeof WellboreLabel>

type StoryArgs = React.ComponentProps<typeof WellboreLabel> & { id: string }

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore

export const Default: Story = {
  args: {
    id: wellboreId,
    position: 'bottom',
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
    position: {
      type: 'string',
      options: ['top', 'center', 'bottom'],
      control: 'radio',
    }
  },
  decorators: [
    AnnotationsDecorator,
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
          <BasicTrajectory />
          <WellboreLabel {...args} />
        </Wellbore>
      </>
    )
  },
  parameters: {
    scale: 100
  }
}
