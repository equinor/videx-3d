import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useGenerator } from '../../../hooks/useGenerator';
import { OITRenderPass, Pass, RenderPass } from '../../../main';
import { OutputPass } from '../../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../../rendering/RenderingPipeline';
import {
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonGeometry,
  SurfaceChunk,
  SurfaceMeta,
  unpackSurfaceChunk,
  Vec2,
} from '../../../sdk';
import { parseGeoJsonFeature } from '../../../sdk/utils/geojson';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../../storybook/decorators/glyphs-decorator';
import { OutputPanelDecorator } from '../../../storybook/decorators/output-panel-decorator';
import { get } from '../../../storybook/dependencies/api';
import {
  distinctByName,
  useSurfaceMetaDict,
} from '../../../storybook/hooks/useSurfaceMeta';
import storyArgs from '../../../storybook/story-args.json';
import {
  useOutputPanel,
  useOutputPanelState,
} from '../../Html/OutputPanel/output-panel-state';
import { UtmArea, UtmAreaContext } from '../../UtmArea';
import { buildSurfaceChunkSpec } from '../chunk-spec';
import { ChunkMeshes } from '../ChunkMeshes';
import {
  surfaceChunkDebug,
  SurfaceChunkDebugResponse,
} from './surface-chunk-debug-generator';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');
const toSceneXZ = (pos: Vec2): Vec2 => {
  const c = crs.wgs84ToWorld(pos[0], pos[1]);
  return [c.x, c.z];
};

const PALETTE = [
  '#4e79a7',
  '#f28e2c',
  '#59a14f',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
  '#edc949',
  '#9c755f',
];

/** Split a sorted meta list into contiguous groups from a comma-separated string. */
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
  if (i < metas.length) groups.push(metas.slice(i));
  return groups;
}

function disposeChunk(chunk: SurfaceChunk | null) {
  if (!chunk) return;
  chunk.groups.forEach(g => {
    g.surfaces.forEach(s => s.geometry.dispose());
    g.walls.forEach(w => w.geometry.dispose());
  });
  chunk.basement?.surfaces.forEach(s => s.geometry.dispose());
  chunk.basement?.walls.forEach(w => w.geometry.dispose());
}

const ms = (v: number) => `${v.toFixed(0)} ms`;

// Always-on OIT pipeline (matches the Chunk spike story).
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

type ProbeProps = {
  metas: SurfaceMeta[];
  polygon: PlanarPolygonGeometry | null;
  surfaceCount: number;
  groupSizes: string;
  rimSpacing: number;
  maxError: number;
  depthOrder: boolean;
  depthOrderGap: number;
  runToken: number;
};

