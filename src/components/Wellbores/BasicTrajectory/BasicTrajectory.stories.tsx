import type { Meta, StoryObj } from '@storybook/react'
import { BasicTrajectory } from './BasicTrajectory'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { Wellbore } from '../Wellbore/Wellbore'
import { useEffect } from 'react'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'
import storyArgs from '../../../storybook/story-args.json'

const meta = {
  title: 'Components/Wellbores/BasicTrajectory',
  component: BasicTrajectory,
} satisfies Meta<typeof BasicTrajectory>

export default meta
type Story = StoryObj<typeof meta>

const wellboreId = storyArgs.defaultWellbore

export const Default: Story = {
  render: (args) => {
    useEffect(() => { dispatchEvent(new WellboreSelectedEvent({ id: wellboreId }))}, [])
    return (
      <Wellbore id={wellboreId}>
        <BasicTrajectory {...args} />
      </Wellbore>
    )
  },
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ]
}
