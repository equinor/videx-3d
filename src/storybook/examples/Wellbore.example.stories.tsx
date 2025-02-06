import type { Meta, StoryObj } from '@storybook/react'
import storyArgs from '../story-args.json'
import { Wellbore } from '../../components/Wellbores/Wellbore/Wellbore'
import { GeneratorsProviderDecorator } from '../decorators/generators-provider-decorator'
import { DataProviderDecorator } from '../decorators/data-provider-decorator'
import { Canvas3dDecorator } from '../decorators/canvas-3d-decorator'
import { BasicTrajectory } from '../../components/Wellbores/BasicTrajectory/BasicTrajectory'
import { CompletionTools } from '../../components/Wellbores/CompletionTools/CompletionTools'
import { Casings } from '../../components/Wellbores/Casings/Casings'
import { useEffect } from 'react'
import { PerformanceDecorator } from '../decorators/performance-decorator'
import { Perimeter } from '../../components/Wellbores/Perimeter/Perimeter'
import { CasingAnnotations } from '../../components/Wellbores/Casings/CasingAnnotations/CasingAnnotations'
import { DepthSelectorDecorator } from '../decorators/depth-selector-decorator'
import { WellboreSelectedEvent } from '../../events/wellbore-events'
import { Annotations } from '../../components/Annotations/Annotations'
import { AnnotationsLayer } from '../../components/Annotations/AnnotationsLayer'
import { CasingLabel } from '../../components/Wellbores/Casings/CasingAnnotations/CasingLabel'
import { AnnotationComponentProps } from '../../components/Annotations/types'
import { CameraFocusAtPointEvent } from '../../events/camera-events'
import { CompletionAnnotations } from '../../components/Wellbores/CompletionTools/CompletionAnnotations/CompletionAnnotations'
import { useAnnotationsState } from '../../components/Annotations/annotations-state'
import { Perforations } from '../../components/Wellbores/Perforations/Perforations'

const meta = {
  title: 'examples/Wellbore',
  loaders: [() => {
    useAnnotationsState.getState().clear()
  }],
  component: Wellbore,
} satisfies Meta<typeof Wellbore>

type StoryArgs = React.ComponentProps<typeof Wellbore> & {
  showCompletion: boolean,
  showCompletionAnnotations: boolean,
  showCasings: boolean,
  showCasingAnnotations: boolean,
  sizeMultiplier: number,
  showTrajectory: boolean,
  showPerimeter: boolean,
  perimeterRadius: number,
  perimeterFrom: number,
  perimeterTo: number,
  casingOpacity: number,
  shoeFactor: number,
}

export default meta
type Story = StoryObj<StoryArgs>

const wellboreId = storyArgs.defaultWellbore

export const Default: Story = {
  args: {
    id: wellboreId,
    sizeMultiplier: 10,
    segmentsPerMeter: 0.1,
    showTrajectory: true,
    showCompletion: true,
    showCompletionAnnotations: true,
    showCasings: true,
    showCasingAnnotations: true,
    showPerimeter: false,
    casingOpacity: 0.7,
    shoeFactor: 1.5,
    perimeterRadius: 10,
    perimeterFrom: 1000,
    perimeterTo: 10000,
    fromMsl: 0,
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
    },
    fromMsl: {
      control: { type: 'range', min: 0, max: 5000, step: 1 }
    },
    sizeMultiplier: { control: { type: 'range', min: 1, max: 10, step: 1 } },
    casingOpacity: { control: { type: 'range', min: 0.1, max: 1, step: 0.1 } },
    segmentsPerMeter: {
      control: { type: 'range', min: 0.1, max: 20, step: 0.1 }
    },
    simplificationThreshold: {
      control: { type: 'range', min: 0, max: 0.0001, step: 0.000001 }
    },
    shoeFactor: {
      control: { type: 'range', min: 1, max: 2, step: 0.1 }
    },
    perimeterRadius: {
      control: { type: 'range', min: 1, max: 50, step: 1 }
    },
    perimeterFrom: {
      control: { type: 'range', min: 0, max: 10000, step: 1 }
    },
    perimeterTo: {
      control: { type: 'range', min: 0, max: 10000, step: 1 }
    },
  },
  decorators: [
    PerformanceDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: args.id }))
    }, [args.id])
    console.log(args.id)
    return (
      <>
        <Wellbore {...args}>
          {args.showTrajectory && <BasicTrajectory color="red" />}
          {args.showCompletion && <CompletionTools sizeMultiplier={args.sizeMultiplier} radialSegments={32} />}
          {args.showCasings && <Casings shoeFactor={args.shoeFactor} opacity={args.casingOpacity} sizeMultiplier={args.sizeMultiplier} radialSegments={64} />}
          {args.showPerimeter && <Perimeter radius={args.perimeterRadius} from={args.perimeterFrom} to={args.perimeterTo} />}
          <Perforations sizeMultiplier={args.sizeMultiplier} />
          <CasingAnnotations />
          <CompletionAnnotations />
        </Wellbore>
        <Annotations>
          <AnnotationsLayer
            id='casings'
            name='Casings'
            anchorOcclusionRadius={30}
            visible={args.showCasingAnnotations}
            anchorColor='#8ad5e7'
            anchorSize={5}
            connectorColor='#70878d'
            connectorWidth={2}
            distanceFactor={150}
            labelComponent={CasingLabel}
            labelOffset={150}
            minDistance={10}
            maxDistance={5000}
            priority={10}
            onClick={(annotation: AnnotationComponentProps) => {
              dispatchEvent(new CameraFocusAtPointEvent({ point: annotation.position, distance: 300 }))
            }}

          />
          <AnnotationsLayer
            id="completion"
            name="Completion"
            priority={1}
            anchorSize={4}
            visible={args.showCompletionAnnotations}
            distanceFactor={150}
            labelOffset={50}
            minDistance={10}
            maxDistance={2000}
            anchorOcclusionRadius={30}
            onClick={(annotation: AnnotationComponentProps) => {
              dispatchEvent(new CameraFocusAtPointEvent({ point: annotation.position, distance: 200 }))
            }}
          />
        </Annotations>
      </>
    )
  },
  parameters: {
    scale: 100
  }
}
