import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../hooks/useData';
import { OITRenderPass, Pass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  PlanarPolygonGeometry,
  SurfaceChunkMetrics,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import { SYNTHETIC_PREFIX } from '../../storybook/data/synthetic-surfaces';
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
 * The generated scenarios this story cuts chunks from. Each one exists to make a
 * single coverage question measurable; the demo field can show none of them,
 * because it has exactly one arrangement of holes and one pair of survey extents.
 */
const SCENARIOS = {
  /** control: mapped everywhere, so nothing should ever be dropped or trimmed */
  flat: ['flat'],
  /** interior holes of 0.03, 0.8 and 7 km² — the range `maxFill` has to separate */
  holes: ['holes'],
  /**
   * The same holes with a mapped surface ABOVE them as well as the floor below.
   * ⚠️ `holes` alone cannot show the taper: its surface is the chunk's TOP layer,
   * so there is no neighbour above, no ratio to preserve, and `proportional` falls
   * back to `nearest`.
   */
  holesStacked: ['flat', 'holes'],
  /** the everyday case: the mapped polygon is smaller than the grid rectangle */
  inset: ['inset'],
  /** a pair that agree in shape and disagree about where they exist */
  mismatch: ['mismatchA', 'mismatchB'],
} as const;

type ScenarioName = keyof typeof SCENARIOS;

// Always-on OIT pipeline (SMAA), matching the sibling chunk stories.
const ChunkPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  useFrame(() => { }, 2);
  return <RenderingPipeline passes={passes} />;
};

type SyntheticCoverageProps = {
  scenario: ScenarioName;
  outlineSize: number;
  floorDepth: number;
  maxError: number;
  maxFill: number;
  seal: boolean;
  sealMode: 'proportional' | 'void';
  minThickness: number;
  coverageAbsence: boolean;
  collapseThreshold: number;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  inferredStyle: ChunkInferenceStyle;
};

const PALETTE = ['#4e79a7', '#59a14f', '#edc949'];

