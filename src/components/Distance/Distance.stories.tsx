import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { WellboreSelectedEvent } from '../../events/wellbore-events'
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator'
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator'
import { DepthSelectorDecorator } from '../../storybook/decorators/depth-selector-decorator'
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator'
import storyArgs from '../../storybook/story-args.json'
import { BasicTrajectory } from '../Wellbores/BasicTrajectory/BasicTrajectory'
import { Casings } from '../Wellbores/Casings/Casings'
import { FormationMarkers } from '../Wellbores/FormationMarkers'
import { TubeTrajectory } from '../Wellbores/TubeTrajectory'
import { Wellbore } from '../Wellbores/Wellbore/Wellbore'
import { WellboreBounds } from '../Wellbores/WellboreBounds/WellboreBounds'
import { Distance } from './Distance'

const meta = {
  title: 'Components/Misc/Distance',
  decorators: [
    //PerformanceDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000
  },
  component: Distance,
} satisfies Meta<typeof Distance>

type StoryArgs = React.ComponentProps<typeof Distance> 

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore
const stratColumnId = storyArgs.defaultStratColumn

export const Default: Story = {
  args: {
    min: 0,
    max: 1000,
  },
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: wellboreId }))
    }, [])

    return (
      <>
        <Wellbore id={wellboreId}>
          <WellboreBounds id={wellboreId}>
            <TubeTrajectory color="white" radius={2} />
            <Distance {...args}>
              <FormationMarkers stratColumnId={stratColumnId} />
            </Distance>
          </WellboreBounds>
        </Wellbore>
      </>
    )
  },
}

export const OnDemand: Story = {
  args: {
    min: 0,
    max: 1,
  },
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: wellboreId }))
    }, [])

    return (
      <>
        <Wellbore id={wellboreId}>
          <WellboreBounds id={wellboreId}>
            <BasicTrajectory />
            <Distance min={0} max={3000}>
              <TubeTrajectory radius={0.5} />
            </Distance>
            <Distance {...args} onDemand>
              <Casings sizeMultiplier={5} shoeFactor={1.3}/>
            </Distance>
          </WellboreBounds>
        </Wellbore>
      </>
    )
  },
}