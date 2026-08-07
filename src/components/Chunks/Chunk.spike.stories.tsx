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
  SurfaceChunkBasement,
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
import { ChunkStack } from './ChunkStack';
import { OceanChunk } from './OceanChunk';

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
  useFrame(() => { }, 2);
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
  showBasement: boolean;
  basementTopSource: 'chunk' | 'procedural';
  basementThickness: number;
  basementTopDepth: number;
  basementVariation: number;
  basementColor: string;
  showOcean: boolean;
  oceanMode: 'surface' | 'procedural';
  oceanSurfaceCount: number;
  waterDepth: number;
  windSpeed: number;
  waterOpacity: number;
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

  // Sequential allocation: the ocean chunk (surface mode) consumes the first
  // `oceanSurfaceCount` surfaces (shallowest = seabed); the geological chunk uses
  // the rest — so no surface is used as both the seabed and the next chunk's top.
  const oceanCount =
    props.showOcean && props.oceanMode === 'surface'
      ? props.oceanSurfaceCount
      : 0;
  const oceanGroups = useMemo(
    () => (oceanCount > 0 ? [metas.slice(0, oceanCount)] : undefined),
    [metas, oceanCount],
  );
  const groups = useMemo(
    () => splitIntoGroups(metas.slice(oceanCount), props.groupSizes),
    [metas, oceanCount, props.groupSizes],
  );

  const basement = useMemo<SurfaceChunkBasement | undefined>(() => {
    if (!props.showBasement) return undefined;
    return {
      color: props.basementColor,
      thickness: props.basementThickness,
      top:
        props.basementTopSource === 'procedural'
          ? {
            procedural: {
              depth: props.basementTopDepth,
              variation: props.basementVariation,
            },
          }
          : undefined,
    };
  }, [
    props.showBasement,
    props.basementColor,
    props.basementThickness,
    props.basementTopSource,
    props.basementTopDepth,
    props.basementVariation,
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
          rimSpacing={props.rimSpacing}
          maxError={props.maxError}
        >
          {props.showOcean &&
            (props.oceanMode === 'procedural' ? (
              <OceanChunk
                procedural={{ waterDepth: props.waterDepth }}
                windSpeed={props.windSpeed}
                waterOpacity={props.waterOpacity}
              />
            ) : (
              oceanGroups && (
                <OceanChunk
                  groups={oceanGroups}
                  windSpeed={props.windSpeed}
                  waterOpacity={props.waterOpacity}
                />
              )
            ))}
          <Chunk
            groups={groups}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
            resolve={resolve}
            basement={basement}
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
    // Basement
    showBasement: false,
    basementTopSource: 'chunk',
    basementThickness: 800,
    basementTopDepth: 4000,
    basementVariation: 400,
    basementColor: '#4a4a4a',
    // Ocean
    showOcean: false,
    oceanMode: 'surface',
    oceanSurfaceCount: 1,
    waterDepth: 800,
    windSpeed: 10,
    waterOpacity: 0.5,
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
    showBasement: { control: 'boolean', table: { category: 'Basement' } },
    basementTopSource: {
      control: { type: 'inline-radio' },
      options: ['chunk', 'procedural'],
      table: { category: 'Basement' },
    },
    basementThickness: {
      control: { type: 'range', min: 0, max: 3000, step: 50 },
      table: { category: 'Basement' },
    },
    basementTopDepth: {
      control: { type: 'range', min: 0, max: 6000, step: 50 },
      table: { category: 'Basement' },
    },
    basementVariation: {
      control: { type: 'range', min: 0, max: 1500, step: 25 },
      table: { category: 'Basement' },
    },
    basementColor: { control: 'color', table: { category: 'Basement' } },
    showOcean: { control: 'boolean', table: { category: 'Ocean' } },
    oceanMode: {
      control: { type: 'inline-radio' },
      options: ['surface', 'procedural'],
      table: { category: 'Ocean' },
    },
    oceanSurfaceCount: {
      control: { type: 'range', min: 1, max: 6, step: 1 },
      description: 'Surfaces the ocean chunk consumes (surface mode).',
      table: { category: 'Ocean' },
    },
    waterDepth: {
      control: { type: 'range', min: 50, max: 4000, step: 50 },
      description: 'Mean sea-bed depth (procedural mode).',
      table: { category: 'Ocean' },
    },
    windSpeed: {
      control: { type: 'range', min: 0, max: 25, step: 1 },
      table: { category: 'Ocean' },
    },
    waterOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Ocean' },
    },
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
