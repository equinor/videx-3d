import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { OITRenderPass, Pass, RenderPass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import { SurfaceMeta, Vec2 } from '../../sdk';
import { sortByStratAge } from '../../storybook/data/strat-ages';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { useFieldOutline } from '../../storybook/hooks/useFieldOutline';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkLayer, layersFromGroups } from './chunk-defs';
import { CHUNK_DETAIL_PRESET_NAMES, ChunkDetailPreset } from './chunk-detail';
import { ChunkStack } from './ChunkStack';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

// Split a sorted meta list into contiguous groups from a comma-separated string.
function splitIntoGroups(metas: SurfaceMeta[], sizes: string): SurfaceMeta[][] {
  const counts = sizes
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0);
  if (counts.length === 0) return metas.length > 0 ? [metas] : [];
  const groups: SurfaceMeta[][] = [];
  let i = 0;
  for (const c of counts) {
    if (i >= metas.length) break;
    groups.push(metas.slice(i, i + c));
    i += c;
  }
  return groups;
}

// Always-on OIT pipeline (SMAA), matching the SurfaceChunk spike / OIT debug story.
const ChunkPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  // Touch RenderPass so the import is used even though OIT is the active base pass.
  void RenderPass;
  useFrame(() => {}, 2);
  return <RenderingPipeline passes={passes} />;
};

type ChunkStoryProps = {
  groupSizes: string;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  detail: ChunkDetailPreset | 'none';
  detailStrength: number;
  resolve: boolean;
  resolveMode: 'clamp' | 'truncate';
  minGap: number;
  collapseThreshold: number;
  rimSpacing: number;
  maxError: number;
  showFloor: boolean;
  floorClearance: number;
  floorColor: string;
};

const ChunkStory = (props: ChunkStoryProps) => {
  const surfaceMetaDict = useSurfaceMetaDict();

  const polygon = useFieldOutline();

  const metas = useMemo<SurfaceMeta[]>(
    () =>
      sortByStratAge(
        Object.keys(surfaceOptions)
          .map(id => surfaceMetaDict[id])
          .filter((m): m is SurfaceMeta => !!m),
      ),
    [surfaceMetaDict],
  );

  const groups = useMemo(
    () => splitIntoGroups(metas, props.groupSizes),
    [metas, props.groupSizes],
  );

  // The block's floor is the COLUMN's carrier: one flat plane declared on the
  // stack, drawn by the chunk that closes the block.
  const layers = useMemo<ChunkLayer[]>(() => {
    const detail =
      props.detail === 'none'
        ? undefined
        : { preset: props.detail, strength: props.detailStrength };
    const own = layersFromGroups(groups).map(layer => ({ ...layer, detail }));
    if (!props.showFloor || own.length === 0) return own;
    // A fill on the LAST layer is what asks for the floor — the block is then open
    // at the bottom, and only the column can say where it ends.
    return [
      ...own.slice(0, -1),
      { ...own[own.length - 1], fill: props.floorColor },
    ];
  }, [
    groups,
    props.showFloor,
    props.floorColor,
    props.detail,
    props.detailStrength,
  ]);

  // Memoized so a stable identity is passed to Chunk (a new object rebuilds).
  const resolve = useMemo(
    () =>
      props.resolve
        ? {
            mode: props.resolveMode,
            minGap: props.minGap || undefined,
            collapseThreshold: props.collapseThreshold,
          }
        : undefined,
    [props.resolve, props.resolveMode, props.minGap, props.collapseThreshold],
  );

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <ChunkStack
          outline={polygon}
          surfaces={metas}
          carrier={
            props.showFloor
              ? { below: props.floorClearance, material: props.floorColor }
              : undefined
          }
          rimSpacing={props.rimSpacing}
          maxError={props.maxError}
        >
          <Chunk
            layers={layers}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
            resolve={resolve}
          />
        </ChunkStack>
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'Spikes/Chunks/Chunk',
  component: ChunkStory,
} satisfies Meta<typeof ChunkStory>;

