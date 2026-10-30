import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import type { GeoFeature } from '../../sdk/layers/geo-features';
import {
  DEMO_MEDIUM_COLORS,
  demoFacilityStyle,
  demoInService,
  demoPipelineStyle,
  demoRevealArgs,
  demoRevealArgTypes,
  useDemoFacilities,
  useDemoPipelines,
  useDemoReveal,
  type DemoFacility,
  type DemoPipeline,
  type DemoRevealArgs,
} from '../../storybook/components/demo-pipelines';
import { SCENERY_DEMO_RELIEF_LAYERS } from '../../storybook/components/scenery-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { Minimap } from '../Html/Minimap/Minimap';
import { MinimapCameraMarker } from '../Html/Minimap/MinimapLayers';
import { Scenery } from '../Scenery/Scenery';
import { SceneryOcean } from '../Scenery/SceneryOcean';
import { SceneryStage } from '../Scenery/SceneryStage';
import { World } from '../World/World';
import { GeoLabels } from './GeoLabels';
import { GeoSymbols } from './GeoSymbols';
import { GeoTubes } from './GeoTubes';
import { MinimapGeoLayer, type MinimapGeoStyle } from './MinimapGeoLayer';

// Pipelines and facilities on the Norwegian continental shelf (demo-pipelines.tsx), lying on
// the seabed the stage's relief draws, about the demo field at Volve.

const LEVEL = 0;
const DEPTH = 100;
const STAGE_BOUNDS: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];

type PipelinesArgs = {
  sea: boolean;
  relief: boolean;
  height: number;
  water: 'fog' | 'clear';
  exaggeration: number;
  minPixels: number;
  spacingPerDistance: number;
  span: number;
  inServiceOnly: boolean;
  opacity: number;
  facilities: boolean;
  facilityPixels: number;
  labels: boolean;
  labelsMaxHeight: number;
  labelsMaxDistance: number;
  minimap: boolean;
} & DemoRevealArgs;

const facilityName = (feature: GeoFeature<DemoFacility>) =>
  feature.properties.name;
// On the minimap only what stands out at its scale: the facilities at the surface or on
// land, not the subsea templates round them.
const onMinimap = (feature: GeoFeature<DemoFacility>) =>
  feature.properties.surface === 'Y' ||
  feature.properties.kind === 'ONSHORE FACILITY';
const pipelineMinimapStyle = (
  feature: GeoFeature<DemoPipeline>,
): MinimapGeoStyle => ({
  stroke: DEMO_MEDIUM_COLORS[feature.properties.medium] ?? '#999999',
  strokeWidth: demoInService(feature.properties.phase) ? 1.5 : 0.75,
});
const facilityMinimapStyle = (
  feature: GeoFeature<DemoFacility>,
): MinimapGeoStyle => ({
  fill: feature.properties.kind === 'ONSHORE FACILITY' ? '#ffffff' : '#ffd43b',
  stroke: '#000000',
  strokeWidth: 0.5,
  radius: feature.properties.kind === 'ONSHORE FACILITY' ? 3.5 : 2,
});

const PipelinesStory = ({
  sea,
  relief,
  height,
  water,
  exaggeration,
  minPixels,
  spacingPerDistance,
  span,
  inServiceOnly,
  opacity,
  facilities: showFacilities,
  facilityPixels,
  labels,
  labelsMaxHeight,
  labelsMaxDistance,
  reveal,
  revealAbove,
  revealFade,
  minimap,
}: PipelinesArgs) => {
  const pipelines = useDemoPipelines();
  const facilities = useDemoFacilities();
  const shownPipelines = useMemo(
    () =>
      pipelines && inServiceOnly
        ? {
            ...pipelines,
            features: pipelines.features.filter(f =>
              demoInService(f.properties.phase),
            ),
          }
        : pipelines,
    [pipelines, inServiceOnly],
  );

  const layers = relief ? SCENERY_DEMO_RELIEF_LAYERS : [];
  // On the sea as a map, through its surface and seabed: from `revealAbove` up, or always.
  const revealed = useDemoReveal({ reveal, revealAbove, revealFade });
  return (
    <World frame={demoFrame}>
      <SceneryGenerators>
        <Scenery>
          <SceneryOcean level={LEVEL} depth={DEPTH} water={sea} />
          <SceneryStage
            bounds={STAGE_BOUNDS}
            relief={
              layers.length
                ? { layers, depth: DEPTH, color: { ramp: 'terrain' } }
                : undefined
            }
          />
          {/* Inside the Scenery: on its relief, seen through its sea (water). */}
          <GeoTubes
            data={shownPipelines}
            style={demoPipelineStyle}
            spacingPerDistance={spacingPerDistance}
            span={span}
            height={height}
            water={water}
            exaggeration={exaggeration}
            minPixels={minPixels}
            opacity={opacity}
            reveal={revealed}
          />
          {showFacilities && (
            <GeoSymbols
              data={facilities}
              style={demoFacilityStyle}
              height={height}
              water={water}
              minPixels={facilityPixels}
              reveal={revealed}
            />
          )}
          {showFacilities && labels && (
            <GeoLabels
              data={facilities}
              text={facilityName}
              size={250}
              align="left"
              offset={[0.6, 0]}
              maxHeight={labelsMaxHeight > 0 ? labelsMaxHeight : undefined}
              maxDistance={labelsMaxDistance}
            />
          )}
        </Scenery>
        {minimap && (
          <Minimap layers={layers} origin="bottom-right" level={LEVEL}>
            <MinimapGeoLayer
              data={shownPipelines}
              frame={demoFrame}
              style={pipelineMinimapStyle}
            />
            {showFacilities && (
              <MinimapGeoLayer
                data={facilities}
                frame={demoFrame}
                style={facilityMinimapStyle}
                filter={onMinimap}
                maxExtent={400000}
              />
            )}
            <MinimapCameraMarker />
          </Minimap>
        )}
      </SceneryGenerators>
    </World>
  );
};

