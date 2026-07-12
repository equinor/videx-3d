import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DoubleSide, MeshStandardMaterial } from 'three';
import {
  Distance,
  OITRenderPass,
  Pass,
  RenderPass,
  useData,
  WellboreBounds,
} from '../../main';
import { makeOitCompatible } from '../../rendering/oit-material';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  createSurfaceChunk,
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonGeometry,
  SurfaceChunk,
  SurfaceChunkLayer,
  SurfaceChunkMetrics,
  SurfaceMeta,
  Vec2,
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
import { UtmArea, UtmPosition } from '../UtmArea';
import { BasicTrajectory } from '../Wellbores/BasicTrajectory/BasicTrajectory';
import { TubeTrajectory } from '../Wellbores/TubeTrajectory/TubeTrajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');

// WGS84 lng/lat -> scene XZ (x = easting - originE, z = originN - northing).
const toSceneXZ = (pos: Vec2): Vec2 => {
  const c = crs.wgs84ToWorld(pos[0], pos[1]);
  return [c.x, c.z];
};

const polygonOptions: Record<string, string> = {
  '/data/volve-polygon.json': 'Volve (single polygon)',
  '/data/multi-polygon.json': 'Multi-polygon (with holes)',
};

// Distinct per-interval colours (surface meta.color is "black" for these horizons).
const palette = [
  '#4e79a7',
  '#f28e2c',
  '#59a14f',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
  '#edc949',
  '#9c755f',
];

// Parse a comma-separated group-size string (e.g. "2,2") into positive counts.
function parseGroupCounts(sizes: string): number[] {
  return sizes
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0);
}

// Split items into contiguous groups per the parsed counts. Blank/invalid -> a
// single group with everything. Only as many items as the counts call for are
// grouped (no leftover group). This is only the spike story's grouping choice —
// createSurfaceChunk itself is unopinionated and just takes the 2D array.
function splitIntoGroups<T>(items: T[], sizes: string): T[][] {
  const counts = parseGroupCounts(sizes);
  if (counts.length === 0) return items.length > 0 ? [items] : [];
  const groups: T[][] = [];
  let i = 0;
  for (const c of counts) {
    if (i >= items.length) break;
    groups.push(items.slice(i, i + c));
    i += c;
  }
  return groups;
}

type SurfaceChunkStoryProps = {
  polygonId: string;
  groupSizes: string;
  rimSpacing: number;
  maxError: number;
  clamp: boolean;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  showSurfaces: boolean;
  showWalls: boolean;
  showBasement: boolean;
  basementTopSource: 'chunk' | 'procedural';
  basementThickness: number;
  basementTopDepth: number;
  basementDepthMode: 'mean' | 'min';
  basementVariation: number;
  basementSegments: number;
  basementColor: string;
  showMetrics: boolean;
  oitPipeline: boolean;
  showWells: boolean;
  showTube: boolean;
  wellRadius: number;
  wellColor: string;
};

// Imperative fixed-position HUD showing the chunk build timings (main-thread).
const MetricsOverlay = ({
  metrics,
}: {
  metrics: SurfaceChunkMetrics | null;
}) => {
  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:8px;left:8px;z-index:1000;background:rgba(0,0,0,0.75);' +
      'color:#8f8;font:11px/1.4 monospace;padding:8px 10px;white-space:pre;' +
      'pointer-events:none;border-radius:4px';
    document.body.appendChild(el);
    elRef.current = el;
    return () => {
      el.remove();
      elRef.current = null;
    };
  }, []);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.textContent = metrics
      ? [
          'SurfaceChunk build',
          `  densify : ${metrics.densifyMs.toFixed(1)} ms`,
          `  clip    : ${metrics.clipMs.toFixed(1)} ms (${metrics.surfaces} surfaces)`,
          `  rim     : ${metrics.rimMs.toFixed(1)} ms (${metrics.rimPoints} pts)`,
          `  walls   : ${metrics.wallsMs.toFixed(1)} ms (${metrics.walls})`,
          `  basement: ${metrics.basementMs.toFixed(1)} ms`,
          `  total   : ${metrics.totalMs.toFixed(1)} ms`,
          `  tris    : ${metrics.triangles.toLocaleString()}`,
        ].join('\n')
      : 'SurfaceChunk: building…';
  }, [metrics]);
  return null;
};

