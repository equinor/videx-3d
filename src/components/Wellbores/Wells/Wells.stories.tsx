import type { Meta, StoryObj } from '@storybook/react'
import storyArgs from '../../../storybook/story-args.json'
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator'
import { BoxGrid } from '../../Grids/BoxGrid/BoxGrid'
import { Wells } from './Wells'
import { Wellbore } from '../Wellbore/Wellbore'
import { UtmArea } from '../../UtmArea/UtmArea'
import { UtmPosition } from '../../UtmArea/UtmPosition'
import { scaleOrdinal } from 'd3-scale'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BasicTrajectory } from '../BasicTrajectory/BasicTrajectory'
import { Distance } from '../../Distance/Distance'
import { WellboreBounds } from '../WellboreBounds/WellboreBounds'
import { WellboreSelectedEvent, wellboreSelectedEventType } from '../../../events/wellbore-events'
import { EventEmitterDecorator } from '../../../storybook/decorators/event-emitter-decorator'
import { TubeTrajectory } from '../TubeTrajectory/TubeTrajectory'
import { CRS } from '../../../sdk/projection/crs'
import { useHighlighter } from '../../Handlers/Highlighter/highlight-state'
import { Highlighter } from '../../Handlers/Highlighter/Highlighter'
import { AnnotationsDecorator } from '../../../storybook/decorators/annotations-decorator'
import { useAnnotationsState } from '../../Annotations/annotations-state'
import { WellboreLabel } from '../WellboreLabel/WellboreLabel'
import { CameraTargetMarker } from '../../CameraTargetMarker/CameraTargetMarker'
import { WellMapDecorator } from '../../../storybook/decorators/well-map-decorator'
import { Vec2 } from '../../../sdk/types/common'
import { useWellboreHeaders } from '../../../storybook/hooks/useWellboreHeaders'

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
        <BoxGrid
          size={[5000, 2000, 5000]}
          cellSize={100}
          originValue={[origin[0], 0, origin[1]]}
          gridScale={[1, -1, -1]}
          position={[-1500, -1000, -1200]}
          gridLineWidth={0.01}
          axesColor="#eee"
          opacity={0.8}
        />
        <CameraTargetMarker />
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
