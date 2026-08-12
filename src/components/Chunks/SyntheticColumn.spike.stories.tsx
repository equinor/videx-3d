import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../hooks/useData';
import { OITRenderPass, Pass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  PlanarPolygonGeometry,
  SedimentClass,
  SurfaceChunkMetrics,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import {
  getSyntheticColumn,
  syntheticColumnKeys,
  SyntheticColumnUnit,
} from '../../storybook/data/synthetic-surfaces';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkLayer, ChunkResolveOptions } from './chunk-defs';
import { ChunkStack } from './ChunkStack';
import { ChunkInferenceStyle } from './inference-material';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;

/**
 * Sediment class → colour. ⭐ This mapping lives in the STORY on purpose: the
 * library never assigns a colour, because the name → unit → colour lookup is
 * company-specific (documents/chunks.md, "colour is config").
 */
const CLASS_COLOUR: Record<SedimentClass, string> = {
  sand: '#e0b96a',
  silt: '#a8ac8a',
  shale: '#6c7f8b',
  carbonate: '#cbd5d0',
  salt: '#efe6d8',
  coal: '#3c3c40',
  basement: '#8a6f63',
};

// Always-on OIT pipeline (SMAA), matching the sibling chunk stories.
const ChunkPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  useFrame(() => {}, 2);
  return <RenderingPipeline passes={passes} />;
};

type SyntheticColumnProps = {
  column: string;
  from: number;
  count: number;
  outlineSize: number;
  maxError: number;
  seal: boolean;
  sealMode: 'proportional' | 'void';
  minThickness: number;
  maxFill: number;
  constrainCoverage: boolean;
  coverageAbsence: boolean;
  collapseThreshold: number;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  detail: boolean;
  detailStrength: number;
  inferredStyle: ChunkInferenceStyle;
};

const SyntheticColumnStory = (props: SyntheticColumnProps) => {
  const store = useData();

  // The units, shallowest first — the order a chunk's layer array takes, which
  // here is GUARANTEED right because the generator deposited them in it.
  const units = useMemo<SyntheticColumnUnit[]>(
    () => getSyntheticColumn(props.column),
    [props.column],
  );

  const selected = useMemo(
    () => units.slice(props.from, props.from + props.count),
    [units, props.from, props.count],
  );

  // ⚠️ Through the STORE, not `useSurfaceMetaDict` — that hook fetches
  // /data/surface-meta.json directly and never sees a generated surface.
  const [column, setColumn] = useState<SurfaceMeta[]>([]);
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    (async () => {
      const metas = await Promise.all(
        selected.map(u => store.get<SurfaceMeta>('surface-meta', u.id)),
      );
      if (cancelled) return;
      setColumn(metas.filter((m): m is SurfaceMeta => !!m));
    })();
    return () => {
      cancelled = true;
    };
  }, [store, selected]);

  const outline = useMemo<PlanarPolygonGeometry>(() => {
    const h = (props.outlineSize * 1000) / 2;
    const ring: Vec2[] = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
  }, [props.outlineSize]);

  const layers = useMemo<ChunkLayer[]>(() => {
    if (column.length === 0) return [];
    return column.map((surface, i) => {
      const sediment = selected[i]?.class ?? 'shale';
      const colour = CLASS_COLOUR[sediment];
      // ⭐ The class → detail mapping is the story's, exactly like the colour one:
      // the library ships the presets but never decides which unit is sand.
      const detail = props.detail
        ? { preset: sediment, strength: props.detailStrength }
        : undefined;
      return { surface, material: colour, fill: colour, detail };
    });
  }, [column, selected, props.detail, props.detailStrength]);

  const resolve = useMemo<ChunkResolveOptions>(
    () => ({
      maxFill: props.maxFill,
      seal: props.seal,
      sealMode: props.sealMode,
      minThickness: props.minThickness,
      constrainCoverage: props.constrainCoverage,
      coverageAbsence: props.coverageAbsence,
      collapseThreshold: props.collapseThreshold,
    }),
    [
      props.maxFill,
      props.seal,
      props.sealMode,
      props.minThickness,
      props.constrainCoverage,
      props.coverageAbsence,
      props.collapseThreshold,
    ],
  );

  const report = useMemo(
    () => (metrics: SurfaceChunkMetrics) => {
      const d = metrics.diagnostics;
      const rows = (d?.layers ?? []).map(l => ({
        unit: selected[l.index]?.name ?? l.index,
        class: selected[l.index]?.class ?? '',
        coverage: +l.coverage.toFixed(4),
        filled: +l.filled.toFixed(4),
        inferred: +l.inferred.toFixed(4),
        voided: l.voided,
        triangles: l.triangles,
        droppedAbsent: l.droppedAbsent,
        droppedCollapsed: l.droppedCollapsed,
      }));
      console.log(
        `CHUNKREPORT ${JSON.stringify({
          column: props.column,
          triangles: metrics.triangles,
          wallTriangles: metrics.wallTriangles,
          crossings: d?.crossings ?? null,
          maxOverlap: d?.maxOverlap ?? null,
          coverageRingPoints: d?.coverageRingPoints ?? null,
          constraintFailures: d?.constraintFailures ?? null,
          tessellateMs: Math.round(d?.tessellateMs ?? 0),
          layers: rows,
        })}`,
      );
      console.table(rows);
    },
    [props.column, selected],
  );

  if (layers.length < 2) return null;

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ChunkStack outline={outline} surfaces={column}>
          <Chunk
            layers={layers}
            resolve={resolve}
            maxError={props.maxError}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
            inferredStyle={props.inferredStyle}
            onBuild={report}
          />
        </ChunkStack>
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'Spikes/Chunks/SyntheticColumn',
  component: SyntheticColumnStory,
  parameters: {
    scale: 5000,
    cameraPosition: [7000, 3500, 7000],
    cameraTarget: [0, -1800, 0],
    docs: {
      description: {
        component:
          'A chunk cut from a GENERATED stratigraphic column — a set of surfaces that are exact functions of one another, rather than the independent surfaces of `SyntheticCoverage`.\n\n' +
          'Each unit is deposited as `thickness = drape + fill · max(0, dPrev − datum)`: `drape` blankets the topography, `fill` levels it toward `datum`. Where the surface below is already shallower than the datum the unit has NO thickness, so it **pinches out over the highs** — a real zero-thickness termination, which the demo field only shows by accident.\n\n' +
          'The column also contains a **fault** (gridded into a ramp and dying out along strike — a height field cannot hold the break, so the surfaces are carried across it exactly as an interpreter would), a **partly-mapped unit** (a survey extent, not geology), and an **angular unconformity** whose truncated horizons are recorded as NO DATA by default, which is what an interpreter delivers and what makes them indistinguishable from a survey edge.\n\n' +
          '⭐ Everything about the column — grid size and resolution, number of units, structure, seed, erosion encoding, where the fault and the unconformity fall — comes from the `COLUMN` constants in `src/storybook/data/synthetic-surfaces.ts`. Change one and reload to get a different field.\n\n' +
          '⭐⭐ Because every relationship is known, a crossing or a mis-ordering reported here is unambiguously a pipeline bug. Watch `crossings` and `maxOverlap` in the console table: they should stay at zero.',
      },
    },
  },
} satisfies Meta<typeof SyntheticColumnStory>;

