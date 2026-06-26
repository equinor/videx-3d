import { useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PerspectiveCamera } from 'three';
import { useAnnotationsState } from '../../components/Annotations/annotations-state.ts';
import { CameraTargetMarker } from '../../components/CameraTargetMarker/CameraTargetMarker.tsx';
import { useHighlighter } from '../../components/Highlighter/highlight-state.ts';
import { Highlighter } from '../../components/Highlighter/Highlighter.tsx';
import { useOutputPanelState } from '../../components/Html/OutputPanel/output-panel-state.ts';
import { ObservableGroup } from '../../components/ObservableGroup/ObservableGroup.tsx';
import { Surface } from '../../components/Surfaces/Surface.tsx';
import { Tanker } from '../../components/Tanker/Tanker.tsx';
import { UtmArea } from '../../components/UtmArea/UtmArea.tsx';
import { UtmPosition } from '../../components/UtmArea/UtmPosition.tsx';
import { BasicTrajectory } from '../../components/Wellbores/BasicTrajectory/BasicTrajectory.tsx';
import { Casings } from '../../components/Wellbores/Casings/Casings.tsx';
import { DepthMarkers } from '../../components/Wellbores/DepthMarkers/DepthMarkers.tsx';
import { FormationMarkers } from '../../components/Wellbores/FormationMarkers/FormationMarkers.tsx';
import { Perforations } from '../../components/Wellbores/Perforations/Perforations.tsx';
import { TubeTrajectory } from '../../components/Wellbores/TubeTrajectory/TubeTrajectory.tsx';
import { Wellbore } from '../../components/Wellbores/Wellbore/Wellbore.tsx';
import { WellboreLabel } from '../../components/Wellbores/WellboreLabel/WellboreLabel.tsx';
import { WellboreSeismicSection } from '../../components/Wellbores/WellboreSeismicSection/WellboreSeismicSection.tsx';
import { Wells } from '../../components/Wellbores/Wells/Wells.tsx';
import {
  WellboreSelectedEvent,
  wellboreSelectedEventType,
} from '../../events/wellbore-events.ts';
import {
  AnnotationsPass,
  BoxGrid,
  CameraFocusAtPointEvent,
  CompletionTools,
  createLayers,
  Distance,
  EventEmitterCallbackEvent,
  FxaaPass,
  LAYERS,
  Ocean,
  OITRenderPass,
  Pass,
  RenderPass,
  Shoes,
  SMAAPass,
  TAAPass,
  WellboreBounds,
  WellboreFormationColumn,
} from '../../main.ts';
import { OutputPass } from '../../rendering/passes/OutputPass.ts';
import { RenderingPipeline } from '../../rendering/RenderingPipeline.tsx';
import { createOceanBox } from '../../sdk/geometries/ocean-geometry.ts';
import { CRS } from '../../sdk/projection/crs.ts';
import { Vec2, Vec3 } from '../../sdk/types/common.ts';
import { AnnotationsDecoratorNoAutoUpdate } from '../decorators/annotations-decorator.tsx';
import { Canvas3dDecorator } from '../decorators/canvas-3d-decorator.tsx';
import { DataProviderDecorator } from '../decorators/data-provider-decorator.tsx';
import { EventEmitterDecorator } from '../decorators/event-emitter-decorator.tsx';
import { GeneratorsProviderDecorator } from '../decorators/generators-provider-decorator.tsx';
import { PerformanceDecorator } from '../decorators/performance-decorator.tsx';
import { WellMapDecorator } from '../decorators/well-map-decorator.tsx';
import { useSurfaceMetaDict } from '../hooks/useSurfaceMeta.tsx';
import { useWellboreHeaders } from '../hooks/useWellboreHeaders.tsx';
import storyArgs from '../story-args.json';

const gridCellSize = 1000;
const colorScale = scaleOrdinal([
  'tomato',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#86a68c',
  'darkgreen',
  'purple',
  '#c3b380',
]);

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const stratColumnId = storyArgs.defaultStratColumn;

