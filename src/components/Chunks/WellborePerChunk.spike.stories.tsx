import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  SurfaceChunkMetrics,
  SurfaceMeta,
  Vec2,
  Vec3,
  WellboreHeader,
} from '../../sdk';
import { sortByStratAge } from '../../storybook/data/strat-ages';
import { chunkTimings } from '../../storybook/data/chunk-timings';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { createOutputPanelDecorator } from '../../storybook/decorators/output-panel-decorator';
import { useChunkProgressPanel } from '../../storybook/hooks/useChunkProgressPanel';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkResolveOptions, DEFAULT_CHUNK_MAX_FILL } from './chunk-defs';
import { ChunkStack } from './ChunkStack';
import { CutoutSource, WellboreOutlineMode } from './cutout';
import { ChunkInferenceStyle } from './inference-material';

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
  useFrame(() => {}, 2);
  return <RenderingPipeline passes={passes} />;
};

type PerChunkStoryProps = {
  surfaceFrom: number;
  chunkSizes: string;
  connectChunks: boolean;
  maxError: number;
  wellCount: number;
  mode: WellboreOutlineMode;
  unmapped: 'exclude' | 'ignore';
  radius: number;
  radiusBase: number;
  cellSize: number;
  feather: number;
  wellSmoothing: number;
  sampleSpacing: number;
  resolve: boolean;
  resolveMode: 'clamp' | 'truncate';
  minGap: number;
  collapseThreshold: number;
  refineTerminations: boolean;
  coverageAbsence: boolean;
  maxFill: number;
  seal: boolean;
  sealMode: 'proportional' | 'void';
  minThickness: number;
  seabed: 'none' | 'procedural';
  seabedDepth: number;
  seabedRelief: number;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  inferredStyle: ChunkInferenceStyle;
  showWells: boolean;
  wellColor: string;
};

