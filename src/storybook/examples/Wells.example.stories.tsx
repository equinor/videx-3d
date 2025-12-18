import { useThree } from '@react-three/fiber'
import type { Meta, StoryObj } from '@storybook/react'
import { scaleOrdinal } from 'd3-scale'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RepeatWrapping, TextureLoader, Vector3 } from 'three'
import { useAnnotationsState } from '../../components/Annotations/annotations-state'
import { CameraTargetMarker } from '../../components/CameraTargetMarker/CameraTargetMarker'
import { BoxGrid } from '../../components/Grids/BoxGrid/BoxGrid'
import { useHighlighter } from '../../components/Handlers/Highlighter/highlight-state'
import { Highlighter } from '../../components/Handlers/Highlighter/Highlighter'
import { useOutputPanel, useOutputPanelState } from '../../components/Html/OutputPanel/output-panel-state'
import { ObservableGroup } from '../../components/ObservableGroup/ObservableGroup'
import { Surface } from '../../components/Surfaces/Surface'
import { ContourColorMode } from '../../components/Surfaces/SurfaceMaterial'
import { UtmArea } from '../../components/UtmArea/UtmArea'
import { UtmPosition } from '../../components/UtmArea/UtmPosition'
import { BasicTrajectory } from '../../components/Wellbores/BasicTrajectory/BasicTrajectory'
import { DepthMarkers } from '../../components/Wellbores/DepthMarkers/DepthMarkers'
import { FormationMarkers } from '../../components/Wellbores/FormationMarkers/FormationMarkers'
import { Perforations } from '../../components/Wellbores/Perforations/Perforations'
import { TubeTrajectory } from '../../components/Wellbores/TubeTrajectory/TubeTrajectory'
import { Wellbore } from '../../components/Wellbores/Wellbore/Wellbore'
import { WellboreLabel } from '../../components/Wellbores/WellboreLabel/WellboreLabel'
import { Wells } from '../../components/Wellbores/Wells/Wells'
import { WellboreSelectedEvent, wellboreSelectedEventType } from '../../events/wellbore-events'
import { CameraFocusAtPointEvent, Casings, CompletionTools, Distance, Shoes, WellboreBounds, WellboreFormationColumn } from '../../main'
import { CRS } from '../../sdk/projection/crs'
import { Vec2, Vec3 } from '../../sdk/types/common'
import { AnnotationsDecorator } from '../decorators/annotations-decorator'
import { Canvas3dDecorator } from '../decorators/canvas-3d-decorator'
import { DataProviderDecorator } from '../decorators/data-provider-decorator'
import { EventEmitterDecorator } from '../decorators/event-emitter-decorator'
import { GeneratorsProviderDecorator } from '../decorators/generators-provider-decorator'
import { OutputPanelDecorator } from '../decorators/output-panel-decorator'
import { PerformanceDecorator } from '../decorators/performance-decorator'
import { WellMapDecorator } from '../decorators/well-map-decorator'
import { useSurfaceMetaDict } from '../hooks/useSurfaceMeta'
import { useWellboreHeaders } from '../hooks/useWellboreHeaders'
import storyArgs from '../story-args.json'
//import { PerformanceDecorator } from '../decorators/performance-decorator'

const loader = new TextureLoader()
const normalMap = loader.load('normal_map.jpg')
normalMap.anisotropy = 4