type ExampleProps = {
  selected?: string;
  useColorRamp: boolean;
  reverseRamp: boolean;
  colorRamp: number;
  opacity: number;
  wireframe: boolean;
  depthMarkerInterval: number;
  showFormationMarkers: boolean;
  showFormationColumns: boolean;
  showShoes: boolean;
  showDepthMarkers: boolean;
  showCasingAndCompletion: boolean;
  showPerforations: boolean;
  showSeismic: boolean;
  showCameraTarget: boolean;
  casingOpacity: number;
  sizeMultiplier: number;
  oitEnabled: boolean;
  aaMode: 'none' | 'fxaa' | 'smaa' | 'ssaa' | 'ssaa15' | 'ssaa4' | 'taa';
  msaaSamples: 0 | 2 | 4 | 8;
  occlusionDepthStamp: boolean;
  occlusionDepthThreshold: number;
  emitterDepthStamp: boolean;
  emitterDepthThreshold: number;
  precomputeSurfaceNormals: boolean;
  showOcean: boolean;
  oceanLevel: number;
  oceanWindSpeed: number;
  oceanWindDirection: number;
  oceanAmplitude: number;
  oceanDirectionalSpread: number;
  oceanSteepness: number;
  oceanDisplacement: boolean;
  oceanWaterOpacity: number;
  oceanTonalVariation: number;
  oceanTonalScale: number;
  oceanTonalColor: string;
  oceanReflectionIntensity: number;
  oceanFoamAmount: number;
  oceanDeepColor: string;
  oceanShallowColor: string;
  oceanSeaBedOpacity: number;
  oceanWireframe: boolean;
  showTanker: boolean;
  colors: {
    wellbore: string;
    gridColorMajor?: string;
    gridColorMinor?: string;
    gridBackground?: string;
    axesColor?: string;
  };
};

