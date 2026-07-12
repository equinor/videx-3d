import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineLoop,
} from 'three';
import { useData } from '../../main';
import {
  createClippedSurface,
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
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
import { Distance, WellboreBounds } from '../../main';
import { Surface } from './Surface';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

// Same CRS the UtmArea builds internally (utmZone + origin), so grid vertices and
// the mask polygon share one scene frame.
const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');

// Map a WGS84 lng/lat straight to SCENE XZ (x = easting - originE, z = originN -
// northing). NOTE: no Z negation here — the clip builder maps grid vertices to the
// same world XZ, so the polygon is authored directly in that frame.
const toSceneXZ = (pos: Vec2): Vec2 => {
  const c = crs.wgs84ToWorld(pos[0], pos[1]);
  return [c.x, c.z];
};

const polygonOptions: Record<string, string> = {
  '/data/volve-polygon.json': 'Volve (single polygon)',
  '/data/multi-polygon.json': 'Multi-polygon (with holes)',
};

// Fallback palette when a surface has no color in its meta, so stacked layers stay
// visually distinct.
const fallbackPalette = [
  '#4e79a7',
  '#f28e2c',
  '#59a14f',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
  '#edc949',
  '#9c755f',
];

type SurfaceClipStoryProps = {
  polygonId: string;
  surfaceCount: number;
  maxError: number;
  drape: boolean;
  cutHoles: boolean;
  edgeSmoothing: number;
  opacity: number;
  doubleSide: boolean;
  showOutline: boolean;
  outlineAltitude: number;
  showReference: boolean;
  showWells: boolean;
  showTube: boolean;
  wellRadius: number;
  wellColor: string;
};

/**
 * Spike: clip a stack of Volve horizons to a fixed polygon mask and render them
 * together with the field's wellbores. First step toward masked / chunked surfaces
 * — surfaces are clipped and layered here, not yet stitched into solid chunks.
 */
const SurfaceClipStory = (props: SurfaceClipStoryProps) => {
  const data = useData();
  const surfaceMetaDict = useSurfaceMetaDict();
  const wellbores = useWellboreHeaders();

  // Load + parse the mask polygon into scene XZ.
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

  // The surfaces to stack, sorted shallow -> deep.
  const surfaces = useMemo<SurfaceMeta[]>(() => {
    return Object.keys(surfaceOptions)
      .map(id => surfaceMetaDict[id])
      .filter((m): m is SurfaceMeta => !!m)
      .sort((a, b) => a.max - b.max)
      .slice(0, props.surfaceCount);
  }, [surfaceMetaDict, props.surfaceCount]);

  // Build the clipped geometry for each surface (main thread, like the Ocean
  // stories). Guarded by a cancelled flag + disposed on replace/unmount. setState
  // only happens inside the resolved promise (never synchronously in the effect
  // body) to avoid cascading renders.
  const [geometries, setGeometries] = useState<Record<string, BufferGeometry>>(
    {},
  );
  useEffect(() => {
    let cancelled = false;
    const built: Record<string, BufferGeometry> = {};
    const list = data && polygon ? surfaces : [];
    Promise.all(
      list.map(async meta => {
        const values = await data!.get<Float32Array>('surface-values', meta.id);
        if (!values) return;
        const wp = crs.utmToWorld(meta.header.xori, meta.header.yori, 0);
        const geometry = createClippedSurface(values, meta.header, {
          polygon: polygon!,
          referenceDepth: meta.max,
          worldPosition: [wp.x, wp.z],
          maxError: props.maxError,
          drape: props.drape,
          cutHoles: props.cutHoles,
          edgeSmoothing: props.edgeSmoothing,
        });
        if (geometry) built[meta.id] = geometry;
      }),
    ).then(() => {
      if (cancelled) {
        Object.values(built).forEach(g => g.dispose());
        return;
      }
      setGeometries(built);
    });
    return () => {
      cancelled = true;
    };
  }, [
    polygon,
    surfaces,
    data,
    props.maxError,
    props.drape,
    props.cutHoles,
    props.edgeSmoothing,
  ]);

  useEffect(() => {
    return () => {
      Object.values(geometries).forEach(g => g.dispose());
    };
  }, [geometries]);

  // Polygon-outline line loops (per ring) in scene XZ, for validating the clip.
  const outlines = useMemo<LineLoop[]>(() => {
    if (!polygon || !props.showOutline) return [];
    const rings = polygon.coordinates as PlanarPolygonCoordinates;
    const material = new LineBasicMaterial({ color: new Color('#ffcc00') });
    const loops: LineLoop[] = [];
    rings.forEach(component => {
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
  }, [polygon, props.showOutline, props.outlineAltitude]);

  useEffect(() => {
    return () => {
      outlines.forEach(o => {
        o.geometry.dispose();
        (o.material as LineBasicMaterial).dispose();
      });
    };
  }, [outlines]);

  return (
    <UtmArea origin={origin} utmZone={utmZone}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />

      {surfaces.map(
        (meta, i) =>
          geometries[meta.id] && (
            // createClippedSurface bakes y = value - referenceDepth = -trueDepth
            // into the geometry, so we place it at altitude 0 to render at its
            // true depth below sea level. (Adding altitude={meta.max} — as the
            // single-surface Surface story does — would cancel that and float
            // every layer near the origin, overlapping and misaligned from the
            // wells, which are already at true depth.)
            <UtmPosition
              key={meta.id}
              easting={meta.header.xori}
              northing={meta.header.yori}
              altitude={0}
            >
              <mesh geometry={geometries[meta.id]}>
                <meshLambertMaterial
                  // NOTE: meta.color is the surface's cross-section colour, which
                  // is often "black" in the source data (it's intended for the
                  // chunk side skirts later). For the lit tops we use a distinct
                  // palette so stacked layers stay readable.
                  color={fallbackPalette[i % fallbackPalette.length]}
                  side={props.doubleSide ? DoubleSide : undefined}
                  transparent={props.opacity < 1}
                  opacity={props.opacity}
                  depthWrite={props.opacity >= 1}
                />
              </mesh>
            </UtmPosition>
          ),
      )}

      {props.showReference && surfaces[0] && (
        <UtmPosition
          easting={surfaces[0].header.xori}
          northing={surfaces[0].header.yori}
          altitude={0}
        >
          <Surface meta={surfaces[0]} opacity={0.25} wireframe />
        </UtmPosition>
      )}

      {outlines.map((o, i) => (
        <primitive key={i} object={o} />
      ))}

      {props.showWells &&
        wellbores.map(wb => (
          <UtmPosition key={wb.id} easting={wb.easting} northing={wb.northing}>
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
  );
};

const meta = {
  title: 'Spikes/Surfaces/SurfaceClip',
  component: SurfaceClipStory,
} satisfies Meta<typeof SurfaceClipStory>;

export default meta;
type Story = StoryObj<typeof SurfaceClipStory>;

export const Default: Story = {
  args: {
    // Surfaces
    surfaceCount: 4,
    maxError: 5,
    drape: true,
    cutHoles: true,
    edgeSmoothing: 0,
    opacity: 1,
    doubleSide: true,
    // Mask
    polygonId: '/data/volve-polygon.json',
    showOutline: true,
    outlineAltitude: 0,
    showReference: false,
    // Wells
    showWells: true,
    showTube: true,
    wellRadius: 1,
    wellColor: '#222222',
  },
  argTypes: {
    surfaceCount: {
      control: { type: 'range', min: 1, max: 10, step: 1 },
      table: { category: 'Surfaces' },
    },
    maxError: {
      control: { type: 'range', min: 0, max: 50, step: 1 },
      table: { category: 'Surfaces' },
    },
    drape: { control: 'boolean', table: { category: 'Surfaces' } },
    cutHoles: { control: 'boolean', table: { category: 'Surfaces' } },
    edgeSmoothing: {
      control: { type: 'range', min: 0, max: 5, step: 1 },
      table: { category: 'Surfaces' },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Surfaces' },
    },
    doubleSide: { control: 'boolean', table: { category: 'Surfaces' } },
    polygonId: {
      control: { type: 'select' },
      options: Object.keys(polygonOptions),
      table: { category: 'Mask' },
    },
    showOutline: { control: 'boolean', table: { category: 'Mask' } },
    outlineAltitude: {
      control: { type: 'range', min: -4000, max: 500, step: 50 },
      table: { category: 'Mask' },
    },
    showReference: { control: 'boolean', table: { category: 'Mask' } },
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
    autoClear: true,
    scale: 1000,
    cameraPosition: [-10000, 10000, 5000],
  },
};