const colorScale = scaleOrdinal(["tomato", "#4e79a7", "#f28e2c", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#86a68c", "darkgreen", "purple", "#c3b380"])

const utmZone = storyArgs.utmZone
const origin = storyArgs.origin as Vec2
const stratColumnId = storyArgs.defaultStratColumn

const v = new Vector3()

type ExampleProps = {
  selected?: string,
  surfaceId?: string,
  useColorRamp: boolean,
  reverseRamp: boolean,
  color?: string,
  colorRamp: number,
  opacity: number,
  maxError: number,
  wireframe: boolean,
  showContours: boolean,
  contoursInterval: number,
  contoursColorMode: ContourColorMode,
  contoursColorModeFactor: number,
  contoursThickness: number,
  contoursColor: string,
  depthMarkerInterval: number,
  showFormationMarkers: boolean,
  showFormationColumns: boolean,
  showShoes: boolean,
  showDepthMarkers: boolean,
  showCasingAndCompletion: boolean,
  showPerforations: boolean,
  showCameraTarget: boolean,
  casingOpacity: number,
  sizeMultiplier: number,
  gridCellSize: number,
  segmentsPerMeter: number,
  simplificationThreshold: number,
  colors: {
    wellbore: string,
    gridColorMajor?: string,
    gridColorMinor?: string,
    gridBackground?: string,
    axesColor?: string,
  }
}

const Example = (args: ExampleProps) => {
  const [selected, setSelected] = useState(args.selected)
  const crsRef = useRef<CRS>(null)

  const [gridSize, setGridSize] = useState<Vec3>([0, 0, 0])
  const [gridPosition, setGridPosition] = useState<Vec3>([0, 0, 0])

  const highlighter = useHighlighter()
  const outputPanel = useOutputPanel()

  const camera = useThree(state => state.camera)

  const toggleVisibility = useAnnotationsState(state => state.toggleVisibility)

  const wellbores = useWellboreHeaders()
  const surfaceMeta = useSurfaceMetaDict()

  const included = useMemo(() => wellbores.map(d => d.id), [wellbores])

  const surface = useMemo(() => {
    return args.surfaceId ? surfaceMeta[args.surfaceId] : null
  }, [args.surfaceId, surfaceMeta])

  useEffect(() => {
    if (surface) {
      normalMap.repeat.set(
        Math.ceil((surface.header.nx * surface.header.xinc) / 500),
        Math.ceil((surface.header.ny * surface.header.yinc) / 500),
      )
      normalMap.wrapS = RepeatWrapping
      normalMap.wrapT = RepeatWrapping
    }
  }, [surface])

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
    if (outputPanel) {
      if (!outputPanel.has('selected')) {
        outputPanel.add('selected', {
          label: 'Selected',
          value: '(none)',
          color: 'tomato',
          order: 2,
          details: {
            status: { label: 'Status', value: '-' },
            depth: { label: 'Total Depth (Md Msl)', value: '-' },
            kickoff: { label: 'Kickoff (Md Msl)', value: '-' },
            easting: { label: 'Easting (wellhead)', value: '-' },
            northing: { label: 'Northing (wellhead)', value: '-' },
            depthRef: { label: 'Depth ref. (Msl)', value: '-' },
          }
        })
      }
      if (!outputPanel.has('readout')) {
        outputPanel.add('readout', {
          label: 'Readout',
          color: 'orange',
          value: '(none)',
          order: 1,
          details: {
            easting: { label: 'Easting', value: '-' },
            northing: { label: 'Northing', value: '-' },
            depth: { label: 'TVD (Msl)', value: '-' },
            distance: { label: 'Distance (m)', value: '-' },
          },
        })
      }
    }
  }, [outputPanel])

  useEffect(() => {
    if (args.selected) dispatchEvent(new WellboreSelectedEvent({ id: args.selected }))
  }, [args.selected])

  useEffect(() => {
    function onSelect(event: WellboreSelectedEvent) {
      setSelected(event.detail.id)
      const wellbore = wellbores.find(d => d.id === event.detail.id)
      if (wellbore) {
        outputPanel.update('selected', wellbore.name, {
          status: wellbore.status,
          depth: wellbore.depthMdMsl.toFixed(1),
          kickoff: wellbore.kickoffDepthMsl?.toFixed(1) || '-',
          easting: wellbore.easting.toFixed(1),
          northing: wellbore.northing.toFixed(1),
          depthRef: wellbore.depthReferenceElevation.toFixed(1),
        })
      }
    }
    addEventListener(wellboreSelectedEventType, onSelect)

    return () => removeEventListener(wellboreSelectedEventType, onSelect)
  }, [outputPanel, wellbores])

  useEffect(() => {
    return () => {
      highlighter.removeAll()
    }
  }, [highlighter])

  return (
    <>
      <Highlighter />

      <UtmArea ref={crsRef} origin={origin} utmZone={utmZone}>
        {args.showCameraTarget && <CameraTargetMarker renderOrder={999} />}
        {!surface && (
          <BoxGrid
            size={gridSize}
            cellSize={args.gridCellSize}
            originValue={[origin[0], 0, origin[1]]}
            gridScale={[1, -1, -1]}
            position={gridPosition}
            gridLineWidth={6 / args.gridCellSize}
            backgroundOpacity={0.5}
            axesColor={args.colors.axesColor}
            background={args.colors.gridBackground}
            gridColorMajor={args.colors.gridColorMajor}
            gridColorMinor={args.colors.gridColorMinor}
            renderOrder={0}
          />
        )}

        {surface && (<UtmPosition easting={surface.header.xori} northing={surface.header.yori}>
          <Surface
            name="Surface"
            meta={surface}
            color={args.color}
            useColorRamp={args.useColorRamp}
            reverseRamp={args.reverseRamp}
            colorRamp={args.colorRamp}
            rampMin={surface.displayMin}
            rampMax={surface.displayMax}
            opacity={args.opacity}
            priority={9}
            renderOrder={10}
            maxError={args.maxError}
            wireframe={args.wireframe}
            showContours={args.showContours}
            contoursColorMode={args.contoursColorMode}
            contoursColorModeFactor={args.contoursColorModeFactor}
            contoursInterval={args.contoursInterval}
            contoursThickness={args.contoursThickness}
            contoursColor={args.contoursColor}
            normalMap={normalMap}
            normalScale={[0.1, 0.1]}
            doubleSide
            onPointerClick={e => {
              if (e.position && e.keys.ctrlKey) {
                dispatchEvent(new CameraFocusAtPointEvent({ point: e.position, distance: 1000 }))
              }
            }}
          />
        </UtmPosition>
        )}

        <ObservableGroup
          updateRate={1000}
          snapTo={args.gridCellSize}
          padding={{ x0: 1000, x1: 1000, z0: 1000, z1: 1000, y0: 500 }}
          onChange={state => {
            setGridPosition(state.center)
            setGridSize(state.size)
          }}
        >
          <Wells
            wellbores={wellbores}
            included={included}
            selected={selected}
            renderWellbore={(wellbore, fromMsl, isSelected, isActiveWell) => {
              const color = isActiveWell ? colorScale(wellbore.name.replace(wellbore.well, '') || 'Main') : args.colors.wellbore

              return (
                <UtmPosition easting={wellbore.easting} northing={wellbore.northing}>
                  <Wellbore
                    segmentsPerMeter={args.segmentsPerMeter}
                    simplificationThreshold={args.simplificationThreshold}
                    id={wellbore.id}
                    fromMsl={fromMsl}
                    onPointerClick={(event) => {
                      setSelected(event.ref)
                      dispatchEvent(new WellboreSelectedEvent({ id: event.ref, position: event.position, flyTo: !event.keys.ctrlKey }))
                      console.log(event.ref)
                    }}
                    onPointerEnter={(event) => {
                      if (!isSelected) {
                        highlighter.highlight(event.target)
                      }
                      event.domElement.style.cursor = 'pointer'
                    }}
                    onPointerLeave={(event) => {
                      event.domElement.style.cursor = ''
                      highlighter.removeAll()
                      outputPanel.update('readout', '(none)', {
                        easting: '-',
                        northing: '-',
                        depth: '-',
                        distance: '-',
                      },
                      )
                    }}
                    onPointerMove={(event) => {
                      if (crsRef.current && event.position) {
                        const utmPos = crsRef.current.worldToUtm(...event.position)
                        let distance = '-'
                        if (event.position) {
                          v.set(event.position[0], event.position[1], event.position[2])
                          distance = v.distanceTo(camera.position).toFixed(1)
                        }
                        outputPanel.update('readout', wellbore.name, {
                          easting: utmPos.easting.toFixed(1),
                          northing: utmPos.northing.toFixed(1),
                          depth: (-utmPos.altitude).toFixed(1),
                          distance,
                        })
                      }
                    }}
                  >
                    <WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
                      <BasicTrajectory color={color} priority={9} />
                      <Distance min={args.showCasingAndCompletion ? 10 : 0} max={2000}>
                        <TubeTrajectory radius={0.1 * args.sizeMultiplier} color={color} priority={8} radialSegments={8} />
                        {args.showShoes && (<Shoes radialSegments={32} sizeMultiplier={args.sizeMultiplier * 1.3} color={isSelected ? color : 'orange'} />)}
                      </Distance>
                      {(args.showFormationColumns || args.showFormationMarkers) && (
                        <Distance min={0} max={40000} onDemand>
                          {args.showFormationColumns && <WellboreFormationColumn stratColumnId={stratColumnId} />}
                          {args.showFormationMarkers && (
                            <FormationMarkers
                              stratColumnId={stratColumnId}
                              radialSegments={16}
                              baseRadius={args.sizeMultiplier * 0.4}
                              showAnnotations={isActiveWell}
                            />
                          )}
                          {args.showPerforations && <Perforations renderOrder={10} sizeMultiplier={args.sizeMultiplier} />}
                        </Distance>
                      )}
                      {args.showCasingAndCompletion && (
                        <Distance min={0} max={10} onDemand>
                          <Casings radialSegments={16} sizeMultiplier={args.sizeMultiplier} shoeFactor={1.3} opacity={args.casingOpacity} />
                          <CompletionTools radialSegments={1} sizeMultiplier={args.sizeMultiplier} fallback={() => <TubeTrajectory radius={0.1 * args.sizeMultiplier} color={color} priority={8} radialSegments={16} />} />
                        </Distance>
                      )}
                    </WellboreBounds>

                    {(args.showDepthMarkers && isActiveWell) && <DepthMarkers interval={args.depthMarkerInterval} priority={10} depthReferencePoint='MSL' />}


                    {/* {isSelected && <PositionMarkers radius={20} interval={100} opacity={1} />} */}
                    <WellboreLabel color="cyan" size={16} />
                  </Wellbore>
                </UtmPosition>
              )
            }}
          />
        </ObservableGroup>
      </UtmArea>
    </>
  )
}

