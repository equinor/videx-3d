import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import { ContourColorMode } from '../../common/types';
import { useData } from '../../hooks/useData';
import {
  createClippedSurface,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import {
  SURFACE_DETAIL_PRESET_NAMES,
  SurfaceDetailPreset,
} from '../../sdk/materials/surface-detail';
import { demoCrs } from '../../storybook/data/demo-crs';
import { createDemoMultiPolygon } from '../../storybook/data/demo-polygons';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { useFieldOutline } from '../../storybook/hooks/useFieldOutline';
import {
  useSurfaceMeta,
  useSurfaceMetaDict,
} from '../../storybook/hooks/useSurfaceMeta';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea, UtmPosition } from '../UtmArea';
import { Surface, SurfaceProps } from './Surface';

// const loader = new TextureLoader()
// const normalMap = loader.load('normal_map.jpg')
// normalMap.anisotropy = 4

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;

const CONTOUR_MODES = {
  darken: ContourColorMode.darken,
  lighten: ContourColorMode.lighten,
  mixed: ContourColorMode.mixed,
};

// The story's contour controls, as `Surface`'s `contours`.
type ContourArgs = {
  contours: boolean;
  contourInterval: number;
  contourMajor: number;
  contourThickness: number;
  contourMode: keyof typeof CONTOUR_MODES;
  contourFactor: number;
  contourColor: string;
  contourLabels: boolean;
  contourLabelLines: 'major' | 'all';
  contourLabelBaseline: 'top' | 'middle' | 'bottom';
  contourLabelFlip: boolean;
};

// The story's detail controls, as `Surface`'s `detail`.
type DetailArgs = {
  detailPreset: SurfaceDetailPreset | 'none';
  detailStrength: number;
  detailScale: number;
};

type SurfaceStoryProps = Omit<
  SurfaceProps,
  | 'meta'
  | 'detail'
  | 'contours'
  | 'showContours'
  | 'contoursInterval'
  | 'contoursColorMode'
  | 'contoursColorModeFactor'
  | 'contoursThickness'
  | 'contoursColor'
> &
  ContourArgs &
  DetailArgs & {
    surfaceId: string;
  };

const SurfaceStory = ({
  surfaceId,
  contours,
  contourInterval,
  contourMajor,
  contourThickness,
  contourMode,
  contourFactor,
  contourColor,
  contourLabels,
  contourLabelLines,
  contourLabelBaseline,
  contourLabelFlip,
  detailPreset,
  detailStrength,
  detailScale,
  ...props
}: SurfaceStoryProps) => {
  const surfaceHeaders = useSurfaceMeta();

  const meta = useMemo<SurfaceMeta | null>(() => {
    return surfaceHeaders.find(d => d.id === surfaceId) || null;
  }, [surfaceId, surfaceHeaders]);

  return (
    <UtmArea origin={origin} utmZone={utmZone}>
      {surfaceId && meta && (
        <UtmPosition
          easting={meta.header.xori}
          northing={meta.header.yori}
          altitude={meta.max}
        >
          <Surface
            {...props}
            meta={meta}
            rampMin={meta.displayMin + (props.rampMin || 0)}
            rampMax={meta.displayMax + (props.rampMax || 0)}
            detail={
              detailPreset === 'none'
                ? undefined
                : {
                    preset: detailPreset,
                    strength: detailStrength,
                    scale: detailScale,
                  }
            }
            contours={
              contours && {
                interval: contourInterval,
                major: contourMajor,
                thickness: contourThickness,
                colorMode: CONTOUR_MODES[contourMode],
                factor: contourFactor,
                color: contourColor,
                labels: contourLabels && {
                  lines: contourLabelLines,
                  baseline: contourLabelBaseline,
                  flip: contourLabelFlip,
                },
              }
            }
          />
        </UtmPosition>
      )}
    </UtmArea>
  );
};

// The `Clipped` story's surface: the reservoir's top where the dataset has one, whose relief
// shows the rim draped; else the first.
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;
const clippedSurfaceId =
  Object.keys(surfaceOptions).find(
    id => surfaceOptions[id] === 'Hugin Fm. VOLVE Top',
  ) ?? Object.keys(surfaceOptions)[0];

const MASKS = {
  field: 'Field outline, from the wells',
  demo: 'Three parts, with holes',
};

