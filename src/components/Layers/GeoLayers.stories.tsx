import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import {
  reportReliefProgress,
  SCENERY_DEMO_RELIEF_LAYERS,
} from '../../storybook/components/scenery-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { get } from '../../storybook/dependencies/api';
import { GeoMapCameraMarker } from '../Html/GeoMap/GeoMapMarkers';
import {
  GeoMapLabels,
  GeoMapPolygons,
} from '../Html/GeoMap/layers/GeoMapFeatureLayers';
import { Minimap } from '../Html/Minimap/Minimap';
import { Overlay } from '../Html/Overlay/Overlay';
import type { LabelSizePreset, LabelSizing } from '../Labels/types';
import { Scenery } from '../Scenery/Scenery';
import { ScenerySea } from '../Scenery/ScenerySea';
import { SceneryStage } from '../Scenery/SceneryStage';
import { World } from '../World/World';
import { GeoLabels } from './GeoLabels';
import { GeoPolygons, type GeoPolygonStyle } from './GeoPolygons';
import { GeoRelief } from './GeoRelief';
import { orderControls } from '../../storybook/components/order-controls';

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
  labelSize: 'fit' | LabelSizePreset | number;
  labelSizing: LabelSizing;
  labelMaxLines: number;
  labelTurn: boolean;
  labelMaxPixels: number;
  labelsMaxHeight: number;
  minimap: boolean;
};

const name = (feature: GeoFeature<Discovery>) => feature.properties.name;

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
  labelSize,
  labelSizing,
  labelMaxLines,
  labelTurn,
  labelMaxPixels,
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
  // One object of props for the scene's layer and the map's: the same data, style and band.
  const polygons = {
    data,
    style,
    strokeWidth,
    opacity,
    minHeight: minHeight > 0 ? minHeight : undefined,
    maxHeight: maxHeight > 0 ? maxHeight : undefined,
  };
  const labelled = {
    data,
    text: name,
    maxHeight: labelsMaxHeight > 0 ? labelsMaxHeight : undefined,
  };
  return (
    <World frame={demoFrame}>
      <SceneryGenerators>
        {scenery && (
          <Scenery>
            <ScenerySea level={LEVEL} depth={DEPTH} />
            <SceneryStage boundary={STAGE_BOUNDS} />
          </Scenery>
        )}
        {/* The seabed: the demo reliefs, or under the Scenery flat at the sea's depth. */}
        {(relief || scenery) && (
          <GeoRelief
            layers={layers}
            depth={DEPTH}
            color={{ ramp: 'terrain' }}
            onProgress={reportReliefProgress}
          />
        )}
        <GeoPolygons
          {...polygons}
          height={height}
          texelPixels={texelPixels}
          transition={transition}
          fallbackPixels={fallbackPixels > 0 ? fallbackPixels : undefined}
          minDepth={minDepth}
        />
        {labels && (
          <GeoLabels
            {...labelled}
            height={height}
            size={labelSize}
            sizing={labelSizing}
            maxLines={labelMaxLines}
            turn={labelTurn}
            maxPixels={labelMaxPixels > 0 ? labelMaxPixels : undefined}
          />
        )}
        {minimap && scenery && (
          <Overlay>
            <Minimap
              layers={layers}
              depth={DEPTH}
              anchor="bottom-right"
              level={LEVEL}
            >
              <GeoMapPolygons {...polygons} />
              {labels && <GeoMapLabels {...labelled} />}
              <GeoMapCameraMarker />
            </Minimap>
          </Overlay>
        )}
      </SceneryGenerators>
    </World>
  );
};

/**
 * Polygons and their names in longitude and latitude, laid over the Earth from GeoJSON: here the
 * discoveries on the Norwegian continental shelf about the demo field (Sodir, NLOD 2.0).
 *
 * - `GeoPolygons` fills and outlines them at a height over the sea, or on the relief
 *   (`drape`), their edges sharp at any zoom.
 * - `GeoLabels` writes each name flat inside its polygon, where it fits best.
 *
 * Both are placed on the globe by latitude and longitude, and need neither a relief nor a
 * `Scenery`. A `Minimap` draws the same data from the same props (`GeoMapPolygons`,
 * `GeoMapLabels`).
 */
const meta = {
  title: 'Components/Geo layers/GeoLayers',
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
  // Many groups: A to Z.
  ...orderControls<DiscoveriesArgs>(
    {
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
        labelSize: 'fit',
        labelSizing: 'world',
        labelMaxLines: 3,
        labelTurn: true,
        labelMaxPixels: 0,
        labelsMaxHeight: 250000,
        minimap: true,
      },
      argTypes: {
        scenery: {
          description:
            'Inside a `Scenery` (over its sea and relief), or in a `World` alone: on the `World`\u2019s globe either way, so the layer lies in the same place. It needs no `Scenery`.',
          table: { category: 'Scene' },
        },
        relief: {
          description: 'The relief (`GeoRelief`). The layer does not read it.',
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
            'Their names (`GeoLabels`), flat inside each where they fit best, broken into lines where that fits better; hidden when too small to read.',
          table: { category: 'Labels' },
        },
        labelSize: {
          control: 'select',
          options: [
            'fit',
            'xsmall',
            'small',
            'medium',
            'large',
            'xlarge',
            300,
            1000,
          ],
          description:
            '`fit`: metres, each name as large as it fits its polygon (150 m to 3 km), once. A preset: a size on screen, each name broken into the fewest lines that fit its polygon and shrunk where none do, again as you zoom. A number: metres, fitted as a preset is.',
          table: { category: 'Labels' },
        },
        labelSizing: {
          control: 'inline-radio',
          options: ['world', 'screen', 'auto'],
          description:
            'How the size follows the view: a preset is drawn on screen unless `auto` (`fit` on screen is the `small` preset).',
          table: { category: 'Labels' },
        },
        labelMaxLines: {
          control: { type: 'range', min: 1, max: 4, step: 1 },
          description: 'The most lines a name is broken into to fit.',
          table: { category: 'Labels' },
        },
        labelTurn: {
          description:
            'A name turned along a long, narrow polygon where that gives it far more room.',
          table: { category: 'Labels' },
        },
        labelMaxPixels: {
          control: { type: 'range', min: 0, max: 64, step: 1 },
          description:
            'The largest a name is drawn on screen, CSS pixels: nearer, held at it, in fewer lines where its polygon has room. 0: the default (18 sized in metres, none on screen).',
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
            'The same data on a `Minimap`, from the same props as the scene’s layers (`GeoMapPolygons`, `GeoMapLabels`), with the `Scenery`.',
          table: { category: 'Minimap' },
        },
      },
    },
    'alphabetical',
  ),
} satisfies Meta<typeof DiscoveriesStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The discoveries about the demo field inside a `Scenery`, coloured by what they hold (green oil,
 * red gas, orange oil and gas, purple gas and condensate), named, and on a `Minimap`. Zoom out
 * to the shelf; try the `height`, the fill and outline (Style group), the names' size and
 * sizing (Labels group), and only the discoveries in production (`producingOnly`).
 */
export const Discoveries: Story = {};

/**
 * The same layers in a `World` with no `Scenery`: no sea and no minimap, the relief drawn on
 * its own (`relief`). The polygons and names lie where they did.
 */
export const WorldOnly: Story = {
  name: 'Discoveries (World only)',
  args: { scenery: false },
};
