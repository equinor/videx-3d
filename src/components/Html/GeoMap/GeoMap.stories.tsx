import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../../sdk/layers/geo-features';
import { geoFrameLonLat } from '../../../sdk/projection/geo-frame';
import {
  demoFacilityStyle,
  demoPipelineStyle,
  useDemoFacilities,
  useDemoPipelines,
  type DemoFacility,
} from '../../../storybook/components/demo-pipelines';
import { SCENERY_DEMO_RELIEF_LAYERS } from '../../../storybook/components/scenery-controls';
import { demoFrame } from '../../../storybook/data/demo-crs';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../../storybook/decorators/scenery-generators';
import { get } from '../../../storybook/dependencies/api';
import type { GeoPolygonStyle } from '../../Layers/GeoPolygons';
import { GeoMap, type GeoMapProps } from './GeoMap';
import {
  GeoMapLabels,
  GeoMapLines,
  GeoMapPolygons,
  GeoMapSymbols,
} from './layers/GeoMapFeatureLayers';
import { GeoMapGraticule } from './layers/GeoMapGraticule';
import { GeoMapPoints } from './layers/GeoMapLayers';

// A map of its own, filling the page, with no 3D view: the demo reliefs about Volve (npm run
// generate-relief), the discoveries on the Norwegian continental shelf (npm run
// generate-overlays) and the demo pipelines, with the same props the scene's layers take.
// Drag to pan, wheel or pinch to zoom about the pointer, double-click to zoom in (Shift:
// out), the arrow keys and + / − once focused.

const DEPTH = 100;
const CENTER = geoFrameLonLat(demoFrame)(0, 0);

type Discovery = {
  name: string;
  hcType: 'OIL' | 'GAS' | 'OIL/GAS' | 'GAS/CONDENSATE';
};

const HC_COLORS: Record<Discovery['hcType'], string> = {
  OIL: '#2fbf4a',
  GAS: '#e5383b',
  'OIL/GAS': '#f59f00',
  'GAS/CONDENSATE': '#c44dff',
};

const discoveryStyle = (feature: GeoFeature<Discovery>): GeoPolygonStyle => ({
  fill: HC_COLORS[feature.properties.hcType] ?? '#999999',
});
const discoveryName = (feature: GeoFeature<Discovery>) =>
  feature.properties.name;
const atSurface = (feature: GeoFeature<DemoFacility>) =>
  feature.properties.surface === 'Y' ||
  feature.properties.kind === 'ONSHORE FACILITY';

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

type GeoMapArgs = Pick<
  GeoMapProps,
  | 'mode'
  | 'projection'
  | 'globalProjection'
  | 'wheel'
  | 'pan'
  | 'cellPixels'
  | 'maxPixels'
> & {
  relief: boolean;
  contours: boolean;
  graticule: boolean;
  utm: boolean;
  discoveries: boolean;
  labels: boolean;
  pipelines: boolean;
};

const GeoMapStory = ({
  relief,
  contours,
  graticule,
  utm,
  discoveries,
  labels,
  pipelines,
  ...args
}: GeoMapArgs) => {
  const discovered = useDiscoveries();
  const pipes = useDemoPipelines();
  const facilities = useDemoFacilities();
  const view = useMemo(() => ({ center: CENTER, extent: 400000 }), []);
  return (
    <SceneryGenerators>
      <div style={{ position: 'fixed', inset: 0, background: '#0b1622' }}>
        <GeoMap
          {...args}
          frame={demoFrame}
          layers={relief ? SCENERY_DEMO_RELIEF_LAYERS : []}
          depth={DEPTH}
          contours={contours}
          defaultView={view}
          background="#0b1622"
          onViewChange={next => console.info('GeoMap: view', next)}
        >
          {graticule && <GeoMapGraticule latLon utm={utm} labels />}
          {discoveries && (
            <GeoMapPolygons data={discovered} style={discoveryStyle} />
          )}
          {pipelines && <GeoMapLines data={pipes} style={demoPipelineStyle} />}
          {pipelines && (
            <GeoMapSymbols
              data={facilities}
              style={demoFacilityStyle}
              filter={atSurface}
              maxExtent={1200000}
            />
          )}
          {discoveries && labels && (
            <GeoMapLabels
              data={discovered}
              text={discoveryName}
              maxExtent={600000}
            />
          )}
          <GeoMapPoints points={[{ at: [0, 0], label: 'Volve' }]} />
        </GeoMap>
      </div>
    </SceneryGenerators>
  );
};

