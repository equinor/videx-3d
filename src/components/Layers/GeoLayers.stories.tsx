import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import { SCENERY_DEMO_RELIEF_LAYERS } from '../../storybook/components/scenery-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { get } from '../../storybook/dependencies/api';
import { Minimap } from '../Html/Minimap/Minimap';
import { MinimapCameraMarker } from '../Html/Minimap/MinimapLayers';
import { Scenery } from '../Scenery/Scenery';
import { SceneryOcean } from '../Scenery/SceneryOcean';
import { SceneryStage } from '../Scenery/SceneryStage';
import { World } from '../World/World';
import { GeoLabels } from './GeoLabels';
import { GeoPolygons, type GeoPolygonStyle } from './GeoPolygons';
import { MinimapGeoLayer } from './MinimapGeoLayer';

// Discoveries on the Norwegian continental shelf (npm run generate-overlays; Sodir, NLOD
// 2.0), about the demo field at Volve.

const LEVEL = 0;
const DEPTH = 100;
const STAGE_BOUNDS: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];

// ⚠️ Not exported: Storybook makes every named export of a stories file a story.
type Discovery = {
  name: string;
  status: string;
  hcType: 'OIL' | 'GAS' | 'OIL/GAS' | 'GAS/CONDENSATE';
  year: number;
  field: string | null;
  url: string;
};

const HC_COLORS: Record<Discovery['hcType'], string> = {
  OIL: '#2fbf4a',
  GAS: '#e5383b',
  'OIL/GAS': '#f59f00',
  'GAS/CONDENSATE': '#c44dff',
};

function useDiscoveries() {
  const [data, setData] = useState<GeoJsonFeatureCollection<Discovery> | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    get('/data/overlays/discoveries.json').then(found => {
      if (live) setData(found);
    });
    return () => {
      live = false;
    };
  }, []);
  return data;
}

type DiscoveriesArgs = {
  scenery: boolean;
  relief: boolean;
  height: number;
  fillOpacity: number;
  strokeWidth: number;
  opacity: number;
  texelPixels: number;
  transition: number;
  fallbackPixels: number;
  minDepth: number;
  minHeight: number;
  maxHeight: number;
  producingOnly: boolean;
  labels: boolean;
  labelsMaxHeight: number;
  minimap: boolean;
};

const name = (feature: GeoFeature<Discovery>) => feature.properties.name;
const minimapStyle = (feature: GeoFeature<Discovery>) => ({
  fill: HC_COLORS[feature.properties.hcType] ?? '#999999',
});

const DiscoveriesStory = ({
  scenery,
  relief,
  height,
  fillOpacity,
  strokeWidth,
  opacity,
  texelPixels,
  transition,
  fallbackPixels,
  minDepth,
  minHeight,
  maxHeight,
  producingOnly,
  labels,
  labelsMaxHeight,
  minimap,
}: DiscoveriesArgs) => {
  const discoveries = useDiscoveries();
  const data = useMemo(
    () =>
      discoveries && producingOnly
        ? {
            ...discoveries,
            features: discoveries.features.filter(
              f => f.properties.status === 'Producing',
            ),
          }
        : discoveries,
    [discoveries, producingOnly],
  );
  const style = useMemo(
    () =>
      (feature: GeoFeature<Discovery>): GeoPolygonStyle => ({
        fill: HC_COLORS[feature.properties.hcType] ?? '#999999',
        fillOpacity,
      }),
    [fillOpacity],
  );
  const layers = relief ? SCENERY_DEMO_RELIEF_LAYERS : [];
  return (
    <World frame={demoFrame}>
      <SceneryGenerators>
        {scenery && (
          <Scenery>
            <SceneryOcean level={LEVEL} depth={DEPTH} />
            <SceneryStage
              bounds={STAGE_BOUNDS}
              relief={
                layers.length
                  ? { layers, depth: DEPTH, color: { ramp: 'terrain' } }
                  : undefined
              }
            />
          </Scenery>
        )}
        <GeoPolygons
          data={data}
          style={style}
          height={height}
          strokeWidth={strokeWidth}
          opacity={opacity}
          texelPixels={texelPixels}
          transition={transition}
          fallbackPixels={fallbackPixels > 0 ? fallbackPixels : undefined}
          minDepth={minDepth}
          minHeight={minHeight > 0 ? minHeight : undefined}
          maxHeight={maxHeight > 0 ? maxHeight : undefined}
        />
        {labels && (
          <GeoLabels
            data={data}
            text={name}
            height={height}
            maxHeight={labelsMaxHeight > 0 ? labelsMaxHeight : undefined}
          />
        )}
        {minimap && scenery && (
          <Minimap layers={layers} origin="bottom-right" level={LEVEL}>
            <MinimapGeoLayer
              data={data}
              frame={demoFrame}
              style={minimapStyle}
            />
            <MinimapCameraMarker />
          </Minimap>
        )}
      </SceneryGenerators>
    </World>
  );
};