const PerChunkStory = (props: PerChunkStoryProps) => {
  const data = useData();
  const surfaceMetaDict = useSurfaceMetaDict();
  const wellbores = useWellboreHeaders();

  const metas = useMemo<SurfaceMeta[]>(
    () =>
      sortByStratAge(
        Object.keys(surfaceOptions)
          .map(id => surfaceMetaDict[id])
          .filter((m): m is SurfaceMeta => !!m),
      ),
    [surfaceMetaDict],
  );

  // The column every chunk is cut from. Declaring it on the stack makes the
  // fetch, the common grid and the depth-order resolve happen ONCE for all five
  // chunks — and makes them agree with each other about depth order.
  const column = useMemo(
    () =>
      metas.slice(Math.min(props.surfaceFrom, Math.max(0, metas.length - 1))),
    [metas, props.surfaceFrom],
  );

  // Each chunk = one contiguous group of surfaces at increasing depth, starting
  // at `surfaceFrom` so the stack can begin below the top of the column.
  const chunks = useMemo(
    () => splitIntoChunks(column, props.chunkSizes),
    [column, props.chunkSizes],
  );

  // Memoized so a stable identity reaches Chunk (a new object rebuilds geometry).
  const resolve = useMemo<ChunkResolveOptions | undefined>(
    () =>
      props.resolve
        ? {
            mode: props.resolveMode,
            minGap: props.minGap || undefined,
            collapseThreshold: props.collapseThreshold,
            refineTerminations: props.refineTerminations,
            coverageAbsence: props.coverageAbsence,
            maxFill: props.maxFill,
            seal: props.seal,
            sealMode: props.sealMode,
            minThickness: props.minThickness,
          }
        : undefined,
    [
      props.resolve,
      props.resolveMode,
      props.minGap,
      props.collapseThreshold,
      props.refineTerminations,
      props.coverageAbsence,
      props.maxFill,
      props.seal,
      props.sealMode,
      props.minThickness,
    ],
  );

  const wellboreIds = useMemo(
    () => wellbores.slice(0, props.wellCount).map(w => w.id),
    [wellbores, props.wellCount],
  );

  // A single shared wellbore cut source on the stack. Each Chunk INHERITS it and
  // resolves the outline from its OWN bounding surfaces, so the footprint follows
  // the wells through the depth range `mode` asks for — `window` gives each chunk
  // an independent footprint, `above` telescopes out with depth, `below` in.
  const cutSource = useMemo<CutoutSource>(
    () => ({
      kind: 'wellbores',
      wellbores: wellboreIds,
      options: {
        mode: props.mode,
        unmapped: props.unmapped,
        radius: props.radius,
        cellSize: props.cellSize,
        feather: props.feather,
        smoothing: props.wellSmoothing,
        sampleSpacing: props.sampleSpacing,
      },
    }),
    [
      wellboreIds,
      props.mode,
      props.unmapped,
      props.radius,
      props.cellSize,
      props.feather,
      props.wellSmoothing,
      props.sampleSpacing,
    ],
  );

  // Per-chunk MARGIN, interpolated shallow→deep. Each chunk overrides only
  // `radius`, inheriting the rest of the stack's source — and under `above` every
  // chunk buffers each depth interval with the margin of the chunk that owns it,
  // so this is a genuine ramp rather than the deepest chunk's radius winning.
  const marginAt = useCallback(
    (index: number, count: number) =>
      count < 2
        ? props.radius
        : props.radius +
          ((props.radiusBase - props.radius) * index) / (count - 1),
    [props.radius, props.radiusBase],
  );

  // Per-chunk build report. The library never logs by itself — `onBuild` hands the
  // metrics over and the story decides what to do with them.
  const nameOf = useCallback(
    (id: string) => surfaceMetaDict[id]?.name ?? id,
    [surfaceMetaDict],
  );
  const report = (index: number, metrics: SurfaceChunkMetrics) => {
    const d = metrics.diagnostics;
    console.log(
      `CHUNKREPORT ${JSON.stringify({
        chunk: index,
        layers: metrics.layers,
        triangles: metrics.triangles,
        wallTriangles: metrics.wallTriangles,
        droppedAbsent: d?.trianglesAbsent ?? null,
        droppedThin: d?.trianglesCollapsed ?? null,
        rimDropped: d?.rimDropped ?? null,
        constraintFailures: d?.constraintFailures ?? null,
        wallRingsDropped: d?.wallRingsDropped ?? null,
        wallRingsOpen: d?.wallRingsOpen ?? null,
        caps: (d?.layers ?? []).map(l => (l.capped ? 1 : 0)).join(''),
        excluded: (d?.layers ?? []).reduce((a, l) => a + l.droppedExcluded, 0),
        ...chunkTimings(metrics),
      })}`,
    );
    console.table([
      {
        chunk: index,
        layers: metrics.layers,
        triangles: metrics.triangles.toLocaleString(),
        wallTriangles: metrics.wallTriangles.toLocaleString(),
        droppedAbsent: d?.trianglesAbsent ?? '-',
        droppedThin: d?.trianglesCollapsed ?? '-',
        topKept: d?.topKept ?? '-',
        rimDropped: d?.rimDropped ?? '-',
        crossings: d?.crossings ?? '-',
        'crossings(data)': d?.crossingsCovered ?? '-',
        maxOverlap: d ? `${d.maxOverlap.toFixed(1)} m` : '-',
        sharedStack: d?.sharedStack ?? false,
        stackLayers: d?.stackLayers ?? 0,
        refNodes: d ? d.referenceNodes.toLocaleString() : '-',
        refStep: d?.referenceStep ?? '-',
        fetchMs: d ? Math.round(d.fetchMs) : '-',
        resampleMs: d ? Math.round(d.referenceMs) : '-',
        resolveMs: d ? Math.round(d.stackResolveMs) : '-',
        tessellateMs: d ? Math.round(d.tessellateMs) : '-',
        totalMs: Math.round(metrics.totalMs),
      },
    ]);
    // Which LAYER lost its geometry, and to what. The chunk totals are sums, so
    // they cannot answer that — and it is the only question worth asking when a
    // chunk comes out with holes in it.
    if (d?.layers?.length) {
      console.table(
        d.layers.map(l => ({
          chunk: index,
          layer: l.index,
          name: l.id ? nameOf(l.id) : '(synthetic)',
          'coverage%': (100 * l.coverage).toFixed(1),
          'ofWhichFill%': (100 * l.filled).toFixed(1),
          'inferred%': (100 * l.inferred).toFixed(1),
          'duplicate%': (100 * l.duplicate).toFixed(1),
          triangles: l.triangles.toLocaleString(),
          capped: l.capped,
          droppedAbsent: l.droppedAbsent,
          droppedThin: l.droppedCollapsed,
          droppedToNeighbour: l.droppedExcluded,
        })),
      );
    }
  };

  // Memoized per chunk: `Chunk` keys its BUILD on the surfaces and which intervals
  // are filled, so materials can change without rebuilding geometry.
  const chunkProps = useMemo(
    () =>
      chunks.map((surfaces, i) => {
        const base = CHUNK_COLORS[i % CHUNK_COLORS.length];
        const shade = (j: number) =>
          j % 2 === 0 ? base : darkenColor(base, BAND_DARKEN);
        const own = surfaces.map((surface, j) => ({
          surface,
          material: shade(j),
          fill: j + 1 < surfaces.length,
        }));
        if (!props.connectChunks || i === 0) return own;
        // Connect to the chunk above by SHARING its last surface: this chunk uses
        // it as the top of its first interval. Which of the two draws the horizon
        // is settled by the stack from their footprints — declaring it twice is
        // the point, not a mistake.
        const above = chunks[i - 1];
        const shared = above[above.length - 1];
        return [
          { surface: shared, fill: shade(0) },
          ...own.map((l, j) => ({ ...l, material: shade(j + 1) })),
        ];
      }),
    [chunks, props.connectChunks],
  );

  // Stack-level progress — what a host would drive a busy indicator / bar from.
  const onProgress = useChunkProgressPanel();

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
        <ChunkStack
          cutSource={cutSource}
          surfaces={column}
          maxError={props.maxError}
          resolve={resolve}
          onProgress={onProgress}
        >
          {chunkProps.map((layers, i) => (
            <Chunk
              key={i}
              outline={{
                kind: 'wellbores',
                options: { radius: marginAt(i, chunkProps.length) },
              }}
              layers={
                i === 0
                  ? [
                      ...(props.seabed === 'procedural'
                        ? [
                            {
                              depth: props.seabedDepth,
                              relief: {
                                kind: 'dunes' as const,
                                amplitude: props.seabedRelief,
                              },
                              material: '#c2b280',
                              fill: '#8d7f5a',
                            },
                          ]
                        : []),
                      ...layers,
                    ]
                  : layers
              }
              surfaceOpacity={props.surfaceOpacity}
              wallOpacity={props.wallOpacity}
              wireframe={props.wireframe}
              inferredStyle={props.inferredStyle}
              onBuild={m => report(i, m)}
            />
          ))}
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
  parameters: {
    docs: {
      description: {
        component:
          'Per-chunk telescoping outlines: one shared wellbore cut source on the stack, each `Chunk` resolving it from its OWN depth window.\n\n' +
          '⚠️ The surface order handed to `Chunk.groups` IS the stratigraphic order — here it comes from a strat-column age extract (`storybook/data/strat-ages.ts`), not from depth. ' +
          'Sorting by `meta.max` inverts about half of every adjacent pair on this dataset.\n\n' +
          '⚠️ The no-interpenetration guarantee is PER CHUNK: each of these five stacks is built on its own shared tessellation, so nothing prevents the base of one from crossing the top of the next where their footprints overlap.',
      },
    },
  },
} satisfies Meta<typeof PerChunkStory>;

