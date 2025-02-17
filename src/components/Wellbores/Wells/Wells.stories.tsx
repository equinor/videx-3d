import type { Meta, StoryObj } from '@storybook/react'
import { scaleOrdinal } from 'd3-scale'
import { useEffect, useMemo, useRef, useState } from 'react'
import { WellboreSelectedEvent, wellboreSelectedEventType } from '../../../events/wellbore-events'
import { CRS } from '../../../sdk/projection/crs'
import { Vec2 } from '../../../sdk/types/common'
import { AnnotationsDecorator } from '../../../storybook/decorators/annotations-decorator'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { EventEmitterDecorator } from '../../../storybook/decorators/event-emitter-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { WellMapDecorator } from '../../../storybook/decorators/well-map-decorator'
import { useWellboreHeaders } from '../../../storybook/hooks/useWellboreHeaders'
import storyArgs from '../../../storybook/story-args.json'
import { useAnnotationsState } from '../../Annotations/annotations-state'
import { CameraTargetMarker } from '../../CameraTargetMarker/CameraTargetMarker'
import { Distance } from '../../Distance/Distance'
import { BoxGrid } from '../../Grids/BoxGrid/BoxGrid'
import { useHighlighter } from '../../Handlers/Highlighter/highlight-state'
import { Highlighter } from '../../Handlers/Highlighter/Highlighter'
import { UtmArea } from '../../UtmArea/UtmArea'
import { UtmPosition } from '../../UtmArea/UtmPosition'
import { BasicTrajectory } from '../BasicTrajectory/BasicTrajectory'
import { TubeTrajectory } from '../TubeTrajectory/TubeTrajectory'
import { Wellbore } from '../Wellbore/Wellbore'
import { WellboreBounds } from '../WellboreBounds/WellboreBounds'
import { WellboreLabel } from '../WellboreLabel/WellboreLabel'
import { Wells } from './Wells'

const colorScale = scaleOrdinal(["tomato", "#4e79a7", "#f28e2c", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab", "darkgreen", "purple", "#24ca85"])

const utmZone = storyArgs.utmZone
const origin = storyArgs.origin as Vec2
const well = storyArgs.defaultWell

const Wrapper = () => {
  const [selected, setSelected] = useState<string | undefined>()
  const crsRef = useRef<CRS>(null)

  const highlighter = useHighlighter()

  const toggleVisibility = useAnnotationsState(state => state.toggleVisibility)

  const wellbores = useWellboreHeaders()

  const included = useMemo(() => wellbores.filter(d => d.well === well).map(d => d.id), [wellbores])

  useEffect(() => {
    function onKeyPress(event: KeyboardEvent) {
      if (event.code === 'Space') {
        toggleVisibility()
      }
    }
    addEventListener('keypress', onKeyPress)
    return () => removeEventListener('keypress', onKeyPress)
  }, [toggleVisibility])

  useEffect(() => {
    function onSelect(event: WellboreSelectedEvent) {
      setSelected(event.detail.id)
    }
    addEventListener(wellboreSelectedEventType, onSelect)

    return () => removeEventListener(wellboreSelectedEventType, onSelect)
  }, [])

  useEffect(() => {
    return () => {
      highlighter.removeAll()
    }
  }, [highlighter])

  return (
    <>
      <Highlighter />
      <UtmArea ref={crsRef} origin={origin} utmZone={utmZone}>
        <CameraTargetMarker />
        <BoxGrid
          size={[5000, 2000, 5000]}
          cellSize={100}
          originValue={[origin[0], 0, origin[1]]}
          gridScale={[1, -1, -1]}
          position={[-1500, -1000, -1200]}
          gridLineWidth={0.01}
          axesColor="#eee"
          opacity={0.8}
          autoSize
          autoSizePadding={{
            x0: 1000,
            x1: 1000,
            y0: 100,
            y1: 0,
            z0: 1000,
            z1: 1000,
          }}
        >
          <Wells
            wellbores={wellbores}
            included={included}
            selected={selected}
            renderWellbore={(wellbore, fromMsl, isSelected) => {
              const color = colorScale(wellbore.name.replace(wellbore.well, '') || 'Main')
              return (
                <UtmPosition easting={wellbore.easting} northing={wellbore.northing}>
                  <Wellbore
                    id={wellbore.id}
                    fromMsl={fromMsl}
                    onPointerClick={async (event) => {
                      setSelected(event.ref)
                      dispatchEvent(new WellboreSelectedEvent({ id: event.ref, position: event.position, flyTo: !event.keys.ctrlKey }))
                    }}
                    onPointerEnter={async (event) => {
                      if (!isSelected) {
                        highlighter.highlight(event.target)
                      }
                    }}
                    onPointerLeave={async () => {
                      highlighter.removeAll()
                    }}
                  >
                    <WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
                      <BasicTrajectory color={color} priority={9} />
                      <Distance min={0} max={10000}>
                        <TubeTrajectory radius={2} color={color} priority={8} radialSegments={16} />
                      </Distance>
                    </WellboreBounds>
                    <WellboreLabel color="cyan" size={16} />
                  </Wellbore>
                </UtmPosition>
              )
            }}
          />
        </BoxGrid>
      </UtmArea>
    </>
  )
}

const meta = {
  title: 'Components/Wellbores/Wells',
  component: Wrapper,
  loaders: [() => {
    useAnnotationsState.getState().clear()
  }]
} satisfies Meta<typeof Wrapper>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  decorators: [
    EventEmitterDecorator,
    AnnotationsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    WellMapDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    cameraPosition: [0, 1500, 2000],
    cameraTarget: [0, 0, 0],
    colorScale,
  }
}
