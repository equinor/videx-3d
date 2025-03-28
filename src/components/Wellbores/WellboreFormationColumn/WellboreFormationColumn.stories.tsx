import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { TubeTrajectory } from '../TubeTrajectory'
import { Wellbore } from '../Wellbore/Wellbore'
import { WellboreFormationColumn } from './WellboreFormationColumn'

const meta = {
  title: 'Components/Wellbores/WellboreFormationColumn',
  component: WellboreFormationColumn,
} satisfies Meta<typeof WellboreFormationColumn>

type StoryArgs = React.ComponentProps<typeof WellboreFormationColumn>

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore
const stratColumnId = storyArgs.defaultStratColumn

export const Default: Story = {
  args: {
    stratColumnId,
    startRadius: 0.5,
    formationWidth: 2,
    inverted: true,
    opacity: 1,
    unitTypes: [...storyArgs.stratUnitTypeOptions],
    units: undefined,
  },
  argTypes: {
    formationWidth: {
      control: {
        type: 'range',
        min: 0,
        max: 20,
        step: 1,
      },
    },
    opacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.1,
      },
    },
    unitTypes: {
      options: storyArgs.stratUnitTypeOptions,
      control: 'check',
    },
    units: {
      options: ['', ...storyArgs.stratUnitOptions],
      control: 'select',
      mapping: {
        '': undefined
      }
    }
  },
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: wellboreId }))
    }, [])

    return (
      <group>
        <Wellbore id={wellboreId}>
          <TubeTrajectory />
          <WellboreFormationColumn {...args} />
        </Wellbore>
      </group>
    )
  },
  parameters: {
    autoClear: true,
    scale: 100
  }
}
