import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector2, Vector3 } from 'three';
import { useAnnotationsState } from '../../components/Annotations/annotations-state.ts';
import { CameraTargetMarker } from '../../components/CameraTargetMarker/CameraTargetMarker.tsx';
import { useHighlighter } from '../../components/Highlighter/highlight-state.ts';
import { Highlighter } from '../../components/Highlighter/Highlighter.tsx';
import {
  useOutputPanel,
  useOutputPanelState,
} from '../../components/Html/OutputPanel/output-panel-state.ts';
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
  LAYERS,
  Ocean,
  OITAntialiasMode,
  OITRenderPass,
  Pass,
  RenderPass,
  Shoes,
  SMAAQuality,
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
import { OutputPanelDecorator } from '../decorators/output-panel-decorator.tsx';
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

const v = new Vector3();

// Fixed ocean wind (matches the previous Ocean example defaults: 30°, 10 m/s).
const oceanWindRad = (30 * Math.PI) / 180;
const oceanWind: Vec2 = [Math.cos(oceanWindRad), Math.sin(oceanWindRad)];

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
  aaMode: OITAntialiasMode;
  supersample: 0.25 | 0.5 | 1 | 1.5 | 2 | 4;
  msaaSamples: 0 | 2 | 4 | 8;
  smaaQuality: SMAAQuality;
  skipFrontPeeling: boolean;
  showDebugTargets: boolean;
  profileTail: boolean;
  occlusionDepthStamp: boolean;
  occlusionDepthThreshold: number;
  emitterDepthStamp: boolean;
  emitterDepthThreshold: number;
  precomputeSurfaceNormals: boolean;
  showOcean: boolean;
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
  const outputPanel = useOutputPanel();

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
    if (outputPanel) {
      // The 'selected' and 'readout' sections are intentionally not registered
      // here so the output panel stays focused on the OIT stats/profiling. The
      // corresponding outputPanel.update() calls below are no-ops when the group
      // is absent.
    }
  }, [outputPanel]);

  useEffect(() => {
    if (args.selected)
      dispatchEvent(new WellboreSelectedEvent({ id: args.selected }));
  }, [args.selected]);

  useEffect(() => {
    function onSelect(event: WellboreSelectedEvent) {
      setSelected(event.detail.id);
      const wellbore = wellbores.find(d => d.id === event.detail.id);
      if (wellbore) {
        outputPanel.update('selected', wellbore.name, {
          status: wellbore.status,
          depth: wellbore.depthMdMsl.toFixed(1),
          kickoff: wellbore.kickoffDepthMsl?.toFixed(1) || '-',
          easting: wellbore.easting.toFixed(1),
          northing: wellbore.northing.toFixed(1),
          depthRef: wellbore.depthReferenceElevation.toFixed(1),
        });
      }
    }
    addEventListener(wellboreSelectedEventType, onSelect);

    return () => removeEventListener(wellboreSelectedEventType, onSelect);
  }, [outputPanel, wellbores]);

  useEffect(() => {
    return () => {
      highlighter.removeAll();
    };
  }, [highlighter]);

  // Supersampling is resolution-based (handled by the pipeline's supersample
  // factor) and independent of the AA mode, so it can stack on top of any of them.
  const supersample = args.supersample;

  const passes = useMemo(() => {
    const base = args.oitEnabled
      ? new OITRenderPass(scene, camera)
      : new RenderPass(scene, camera);
    const annotations = new AnnotationsPass(camera, clock, pointer, 1000);
    // All anti-aliasing is now built into OITRenderPass (temporal / SMAA), driven
    // by the antialias sync effect below; supersampling is a separate, resolution-
    // based control on the pipeline. So no AA post-pass is added here.
    const list: Pass[] = [base, annotations, new OutputPass()];

    return list;
  }, [scene, camera, clock, pointer, args.oitEnabled]);

  const oitPass = passes[0] instanceof OITRenderPass ? passes[0] : null;

  // Keep the debug-target overlay toggle in sync with the control.
  useEffect(() => {
    if (oitPass) oitPass.debugTargets = args.showDebugTargets;
  }, [oitPass, args.showDebugTargets]);

  // Tuning: SMAA quality preset (edge threshold + orthogonal search distance).
  useEffect(() => {
    if (oitPass) oitPass.smaaQuality = args.smaaQuality;
  }, [oitPass, args.smaaQuality]);

  // Keep the WBOIT-only (skip front peeling) debug toggle in sync.
  useEffect(() => {
    if (oitPass) oitPass.skipFront = args.skipFrontPeeling;
  }, [oitPass, args.skipFrontPeeling]);

  // Keep the GPU profiling toggle in sync.
  useEffect(() => {
    if (oitPass) oitPass.profile = args.profileTail;
  }, [oitPass, args.profileTail]);

  // Drive the opaque-only MSAA samples on the OIT pass (resolved once) instead of
  // multisampling the whole pipeline buffer.
  useEffect(() => {
    if (oitPass) oitPass.opaqueSamples = args.msaaSamples;
  }, [oitPass, args.msaaSamples]);

  // Enable OITRenderPass' built-in temporal supersampling when that AA mode is
  // selected. It only accumulates while the camera is still and never reprojects,
  // so it anti-aliases transparent/additive content without ghosting.
  useEffect(() => {
    if (!oitPass) return;
    oitPass.antialias =
      args.aaMode === 'temporal' ||
        args.aaMode === 'smaa' ||
        args.aaMode === 'temporal-smaa' ||
        args.aaMode === 'taa' ||
        args.aaMode === 'fxaa'
        ? args.aaMode
        : 'none';
  }, [oitPass, args.aaMode]);

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

  // Register / tear down the OIT stats + GPU-timing readout in the output panel.
  useEffect(() => {
    if (!outputPanel) return;
    if (!outputPanel.has('oit')) {
      outputPanel.add('oit', {
        label: 'OIT',
        value: '-',
        color: 'mediumseagreen',
        order: 0,
        details: {
          oit: { label: 'OIT objects', value: '-' },
          oitOpaque: { label: 'OIT → opaque', value: '-' },
          emissive: { label: 'Emissive', value: '-' },
          overlay: { label: 'Overlay', value: '-' },
          opaqueT: { label: 'Opaque (t)', value: '-' },
          emissiveT: { label: 'Emissive (t)', value: '-' },
          minDepthT: { label: 'Min-depth (t)', value: '-' },
          tail: { label: 'Tail (WBOIT)', value: '-' },
          composite: { label: 'Composite', value: '-' },
          front: { label: 'Front', value: '-' },
          occlusionT: { label: 'Occlusion stamp', value: '-' },
          emitterStampT: { label: 'Emitter stamp', value: '-' },
          overlayT: { label: 'Overlay (t)', value: '-' },
          total: { label: 'OIT total', value: '-' },
          resolution: { label: 'Render resolution', value: '-' },
          pipelines: { label: 'OIT pipelines', value: '-' },
          entriesTotal: { label: 'Entries created (total)', value: '-' },
          entriesFrame: { label: 'New entries/frame', value: '-' },
          texturesR: { label: 'GPU textures', value: '-' },
          geometriesR: { label: 'GPU geometries', value: '-' },
          programsR: { label: 'GPU programs', value: '-' },
        },
      });
    }
    return () => outputPanel.remove('oit');
  }, [outputPanel]);

  // Publish the latest stats/timings ~4 Hz (the GPU timings already lag a few
  // frames and are smoothed, so a high update rate would only add churn).
  const lastReadout = useRef(0);
  const drawingBufferSize = useMemo(() => new Vector2(), []);
  useFrame(({ clock, gl }) => {
    const t = clock.getElapsedTime();
    if (t - lastReadout.current < 0.25) return;
    lastReadout.current = t;
    if (!oitPass || !outputPanel || !outputPanel.has('oit')) return;
    const ms = (v: number) => (v < 0 ? '-' : `${v.toFixed(2)} ms`);
    const { stats, timings, resources } = oitPass;
    // Effective render resolution (same formula the pipeline applies). The
    // drawing-buffer size already includes the device pixel ratio; the
    // supersample factor is multiplied on top.
    gl.getDrawingBufferSize(drawingBufferSize);
    const rw = Math.max(1, Math.floor(drawingBufferSize.x * supersample));
    const rh = Math.max(1, Math.floor(drawingBufferSize.y * supersample));
    const resolutionLabel = `${rw}\u00d7${rh} (${supersample.toFixed(2)}\u00d7)`;
    // Exactly one OIT pipeline should be registered while this story is mounted.
    // Anything else means a pass was acquired but never released (a registration
    // leak) — flag it loudly so it can't slip by unnoticed.
    const pipelines = resources.oitPipelines;
    const pipelinesValue =
      pipelines === 1 ? pipelines : `\u26a0 ${pipelines} (expected 1 — leak!)`;
    outputPanel.update('oit', args.profileTail ? ms(timings.total) : 'stats', {
      oit: stats.oit,
      oitOpaque: stats.oitOpaque,
      emissive: stats.emissive,
      overlay: stats.overlay,
      opaqueT: args.profileTail ? ms(timings.opaque) : '(enable profiling)',
      emissiveT: args.profileTail ? ms(timings.emissive) : '-',
      minDepthT: args.profileTail ? ms(timings.minDepth) : '-',
      tail: args.profileTail ? ms(timings.tail) : '-',
      composite: args.profileTail ? ms(timings.composite) : '-',
      front: args.profileTail ? ms(timings.front) : '-',
      occlusionT: args.profileTail ? ms(timings.occlusion) : '-',
      emitterStampT: args.profileTail ? ms(timings.emitterStamp) : '-',
      overlayT: args.profileTail ? ms(timings.overlay) : '-',
      total: args.profileTail ? ms(timings.total) : '-',
      resolution: resolutionLabel,
      pipelines: pipelinesValue,
      entriesTotal: resources.entriesTotal,
      entriesFrame: resources.entriesThisFrame,
      texturesR: resources.textures,
      geometriesR: resources.geometries,
      programsR: resources.programs,
    });
  });

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

  // Ocean box volume (10 km across): a tessellated surface at y = 0 plus a
  // water body and an irregular sea bed varying between 100 m and 200 m depth.
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

  return (
    <>
      <RenderingPipeline
        passes={passes}
        samples={0}
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
                      outputPanel.update('readout', '(none)', {
                        easting: '-',
                        northing: '-',
                        depth: '-',
                        distance: '-',
                      });
                    }}
                    onPointerMove={(event: EventEmitterCallbackEvent) => {
                      if (crsRef.current && event.position) {
                        const utmPos = crsRef.current.worldToUtm(
                          ...event.position,
                        );
                        let distance = '-';
                        if (event.position) {
                          v.set(
                            event.position[0],
                            event.position[1],
                            event.position[2],
                          );
                          distance = v.distanceTo(camera.position).toFixed(1);
                        }
                        outputPanel.update('readout', wellbore.name, {
                          easting: utmPos.easting.toFixed(1),
                          northing: utmPos.northing.toFixed(1),
                          depth: (-utmPos.altitude).toFixed(1),
                          distance,
                        });
                      }
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
            position={[0, 0, 0]}
            windDirection={oceanWind}
            windSpeed={10}
            amplitude={1}
            directionalSpread={1.2}
            steepness={0.7}
            displacement={false}
            waterOpacity={0.7}
            tonalVariation={0.4}
            tonalScale={4}
            tonalColor="#cfe3f2"
            reflectionIntensity={1}
            foamAmount={0.5}
            deepColor="#0a2540"
            shallowColor="#1b6f8a"
            seaBedOpacity={0.9}
            wireframe={false}
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
  title: 'examples/OIT Rendering Pipeline',
  loaders: [
    async () => {
      useOutputPanelState.setState({ groups: {} });
    },
  ],
  component: Example,
  argTypes: {
    // --- Scene ---
    selected: {
      table: { category: 'Scene' },
    },
    showCameraTarget: {
      table: { category: 'Scene' },
    },
    sizeMultiplier: {
      table: { category: 'Scene' },
    },

    // --- Wellbores ---
    showShoes: {
      table: { category: 'Wellbores' },
    },
    showDepthMarkers: {
      table: { category: 'Wellbores' },
    },
    depthMarkerInterval: {
      table: { category: 'Wellbores' },
    },
    showCasingAndCompletion: {
      table: { category: 'Wellbores' },
    },
    casingOpacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      },
      table: { category: 'Wellbores' },
    },
    showPerforations: {
      table: { category: 'Wellbores' },
    },
    showFormationMarkers: {
      table: { category: 'Wellbores' },
    },
    showFormationColumns: {
      table: { category: 'Wellbores' },
    },
    showSeismic: {
      table: { category: 'Wellbores' },
    },

    // --- Surfaces ---
    useColorRamp: {
      table: { category: 'Surfaces' },
    },
    reverseRamp: {
      table: { category: 'Surfaces' },
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
      table: { category: 'Surfaces' },
    },
    opacity: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      },
      table: { category: 'Surfaces' },
    },
    wireframe: {
      table: { category: 'Surfaces' },
    },
    precomputeSurfaceNormals: {
      table: { category: 'Surfaces' },
    },

    // --- Rendering (OIT) ---
    oitEnabled: {
      control: { type: 'boolean' },
      table: { category: 'Rendering (OIT)' },
    },

    // --- Anti-aliasing ---
    aaMode: {
      options: ['none', 'temporal', 'smaa', 'temporal-smaa', 'taa', 'fxaa'],
      control: {
        type: 'select',
        labels: {
          none: 'None (no AA)',
          temporal: 'Temporal SS (still-frame)',
          smaa: 'SMAA (spatial edges)',
          'temporal-smaa': 'Temporal SS + SMAA',
          taa: 'TAA (reprojected, motion)',
          fxaa: 'FXAA (fast spatial)',
        },
      },
      table: { category: 'Anti-aliasing' },
    },
    supersample: {
      options: [0.25, 0.5, 1, 1.5, 2, 4],
      control: {
        type: 'select',
        labels: {
          0.25: 'SSAA 0.25×',
          0.5: 'SSAA 0.5×',
          1: 'Off',
          1.5: 'SSAA 1.5×',
          2: 'SSAA 2×',
          4: 'SSAA 4×',
        },
      },
      table: { category: 'Anti-aliasing' },
    },
    msaaSamples: {
      description:
        'MSAA on the OIT opaque target (opaqueSamples). Not recommended with the OIT pipeline: the auxiliary OIT buffers are single-sample, so opaque edges are matted against the background before the transparent surfaces composite, leaving a background-coloured fringe over surfaces. Prefer temporal / SMAA (aaMode) or supersampling. Kept for opaque-only close-ups.',
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
      table: { category: 'Anti-aliasing' },
    },
    smaaQuality: {
      options: ['low', 'medium', 'high', 'ultra'],
      control: {
        type: 'select',
        labels: {
          low: 'Low (threshold 0.15 / 4 steps)',
          medium: 'Medium (0.10 / 8)',
          high: 'High (0.10 / 16)',
          ultra: 'Ultra (0.05 / 32)',
        },
      },
      table: { category: 'Anti-aliasing' },
    },

    // --- Advanced (Diagnostics) ---
    skipFrontPeeling: {
      control: { type: 'boolean' },
      table: { category: 'Advanced (Diagnostics)' },
    },
    showDebugTargets: {
      control: { type: 'boolean' },
      table: { category: 'Advanced (Diagnostics)' },
    },
    profileTail: {
      control: { type: 'boolean' },
      table: { category: 'Advanced (Diagnostics)' },
    },
    occlusionDepthStamp: {
      control: { type: 'boolean' },
      table: { category: 'Advanced (Diagnostics)' },
    },
    occlusionDepthThreshold: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      table: { category: 'Advanced (Diagnostics)' },
    },
    emitterDepthStamp: {
      control: { type: 'boolean' },
      table: { category: 'Advanced (Diagnostics)' },
    },
    emitterDepthThreshold: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      table: { category: 'Advanced (Diagnostics)' },
    },

    // --- Ocean ---
    showOcean: {
      control: { type: 'boolean' },
      table: { category: 'Ocean' },
    },
    showTanker: {
      control: { type: 'boolean' },
      table: { category: 'Ocean' },
    },

    colors: { control: { disable: true } },
  },
  decorators: [
    PerformanceDecorator,
    EventEmitterDecorator,
    AnnotationsDecoratorNoAutoUpdate,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    WellMapDecorator,
    OutputPanelDecorator,
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
  aaMode: 'taa' as const,
  supersample: 1 as const,
  msaaSamples: 0 as const,
  smaaQuality: 'high' as const,
  skipFrontPeeling: false,
  showDebugTargets: false,
  profileTail: false,
  occlusionDepthStamp: false,
  occlusionDepthThreshold: 0.5,
  emitterDepthStamp: false,
  emitterDepthThreshold: 0.5,
  precomputeSurfaceNormals: true,
  showOcean: false,
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
