import type { Meta, StoryObj } from '@storybook/react-vite';
import { useThree } from '@react-three/fiber';
import proj4 from 'proj4';
import { useCallback, useEffect, useRef } from 'react';
import type { ReliefLayer } from '../../sdk/geometries/relief-tiles';
import { getProjectionDefFromUtmZone } from '../../sdk/projection/crs';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import {
  skyAbyssFromArgs,
  skyArgs,
  SkyArgs,
  skyArgTypes,
  skyDecorators,
  skyOceanFromArgs,
  skyPropsFromArgs,
  SKY_DEMO_BAKED_SEABED,
  SKY_DEMO_RELIEF_LAYERS,
} from '../../storybook/components/sky-controls';
import {
  SkyDebugPanel,
  useSkyTimelapse,
} from '../../storybook/components/sky-debug-panel';
import { SkyStoryRendering } from '../../storybook/components/sky-story-rendering';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SkyGenerators } from '../../storybook/decorators/sky-generators';
import { demoFrame } from '../../storybook/data/demo-crs';
import { UtmArea } from '../UtmArea/UtmArea';
import { World } from '../World/World';
import { Sky } from './Sky';
import { SkyAnchor } from './SkyAnchor';
import { SkyBoxStage, SkyBoxStageRelief } from './SkyBoxStage';
import type { SkyReliefTileStats } from './SkyBoxStageReliefTiles';
import type { SkyStageBounds } from './sky-stage';

// Early testing of the relief drawn from tiles (documents/tiles.md): the demo reliefs
// merged around Volve. The reliefs are made on demand: `npm run generate-relief`.

const LEVEL = 0;
const DEPTH = 100;

// The scene at the demo field, as its `UtmArea` places it: scene X east, Z south. The
// story's `World`: the relief is read in it, and the field below placed in it.
const FRAME: GeoFrame = demoFrame;

// The generated sea bed baked into a relief (`surfaceToRelief`): a coast and an island
// over the field, made up, to see a local layer merge.
const BAKED_SEABED = SKY_DEMO_BAKED_SEABED;

// Coarse to fine: later ones win where they have data.
const LAYERS: ReliefLayer[] = [
  ...SKY_DEMO_RELIEF_LAYERS,
  { id: BAKED_SEABED, feather: 500 },
];

// From Volve: east over the Norwegian Trench to the coast and the fjords.
const POSITIONS: Record<string, [number, number]> = {
  Volve: [0, 0],
  'Volve edge': [30000, 0],
  trench: [123000, -7000],
  coast: [215000, -40000],
  Lysefjord: [256000, -62000],
};

// A second field over the trench, in the next UTM zone (32N), with a map of its own about
// its point, to the metre: as a host gives a field it has data for there.
const UTM_32N = getProjectionDefFromUtmZone('32N');
const TRENCH_FRAME: GeoFrame = {
  projection: UTM_32N,
  origin: proj4(FRAME.projection, UTM_32N, [
    FRAME.origin[0] + POSITIONS.trench[0],
    FRAME.origin[1] - POSITIONS.trench[1],
  ]).map(Math.round) as [number, number],
};
// Points on the second field's own grid, east and north of its origin, in metres.
const TRENCH_MARKS: [number, number][] = [
  [5000, 0],
  [0, 5000],
  [-5000, 0],
  [0, -5000],
  [3500, 3500],
  [-3500, -3500],
];
// The same points as the World's map has them: its X/Z.
const TRENCH_CHECKS = TRENCH_MARKS.map(([e, n]): [number, number] => {
  const [x, y] = proj4(UTM_32N, FRAME.projection, [
    TRENCH_FRAME.origin[0] + e,
    TRENCH_FRAME.origin[1] + n,
  ]);
  return [x - FRAME.origin[0], FRAME.origin[1] - y];
});

/** What the tiles draw and hold, as a line of text over the canvas, bottom right. */
function useTileStats(shown: boolean) {
  const gl = useThree(state => state.gl);
  const element = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!shown) return;
    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'absolute',
      right: '10px',
      bottom: '10px',
      zIndex: '10',
      padding: '4px 8px',
      font: '12px monospace',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.55)',
      borderRadius: '3px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    (gl.domElement.parentElement ?? document.body).appendChild(host);
    element.current = host;
    return () => {
      element.current = null;
      host.remove();
    };
  }, [gl, shown]);
  return useCallback((stats: SkyReliefTileStats) => {
    if (!element.current) return;
    const cell =
      stats.cell >= 1000
        ? `${(stats.cell / 1000).toFixed(1)} km`
        : `${stats.cell.toFixed(0)} m`;
    element.current.textContent =
      `tiles ${stats.drawn}  ·  ${(stats.triangles / 1e6).toFixed(2)} M triangles  ·  deepest ${stats.depth} (${cell} cells)\n` +
      `in ${stats.resident} (${(stats.bytes / 1e6).toFixed(1)} MB)  ·  loading ${stats.loading}  ·  waiting ${stats.queued}`;
  }, []);
}

