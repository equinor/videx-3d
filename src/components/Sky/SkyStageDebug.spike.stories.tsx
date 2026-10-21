import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { Pass } from '../../rendering/Pass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import { OITRenderPass } from '../../rendering/passes/OITRenderPass';
import { OutputPass } from '../../rendering/passes/OutputPass';
import type { SeabedMesh } from '../../sdk/geometries/surface-clip';
import { EnvironmentProbes } from '../../storybook/components/EnvironmentProbes';
import {
  skyCutawayArgs,
  SkyCutawayArgs,
  skyCutawayArgTypes,
  skyCutawayDecorator,
  skyCutawayFromArgs,
} from '../../storybook/components/sky-cutaway-controls';
import {
  skyMoonFromArgs,
  skyObserverFromArgs,
  skyObserverNowArgType,
  skyObserverNowDecorator,
  skyStarsFromArgs,
  skyCloudsFromArgs,
  skySunArgs,
  SkySunArgs,
  skySunArgTypes,
  skySunFromArgs,
} from '../../storybook/components/sky-sun-controls';
import {
  RendererToneMapping,
  toneMappingArgs,
  ToneMappingArgs,
  toneMappingArgTypes,
} from '../../storybook/components/tone-mapping-controls';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DEFAULT_OCEAN_WATER_OPACITY } from '../Ocean/ocean-material';
import { RenderStats } from '../Html/RenderStats/RenderStats';
import { Sky, SkyLayer } from './Sky';
import { SkyBoxStage, SkyBoxStageLayer } from './SkyBoxStage';
import { skyDefaults } from './sky-model';
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

const OitPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  useFrame(() => {}, 2);
  return <RenderingPipeline passes={passes} />;
};

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
  water: boolean;
  seabed: boolean;
  waterOpacity: number;
  seabedOpacity: number;
  drawSky: boolean;
  environment: boolean;
  lightProbe: boolean;
  subsurfaceIntensity: number;
  voidDetail: number;
  voidDetailScale: number;
  voidFalloff: number;
  voidHorizonColor: string;
  voidDepthColor: string;
  voidLidColor: string;
  voidLidFade: number;
  voidLidDetail: number;
  voidLidDetailScale: number;
  voidDarkening: number;
  subsurfaceLightColor: string;
  subsurfaceLightIntensity: number;
  subsurfaceBelow: boolean;
  subsurfaceBelowColor: string;
  subsurfaceBelowIntensity: number;
  showProbes: boolean;
  probeSize: number;
  probeElevation: number;
  pipeline: 'default' | 'oit';
  tint: boolean;
  outline: boolean;
  wireframe: boolean;
  showEnvironment: boolean;
  hide: string[];
  stats: boolean;
  observerNow: boolean;
} & SkyCutawayArgs &
  SkySunArgs &
  ToneMappingArgs;

const StageDebug = (args: StageDebugArgs) => {
  const seabed = useMemo(createSyntheticSeabed, []);
  const hide = args.hide ?? [];

  return (
    <>
      <RendererToneMapping
        toneMapping={args.toneMapping}
        exposure={args.exposure}
      />
      <Sky
        abyss={{
          depthDetail: args.voidDetail,
          depthDetailScale: args.voidDetailScale,
          falloff: args.voidFalloff,
          colors: {
            horizon: args.voidHorizonColor,
            depth: args.voidDepthColor,
            ceiling: args.voidLidColor,
          },
          fadeDistance: args.voidLidFade,
          detail: args.voidLidDetail,
          detailScale: args.voidLidDetailScale,
          darkening: args.voidDarkening,
        }}
        ocean={{
          level: LEVEL,
          depth: DEPTH,
          water: args.water,
          seabed: args.seabed,
          waterOpacity: args.waterOpacity,
          seabedOpacity: args.seabedOpacity,
        }}
        sun={skySunFromArgs(args)}
        observer={skyObserverFromArgs(args)}
        moon={skyMoonFromArgs(args)}
        stars={skyStarsFromArgs(args)}
        clouds={skyCloudsFromArgs(args)}
        background={args.drawSky}
        cutaway={skyCutawayFromArgs(args)}
        environment={args.environment}
        lightProbe={args.lightProbe}
        subsurface={{
          intensity: args.subsurfaceIntensity,
          lights: {
            color: args.subsurfaceLightColor,
            intensity: args.subsurfaceLightIntensity,
            below: args.subsurfaceBelow
              ? {
                  color: args.subsurfaceBelowColor,
                  intensity: args.subsurfaceBelowIntensity,
                }
              : undefined,
          },
        }}
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
      {args.pipeline === 'oit' && <OitPipeline />}
      {args.stats && <RenderStats origin="bottom-left" />}
    </>
  );
};

