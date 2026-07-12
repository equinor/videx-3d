import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineLoop,
} from 'three';
import { OITRenderPass, Pass, RenderPass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import { useData } from '../../hooks/useData';
import {
  ChunkSurfaceLayer,
  CRS,
  createSurfaceOutline,
  getProjectionDefFromUtmZone,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  PositionLog,
  SurfaceMeta,
  Vec2,
  Vec3,
  WellboreHeader,
} from '../../sdk';
import { parseGeoJsonFeature } from '../../sdk/utils/geojson';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { get } from '../../storybook/dependencies/api';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkStack } from './ChunkStack';
import { CutoutSource } from './cutout';
import { resolveWellboreOutline } from './resolveWellboreOutline';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');
const toSceneXZ = (pos: Vec2): Vec2 => {
  const c = crs.wgs84ToWorld(pos[0], pos[1]);
  return [c.x, c.z];
};
// Same mapping UtmArea publishes as utmToArea, built from the module-scope CRS so
// the story's overlay resolves in the exact frame the Chunk uses internally.
const utmToArea = (easting: number, northing: number, altitude = 0): Vec3 => {
  const c = crs.utmToWorld(easting, northing, altitude);
  return [c.x, c.y, c.z];
};

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

type OutlineSource = 'polygon' | 'wellbores' | 'surface-rim';

type OutlinesStoryProps = {
  source: OutlineSource;
  // Wellbore outline
  wellCount: number;
  radius: number;
  cellSize: number;
  clusterDistance: number;
  feather: number;
  wellSmoothing: number;
  sampleSpacing: number;
  // Surface rim
  rimSurfaceIndex: number;
  rimSmoothing: number;
  // Chunk
  groupSizes: string;
  rimSpacing: number;
  maxError: number;
  // Appearance
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  // Outline overlay
  showOutline: boolean;
  outlineAltitude: number;
  outlineColor: string;
  // Wells
  showWells: boolean;
  wellColor: string;
};