export default meta;
type Story = StoryObj<typeof SyntheticColumnStory>;

export const Default: Story = {
  args: {
    column: syntheticColumnKeys[0],
    from: 0,
    count: 20,
    outlineSize: 7,
    maxError: 5,
    seal: true,
    sealMode: 'proportional',
    minThickness: 1,
    maxFill: 250,
    constrainCoverage: false,
    coverageAbsence: true,
    collapseThreshold: 0.5,
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    detail: false,
    detailStrength: 1,
    inferredStyle: 'hatched',
  },
  argTypes: {
    column: {
      control: 'select',
      options: syntheticColumnKeys,
      table: { category: 'Column' },
    },
    from: {
      control: { type: 'range', min: 0, max: 12, step: 1 },
      description:
        'First unit to draw, counting from the SHALLOWEST. Raise it to start below the unconformity.',
      table: { category: 'Column' },
    },
    count: {
      control: { type: 'range', min: 2, max: 20, step: 1 },
      description:
        'How many units to draw from `from` downward. ⭐ The column itself — its length, grid, structure, seed and erosion encoding — is built from the `COLUMN` constants in `src/storybook/data/synthetic-surfaces.ts`; edit those and reload.',
      table: { category: 'Column' },
    },
    outlineSize: {
      control: { type: 'range', min: 1, max: 10, step: 0.5 },
      description:
        'Side of the square crop, in km. The grids are 10 km across and rotated 220°, so much above 7 km puts the corners outside them.',
      table: { category: 'Column' },
    },
    maxError: {
      control: { type: 'range', min: 0.5, max: 20, step: 0.5 },
      description:
        'Simplification error of the shared tessellation, in metres of height.',
      table: { category: 'Column' },
    },
    seal: { control: 'boolean', table: { category: 'Resolve' } },
    sealMode: {
      control: 'inline-radio',
      options: ['proportional', 'void'],
      table: { category: 'Resolve' },
    },
    minThickness: {
      control: { type: 'range', min: 0, max: 50, step: 0.5 },
      description:
        'How much of a neighbouring unit a seal must leave standing, in metres. ⚠️ Keep it above `collapseThreshold`.',
      table: { category: 'Resolve' },
    },
    maxFill: {
      control: { type: 'range', min: 0, max: 3000, step: 25 },
      table: { category: 'Resolve' },
    },
    constrainCoverage: {
      control: 'boolean',
      description:
        'Constrain each layer’s DATA boundary into the shared tessellation, so a triangle is either wholly inside a survey or wholly outside it. ⭐ Off, the boundary is only a per-vertex mask and a triangle spanning it has to go one way or the other — which leaves a bite up to a triangle deep, and a comb of slivers where the edge runs at an angle to the mesh. Costs vertices along every partly-mapped layer’s boundary.',
      table: { category: 'Resolve' },
    },
    coverageAbsence: { control: 'boolean', table: { category: 'Resolve' } },
    collapseThreshold: {
      control: { type: 'range', min: 0, max: 5, step: 0.5 },
      description:
        'Thickness below which a unit counts as absent — what turns the generated pinch-outs into terminations.',
      table: { category: 'Resolve' },
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
      control: 'boolean',
      description:
        'Procedural surface relief, with each unit taking the preset named after its SEDIMENT CLASS. ⭐ That mapping is the story’s, not the library’s — the presets exist, but which unit is sand is host knowledge, exactly like colour. Anchored in world space, so it needs no per-surface repeat/scale and only resolves as the camera comes in.',
      table: { category: 'Appearance' },
    },
    detailStrength: {
      control: { type: 'range', min: 0, max: 3, step: 0.1 },
      description: 'Scales every detail preset. 1 = as designed.',
      table: { category: 'Appearance' },
    },
    inferredStyle: {
      control: 'select',
      options: ['none', 'hatched', 'checker', 'zigzag'],
      description:
        'How the INVENTED part of the block is marked. ⭐ The column’s unconformity records its truncated horizons as NO DATA, so the seal reconstructs them — the marking is what tells that reconstruction apart from the units that were really deposited.',
      table: { category: 'Appearance' },
    },
  },
  decorators: [
    EventEmitterDecorator,
    GlyphsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
};
