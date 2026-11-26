import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Plane, Vector3 } from 'three';
import { CameraFlyToEvent } from '../../events/camera-events';
import { PlanarPolygonGeometry, SurfaceMeta, Vec2, Vec3 } from '../../sdk';
import { fenceViewPose } from '../../sdk/geometries/fence-view';
import {
  FenceSideName,
  WellboreFence,
} from '../../sdk/geometries/wellbore-fence';
import { darkenColor } from '../../sdk/utils/colors';
import { StoryOitPipeline } from '../../storybook/components/scenery-story-rendering';
import {
  waterClarityArgType,
  waterColorArgType,
  waterOpticsArgsOf,
  waterOpticsFromArgs,
} from '../../storybook/components/water-optics-controls';
import { sortByStratAge } from '../../storybook/data/strat-ages';
import { stratLayerColors } from '../../storybook/data/strat-units';
import {
  SYNTHETIC_SEABED_ID,
  SYNTHETIC_SEABED_KEY,
} from '../../storybook/data/synthetic-surfaces';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { useFieldOutline } from '../../storybook/hooks/useFieldOutline';
import { useStoreRecord } from '../../storybook/hooks/useStoreRecord';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea, UtmPosition } from '../UtmArea';
import { DEFAULT_WATER_WIND_SPEED } from '../Water/water-material';
import { Trajectory } from '../Wellbores/Trajectory/Trajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';
import { WellboreBounds } from '../Wellbores/WellboreBounds/WellboreBounds';
import { CutoutSource, WellboreOutlineMode } from './cutout';
import { Zone } from './Zone';
import {
  layersFromGroups,
  ZoneCarrier,
  ZoneFence,
  ZoneLayer,
  ZoneSection,
  ZoneStackInteriorFog,
  ZoneStackSea,
} from './zone-defs';
import { ZONE_DETAIL_PRESET_NAMES, ZoneDetailPreset } from './zone-detail';
import { ZoneStack } from './ZoneStack';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;
const wellboreOptions = storyArgs.wellboreOptions as Record<string, string>;

/** Every wellbore of the demo field with a trajectory. */
const WELLBORE_IDS = Object.keys(wellboreOptions);

/**
 * The dataset's own sea bed, if it maps one. Most fields do not (a sea bed is
 * bathymetry, not stratigraphy), and the `Sea` story then generates one.
 */
const SEABED_ID = (storyArgs.seabedSurface as string | null) ?? null;

const FLOOR_COLOR = '#5a5a5a';
/** Metres the floor clears the column's deepest mapped sample by. */
const FLOOR_CLEARANCE = 400;

/**
 * The column's floor: one flat plane under the deepest mapped sample. Declared on
 * the stack, and drawn under every zone whose LAST layer has a fill (`withFloor`).
 */
const CARRIER: ZoneCarrier = { below: FLOOR_CLEARANCE, material: FLOOR_COLOR };

const DEG = Math.PI / 180;

/** The demo field's mapped horizons, shallowest first, in stratigraphic order. */
function useFieldColumn(): SurfaceMeta[] {
  const dict = useSurfaceMetaDict();
  return useMemo(
    () =>
      sortByStratAge(
        Object.keys(surfaceOptions)
          .map(id => dict[id])
          .filter((m): m is SurfaceMeta => !!m),
      ),
    [dict],
  );
}

/** Consecutive groups of `sizes` surfaces each, from the top; the rest is left out. */
function splitIntoGroups(
  surfaces: SurfaceMeta[],
  sizes: number[],
): SurfaceMeta[][] {
  const groups: SurfaceMeta[][] = [];
  let from = 0;
  for (const size of sizes) {
    if (from >= surfaces.length) break;
    groups.push(surfaces.slice(from, from + size));
    from += size;
  }
  return groups;
}

/**
 * Close the block from below. A fill on the LAST layer says the block is open at
 * the bottom, and the stack's carrier is what closes it.
 */