const Example = (args: ExampleProps) => {
  const [selected, setSelected] = useState(args.selected);
  const crsRef = useRef<CRS>(null);

  const [gridSize, setGridSize] = useState<Vec3>([0, 0, 0]);
  const [gridPosition, setGridPosition] = useState<Vec3>([0, 0, 0]);

  const highlighter = useHighlighter();

  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const clock = useThree(state => state.clock);
  const pointer = useThree(state => state.pointer);

  const toggleVisibility = useAnnotationsState(state => state.toggleVisibility);

  const wellbores = useWellboreHeaders();
  const surfaceMeta = useSurfaceMetaDict();

  const included = useMemo(() => wellbores.map(d => d.id), [wellbores]);

  useEffect(() => {
    function onKeyPress(event: KeyboardEvent) {
      if (event.code === 'Space') {
        toggleVisibility();
      }
    }
    addEventListener('keypress', onKeyPress);
    return () => removeEventListener('keypress', onKeyPress);
  }, [toggleVisibility]);

  useEffect(() => {
    if (args.selected)
      dispatchEvent(new WellboreSelectedEvent({ id: args.selected }));
  }, [args.selected]);

  useEffect(() => {
    function onSelect(event: WellboreSelectedEvent) {
      setSelected(event.detail.id);
    }
    addEventListener(wellboreSelectedEventType, onSelect);

    return () => removeEventListener(wellboreSelectedEventType, onSelect);
  }, [wellbores]);

  useEffect(() => {
    return () => {
      highlighter.removeAll();
    };
  }, [highlighter]);

  // SSAA is resolution-based (handled by the pipeline's supersample factor), so
  // it adds no post-pass; the others each contribute one anti-aliasing pass.
  const supersample =
    args.aaMode === 'ssaa4'
      ? 4
      : args.aaMode === 'ssaa'
        ? 2
        : args.aaMode === 'ssaa15'
          ? 1.5
          : 1;

  const passes = useMemo(() => {
    const base = args.oitEnabled
      ? new OITRenderPass(scene, camera)
      : new RenderPass(scene, camera);
    const annotations = new AnnotationsPass(camera, clock, pointer, 1000);
    const list: Pass[] = [base];
    switch (args.aaMode) {
      case 'none':
        // No anti-aliasing.
        break;
      case 'fxaa':
        list.push(new FxaaPass());
        break;
      case 'smaa':
        list.push(new SMAAPass());
        break;
      case 'taa':
        list.push(new TAAPass(camera as PerspectiveCamera));
        break;
      case 'ssaa':
      case 'ssaa15':
      case 'ssaa4':
        // No post-pass; the higher-resolution buffer is box-downsampled by the
        // OutputPass blit.
        break;
    }
    list.push(annotations, new OutputPass());

    return list;
  }, [scene, camera, clock, pointer, args.aaMode, args.oitEnabled]);

  const oitPass = passes[0] instanceof OITRenderPass ? passes[0] : null;

  // Keep the occlusion depth-stamp feature (transparent surfaces occluding labels)
  // in sync.
  useEffect(() => {
    if (oitPass) {
      oitPass.occlusionDepthStamp = args.occlusionDepthStamp;
      oitPass.occlusionDepthThreshold = args.occlusionDepthThreshold;
    }
  }, [oitPass, args.occlusionDepthStamp, args.occlusionDepthThreshold]);

  // Keep the emitter depth-stamp feature (dense emitter cores occluding surfaces
  // behind them) in sync.
  useEffect(() => {
    if (oitPass) {
      oitPass.emitterDepthStamp = args.emitterDepthStamp;
      oitPass.emitterDepthThreshold = args.emitterDepthThreshold;
    }
  }, [oitPass, args.emitterDepthStamp, args.emitterDepthThreshold]);

  const surfaces = useMemo(() => {
    const list = Object.values(surfaceMeta).filter(
      d => d.visualization === 'interval',
    );
    list.sort((a, b) => a.max - b.max);

    return list;
  }, [surfaceMeta]);

  const gridLayers = useMemo(() => {
    return undefined;
  }, []);

  // Exclude the BasicTrajectory LOD from the OIT transparency passes. It is
  // transparent (opacity 0.95) so it would otherwise be composited over the
  // emissive highlight; drawing it in the opaque pass keeps the highlight visible
  // when zoomed out (where trajectories drop to this line LOD).
  const trajectoryLayers = useMemo(() => createLayers(LAYERS.OIT_EXCLUDED), []);

  // Large plane lying in the world X/Z plane (normal +Y) at sea level. The
  // animation is world-space, so this could equally be a set of tiled patches
  // without any visible seams.
  // Ocean box volume (100 km across): a tessellated surface at y = 0 plus a
  // water body and an irregular sea bed varying between 100 m and 200 m depth.
  // The animation is world-space, so the surface could equally be tiled patches
  // without any visible seams.
  const oceanBox = useMemo(
    () =>
      createOceanBox({
        size: 10000,
        waterDepth: 120,
        depthVariation: 20,
      }),
    [],
  );

  useEffect(
    () => () => {
      oceanBox.surface.dispose();
      oceanBox.body.dispose();
      oceanBox.bed.dispose();
    },
    [oceanBox],
  );

  const oceanWind = useMemo<Vec2>(() => {
    const rad = (args.oceanWindDirection * Math.PI) / 180;
    return [Math.cos(rad), Math.sin(rad)];
  }, [args.oceanWindDirection]);

  return (
    <>
      <RenderingPipeline
        passes={passes}
        samples={args.msaaSamples}
        supersample={supersample}
      />
      <Highlighter />

      <UtmArea ref={crsRef} origin={origin} utmZone={utmZone}>
        {args.showCameraTarget && <CameraTargetMarker />}

        <BoxGrid
          size={gridSize}
          cellSize={gridCellSize}
          originValue={[origin[0], 0, origin[1]]}
          gridScale={[1, -1, -1]}
          position={gridPosition}
          gridLineWidth={6 / gridCellSize}
          backgroundOpacity={0.5}
          axesColor={args.colors.axesColor}
          background={args.colors.gridBackground}
          gridColorMajor={args.colors.gridColorMajor}
          gridColorMinor={args.colors.gridColorMinor}
          layers={gridLayers}
          renderOrder={0}
        />

        <ObservableGroup
          updateRate={1000}
          snapTo={gridCellSize}
          padding={{ x0: 1000, x1: 1000, z0: 1000, z1: 1000, y0: 500 }}
          onChange={state => {
            setGridPosition(state.center);
            setGridSize(state.size);
          }}
        >
          <Wells
            wellbores={wellbores}
            included={included}
            selected={selected}
            renderWellbore={(wellbore, fromMsl, isSelected, isActiveWell) => {
              const color = isActiveWell
                ? colorScale(wellbore.name.replace(wellbore.well, '') || 'Main')
                : args.colors.wellbore;

              return (
                <UtmPosition
                  easting={wellbore.easting}
                  northing={wellbore.northing}
                >
                  <Wellbore
                    id={wellbore.id}
                    fromMsl={fromMsl}
                    onPointerClick={(event: EventEmitterCallbackEvent) => {
                      setSelected(event.ref);
                      dispatchEvent(
                        new WellboreSelectedEvent({
                          id: event.ref,
                          position: event.position,
                          flyTo: !event.keys.ctrlKey,
                        }),
                      );
                      console.log(event.ref);
                    }}
                    onPointerEnter={(event: EventEmitterCallbackEvent) => {
                      if (!isSelected) {
                        highlighter.highlight(event.target);
                      }
                      event.domElement.style.cursor = 'pointer';
                    }}
                    onPointerLeave={(event: EventEmitterCallbackEvent) => {
                      event.domElement.style.cursor = '';
                      highlighter.removeAll();
                    }}
                  >
                    <WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
                      <BasicTrajectory
                        color={color}
                        priority={9}
                        name="BasicTrajectory"
                        layers={trajectoryLayers}
                      />
                      <Distance
                        min={args.showCasingAndCompletion ? 10 : 0}
                        max={2000}
                      >
                        <TubeTrajectory
                          name="TubeTrajectory"
                          radius={0.1 * args.sizeMultiplier}
                          color={color}
                          priority={8}
                          radialSegments={8}
                        />
                        {args.showShoes && (
                          <Shoes
                            radialSegments={32}
                            sizeMultiplier={args.sizeMultiplier * 1.3}
                            color={isSelected ? color : 'orange'}
                          />
                        )}
                      </Distance>
                      {(args.showFormationColumns ||
                        args.showFormationMarkers ||
                        args.showPerforations) && (
                          <Distance min={0} max={40000} onDemand>
                            {args.showFormationColumns && (
                              <WellboreFormationColumn
                                stratColumnId={stratColumnId}
                                startRadius={3}
                              />
                            )}
                            {args.showFormationMarkers && (
                              <FormationMarkers
                                stratColumnId={stratColumnId}
                                radialSegments={16}
                                baseRadius={4}
                                showAnnotations={isActiveWell}
                              />
                            )}
                            {args.showPerforations && (
                              <Perforations
                                sizeMultiplier={args.sizeMultiplier}
                              />
                            )}
                          </Distance>
                        )}
                      {args.showCasingAndCompletion && (
                        <Distance min={0} max={10} onDemand>
                          <Casings
                            name="Casings"
                            radialSegments={16}
                            autoSlicePosition={true}
                            sliceAngle={Math.PI}
                            sizeMultiplier={args.sizeMultiplier}
                            shoeFactor={1.3}
                            opacity={args.casingOpacity}
                          />
                          <CompletionTools
                            name="Completion"
                            radialSegments={16}
                            sizeMultiplier={args.sizeMultiplier}
                            fallback={() => (
                              <TubeTrajectory
                                radius={0.1 * args.sizeMultiplier}
                                color={color}
                                priority={8}
                                radialSegments={16}
                              />
                            )}
                          />
                        </Distance>
                      )}
                    </WellboreBounds>

                    {args.showDepthMarkers && isActiveWell && (
                      <DepthMarkers
                        interval={args.depthMarkerInterval}
                        priority={10}
                        depthReferencePoint="MSL"
                      />
                    )}
                    <WellboreLabel color="cyan" size={16} />
                  </Wellbore>
                  {isSelected && args.showSeismic && (
                    <WellboreSeismicSection
                      id={wellbore.id}
                      stepSize={3}
                      extension={1000}
                      minSize={1000}
                      opacity={0.9}
                    />
                  )}
                </UtmPosition>
              );
            }}
          />
          {surfaces &&
            surfaces.map((surface, index) => (
              <UtmPosition
                key={index}
                easting={surface.header.xori}
                northing={surface.header.yori}
              >
                <Surface
                  name="Surface"
                  meta={surface}
                  color={colorScale(surface.id)}
                  useColorRamp={args.useColorRamp}
                  reverseRamp={args.reverseRamp}
                  colorRamp={args.colorRamp}
                  rampMin={surface.displayMin}
                  rampMax={surface.displayMax}
                  opacity={args.opacity}
                  priority={9}
                  wireframe={args.wireframe}
                  normalScale={[0.1, 0.1]}
                  doubleSide
                  renderOrder={999 - index}
                  precomputeNormals={args.precomputeSurfaceNormals}
                  onPointerClick={(e: EventEmitterCallbackEvent) => {
                    if (e.position && e.keys.ctrlKey) {
                      dispatchEvent(
                        new CameraFocusAtPointEvent({
                          point: e.position,
                          distance: 1000,
                        }),
                      );
                    }
                  }}
                />
              </UtmPosition>
            ))}
        </ObservableGroup>

        {args.showOcean && (
          <Ocean
            name="Ocean"
            geometry={oceanBox.surface}
            bodyGeometry={oceanBox.body}
            bedGeometry={oceanBox.bed}
            position={[0, args.oceanLevel, 0]}
            windDirection={oceanWind}
            windSpeed={args.oceanWindSpeed}
            amplitude={args.oceanAmplitude}
            directionalSpread={args.oceanDirectionalSpread}
            steepness={args.oceanSteepness}
            displacement={args.oceanDisplacement}
            waterOpacity={args.oceanWaterOpacity}
            tonalVariation={args.oceanTonalVariation}
            tonalScale={args.oceanTonalScale}
            tonalColor={args.oceanTonalColor}
            reflectionIntensity={args.oceanReflectionIntensity}
            foamAmount={args.oceanFoamAmount}
            deepColor={args.oceanDeepColor}
            shallowColor={args.oceanShallowColor}
            seaBedOpacity={args.oceanSeaBedOpacity}
            wireframe={args.oceanWireframe}
            renderOrder={1}
            sunDirection={[-1, 2, -3]}
            sunShininess={100}
            bodyShimmer={0.75}
          >
            {args.showTanker && (
              <Tanker
                contactFoam
                buoyancy={true}
                weight={120000}
                details="high"
              />
            )}
          </Ocean>
        )}
      </UtmArea>
    </>
  );
};

