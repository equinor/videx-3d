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
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { createOutputPanelDecorator } from '../../storybook/decorators/output-panel-decorator';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { useOutputPanelState } from '../Html/OutputPanel/output-panel-state';
import { useSurfaceMaterial } from '../Surfaces/useSurfaceMaterial';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkResolveOptions, ChunkStackProgress } from './chunk-defs';
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
  surfaceFrom: number;
  chunkSizes: string;
  connectChunks: boolean;
  maxError: number;
  wellCount: number;
  radius: number;
  cellSize: number;
  clusterDistance: number;
  feather: number;
  wellSmoothing: number;
  sampleSpacing: number;
  resolve: boolean;
  resolveMode: 'clamp' | 'truncate';
  minGap: number;
  collapseThreshold: number;
  refineTerminations: boolean;
  coverageAbsence: boolean;
  coverageRule: 'all' | 'any';
  showWater: boolean;
  waterDepth: number;
  seabed: 'none' | 'procedural';
  seabedDepth: number;
  seabedRelief: number;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  topSurfaceMaterial: boolean;
  topShowContours: boolean;
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
          coverageRule: props.coverageRule,
        }
        : undefined,
    [
      props.resolve,
      props.resolveMode,
      props.minGap,
      props.collapseThreshold,
      props.refineTerminations,
      props.coverageAbsence,
      props.coverageRule,
    ],
  );

  // The uppermost surface of the whole stack may be drawn with the real
  // `SurfaceMaterial` (elevation-driven colour ramp / contours) instead of the
  // chunk's flat colour. It reads the grid through the geometry's UV attribute,
  // which the shared tessellation writes per layer.
  const topMeta = chunks[0]?.[0];
  const topMaterial = useSurfaceMaterial(
    props.topSurfaceMaterial ? topMeta : null,
    { showContours: props.topShowContours, opacity: props.surfaceOpacity },
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

  // Per-chunk build report. The library never logs by itself — `onBuild` hands the
  // metrics over and the story decides what to do with them.
  const nameOf = useCallback(
    (id: string) => surfaceMetaDict[id]?.name ?? id,
    [surfaceMetaDict],
  );
  const report = (index: number, metrics: SurfaceChunkMetrics) => {
    const d = metrics.diagnostics;
    console.table([
      {
        chunk: index,
        layers: metrics.layers,
        triangles: metrics.triangles.toLocaleString(),
        droppedAbsent: d?.trianglesAbsent ?? '-',
        droppedThin: d?.trianglesCollapsed ?? '-',
        topKept: d?.topKept ?? '-',
        trimmed: d?.outlineTrimmed ?? '-',
        'outline%': d ? (100 * d.outlineCoverage).toFixed(1) : '-',
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
          'duplicate%': (100 * l.duplicate).toFixed(1),
          triangles: l.triangles.toLocaleString(),
          droppedAbsent: l.droppedAbsent,
          droppedThin: l.droppedCollapsed,
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
        // it as the top of its first interval but does NOT cap it, because the
        // chunk above already draws that horizon. Drawing it twice would put two
        // independent tessellations of the same surface in the same place.
        const above = chunks[i - 1];
        const shared = above[above.length - 1];
        return [
          { surface: shared, cap: false, fill: shade(0) },
          ...own.map((l, j) => ({ ...l, material: shade(j + 1) })),
        ];
      }),
    [chunks, props.connectChunks],
  );

  // Stack-level progress — what a host would drive a busy indicator / bar from.
  // The story runs INSIDE the R3F canvas, so it cannot render DOM itself; it writes
  // to the OutputPanel's global store and the panel (added as the outermost
  // decorator) renders outside the canvas.
  const onProgress = useCallback((p: ChunkStackProgress) => {
    const done = p.building === 0;
    useOutputPanelState.getState().set(state => ({
      groups: {
        ...state.groups,
        build: {
          label: done ? 'Chunks built' : 'Building chunks',
          value: done
            ? `${p.total}`
            : `${p.completed}/${p.total}  ${Math.round(100 * p.fraction)}%`,
          color: done ? '#59a14f' : '#f28e2c',
          order: 0,
        },
      },
    }));
  }, []);

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
        <ChunkStack
          cutSource={cutSource}
          surfaces={column}
          maxError={props.maxError}
          onProgress={onProgress}
        >
          {chunkProps.map((layers, i) => (
            <Chunk
              key={i}
              // The uppermost surface of the whole stack may use the real
              // SurfaceMaterial — now just a material on that layer. Water is a
              // SYNTHETIC layer sitting above it with the interval filled: no
              // ocean component, no special case.
              layers={
                i === 0
                  ? [
                    ...(props.showWater
                      ? [
                        {
                          depth: props.waterDepth,
                          material: '#3fa9d8',
                          fill: '#2f7fa8',
                        },
                      ]
                      : []),
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
                    ...(topMaterial
                      ? [
                        { ...layers[0], material: topMaterial },
                        ...layers.slice(1),
                      ]
                      : layers),
                  ]
                  : layers
              }
              surfaceOpacity={props.surfaceOpacity}
              wallOpacity={props.wallOpacity}
              wireframe={props.wireframe}
              resolve={resolve}
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
    radius: 800,
    cellSize: 200,
    clusterDistance: 2000,
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
    coverageRule: 'all',
    showWater: false,
    waterDepth: 0,
    seabed: 'none',
    seabedDepth: 320,
    seabedRelief: 120,
    // Appearance
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    topSurfaceMaterial: false,
    topShowContours: false,
    // Wells
    showWells: true,
    wellColor: '#00e5ff',
  },
  argTypes: {
    surfaceFrom: {
      control: { type: 'range', min: 0, max: 31, step: 1 },
      description:
        'Index of the first surface (stratigraphic order), so the stack can start below the top of the column.',
      table: { category: 'Chunks' },
    },
    chunkSizes: {
      control: { type: 'text' },
      description:
        'Surfaces per stacked chunk (shallow→deep), comma-separated.',
      table: { category: 'Chunks' },
    },
    connectChunks: {
      control: 'boolean',
      description:
        'Make each chunk SHARE its upper neighbour’s last surface — it becomes the top of this chunk’s first interval, uncapped (`cap: false`) because the chunk above already draws that horizon. Off, the tiers leave the unit between them undrawn.',
      table: { category: 'Chunks' },
    },
    maxError: {
      control: { type: 'range', min: 0.5, max: 40, step: 0.5 },
      description:
        'Interior simplification error (world units of height) for the shared tessellation. Lower = more triangles, finer detail.',
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
      control: { type: 'range', min: 0, max: 50, step: 1 },
      description:
        'Minimum separation kept between surfaces. 0 is safe on a shared tessellation; >0 gives every pinch-out an artificial thickness.',
      table: { category: 'Resolve' },
    },
    collapseThreshold: {
      control: { type: 'range', min: 0, max: 10, step: 0.1 },
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
        'Drop triangles where a layer has no data of its OWN (a surface mapped over a smaller area than the chunk is absent out there, not flat). Off, the nearest-fill stands in for it.',
      table: { category: 'Resolve' },
    },
    coverageRule: {
      control: { type: 'inline-radio' },
      options: ['all', 'any'],
      description:
        'What “covered” means when the outline is cut back to the mapped area. `all` = every layer (nothing is ever drawn on hole fill, every wall runs between two known surfaces); `any` = at least one layer (keeps more footprint, but layers still vanish inside it).',
      table: { category: 'Resolve' },
    },
    showWater: {
      control: 'boolean',
      description:
        'Add a SYNTHETIC water layer above the first chunk — an ordinary layer with a `level` instead of a surface, filled down to the surface below it.',
      table: { category: 'Water' },
    },
    waterDepth: {
      control: { type: 'range', min: 0, max: 3000, step: 10 },
      description:
        'Metres below sea level for the water plane (POSITIVE-DOWN, same convention as surfaces). ⚠️ Push it past the top surface and shallow-wins truncation flattens that surface to the water plane and drops it — the water does NOT recede. See chunks.md §9.5.1.',
      table: { category: 'Water' },
    },
    seabed: {
      control: { type: 'inline-radio' },
      options: ['none', 'procedural'],
      description:
        'Insert a PROCEDURAL sea bed between the water and the geology — a synthetic layer with a relief field instead of a grid.',
      table: { category: 'Water' },
    },
    seabedDepth: {
      control: { type: 'range', min: 0, max: 3000, step: 10 },
      description: 'Mean depth of the procedural sea bed, positive-down.',
      table: { category: 'Water' },
    },
    seabedRelief: {
      control: { type: 'range', min: 0, max: 600, step: 10 },
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
    topSurfaceMaterial: {
      control: 'boolean',
      description:
        'Draw the uppermost surface with the real `SurfaceMaterial` (elevation colour ramp) instead of the chunk’s flat colour, configured from its `SurfaceMeta`.',
      table: { category: 'Appearance' },
    },
    topShowContours: {
      control: 'boolean',
      description:
        'Contour lines on the top surface (needs the material above).',
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
      width: 190,
      height: 62,
      opacity: 0.75,
    }),
  ],
  // The panel store is global; clear it so a reload does not show a stale count.
  loaders: [
    async () => {
      useOutputPanelState.setState({ groups: {} });
      return {};
    },
  ],
  parameters: {
    // autoClear stays false (RenderingPipeline owns clearing; true wipes OIT targets).
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
};