const meta = {
  title: 'Components/Layers/GeoLayers',
  component: DiscoveriesStory,
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    cameraPosition: [0, 40000, 45000],
    cameraTarget: [0, LEVEL, 0],
    ownLighting: () => true,
  },
  args: {
    scenery: true,
    relief: true,
    height: 0,
    fillOpacity: 0.35,
    strokeWidth: 1.5,
    opacity: 1,
    texelPixels: 2,
    transition: 300,
    fallbackPixels: 0,
    minDepth: 0,
    minHeight: 0,
    maxHeight: 0,
    producingOnly: false,
    labels: true,
    labelsMaxHeight: 250000,
    minimap: true,
  },
  argTypes: {
    scenery: {
      description:
        'Inside a `Scenery` (on its globe, over its sea and relief), or in a `World` alone, flat on its frame: the layer needs neither.',
      table: { category: 'Scene' },
    },
    relief: {
      description: 'The stage’s relief. The layer does not read it.',
      table: { category: 'Scene' },
    },
    height: {
      control: { type: 'range', min: -400, max: 1000, step: 10 },
      description:
        'Metres over the sea’s level: 0 on the sea, −100 the flat seabed’s depth.',
      table: { category: 'Layer' },
    },
    fillOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Style' },
    },
    strokeWidth: {
      control: { type: 'range', min: 0, max: 4, step: 0.25 },
      description: 'Pixels, inside each polygon’s edge.',
      table: { category: 'Style' },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Style' },
    },
    texelPixels: {
      control: { type: 'range', min: 0.5, max: 6, step: 0.25 },
      description:
        'A tile is split while its texels span more pixels than this: lower is sharper and loads more.',
      table: { category: 'Layer' },
    },
    fallbackPixels: {
      control: { type: 'range', min: 0, max: 64, step: 1 },
      description:
        'The coarsest a tile is brought in to stand in while finer ones load, its texels’ span in pixels (0: 4 × `texelPixels`). Past it such a tile is not loaded; what is drawn already stays until its replacements are in.',
      table: { category: 'Layer' },
    },
    minDepth: {
      control: { type: 'range', min: 0, max: 12, step: 1 },
      description:
        'The shallowest tile ever loaded or drawn: a floor on the detail (a depth-d tile spans 180 / 2^d degrees).',
      table: { category: 'Layer' },
    },
    transition: {
      control: { type: 'range', min: 0, max: 2000, step: 50 },
      description:
        'Milliseconds a swap between levels of detail takes: each tile blends from the look of the one it replaces (0: at once).',
      table: { category: 'Layer' },
    },
    minHeight: {
      control: { type: 'range', min: 0, max: 100000, step: 500 },
      description:
        'Below this camera height over the sea the layer fades out (0: never).',
      table: { category: 'Visibility' },
    },
    maxHeight: {
      control: { type: 'range', min: 0, max: 2000000, step: 10000 },
      description:
        'Above this camera height over the sea the layer fades out (0: never).',
      table: { category: 'Visibility' },
    },
    producingOnly: {
      description: 'Only discoveries in production: new data, new tiles.',
      table: { category: 'Data' },
    },
    labels: {
      description:
        'Their names (`GeoLabels`), flat inside each, sized to fit it; hidden when too small to read.',
      table: { category: 'Labels' },
    },
    labelsMaxHeight: {
      control: { type: 'range', min: 0, max: 2000000, step: 10000 },
      description:
        'Above this camera height over the sea the labels are hidden (0: never).',
      table: { category: 'Labels' },
    },
    minimap: {
      description:
        'The same data on a `Minimap` (`MinimapGeoLayer`), with the `Scenery`.',
      table: { category: 'Minimap' },
    },
  },
} satisfies Meta<typeof DiscoveriesStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Discoveries: Story = {};

export const WorldOnly: Story = {
  name: 'Discoveries (World only)',
  args: { scenery: false },
};