const meta = {
  title: 'examples/Wells',
  loaders: [async () => {
    useOutputPanelState.setState({ groups: {} })
  }],
  component: Example,
  argTypes: {
    surfaceId: {
      options: [undefined, ...Object.keys(storyArgs.surfaceOptions)],
      control: {
        type: 'select',
        labels: { 'undefined': '(none)', ...storyArgs.surfaceOptions },
      },
    },
    colorRamp: {
      options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      control: {
        type: 'select',
        labels: {
          '0': 'rainbow',
          '1': 'jet',
          '2': 'portland',
          '3': 'earth',
          '4': 'plasma',
          '5': 'salinity',
          '6': 'seismic',
          '7': 'seismic2',
          '8': 'spectrum',
          '9': 'gray',
        }
      }
    },
    color: {
      control: {
        type: 'color',
      }
    },
    opacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      }
    },
    maxError: {
      control: {
        type: 'range',
        min: 0.1,
        max: 10,
        step: 0.01,
      }
    },
    contoursInterval: {
      options: [1, 2, 5, 10, 25, 50, 100, 250, 500],
      control: {
        type: 'select'
      }
    },
    contoursColorMode: {
      options: [0, 1, 2],
      control: {
        type: 'radio',
        labels: { '0': 'darken', '1': 'lighten', '2': 'mixed' },
      },
    },
    contoursThickness: {
      control: {
        type: 'range',
        min: 0.5,
        max: 5,
        step: 0.1,
      }
    },
    contoursColor: {
      control: {
        type: 'color',
      }
    },
    casingOpacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      }
    },
    gridCellSize: {
      options: [250, 500, 1000],
      control: {
        type: 'select'
      }
    },
    segmentsPerMeter: {
      control: { type: 'range', min: 0.1, max: 2, step: 0.1 }
    },
    simplificationThreshold: {
      control: { type: 'range', min: 0, max: 0.0001, step: 0.000001 }
    },
    colors: { control: { disable: true } }
  },
  decorators: [
    PerformanceDecorator,
    EventEmitterDecorator,
    AnnotationsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    //DepthSelectorDecorator,
    WellMapDecorator,
    OutputPanelDecorator,
    DataProviderDecorator,
  ],
} satisfies Meta<typeof Example>


