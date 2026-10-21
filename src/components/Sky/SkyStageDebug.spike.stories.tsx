import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import type { SeabedMesh } from '../../sdk/geometries/surface-clip';
import { EnvironmentProbes } from '../../storybook/components/EnvironmentProbes';
import {
  skyAbyssFromArgs,
  skyArgs,
  SkyArgs,
  skyArgTypes,
  skyDecorators,
  skyOceanFromArgs,
  skyPropsFromArgs,
} from '../../storybook/components/sky-controls';
import { SkyStoryRendering } from '../../storybook/components/sky-story-rendering';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { Sky, SkyLayer } from './Sky';
import { SkyBoxStage, SkyBoxStageLayer } from './SkyBoxStage';
import { SkyStageBounds } from './sky-stage';

// How the sky, its stage and an occupant fit together: a synthetic seabed handed to the
// stage as the occupant's, and debug views that only change what is drawn.

const LEVEL = 0;
const DEPTH = 100;
const BED_Y = LEVEL - DEPTH;
const RADIUS = 3000;
const RINGS = 40;
const SEGMENTS = 192;
const BOUNDS: SkyStageBounds = [-8000, -8000, 8000, 8000];

// A lobed outline, so the stage meets it along turns of both hands.
const rimRadius = (angle: number) =>
  RADIUS * (1 + 0.18 * Math.sin(3 * angle + 0.4) + 0.08 * Math.cos(7 * angle));

// Rolling ground and a channel around the sky's seabed depth, so the rim rises and dips
// through it, and hills well above it: x, z, radius and peak height, all below sea level.
const HILLS: [number, number, number, number][] = [
  [1100, 700, 600, -20],
  [-1400, -500, 500, -30],
  [200, -1600, 450, -25],
  [2500, 900, 500, -35],
];
const seabedHeight = (x: number, z: number) => {
  let height =
    BED_Y +
    35 * Math.sin(x / 700) * Math.cos(z / 900) +
    20 * Math.sin((x + 2 * z) / 1500);
  for (const [hx, hz, radius, peak] of HILLS) {
    const rise = Math.exp(-((x - hx) ** 2 + (z - hz) ** 2) / radius ** 2);
    height += (peak - height) * rise;
  }
  return height;
};

// A polar grid out to its rim, with lobes in it.
function createSyntheticSeabed(): SeabedMesh {
  const positions: number[] = [0, seabedHeight(0, 0), 0];
  for (let k = 1; k <= RINGS; k++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const angle = (j / SEGMENTS) * Math.PI * 2;
      const r = (rimRadius(angle) * k) / RINGS;
      const x = r * Math.cos(angle);
      const z = r * Math.sin(angle);
      positions.push(x, seabedHeight(x, z), z);
    }
  }
  const at = (k: number, j: number) =>
    k === 0 ? 0 : 1 + (k - 1) * SEGMENTS + (j % SEGMENTS);
  const indices: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) indices.push(0, at(1, j + 1), at(1, j));
  for (let k = 2; k <= RINGS; k++) {
    for (let j = 0; j < SEGMENTS; j++) {
      indices.push(at(k - 1, j), at(k - 1, j + 1), at(k, j));
      indices.push(at(k, j), at(k - 1, j + 1), at(k, j + 1));
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

const SKY_LAYERS: Record<string, SkyLayer> = {
  'sky background': 'background',
  'sky surface': 'surface',
};

const STAGE_LAYERS: SkyBoxStageLayer[] = [
  'surface',
  'bed',
  'relief',
  'occupant-bed',
];

const HIDE_OPTIONS = [...Object.keys(SKY_LAYERS), ...STAGE_LAYERS];

type StageDebugArgs = {
  occupant: boolean;
  showProbes: boolean;
  probeSize: number;
  probeElevation: number;
  outline: boolean;
  wireframe: boolean;
  hide: string[];
} & SkyArgs;

const StageDebug = (args: StageDebugArgs) => {
  const seabed = useMemo(createSyntheticSeabed, []);
  const hide = args.hide ?? [];

  return (
    <>
      <SkyStoryRendering args={args} />
      <Sky
        {...skyPropsFromArgs(args)}
        abyss={skyAbyssFromArgs(args)}
        ocean={{ ...skyOceanFromArgs(args), level: LEVEL, depth: DEPTH }}
        debug={{
          tint: args.tint,
          hide: hide.filter(l => l in SKY_LAYERS).map(l => SKY_LAYERS[l]),
          environment: args.showEnvironment,
        }}
      >
        <SkyBoxStage
          bounds={BOUNDS}
          occupant={args.occupant ? { seabed } : undefined}
          debug={{
            outline: args.outline,
            wireframe: args.wireframe,
            hide: STAGE_LAYERS.filter(l => hide.includes(l)),
          }}
        />
        {args.showProbes && (
          <EnvironmentProbes
            size={args.probeSize}
            elevation={args.probeElevation}
          />
        )}
      </Sky>
    </>
  );
};

const meta = {
  title: 'Spikes/Sky/StageDebug',
  component: StageDebug,
  decorators: [Canvas3dDecorator, ...skyDecorators],
  parameters: {
    scale: 1000,
    // With every layer hidden nothing else clears the frame, and the last one stays up.
    autoClear: true,
    cameraPosition: [9000, 2500, 9000],
    cameraTarget: [0, BED_Y, 0],
    ownLighting: () => true,
  },
  argTypes: {
    // Every control, advanced and debug ones included.
    ...skyArgTypes({ debug: true }),
    occupant: {
      description:
        'The stage has an occupant, which hands it its own seabed (the synthetic one): the stage draws it as the sea\u2019s, `occupant-bed`, eased into its own by the `relief`. Off, the stage is whole. Changes the stage, unlike the debug options.',
      table: { category: 'Occupant' },
    },
    showProbes: {
      description:
        'Polished metal, rough metal and matte spheres, for judging the environment and the light probe. They take the zone the camera is in, not their own.',
      table: { category: 'Probes' },
    },
    probeSize: {
      control: { type: 'range', min: 10, max: 1000, step: 10 },
      description: 'Radius of each sphere, in metres.',
      table: { category: 'Probes' },
    },
    probeElevation: {
      control: { type: 'range', min: -2000, max: 3000, step: 10 },
      description:
        'Height of the spheres\u2019 centres, in metres: the sea surface is at 0, its seabed at -100.',
      table: { category: 'Probes' },
    },
    tint: {
      description:
        'Tint each part by what draws it. The sky: its sea, seabed and void red, what it leaves to the stage purple, its surface layer orange. The stage: surface blue, flat seabed green, relief cyan, the occupant\u2019s seabed magenta.',
      table: { category: 'Debug' },
    },
    outline: {
      description:
        'The occupant’s outline along its seabed rim (white) and at the sea surface (black), and the stage’s `bounds` (grey), drawn over everything.',
      table: { category: 'Debug' },
    },
    wireframe: {
      description:
        'The triangles of every layer drawn, over everything, in their `tint` colours.',
      table: { category: 'Debug' },
    },
    hide: {
      control: { type: 'check' },
      options: HIDE_OPTIONS,
      description:
        'Layers not to draw. Only their visibility changes: nothing is rebuilt or baked again.',
      table: { category: 'Debug' },
    },
  },
  args: {
    ...skyArgs,
    occupant: true,
    showProbes: false,
    probeSize: 150,
    probeElevation: 300,
    outline: false,
    wireframe: false,
    hide: [],
  },
} satisfies Meta<typeof StageDebug>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