const meta = {
  title: 'examples/Ocean',
  loaders: [
    async () => {
      useOutputPanelState.setState({ groups: {} });
    },
  ],
  component: Example,
  argTypes: {
    oitEnabled: {
      control: { type: 'boolean' },
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
        },
      },
    },
    opacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    casingOpacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    aaMode: {
      options: ['none', 'fxaa', 'smaa', 'ssaa15', 'ssaa', 'ssaa4', 'taa'],
      control: {
        type: 'select',
        labels: {
          none: 'None (no AA)',
          fxaa: 'FXAA (post, fast)',
          smaa: 'SMAA (post, sharper edges)',
          ssaa15: 'SSAA (1.5× supersample)',
          ssaa: 'SSAA (2× supersample)',
          ssaa4: 'SSAA (4× supersample)',
          taa: 'TAA (jittered accumulation)',
        },
      },
    },
    msaaSamples: {
      options: [0, 2, 4, 8],
      control: {
        type: 'select',
        labels: {
          0: 'Off',
          2: 'MSAA 2×',
          4: 'MSAA 4×',
          8: 'MSAA 8×',
        },
      },
    },
    occlusionDepthStamp: {
      control: { type: 'boolean' },
    },
    occlusionDepthThreshold: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    emitterDepthStamp: {
      control: { type: 'boolean' },
    },
    emitterDepthThreshold: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    oceanWindDirection: {
      control: { type: 'range', min: 0, max: 360, step: 1 },
    },
    oceanWindSpeed: {
      control: { type: 'range', min: 0, max: 25, step: 0.5 },
    },
    oceanAmplitude: {
      control: { type: 'range', min: 0, max: 3, step: 0.05 },
    },
    oceanDirectionalSpread: {
      control: { type: 'range', min: 0, max: 3, step: 0.05 },
    },
    oceanSteepness: {
      control: { type: 'range', min: 0, max: 2, step: 0.01 },
    },
    oceanDisplacement: {
      control: { type: 'boolean' },
    },
    oceanWaterOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    oceanTonalVariation: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    oceanTonalScale: {
      control: { type: 'range', min: 1, max: 50, step: 1 },
    },
    oceanTonalColor: { control: { type: 'color' } },
    oceanReflectionIntensity: {
      control: { type: 'range', min: 0, max: 2, step: 0.01 },
    },
    oceanFoamAmount: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    oceanLevel: {
      control: { type: 'range', min: -2000, max: 2000, step: 10 },
    },
    oceanDeepColor: { control: { type: 'color' } },
    oceanShallowColor: { control: { type: 'color' } },
    oceanSeaBedOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    oceanWireframe: { control: { type: 'boolean' } },
    showTanker: { control: { type: 'boolean' } },
    colors: { control: { disable: true } },
  },
  decorators: [
    PerformanceDecorator,
    EventEmitterDecorator,
    AnnotationsDecoratorNoAutoUpdate,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    WellMapDecorator,
    DataProviderDecorator,
  ],
} satisfies Meta<typeof Example>;

