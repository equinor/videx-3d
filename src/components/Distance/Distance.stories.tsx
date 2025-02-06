import type { Meta, StoryObj } from '@storybook/react'
import { Wellbore } from '../Wellbores/Wellbore/Wellbore'
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator'
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator'
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator'
import { useEffect } from 'react'
import { DepthSelectorDecorator } from '../../storybook/decorators/depth-selector-decorator'
import { WellboreSelectedEvent } from '../../events/wellbore-events'
import { Distance } from './Distance'
import { WellboreBounds } from '../Wellbores/WellboreBounds/WellboreBounds'
import { BasicTrajectory } from '../Wellbores/BasicTrajectory/BasicTrajectory'
import { Casings } from '../Wellbores/Casings/Casings'
import { Annotations } from '../Annotations/Annotations'
import { AnnotationsLayer } from '../Annotations/AnnotationsLayer'
import storyArgs from '../../storybook/story-args.json'

const meta = {
  title: 'Components/Misc/Distance',
  decorators: [
    //PerformanceDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  component: Distance,
} satisfies Meta<typeof Distance>

type StoryArgs = React.ComponentProps<typeof Distance> 

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore

export const Default: Story = {
  args: {
    min: 0,
    max: 10,
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
            <Distance {...args}>
              <Casings sizeMultiplier={10} radialSegments={128} segmentsPerMeter={1} shoeFactor={1.3}/>
            </Distance>
          </WellboreBounds>
        </Wellbore>
      </>
    )
  },
  parameters: {
    scale: 1000
  }
}

export const OnDemand: Story = {
  args: {
    min: 0,
    max: 10,
  },
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: wellboreId }))
    }, [])

    return (
      <>
        <Annotations>
          <AnnotationsLayer id='distance' name='distance' />
        </Annotations>
        <Wellbore id={wellboreId}>
          <WellboreBounds id={wellboreId}>
            <BasicTrajectory />
            <Distance {...args} onDemand>
              <Casings sizeMultiplier={10} radialSegments={128} segmentsPerMeter={1} shoeFactor={1.3}/>
            </Distance>
          </WellboreBounds>
        </Wellbore>
      </>
    )
  },
  parameters: {
    scale: 1000
  }
}