// A single, always-on RenderingPipeline whose base pass is toggled between the
// OITRenderPass (order-independent transparency) and a plain RenderPass — matching
// the OITRenderPass debug story (the known-good reference). Toggling the base pass in
// place (rather than mounting/unmounting the whole pipeline) keeps the renderer's
// autoClear/target lifecycle stable across the switch. When OIT is on, a HUD shows the
// pass's live per-frame object classification so routing can be diagnosed.
const ChunkPipeline = ({ oitEnabled }: { oitEnabled: boolean }) => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = oitEnabled
      ? new OITRenderPass(scene, camera)
      : new RenderPass(scene, camera);
    // SMAA anti-aliasing: single-frame (no temporal jitter), so it doesn't shimmer
    // or ghost on camera/opacity changes the way the default TAA does.
    if (base instanceof OITRenderPass) base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera, oitEnabled]);

  const oitPass = passes[0] instanceof OITRenderPass ? passes[0] : null;

  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!oitPass) return;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;bottom:8px;left:8px;z-index:1000;background:rgba(0,0,0,0.75);' +
      'color:#8cf;font:11px/1.4 monospace;padding:6px 8px;white-space:pre;' +
      'pointer-events:none;border-radius:4px';
    document.body.appendChild(el);
    elRef.current = el;
    return () => {
      el.remove();
      elRef.current = null;
    };
  }, [oitPass]);

  // Priority 2 runs after the pipeline (priority 1), so it reads this frame's counts.
  useFrame(() => {
    const el = elRef.current;
    if (!el || !oitPass) return;
    const s = oitPass.stats;
    el.textContent =
      `OIT routing  opaque:${s.opaque}  oit:${s.oit}  oitOpaque:${s.oitOpaque}\n` +
      `oitHidden:${s.oitHidden}  oitMixed:${s.oitMixed}  overlay:${s.overlay}`;
  }, 2);

  return <RenderingPipeline passes={passes} />;
};

/**
 * Spike: stitch a stack of Volve horizons (clipped to a shared polygon) into a
 * solid chunk with coloured side walls — the second step toward chunked surfaces.
 * Each interval's wall takes the colour of the surface above it.
 */