const SyntheticCoverageStory = (props: SyntheticCoverageProps) => {
  const store = useData();

  // The metas come from the STORE, not from `/data/surface-meta.json` — generated
  // surfaces only exist inside the store, which is the point: they are ordinary
  // `surface-meta` + `surface-values` entries and the chunk pipeline cannot tell
  // them apart from a fetched survey.
  const ids = useMemo(
    () => SCENARIOS[props.scenario].map(key => SYNTHETIC_PREFIX + key),
    [props.scenario],
  );
  const [column, setColumn] = useState<SurfaceMeta[]>([]);
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    (async () => {
      const metas = await Promise.all(
        ids.map(id => store.get<SurfaceMeta>('surface-meta', id)),
      );
      if (cancelled) return;
      setColumn(metas.filter((m): m is SurfaceMeta => !!m));
    })();
    return () => {
      cancelled = true;
    };
  }, [store, ids]);

  // A plain square crop, well inside the 10 x 10 km grids, so the footprint the
  // chunk is asked for is never the thing that limits it.
  //
  // ⚠️ The grids are ROTATED (220°, like the demo surveys), so an axis-aligned
  // square is only contained in one up to a point: at 9 km the corners already
  // poke outside the grid and the `flat` control reports 0.998 instead of 1.
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

  // A flat floor at an ABSOLUTE depth, so every scenario has a volume (and
  // therefore walls) without a second survey having to agree about where it is.
  // ⚠️ Absolute, NOT an `offset`: an offset floor hangs from the layer above, so
  // sealing that layer would drag the floor with it — and then the third surface is
  // not an independent neighbour at all, which makes the taper impossible to judge.
  const layers = useMemo<ChunkLayer[]>(() => {
    if (column.length === 0) return [];
    return [
      ...column.map((surface, i) => ({
        surface,
        material: PALETTE[i % PALETTE.length],
        fill: PALETTE[i % PALETTE.length],
      })),
      { depth: props.floorDepth, material: '#6b6b6b' },
    ];
  }, [column, props.floorDepth]);

  const resolve = useMemo<ChunkResolveOptions>(
    () => ({
      maxFill: props.maxFill,
      seal: props.seal,
      sealMode: props.sealMode,
      minThickness: props.minThickness,
      coverageAbsence: props.coverageAbsence,
      collapseThreshold: props.collapseThreshold,
    }),
    [
      props.maxFill,
      props.seal,
      props.sealMode,
      props.minThickness,
      props.coverageAbsence,
      props.collapseThreshold,
    ],
  );

  // The calibration readout. `coverage` is what the layer is mapped over,
  // `filled` the part of that bought by bridging a hole — so `coverage` climbing
  // to 1 while `filled` climbs with it means the threshold is now inventing the
  // area rather than finding it.
  const report = useMemo(
    () => (metrics: SurfaceChunkMetrics) => {
      const d = metrics.diagnostics;
      const rows = (d?.layers ?? []).map(l => ({
        index: l.index,
        id: l.id ?? '(synthetic)',
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
          scenario: props.scenario,
          maxFill: props.maxFill,
          triangles: metrics.triangles,
          wallTriangles: metrics.wallTriangles,
          rimDropped: d?.rimDropped ?? null,
          wallRingsDropped: d?.wallRingsDropped ?? null,
          wallRingsOpen: d?.wallRingsOpen ?? null,
          layers: rows,
        })}`,
      );
      console.table(rows);
    },
    [props.scenario, props.maxFill],
  );

  if (layers.length < 2) return null;

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
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
  title: 'Spikes/Chunks/SyntheticCoverage',
  component: SyntheticCoverageStory,
  parameters: {
    // The grids are 10 x 10 km, centred on the scene origin, and the surfaces sit
    // 800-1400 m down — so the camera has to start well outside the block or it
    // opens up inside it.
    scale: 5000,
    cameraPosition: [7000, 4000, 7000],
    cameraTarget: [0, -1100, 0],
    docs: {
      description: {
        component:
          'Chunks cut from GENERATED surfaces, for calibrating how far a layer may be trusted past its own data (`resolve.maxFill`).\n\n' +
          'The demo field has one arrangement of holes and one pair of survey extents, so a threshold tuned against it is tuned to it. These surfaces enter through the store as ordinary `surface-meta` + `surface-values`, with the same `-1` nodata sentinel and normalized encoding as a real survey, so the pipeline cannot tell them apart.\n\n' +
          '`holes` carries interior holes of **0.03, 0.8 and 7 km²** — three orders of magnitude, which is what real data spans. A single threshold has to bridge the small one and refuse the large one; watch `coverage` and `filled` per layer as `maxFill` is raised, and note that everything counted as `filled` is a plausible extrapolation rather than knowledge.\n\n' +
          '`inset` is the everyday case (the mapped polygon is smaller than the grid rectangle) and `mismatch` a pair that disagree about where they exist.',
      },
    },
  },
} satisfies Meta<typeof SyntheticCoverageStory>;

export default meta;
type Story = StoryObj<typeof SyntheticCoverageStory>;

export const Default: Story = {
  args: {
    scenario: 'holes',
    outlineSize: 7,
    floorDepth: 2000,
    maxError: 5,
    maxFill: 250,
    seal: true,
    sealMode: 'proportional',
    minThickness: 1,
    coverageAbsence: true,
    collapseThreshold: 0.5,
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    inferredStyle: 'hatched',
  },
  argTypes: {
    scenario: {
      control: 'select',
      options: Object.keys(SCENARIOS),
      description:
        'Which generated surfaces to stack. `flat` is the control (mapped everywhere), `holes` the calibration case, `inset` a mapped polygon inside the grid, `mismatch` a pair with different extents.',
      table: { category: 'Scenario' },
    },
    outlineSize: {
      control: { type: 'range', min: 1, max: 10, step: 0.5 },
      description:
        'Side of the square crop, in km. The grids are 10 km across and rotated 220°, so a square much above 7 km has corners outside them — which the `flat` control will report as missing coverage.',
      table: { category: 'Scenario' },
    },
    floorDepth: {
      control: { type: 'range', min: 1600, max: 3000, step: 50 },
      description:
        'A flat floor at this absolute depth (metres, positive down), so the block has a volume and walls. Absolute rather than an offset, so it stays an INDEPENDENT neighbour when the surfaces above it are sealed.',
      table: { category: 'Scenario' },
    },
    maxError: {
      control: { type: 'range', min: 0.5, max: 20, step: 0.5 },
      description:
        'Simplification error of the shared tessellation, in metres of height. It also sets how coarse the mesh is in FLAT areas, which is what bounds the staircase along a data edge — lower it to see the bevel at a coverage boundary shrink (at a cost in triangles).',
      table: { category: 'Scenario' },
    },
    maxFill: {
      control: { type: 'range', min: 0, max: 3000, step: 25 },
      description:
        'How far a layer counts as covered past its own data, in metres. 0 = only real data counts. It works as an erosion radius: a hole of radius r vanishes at maxFill = r, and a bigger one just loses a rim that wide.',
      table: { category: 'Coverage' },
    },
    seal: {
      control: 'boolean',
      description:
        'Close the block where a surface is not mapped, by tapering it toward its neighbours. Off, every interval bounded by an unmapped surface simply vanishes and the block is left open.',
      table: { category: 'Coverage' },
    },
    sealMode: {
      control: 'inline-radio',
      options: ['proportional', 'void'],
      description:
        'How the space an unmapped surface cannot account for is closed. `proportional` keeps the relative depth it had where it was last mapped, so both units survive — “this horizon is here somewhere”. `void` splits it in two and draws NOTHING between — “the units are not defined here”, the only one that cannot be mistaken for data.',
      table: { category: 'Coverage' },
    },
    minThickness: {
      control: { type: 'range', min: 0, max: 50, step: 0.5 },
      description:
        'How much of a neighbouring unit a seal must leave standing, in metres — the only setting the shape of a seal has (how far it reaches is derived from the gap it closes, measured inside this chunk). ⚠️ Below `collapseThreshold` the sliver it leaves is dropped for having no thickness and the hole comes back.',
      table: { category: 'Coverage' },
    },
    coverageAbsence: {
      control: 'boolean',
      description:
        'Drop triangles where a layer has no coverage of its own. Off, the hole fill is drawn as if it were geology — and is marked as inferred, since that is exactly what it is.',
      table: { category: 'Coverage' },
    },
    collapseThreshold: {
      control: { type: 'range', min: 0, max: 5, step: 0.5 },
      description: 'Thickness below which a unit counts as absent, in metres.',
      table: { category: 'Coverage' },
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
        'How the INVENTED part of the block is marked — what the seal built where no surface was mapped. A pattern drawn OVER the unit, never a colour: a recoloured region cannot be told apart from a unit that simply has a different colour. Raise `maxFill` or turn `seal` off and watch it go.',
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
