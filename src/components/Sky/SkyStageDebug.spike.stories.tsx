import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Color,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { SeabedMesh } from '../../sdk/geometries/surface-clip';
import { EnvironmentProbes } from '../../storybook/components/EnvironmentProbes';
import {
  skyAbyssFromArgs,
  skyArgs,
  SkyArgs,
  skyArgTypes,
  skyDecorators,
  skyHideArgType,
  skyHideFromArgs,
  skyOceanFromArgs,
  skyOutlineArgType,
  skyPropsFromArgs,
  skyReliefArgs,
  SkyReliefArgs,
  skyReliefArgTypes,
  skyReliefFrame,
  skyReliefFromArgs,
  skyWallDebugArgs,
  SkyWallDebugArgs,
  skyWallDebugArgTypes,
  skyWallDebugFromArgs,
} from '../../storybook/components/sky-controls';
import {
  SkyDebugPanel,
  useSkyTimelapse,
} from '../../storybook/components/sky-debug-panel';
import { SkyStoryRendering } from '../../storybook/components/sky-story-rendering';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { Sky } from './Sky';
import { SkyBoxStage } from './SkyBoxStage';
import { SkyStageBounds } from './sky-stage';

// How the sky, its stage and an occupant fit together: a stage of any size, a synthetic
// seabed handed to it as the occupant's, spheres standing in for data, and debug views
// that only change what is drawn.

const LEVEL = 0;
const DEPTH = 100;
const BED_Y = LEVEL - DEPTH;
const RADIUS = 3000;
const RINGS = 40;
const SEGMENTS = 192;
// The stage's half extents the occupant was drawn for; it scales with the stage from there.
const BASE_HALF = 8000;
// The panel's places, about a stage `halfWidth` wide (east-west).
const stagePositions = (
  halfWidth: number,
): Record<string, [number, number]> => ({
  centre: [0, 0],
  'stage edge': [halfWidth, 0],
  beyond: [halfWidth + 22000, 0],
  // Off the Norwegian coast, from Volve, where the sun's place puts the relief.
  coast: [200000, -50000],
});

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