const SurfaceChunkStory = (props: SurfaceChunkStoryProps) => {
  const data = useData();
  const surfaceMetaDict = useSurfaceMetaDict();
  const wellbores = useWellboreHeaders();

  const [polygon, setPolygon] = useState<PlanarPolygonGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    get(props.polygonId).then(json => {
      if (cancelled || !json) return;
      const feature = parseGeoJsonFeature(json, toSceneXZ);
      setPolygon(feature.geometry as PlanarPolygonGeometry);
    });
    return () => {
      cancelled = true;
    };
  }, [props.polygonId]);

  // Layers, sorted shallow -> deep.
  const metas = useMemo<SurfaceMeta[]>(() => {
    return Object.keys(surfaceOptions)
      .map(id => surfaceMetaDict[id])
      .filter((m): m is SurfaceMeta => !!m)
      .sort((a, b) => a.max - b.max);
  }, [surfaceMetaDict]);

  const [chunk, setChunk] = useState<SurfaceChunk | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Only load the surfaces the groups actually use: the min of the summed group
    // sizes and the available surfaces (blank groupSizes -> all available).
    const counts = parseGroupCounts(props.groupSizes);
    const required = counts.reduce((a, b) => a + b, 0);
    const usedMetas = counts.length === 0 ? metas : metas.slice(0, required);
    const build = data && polygon && usedMetas.length > 0;
    Promise.all(
      build
        ? usedMetas.map(async (meta, i) => {
            const values = await data!.get<Float32Array>(
              'surface-values',
              meta.id,
            );
            if (!values) return null;
            const wp = crs.utmToWorld(meta.header.xori, meta.header.yori, 0);
            const layer: SurfaceChunkLayer = {
              values,
              header: meta.header,
              referenceDepth: meta.max,
              worldPosition: [wp.x, wp.z],
              color: palette[i % palette.length],
            };
            return layer;
          })
        : [],
    ).then(results => {
      const layers = results.filter((l): l is SurfaceChunkLayer => !!l);
      if (cancelled) return;
      const groups = splitIntoGroups(layers, props.groupSizes);
      setChunk(
        groups.length > 0 && polygon
          ? createSurfaceChunk(groups, {
              polygon,
              rimSpacing: props.rimSpacing,
              maxError: props.maxError,
              clamp: props.clamp,
              basement: props.showBasement
                ? {
                    color: props.basementColor,
                    thickness: props.basementThickness,
                    // 'chunk' -> attached (top = deepest surface); 'procedural' ->
                    // standalone block with its own rocky top.
                    top:
                      props.basementTopSource === 'procedural'
                        ? {
                            procedural: {
                              depth: props.basementTopDepth,
                              depthMode: props.basementDepthMode,
                              variation: props.basementVariation,
                              segments: props.basementSegments,
                            },
                          }
                        : undefined,
                  }
                : undefined,
            })
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    data,
    polygon,
    metas,
    props.groupSizes,
    props.rimSpacing,
    props.maxError,
    props.clamp,
    props.showBasement,
    props.basementTopSource,
    props.basementThickness,
    props.basementTopDepth,
    props.basementDepthMode,
    props.basementVariation,
    props.basementSegments,
    props.basementColor,
  ]);

  // Dispose chunk geometries on replace / unmount.
  useEffect(() => {
    return () => {
      chunk?.groups.forEach(g => {
        g.surfaces.forEach(s => s.geometry.dispose());
        g.walls.forEach(w => w.geometry.dispose());
      });
      chunk?.basement?.surfaces.forEach(s => s.geometry.dispose());
      chunk?.basement?.walls.forEach(w => w.geometry.dispose());
    };
  }, [chunk]);

  // OIT-compatible lit materials (one per mesh). Following the proven OITRenderPass
  // debug-story pattern, they are patched at CONSTRUCTION and REBUILT when appearance
  // changes (opacity / wireframe / pipeline), rather than mutated in place. A live
  // `transparent` toggle + `needsUpdate` on a shared material leaves the pass's cached
  // per-object classification and its per-pass OIT variants stale (opaque endpoints,
  // un-composited middle); rebuilding gives each change a fresh material identity so
  // the pass re-classifies cleanly.
  const materials = useMemo(() => {
    if (!chunk) return null;
    const make = (color: string, opacity: number) => {
      const m = new MeshStandardMaterial({
        color,
        side: DoubleSide,
        metalness: 0,
        roughness: 1,
        opacity,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
        wireframe: props.wireframe,
        // Render linear: the OutputPass tone-maps + sRGB-encodes the whole buffer once,
        // so a per-material tonemap would double up. Matches the OITRenderPass debug
        // story (the known-good reference for this pipeline).
        toneMapped: false,
      });
      return makeOitCompatible(m);
    };
    // Materials mirror the chunk's group structure so per-group visibility /
    // opacity stays straightforward. The basement renders opaque (solid rock).
    const groupMats = chunk.groups.map(group => ({
      surfaces: group.surfaces.map(s => make(s.color, props.surfaceOpacity)),
      walls: group.walls.map(w => make(w.color, props.wallOpacity)),
    }));
    const basement = chunk.basement
      ? {
          surfaces: chunk.basement.surfaces.map(s => make(s.color, 1)),
          walls: chunk.basement.walls.map(w => make(w.color, 1)),
        }
      : null;
    return { groups: groupMats, basement };
  }, [chunk, props.surfaceOpacity, props.wallOpacity, props.wireframe]);

  useEffect(() => {
    return () => {
      materials?.groups.forEach(group => {
        group.surfaces.forEach(m => m.dispose());
        group.walls.forEach(m => m.dispose());
      });
      materials?.basement?.surfaces.forEach(m => m.dispose());
      materials?.basement?.walls.forEach(m => m.dispose());
    };
  }, [materials]);

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />

        {props.showWalls &&
          materials &&
          chunk?.groups.map((group, gi) =>
            group.walls.map((wall, i) => (
              <mesh key={`wall-${gi}-${i}`} geometry={wall.geometry}>
                <primitive
                  key={materials.groups[gi].walls[i].uuid}
                  object={materials.groups[gi].walls[i]}
                  attach="material"
                />
              </mesh>
            )),
          )}

        {props.showSurfaces &&
          materials &&
          chunk?.groups.map((group, gi) =>
            group.surfaces.map((surface, i) => (
              <mesh key={`surface-${gi}-${i}`} geometry={surface.geometry}>
                <primitive
                  key={materials.groups[gi].surfaces[i].uuid}
                  object={materials.groups[gi].surfaces[i]}
                  attach="material"
                />
              </mesh>
            )),
          )}

        {materials?.basement && chunk?.basement && (
          <group>
            {chunk.basement.walls.map((wall, i) => (
              <mesh key={`basement-wall-${i}`} geometry={wall.geometry}>
                <primitive
                  key={materials.basement!.walls[i].uuid}
                  object={materials.basement!.walls[i]}
                  attach="material"
                />
              </mesh>
            ))}
            {chunk.basement.surfaces.map((surface, i) => (
              <mesh key={`basement-cap-${i}`} geometry={surface.geometry}>
                <primitive
                  key={materials.basement!.surfaces[i].uuid}
                  object={materials.basement!.surfaces[i]}
                  attach="material"
                />
              </mesh>
            ))}
          </group>
        )}

        {props.showWells &&
          wellbores.map(wb => (
            <UtmPosition
              key={wb.id}
              easting={wb.easting}
              northing={wb.northing}
            >
              <Wellbore id={wb.id}>
                <WellboreBounds id={wb.id}>
                  <BasicTrajectory color={props.wellColor} />
                  {props.showTube && (
                    <Distance min={0} max={2000}>
                      <TubeTrajectory
                        radius={props.wellRadius}
                        color={props.wellColor}
                        radialSegments={8}
                      />
                    </Distance>
                  )}
                </WellboreBounds>
              </Wellbore>
            </UtmPosition>
          ))}
      </UtmArea>

      <ChunkPipeline oitEnabled={props.oitPipeline} />
      {props.showMetrics && <MetricsOverlay metrics={chunk?.metrics ?? null} />}
    </>
  );
};