function withFloor(layers: ZoneLayer[]): ZoneLayer[] {
  if (layers.length === 0) return layers;
  const last = layers.length - 1;
  return [...layers.slice(0, last), { ...layers[last], fill: FLOOR_COLOR }];
}

/** One continuous block, each unit coloured as the field's strat column has it. */
function blockLayers(surfaces: SurfaceMeta[]): ZoneLayer[] {
  const colors = stratLayerColors(surfaces.map(s => s.name));
  return withFloor(
    surfaces.map((surface, i) => ({
      surface,
      material: colors[i],
      fill: true,
    })),
  );
}

/** The shallowest and the deepest mapped sample of `surfaces`, in metres positive-down. */
function depthRange(surfaces: SurfaceMeta[]): Vec2 {
  let top = Infinity;
  let bottom = -Infinity;
  for (const meta of surfaces) {
    top = Math.min(top, meta.min);
    bottom = Math.max(bottom, meta.max);
  }
  return [top, bottom];
}

/** The demo field, in its UTM frame, drawn through order-independent transparency. */
const FieldScene = ({ children }: PropsWithChildren) => (
  <>
    <UtmArea origin={origin} utmZone={utmZone}>
      {children}
    </UtmArea>
    <StoryOitPipeline />
  </>
);

/** The trajectories of `ids`. Must sit inside the `UtmArea`. */
const Trajectories = ({
  ids,
  color,
  radius,
}: {
  ids: string[];
  color: string;
  radius: number;
}) => {
  const headers = useWellboreHeaders();
  const shown = useMemo(
    () => headers.filter(header => ids.includes(header.id)),
    [headers, ids],
  );
  return (
    <>
      {shown.map(header => (
        <UtmPosition
          key={header.id}
          easting={header.easting}
          northing={header.northing}
        >
          <Wellbore id={header.id}>
            <WellboreBounds id={header.id}>
              <Trajectory radius={radius} color={color} />
            </WellboreBounds>
          </Wellbore>
        </UtmPosition>
      ))}
    </>
  );
};

// --- Default ------------------------------------------------------------------

/** Surfaces per group, from the shallowest horizon: a preset, since it decides what is built. */
const GROUPINGS: Record<string, string> = {
  '2,2,2': 'Three formations, apart',
  '2,2': 'Two formations, apart',
  '6': 'Six horizons, one block',
  '4,4,4': 'Three blocks of four',
  all: 'The whole column, one block',
};

type DefaultArgs = {
  grouping: string;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  detail: ZoneDetailPreset | 'none';
};

const DefaultStory = ({
  grouping,
  surfaceOpacity,
  wallOpacity,
  wireframe,
  detail,
}: DefaultArgs) => {
  const column = useFieldColumn();
  const outline = useFieldOutline();

  const groups = useMemo(
    () =>
      grouping === 'all'
        ? [column]
        : splitIntoGroups(column, grouping.split(',').map(Number)),
    [column, grouping],
  );
  // Only the horizons drawn: the stack fetches and resolves what it is given.
  const surfaces = useMemo(() => groups.flat(), [groups]);
  // Every layer fills down to the next one in its group; the gap between groups stays open.
  const layers = useMemo(() => {
    const grouped = layersFromGroups(groups);
    if (detail !== 'none') for (const layer of grouped) layer.detail = detail;
    return withFloor(grouped);
  }, [groups, detail]);

  return (
    <FieldScene>
      {layers.length > 0 && (
        <ZoneStack boundary={outline} surfaces={surfaces} carrier={CARRIER}>
          <Zone
            layers={layers}
            surfaceOpacity={surfaceOpacity}
            wallOpacity={wallOpacity}
            wireframe={wireframe}
          />
        </ZoneStack>
      )}
    </FieldScene>
  );
};

// --- WellboreBoundary -----------------------------------------------------------

