import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { OITRenderPass, Pass, RenderPass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonGeometry,
  SurfaceChunkMetrics,
  surfaceGridToWorld,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import { sortByStratAge } from '../../storybook/data/strat-ages';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea, UtmPosition } from '../UtmArea';
import { BasicTrajectory } from '../Wellbores/BasicTrajectory/BasicTrajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';
import { Chunk } from './Chunk';
import { ChunkLayer, ChunkResolveOptions } from './chunk-defs';
import { ChunkStack } from './ChunkStack';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');

/** The seabed horizon of the demo field, and the deepest mapped surface. */
const SEABED_NAME = 'NORDLAND GP. Top';
const BASEMENT_NAME = 'Basement Base';

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

type SeabedConnectionProps = {
  detailCount: number;
  basementCrop: number;
  seal: boolean;
  sealMode: 'proportional' | 'void';
  minThickness: number;
  constrainCoverage: boolean;
  waterDepth: number;
  carrierMode: 'below' | 'depth';
  basementThickness: number;
  carrierDepth: number;
  wellCount: number;
  radius: number;
  showTrajectories: boolean;
  surfaceOpacity: number;
  wallOpacity: number;
  waterOpacity: number;
  wireframe: boolean;
};

const SeabedConnectionStory = (props: SeabedConnectionProps) => {
  const surfaceMetaDict = useSurfaceMetaDict();
  const wellbores = useWellboreHeaders();

  // The whole column, shallowest first, so all three chunks are resolved together.
  const column = useMemo<SurfaceMeta[]>(() => {
    const all = sortByStratAge(
      Object.keys(surfaceOptions)
        .map(id => surfaceMetaDict[id])
        .filter((m): m is SurfaceMeta => !!m),
    );
    const from = all.findIndex(m => m.name === SEABED_NAME);
    return from >= 0 ? all.slice(from) : all;
  }, [surfaceMetaDict]);

  const seabed = column[0];
  const basement = useMemo(
    () => column.find(m => m.name === BASEMENT_NAME),
    [column],
  );

  // The footprint the framing chunks use: the SEABED's own data extent. It is
  // mapped over the whole area, so every other chunk fits inside it — which is
  // what a chunk that owns a shared horizon has to guarantee.
  //
  // Built through `surfaceGridToWorld` rather than from the meta's xmax/ymax:
  // those are the origin plus the span in the GRID's own frame, and this survey
  // is rotated (rot = 220°), so treating them as UTM-axis-aligned puts the
  // rectangle somewhere else entirely.
  const field = useMemo<PlanarPolygonGeometry | null>(() => {
    if (!seabed) return null;
    const { nx, ny, xinc, yinc, rot, xori, yori } = seabed.header;
    const p = crs.utmToWorld(xori, yori, 0);
    const toWorld = surfaceGridToWorld({ nx, ny, xinc, yinc, rot }, [p.x, p.z]);
    const ring = [
      toWorld(0, 0),
      toWorld(nx - 1, 0),
      toWorld(nx - 1, ny - 1),
      toWorld(0, ny - 1),
    ];
    return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
  }, [seabed]);

  // The basement tier's own footprint: the field cropped from one side, so the
  // seam it shares with the wellbore-cut tier can be swept from containment
  // through a partial overlap to disjoint. Built in the field's OWN (rotated)
  // frame so it always stays inside the stack envelope.
  const basementOutline = useMemo<PlanarPolygonGeometry | null>(() => {
    if (!seabed) return null;
    if (props.basementCrop <= 0) return field;
    const { nx, ny, xinc, yinc, rot, xori, yori } = seabed.header;
    const p = crs.utmToWorld(xori, yori, 0);
    const toWorld = surfaceGridToWorld({ nx, ny, xinc, yinc, rot }, [p.x, p.z]);
    const from = Math.min(
      nx - 2,
      Math.round((props.basementCrop * 1000) / xinc),
    );
    const ring = [
      toWorld(from, 0),
      toWorld(nx - 1, 0),
      toWorld(nx - 1, ny - 1),
      toWorld(from, ny - 1),
    ];
    return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
  }, [seabed, field, props.basementCrop]);

  const wellboreIds = useMemo(
    () => wellbores.slice(0, props.wellCount).map(w => w.id),
    [wellbores, props.wellCount],
  );

  // The very wells the middle chunk's outline is cut from — drawn so it is
  // obvious whether that chunk actually contains all of them.
  const outlineWells = useMemo(
    () => wellbores.slice(0, props.wellCount),
    [wellbores, props.wellCount],
  );

  const resolve = useMemo<ChunkResolveOptions>(
    () => ({
      seal: props.seal,
      sealMode: props.sealMode,
      minThickness: props.minThickness,
      constrainCoverage: props.constrainCoverage,
    }),
    [props.seal, props.sealMode, props.minThickness, props.constrainCoverage],
  );

  // Per-chunk build report. `coverage` says whether a layer has data of its own
  // here; a layer at 0 was VOIDED — it has none anywhere this chunk is drawn, so
  // it draws no cap and leaves both the intervals it bounds open. `capped` says
  // whether a neighbouring chunk took the horizon over.
  const report = useMemo(
    () => (label: string) => (metrics: SurfaceChunkMetrics) => {
      const d = metrics.diagnostics;
      const rows = (d?.layers ?? []).map(l => ({
        index: l.index,
        name: l.id ? (surfaceMetaDict[l.id]?.name ?? l.id) : '(synthetic)',
        coverage: +l.coverage.toFixed(3),
        voided: l.voided,
        capped: l.capped,
        triangles: l.triangles,
        droppedAbsent: l.droppedAbsent,
        droppedCollapsed: l.droppedCollapsed,
        droppedExcluded: l.droppedExcluded,
      }));
      console.log(
        `CHUNKREPORT ${JSON.stringify({
          label,
          triangles: metrics.triangles,
          constraintFailures: d?.constraintFailures ?? null,
          coverageRingPoints: d?.coverageRingPoints ?? null,
          // The column is shared, so these are the SAME work reported by every
          // chunk — only the first one actually pays for it.
          stackLayers: d?.stackLayers ?? null,
          referenceNodes: d?.referenceNodes ?? null,
          referenceStep: d?.referenceStep ?? null,
          fetchMs: Math.round(d?.fetchMs ?? 0),
          referenceMs: Math.round(d?.referenceMs ?? 0),
          stackResolveMs: Math.round(d?.stackResolveMs ?? 0),
          tessellateMs: Math.round(d?.tessellateMs ?? 0),
          layers: rows,
        })}`,
      );
      console.table(rows);
    },
    [surfaceMetaDict],
  );

  // --- The three tiers -------------------------------------------------------
  // A: water down to the seabed, over the FIELD outline. The seabed is the detail
  //    chunk's lid, so this one draws the field MINUS that footprint — the part of
  //    the seabed no block below it claims.
  const oceanLayers = useMemo<ChunkLayer[]>(() => {
    if (!seabed) return [];
    return [
      { depth: props.waterDepth, material: '#3fa9d8', fill: '#2f7fa8' },
      // Drawn at THIS chunk's opacity, which is the point of the split: the open
      // seabed stays translucent while the lid over the opaque detail block does
      // not, so you never look straight through it into that block's walls.
      { surface: seabed, material: '#c2b280' },
    ];
  }, [seabed, props.waterDepth]);

  // B: the detail, cut by wellbores. It starts ON the seabed — which it DRAWS, as
  //    the block that horizon is the lid of — and ends ON the basement surface,
  //    which it does not: that one is the basement chunk's lid.
  const detailLayers = useMemo<ChunkLayer[]>(() => {
    if (!seabed || !basement) return [];
    const middle = column
      .slice(1, 1 + props.detailCount)
      .filter(m => m.name !== BASEMENT_NAME);
    const palette = ['#59a14f', '#8cbf6a', '#edc949', '#e1a34f'];
    return [
      {
        surface: seabed,
        material: '#c2b280',
        fill: '#a08f66',
      },
      ...middle.map((surface, i) => ({
        surface,
        material: palette[i % palette.length],
        fill: palette[i % palette.length],
      })),
      { surface: basement },
    ];
  }, [column, seabed, basement, props.detailCount]);

  // C: the basement block, back on the FIELD outline — the basement surface it
  //    owns, filled down to the COLUMN's carrier: one flat floor, declared on the
  //    stack, that every chunk terminating against it shares.
  const basementLayers = useMemo<ChunkLayer[]>(() => {
    if (!basement) return [];
    return [
      { surface: basement, material: '#6b6b6b', fill: '#4a4a4a' },
      { carrier: true },
    ];
  }, [basement]);

  if (!field || !seabed || !basement) return null;

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <ChunkStack
          outline={field}
          surfaces={column}
          carrier={
            props.carrierMode === 'depth'
              ? { depth: props.carrierDepth }
              : { below: props.basementThickness }
          }
        >
          <Chunk
            layers={oceanLayers}
            surfaceOpacity={props.waterOpacity}
            wallOpacity={props.waterOpacity}
            wireframe={props.wireframe}
            resolve={resolve}
            onBuild={report('water')}
          />
          <Chunk
            layers={detailLayers}
            outline={{
              kind: 'wellbores',
              wellbores: wellboreIds,
              options: { radius: props.radius },
            }}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
            resolve={resolve}
            onBuild={report('detail')}
          />
          <Chunk
            layers={basementLayers}
            outline={basementOutline ?? 'inherit'}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
            resolve={resolve}
            onBuild={report('basement')}
          />
        </ChunkStack>
        {props.showTrajectories &&
          outlineWells.map(wb => (
            <UtmPosition
              key={wb.id}
              easting={wb.easting}
              northing={wb.northing}
            >
              <Wellbore id={wb.id}>
                <BasicTrajectory color="#ff2020" />
              </Wellbore>
            </UtmPosition>
          ))}
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'Spikes/Chunks/SeabedConnection',
  component: SeabedConnectionStory,
  parameters: {
    // The seabed extent is ~25 x 42 km, so the default scale of 100 puts the
    // camera 100 m from origin with a 50 km far plane — inside the water.
    scale: 1000,
    docs: {
      description: {
        component:
          'Three tiers that MEET: water + seabed over the field outline, wellbore-cut detail beneath it, and the basement block back on the field outline.\n\n' +
          'The tiers connect by SHARING a boundary surface rather than by filling a gap between them. `NORDLAND GP. Top` belongs to both the ocean chunk and the detail chunk; `Basement Base` belongs to both the detail chunk and the basement chunk. Every chunk simply declares the layer — the stack works out who draws it, so it is drawn exactly once and two independent tessellations never fight over it.\n\n' +
          'A horizon is drawn by the chunk it is the TOP layer of, because a cap is the lid of the block underneath it. The others draw their footprint MINUS that, which is why the translucent water tier keeps a translucent seabed of its own while the lid over the opaque detail block is opaque.',
      },
    },
  },
} satisfies Meta<typeof SeabedConnectionStory>;