const meta = {
  title: 'Spikes/Sky/StageDebug',
  component: StageDebug,
  decorators: [Canvas3dDecorator, skyCutawayDecorator, skyObserverNowDecorator],
  parameters: {
    scale: 1000,
    // With every layer hidden nothing else clears the frame, and the last one stays up.
    autoClear: true,
    cameraPosition: [9000, 2500, 9000],
    cameraTarget: [0, BED_Y, 0],
    ownLighting: () => true,
  },
  argTypes: {
    occupant: {
      description:
        'The stage has an occupant, which hands it its own seabed (the synthetic one): the stage draws it as the sea\u2019s, `occupant-bed`, eased into its own by the `relief`. Off, the stage is whole. Changes the stage, unlike the debug options.',
      table: { category: 'Occupant' },
    },
    water: {
      description:
        'The sea\u2019s water, everywhere. Off, the seabed lies dry, and the cutaway cuts it.',
      table: { category: 'Sea' },
    },
    seabed: {
      description:
        'The sea\u2019s seabed, everywhere, the occupant\u2019s included. Off, the void lies below the water, and the cutaway cuts the water alone.',
      table: { category: 'Sea' },
    },
    waterOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      table: { category: 'Sea' },
    },
    seabedOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      description:
        'How much of what lies under the seabed it hides. Crossing 1 rebuilds the seabed\u2019s materials, which compile again.',
      table: { category: 'Sea' },
    },
    drawSky: {
      description:
        'Draw the sky and the stage. Off, both vanish at once, and the environment and the light probe switch to the subsurface.',
      table: { category: 'Sky' },
    },
    ...skyCutawayArgTypes(),
    ...skySunArgTypes(),
    ...skyObserverNowArgType(),
    ...toneMappingArgTypes(),
    voidDetail: {
      control: { type: 'range', min: 0, max: 0.5, step: 0.01 },
      description:
        'Faint distant rock in the depths of the void, wavy strata broken by crags; 0 for none.',
      table: { category: 'Void' },
    },
    voidDetailScale: {
      control: { type: 'range', min: 0.25, max: 4, step: 0.05 },
      description: 'Size of the rock\u2019s features.',
      table: { category: 'Void' },
    },
    voidFalloff: {
      control: { type: 'range', min: 0.1, max: 3, step: 0.05 },
      description:
        'How the depths darken below the horizon: the gradient\u2019s exponent. Smaller reaches the depth colour sooner.',
      table: { category: 'Void' },
    },
    voidHorizonColor: {
      control: { type: 'color' },
      description: 'Where the lid and the depths meet, far away.',
      table: { category: 'Void' },
    },
    voidDepthColor: {
      control: { type: 'color' },
      description: 'Straight down, deep in the void.',
      table: { category: 'Void' },
    },
    voidLidColor: {
      control: { type: 'color' },
      description: 'The lid overhead, near the camera.',
      table: { category: 'Void' },
    },
    voidLidFade: {
      control: { type: 'range', min: 500, max: 100000, step: 500 },
      description:
        'Distance over which the lid recedes into the horizon colour, in metres.',
      table: { category: 'Void' },
    },
    voidLidDetail: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      description: 'Strength of the noise relief on the lid; 0 for none.',
      table: { category: 'Void' },
    },
    voidLidDetailScale: {
      control: { type: 'range', min: 50, max: 10000, step: 50 },
      description: 'Size of the lid\u2019s noise relief, in metres.',
      table: { category: 'Void' },
    },
    voidDarkening: {
      control: { type: 'range', min: 0, max: 20000, step: 100 },
      description:
        'Depth below the seabed over which the void dims toward black, in metres; 0 for none.',
      table: { category: 'Void' },
    },
    environment: {
      description:
        'Bake the sky into `scene.environment` (for MeshStandard materials; nothing here uses it). Its prefiltering is most of a bake\u2019s GPU time.',
      table: { category: 'Bakes' },
    },
    lightProbe: {
      description:
        'Bake the sky into a light probe, which lights the stage\u2019s and the occupant\u2019s seabed. Read back from the GPU asynchronously.',
      table: { category: 'Bakes' },
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
    subsurfaceIntensity: {
      control: { type: 'range', min: 0, max: 4, step: 0.05 },
      description: 'Scales the whole subsurface light: backdrop and panels.',
      table: { category: 'Subsurface' },
    },
    subsurfaceLightColor: {
      control: { type: 'color' },
      description: 'Colour of every light panel.',
      table: { category: 'Subsurface' },
    },
    subsurfaceLightIntensity: {
      control: { type: 'range', min: 0, max: 20, step: 0.1 },
      description: 'Radiance of every light panel.',
      table: { category: 'Subsurface' },
    },
    subsurfaceBelow: {
      description: 'Light the panels below the horizon apart.',
      table: { category: 'Subsurface' },
    },
    subsurfaceBelowColor: {
      control: { type: 'color' },
      if: { arg: 'subsurfaceBelow' },
      table: { category: 'Subsurface' },
    },
    subsurfaceBelowIntensity: {
      control: { type: 'range', min: 0, max: 20, step: 0.1 },
      if: { arg: 'subsurfaceBelow' },
      table: { category: 'Subsurface' },
    },
    showEnvironment: {
      description:
        'The environment\u2019s bake for the zone in view (air, water or subsurface) as its six faces, lower right: `+Y` over `-X -Z +X +Z`, `-Y` under.',
      table: { category: 'Debug' },
    },
    pipeline: {
      control: { type: 'inline-radio' },
      options: ['default', 'oit'],
      description:
        'R3F’s own render, or the `OITRenderPass` (SMAA) + `OutputPass` pipeline the chunk stories use.',
      table: { category: 'Debug' },
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
    stats: {
      description:
        'GPU time, frame time and FPS, draw calls, triangles and resident geometries, textures and programs.',
      table: { category: 'Debug' },
    },
  },
  args: {
    occupant: true,
    water: true,
    seabed: true,
    waterOpacity: DEFAULT_OCEAN_WATER_OPACITY,
    seabedOpacity: skyDefaults.ocean.seabedOpacity,
    drawSky: true,
    environment: true,
    lightProbe: true,
    subsurfaceIntensity: skyDefaults.subsurface.intensity,
    subsurfaceLightColor: skyDefaults.subsurface.lights.color,
    subsurfaceLightIntensity: skyDefaults.subsurface.lights.intensity,
    subsurfaceBelow: false,
    subsurfaceBelowColor: '#9fb4d0',
    subsurfaceBelowIntensity: 1,
    showProbes: false,
    probeSize: 150,
    probeElevation: 300,
    ...skyCutawayArgs,
    ...skySunArgs,
    observerNow: false,
    ...toneMappingArgs,
    voidDetail: skyDefaults.abyss.depthDetail,
    voidDetailScale: skyDefaults.abyss.depthDetailScale,
    voidFalloff: skyDefaults.abyss.falloff,
    voidHorizonColor: skyDefaults.abyss.colors.horizon,
    voidDepthColor: skyDefaults.abyss.colors.depth,
    voidLidColor: skyDefaults.abyss.colors.ceiling,
    voidLidFade: skyDefaults.abyss.fadeDistance,
    voidLidDetail: skyDefaults.abyss.detail,
    voidLidDetailScale: skyDefaults.abyss.detailScale,
    voidDarkening: skyDefaults.abyss.darkening,
    pipeline: 'default',
    tint: false,
    outline: false,
    wireframe: false,
    showEnvironment: false,
    hide: [],
    stats: false,
  },
} satisfies Meta<typeof StageDebug>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