/** Surfaces per zone, from the shallowest horizon. */
const TIER_SIZES = [4, 4, 4, 4, 3];
const TIER_COLORS = ['#4e79a7', '#59a14f', '#edc949', '#f28e2c', '#e15759'];
const WELL_COLOR = '#00e5ff';

type WellboreBoundaryArgs = {
  mode: WellboreOutlineMode;
  radius: number;
  showWells: boolean;
};

const WellboreBoundaryStory = ({
  mode,
  radius,
  showWells,
}: WellboreBoundaryArgs) => {
  const column = useFieldColumn();

  // One wellbore source on the stack. Every zone inherits it and resolves its OWN
  // footprint from the wells through its own depth range.
  const cutSource = useMemo<CutoutSource>(
    () => ({
      kind: 'wellbores',
      wellbores: WELLBORE_IDS,
      options: { mode, radius },
    }),
    [mode, radius],
  );

  const groups = useMemo(() => splitIntoGroups(column, TIER_SIZES), [column]);
  const surfaces = useMemo(() => groups.flat(), [groups]);
  // A colour per zone, every second unit darker so the slabs read apart.
  const zones = useMemo(
    () =>
      groups.map((group, i) => {
        const base = TIER_COLORS[i % TIER_COLORS.length];
        const layers = group.map((surface, j) => ({
          surface,
          material: j % 2 === 0 ? base : darkenColor(base, 0.3),
          fill: j + 1 < group.length,
        }));
        return {
          key: group[0].id,
          layers: i === groups.length - 1 ? withFloor(layers) : layers,
        };
      }),
    [groups],
  );

  return (
    <FieldScene>
      {zones.length > 0 && (
        <ZoneStack cutSource={cutSource} surfaces={surfaces} carrier={CARRIER}>
          {zones.map(({ key, layers }) => (
            <Zone key={key} layers={layers} />
          ))}
        </ZoneStack>
      )}
      {showWells && (
        <Trajectories ids={WELLBORE_IDS} color={WELL_COLOR} radius={4} />
      )}
    </FieldScene>
  );
};

// --- Section ------------------------------------------------------------------

const sectionNormal = new Vector3();
const sectionPoint = new Vector3();

/**
 * Point `plane` in the stack's own frame. `azimuth` swings the normal in plan and
 * `dip` tilts it out of horizontal, so dip 0 is a vertical cut. `distance` moves
 * the plane off `pivot` along the unflipped normal, so flipping keeps it in place.
 */
function setSectionPlane(
  plane: Plane,
  pivot: Vec3,
  azimuth: number,
  dip: number,
  distance: number,
  flip: boolean,
) {
  const a = azimuth * DEG;
  const d = dip * DEG;
  sectionNormal.set(
    Math.sin(a) * Math.cos(d),
    Math.sin(d),
    Math.cos(a) * Math.cos(d),
  );
  sectionPoint.set(...pivot).addScaledVector(sectionNormal, distance);
  plane.setFromNormalAndCoplanarPoint(sectionNormal, sectionPoint);
  if (flip) plane.negate();
}

/** The middle of the block: the outline's centre, halfway down the column. */
function blockCentre(
  outline: PlanarPolygonGeometry | null,
  column: SurfaceMeta[],
): Vec3 | null {
  if (!outline || column.length === 0) return null;
  const { min, max } = outline.getBounds();
  const [ox, oz] = outline.offset;
  const [top, bottom] = depthRange(column);
  return [
    ox + (min[0] + max[0]) / 2,
    -(top + bottom) / 2,
    oz + (min[1] + max[1]) / 2,
  ];
}

type SectionArgs = {
  mode: 'fixed' | 'target';
  azimuth: number;
  dip: number;
  distance: number;
  flip: boolean;
  cutFloor: boolean;
};

