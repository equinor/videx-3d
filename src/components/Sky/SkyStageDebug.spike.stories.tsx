import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, MeshBasicMaterial } from 'three';
import { createLayers, LAYERS } from '../../layers/layers';
import { Pass } from '../../rendering/Pass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import { OITRenderPass } from '../../rendering/passes/OITRenderPass';
import { OutputPass } from '../../rendering/passes/OutputPass';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import { pointInPolygon } from '../../sdk/geometries/polygon-outline';
import { EnvironmentProbes } from '../../storybook/components/EnvironmentProbes';
import {
  skyCutawayArgs,
  SkyCutawayArgs,
  skyCutawayArgTypes,
  skyCutawayFromArgs,
} from '../../storybook/components/sky-cutaway-controls';
import {
  skyMoonFromArgs,
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
import { ChunkMaterial } from '../Chunks/chunk-material';
import { RenderStats } from '../Html/RenderStats/RenderStats';
import { Sky, SkyLayer } from './Sky';
import { SkyBoxStage, SkyBoxStageLayer } from './SkyBoxStage';
import { useSkyWaterFog } from './sky-context';
import { skyDefaults } from './sky-model';
import {
  SkyStageBounds,
  SkyStageElevationAt,
  SkyStageElevations,
} from './sky-stage';

// How the sky, its stage and an occupant fit together: a synthetic seabed as the occupant,
// lit and fogged as the sky's own, and debug views that only change what is drawn.

const LEVEL = 0;
const DEPTH = 100;
const BED_Y = LEVEL - DEPTH;
const RADIUS = 3000;
const RINGS = 40;
const SEGMENTS = 192;
const BOUNDS: SkyStageBounds = [-8000, -8000, 8000, 8000];
// Drawn last by the OITRenderPass too, over its transparent layers.
const OVERLAY_LAYERS = createLayers(LAYERS.OVERLAY);

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

type SyntheticSeabed = {
  geometry: BufferGeometry;
  outline: PlanarPolygonGeometry;
  elevations: SkyStageElevations;
  elevationAt: SkyStageElevationAt;
};

// A polar grid out to the outline, whose outer ring IS the outline.
function createSyntheticSeabed(): SyntheticSeabed {
  const positions: number[] = [0, seabedHeight(0, 0), 0];
  const ring: [number, number][] = [];
  for (let k = 1; k <= RINGS; k++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const angle = (j / SEGMENTS) * Math.PI * 2;
      const r = (rimRadius(angle) * k) / RINGS;
      const x = r * Math.cos(angle);
      const z = r * Math.sin(angle);
      positions.push(x, seabedHeight(x, z), z);
      if (k === RINGS) ring.push([x, z]);
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
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const coordinates: PlanarPolygonCoordinates = [[ring]];
  return {
    geometry,
    outline: new PlanarPolygonGeometry(coordinates),
    elevations: [[ring.map(([x, z]) => seabedHeight(x, z))]],
    elevationAt: (x, z) =>
      pointInPolygon(x, z, coordinates) ? seabedHeight(x, z) : null,
  };
}

// Drawn as a chunk would draw it, with the sky's seabed look and water.
const Occupant = ({
  seabed,
  visible,
  wireframe,
}: {
  seabed: SyntheticSeabed;
  visible: boolean;
  wireframe: boolean;
}) => {
  const fog = useSkyWaterFog();
  const material = useMemo(
    () =>
      new ChunkMaterial({
        color: skyDefaults.ocean.seabed.color,
        detail: skyDefaults.ocean.seabed.detail,
        waterFog: fog ?? undefined,
        waterFogBed: true,
      }),
    [fog],
  );
  useEffect(() => () => material.dispose(), [material]);
  const wire = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#d8d8d8',
        wireframe: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => wire.dispose(), [wire]);
  return (
    <>
      <mesh geometry={seabed.geometry} material={material} visible={visible} />
      {wireframe && visible && (
        <mesh
          geometry={seabed.geometry}
          material={wire}
          renderOrder={1e9}
          layers={OVERLAY_LAYERS}
        />
      )}
    </>
  );
};

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
  'inner-surface',
  'bed',
  'relief',
  'inner-bed',
  'band',
  'walls',
];

const HIDE_OPTIONS = [...Object.keys(SKY_LAYERS), ...STAGE_LAYERS, 'occupant'];

type StageDebugArgs = {
  occupant: boolean;
  occupantSeabed: boolean;
  occupantWater: boolean;
  drawSky: boolean;
  environment: boolean;
  lightProbe: boolean;
  studioIntensity: number;
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
  studioLightColor: string;
  studioLightIntensity: number;
  studioBelow: boolean;
  studioBelowColor: string;
  studioBelowIntensity: number;
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
} & SkyCutawayArgs &
  SkySunArgs &
  ToneMappingArgs;