type ReliefTilesArgs = SkyArgs & {
  relief: 'tiles' | 'none';
  layers: string[];
  pixelError: number;
  cellPixels: number;
  reliefColor: 'ramp' | 'flat';
  baseDepth: number;
  stageWidth: number;
  tileStats: boolean;
  tileDebug: 'none' | 'tiles' | 'layers';
  panel: boolean;
  field: 'anchored' | 'free' | 'none';
  facility: 'field' | 'anchored' | 'free' | 'none';
};

/**
 * A stand-in for the field's content, flat at sea level as a field's is: a 4 km plate and
 * a 1.5 km mast, to see from far off whether it stays on the sea. `at` is its middle.
 */
const FieldStandIn = ({ at = [0, 0] }: { at?: [number, number] }) => (
  <group position={[at[0], 0, at[1]]}>
    <mesh position-y={2}>
      <boxGeometry args={[4000, 4, 4000]} />
      <meshBasicMaterial color="#ff7a1a" />
    </mesh>
    <mesh position-y={750}>
      <boxGeometry args={[120, 1500, 120]} />
      <meshBasicMaterial color="#ffd21a" />
    </mesh>
  </group>
);

/** A post `height` tall at `at`, on the sea. */
const Post = ({
  at,
  width,
  height,
  color,
}: {
  at: [number, number];
  width: number;
  height: number;
  color: string;
}) => (
  <mesh position={[at[0], height / 2, at[1]]}>
    <boxGeometry args={[width, height, width]} />
    <meshBasicMaterial color={color} />
  </mesh>
);

/**
 * The second field, drawn in its own map (UTM 32N) and placed by its `UtmArea` in the
 * World's: the stand-in at its origin, and magenta posts on its own grid. Thin cyan posts
 * mark the same points as the World's map has them, each anchored on the globe on its own:
 * they run through the middle of the magenta ones where the placement is right.
 */
const TrenchField = () => (
  <>
    <UtmArea frame={TRENCH_FRAME}>
      <FieldStandIn />
      {TRENCH_MARKS.map(([e, n]) => (
        <Post
          key={`${e},${n}`}
          at={[e, -n]}
          width={80}
          height={400}
          color="#e040fb"
        />
      ))}
    </UtmArea>
    {TRENCH_CHECKS.map(at => (
      <SkyAnchor key={at.join(',')} at={at}>
        <Post at={at} width={20} height={700} color="#18ffff" />
      </SkyAnchor>
    ))}
  </>
);

const ReliefTiles = (storyArgs: ReliefTilesArgs) => {
  const { args, timelapse } = useSkyTimelapse(storyArgs);
  const half = args.stageWidth * 500;
  const bounds: SkyStageBounds = [-half, -half, half, half];
  const onStats = useTileStats(args.tileStats && args.relief === 'tiles');
  const color = args.reliefColor === 'ramp' ? 'ramp' : '#34433b';
  const relief: SkyBoxStageRelief | undefined =
    args.relief === 'tiles'
      ? {
          layers: LAYERS.filter(layer => args.layers.includes(layer.id)),
          depth: args.baseDepth,
          pixelError: args.pixelError,
          cellPixels: args.cellPixels,
          color,
          onStats,
        }
      : undefined;

  return (
    <World frame={FRAME}>
      <SkyStoryRendering args={args} />
      {args.panel && (
        <SkyDebugPanel
          args={args}
          level={LEVEL}
          positions={POSITIONS}
          timelapse={timelapse}
        />
      )}
      <SkyGenerators>
        <Sky
          {...skyPropsFromArgs(args)}
          abyss={skyAbyssFromArgs(args)}
          ocean={{ ...skyOceanFromArgs(args), level: LEVEL, depth: DEPTH }}
          debug={{ tint: args.tint, environment: args.showEnvironment }}
        >
          <SkyBoxStage
            bounds={bounds}
            relief={relief}
            debug={{
              relief: args.tileDebug === 'none' ? undefined : args.tileDebug,
            }}
          />
          {args.field === 'anchored' && (
            <SkyAnchor>
              <FieldStandIn />
            </SkyAnchor>
          )}
          {args.field === 'free' && <FieldStandIn />}
          {args.facility === 'anchored' && (
            <SkyAnchor at={POSITIONS.trench}>
              <FieldStandIn at={POSITIONS.trench} />
            </SkyAnchor>
          )}
          {args.facility === 'free' && <FieldStandIn at={POSITIONS.trench} />}
        </Sky>
      </SkyGenerators>
      {/* Outside the Sky: the World hands it the Sky's globe. */}
      {args.facility === 'field' && <TrenchField />}
    </World>
  );
};