export default meta;
type Story = StoryObj<typeof SeabedConnectionStory>;

export const Default: Story = {
  args: {
    detailCount: 6,
    basementCrop: 0,
    waterDepth: 0,
    carrierMode: 'below',
    basementThickness: 800,
    carrierDepth: 2500,
    seal: true,
    sealMode: 'proportional',
    minThickness: 1,
    constrainCoverage: false,
    wellCount: 20,
    radius: 800,
    showTrajectories: true,
    surfaceOpacity: 1,
    wallOpacity: 1,
    waterOpacity: 0.45,
    wireframe: false,
  },
  argTypes: {
    detailCount: {
      control: { type: 'range', min: 1, max: 20, step: 1 },
      description: 'Surfaces the wellbore-cut middle tier spans.',
      table: { category: 'Connection' },
    },
    basementCrop: {
      control: { type: 'range', min: 0, max: 16, step: 0.5 },
      description:
        'Crop the basement tier this many km off one side of the field, sweeping the `Basement Base` seam through all three cases: it CONTAINS the detail tier (0), then only PARTLY overlaps it (the basement cap is cut back to the detail tier’s edge), then misses it entirely and both draw their own.',
      table: { category: 'Connection' },
    },
    waterDepth: {
      control: { type: 'range', min: 0, max: 200, step: 5 },
      description: 'Water plane, metres below sea level (positive-down).',
      table: { category: 'Connection' },
    },
    basementThickness: {
      control: { type: 'range', min: 100, max: 2000, step: 50 },
      description:
        'The column CARRIER: one flat floor this far below the deepest mapped sample of the whole column, declared on the `ChunkStack` and drawn by the basement tier (`{ carrier: true }`). Nothing pierces it — a surface that would is truncated at it.',
      table: { category: 'Connection' },
    },
    carrierMode: {
      control: 'inline-radio',
      options: ['below', 'depth'],
      description:
        'How the carrier is placed: `below` clears the column’s deepest mapped sample by `basementThickness`, so it never cuts anything; `depth` puts it at an absolute depth, which TRUNCATES every surface that would otherwise pierce it.',
      table: { category: 'Connection' },
    },
    carrierDepth: {
      control: { type: 'range', min: 500, max: 4000, step: 50 },
      description:
        'Absolute carrier depth (metres, positive-down), used by `carrierMode: depth`. Below ~2200 m nothing is cut; raise it through the basement to watch the block end flat.',
      table: { category: 'Connection' },
    },
    seal: {
      control: 'boolean',
      description:
        'Close a surface’s unmapped region by tapering it onto its neighbours. Runs on the COLUMN, so a horizon two chunks share has one height — except under `void`, which is still split per chunk.',
      table: { category: 'Resolve' },
    },
    sealMode: {
      control: 'inline-radio',
      options: ['proportional', 'void'],
      description:
        'How the space an unmapped surface cannot account for is closed. `proportional` keeps the relative depth it had where it was last mapped, so both units survive — “this horizon is here somewhere”. `void` splits it in two and draws NOTHING between — “the units are not defined here”, the only one that cannot be mistaken for data. ⚠️ `proportional` is resolved once for the whole column, `void` per chunk — so under `void` two chunks sharing a horizon can still split it differently and leave a gap at the seam.',
      table: { category: 'Resolve' },
    },
    minThickness: {
      control: { type: 'range', min: 0, max: 50, step: 0.5 },
      description:
        'How much of a neighbouring unit a seal must leave standing, in metres — the only setting the shape of a seal has (how far it reaches is derived from the gap it closes, measured inside this chunk). ⚠️ Below `collapseThreshold` the sliver it leaves is dropped for having no thickness and the hole comes back.',
      table: { category: 'Resolve' },
    },
    constrainCoverage: {
      control: 'boolean',
      description:
        'Constrain each layer’s data boundary into the shared tessellation, so a triangle is either wholly inside a survey or wholly outside it. `Basement Base` is mapped over 40% of the field here, so this is where the cost shows: watch `coverageRingPoints` and `constraintFailures` in the report.',
      table: { category: 'Resolve' },
    },
    wellCount: {
      control: { type: 'range', min: 1, max: 50, step: 1 },
      table: { category: 'Wellbore outline' },
    },
    radius: {
      control: { type: 'range', min: 100, max: 3000, step: 50 },
      table: { category: 'Wellbore outline' },
    },
    showTrajectories: {
      control: 'boolean',
      description:
        'Draw the trajectories the middle chunk is cut from, in red — the check that the chunk contains all of them.',
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
    waterOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Opacity of the water tier — including the part of the seabed it draws. The lid over the detail chunk is that chunk’s, so it keeps `surfaceOpacity`.',
      table: { category: 'Appearance' },
    },
    wireframe: { control: 'boolean', table: { category: 'Appearance' } },
  },
  decorators: [
    EventEmitterDecorator,
    GlyphsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
};
