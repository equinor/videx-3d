import type { Meta, StoryObj } from '@storybook/react-vite'
import { range } from 'd3-array'
import { useEffect, useMemo, useState } from 'react'
import { GlyphsProvider } from '../../../contexts/GlyphsContextProvider'
import { useData, WellboreFormationColumn, WellboreSelectedEvent } from '../../../main'
import { Formation, getWellboreFormations } from '../../../sdk'
import { Canvas3dWebGLDecorator } from '../../../storybook/decorators/canvas-3d-webgl-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
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
  const store = useData()

  const [formationData, setFormationData] = useState<Formation[] | null>(null)

  useEffect(() => {
    if (store) {
      getWellboreFormations(wellboreId, stratColumnId, store).then(formationData => {
        setFormationData(formationData)
      })
    }
  }, [store])

  useEffect(() => {
    dispatchEvent(new WellboreSelectedEvent({ id: wellboreId }))
  }, [])

  const maxLevels = useMemo(() => {
    if (formationData) {
      return Math.max(...formationData.map(d => d.level))
    }
    return 0
  }, [formationData])

  return (
    <>
      <GlyphsProvider fontAtlasUrl='glyphs/OpenSans-Regular.png' fontConfigUrl='glyphs/OpenSans-Regular.json'>
        <group>
          <Wellbore id={wellboreId} segmentsPerMeter={segmentsPerMeter} simplificationThreshold={simplificationThreshold}>
            {showRibbon && (
              <WellboreRibbon>
                <MeasuredDepthStripe stepSize={stepSize} width={15} offset={-7.5} />
                {(!merged && maxLevels) && (
                  <>
                    {
                      range(1, maxLevels + 1, 1).map(level => (
                        <FormationsStripe key={level} width={10} offset={5 + (level - 1) * 10} formationData={formationData} level={level} />
                      ))
                    }
                  </>
                )}
                {(merged || !maxLevels) && (
                  <>
                    <FormationsStripe width={10} offset={5} formationData={formationData} />
                  </>
                )}
              </WellboreRibbon>
            )}

            <group renderOrder={2}>
              <BasicTrajectory />
              <Casings sizeMultiplier={scaleFactor} />
              <CompletionTools sizeMultiplier={scaleFactor} />
            </group>
            {(!showRibbon) && <WellboreFormationColumn stratColumnId={stratColumnId} startRadius={0.5 * scaleFactor} renderOrder={200} opacity={0.85} />}
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
  },
  decorators: [
    Canvas3dWebGLDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 100
  }
}