export default meta;
type Story = StoryObj<typeof ChunkStory>;

export const Default: Story = {
  args: {
    // Chunk
    groupSizes: '2,2',
    rimSpacing: 250,
    maxError: 5,
    resolve: true,
    resolveMode: 'truncate',
    minGap: 0,
    collapseThreshold: 0.5,
    // Appearance
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    detail: 'none',
    detailStrength: 1,
    // Floor
    showFloor: true,
    floorClearance: 800,
    floorColor: '#4a4a4a',
  },
  argTypes: {
    groupSizes: {
      control: { type: 'select' },
      options: ['', '2,2', '3,3', '2,2,2', '3,3,3', '4,4', '5,5'],
      description:
        'Surfaces per chunk, comma separated (empty = one chunk of everything). A PRESET list rather than free text: this decides layer identity, so every keystroke would rebuild.',
      table: { category: 'Chunk' },
    },
    rimSpacing: {
      control: { type: 'select' },
      options: [50, 100, 250, 500, 1000],
      table: { category: 'Chunk' },
    },
    maxError: {
      control: { type: 'select' },
      options: [1, 2, 5, 10, 25, 50],
      table: { category: 'Chunk' },
    },
    resolve: {
      control: 'boolean',
      description:
        'Make the stack monotone on the shared tessellation, so surfaces cannot interpenetrate. Off = the surfaces are drawn exactly as the data has them, crossings included.',
      table: { category: 'Chunk' },
    },
    resolveMode: {
      control: { type: 'inline-radio' },
      options: ['clamp', 'truncate'],
      description:
        'Both clamp the height (so the block stays sealed), but truncate also marks the unit absent where it was cut away, so the welded duplicate is dropped instead of drawn.',
      table: { category: 'Chunk' },
    },
    minGap: {
      control: { type: 'select' },
      options: [0, 1, 2, 5, 10, 25],
      description:
        'Minimum separation kept between surfaces. 0 is safe on a shared tessellation; >0 gives every pinch-out an artificial thickness.',
      table: { category: 'Chunk' },
    },
    collapseThreshold: {
      control: { type: 'select' },
      options: [0, 0.25, 0.5, 1, 2, 5],
      description:
        'Thickness below which a unit counts as absent and its triangles are dropped.',
      table: { category: 'Chunk' },
    },
    surfaceOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wallOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wireframe: { control: 'boolean', table: { category: 'Appearance' } },
    detail: {
      control: 'select',
      options: ['none', ...CHUNK_DETAIL_PRESET_NAMES],
      description:
        'Procedural surface relief, applied to every layer’s cap and wall. Anchored in WORLD space, so it needs no per-surface repeat/scale and is continuous across a cap and the wall below it. Only resolves as the camera comes in — the footprint fade takes it out long before it could alias.',
      table: { category: 'Appearance' },
    },
    detailStrength: {
      control: { type: 'range', min: 0, max: 3, step: 0.1 },
      description: 'Scales the detail preset. 1 = as designed.',
      table: { category: 'Appearance' },
    },
    showFloor: {
      control: 'boolean',
      description:
        'Close the block with the column CARRIER: one flat plane declared on the `ChunkStack`, drawn by the chunk because its last layer declares a `fill` — which is what says the block is open at the bottom.',
      table: { category: 'Floor' },
    },
    floorClearance: {
      control: { type: 'select' },
      options: [0, 100, 200, 400, 800, 1500, 3000],
      description:
        'How far the carrier clears the column’s deepest mapped sample, in metres.',
      table: { category: 'Floor' },
    },
    floorColor: { control: 'color', table: { category: 'Floor' } },
  },
  decorators: [
    EventEmitterDecorator,
    GlyphsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    // autoClear stays at the Canvas3dDecorator default (false): the RenderingPipeline
    // owns clearing. autoClear=true would wipe the OIT pass's intermediate targets.
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
};
