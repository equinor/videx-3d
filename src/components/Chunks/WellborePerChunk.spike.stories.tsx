import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
} from 'three';
import { useData } from '../../hooks/useData';
import { OITRenderPass, Pass, RenderPass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  CRS,
  darkenColor,
  getProjectionDefFromUtmZone,
  PositionLog,
  SurfaceMeta,
  Vec2,
  Vec3,
  WellboreHeader,
} from '../../sdk';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import {
  distinctByName,
  useSurfaceMetaDict,
} from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkStack } from './ChunkStack';
import { CutoutSource } from './cutout';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');
const utmToArea = (easting: number, northing: number, altitude = 0): Vec3 => {
  const c = crs.utmToWorld(easting, northing, altitude);
  return [c.x, c.y, c.z];
};

// A distinct base colour per stacked chunk.
const CHUNK_COLORS = [
  '#4e79a7',
  '#59a14f',
  '#edc949',
  '#f28e2c',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
];

// How much darker every second surface within a chunk is drawn. Real usage assigns
// an explicit colour per surface (from the host's strat column); the colours here
// are made up, so alternating shades are what makes the individual slabs readable.
const BAND_DARKEN = 0.3;

// Split a sorted meta list into contiguous chunks from a comma-separated string.
function splitIntoChunks(metas: SurfaceMeta[], sizes: string): SurfaceMeta[][] {
  const counts = sizes
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0);
  const chunks: SurfaceMeta[][] = [];
  let i = 0;
  for (const c of counts) {
    if (i >= metas.length) break;
    chunks.push(metas.slice(i, i + c));
    i += c;
  }
  return chunks;
}

// Always-on OIT pipeline (SMAA), matching the sibling chunk stories.
const ChunkPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  void RenderPass;
  useFrame(() => { }, 2);
  return <RenderingPipeline passes={passes} />;
};

type PerChunkStoryProps = {
  chunkSizes: string;
  wellCount: number;
  radius: number;
  cellSize: number;
  clusterDistance: number;
  feather: number;
  wellSmoothing: number;
  sampleSpacing: number;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  showWells: boolean;
  wellColor: string;
};