export default meta;
type Story = StoryObj<typeof PerChunkStory>;

export const Default: Story = {
  args: {
    // Chunks
    surfaceFrom: 0,
    chunkSizes: '4,4,4,4,3',
    connectChunks: false,
    maxError: 5,
    // Wellbore outline (shared source; resolved per chunk)
    wellCount: 50,
    mode: 'window',
    unmapped: 'exclude',
    radius: 800,
    radiusBase: 800,
    cellSize: 200,
    feather: 0,
    wellSmoothing: 1,
    sampleSpacing: 50,
    // Resolve
    resolve: true,
    resolveMode: 'truncate',
    minGap: 0,
    collapseThreshold: 0.5,
    refineTerminations: true,
    coverageAbsence: true,
    maxFill: DEFAULT_CHUNK_MAX_FILL,
    seal: true,
    sealMode: 'proportional',
    minThickness: 1,
    seabed: 'none',
    seabedDepth: 320,
    seabedRelief: 120,
    // Appearance
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    inferredStyle: 'hatched',
    // Wells
    showWells: true,
    wellColor: '#00e5ff',
  },
  argTypes: {
    surfaceFrom: {
      control: { type: 'select' },
      options: [0, 2, 4, 6, 8, 10, 12, 15, 18],
      description:
        'Index of the first surface (stratigraphic order), so the stack can start below the top of the column.',
      table: { category: 'Chunks' },
    },
    chunkSizes: {
      control: { type: 'select' },
      options: ['4,4,4,4,3', '4,4,4', '5,5,5', '6,6', '8,8', '3,3,3,3'],
      description:
        'Surfaces per stacked chunk (shallow→deep), comma-separated. A PRESET list rather than free text: this decides layer identity, so every keystroke would rebuild every chunk.',
      table: { category: 'Chunks' },
    },
    connectChunks: {
      control: 'boolean',
      description:
        'Make each chunk SHARE its upper neighbour’s last surface — it becomes the top of this chunk’s first interval, and the stack decides from the footprints which of the two draws that horizon. Off, the tiers leave the unit between them undrawn.',
      table: { category: 'Chunks' },
    },
    maxError: {
      control: { type: 'select' },
      options: [1, 2, 5, 10, 25, 50],
      description:
        'Interior simplification error (world units of height) for the shared tessellation. Lower = more triangles, finer detail.',
      table: { category: 'Chunks' },
    },
    wellCount: {
      control: { type: 'select' },
      options: [1, 2, 5, 10, 20, 50],
      table: { category: 'Wellbore outline' },
    },
    mode: {
      control: { type: 'inline-radio' },
      options: ['window', 'above', 'below'],
      description:
        'Which part of each well cuts a chunk. `window` = only inside the chunk (footprints unrelated). `above` = from the WELLHEAD down to the chunk’s base, so the outlines nest and the stack telescopes OUT with depth. `below` = down to TD, the mirror image.',
      table: { category: 'Wellbore outline' },
    },
    radius: {
      control: { type: 'select' },
      options: [250, 500, 800, 1000, 1500, 2000, 3000],
      description:
        'Margin for the SHALLOWEST chunk. Each chunk gets its own, interpolated toward `radiusBase`.',
      table: { category: 'Wellbore outline' },
    },
    radiusBase: {
      control: { type: 'select' },
      options: [250, 500, 800, 1000, 1500, 2000, 3000],
      description:
        'Margin for the DEEPEST chunk. ⭐ Under `above`, each depth interval keeps the margin of the chunk that owns it, so a narrow shallow neck stays narrow inside a wide deep block — and setting this BELOW `radius` cannot break the nesting.',
      table: { category: 'Wellbore outline' },
    },
    unmapped: {
      control: { type: 'inline-radio' },
      options: ['exclude', 'ignore'],
      description:
        'What to do where a chunk’s BOUNDING surface has no data. `exclude` drops the trajectory there, so a hole in a deep base surface removes that area from the outline even though everything above it is mapped. `ignore` keeps whatever the other bound allows. ⚠️ `ignore` cannot tell an interior hole from being off the grid entirely.',
      table: { category: 'Wellbore outline' },
    },
    cellSize: {
      control: { type: 'select' },
      options: [50, 100, 150, 200, 400],
      description:
        'Upper bound for the raster cell size; the effective cell is also clamped to radius/3 so a small radius still resolves.',
      table: { category: 'Wellbore outline' },
    },
    feather: {
      control: { type: 'select' },
      options: [0, 1, 2, 3, 5, 8],
      description: 'Box-blur passes on the distance field (rounds corners).',
      table: { category: 'Wellbore outline' },
    },
    wellSmoothing: {
      control: { type: 'select' },
      options: [0, 1, 2, 3, 5],
      description: 'Output ring smoothing strength.',
      table: { category: 'Wellbore outline' },
    },
    sampleSpacing: {
      control: { type: 'select' },
      options: [25, 50, 100, 200, 400],
      description:
        'Trajectory densification spacing. Affects only how finely the depth window is tested — the buffer is built from segments and the window crossings are interpolated.',
      table: { category: 'Wellbore outline' },
    },
    resolve: {
      control: 'boolean',
      description:
        'Make each chunk’s stack monotone on its shared tessellation, so its surfaces cannot interpenetrate. NOTE the guarantee is PER CHUNK — these five stacks are not resolved against each other.',
      table: { category: 'Resolve' },
    },
    resolveMode: {
      control: { type: 'inline-radio' },
      options: ['clamp', 'truncate'],
      description:
        'Both clamp the height (so the block stays sealed), but truncate also marks the unit absent where it was cut away, so the welded duplicate is dropped instead of drawn.',
      table: { category: 'Resolve' },
    },
    minGap: {
      control: { type: 'select' },
      options: [0, 1, 2, 5, 10, 25],
      description:
        'Minimum separation kept between surfaces. 0 is safe on a shared tessellation; >0 gives every pinch-out an artificial thickness.',
      table: { category: 'Resolve' },
    },
    collapseThreshold: {
      control: { type: 'select' },
      options: [0, 0.25, 0.5, 1, 2, 5],
      description:
        'Thickness below which a unit counts as absent and its triangles are dropped.',
      table: { category: 'Resolve' },
    },
    refineTerminations: {
      control: 'boolean',
      description:
        'Refine the tessellation along the lines where a unit wedges out. Off, the pinch-out can only terminate on edges the height refinement happened to leave there — coarse sawtooth in flat areas.',
      table: { category: 'Resolve' },
    },
    coverageAbsence: {
      control: 'boolean',
      description:
        'Drop triangles where a layer has no data of its OWN (a surface mapped over a smaller area than the chunk is absent out there, not flat). Off, the nearest-fill stands in for it — and is marked as inferred, since that is what it is.',
      table: { category: 'Resolve' },
    },
    maxFill: {
      control: { type: 'select' },
      options: [0, 100, DEFAULT_CHUNK_MAX_FILL, 500, 1000, 2000],
      description:
        'How far a layer counts as covered past its own data, in metres — an erosion radius on the unmapped area, so a hole of radius r vanishes at maxFill = r and a bigger one just loses a rim. 0 = only real data counts.',
      table: { category: 'Resolve' },
    },
    seal: {
      control: 'boolean',
      description:
        'Close the block where a surface is not mapped, by tapering it onto its nearest mapped neighbour. Off, every interval bounded by an unmapped surface vanishes and the block is left open (and the outline is trimmed to the data instead).',
      table: { category: 'Resolve' },
    },
    sealMode: {
      control: 'inline-radio',
      options: ['proportional', 'void'],
      description:
        'How the space an unmapped surface cannot account for is closed: keep its relative depth between its neighbours, or split it in two and leave the space between EMPTY.',
      table: { category: 'Resolve' },
    },
    minThickness: {
      control: { type: 'select' },
      options: [0.5, 1, 2, 5, 10, 20],
      description:
        'How much of a neighbouring unit a seal must leave standing, in metres — the only setting the shape of a seal has (how far it reaches is derived from the gap it closes, measured inside the chunk). ⚠️ Keep it above `collapseThreshold`, or the sliver it leaves is dropped for having no thickness and the hole comes back.',
      table: { category: 'Resolve' },
    },
    seabed: {
      control: { type: 'inline-radio' },
      options: ['none', 'procedural'],
      description:
        'Insert a PROCEDURAL sea bed between the water and the geology — a synthetic layer with a relief field instead of a grid.',
      table: { category: 'Water' },
    },
    seabedDepth: {
      control: { type: 'select' },
      options: [0, 100, 200, 320, 500, 800],
      description: 'Mean depth of the procedural sea bed, positive-down.',
      table: { category: 'Water' },
    },
    seabedRelief: {
      control: { type: 'select' },
      options: [0, 25, 60, 120, 200],
      description: 'Peak-to-trough relief of the procedural sea bed.',
      table: { category: 'Water' },
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
    inferredStyle: {
      control: 'select',
      options: ['none', 'hatched', 'checker', 'zigzag'],
      description:
        'How the INVENTED part of the block is marked — the geometry the seal built where no surface was mapped. It is drawn as a pattern OVER the unit’s material.',
      table: { category: 'Appearance' },
    },
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
    // LAST = outermost, so the panel is DOM outside the canvas.
    createOutputPanelDecorator({
      origin: 'top-left',
      offset: [10, 10],
      width: 160,
      fontSize: 11,
      opacity: 0.75,
    }),
  ],
  parameters: {
    // autoClear stays false (RenderingPipeline owns clearing; true wipes OIT targets).
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
};
