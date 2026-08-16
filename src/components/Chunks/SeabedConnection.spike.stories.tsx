import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useMemo, useRef } from 'react';
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
import { chunkTimings } from '../../storybook/data/chunk-timings';
import {
  getSyntheticSurface,
  isSyntheticSurfaceId,
  SYNTHETIC_SEABED_ID,
} from '../../storybook/data/synthetic-surfaces';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { createOutputPanelDecorator } from '../../storybook/decorators/output-panel-decorator';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea, UtmPosition } from '../UtmArea';
import { BasicTrajectory } from '../Wellbores/BasicTrajectory/BasicTrajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';
import { Chunk } from './Chunk';
import {
  ChunkLayer,
  ChunkResolveOptions,
  ChunkStackProgress,
  StackWater,
} from './chunk-defs';
import { ChunkStack } from './ChunkStack';
import { WellboreOutlineMode } from './cutout';
import { useOutputPanelState } from '../Html/OutputPanel/output-panel-state';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');

/**
 * The horizons that frame the stack, by id. Both are OPTIONAL in the data: a sea
 * bed is bathymetry rather than stratigraphy and most fields map none, and
 * "basement" is only ever a name for the deepest thing mapped.
 *
 * Unmapped, the sea bed is {@link SYNTHETIC_SEABED_ID} — generated, so the story
 * has one to connect to — and the basement is simply the deepest surface.
 */
const SEABED_ID = (storyArgs.seabedSurface as string | null) ?? null;
const BASEMENT_ID = (storyArgs.basementSurface as string | null) ?? null;