const meta = {
  title: 'Components/Html/GeoMap',
  component: GeoMapStory,
  decorators: [GeneratorsProviderDecorator, DataProviderDecorator],
  parameters: { layout: 'fullscreen' },
  argTypes: {
    relief: {
      description: 'The demo reliefs, merged as a `GeoRelief` merges them.',
      table: { category: 'Data' },
    },
    discoveries: {
      description:
        'The discoveries as a `GeoPolygons` takes them (`GeoMapPolygons`), coloured by what they hold.',
      table: { category: 'Data' },
    },
    labels: {
      description:
        'Their names (`GeoMapLabels`), up to 600 km across, left out where they would meet.',
      table: { category: 'Data' },
    },
    pipelines: {
      description:
        'The demo pipelines (`GeoMapLines`) and the facilities at the surface (`GeoMapSymbols`), as their scene layers take them.',
      table: { category: 'Data' },
    },
    graticule: {
      description:
        'Latitude and longitude following the zoom (`GeoMapGraticule`), named along the edges.',
      table: { category: 'Data' },
    },
    utm: {
      description: 'The UTM zones, named in their cells.',
      table: { category: 'Data' },
    },
    mode: {
      control: { type: 'inline-radio' },
      options: ['shaded', 'outline'],
      table: { category: 'Look' },
    },
    contours: { table: { category: 'Look' } },
    projection: {
      control: { type: 'inline-radio' },
      options: [
        'scene',
        'web-mercator',
        'equal-earth',
        'lambert-conformal-conic',
        'auto',
      ],
      description:
        'What the map is drawn in. AUTO: the scene’s map up to 2000 km across, the global projection past it. Its middle is a longitude and latitude, so a world map pans anywhere.',
      table: { category: 'Projection' },
    },
    globalProjection: {
      control: { type: 'inline-radio' },
      options: ['web-mercator', 'equal-earth', 'lambert-conformal-conic'],
      table: { category: 'Projection' },
    },
    wheel: {
      control: { type: 'inline-radio' },
      options: ['smooth', 'steps', 'none'],
      description:
        'SMOOTH zooms about the pointer; STEPS halves or doubles the extent a notch at a time.',
      table: { category: 'Interaction' },
    },
    pan: {
      description: 'Drag (or a finger) pans it.',
      table: { category: 'Interaction' },
    },
    cellPixels: {
      control: { type: 'range', min: 1, max: 8, step: 0.5 },
      description:
        'The most device pixels a cell of the relief spans: lower is sharper, for more tiles.',
      table: { category: 'Performance' },
    },
    maxPixels: {
      control: { type: 'range', min: 500000, max: 16000000, step: 500000 },
      description:
        'The most device pixels the relief is drawn with: past it, at a lower pixel ratio.',
      table: { category: 'Performance' },
    },
  },
  args: {
    relief: true,
    discoveries: true,
    labels: true,
    pipelines: true,
    graticule: true,
    utm: false,
    mode: 'shaded',
    contours: false,
    projection: 'auto',
    globalProjection: 'web-mercator',
    wheel: 'smooth',
    pan: true,
    cellPixels: 2,
    maxPixels: 4000000,
  },
} satisfies Meta<typeof GeoMapStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The whole world in Equal Earth, the UTM zones over it: pan to the other side of the Earth. */
export const World: Story = {
  args: { projection: 'equal-earth', utm: true },
};
