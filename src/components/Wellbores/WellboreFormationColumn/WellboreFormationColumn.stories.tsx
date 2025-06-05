import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { GlyphsProvider } from '../../../contexts/GlyphsContextProvider'
import { WellboreFormationColumn, WellboreSelectedEvent } from '../../../main'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { PerformanceDecorator } from '../../../storybook/decorators/performance-decorator'
import storyArgs from '../../../storybook/story-args.json'
import { CameraTargetMarker } from '../../CameraTargetMarker/CameraTargetMarker'
import { BasicTrajectory } from '../BasicTrajectory'
import { Casings } from '../Casings'
import { CompletionTools } from '../CompletionTools'
import { Wellbore } from '../Wellbore/Wellbore'
import { FormationsStripe } from '../WellboreRibbon/stripes/FormationsStripe'
import { MeasuredDepthStripe } from '../WellboreRibbon/stripes/MeasuredDepthStripe'
import { WellboreRibbon } from '../WellboreRibbon/WellboreRibbon'


type DemoProps = {
  showRibbon: boolean
  merged: boolean
  scaleFactor: number
  stepSize: number
  segmentsPerMeter: number
  simplificationThreshold: number
} 

const DemoComponent = ({ showRibbon, merged, scaleFactor, stepSize, segmentsPerMeter, simplificationThreshold }: DemoProps) => {
  useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: wellboreId }))
    }, [])
    
  return (
    <>
        <GlyphsProvider fontAtlasUrl='glyphs/OpenSans-Regular.png' fontConfigUrl='glyphs/OpenSans-Regular.json'>
          <group>
            <Wellbore id={wellboreId} segmentsPerMeter={segmentsPerMeter} simplificationThreshold={simplificationThreshold}>
              {showRibbon && (
                <WellboreRibbon>
                  <MeasuredDepthStripe stepSize={stepSize} width={15} offset={-7.5} />
                  {!merged && (
                    <>
                      <FormationsStripe width={10} offset={5} stratColumnId={stratColumnId} level={1} />
                      <FormationsStripe width={10} offset={15} stratColumnId={stratColumnId} level={2} />
                      <FormationsStripe width={10} offset={25} stratColumnId={stratColumnId} level={3} />
                    </>
                  )}
                  {merged && (
                    <>
                      <FormationsStripe width={10} offset={5} stratColumnId={stratColumnId} />
                    </>
                  )}
                </WellboreRibbon>
              )}

              <group renderOrder={2}>
                <BasicTrajectory />
                <Casings sizeMultiplier={scaleFactor} />
                <CompletionTools sizeMultiplier={scaleFactor} />
              </group>
              { (!showRibbon) && <WellboreFormationColumn stratColumnId={stratColumnId} startRadius={0.5 * scaleFactor} renderOrder={200} opacity={0.85} /> }
            </Wellbore>
          </group>

        </GlyphsProvider>
        <CameraTargetMarker renderOrder={10} opacity={0.25} color="red" radius={1} />
      </>
  )
}

const meta = {
  title: 'Components/Wellbores/WellboreFormationColumn',
  component: DemoComponent,
} satisfies Meta<typeof DemoComponent>

type StoryArgs = React.ComponentProps<typeof DemoComponent>

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore
const stratColumnId = storyArgs.defaultStratColumn


export const Default: Story = {
  args: {
    showRibbon: false,
    merged: true,
    scaleFactor: 5,
    stepSize: 10,
    segmentsPerMeter: 0.1,
    simplificationThreshold: 0,
    // stratColumnId,
    // startRadius: 0.5,
    // formationWidth: 2,
    // inverted: true,
    // opacity: 1,
    // unitTypes: [...storyArgs.stratUnitTypeOptions],
    // units: undefined,
  },
  argTypes: {
    scaleFactor: {
      control: {
        type: 'range',
        min: 1,
        max: 10,
        step: 1
      }
    },
    stepSize: {
      control: {
        type: 'range',
        min: 5,
        max: 100,
        step: 1
      }
    },
    segmentsPerMeter: {
      control: {
        type: 'range',
        min: 0.1,
        max: 1,
        step: 0.1
      }
    },
    simplificationThreshold: {
      control: {
        type: 'range',
        min: 0,
        max: 0.00005,
        step: 0.000001
      }
    },
    // formationWidth: {
    //   control: {
    //     type: 'range',
    //     min: 0,
    //     max: 20,
    //     step: 1,
    //   },
    // },
    // opacity: {
    //   control: {
    //     type: 'range',
    //     min: 0,
    //     max: 1,
    //     step: 0.1,
    //   },
    // },
    // unitTypes: {
    //   options: storyArgs.stratUnitTypeOptions,
    //   control: 'check',
    // },
    // units: {
    //   options: ['', ...storyArgs.stratUnitOptions],
    //   control: 'select',
    //   mapping: {
    //     '': undefined
    //   }
    // }
  },
  decorators: [
    PerformanceDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 100
  }
}