const PerChunkStory = (props: PerChunkStoryProps) => {
  const data = useData();
  const surfaceMetaDict = useSurfaceMetaDict();
  const wellbores = useWellboreHeaders();

  const metas = useMemo<SurfaceMeta[]>(
    () =>
      distinctByName(
        Object.keys(surfaceOptions)
          .map(id => surfaceMetaDict[id])
          .filter((m): m is SurfaceMeta => !!m)
          .sort((a, b) => a.max - b.max),
      ),
    [surfaceMetaDict],
  );

  // Each chunk = one contiguous group of surfaces at increasing depth.
  const chunks = useMemo(
    () => splitIntoChunks(metas, props.chunkSizes),
    [metas, props.chunkSizes],
  );

  const wellboreIds = useMemo(
    () => wellbores.slice(0, props.wellCount).map(w => w.id),
    [wellbores, props.wellCount],
  );

  // A single shared wellbore cut source on the stack. Each Chunk INHERITS it and
  // resolves the outline from its OWN top/base surfaces, so the footprint follows
  // the wells through that chunk's depth window — shallow chunks stay tight near
  // the platform, deeper chunks widen / split as the wells fan out (telescoping).
  const cutSource = useMemo<CutoutSource>(
    () => ({
      kind: 'wellbores',
      wellbores: wellboreIds,
      options: {
        radius: props.radius,
        cellSize: props.cellSize,
        clusterDistance: props.clusterDistance,
        feather: props.feather,
        smoothing: props.wellSmoothing,
        sampleSpacing: props.sampleSpacing,
      },
    }),
    [
      wellboreIds,
      props.radius,
      props.cellSize,
      props.clusterDistance,
      props.feather,
      props.wellSmoothing,
      props.sampleSpacing,
    ],
  );

  // Selected wellbore trajectories (same scene mapping the outlines derive from).
  const [wellLines, setWellLines] = useState<Line[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!data) return;
    const build = async (): Promise<Line[]> => {
      if (!props.showWells || wellboreIds.length === 0) return [];
      const material = new LineBasicMaterial({
        color: new Color(props.wellColor),
      });
      const results = await Promise.all(
        wellboreIds.map(async id => {
          const [header, poslog] = await Promise.all([
            data.get<WellboreHeader>('wellbore-headers', id),
            data.get<PositionLog>('position-logs', id),
          ]);
          if (!header || !poslog || poslog.length < 2 * 4) return null;
          const positions: number[] = [];
          for (let j = 0; j + 3 < poslog.length; j += 4) {
            const p = utmToArea(
              header.easting + poslog[j],
              header.northing + poslog[j + 2],
              -poslog[j + 1],
            );
            positions.push(p[0], p[1], p[2]);
          }
          const geometry = new BufferGeometry();
          geometry.setAttribute(
            'position',
            new Float32BufferAttribute(positions, 3),
          );
          return new Line(geometry, material) as Line;
        }),
      );
      return results.filter((l): l is Line => l !== null);
    };
    build().then(lines => {
      if (cancelled) {
        lines.forEach(l => {
          l.geometry.dispose();
          (l.material as LineBasicMaterial).dispose();
        });
        return;
      }
      setWellLines(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [data, props.showWells, props.wellColor, wellboreIds]);

  useEffect(() => {
    return () => {
      wellLines.forEach(l => {
        l.geometry.dispose();
        (l.material as LineBasicMaterial).dispose();
      });
    };
  }, [wellLines]);

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <ChunkStack cutSource={cutSource}>
          {chunks.map((surfaces, i) => {
            const base = CHUNK_COLORS[i % CHUNK_COLORS.length];
            return (
              <Chunk
                key={i}
                groups={[surfaces]}
                // Colours are assigned by flat layer index (modulo the array), so
                // two entries band every second surface within the chunk.
                colors={[base, darkenColor(base, BAND_DARKEN)]}
                surfaceOpacity={props.surfaceOpacity}
                wallOpacity={props.wallOpacity}
                wireframe={props.wireframe}
              />
            );
          })}
        </ChunkStack>
        {wellLines.map((l, i) => (
          <primitive key={i} object={l} />
        ))}
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'Spikes/Chunks/WellborePerChunk',
  component: PerChunkStory,
} satisfies Meta<typeof PerChunkStory>;

export default meta;
type Story = StoryObj<typeof PerChunkStory>;

export const Default: Story = {
  args: {
    // Chunks
    chunkSizes: '4,4,4,4,3',
    // Wellbore outline (shared source; resolved per chunk)
    wellCount: 50,
    radius: 800,
    cellSize: 200,
    clusterDistance: 2000,
    feather: 0,
    wellSmoothing: 1,
    sampleSpacing: 50,
    // Appearance
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    // Wells
    showWells: true,
    wellColor: '#00e5ff',
  },
  argTypes: {
    chunkSizes: {
      control: { type: 'text' },
      description:
        'Surfaces per stacked chunk (shallow→deep), comma-separated.',
      table: { category: 'Chunks' },
    },
    wellCount: {
      control: { type: 'range', min: 1, max: 50, step: 1 },
      table: { category: 'Wellbore outline' },
    },
    radius: {
      control: { type: 'range', min: 100, max: 3000, step: 50 },
      table: { category: 'Wellbore outline' },
    },
    cellSize: {
      control: { type: 'range', min: 25, max: 500, step: 25 },
      description: 'Distance-field raster cell size (smaller = finer edge).',
      table: { category: 'Wellbore outline' },
    },
    clusterDistance: {
      control: { type: 'range', min: 200, max: 8000, step: 100 },
      description: 'Points closer than this join one outline component.',
      table: { category: 'Wellbore outline' },
    },
    feather: {
      control: { type: 'range', min: 0, max: 8, step: 1 },
      description: 'Box-blur passes on the distance field (rounds corners).',
      table: { category: 'Wellbore outline' },
    },
    wellSmoothing: {
      control: { type: 'range', min: 0, max: 6, step: 0.5 },
      description: 'Output ring smoothing strength.',
      table: { category: 'Wellbore outline' },
    },
    sampleSpacing: {
      control: { type: 'range', min: 10, max: 250, step: 10 },
      description: 'Trajectory densification spacing (scene units).',
      table: { category: 'Wellbore outline' },
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
    showWells: {
      control: 'boolean',
      description: 'Draw the selected wellbore trajectories.',
      table: { category: 'Wells' },
    },
    wellColor: { control: 'color', table: { category: 'Wells' } },
  },
  decorators: [
    EventEmitterDecorator,
    GlyphsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    // autoClear stays false (RenderingPipeline owns clearing; true wipes OIT targets).
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
};
