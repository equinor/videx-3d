import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { Canvas3dWebGLDecorator } from '../../../storybook/decorators/canvas-3d-webgl-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { Wellbore } from '../Wellbore/Wellbore'
//import { PerformanceDecorator } from '../../../storybook/decorators/performance-decorator'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'
import { AnnotationsDecorator } from '../../../storybook/decorators/annotations-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { TubeTrajectory } from '../TubeTrajectory/TubeTrajectory'
import { DepthMarkers } from './DepthMarkers'

const wellboreOptions = storyArgs.wellboreOptions
const wellboreId = storyArgs.defaultWellbore

const meta = {
  title: 'Components/Wellbores/DepthMarkers',
  component: DepthMarkers,
} satisfies Meta<typeof DepthMarkers>

type StoryArgs = React.ComponentProps<typeof DepthMarkers> & { id: string }

export default meta
type Story = StoryObj<StoryArgs>


export const Default: Story = {
  args: {
    id: wellboreId,
    interval: 100,
    depthReferencePoint: 'MSL',
  },
  argTypes: {
    id: {
      options: Object.keys(wellboreOptions),
      control: { type: 'select', labels: wellboreOptions },
    },
    interval: {
      options: [10, 50, 100, 250, 500, 1000],
      control: 'select'
    },
    depthReferencePoint: {
      options: ['MSL', 'RT'],
      control: 'radio',
    }
  },
  decorators: [
    //PerformanceDecorator,
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
          <TubeTrajectory radius={1} color="teal" />
          <DepthMarkers {...args} />
        </Wellbore>
      </>
    )
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 1500, 2000],
  }
}
