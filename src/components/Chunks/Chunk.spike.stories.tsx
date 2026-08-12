import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { OITRenderPass, Pass, RenderPass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonGeometry,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import { parseGeoJsonFeature } from '../../sdk/utils/geojson';
import { sortByStratAge } from '../../storybook/data/strat-ages';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { get } from '../../storybook/dependencies/api';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkLayer, layersFromGroups } from './chunk-defs';
import { ChunkStack } from './ChunkStack';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');
const toSceneXZ = (pos: Vec2): Vec2 => {
  const c = crs.wgs84ToWorld(pos[0], pos[1]);
  return [c.x, c.z];
};

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

  const [polygon, setPolygon] = useState<PlanarPolygonGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    get('/data/volve-polygon.json').then(json => {
      if (cancelled || !json) return;
      const feature = parseGeoJsonFeature(json, toSceneXZ);
      setPolygon(feature.geometry as PlanarPolygonGeometry);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    const own = layersFromGroups(groups);
    if (!props.showFloor || own.length === 0) return own;
    return [
      ...own.slice(0, -1),
      { ...own[own.length - 1], fill: props.floorColor },
      { carrier: true, material: props.floorColor },
    ];
  }, [groups, props.showFloor, props.floorColor]);

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
            props.showFloor ? { below: props.floorClearance } : undefined
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
    // Floor
    showFloor: true,
    floorClearance: 800,
    floorColor: '#4a4a4a',
  },
  argTypes: {
    groupSizes: { control: { type: 'text' }, table: { category: 'Chunk' } },
    rimSpacing: {
      control: { type: 'range', min: 25, max: 1000, step: 25 },
      table: { category: 'Chunk' },
    },
    maxError: {
      control: { type: 'range', min: 0, max: 50, step: 1 },
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
      control: { type: 'range', min: 0, max: 50, step: 1 },
      description:
        'Minimum separation kept between surfaces. 0 is safe on a shared tessellation; >0 gives every pinch-out an artificial thickness.',
      table: { category: 'Chunk' },
    },
    collapseThreshold: {
      control: { type: 'range', min: 0, max: 10, step: 0.1 },
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
    showFloor: {
      control: 'boolean',
      description:
        'Close the block with the column CARRIER: one flat plane declared on the `ChunkStack` and drawn by the chunk as a `{ carrier: true }` layer.',
      table: { category: 'Floor' },
    },
    floorClearance: {
      control: { type: 'range', min: 0, max: 3000, step: 50 },
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