// Cached by the generator, and generated anyway at store init, so this is a lookup.
const GENERATED_SEABED = SEABED_ID
  ? null
  : (getSyntheticSurface(SYNTHETIC_SEABED_ID)?.meta ?? null);

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
  detailTiers: number;
  basementCrop: number;
  seal: boolean;
  sealMode: 'proportional' | 'void';
  minThickness: number;
  constrainCoverage: boolean;
  seaLevel: number;
  carrierMode: 'below' | 'depth';
  basementThickness: number;
  carrierDepth: number;
  wellCount: number;
  radius: number;
  mode: WellboreOutlineMode;
  unmapped: 'exclude' | 'ignore';
  showTrajectories: boolean;
  surfaceOpacity: number;
  wallOpacity: number;
  waterOpacity: number;
  seabedOpacity: number;
  bedTint: number;
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
    if (SEABED_ID) {
      const from = all.findIndex(m => m.id === SEABED_ID);
      return from >= 0 ? all.slice(from) : all;
    }
    return GENERATED_SEABED ? [GENERATED_SEABED, ...all] : all;
  }, [surfaceMetaDict]);

  const seabed = column[0];
  const basement = useMemo(
    () =>
      (BASEMENT_ID ? column.find(m => m.id === BASEMENT_ID) : undefined) ??
      column[column.length - 1],
    [column],
  );

  // The footprint the framing chunks use. It has to CONTAIN every other chunk, so
  // it is the widest surface in the column — but only among those that come from
  // the data: a generated sea bed is mapped everywhere and would stretch the field
  // far past any real survey.
  //
  // Built through `surfaceGridToWorld` rather than from the meta's xmax/ymax:
  // those are the origin plus the span in the GRID's own frame, and a rotated
  // survey would then land somewhere else entirely.
  const footprint = useMemo(
    () =>
      column
        .filter(m => !isSyntheticSurfaceId(m.id))
        .reduce<SurfaceMeta | null>(
          (widest, m) =>
            !widest ||
            m.header.nx * m.header.xinc * (m.header.ny * m.header.yinc) >
              widest.header.nx *
                widest.header.xinc *
                (widest.header.ny * widest.header.yinc)
              ? m
              : widest,
          null,
        ) ?? seabed,
    [column, seabed],
  );

  const field = useMemo<PlanarPolygonGeometry | null>(() => {
    if (!footprint) return null;
    const { nx, ny, xinc, yinc, rot, xori, yori } = footprint.header;
    const p = crs.utmToWorld(xori, yori, 0);
    const toWorld = surfaceGridToWorld({ nx, ny, xinc, yinc, rot }, [p.x, p.z]);
    const ring = [
      toWorld(0, 0),
      toWorld(nx - 1, 0),
      toWorld(nx - 1, ny - 1),
      toWorld(0, ny - 1),
    ];
    return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
  }, [footprint]);

  // The basement tier's own footprint: the field cropped from one side, so the
  // seam it shares with the wellbore-cut tier can be swept from containment
  // through a partial overlap to disjoint. Built in the field's OWN (rotated)
  // frame so it always stays inside the stack envelope.
  const basementOutline = useMemo<PlanarPolygonGeometry | null>(() => {
    if (!footprint) return null;
    if (props.basementCrop <= 0) return field;
    const { nx, ny, xinc, yinc, rot, xori, yori } = footprint.header;
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
  }, [footprint, field, props.basementCrop]);

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
          ...chunkTimings(metrics),
          layers: rows,
        })}`,
      );
      console.table(rows);
    },
    [surfaceMetaDict],
  );

  // --- The three tiers -------------------------------------------------------
  // A: the open seabed, over the FIELD outline. That horizon is the detail chunk's
  //    lid as well, so this one draws the field MINUS that footprint — the part of
  //    the seabed no block below it claims. The sea itself belongs to the stack.
  const oceanLayers = useMemo<ChunkLayer[]>(
    () =>
      seabed
        ? [
            // Drawn at THIS LAYER's opacity, which is the point of the split: the
            // open seabed stays translucent while the lid over the opaque detail
            // block does not, so you never look straight through it into that
            // block's walls.
            {
              surface: seabed,
              material: '#c2b280',
              opacity: props.seabedOpacity,
            },
          ]
        : [],
    [seabed, props.seabedOpacity],
  );

  // One sea for the whole column, declared on the stack rather than on whichever
  // tier happens to sit under it.
  const water = useMemo<StackWater>(
    () => ({
      depth: props.seaLevel,
      waterOpacity: props.waterOpacity,
      bedTint: props.bedTint,
    }),
    [props.seaLevel, props.waterOpacity, props.bedTint],
  );

  // B: the detail, cut by wellbores, split into TIERS that share their boundary
  //    surfaces — tier k's floor is tier k+1's lid, so the tiers meet by
  //    construction and the stack decides which of the two draws each shared
  //    horizon. The top boundary is the seabed (which tier 0 draws, being the
  //    block it is the lid of) and the bottom is the basement surface, which the
  //    last tier does NOT draw: that one is the basement chunk's lid.
  //
  // ⭐ Splitting also changes what BOUNDS each tier's outline. A chunk's depth
  //    window comes from its own first/last real surface, and a sample is dropped
  //    where a bounding surface has no data — so with one tier spanning the whole
  //    column, the partly-mapped `Basement Base` gated the WHOLE footprint. Each
  //    tier now gets its own base, and only the deepest one carries that gap
  //    (unless `unmapped` is set to ignore it).
  const detailTiers = useMemo<ChunkLayer[][]>(() => {
    if (!seabed || !basement) return [];
    const middle = column
      .slice(1, 1 + props.detailCount)
      .filter(m => m.id !== basement.id);
    const boundaries = [seabed, ...middle, basement];
    const last = boundaries.length - 1;
    const palette = ['#59a14f', '#8cbf6a', '#edc949', '#e1a34f'];
    // Global indices, so the stratigraphy reads as one column across the tiers.
    const materialAt = (i: number) =>
      i === 0 ? '#c2b280' : i === last ? undefined : palette[(i - 1) % 4];
    const fillAt = (i: number) => (i === 0 ? '#a08f66' : palette[(i - 1) % 4]);

    const tiers = Math.max(1, Math.min(props.detailTiers, last));
    const out: ChunkLayer[][] = [];
    for (let t = 0; t < tiers; t++) {
      const from = Math.round((t * last) / tiers);
      const to = Math.round(((t + 1) * last) / tiers);
      out.push(
        boundaries.slice(from, to + 1).map((surface, k) => {
          const i = from + k;
          // A tier's own floor is filled by the tier BELOW it, so it carries no
          // fill here — that is what makes the tiers meet instead of overlap.
          return i < to
            ? { surface, material: materialAt(i), fill: fillAt(i) }
            : { surface, material: materialAt(i) };
        }),
      );
    }
    return out;
  }, [column, seabed, basement, props.detailCount, props.detailTiers]);

  const detailOutline = useMemo(
    () => ({
      kind: 'wellbores' as const,
      wellbores: wellboreIds,
      options: {
        radius: props.radius,
        mode: props.mode,
        unmapped: props.unmapped,
      },
    }),
    [wellboreIds, props.radius, props.mode, props.unmapped],
  );

  // C: the basement block, back on the FIELD outline — the basement surface it
  //    owns, filled down to the COLUMN's carrier. The fill on its LAST layer is
  //    what asks for that floor; the plane itself is declared on the stack, so
  //    every chunk terminating against it shares one.
  const basementLayers = useMemo<ChunkLayer[]>(() => {
    if (!basement) return [];
    return [{ surface: basement, material: '#6b6b6b', fill: '#4a4a4a' }];
  }, [basement]);

  // Stack progress, written to the OutputPanel's global store (the story runs
  // INSIDE the canvas, so it cannot render DOM itself). Cold loads here are
  // dominated by fetching one JSON grid per surface, which reads as a hang
  // without this.
  //
  // ⭐ The REBUILD COUNT is the part worth having: a rebuild that finishes
  // quickly flashes past the 'building' state, so the counter is what answers
  // "did changing that control actually rebuild anything?".
  const builds = useRef(0);
  const busy = useRef(false);
  const onProgress = useCallback((p: ChunkStackProgress) => {
    const done = p.building === 0 && p.total > 0;
    if (!done) busy.current = true;
    else if (busy.current) {
      busy.current = false;
      builds.current += 1;
    }
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
        rebuilds: {
          label: 'Rebuilds',
          value: `${builds.current}`,
          order: 1,
        },
      },
    }));
  }, []);

  if (!field || !seabed || !basement) return null;

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <ChunkStack
          outline={field}
          surfaces={column}
          water={water}
          resolve={resolve}
          onProgress={onProgress}
          carrier={
            props.carrierMode === 'depth'
              ? { depth: props.carrierDepth }
              : { below: props.basementThickness }
          }
        >
          <Chunk
            layers={oceanLayers}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
            onBuild={report('seabed')}
          />
          {detailTiers.map((layers, i) => (
            <Chunk
              key={i}
              layers={layers}
              outline={detailOutline}
              surfaceOpacity={props.surfaceOpacity}
              wallOpacity={props.wallOpacity}
              wireframe={props.wireframe}
              onBuild={report(`detail-${i}`)}
            />
          ))}
          <Chunk
            layers={basementLayers}
            outline={basementOutline ?? 'inherit'}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
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
          'Three tiers that MEET: the open seabed over the field outline, wellbore-cut detail beneath it, and the basement block back on the field outline. The sea spans all three and is declared once on the `ChunkStack`, because it is a property of the COLUMN — a tier drawing part of it would draw its lid twice wherever two footprints overlap.\n\n' +
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
    detailTiers: 3,
    basementCrop: 0,
    carrierMode: 'below',
    basementThickness: 800,
    carrierDepth: 2500,
    seaLevel: 0,
    waterOpacity: 0.7,
    seabedOpacity: 0.95,
    bedTint: 0.35,
    seal: true,
    sealMode: 'proportional',
    minThickness: 1,
    constrainCoverage: false,
    wellCount: 20,
    radius: 800,
    mode: 'above',
    unmapped: 'exclude',
    showTrajectories: true,
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
  },
  argTypes: {
    detailCount: {
      control: { type: 'select' },
      options: [1, 2, 3, 4, 6, 8, 12],
      description: 'Surfaces the wellbore-cut middle tier spans.',
      table: { category: 'Connection' },
    },
    detailTiers: {
      control: { type: 'select' },
      options: [1, 2, 3, 4, 5],
      description:
        'Split the wellbore-cut detail into this many stacked tiers, sharing a boundary surface at each junction. Each tier resolves its OWN outline, so with `mode: above` they telescope; it also gives every tier its own base surface, instead of the whole column being gated by the partly-mapped `Basement Base`.',
      table: { category: 'Connection' },
    },
    basementCrop: {
      control: { type: 'select' },
      options: [0, 3, 6, 9, 12, 15],
      description:
        'Crop the basement tier this many km off one side of the field, sweeping the `Basement Base` seam through all three cases: it CONTAINS the detail tier (0), then only PARTLY overlaps it (the basement cap is cut back to the detail tier’s edge), then misses it entirely and both draw their own.',
      table: { category: 'Connection' },
    },
    basementThickness: {
      control: { type: 'select' },
      options: [100, 250, 500, 800, 1500],
      description:
        'The column CARRIER: one flat floor this far below the deepest mapped sample of the whole column, declared on the `ChunkStack` and drawn by the basement tier — which asks for it simply by putting a `fill` on its last layer. Nothing pierces it — a surface that would is truncated at it.',
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
      control: { type: 'select' },
      options: [1000, 1500, 2000, 2500, 3000],
      description:
        'Absolute carrier depth (metres, positive-down), used by `carrierMode: depth`. Below ~2200 m nothing is cut; raise it through the basement to watch the block end flat.',
      table: { category: 'Connection' },
    },
    seaLevel: {
      control: { type: 'select' },
      options: [-200, -100, -50, 0, 50, 100, 200],
      description:
        'Sea level, metres below datum (positive-down) — 0 puts the sea surface at MSL. ⭐ The sea is declared on the `ChunkStack` rather than on a tier, and takes no part in the depth order — raising it does not truncate the seabed.',
      table: { category: 'Water' },
    },
    waterOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'The WATER’s own opacity, looking straight down — a base the shader mixes toward 1 with the Fresnel term, not the final alpha.',
      table: { category: 'Water' },
    },
    seabedOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Opacity of the OPEN seabed — the part of the horizon the seabed tier draws, set on that layer rather than on the chunk. The lid over the detail chunk is that chunk’s, so it keeps `surfaceOpacity`.',
      table: { category: 'Water' },
    },
    bedTint: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Tint the seabed toward the water colour, as if seen through the water column. Depth-dependent, so it builds up over the first ~80 m below the plane — this seabed is far below that, so it sits at full strength.',
      table: { category: 'Water' },
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
      control: { type: 'select' },
      options: [0.5, 1, 2, 5, 10, 20],
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
      control: { type: 'select' },
      options: [1, 2, 5, 10, 20, 50],
      table: { category: 'Wellbore outline' },
    },
    radius: {
      control: { type: 'select' },
      options: [250, 500, 800, 1000, 1500, 2000, 3000],
      table: { category: 'Wellbore outline' },
    },
    mode: {
      control: { type: 'inline-radio' },
      options: ['window', 'above', 'below'],
      description:
        'Which part of each well cuts a tier. `window` = only inside that tier. `above` = from the WELLHEAD down to the tier’s base, so the tiers nest and the block telescopes OUT with depth. `below` = down to TD, the mirror image.',
      table: { category: 'Wellbore outline' },
    },
    unmapped: {
      control: { type: 'inline-radio' },
      options: ['exclude', 'ignore'],
      description:
        'What to do where a tier’s BOUNDING surface has no data. `exclude` drops the trajectory there, so a hole in a deep base surface removes that area from the outline even though everything above it is mapped. `ignore` keeps whatever the other bound allows — closer to what is actually drawn, since the seal gives the unmapped surface a height anyway. ⚠️ `ignore` cannot tell an interior hole from being off the grid entirely.',
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
    wireframe: { control: 'boolean', table: { category: 'Appearance' } },
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
      height: 80,
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
};