// A polar grid out to its rim, with lobes in it, stretched by `sx` east-west and `sz`
// north-south; its relief as drawn for the base stage.
function createSyntheticSeabed(sx: number, sz: number): SeabedMesh {
  const positions: number[] = [0, seabedHeight(0, 0), 0];
  for (let k = 1; k <= RINGS; k++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const angle = (j / SEGMENTS) * Math.PI * 2;
      const r = (rimRadius(angle) * k) / RINGS;
      const x = r * Math.cos(angle);
      const z = r * Math.sin(angle);
      positions.push(x * sx, seabedHeight(x, z), z * sz);
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

// Stand-ins for data: radii (times `sphereSize`), how deep below the sea their centres go,
// a fixed seed so every run places the same ones, and their colours.
const SPHERE_RADII = [150, 450];
const SPHERE_DEPTH = 5000;
const SPHERE_SEED = 20261024;
const SPHERE_COLORS = [
  '#e15759',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
];

// Uniform in [0, 1), the same sequence for the same seed (mulberry32).
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type StandInSpheresProps = {
  count: number;
  size: number;
  halfWidth: number;
  halfLength: number;
  /** whether a sphere `radius` across about (x, z) lies wholly inside the stage */
  inside: (x: number, z: number, radius: number) => boolean;
};

// `count` spheres, from the sea surface down to SPHERE_DEPTH, wholly inside the stage, in
// one instanced draw.
const StandInSpheres = ({
  count,
  size,
  halfWidth,
  halfLength,
  inside,
}: StandInSpheresProps) => {
  const geometry = useMemo(() => new SphereGeometry(1, 32, 16), []);
  const material = useMemo(
    () => new MeshStandardMaterial({ roughness: 0.5 }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const spheres = mesh.current;
    if (!spheres) return;
    const random = seededRandom(SPHERE_SEED);
    const matrix = new Matrix4();
    const color = new Color();
    let placed = 0;
    for (let tries = 0; placed < count && tries < 100 * count; tries++) {
      const radius =
        MathUtils.lerp(SPHERE_RADII[0], SPHERE_RADII[1], random()) * size;
      const x = (2 * random() - 1) * halfWidth;
      const z = (2 * random() - 1) * halfLength;
      const y = LEVEL - SPHERE_DEPTH * random();
      if (!inside(x, z, radius)) continue;
      matrix.makeScale(radius, radius, radius).setPosition(x, y, z);
      spheres.setMatrixAt(placed, matrix);
      spheres.setColorAt(
        placed,
        color.set(SPHERE_COLORS[placed % SPHERE_COLORS.length]),
      );
      placed++;
    }
    spheres.count = placed;
    spheres.instanceMatrix.needsUpdate = true;
    if (spheres.instanceColor) spheres.instanceColor.needsUpdate = true;
    spheres.computeBoundingSphere();
  }, [count, size, halfWidth, halfLength, inside]);
  return <instancedMesh ref={mesh} args={[geometry, material, count]} />;
};

type StageDebugArgs = {
  stage: boolean;
  stageWidth: number;
  stageLength: number;
  occupant: boolean;
  spheres: number;
  sphereSize: number;
  showProbes: boolean;
  probeSize: number;
  probeElevation: number;
  outline: boolean;
  wireframe: boolean;
  hide: string[];
  panel: boolean;
} & SkyArgs &
  SkyReliefArgs &
  SkyWallDebugArgs;

const StageDebug = (storyArgs: StageDebugArgs) => {
  const hide = skyHideFromArgs(storyArgs.hide);
  const { args, timelapse } = useSkyTimelapse(storyArgs);
  const halfWidth = (args.stageWidth * 1000) / 2;
  const halfLength = (args.stageLength * 1000) / 2;
  const bounds: SkyStageBounds = [-halfWidth, -halfLength, halfWidth, halfLength];
  const sx = halfWidth / BASE_HALF;
  const sz = halfLength / BASE_HALF;
  const occupant = args.stage && !!args.occupant;
  const seabed = useMemo(
    () => (occupant ? createSyntheticSeabed(sx, sz) : null),
    [occupant, sx, sz],
  );
  // Inside the occupant's rim where it has one, else the stage's rectangle.
  const inside = useMemo(
    () =>
      occupant
        ? (x: number, z: number, radius: number) => {
            const u = x / sx;
            const w = z / sz;
            const margin = radius / Math.min(sx, sz);
            return Math.hypot(u, w) + margin <= rimRadius(Math.atan2(w, u));
          }
        : (x: number, z: number, radius: number) =>
            Math.abs(x) + radius <= halfWidth &&
            Math.abs(z) + radius <= halfLength,
    [occupant, sx, sz, halfWidth, halfLength],
  );

  return (
    <>
      <SkyStoryRendering args={args} />
      {args.panel && (
        <SkyDebugPanel
          args={args}
          level={LEVEL}
          positions={stagePositions(halfWidth)}
          timelapse={timelapse}
        />
      )}
      <Sky
        {...skyPropsFromArgs(args)}
        abyss={skyAbyssFromArgs(args)}
        ocean={{ ...skyOceanFromArgs(args), level: LEVEL, depth: DEPTH }}
        debug={{
          tint: args.tint,
          hide: hide.sky,
          environment: args.showEnvironment,
          walls: skyWallDebugFromArgs(args),
        }}
      >
        {args.stage && (
          <SkyBoxStage
            bounds={bounds}
            occupant={seabed ? { seabed } : undefined}
            relief={skyReliefFromArgs(args, skyReliefFrame(args))}
            debug={{
              outline: args.outline,
              wireframe: args.wireframe,
              hide: hide.stage,
            }}
          />
        )}
        {args.spheres > 0 && (
          <StandInSpheres
            count={args.spheres}
            size={args.sphereSize ?? 1}
            halfWidth={halfWidth}
            halfLength={halfLength}
            inside={inside}
          />
        )}
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
  decorators: [
    Canvas3dDecorator,
    // The relief's, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...skyDecorators,
  ],
  parameters: {
    scale: 1000,
    // Past the horizon from 100 km up (1130 km), so the stage and its relief reach it.
    far: 3000000,
    // With every layer hidden nothing else clears the frame, and the last one stays up.
    autoClear: true,
    cameraPosition: [9000, 2500, 9000],
    cameraTarget: [0, BED_Y, 0],
    ownLighting: () => true,
  },
  argTypes: {
    // Every control, advanced and debug ones included.
    ...skyArgTypes({ debug: true }),
    ...skyReliefArgTypes(),
    stage: {
      description:
        'A `SkyBoxStage` over the stage\u2019s rectangle, centred on the origin. Off, there is none: the void\u2019s walls then close about a point.',
      table: { category: 'Stage' },
    },
    stageWidth: {
      control: { type: 'range', min: 2, max: 80, step: 1 },
      description:
        'The stage\u2019s width east-west, in km. It also bounds the stand-in spheres.',
      table: { category: 'Stage' },
    },
    stageLength: {
      control: { type: 'range', min: 2, max: 80, step: 1 },
      description:
        'The stage\u2019s length north-south, in km. It also bounds the stand-in spheres.',
      table: { category: 'Stage' },
    },
    occupant: {
      description:
        'The stage has an occupant, which hands it its own seabed (the synthetic one, stretched with the stage): the stage draws it as the sea\u2019s, `occupant-bed`, eased into its own by the `falloff`. Off, the stage is whole. Changes the stage, unlike the debug options.',
      table: { category: 'Stage' },
      if: { arg: 'stage' },
    },
    spheres: {
      control: { type: 'range', min: 0, max: 400, step: 10 },
      description:
        'Spheres standing in for data, the same ones every run: from the sea surface down to 5 km, wholly inside the stage (inside the occupant\u2019s rim where it has one). 0 for none.',
      table: { category: 'Stand-in data' },
    },
    sphereSize: {
      control: { type: 'range', min: 0.25, max: 4, step: 0.25 },
      description: 'Scales the spheres\u2019 radii, 150 to 450 m.',
      table: { category: 'Stand-in data' },
      if: { arg: 'spheres' },
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
        'Tint each part by what draws it. The sky: its sea, seabed and void red, what it leaves to the stage purple, its surface layer orange. The stage: surface blue, flat seabed green, falloff cyan, the occupant\u2019s seabed magenta, the relief amber.',
      table: { category: 'Debug' },
    },
    outline: skyOutlineArgType,
    wireframe: {
      description:
        'The triangles of every layer drawn, over everything, in their `tint` colours.',
      table: { category: 'Debug' },
    },
    ...skyWallDebugArgTypes,
    hide: skyHideArgType,
    panel: {
      description:
        'Buttons over the view: the camera\u2019s height, moves to set altitudes, places and views, and a timelapse of the sun from the date and place.',
      table: { category: 'Debug' },
    },
  },
  args: {
    ...skyArgs,
    ...skyReliefArgs,
    ...skyWallDebugArgs,
    stage: true,
    stageWidth: 16,
    stageLength: 16,
    occupant: true,
    spheres: 0,
    sphereSize: 1,
    showProbes: false,
    probeSize: 150,
    probeElevation: 300,
    outline: false,
    wireframe: false,
    hide: [],
    panel: true,
  },
} satisfies Meta<typeof StageDebug>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
