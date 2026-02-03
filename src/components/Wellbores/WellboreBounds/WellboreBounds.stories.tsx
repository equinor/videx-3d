import { useFrame } from '@react-three/fiber'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useContext, useEffect } from 'react'
import { WellboreSelectedEvent } from '../../../events/wellbore-events'
import { Canvas3dWebGLDecorator } from '../../../storybook/decorators/canvas-3d-webgl-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { OutputPanelDecorator } from '../../../storybook/decorators/output-panel-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { DistanceContext } from '../../Distance/DistanceContext'
import { useOutputPanel, useOutputPanelState } from '../../Html/OutputPanel/output-panel-state'
import { BasicTrajectory } from '../BasicTrajectory/BasicTrajectory'
import { Wellbore } from '../Wellbore/Wellbore'
import { WellboreBounds } from './WellboreBounds'

const meta = {
  title: 'Components/Wellbores/WellboreBounds',
  component: Wellbore,
  loaders: [
    async () => useOutputPanelState.setState({ groups: {} })
  ]
} satisfies Meta<typeof Wellbore>

type StoryArgs = React.ComponentProps<typeof WellboreBounds>

export default meta

const wellboreId = storyArgs.defaultWellbore

type Story = StoryObj<StoryArgs>

const OutputLogger = (() => {
  const distanceContext = useContext(DistanceContext)
  const outputPanel = useOutputPanel()

  useEffect(() => {
    if (outputPanel) {
      outputPanel.add('distance', {
        label: 'Distance',
        value: '-',
      })
    }

    return () => {
      if (outputPanel) {
        outputPanel.remove('distance')
      }
    }
  }, [outputPanel])

  useFrame(() => {
    if (outputPanel && distanceContext) {
      outputPanel.update('distance', distanceContext.current)
    }
  })

  return null
})

export const Default: Story = {
  args: {
    id: wellboreId,
    boundsSampleSize: 250
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
    boundsSampleSize: {
      type: 'number',
      control: {
        type: 'range',
        max: 1000,
        min: 10,
        step: 10,
      },
    }
  },
  decorators: [
    Canvas3dWebGLDecorator,
    GeneratorsProviderDecorator,
    OutputPanelDecorator,
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
          <WellboreBounds {...args} visible>
            <OutputLogger />
          </WellboreBounds>
        </Wellbore>
      </>
    )
  },
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 2500, 2500],
  }
}