const SectionStory = ({
  mode,
  azimuth,
  dip,
  distance,
  flip,
  cutFloor,
}: SectionArgs) => {
  const column = useFieldColumn();
  const outline = useFieldOutline();
  const layers = useMemo(() => blockLayers(column), [column]);
  const pivot = useMemo(() => blockCentre(outline, column), [outline, column]);

  // Created once and MUTATED: the stack reads the plane every frame, so moving it
  // costs no React render and no rebuild.
  const plane = useMemo(() => new Plane(new Vector3(0, 0, 1), 0), []);
  useEffect(() => {
    if (pivot) setSectionPlane(plane, pivot, azimuth, dip, distance, flip);
  }, [plane, pivot, azimuth, dip, distance, flip]);

  const section = useMemo<ZoneSection>(
    () => ({ plane, lockToTarget: mode === 'target', carrier: cutFloor }),
    [plane, mode, cutFloor],
  );

  return (
    <FieldScene>
      {layers.length > 0 && (
        <ZoneStack
          boundary={outline}
          surfaces={column}
          carrier={CARRIER}
          section={section}
        >
          <Zone layers={layers} />
        </ZoneStack>
      )}
    </FieldScene>
  );
};

// --- Sea ----------------------------------------------------------------------

const SEABED_COLOR = '#c2b280';
const OVERBURDEN_COLOR = '#a08f66';
/** Horizons drawn under the sea bed. */
const WATER_HORIZONS = 4;
/** interior fog with its defaults; a constant, so its identity is stable. */
const INTERIOR_FOG: ZoneStackInteriorFog = {};

type SeaArgs = {
  seaLevel: number;
  opticsColor: string;
  opticsClarity: number;
  windSpeed: number;
  opacity: number;
  wetBand: number;
  interiorFog: boolean;
};

const SeaStory = ({
  seaLevel,
  opticsColor,
  opticsClarity,
  windSpeed,
  opacity,
  wetBand,
  interiorFog,
}: SeaArgs) => {
  const column = useFieldColumn();
  const outline = useFieldOutline();
  // The dataset's sea bed, or the one generated for this story (`parameters.store`).
  const seabed = useStoreRecord<SurfaceMeta>(
    'surface-meta',
    SEABED_ID ?? SYNTHETIC_SEABED_ID,
  );

  const horizons = useMemo(
    () => column.filter(m => m.id !== seabed?.id).slice(0, WATER_HORIZONS),
    [column, seabed],
  );
  // The sea bed comes first: the sea stands on the column's shallowest surface.
  const surfaces = useMemo(
    () => (seabed ? [seabed, ...horizons] : []),
    [seabed, horizons],
  );
  const layers = useMemo<ZoneLayer[]>(
    () =>
      seabed && horizons.length > 0
        ? [
            { surface: seabed, material: SEABED_COLOR, fill: OVERBURDEN_COLOR },
            ...blockLayers(horizons),
          ]
        : [],
    [seabed, horizons],
  );

  // The sea belongs to the COLUMN, not to a zone: one lid over the whole stack.
  const sea = useMemo<ZoneStackSea>(
    () => ({
      depth: seaLevel,
      optics: waterOpticsFromArgs(opticsColor, opticsClarity),
      windSpeed,
      opacity,
      wetBand,
    }),
    [seaLevel, opticsColor, opticsClarity, windSpeed, opacity, wetBand],
  );

  return (
    <FieldScene>
      {seabed && layers.length > 0 && (
        <ZoneStack
          boundary={outline}
          surfaces={surfaces}
          seabed={seabed.id}
          sea={sea}
          interiorFog={interiorFog ? INTERIOR_FOG : undefined}
          carrier={CARRIER}
        >
          <Zone layers={layers} />
        </ZoneStack>
      )}
    </FieldScene>
  );
};

// --- Fence --------------------------------------------------------------------

const FENCE_WELL_COLOR = 'tomato';

type FenceArgs = {
  wellbore: string;
  side: FenceSideName | 'auto';
  margin: number;
  stiffness: number;
};