/** Builds one chunk via the debug worker generator and reports the timing split. */
const BottleneckProbe = ({
  metas,
  polygon,
  surfaceCount,
  groupSizes,
  rimSpacing,
  maxError,
  depthOrder,
  depthOrderGap,
  runToken,
}: ProbeProps) => {
  const utm = useContext(UtmAreaContext);
  const generator = useGenerator<SurfaceChunkDebugResponse>(surfaceChunkDebug);
  const outputPanel = useOutputPanel();
  // useOutputPanel() returns a fresh object every render; keep a stable ref so the
  // effects below don't re-run (which would reset the panel / re-invoke the build).
  // All panel API versions mutate the same global store, so staleness is harmless.
  const outputPanelRef = useRef(outputPanel);
  useEffect(() => {
    outputPanelRef.current = outputPanel;
  }, [outputPanel]);
  const [chunk, setChunk] = useState<SurfaceChunk | null>(null);

  useEffect(() => {
    const panel = outputPanelRef.current;
    panel.add('bottleneck', {
      label: 'Chunk build bottleneck',
      value: '…',
      color: '#8ad',
      details: {
        surfaces: { label: 'surfaces', value: '-' },
        triangles: { label: 'triangles', value: '-' },
        pool: { label: 'clip workers', value: '-' },
        mb: { label: 'grid MB fetched', value: '-' },
        fetch: { label: 'fetch (worker, overlapped)', value: '-' },
        depthOrder: { label: 'depth order', value: '-' },
        build: { label: 'clip (parallel, overlapped)', value: '-' },
        densify: { label: '· densify', value: '-' },
        clip: { label: '· clip', value: '-' },
        rim: { label: '· rim', value: '-' },
        walls: { label: '· walls', value: '-' },
        basement: { label: '· basement', value: '-' },
        pack: { label: 'pack (worker)', value: '-' },
        transfer: { label: 'transfer + queue', value: '-' },
        unpack: { label: 'unpack (main)', value: '-' },
        end: { label: 'END-TO-END', value: '-' },
      },
    });
    return () => panel.remove('bottleneck');
  }, []);

  useEffect(() => {
    if (!utm || !polygon || metas.length === 0) return;
    const selected = metas.slice(0, Math.max(1, surfaceCount));
    const groups = splitIntoGroups(selected, groupSizes);
    const spec = buildSurfaceChunkSpec(
      groups,
      utm.utmToArea,
      PALETTE,
      polygon,
      {
        rimSpacing,
        maxError,
        depthOrder: depthOrder
          ? { minGap: depthOrderGap || undefined }
          : undefined,
      },
    );

    let cancelled = false;
    const tInvoke = performance.now();
    generator(spec)
      .then(response => {
        if (cancelled || !response) return;
        const tResolve = performance.now();
        const unpacked = unpackSurfaceChunk(response);
        const tUnpack = performance.now();

        const { debug, metrics } = response;
        const endToEnd = tUnpack - tInvoke;
        const roundTrip = tResolve - tInvoke;
        const transferMs = Math.max(0, roundTrip - debug.totalWorkerMs);
        const unpackMs = tUnpack - tResolve;

        const details = {
          surfaces: metrics.layers,
          triangles: metrics.triangles.toLocaleString(),
          pool: debug.poolSize || 'serial',
          mb: (debug.bytes / 1e6).toFixed(1),
          fetch: ms(debug.fetchMs),
          depthOrder: ms(debug.depthOrderMs),
          build: ms(debug.buildMs),
          densify: ms(metrics.densifyMs),
          clip: ms(metrics.clipMs),
          rim: ms(metrics.rimMs),
          walls: ms(metrics.wallsMs),
          basement: ms(metrics.basementMs),
          pack: ms(debug.packMs),
          transfer: ms(transferMs),
          unpack: ms(unpackMs),
          end: ms(endToEnd),
        };
        outputPanelRef.current.update('bottleneck', ms(endToEnd), details);
        console.table(details);

        // Per-surface clip profile (slowest first) to identify the offenders.
        if (debug.profile) {
          const rows = [...debug.profile]
            .sort((a, b) => b.clipMs - a.clipMs)
            .map(p => ({
              surface: surfaceOptions[p.id] ?? p.id,
              clipMs: Math.round(p.clipMs),
              holes: p.holes,
              'hole%':
                p.nodes > 0
                  ? `${((p.holes / p.nodes) * 100).toFixed(1)}%`
                  : '-',
              nodes: p.nodes,
              tris: p.tris,
            }));
          console.table(rows);
        }

        setChunk(unpacked);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[ChunkBottleneck] generator failed:', err);
        outputPanelRef.current.update('bottleneck', `ERROR: ${String(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    utm,
    polygon,
    metas,
    surfaceCount,
    groupSizes,
    rimSpacing,
    maxError,
    depthOrder,
    depthOrderGap,
    runToken,
    generator,
  ]);

  const prev = useRef<SurfaceChunk | null>(null);
  useEffect(() => {
    if (prev.current && prev.current !== chunk) disposeChunk(prev.current);
    prev.current = chunk;
    return () => disposeChunk(prev.current);
  }, [chunk]);

  if (!chunk) return null;
  return <ChunkMeshes chunk={chunk} />;
};

type StoryProps = {
  surfaceCount: number;
  groupSizes: string;
  rimSpacing: number;
  maxError: number;
  depthOrder: boolean;
  depthOrderGap: number;
};

const Story = (props: StoryProps) => {
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
      distinctByName(
        Object.keys(surfaceOptions)
          .map(id => surfaceMetaDict[id])
          .filter((m): m is SurfaceMeta => !!m)
          .sort((a, b) => a.max - b.max),
      ),
    [surfaceMetaDict],
  );

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <BottleneckProbe
          metas={metas}
          polygon={polygon}
          surfaceCount={props.surfaceCount}
          groupSizes={props.groupSizes}
          rimSpacing={props.rimSpacing}
          maxError={props.maxError}
          depthOrder={props.depthOrder}
          depthOrderGap={props.depthOrderGap}
          runToken={0}
        />
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'debug/Chunk Bottleneck',
  component: Story,
} satisfies Meta<typeof Story>;

export default meta;
type StoryObject = StoryObj<typeof Story>;

export const Default: StoryObject = {
  loaders: [async () => useOutputPanelState.setState({ groups: {} })],
  args: {
    surfaceCount: 37,
    groupSizes: '',
    rimSpacing: 250,
    maxError: 5,
    depthOrder: false,
    depthOrderGap: 0,
  },
  argTypes: {
    surfaceCount: {
      control: { type: 'range', min: 1, max: 37, step: 1 },
      description:
        'How many of the loaded depth surfaces to build into the chunk.',
    },
    groupSizes: {
      control: { type: 'text' },
      description: 'Comma-separated group sizes (empty = one group of all).',
    },
    rimSpacing: { control: { type: 'range', min: 25, max: 1000, step: 25 } },
    maxError: { control: { type: 'range', min: 0, max: 50, step: 1 } },
    depthOrder: { control: 'boolean' },
    depthOrderGap: { control: { type: 'range', min: 0, max: 50, step: 1 } },
  },
  decorators: [
    EventEmitterDecorator,
    GlyphsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    OutputPanelDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
};