const meta = {
  title: 'Spikes/Surfaces/SurfaceChunk',
  component: SurfaceChunkStory,
} satisfies Meta<typeof SurfaceChunkStory>;

export default meta;
type Story = StoryObj<typeof SurfaceChunkStory>;

export const Default: Story = {
  args: {
    // Chunk
    groupSizes: '2,2',
    rimSpacing: 250,
    maxError: 5,
    clamp: false,
    showSurfaces: true,
    showWalls: true,
    // Appearance
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    // Basement
    showBasement: false,
    basementTopSource: 'chunk',
    basementThickness: 800,
    basementTopDepth: 4000,
    basementDepthMode: 'mean',
    basementVariation: 400,
    basementSegments: 96,
    basementColor: '#4a4a4a',
    // Debug
    showMetrics: true,
    oitPipeline: false,
    // Mask
    polygonId: '/data/volve-polygon.json',
    // Wells
    showWells: true,
    showTube: true,
    wellRadius: 1,
    wellColor: '#222222',
  },
  argTypes: {
    groupSizes: {
      control: { type: 'text' },
      description:
        'Comma-separated sizes of each chunk group, top to bottom (e.g. "2,2"). ' +
        'Groups are separated by a gap. Only that many surfaces are loaded ' +
        '(capped at what is available). Blank = one group of all available ' +
        'surfaces.',
      table: { category: 'Chunk' },
    },
    rimSpacing: {
      control: { type: 'range', min: 25, max: 1000, step: 25 },
      table: { category: 'Chunk' },
    },
    maxError: {
      control: { type: 'range', min: 0, max: 50, step: 1 },
      table: { category: 'Chunk' },
    },
    clamp: { control: 'boolean', table: { category: 'Chunk' } },
    showSurfaces: { control: 'boolean', table: { category: 'Chunk' } },
    showWalls: { control: 'boolean', table: { category: 'Chunk' } },
    surfaceOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wallOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wireframe: { control: 'boolean', table: { category: 'Appearance' } },
    showBasement: { control: 'boolean', table: { category: 'Basement' } },
    basementTopSource: {
      control: { type: 'inline-radio' },
      options: ['chunk', 'procedural'],
      description:
        "'chunk' attaches the basement below the deepest surface; 'procedural' " +
        'makes a standalone block with its own rocky top.',
      table: { category: 'Basement' },
    },
    basementThickness: {
      control: { type: 'range', min: 0, max: 3000, step: 50 },
      table: { category: 'Basement' },
    },
    basementTopDepth: {
      control: { type: 'range', min: 0, max: 6000, step: 50 },
      description: 'Mean depth of the procedural top (standalone only).',
      table: { category: 'Basement' },
    },
    basementDepthMode: {
      control: { type: 'inline-radio' },
      options: ['mean', 'min'],
      table: { category: 'Basement' },
    },
    basementVariation: {
      control: { type: 'range', min: 0, max: 1500, step: 25 },
      table: { category: 'Basement' },
    },
    basementSegments: {
      control: { type: 'range', min: 8, max: 200, step: 8 },
      table: { category: 'Basement' },
    },
    basementColor: { control: 'color', table: { category: 'Basement' } },
    showMetrics: { control: 'boolean', table: { category: 'Debug' } },
    oitPipeline: { control: 'boolean', table: { category: 'Debug' } },
    polygonId: {
      control: { type: 'select' },
      options: Object.keys(polygonOptions),
      table: { category: 'Mask' },
    },
    showWells: { control: 'boolean', table: { category: 'Wells' } },
    showTube: { control: 'boolean', table: { category: 'Wells' } },
    wellRadius: {
      control: { type: 'range', min: 1, max: 50, step: 1 },
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
    // autoClear stays at the Canvas3dDecorator default (false): the RenderingPipeline
    // owns clearing (it forces autoClear=false and clears explicitly per pass). A
    // renderer-level autoClear=true wipes the OIT pass's intermediate targets between
    // its multiple render() calls, breaking transparency.
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
};