const FenceStory = ({ wellbore, side, margin, stiffness }: FenceArgs) => {
  const column = useFieldColumn();
  const outline = useFieldOutline();
  const layers = useMemo(() => blockLayers(column), [column]);

  const fence = useMemo<ZoneFence>(
    () => ({ wellbore, side, margin, stiffness }),
    [wellbore, side, margin, stiffness],
  );

  // The block's vertical extent in scene Y, which a view of the fence frames.
  const range = useMemo(() => {
    const [top, bottom] = depthRange(column);
    return { top: -top, bottom: -(bottom + FLOOR_CLEARANCE) };
  }, [column]);

  // Fly to each newly selected wellbore's fence, from where its cut face shows.
  const framed = useRef<string | undefined>(undefined);
  const onFence = useCallback(
    (built: WellboreFence | null) => {
      const id = built?.report.wellbore;
      if (!built || !id || id === framed.current) return;
      framed.current = id;
      const pose = fenceViewPose(
        built,
        side === 'auto' ? range : { ...range, side },
      );
      dispatchEvent(
        new CameraFlyToEvent({
          destination: {
            box: pose.box,
            azimuth: pose.azimuth,
            polar: pose.polar,
            padding: 1.4,
          },
        }),
      );
    },
    [range, side],
  );

  const ids = useMemo(() => [wellbore], [wellbore]);

  return (
    <FieldScene>
      {layers.length > 0 && (
        <ZoneStack
          boundary={outline}
          surfaces={column}
          carrier={CARRIER}
          fence={fence}
          onFence={onFence}
        >
          <Zone layers={layers} />
        </ZoneStack>
      )}
      {/* Drawn at the fence's margin, so the cut just clears the tube. */}
      <Trajectories ids={ids} color={FENCE_WELL_COLOR} radius={margin} />
    </FieldScene>
  );
};

// --- Stories ------------------------------------------------------------------

const meta = {
  title: 'Components/Zones/ZoneStack',
  decorators: [
    EventEmitterDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    // The RenderingPipeline owns clearing: autoClear would wipe the OIT pass's targets.
    autoClear: false,
    scale: 1000,
    cameraPosition: [9000, 4000, 9000],
    cameraTarget: [0, -1500, 0],
    docs: {
      description: {
        component:
          'A `ZoneStack` builds a solid block from depth surfaces. It holds what every `Zone` in it shares: the column (`surfaces`, shallowest first: the order of the array is the stratigraphic order), the boundary, the floor (`carrier`), the sea, and the section or fence that opens it. Each `Zone` draws its own `layers`: a surface, the colour of its cap, and the `fill` of the volume down to the next surface.\n\n' +
          'Zones are built on a worker (see [Generators](/videx-3d/docs/documents/generators.html)), so they appear a moment after the scene loads. The order of the horizons and their colours are the host’s to choose: in the stories, the order comes from the demo field’s stratigraphic column.',
      },
    },
  },
} satisfies Meta;

export default meta;

/**
 * The demo field's horizons grouped into slabs over the field's outline, the interval between
 * two slabs left open (`layersFromGroups`). Change the `grouping` to build other horizons; the
 * controls in the Zone stack group change no geometry.
 */
export const Default: StoryObj<DefaultArgs> = {
  render: args => <DefaultStory {...args} />,
  args: {
    grouping: '2,2,2',
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    detail: 'none',
  },
  argTypes: {
    grouping: {
      control: { type: 'select', labels: GROUPINGS },
      options: Object.keys(GROUPINGS),
      description:
        'Which horizons are drawn and how they are grouped, counted from the shallowest. Each group is a solid slab; the interval between two groups is left open.',
      table: { category: 'Zone' },
    },
    surfaceOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'Opacity of the horizons (the caps).',
      table: { category: 'Zone stack' },
    },
    wallOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'Opacity of the walls around the slabs.',
      table: { category: 'Zone stack' },
    },
    wireframe: {
      control: 'boolean',
      description: 'Draw the tessellation as a wireframe.',
      table: { category: 'Zone stack' },
    },
    detail: {
      control: 'select',
      options: ['none', ...ZONE_DETAIL_PRESET_NAMES],
      description:
        'Procedural relief on every cap and wall, named for a rock type (`ZoneLayer.detail`). It shows as the camera comes close.',
      table: { category: 'Zone stack' },
    },
  },
};

