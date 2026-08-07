import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
} from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { OITRenderPass, Pass } from '../../../main';
import { OutputPass } from '../../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../../rendering/RenderingPipeline';
import {
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  StackResolveOptions,
  SurfaceChunk,
  SurfaceMeta,
  unpackSurfaceChunk,
  Vec2,
} from '../../../sdk';
import { parseGeoJsonFeature } from '../../../sdk/utils/geojson';
import { stratAge } from '../../../storybook/data/strat-ages';
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
import { ChunkResolveOptions } from '../chunk-defs';
import { buildSurfaceChunkSpec } from '../chunk-spec';
import { ChunkMeshes } from '../ChunkMeshes';
import { ChunkStack } from '../ChunkStack';
import {
  surfaceSection,
  SurfaceSectionResponse,
  SurfaceSectionSpec,
} from './surface-section-generator';
import {
  surfaceStackDebug,
  SurfaceStackDebugResponse,
} from './surface-stack-debug-generator';

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

/** Split a flat meta list into contiguous groups from a comma-separated string. */
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

/** Short display name for a surface id. */
const nameOf = (id: string) => surfaceOptions[id] ?? id;

const m = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} m` : 'n/a');

const ms = (v: number) => `${v.toFixed(0)} ms`;

/** Row labels for the shared-tessellation readout. */
const STACK_LABELS: Record<string, string> = {
  layers: 'layers',
  reference: 'reference grid',
  vertices: 'shared vertices',
  trisPerLayer: 'triangles / layer',
  trisKept: 'triangles kept',
  trisAbsent: '· dropped (absent)',
  trisCollapsed: '· dropped (no thickness)',
  ordering: 'ordering',
  depthOrder: 'depth order',
  crossings: 'crossing vertices',
  crossingsCovered: '· where both have data',
  maxOverlap: 'max overlap',
  moved: 'vertices moved',
  fetch: 'fetch',
  reference2: 'resample',
  refine: 'refine (parallel)',
  tessellate: 'tessellate',
  sample: 'sample heights',
  resolve: 'resolve order',
  collapse: 'collapse',
  geometry: 'geometries',
  assemble: 'walls + assemble',
  pack: 'pack',
  end: 'END-TO-END',
};

/** Dispose every geometry a built chunk owns. */
function disposeChunk(chunk: SurfaceChunk | null) {
  if (!chunk) return;
  chunk.groups.forEach(group => {
    group.surfaces.forEach(s => s.geometry.dispose());
    group.walls.forEach(w => w.geometry.dispose());
  });
  chunk.basement?.surfaces.forEach(s => s.geometry.dispose());
  chunk.basement?.walls.forEach(w => w.geometry.dispose());
}

// Always-on OIT pipeline (matches the other chunk stories).
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
type SectionProps = {
  metas: SurfaceMeta[];
  polygon: PlanarPolygonGeometry | null;
  from: Vec2;
  to: Vec2;
  samples: number;
  probeResolution: number;
  resolve: StackResolveOptions | undefined;
  exaggeration: number;
  showBefore: boolean;
  showAfter: boolean;
  showFrame: boolean;
  onTop: boolean;
};

/**
 * Samples the same stack the chunk builds along a vertical cut line — before and
 * after the depth-order pass — and draws it as a fence of profile lines: dashed
 * and dimmed for the raw surfaces, solid for the corrected ones. Where two dashed
 * lines cross (or run together) is exactly where the chunk interpenetrates or
 * z-fights; the solid lines show how the pass resolves it.
 */
const SectionFence = ({
  metas,
  polygon,
  from,
  to,
  samples,
  probeResolution,
  resolve,
  exaggeration,
  showBefore,
  showAfter,
  showFrame,
  onTop,
}: SectionProps) => {
  const utm = useContext(UtmAreaContext);
  const generator = useGenerator<SurfaceSectionResponse>(surfaceSection);
  const outputPanel = useOutputPanel();
  // useOutputPanel() returns a fresh object every render; keep a stable ref so the
  // effects below don't re-run. All API versions mutate the same global store.
  const outputPanelRef = useRef(outputPanel);
  useEffect(() => {
    outputPanelRef.current = outputPanel;
  }, [outputPanel]);
  const [result, setResult] = useState<SurfaceSectionResponse | null>(null);

  const spec = useMemo<SurfaceSectionSpec | null>(() => {
    if (!utm || !polygon || metas.length === 0) return null;
    return {
      layers: metas.map(meta => {
        const p = utm.utmToArea(meta.header.xori, meta.header.yori, 0);
        return {
          id: meta.id,
          header: {
            nx: meta.header.nx,
            ny: meta.header.ny,
            xinc: meta.header.xinc,
            yinc: meta.header.yinc,
            rot: meta.header.rot,
          },
          referenceDepth: meta.max,
          worldPosition: [p[0], p[2]] as Vec2,
        };
      }),
      polygon: {
        coordinates: polygon.coordinates as PlanarPolygonCoordinates,
        offset: polygon.offset,
      },
      section: { from, to, samples },
      probeResolution,
      resolve,
    };
  }, [utm, polygon, metas, from, to, samples, probeResolution, resolve]);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    (async () => {
      const response = await generator(spec);
      if (cancelled) return;
      setResult(response ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, generator]);

  // --- Crossing report -------------------------------------------------------
  useEffect(() => {
    const panel = outputPanelRef.current;
    if (!result) return;
    const details: Record<string, { label: string; value: string }> = {
      probes: {
        label: 'probe points',
        value: result.probePoints.toLocaleString(),
      },
    };
    let crossingPairs = 0;
    let coincidentPairs = 0;
    result.stats.forEach(s => {
      const crossPct = s.compared ? (s.crossings / s.compared) * 100 : 0;
      const coincPct = s.compared ? (s.coincident / s.compared) * 100 : 0;
      if (s.crossings > 0) crossingPairs++;
      if (s.coincident > 0) coincidentPairs++;
      if (crossPct < 0.01 && coincPct < 0.01) return;
      const after = resolve
        ? ` → ${((s.crossingsAfter / Math.max(1, s.compared)) * 100).toFixed(1)}% / ${((s.coincidentAfter / Math.max(1, s.compared)) * 100).toFixed(1)}%`
        : '';
      details[`pair-${s.index}`] = {
        label: `${s.index}. ${nameOf(s.id)}`,
        value: `${crossPct.toFixed(1)}% cross / ${coincPct.toFixed(1)}% coincident${after}`,
      };
    });
    panel.remove('crossings');
    panel.add('crossings', {
      label: 'Surface crossings',
      value: `${crossingPairs} crossing / ${coincidentPairs} coincident pairs`,
      color: '#8ad',
      details,
    });

    console.table(
      result.stats.map(s => ({
        surface: `${s.index}. ${nameOf(s.id)}`,
        'cross%': s.compared
          ? `${((s.crossings / s.compared) * 100).toFixed(2)}%`
          : '-',
        'coincident%': s.compared
          ? `${((s.coincident / s.compared) * 100).toFixed(2)}%`
          : '-',
        maxOverlap: m(s.maxOverlap),
        minSeparation: m(s.minSeparation),
        'cross% after': s.compared
          ? `${((s.crossingsAfter / s.compared) * 100).toFixed(2)}%`
          : '-',
        'coincident% after': s.compared
          ? `${((s.coincidentAfter / s.compared) * 100).toFixed(2)}%`
          : '-',
        'minSeparation after': m(s.minSeparationAfter),
        clampedNodes: s.clampedNodes,
      })),
    );
    return () => panel.remove('crossings');
  }, [result, resolve]);

  // --- The fence -------------------------------------------------------------
  const fence = useMemo(() => {
    if (!result) return null;
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];

    // Exaggerate around the stack's mean depth so the section stays in place while
    // small separations become visible.
    let sum = 0;
    let count = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ys of result.after) {
      for (const y of ys) {
        if (!Number.isFinite(y)) continue;
        sum += y;
        count++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (count === 0) return null;
    const pivot = sum / count;
    const mapY = (y: number) => pivot + (y - pivot) * exaggeration;

    const group = new Group();
    group.renderOrder = 999;

    const addProfile = (ys: Float32Array, color: Color, dashed: boolean) => {
      const n = ys.length;
      const positions: number[] = [];
      for (let i = 1; i < n; i++) {
        const y0 = ys[i - 1];
        const y1 = ys[i];
        if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
        const t0 = (i - 1) / (n - 1);
        const t1 = i / (n - 1);
        positions.push(
          from[0] + dx * t0,
          mapY(y0),
          from[1] + dz * t0,
          from[0] + dx * t1,
          mapY(y1),
          from[1] + dz * t1,
        );
      }
      if (positions.length === 0) return;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(positions, 3),
      );
      const material = dashed
        ? new LineDashedMaterial({
          color,
          dashSize: result.length / 120,
          gapSize: result.length / 160,
          depthTest: !onTop,
          toneMapped: false,
        })
        : new LineBasicMaterial({
          color,
          depthTest: !onTop,
          toneMapped: false,
        });
      const line = new LineSegments(geometry, material);
      if (dashed) line.computeLineDistances();
      line.renderOrder = 999;
      group.add(line);
    };

    result.ids.forEach((_, i) => {
      const color = new Color(PALETTE[i % PALETTE.length]);
      if (showBefore) {
        // Dimmed + dashed = the raw stack, as the chunk would be built without
        // the depth-order pass.
        addProfile(result.before[i], color.clone().multiplyScalar(0.45), true);
      }
      if (showAfter) addProfile(result.after[i], color, false);
    });

    if (showFrame) {
      const y0 = mapY(minY);
      const y1 = mapY(maxY);
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(
          [
            from[0],
            y0,
            from[1],
            to[0],
            y0,
            to[1],
            to[0],
            y1,
            to[1],
            from[0],
            y1,
            from[1],
          ],
          3,
        ),
      );
      const frame = new Line(
        geometry,
        new LineBasicMaterial({
          color: '#666',
          depthTest: !onTop,
          toneMapped: false,
        }),
      );
      frame.renderOrder = 999;
      group.add(frame);
    }

    return group;
  }, [result, from, to, exaggeration, showBefore, showAfter, showFrame, onTop]);

  useEffect(() => {
    if (!fence) return;
    return () => {
      fence.traverse(o => {
        const line = o as LineSegments;
        line.geometry?.dispose();
        (line.material as LineBasicMaterial)?.dispose();
      });
    };
  }, [fence]);

  if (!fence) return null;
  return <primitive object={fence} />;
};

type StoryProps = {
  sortKey: 'age' | 'depth-midpoint';
  surfaceFrom: number;
  surfaceCount: number;
  groupSizes: string;
  resolve: boolean;
  resolveMode: 'clamp' | 'truncate';
  minGap: number;
  collapseThreshold: number;
  coverageAbsence: boolean;
  autoOrder: boolean;
  showSection: boolean;
  sectionAngle: number;
  sectionOffset: number;
  sectionSamples: number;
  sectionExaggeration: number;
  showBefore: boolean;
  showAfter: boolean;
  sectionOnTop: boolean;
  probeResolution: number;
  showChunk: boolean;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  showWalls: boolean;
};

type SharedChunkProps = {
  groups: SurfaceMeta[][];
  polygon: PlanarPolygonGeometry | null;
  resolve: ChunkResolveOptions | undefined;
  autoOrder: boolean;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  showWalls: boolean;
};

/**
 * The chunk built through the same generator `Chunk` uses, wrapped so the harness
 * also gets the geometry budget, the ordering diagnostics and the phase timings.
 */
const SharedStackChunk = ({
  groups,
  polygon,
  resolve,
  autoOrder,
  surfaceOpacity,
  wallOpacity,
  wireframe,
  showWalls,
}: SharedChunkProps) => {
  const utm = useContext(UtmAreaContext);
  const generator = useGenerator<SurfaceStackDebugResponse>(surfaceStackDebug);
  const outputPanel = useOutputPanel();
  const outputPanelRef = useRef(outputPanel);
  useEffect(() => {
    outputPanelRef.current = outputPanel;
  }, [outputPanel]);
  const [chunk, setChunk] = useState<SurfaceChunk | null>(null);

  const spec = useMemo(() => {
    if (!utm || !polygon || groups.length === 0) return null;
    return {
      ...buildSurfaceChunkSpec(groups, utm.utmToArea, PALETTE, polygon, {
        resolve,
      }),
      autoOrder,
    };
  }, [utm, polygon, groups, resolve, autoOrder]);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    const tInvoke = performance.now();
    (async () => {
      const response = await generator(spec);
      if (cancelled || !response) return;
      const unpacked = unpackSurfaceChunk(response);
      const endToEnd = performance.now() - tInvoke;
      const { debug } = response;
      const panel = outputPanelRef.current;
      const details = {
        layers: debug.layers,
        reference: `${debug.referenceNodes.toLocaleString()} nodes (step ${debug.referenceStep})`,
        vertices: debug.vertices.toLocaleString(),
        trisPerLayer: debug.trianglesPerLayer.toLocaleString(),
        trisKept: debug.trianglesKept.toLocaleString(),
        trisAbsent: debug.trianglesAbsent.toLocaleString(),
        trisCollapsed: debug.trianglesCollapsed.toLocaleString(),
        ordering: debug.reordered ? 'auto (measured depth)' : 'as given',
        depthOrder: debug.applied
          ? `applied (gap ${resolve?.minGap ?? 0} m)`
          : 'measured only',
        crossings: debug.crossings.toLocaleString(),
        crossingsCovered: debug.crossingsCovered.toLocaleString(),
        maxOverlap: `${debug.maxOverlap.toFixed(1)} m`,
        moved: debug.moved.toLocaleString(),
        fetch: ms(debug.fetchMs),
        reference2: ms(debug.referenceMs),
        refine: `${ms(debug.refineMs)} (${debug.poolSize || 'serial'})`,
        tessellate: ms(debug.tessellateMs),
        sample: ms(debug.sampleMs),
        resolve: ms(debug.resolveMs),
        collapse: ms(debug.collapseMs),
        geometry: ms(debug.geometryMs),
        assemble: ms(debug.assembleMs),
        pack: ms(debug.packMs),
        end: ms(endToEnd),
      };
      panel.remove('stack');
      panel.add('stack', {
        label: 'Shared tessellation',
        value: ms(endToEnd),
        color: '#8ad',
        details: Object.fromEntries(
          Object.entries(details).map(([key, value]) => [
            key,
            { label: STACK_LABELS[key] ?? key, value },
          ]),
        ),
      });
      console.table(details);
      // Per-layer ordering: `inverted%` near 50%+ means that pair is very likely
      // in the wrong order rather than genuinely crossing. `duplicate%` near 100%
      // means the surface is the same horizon as the one above it.
      console.table(
        debug.order.map(row => ({
          '#': row.index,
          surface: surfaceOptions[row.id] ?? row.id,
          age: stratAge(surfaceOptions[row.id]) ?? '-',
          medianDepth: `${(-row.medianY).toFixed(0)} m`,
          'inverted%': `${(row.invertedFraction * 100).toFixed(1)}%`,
          'inverted%(data)': `${(row.invertedCoveredFraction * 100).toFixed(1)}%`,
          'duplicate%': `${(row.duplicateFraction * 100).toFixed(1)}%`,
          'noData%': `${(row.missingFraction * 100).toFixed(1)}%`,
          droppedAbsent: row.droppedAbsent,
          droppedThin: row.droppedCollapsed,
        })),
      );
      setChunk(unpacked);
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, generator, resolve]);

  const previous = useRef<SurfaceChunk | null>(null);
  useEffect(() => {
    if (previous.current && previous.current !== chunk) {
      disposeChunk(previous.current);
    }
    previous.current = chunk;
    return () => disposeChunk(previous.current);
  }, [chunk]);

  useEffect(() => () => outputPanelRef.current.remove('stack'), []);

  if (!chunk) return null;
  return (
    <ChunkMeshes
      chunk={chunk}
      surfaceOpacity={surfaceOpacity}
      wallOpacity={wallOpacity}
      wireframe={wireframe}
      showWalls={showWalls}
    />
  );
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

  const allMetas = useMemo<SurfaceMeta[]>(() => {
    const metas = distinctByName(
      Object.keys(surfaceOptions)
        .map(id => surfaceMetaDict[id])
        .filter((m): m is SurfaceMeta => !!m),
    );
    // Midpoint depth, NOT `meta.max`: the deepest sample of a surface says little
    // about where it sits in the stack, and sorting by it scrambles the deep
    // section.
    const midpoint = (m: SurfaceMeta) => (m.min + m.max) / 2;
    if (props.sortKey === 'depth-midpoint') {
      return metas.sort((a, b) => midpoint(a) - midpoint(b));
    }
    // Stratigraphic age is the only ordering key that is right by construction —
    // depth is a consequence of the geology, not a definition of it. A surface the
    // extract has no age for is EXCLUDED rather than guessed at: placing it by
    // depth means falling back on exactly the key we know misorders this stack
    // (interpolating them by depth midpoint put three shallow surfaces at the
    // bottom and took the crossings from 19k to 183k).
    const missing = metas.filter(m => stratAge(m.name) === undefined);
    if (missing.length > 0) {
      console.warn(
        '[ChunkDepthOrder] no strat age, EXCLUDED from the stack:',
        missing.map(m => m.name),
      );
    }
    return metas
      .filter(m => stratAge(m.name) !== undefined)
      .sort((a, b) => stratAge(a.name)! - stratAge(b.name)!);
  }, [surfaceMetaDict, props.sortKey]);

  // The depth window under investigation — defaults to the deepest surfaces,
  // where the z-fighting shows up.
  const metas = useMemo(() => {
    const start = Math.min(props.surfaceFrom, Math.max(0, allMetas.length - 1));
    return allMetas.slice(start, start + Math.max(1, props.surfaceCount));
  }, [allMetas, props.surfaceFrom, props.surfaceCount]);

  const groups = useMemo(
    () => splitIntoGroups(metas, props.groupSizes),
    [metas, props.groupSizes],
  );

  // Memoized so a stable identity reaches the build (a new object rebuilds the
  // geometry) and the section probe runs the exact same rule.
  const resolve = useMemo<ChunkResolveOptions | undefined>(
    () =>
      props.resolve
        ? {
          mode: props.resolveMode,
          minGap: props.minGap || undefined,
          collapseThreshold: props.collapseThreshold,
          coverageAbsence: props.coverageAbsence,
        }
        : undefined,
    [
      props.resolve,
      props.resolveMode,
      props.minGap,
      props.collapseThreshold,
      props.coverageAbsence,
    ],
  );

  // The cut line: through the outline's centre at `sectionAngle`, shifted
  // sideways by `sectionOffset`, long enough to span the whole footprint.
  const section = useMemo(() => {
    if (!polygon) return null;
    const { min, max } = polygon.getBounds();
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[1] + max[1]) / 2;
    const half = Math.hypot(max[0] - min[0], max[1] - min[1]) / 2;
    const a = (props.sectionAngle * Math.PI) / 180;
    const dir: Vec2 = [Math.cos(a), Math.sin(a)];
    const ox = cx - dir[1] * props.sectionOffset * half;
    const oz = cz + dir[0] * props.sectionOffset * half;
    return {
      from: [ox - dir[0] * half, oz - dir[1] * half] as Vec2,
      to: [ox + dir[0] * half, oz + dir[1] * half] as Vec2,
    };
  }, [polygon, props.sectionAngle, props.sectionOffset]);

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <ChunkStack outline={polygon}>
          {props.showChunk && (
            <SharedStackChunk
              groups={groups}
              polygon={polygon}
              resolve={resolve}
              autoOrder={props.autoOrder}
              surfaceOpacity={props.surfaceOpacity}
              wallOpacity={props.wallOpacity}
              wireframe={props.wireframe}
              showWalls={props.showWalls}
            />
          )}
        </ChunkStack>
        {props.showSection && section && (
          <SectionFence
            metas={metas}
            polygon={polygon}
            from={section.from}
            to={section.to}
            samples={props.sectionSamples}
            probeResolution={props.probeResolution}
            resolve={resolve}
            exaggeration={props.sectionExaggeration}
            showBefore={props.showBefore}
            showAfter={props.showAfter}
            showFrame
            onTop={props.sectionOnTop}
          />
        )}
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'debug/Chunk Depth Order',
  component: Story,
} satisfies Meta<typeof Story>;

export default meta;
type StoryObject = StoryObj<typeof Story>;

export const Default: StoryObject = {
  loaders: [async () => useOutputPanelState.setState({ groups: {} })],
  args: {
    // Surfaces
    sortKey: 'age',
    surfaceFrom: 25,
    surfaceCount: 10,
    groupSizes: '',
    // Resolve
    resolve: true,
    resolveMode: 'truncate',
    minGap: 0,
    collapseThreshold: 0.5,
    coverageAbsence: true,
    autoOrder: false,
    // Section
    showSection: true,
    sectionAngle: 0,
    sectionOffset: 0,
    sectionSamples: 400,
    sectionExaggeration: 1,
    showBefore: true,
    showAfter: true,
    sectionOnTop: true,
    probeResolution: 96,
    // Appearance
    showChunk: true,
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    showWalls: true,
  },
  argTypes: {
    sortKey: {
      control: { type: 'inline-radio' },
      options: ['age', 'depth-midpoint'],
      description:
        'How the stack is ordered before it is handed to the chunk. `age` uses a TEMPORARY strat-column extract (see strat-ages.debug.ts) — the only key that is right by construction. `depth-midpoint` uses (meta.min + meta.max) / 2. Use `autoOrder` (Resolve) to cross-check either against the depth MEASURED inside the footprint.',
      table: { category: 'Surfaces' },
    },
    surfaceFrom: {
      control: { type: 'range', min: 0, max: 36, step: 1 },
      description: 'First surface of the depth window.',
      table: { category: 'Surfaces' },
    },
    surfaceCount: {
      control: { type: 'range', min: 2, max: 20, step: 1 },
      description: 'How many surfaces the window contains.',
      table: { category: 'Surfaces' },
    },
    groupSizes: {
      control: { type: 'text' },
      description: 'Comma-separated group sizes (empty = one group of all).',
      table: { category: 'Surfaces' },
    },
    resolve: {
      control: 'boolean',
      description:
        'Make the stack monotone on the shared tessellation. Off = the surfaces are drawn exactly as the data has them (crossings included) and the panel only MEASURES them.',
      table: { category: 'Resolve' },
    },
    resolveMode: {
      control: { type: 'inline-radio' },
      options: ['clamp', 'truncate'],
      description:
        'Both clamp the height (so the block stays sealed), but truncate also MARKS the unit absent where it was cut away, so the welded duplicate is dropped instead of drawn.',
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
        'Thickness below which a unit counts as absent and its triangles are dropped — the coincident duplicates a clamp leaves behind are the last source of z-fighting. 0 disables.',
      table: { category: 'Resolve' },
    },
    coverageAbsence: {
      control: 'boolean',
      description:
        'Drop triangles where a layer has no data of its own, rather than letting the nearest-value fill stand in for it. A surface mapped over a smaller area than the chunk is ABSENT out there, not flat.',
      table: { category: 'Resolve' },
    },
    autoOrder: {
      control: 'boolean',
      description:
        'CROSS-CHECK: re-sort the layers by their MEASURED median depth inside the footprint instead of the order given. If the crossings collapse when this is on, the ordering key is wrong, not the data.',
      table: { category: 'Resolve' },
    },
    showSection: { control: 'boolean', table: { category: 'Section' } },
    sectionAngle: {
      control: { type: 'range', min: 0, max: 180, step: 1 },
      description: 'Heading of the cut line through the outline centre.',
      table: { category: 'Section' },
    },
    sectionOffset: {
      control: { type: 'range', min: -1, max: 1, step: 0.02 },
      description: 'Sideways shift of the cut line.',
      table: { category: 'Section' },
    },
    sectionSamples: {
      control: { type: 'range', min: 50, max: 2000, step: 50 },
      table: { category: 'Section' },
    },
    sectionExaggeration: {
      control: { type: 'range', min: 1, max: 100, step: 1 },
      description:
        'Vertical exaggeration of the fence only (the meshes are unaffected) — needed to see metre-scale separations at field scale.',
      table: { category: 'Section' },
    },
    showBefore: {
      control: 'boolean',
      description: 'Dashed, dimmed profiles: the raw surfaces.',
      table: { category: 'Section' },
    },
    showAfter: {
      control: 'boolean',
      description: 'Solid profiles: after the depth-order pass.',
      table: { category: 'Section' },
    },
    sectionOnTop: {
      control: 'boolean',
      description: 'Draw the fence without depth testing, over the meshes.',
      table: { category: 'Section' },
    },
    probeResolution: {
      control: { type: 'range', min: 0, max: 256, step: 8 },
      description:
        'Grid resolution used for the crossing statistics (0 = off).',
      table: { category: 'Section' },
    },
    showChunk: { control: 'boolean', table: { category: 'Appearance' } },
    surfaceOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wallOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wireframe: { control: 'boolean', table: { category: 'Appearance' } },
    showWalls: { control: 'boolean', table: { category: 'Appearance' } },
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
    cameraPosition: [-10000, 6000, 5000],
  },
};