type Story = StoryObj<typeof meta>

const commonArgs = {
  surfaceId: undefined,
  useColorRamp: true,
  reverseRamp: false,
  color: 'white',
  colorRamp: 0,
  opacity: 0.98,
  maxError: 5,
  wireframe: false,
  showContours: false,
  contoursColorMode: ContourColorMode.darken,
  contoursColorModeFactor: 0.5,
  contoursInterval: 10,
  contoursThickness: 0.8,
  contoursColor: '#000000',
  depthMarkerInterval: 250,
  showFormationMarkers: false,
  showFormationColumns: false,
  showShoes: true,
  showDepthMarkers: false,
  showCasingAndCompletion: false,
  showPerforations: true,
  showCameraTarget: false,
  sizeMultiplier: 3,
  casingOpacity: 1,
  gridCellSize: 500,
  segmentsPerMeter: 0.1,
  simplificationThreshold: 0,
}

export const Default: Story = {
  args: {
    ...commonArgs,
    colors: {
      wellbore: "#aaa",
      axesColor: "#eee",
    }
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 15000, 20000],
    cameraTarget: [0, 0, 0],
    colorScale,
  },
}

export const Light: Story = {
  args: {
    ...commonArgs,
    colors: {
      wellbore: "#444",
      gridColorMajor: "#ddd",
      gridColorMinor: "#eee",
      gridBackground: "#fff",
      axesColor: "#555",
    }
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 15000, 20000],
    cameraTarget: [0, 0, 0],
    colorScale,
    background: '#eee'
  },
}

export default meta