const StageDebug = (args: StageDebugArgs) => {
  const seabed = useMemo(createSyntheticSeabed, []);
  useEffect(() => () => seabed.geometry.dispose(), [seabed]);
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
        ocean={{ level: LEVEL, depth: DEPTH }}
        sun={skySunFromArgs(args)}
        moon={skyMoonFromArgs(args)}
        stars={skyStarsFromArgs(args)}
        clouds={skyCloudsFromArgs(args)}
        background={args.drawSky}
        cutaway={skyCutawayFromArgs(args)}
        environment={args.environment}
        lightProbe={args.lightProbe}
        subsurface={{
          intensity: args.studioIntensity,
          lights: {
            color: args.studioLightColor,
            intensity: args.studioLightIntensity,
            below: args.studioBelow
              ? {
                  color: args.studioBelowColor,
                  intensity: args.studioBelowIntensity,
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
          occupant={
            args.occupant
              ? {
                  outline: seabed.outline,
                  elevations: args.occupantSeabed
                    ? seabed.elevations
                    : undefined,
                  elevationAt: args.occupantSeabed
                    ? seabed.elevationAt
                    : undefined,
                  tolerance: 1,
                  seabed: !args.occupantSeabed,
                  water: args.occupantWater,
                }
              : undefined
          }
          debug={{
            outline: args.outline,
            wireframe: args.wireframe,
            hide: STAGE_LAYERS.filter(l => hide.includes(l)),
          }}
        />
        {args.occupant && args.occupantSeabed && (
          <Occupant
            seabed={seabed}
            visible={!hide.includes('occupant')}
            wireframe={args.wireframe}
          />
        )}
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
  decorators: [Canvas3dDecorator],
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
        'The stage has an occupant: the synthetic seabed\u2019s outline. Off, the stage is whole \u2014 no hole, relief, band or walls. Changes the stage, unlike the debug options.',
      table: { category: 'Occupant' },
    },
    occupantSeabed: {
      description:
        'The occupant draws its own seabed (the synthetic one), and the stage eases into it: `relief` and `band`. Off, the stage keeps its flat seabed under the outline: `inner-bed`. Changes the stage, unlike the debug options.',
      table: { category: 'Occupant' },
    },
    occupantWater: {
      description:
        'The stage keeps its water over the outline: `inner-surface`. Off, the outline is drained and walled in by the sea around it: `walls`. Changes the stage, unlike the debug options.',
      table: { category: 'Occupant' },
    },
    drawSky: {
      description:
        'Draw the sky and the stage. Off, both vanish at once, and the environment and the light probe switch to the studio.',
      table: { category: 'Sky' },
    },
    ...skyCutawayArgTypes(),
    ...skySunArgTypes(),
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
    studioIntensity: {
      control: { type: 'range', min: 0, max: 4, step: 0.05 },
      description: 'Scales the whole studio: backdrop and panels.',
      table: { category: 'Studio' },
    },
    studioLightColor: {
      control: { type: 'color' },
      description: 'Colour of every light panel.',
      table: { category: 'Studio' },
    },
    studioLightIntensity: {
      control: { type: 'range', min: 0, max: 20, step: 0.1 },
      description: 'Radiance of every light panel.',
      table: { category: 'Studio' },
    },
    studioBelow: {
      description: 'Light the panels below the horizon apart.',
      table: { category: 'Studio' },
    },
    studioBelowColor: {
      control: { type: 'color' },
      if: { arg: 'studioBelow' },
      table: { category: 'Studio' },
    },
    studioBelowIntensity: {
      control: { type: 'range', min: 0, max: 20, step: 0.1 },
      if: { arg: 'studioBelow' },
      table: { category: 'Studio' },
    },
    showEnvironment: {
      description:
        'The environment\u2019s bake for the zone in view (air, water or studio) as its six faces, lower right: `+Y` over `-X -Z +X +Z`, `-Y` under.',
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
        'Tint each part by what draws it. The sky: its sea, seabed and void red, what it leaves to the stage purple, its surface layer orange. The stage: surface blue, flat seabed green, relief cyan, band magenta, walls yellow. Untinted is the occupant.',
      table: { category: 'Debug' },
    },
    outline: {
      description:
        'The occupant’s outline along its seabed rim (white) and at the sea surface (black), and the stage’s `bounds` (grey), drawn over everything.',
      table: { category: 'Debug' },
    },
    wireframe: {
      description:
        'The triangles of every layer drawn, over everything: the stage’s in its `tint` colours, the occupant’s in light grey.',
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
    occupantSeabed: true,
    occupantWater: true,
    drawSky: true,
    environment: true,
    lightProbe: true,
    studioIntensity: skyDefaults.studio.intensity,
    studioLightColor: skyDefaults.studio.lights.color,
    studioLightIntensity: skyDefaults.studio.lights.intensity,
    studioBelow: false,
    studioBelowColor: '#9fb4d0',
    studioBelowIntensity: 1,
    showProbes: false,
    probeSize: 150,
    probeElevation: 300,
    ...skyCutawayArgs,
    ...skySunArgs,
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