/**
 * Each zone's footprint derived from the demo field's wellbores instead of a polygon: one
 * wellbore source on the stack (`cutSource`), which each of the five zones resolves from the
 * wells through its own depth range. Switch the `mode` to see the footprints change from zone to
 * zone, and widen them with `radius`.
 */
export const WellboreBoundary: StoryObj<WellboreBoundaryArgs> = {
  render: args => <WellboreBoundaryStory {...args} />,
  args: {
    mode: 'above',
    radius: 800,
    showWells: true,
  },
  argTypes: {
    mode: {
      control: { type: 'inline-radio' },
      options: ['window', 'above', 'below'],
      description:
        'Which part of each well shapes a zone: `window` only where it runs through the zone; `above` from the wellhead down to the zone’s base, so the footprints widen with depth; `below` from the zone’s top down to TD, so they narrow.',
      table: { category: 'Boundary' },
    },
    radius: {
      control: { type: 'select' },
      options: [250, 500, 800, 1500, 3000],
      description: 'Metres buffered around the trajectories.',
      table: { category: 'Boundary' },
    },
    showWells: {
      control: 'boolean',
      description: 'Draw the trajectories the footprints are derived from.',
      table: { category: 'Wells' },
    },
  },
};

/**
 * A plane through the whole stack (`ZoneSection`), its cut face filled per interval so the block
 * reads as a geological section. Set the plane (`azimuth`, `dip`, `distance`, `flip`), or let
 * it follow the camera's target (`mode: target`) and orbit to swing the cut; moving it rebuilds
 * nothing.
 */
export const Section: StoryObj<SectionArgs> = {
  render: args => <SectionStory {...args} />,
  args: {
    mode: 'fixed',
    azimuth: 45,
    dip: 0,
    distance: 0,
    flip: false,
    cutFloor: false,
  },
  argTypes: {
    mode: {
      control: { type: 'inline-radio' },
      options: ['fixed', 'target'],
      description:
        '`fixed`: the plane set below. `target`: a vertical plane through the camera’s target, facing the camera — orbit to swing the cut.',
      table: { category: 'Section' },
    },
    azimuth: {
      control: { type: 'range', min: -180, max: 180, step: 5 },
      description:
        'Heading of the plane’s normal, in degrees. The normal points at the half that is removed.',
      table: { category: 'Section' },
      if: { arg: 'mode', eq: 'fixed' },
    },
    dip: {
      control: { type: 'range', min: -80, max: 80, step: 5 },
      description:
        'Tilt of the normal out of horizontal, in degrees. 0 is a vertical cut.',
      table: { category: 'Section' },
      if: { arg: 'mode', eq: 'fixed' },
    },
    distance: {
      control: { type: 'range', min: -8000, max: 8000, step: 100 },
      description:
        'Metres from the centre of the block to the plane, along its normal.',
      table: { category: 'Section' },
      if: { arg: 'mode', eq: 'fixed' },
    },
    flip: {
      control: 'boolean',
      description: 'Keep the other half.',
      table: { category: 'Section' },
      if: { arg: 'mode', eq: 'fixed' },
    },
    cutFloor: {
      control: 'boolean',
      description:
        'Cut the floor too (`ZoneSection.carrier`). Off, the block stands on an intact base plate.',
      table: { category: 'Section' },
    },
  },
};