const meta = {
  title: 'Spikes/Sky/ReliefTiles',
  component: ReliefTiles,
  decorators: [
    Canvas3dDecorator,
    // The reliefs' tiles, built from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...skyDecorators,
  ],
  parameters: {
    scale: 1000,
    // Past the horizon from 100 km up (1130 km).
    far: 3000000,
    autoClear: true,
    cameraPosition: [9000, 2500, 9000],
    cameraTarget: [0, LEVEL - DEPTH, 0],
    ownLighting: () => true,
  },
  argTypes: {
    ...skyArgTypes({ debug: true }),
    relief: {
      control: { type: 'inline-radio' },
      options: ['tiles', 'none'],
      description:
        'The relief drawn from TILES merged from the layers below, or NONE: the stage\u2019s flat seabed. Made on demand: `npm run generate-relief`.',
      table: { category: 'Relief' },
    },
    layers: {
      control: { type: 'check' },
      options: LAYERS.map(layer => layer.id),
      description:
        'The reliefs merged, coarse to fine whatever the order ticked: ETOPO 2022 at 2′ (Norway to the British Isles), ETOPO 2022 at 15″ and EMODnet at 1/8′ (Volve east to the coast; EMODnet has no land), EMODnet at 1/16′ around Volve, and the generated sea bed baked from its surface (a made-up coast and island over the field, off by default). A later one wins where it has data, faded in over 3, 1.5, 0.5 and 0.5 km from where its data ends.',
      table: { category: 'Relief' },
      if: { arg: 'relief', eq: 'tiles' },
    },
    pixelError: {
      control: { type: 'range', min: 0.5, max: 16, step: 0.5 },
      description:
        'The most a tile\u2019s error may show on screen, in pixels: larger draws coarser tiles.',
      table: { category: 'Relief' },
      if: { arg: 'relief', eq: 'tiles' },
    },
    cellPixels: {
      control: { type: 'range', min: 1, max: 64, step: 1 },
      description:
        'The most a tile\u2019s cell may span on screen, in pixels, where finer data lies under it: what keeps the shading and the coast sharp from high up, where the error alone splits nothing. Larger draws fewer, blurrier tiles.',
      table: { category: 'Relief' },
      if: { arg: 'relief', eq: 'tiles' },
    },
    reliefColor: {
      control: { type: 'inline-radio' },
      options: ['ramp', 'flat'],
      description:
        'The land by height and the seabed darkening with depth, or the land in one colour.',
      table: { category: 'Relief' },
    },
    baseDepth: {
      control: { type: 'range', min: 0, max: 500, step: 10 },
      description:
        'The flat seabed where no layer has data, metres below the sea. Changing it builds every tile again.',
      table: { category: 'Relief' },
      if: { arg: 'relief', eq: 'tiles' },
    },
    stageWidth: {
      control: { type: 'range', min: 2, max: 80, step: 1 },
      description:
        'The stage\u2019s width, in km. The relief covers it too when drawn from tiles.',
      table: { category: 'Stage' },
    },
    tileStats: {
      description:
        'What the tiles draw and hold, bottom right: tiles and triangles drawn, the deepest tile, and tiles in, loading and waiting.',
      table: { category: 'Debug' },
      if: { arg: 'relief', eq: 'tiles' },
    },
    tileDebug: {
      control: { type: 'inline-radio' },
      options: ['none', 'tiles', 'layers'],
      description:
        'TILES tints each tile by its depth and outlines it; LAYERS colours the ground by the layer that gave it (grey for the flat base).',
      table: { category: 'Debug' },
      if: { arg: 'relief', eq: 'tiles' },
    },
    field: {
      control: { type: 'inline-radio' },
      options: ['anchored', 'free', 'none'],
      description:
        'A stand-in for the field\u2019s content at Volve (a 4 km plate and a 1.5 km mast), flat at sea level: ANCHORED in a `SkyAnchor` or FREE, left where it is. The globe is flat over the stage, so the two are the same: it stays on the sea from anywhere.',
      table: { category: 'Debug' },
    },
    facility: {
      control: { type: 'inline-radio' },
      options: ['field', 'anchored', 'free', 'none'],
      description:
        'Something 123 km east, over the trench, beyond the globe\u2019s flat disc. FIELD: a second field in the next UTM zone (32N), drawn in its own map and placed by its `UtmArea` in the story\u2019s `World` \u2014 the stand-in, and magenta posts 5 km out on its own grid, through which thin cyan posts run, the same points converted to the World\u2019s map and anchored one by one. ANCHORED: the stand-in in the World\u2019s map, in a `SkyAnchor` at its point: on the sea, upright on the globe. FREE: flat as `UtmPosition` places it, 1.2 km over the sea, leaning 1.1\u00b0 from the globe\u2019s up there.',
      table: { category: 'Debug' },
    },
    panel: {
      description:
        'Buttons over the view: the camera\u2019s height, moves to set altitudes, places from Volve to the fjords, and views.',
      table: { category: 'Debug' },
    },
  },
  args: {
    ...skyArgs,
    relief: 'tiles',
    layers: LAYERS.map(layer => layer.id).filter(id => id !== BAKED_SEABED),
    pixelError: 2,
    cellPixels: 8,
    reliefColor: 'ramp',
    baseDepth: DEPTH,
    stageWidth: 16,
    tileStats: true,
    tileDebug: 'none',
    panel: true,
    field: 'anchored',
    facility: 'none',
  },
} satisfies Meta<typeof ReliefTiles>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * A far plane of 200 km, short of the horizon from a few hundred metres up: the tiles end
 * there, and past it the first layer's overview is drawn flat on the sea, at the far
 * plane, out to the horizon.
 */
export const ShortFarPlane: Story = {
  parameters: { far: 200000 },
};
