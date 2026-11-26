import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../hooks/useData';
import { PlanarPolygonGeometry, SurfaceMeta, Vec2 } from '../../sdk';
import { SeabedFacility } from '../../storybook/components/SeabedFacility';
import { StoryOitPipeline } from '../../storybook/components/scenery-story-rendering';
import {
  siteByName,
  SUBSEA_ROUTES,
  SUBSEA_SITES,
} from '../../storybook/data/subsea-facilities';
import {
  SYNTHETIC_COLUMN,
  SyntheticColumnUnit,
} from '../../storybook/data/synthetic-surfaces';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { useStoreRecord } from '../../storybook/hooks/useStoreRecord';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea } from '../UtmArea';
import { Zone } from '../Zones/Zone';
import { ZoneLayer, ZoneStackSea } from '../Zones/zone-defs';
import { ZoneStack } from '../Zones/ZoneStack';
import { Pipeline } from './Pipeline';

// Pipelines laid on the sea bed a `ZoneStack` draws: each route a list of UTM positions, as
// one is planned, its height sampled along it from the stack's top as drawn. The sea bed is a
// generated column's (a basin, a coast and an island), the lines three flowlines gathering
// to a subsea site and an export line leaving the field. Their diameters are as built, well
// under a pixel at this scale: `exaggeration` makes them visible.

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;

// The generated column the routes were drawn for (`parameters.store` has the store make it).
const COLUMN = 'shoreline';
// Its sea bed and the unit under it: a slab, its top the ground the lines lie on.
const UNITS = 2;
const UNIT_COLOURS = ['#c2b280', '#8c7b5a'];

// The stack's area: a square 7 km across about the field's origin.
const HALF = 3500;
const BOUNDARY = new PlanarPolygonGeometry(
  [
    [
      [
        [-HALF, -HALF],
        [HALF, -HALF],
        [HALF, HALF],
        [-HALF, HALF],
        [-HALF, -HALF],
      ],
    ],
  ],
  [0, 0],
);

// Over the sea bed: clear water, so what lies on it is seen.
const SEA: ZoneStackSea = { depth: 0, optics: 'clear' };

// The sites' bases are 40 m across: a line stops at a base's edge rather than under it.
const TRIM = 22;

// The routes with their tie-ins resolved to the sites' coordinates: plain UTM, as `Pipeline`
// takes them. Made once: a new route rebuilds the line.
const ROUTES = SUBSEA_ROUTES.map(route => ({
  name: route.name,
  diameter: route.diameter,
  nodes: route.nodes.flatMap((node): Vec2[] => {
    if (typeof node !== 'string') return [node];
    const site = siteByName(node);
    return site ? [[site.easting, site.northing]] : [];
  }),
}));

type PipelineArgs = {
  route: string;
  exaggeration: number;
  span: number;
  color: string;
  sea: boolean;
};