// The demo mask, authored in metres east and north of the field's origin: scene Z is south.
const DEMO_MASK = createDemoMultiPolygon(([east, north]) => [east, -north]);

// Every ring of `polygon` (scene X/Z) as line segments, level at `y`.
function maskOutline(polygon: PlanarPolygonGeometry, y: number) {
  const positions: number[] = [];
  for (const rings of polygon.coordinates as PlanarPolygonCoordinates)
    for (const ring of rings)
      ring.forEach(([ax, az], i) => {
        const [bx, bz] = ring[(i + 1) % ring.length];
        positions.push(ax, y, az, bx, y, bz);
      });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

type ClippedArgs = {
  surfaceId: string;
  mask: keyof typeof MASKS;
  cutHoles: boolean;
  maxError: number;
  color: string;
  outline: boolean;
  reference: boolean;
};

/**
 * A surface clipped to a polygon mask with `createClippedSurface`: its values read from the
 * store and triangulated inside the mask's exact rim, in the scene frame the mask is given
 * in. The mesh is placed as a `Surface` is, so the two coincide.
 */
const ClippedSurfaceStory = ({
  surfaceId,
  mask,
  cutHoles,
  maxError,
  color,
  outline,
  reference,
}: ClippedArgs) => {
  const store = useData();
  const surfaces = useSurfaceMetaDict();
  const meta = surfaces[surfaceId] ?? null;
  const fieldOutline = useFieldOutline();
  const polygon = mask === 'demo' ? DEMO_MASK : fieldOutline;

  // The clipped mesh, and the surface it was cut from: drawn only under that surface's place.
  const [clipped, setClipped] = useState<{
    id: string;
    geometry: BufferGeometry | null;
  } | null>(null);
  useEffect(() => {
    if (!store || !meta || !polygon) return;
    let cancelled = false;
    store.get<Float32Array>('surface-values', meta.id).then(values => {
      if (cancelled || !values) return;
      // Where the surface's `UtmPosition` puts its origin, in the mask's scene X/Z.
      const at = demoCrs.utmToWorld(meta.header.xori, meta.header.yori, 0);
      setClipped({
        id: meta.id,
        geometry: createClippedSurface(values, meta.header, {
          polygon,
          referenceDepth: meta.max,
          worldPosition: [at.x, at.z],
          maxError,
          cutHoles,
        }),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [store, meta, polygon, maxError, cutHoles]);
  useEffect(() => () => clipped?.geometry?.dispose(), [clipped]);

  // Level just over the surface's shallowest point (placed as below, at `meta.max`).
  const top = meta ? meta.max - meta.min + 10 : 0;
  const lines = useMemo(
    () => (outline && polygon ? maskOutline(polygon, top) : null),
    [outline, polygon, top],
  );
  useEffect(() => () => lines?.dispose(), [lines]);

  const geometry = meta && clipped?.id === meta.id ? clipped.geometry : null;

  return (
    <UtmArea origin={origin} utmZone={utmZone}>
      {meta && (
        <UtmPosition
          easting={meta.header.xori}
          northing={meta.header.yori}
          altitude={meta.max}
        >
          {geometry && (
            <mesh geometry={geometry}>
              <meshStandardMaterial
                color={color}
                side={DoubleSide}
                roughness={0.8}
              />
            </mesh>
          )}
          {reference && <Surface meta={meta} opacity={0.25} wireframe />}
        </UtmPosition>
      )}
      {lines && (
        <lineSegments geometry={lines}>
          <lineBasicMaterial color="#ffcc00" />
        </lineSegments>
      )}
    </UtmArea>
  );
};

/**
 * Depth surfaces (horizons) of the demo field. A `Surface` is a mesh of a regular grid of depths
 * (its `SurfaceMeta`, and its values from the data store: see
 * [Data](/videx-3d/docs/documents/data.html)), simplified within `maxError` metres and built by
 * a generator (see [Generators](/videx-3d/docs/documents/generators.html)). Its colour ramp and
 * contour lines read the full grid, however coarse the mesh. Here it is placed in a `UtmArea`,
 * with a `UtmPosition` at its grid's origin.
 *
 * `createClippedSurface` cuts a surface to a polygon instead: a mesh of what lies inside it,
 * along its exact edge.
 */
const meta = {
  title: 'Components/Surfaces/Surface',
  component: SurfaceStory,
} satisfies Meta<typeof SurfaceStory>;

type StoryArgs = React.ComponentProps<typeof SurfaceStory>;

export default meta;
type Story = StoryObj<StoryArgs>;

const CONTOURS = 'Contours';
const DETAIL = 'Detail';
const lined = { if: { arg: 'contours' } };
const labelled = { if: { arg: 'contourLabels' } };
const detailed = { if: { arg: 'detailPreset', neq: 'none' } };

/**
 * A surface of the demo field (`surfaceId`) coloured by depth (`colorRamp`, `reverseRamp`;
 * `rampMin` and `rampMax` move the ramp's ends, in metres; `useColorRamp` off for a plain
 * `color`), with contour lines and their depths (the Contours group). Set how closely the mesh
 * follows the grid (`maxError`), whether no-data holes are cut or filled (`cutHoles`, smoothed
 * by `edgeSmoothing`), and add relief up close (the Detail group; zoom in).
 */
export const Default: Story = {
  args: {
    surfaceId: Object.keys(storyArgs.surfaceOptions)[0],
    useColorRamp: true,
    reverseRamp: false,
    color: 'white',
    colorRamp: 0,
    opacity: 1,
    maxError: 2.5,
    cutHoles: true,
    edgeSmoothing: 0,
    wireframe: false,
    contours: true,
    contourInterval: 10,
    contourMajor: 5,
    contourThickness: 0.8,
    contourMode: 'darken',
    contourFactor: 0.5,
    contourColor: '#000000',
    contourLabels: true,
    contourLabelLines: 'major',
    contourLabelBaseline: 'middle',
    contourLabelFlip: true,
    rampMin: 0,
    rampMax: 0,
    precomputeNormals: false,
    detailPreset: 'none',
    detailStrength: 1,
    detailScale: 1,
  },
  argTypes: {
    surfaceId: {
      options: Object.keys(storyArgs.surfaceOptions),
      control: {
        type: 'select',
        labels: storyArgs.surfaceOptions,
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
        },
      },
    },
    color: {
      control: {
        type: 'color',
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
    maxError: {
      control: {
        type: 'range',
        min: 0.1,
        max: 10,
        step: 0.01,
      },
    },
    cutHoles: {
      control: { type: 'boolean' },
    },
    edgeSmoothing: {
      control: {
        type: 'range',
        min: 0,
        max: 5,
        step: 1,
      },
    },
    contours: {
      control: { type: 'boolean' },
      description: 'Contour lines by depth (`contours`).',
      table: { category: CONTOURS },
    },
    contourInterval: {
      options: [1, 2, 5, 10, 25, 50, 100, 250, 500],
      control: { type: 'select' },
      description: 'Metres between lines.',
      table: { category: CONTOURS },
      ...lined,
    },
    contourMajor: {
      control: { type: 'range', min: 0, max: 10, step: 1 },
      description:
        'Every how many lines a major one, twice as wide; 0 for none.',
      table: { category: CONTOURS },
      ...lined,
    },
    contourThickness: {
      control: { type: 'range', min: 0.1, max: 3, step: 0.1 },
      description: 'The lines\u2019 width, about pixels each side.',
      table: { category: CONTOURS },
      ...lined,
    },
    contourMode: {
      options: ['darken', 'lighten', 'mixed'],
      control: { type: 'inline-radio' },
      description:
        'How a line shades the surface: DARKEN, LIGHTEN, or MIXED toward `contourColor`.',
      table: { category: CONTOURS },
      ...lined,
    },
    contourFactor: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'How strongly a line shades.',
      table: { category: CONTOURS },
      ...lined,
    },
    contourColor: {
      control: { type: 'color' },
      description: 'The lines\u2019 colour, MIXED.',
      table: { category: CONTOURS },
      if: { arg: 'contourMode', eq: 'mixed' },
    },
    contourLabels: {
      control: { type: 'boolean' },
      description:
        'Each line\u2019s depth written along it on the surface (`contours.labels`), as a relief\u2019s heights are.',
      table: { category: CONTOURS },
      ...lined,
    },
    contourLabelLines: {
      options: ['major', 'all'],
      control: { type: 'inline-radio' },
      description:
        'The lines labelled (`contours.labels.lines`): the MAJOR ones, or ALL.',
      table: { category: CONTOURS },
      ...labelled,
    },
    contourLabelBaseline: {
      options: ['top', 'middle', 'bottom'],
      control: { type: 'inline-radio' },
      description:
        'Where a label\u2019s text lies by its line (`contours.labels.baseline`): across it (MIDDLE), hanging from it on the deeper side (TOP), or standing on it on the shallower side (BOTTOM).',
      table: { category: CONTOURS },
      ...labelled,
    },
    contourLabelFlip: {
      control: { type: 'boolean' },
      description:
        'Labels turned to read left to right on screen (`contours.labels.flip`); off, the top of the text always toward the shallower side.',
      table: { category: CONTOURS },
      ...labelled,
    },
    normalMap: {
      control: {
        disable: true,
      },
    },
    detailPreset: {
      options: ['none', ...SURFACE_DETAIL_PRESET_NAMES],
      control: { type: 'select' },
      description:
        'Procedural relief up close (`detail`), the zone layers\u2019 presets: anchored in the scene, so no normal map is set up per surface. Seen within a few hundred metres; zoom in.',
      table: { category: DETAIL },
    },
    detailStrength: {
      control: { type: 'range', min: 0, max: 3, step: 0.05 },
      description:
        'Scales the whole preset (`detail.strength`): 1 as designed.',
      table: { category: DETAIL },
      ...detailed,
    },
    detailScale: {
      control: { type: 'range', min: 0.25, max: 8, step: 0.25 },
      description:
        'Multiplies every feature size (`detail.scale`), the slopes kept: larger reads from further away.',
      table: { category: DETAIL },
      ...detailed,
    },
    rampMin: {
      control: {
        type: 'range',
        min: -100,
        max: 100,
        step: 1,
      },
    },
    rampMax: {
      control: {
        type: 'range',
        min: -100,
        max: 100,
        step: 1,
      },
    },
  },
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
  render: args => <SurfaceStory {...args} />,
};

const CLIP = 'Clip';
const MASK = 'Mask';
const LOOK = 'Look';

/**
 * A surface cut to a polygon (`createClippedSurface`): only what lies inside is triangulated,
 * along the polygon's exact edge rather than the grid's staircase, holes and separate parts
 * included. Switch the polygon (`mask`) between the outline of the field's wells and a demo
 * shape of three parts; the yellow lines are the polygon (`outline`), the faint wireframe the
 * whole surface (`reference`).
 */
export const Clipped: StoryObj<ClippedArgs> = {
  args: {
    surfaceId: clippedSurfaceId,
    mask: 'field',
    cutHoles: true,
    maxError: 5,
    color: '#59a14f',
    outline: true,
    reference: true,
  },
  argTypes: {
    surfaceId: {
      options: Object.keys(surfaceOptions),
      control: { type: 'select', labels: surfaceOptions },
      description:
        'The surface clipped: its `SurfaceMeta`, and its values read from the store.',
      table: { category: CLIP },
    },
    cutHoles: {
      control: { type: 'boolean' },
      description:
        'Where the grid has no data inside the mask, cut it away with a clean rim (`cutHoles`); off, fill it from the samples around.',
      table: { category: CLIP },
    },
    maxError: {
      control: { type: 'range', min: 0.5, max: 50, step: 0.5 },
      description:
        'Metres the simplified interior may stray from the grid (`maxError`): lower is finer, with more triangles.',
      table: { category: CLIP },
    },
    mask: {
      options: Object.keys(MASKS),
      control: { type: 'inline-radio', labels: MASKS },
      description:
        'The mask (`polygon`), in the scene\u2019s X/Z: FIELD, the outline of the field\u2019s wells, buffered; DEMO, three parts, two of them with holes.',
      table: { category: MASK },
    },
    outline: {
      control: { type: 'boolean' },
      description: 'The mask\u2019s rings, drawn level over the surface.',
      table: { category: MASK },
    },
    color: {
      control: { type: 'color' },
      description:
        'The clipped mesh\u2019s colour: a plain `meshStandardMaterial` on it.',
      table: { category: LOOK },
    },
    reference: {
      control: { type: 'boolean' },
      description:
        'The whole surface (`Surface`), faint and in wireframe, placed the same way.',
      table: { category: LOOK },
    },
  },
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [-5000, 6000, 6000],
  },
  render: args => <ClippedSurfaceStory {...args} />,
};