type Story = StoryObj<typeof meta>;

const commonArgs = {
  oitEnabled: true,
  useColorRamp: false,
  reverseRamp: false,
  colorRamp: 0,
  opacity: 0.8,
  wireframe: false,
  depthMarkerInterval: 250,
  showFormationMarkers: false,
  showFormationColumns: false,
  showShoes: true,
  showDepthMarkers: false,
  showCasingAndCompletion: false,
  showPerforations: true,
  showSeismic: false,
  showCameraTarget: false,
  sizeMultiplier: 3,
  casingOpacity: 1,
  aaMode: 'smaa' as const,
  msaaSamples: 0 as const,
  skipFrontPeeling: false,
  showDebugTargets: false,
  profileTail: false,
  occlusionDepthStamp: false,
  occlusionDepthThreshold: 0.5,
  emitterDepthStamp: false,
  emitterDepthThreshold: 0.5,
  precomputeSurfaceNormals: false,
  showOcean: true,
  oceanLevel: 0,
  oceanWindSpeed: 10,
  oceanWindDirection: 30,
  oceanAmplitude: 1,
  oceanDirectionalSpread: 1.2,
  oceanSteepness: 0.7,
  oceanDisplacement: false,
  oceanWaterOpacity: 0.7,
  oceanTonalVariation: 0.4,
  oceanTonalScale: 4,
  oceanTonalColor: '#cfe3f2',
  oceanReflectionIntensity: 1,
  oceanFoamAmount: 0.5,
  oceanDeepColor: '#0a2540',
  oceanShallowColor: '#1b6f8a',
  oceanSeaBedOpacity: 0.9,
  oceanWireframe: false,
  showTanker: false,
};

export const Default: Story = {
  args: {
    ...commonArgs,
    colors: {
      wellbore: '#444',
      axesColor: '#eee',
    },
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 15000, 20000],
    cameraTarget: [0, 0, 0],
    colorScale,
    msaaDisabled: true,
    //background: '#000'
  },
};

export const Light: Story = {
  args: {
    ...commonArgs,
    colors: {
      wellbore: '#565656',
      gridColorMajor: '#ddd',
      gridColorMinor: '#eee',
      gridBackground: '#fff',
      axesColor: '#555',
    },
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 15000, 20000],
    cameraTarget: [0, 0, 0],
    colorScale,
    background: '#eee',
    msaaDisabled: true,
  },
};

export default meta;