const PipelineStory = ({
  route,
  exaggeration,
  span,
  color,
  sea,
}: PipelineArgs) => {
  const store = useData();
  const units = useStoreRecord<SyntheticColumnUnit[]>(SYNTHETIC_COLUMN, COLUMN);

  // The column's top surfaces, shallowest first: the sea bed, then the unit under it.
  const [surfaces, setSurfaces] = useState<SurfaceMeta[]>([]);
  useEffect(() => {
    if (!store || !units) return;
    let cancelled = false;
    Promise.all(
      units
        .slice(0, UNITS)
        .map(unit => store.get<SurfaceMeta>('surface-meta', unit.id)),
    ).then(metas => {
      if (!cancelled) setSurfaces(metas.filter((m): m is SurfaceMeta => !!m));
    });
    return () => {
      cancelled = true;
    };
  }, [store, units]);

  // The last layer has no fill: the slab ends at its surface.
  const layers = useMemo<ZoneLayer[]>(
    () =>
      surfaces.map((surface, i) => ({
        surface,
        material: UNIT_COLOURS[i],
        fill: i < surfaces.length - 1 ? UNIT_COLOURS[i] : undefined,
      })),
    [surfaces],
  );

  const routes =
    route === 'all' ? ROUTES : ROUTES.filter(({ name }) => name === route);

  return (
    <>
      {layers.length > 0 && (
        <UtmArea origin={origin} utmZone={utmZone}>
          <ZoneStack
            boundary={BOUNDARY}
            surfaces={surfaces}
            seabed={surfaces[0].id}
            sea={sea ? SEA : undefined}
          >
            <Zone layers={layers} />
            {/* The sites the lines tie into, put down on the same sea bed. */}
            {SUBSEA_SITES.map(site => (
              <SeabedFacility key={site.name} site={site} />
            ))}
            {/* Inside the stack: it provides the surface they are laid on. */}
            {routes.map(({ name, nodes, diameter }) => (
              <Pipeline
                key={name}
                route={nodes}
                diameter={diameter}
                exaggeration={exaggeration}
                span={span}
                trim={TRIM}
                material={color}
              />
            ))}
          </ZoneStack>
        </UtmArea>
      )}
      <StoryOitPipeline />
    </>
  );
};

const ROUTE = 'Route';
const LINE = 'Line';
const SCENE = 'Scene';

/**
 * `Pipeline` lays a pipeline, a cable or any line on the ground a `ZoneStack` draws: its route
 * is a list of UTM positions, as one is planned, and its height is sampled along it from the
 * stack's top surface as drawn. It is a tube of its diameter as built times `exaggeration`, and
 * can bridge the hollows rather than follow every dip (`span`). Place it inside a `UtmArea` and
 * a `ZoneStack`.
 *
 * For pipelines in longitude and latitude on the relief of a `Scenery`, use `GeoTubes` (Geo
 * layers / Pipelines).
 */
const meta = {
  title: 'Components/Zones/Pipeline',
  component: PipelineStory,
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    // The generated column's surfaces, made by the store (`storyStoreLoader`).
    store: { syntheticColumns: [COLUMN] },
    // autoClear stays off: the rendering pipeline owns clearing.
    scale: 1000,
    cameraPosition: [-800, 1600, 5600],
    cameraTarget: [1600, -150, 1900],
  },
  args: {
    route: 'all',
    exaggeration: 30,
    span: 0,
    color: '#f28e2c',
    sea: true,
  },
  argTypes: {
    route: {
      options: ['all', ...ROUTES.map(({ name }) => name)],
      control: { type: 'select' },
      description:
        'The route laid (`route`): UTM positions in order, the sites tied into by name in the data and resolved to coordinates here. ALL: the three flowlines to Alpha and the export line.',
      table: { category: ROUTE },
    },
    exaggeration: {
      control: { type: 'range', min: 1, max: 100, step: 1 },
      description:
        'Multiplier on the diameter as built (`exaggeration`): 12\u00be", 16" and 30" lines, under a pixel at 1.',
      table: { category: LINE },
    },
    span: {
      control: { type: 'range', min: 0, max: 500, step: 10 },
      description:
        'Longest hollow the line bridges, in metres (`span`): a stiff line rests on the high points rather than following every dip. 0 follows the ground exactly.',
      table: { category: LINE },
    },
    color: {
      control: { type: 'color' },
      description:
        'The line\u2019s colour (`material`): a colour, for a material made here, or a material of your own.',
      table: { category: LINE },
    },
    sea: {
      control: { type: 'boolean' },
      description:
        'The stack\u2019s sea (`water`), clear over the sea bed. The lines lie on the bed either way.',
      table: { category: SCENE },
    },
  },
} satisfies Meta<typeof PipelineStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Three flowlines gathering to a subsea site and an export line leaving the field, on the
 * seabed of a generated column (a basin, a coast and an island) under clear water. Lay one
 * `route` alone, widen the lines (`exaggeration`: at 1 they are under a pixel), and let them
 * bridge the hollows (`span`).
 */
export const Default: Story = {};