const OutlinesStory = (props: OutlinesStoryProps) => {
  const data = useData();
  const surfaceMetaDict = useSurfaceMetaDict();
  const wellbores = useWellboreHeaders();

  const metas = useMemo<SurfaceMeta[]>(
    () =>
      Object.keys(surfaceOptions)
        .map(id => surfaceMetaDict[id])
        .filter((m): m is SurfaceMeta => !!m)
        .sort((a, b) => a.max - b.max),
    [surfaceMetaDict],
  );

  const groups = useMemo(
    () => splitIntoGroups(metas, props.groupSizes),
    [metas, props.groupSizes],
  );

  const wellboreIds = useMemo(
    () => wellbores.slice(0, props.wellCount).map(w => w.id),
    [wellbores, props.wellCount],
  );

  // The wellbore CutoutSource handed to the Chunk (component-side resolution).
  const cutoutSource = useMemo<CutoutSource>(
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

  // Resolve the outline in the story too, purely for the validation overlay. For
  // the wellbore source this reuses the exact same resolver the Chunk uses, so the
  // drawn outline matches the clip.
  const [overlay, setOverlay] = useState<PlanarPolygonGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    const build = async (): Promise<PlanarPolygonGeometry | null> => {
      if (!data) return null;
      if (props.source === 'polygon') {
        const json = await get('/data/volve-polygon.json');
        if (!json) return null;
        return parseGeoJsonFeature(json, toSceneXZ)
          .geometry as PlanarPolygonGeometry;
      }
      if (props.source === 'surface-rim') {
        const meta = metas[Math.min(props.rimSurfaceIndex, metas.length - 1)];
        if (!meta) return null;
        const values = await data.get<Float32Array>('surface-values', meta.id);
        if (!values) return null;
        const wp = crs.utmToWorld(meta.header.xori, meta.header.yori, 0);
        return createSurfaceOutline(values, meta.header, {
          worldPosition: [wp.x, wp.z],
          smoothing: props.rimSmoothing,
          minRingArea: 1000,
        });
      }
      // wellbores
      const top = groups[0]?.[0];
      const base =
        groups[groups.length - 1]?.[groups[groups.length - 1].length - 1];
      if (!top || !base) return null;
      const [topValues, baseValues] = await Promise.all([
        data.get<Float32Array>('surface-values', top.id),
        data.get<Float32Array>('surface-values', base.id),
      ]);
      if (!topValues || !baseValues) return null;
      const toLayer = (
        meta: SurfaceMeta,
        values: Float32Array,
      ): ChunkSurfaceLayer => {
        const wp = crs.utmToWorld(meta.header.xori, meta.header.yori, 0);
        return {
          values,
          header: meta.header,
          worldPosition: [wp.x, wp.z],
          referenceDepth: meta.max,
        };
      };
      return resolveWellboreOutline(
        wellboreIds,
        cutoutSource.kind === 'wellbores' ? cutoutSource.options : undefined,
        toLayer(top, topValues),
        toLayer(base, baseValues),
        data,
        utmToArea,
      );
    };
    build().then(poly => {
      if (!cancelled) setOverlay(poly ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    data,
    props.source,
    props.rimSurfaceIndex,
    props.rimSmoothing,
    metas,
    groups,
    wellboreIds,
    cutoutSource,
  ]);

  // Validation line loops (per ring) in scene XZ.
  const outlines = useMemo<LineLoop[]>(() => {
    if (!overlay || !props.showOutline) return [];
    const material = new LineBasicMaterial({
      color: new Color(props.outlineColor),
    });
    const loops: LineLoop[] = [];
    (overlay.coordinates as PlanarPolygonCoordinates).forEach(component => {
      component.forEach(ring => {
        const positions: number[] = [];
        ring.forEach(([x, z]) => positions.push(x, props.outlineAltitude, z));
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          'position',
          new Float32BufferAttribute(positions, 3),
        );
        loops.push(new LineLoop(geometry, material));
      });
    });
    return loops;
  }, [overlay, props.showOutline, props.outlineAltitude, props.outlineColor]);

  useEffect(() => {
    return () => {
      outlines.forEach(o => {
        o.geometry.dispose();
        (o.material as LineBasicMaterial).dispose();
      });
    };
  }, [outlines]);

  // Trajectory polylines for the selected wellbores, built with the SAME scene
  // mapping the outline is derived from (utmToArea(east, north, -tvd)), so the
  // wells shown are exactly the outline's input — handy for reasoning about how
  // the args (radius / cluster / window) relate to the resulting footprint.
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

  // For polygon / surface-rim, feed the resolved polygon; for wellbores, hand the
  // Chunk the CutoutSource so the component-side resolution path is exercised.
  const chunkOutline =
    props.source === 'wellbores' ? cutoutSource : (overlay ?? undefined);

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <ChunkStack rimSpacing={props.rimSpacing} maxError={props.maxError}>
          <Chunk
            groups={groups}
            outline={chunkOutline}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
          />
        </ChunkStack>
        {outlines.map((o, i) => (
          <primitive key={i} object={o} />
        ))}
        {wellLines.map((l, i) => (
          <primitive key={i} object={l} />
        ))}
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'Spikes/Chunks/Outlines',
  component: OutlinesStory,
} satisfies Meta<typeof OutlinesStory>;

export default meta;
type Story = StoryObj<typeof OutlinesStory>;

export const Default: Story = {
  args: {
    source: 'wellbores',
    // Wellbore outline
    wellCount: 10,
    radius: 800,
    cellSize: 200,
    clusterDistance: 2000,
    feather: 0,
    wellSmoothing: 1,
    sampleSpacing: 50,
    // Surface rim
    rimSurfaceIndex: 0,
    rimSmoothing: 2,
    // Chunk
    groupSizes: '2,2',
    rimSpacing: 250,
    maxError: 5,
    // Appearance
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    // Outline overlay
    showOutline: true,
    outlineAltitude: 0,
    outlineColor: '#ffcc00',
    // Wells
    showWells: true,
    wellColor: '#00e5ff',
  },
  argTypes: {
    source: {
      control: { type: 'inline-radio' },
      options: ['polygon', 'wellbores', 'surface-rim'],
      table: { category: 'Source' },
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
    rimSurfaceIndex: {
      control: { type: 'range', min: 0, max: 10, step: 1 },
      description: 'Which surface (shallow→deep) to trace the rim from.',
      table: { category: 'Surface rim' },
    },
    rimSmoothing: {
      control: { type: 'range', min: 0, max: 8, step: 0.5 },
      table: { category: 'Surface rim' },
    },
    groupSizes: { control: { type: 'text' }, table: { category: 'Chunk' } },
    rimSpacing: {
      control: { type: 'range', min: 25, max: 1000, step: 25 },
      table: { category: 'Chunk' },
    },
    maxError: {
      control: { type: 'range', min: 0, max: 50, step: 1 },
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
    showOutline: { control: 'boolean', table: { category: 'Outline overlay' } },
    outlineAltitude: {
      control: { type: 'range', min: -4000, max: 500, step: 50 },
      table: { category: 'Outline overlay' },
    },
    outlineColor: { control: 'color', table: { category: 'Outline overlay' } },
    showWells: {
      control: 'boolean',
      description: 'Draw the selected wellbore trajectories (outline input).',
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