const meta = {
  title: 'Components/Layers/Pipelines',
  component: PipelinesStory,
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    cameraPosition: [2000, 9000, 16000],
    cameraTarget: [0, -DEPTH, 6000],
    ownLighting: () => true,
  },
  args: {
    sea: true,
    relief: true,
    height: -DEPTH,
    water: 'fog',
    exaggeration: 20,
    minPixels: 2,
    spacingPerDistance: 0.01,
    span: 60,
    inServiceOnly: false,
    opacity: 1,
    facilities: true,
    facilityPixels: 6,
    labels: true,
    labelsMaxHeight: 40000,
    labelsMaxDistance: 60000,
    ...demoRevealArgs,
    minimap: true,
  },
  argTypes: {
    sea: {
      description:
        'The sea’s water (`SceneryOcean`’s `water`): off, the seabed lies dry and in plain view.',
      table: { category: 'Scene' },
    },
    relief: {
      description:
        'The stage’s relief: the seabed and the land the pipelines and facilities lie on.',
      table: { category: 'Scene' },
    },
    height: {
      control: { type: 'range', min: -400, max: 200, step: 10 },
      description: 'Metres over the sea’s level where no relief is drawn.',
      table: { category: 'Scene' },
    },
    water: {
      control: 'inline-radio',
      options: ['fog', 'clear'],
      description:
        '`fog`: the pipelines and facilities are seen through the sea as the seabed is, gone where the sea turns opaque from a few kilometres up. `clear`: as they are.',
      table: { category: 'Scene' },
    },
    exaggeration: {
      control: { type: 'range', min: 1, max: 200, step: 1 },
      description:
        'How many times wider than built (the diameter) the pipelines are drawn.',
      table: { category: 'Pipelines' },
    },
    minPixels: {
      control: { type: 'range', min: 0, max: 8, step: 0.5 },
      description:
        'The least width a pipeline is drawn, in pixels, however far: a tube reads as a line from afar. 0: as built, gone from afar.',
      table: { category: 'Pipelines' },
    },
    spacingPerDistance: {
      control: { type: 'range', min: 0.002, max: 0.05, step: 0.002 },
      description:
        'Farther from the camera, nodes this share of the distance apart (20 m apart near it): fewer nodes, coarser on the seabed.',
      table: { category: 'Pipelines' },
    },
    span: {
      control: { type: 'range', min: 0, max: 500, step: 10 },
      description:
        'The longest hollow a pipe bridges, resting on the high points (metres; 0 on the ground everywhere).',
      table: { category: 'Pipelines' },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Pipelines' },
    },
    inServiceOnly: {
      description: 'Only pipelines in service (or being installed).',
      table: { category: 'Pipelines' },
    },
    facilities: {
      description:
        'Facilities as discs on the seabed (`GeoSymbols`): at the surface yellow, subsea light blue, onshore white, out of service grey.',
      table: { category: 'Facilities' },
    },
    facilityPixels: {
      control: { type: 'range', min: 0, max: 20, step: 1 },
      description:
        'The least size of a facility on screen, in pixels. 0: as built, gone from afar.',
      table: { category: 'Facilities' },
    },
    labels: {
      description: 'Their names (`GeoLabels`), on the sea over them.',
      table: { category: 'Facilities' },
    },
    labelsMaxHeight: {
      control: { type: 'range', min: 0, max: 400000, step: 5000 },
      description:
        'Above this camera height over the sea the names are hidden (0: never).',
      table: { category: 'Facilities' },
    },
    labelsMaxDistance: {
      control: { type: 'range', min: 5000, max: 300000, step: 5000 },
      description:
        'Farther from the camera than this (metres) a name is not drawn, nor the layer once all are (`GeoLabels`’ `maxDistance`).',
      table: { category: 'Facilities' },
    },
    ...demoRevealArgTypes('Reveal'),
    minimap: {
      description:
        'The same data on a `Minimap` (`MinimapGeoLayer`), less the subsea facilities (its `filter`): the routes thinned to a pixel as they are drawn.',
      table: { category: 'Minimap' },
    },
  },
} satisfies Meta<typeof PipelinesStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTheSeabed: Story = {
  name: 'On the seabed',
};

export const ToTheCoast: Story = {
  name: 'To the coast',
  parameters: {
    cameraPosition: [100000, 150000, 100000],
    cameraTarget: [120000, -DEPTH, -50000],
  },
};
