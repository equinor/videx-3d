import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { ContourColorMode } from '../../common/types';
import {
  SURFACE_DETAIL_PRESET_NAMES,
  SurfaceDetailPreset,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { useSurfaceMeta } from '../../storybook/hooks/useSurfaceMeta';
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
        'Procedural relief up close (`detail`), the chunk layers\u2019 presets: anchored in the scene, so no normal map is set up per surface. Seen within a few hundred metres; zoom in.',
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