/**
 * The sea over the stack (`ZoneStackSea`), declared once on the stack and standing on its
 * seabed; the demo field maps none, so one is generated for it. Lower the sea toward the bed
 * (`seaLevel`) to bring its highs out of the water, and set the water's look and the waves in
 * the Sea group.
 */
export const Sea: StoryObj<SeaArgs> = {
  render: args => <SeaStory {...args} />,
  args: {
    seaLevel: 0,
    opticsColor: waterOpticsArgsOf('realistic').color,
    opticsClarity: waterOpticsArgsOf('realistic').clarity,
    windSpeed: DEFAULT_WATER_WIND_SPEED,
    opacity: 1,
    wetBand: 3,
    interiorFog: false,
  },
  argTypes: {
    seaLevel: {
      control: { type: 'range', min: -100, max: 120, step: 5 },
      description:
        'The sea surface, in metres below datum (positive-down, as surfaces are given). The sea bed lies about 90 m down: take this toward it and the bed’s highs come out of the water.',
      table: { category: 'Sea' },
    },
    opticsColor: waterColorArgType('Sea'),
    opticsClarity: waterClarityArgType('Sea'),
    windSpeed: {
      control: { type: 'range', min: 0, max: 25, step: 0.5 },
      description: 'Wind speed in m/s, which drives the waves and whitecaps.',
      table: { category: 'Sea' },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'Master opacity of the sea.',
      table: { category: 'Sea' },
    },
    wetBand: {
      control: { type: 'range', min: 0, max: 30, step: 0.5 },
      description:
        'Metres of darker, wet ground just below the waterline, where the bed comes out of the water. 0 is off.',
      table: { category: 'Shore' },
    },
    interiorFog: {
      control: 'boolean',
      description:
        'Fog the view while the camera is inside the sea or the block (`ZoneStackInteriorFog`). Off by default, since it sets `scene.fog`.',
      table: { category: 'Interior fog' },
    },
  },
  parameters: {
    // The generated sea bed, where the field maps none (`storyStoreLoader`).
    store: SEABED_ID
      ? undefined
      : { syntheticScenarios: [SYNTHETIC_SEABED_KEY] },
    cameraPosition: [6000, 3000, 6000],
    cameraTarget: [0, -100, 0],
  },
};

/**
 * The stack opened along a wellbore of the demo field (`ZoneFence`) instead of with a plane: the
 * cut follows the trajectory, so the well lies in the cut face. Pick another `wellbore` and the
 * camera flies to its fence (`fenceViewPose`, from `onFence`); `side`, `margin` and `stiffness`
 * shape the cut.
 */
export const Fence: StoryObj<FenceArgs> = {
  render: args => <FenceStory {...args} />,
  args: {
    wellbore: storyArgs.defaultWellbore,
    side: 'auto',
    margin: 4,
    stiffness: 1,
  },
  argTypes: {
    wellbore: {
      control: { type: 'select', labels: wellboreOptions },
      options: WELLBORE_IDS,
      description:
        'The wellbore the fence follows. Switching wells resamples the cut; it rebuilds no zone.',
      table: { category: 'Fence' },
    },
    side: {
      control: { type: 'inline-radio' },
      options: ['auto', 'left', 'right'],
      description:
        'Which half is taken away, seen from above walking the well from its head to TD. `auto` keeps the camera in the open half, so the cut face stays in view as you orbit.',
      table: { category: 'Fence' },
    },
    margin: {
      control: { type: 'select' },
      options: [1, 2, 4, 8, 16, 32],
      description:
        'Metres kept between the trajectory and the cut, so what is drawn in the hole is not sliced. The trajectory is drawn at this radius.',
      table: { category: 'Fence' },
    },
    stiffness: {
      control: { type: 'range', min: 0, max: 3, step: 0.25 },
      description:
        'How stiffly the cut bends round the well’s folds and its head. 0 is a taut string.',
      table: { category: 'Fence' },
    },
  },
};
