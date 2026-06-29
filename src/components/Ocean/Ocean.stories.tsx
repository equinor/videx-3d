import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BufferGeometry, CircleGeometry, Group } from 'three';
import { Ocean, useData } from '../../main';
import {
  createOceanBox,
  createOceanBoxFromPolygon,
  createOceanBoxFromSurface,
  createOceanEllipseBox,
  createOceanPlane,
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonGeometry,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import { parseGeoJsonFeature } from '../../sdk/utils/geojson';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { get } from '../../storybook/dependencies/api';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import storyArgs from '../../storybook/story-args.json';
import { useOceanContact } from './ocean-contact';
import { OceanContact } from './ocean-material';
import { BuoyancyPoint, useBuoyancy } from './ocean-sampler';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;
const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');

/**
 * Selectable GeoJSON footprints for the polygon variant. The key is the public
 * URL fetched at runtime; the value is the label shown in the Storybook select.
 */
const polygonOptions: Record<string, string> = {
  '/data/volve-polygon.json': 'Volve (single polygon)',
  '/data/multi-polygon.json': 'Multi-polygon (with holes)',
};

/**
 * Map a WGS84 lon/lat to world XY. The northing (Y) is negated because Three.js
 * shapes are authored in the XY plane and the world Z axis points south; after
 * the geometry is rotated onto the XZ plane the orientation comes out correct.
 */
const transformWgs84 = (pos: Vec2): Vec2 => {
  const coord = crs.wgs84ToWorld(pos[0], pos[1]);
  return [coord.x, -coord.z];
};

type OceanVariant =
  | 'plane'
  | 'circle'
  | 'box'
  | 'ellipse'
  | 'polygon'
  | 'surface';

type Geometries = {
  surface: BufferGeometry;
  body?: BufferGeometry;
  bed?: BufferGeometry;
};

function disposeGeometries(g: Geometries) {
  g.surface.dispose();
  g.body?.dispose();
  g.bed?.dispose();
}

/**
 * A single box mesh that floats on the ocean. Rendered as a child of `<Ocean>`,
 * it reads the live wave field via `useBuoyancy` (sampling its four bottom
 * corners) so it heaves/pitches/rolls with the waves. The heading is fixed; only
 * the vertical motion and tilt follow the surface. When `contactFoam` is set it
 * also spreads foam where it meets the water.
 */
function FloatingBox({
  position,
  size,
  color,
  contactFoam,
}: {
  position: [number, number, number];
  size: number;
  color: string;
  contactFoam: boolean;
}) {
  const ref = useRef<Group>(null);
  const half = size / 2;
  const points = useMemo<BuoyancyPoint[]>(
    () => [
      [half, half],
      [half, -half],
      [-half, half],
      [-half, -half],
    ],
    [half],
  );
  useBuoyancy(ref, { points, mass: 0.1 });
  useOceanContact(
    useCallback((): OceanContact | null => {
      const g = ref.current;
      if (!g) return null;
      return {
        x: g.position.x,
        z: g.position.z,
        heading: 0,
        halfLength: half,
        halfWidth: half,
        foamWidth: half,
      };
    }, [half]),
    contactFoam,
  );
  return (
    <group ref={ref} position={position}>
      <mesh position={[0, half * 0.4, 0]}>
        <boxGeometry args={[size, size * 0.8, size]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

// A handful of boxes scattered near the origin. Kept small relative to the wave
// length so they bob and tilt visibly (a large box spans many waves and barely
// reacts). Crank up the wind / amplitude for livelier motion.
const FLOATERS: {
  position: [number, number, number];
  size: number;
  color: string;
}[] = [
    { position: [-600, 0, -300], size: 60, color: '#c0392b' },
    { position: [450, 0, -550], size: 50, color: '#e67e22' },
    { position: [100, 0, 350], size: 80, color: '#f1c40f' },
    { position: [750, 0, 400], size: 45, color: '#2980b9' },
    { position: [-350, 0, 650], size: 65, color: '#27ae60' },
  ];

function FloatingBoxes({ contactFoam }: { contactFoam: boolean }) {
  return (
    <>
      {FLOATERS.map((f, i) => (
        <FloatingBox key={i} {...f} contactFoam={contactFoam} />
      ))}
    </>
  );
}

type ExampleProps = {
  variant: OceanVariant;

  // Geometry
  size: number;
  sizeZ: number;
  rotation: number;
  surfaceSegments: number;
  perimeterSegments: number;
  bedSegments: number;
  waterDepth: number;
  depthVariation: number;
  maxError: number;
  rimSmoothing: number;
  surfaceId: string;
  polygonId: string;

  // Placement / appearance
  oceanLevel: number;
  waveCount: number;
  detailOctaves: number;
  detailScale: number;
  detailStrength: number;
  windDirection: number;
  windSpeed: number;
  amplitude: number;
  directionalSpread: number;
  steepness: number;
  displacement: boolean;
  waterOpacity: number;
  tonalVariation: number;
  tonalScale: number;
  tonalSharpness: number;
  tonalColor: string;
  reflectionIntensity: number;
  foamAmount: number;
  foamColor: string;
  deepColor: string;
  shallowColor: string;
  opacity: number;
  wireframe: boolean;

  // Sea bed / body (box, polygon, surface variants)
  seaBedColor: string;
  seaBedOpacity: number;
  seaBedWaterTint: number;
  seaBedDuneStrength: number;
  seaBedDuneWavelength: number;
  seaBedDuneDirection: number;
  seaBedDuneSharpness: number;
  bodyMaxOpacity: number;
  bodyShimmer: number;

  // Group visibility
  surfaceVisible: boolean;
  bodyVisible: boolean;
  bedVisible: boolean;

  // Buoyancy demo
  floaters: boolean;
  contactFoam: boolean;
};

const OceanDemo = (props: ExampleProps) => {
  const data = useData();
  const surfaceMetaDict = useSurfaceMetaDict();

  const [geometries, setGeometries] = useState<Geometries | null>(null);

  const surfaceMeta: SurfaceMeta | undefined = surfaceMetaDict[props.surfaceId];

  useEffect(() => {
    let cancelled = false;

    // Width (X) and height (Z) can be set separately; sizeZ of 0 means "square"
    // (use the single `size` for both axes), otherwise the footprint is oval /
    // rectangular.
    const sizeXZ: number | Vec2 =
      props.sizeZ > 0 ? [props.size, props.sizeZ] : props.size;

    const apply = (g: Geometries) => {
      if (cancelled) {
        disposeGeometries(g);
        return;
      }
      // Replace the state with the freshly built geometry. The previous one is
      // disposed by the dedicated cleanup effect below (keyed on `geometries`),
      // which runs only after this update commits — so we never render a
      // geometry that has just been disposed, and we never call setState
      // synchronously inside this effect to clear it.
      setGeometries(g);
    };

    if (props.variant === 'plane') {
      apply({
        surface: createOceanPlane({
          size: sizeXZ,
          surfaceSegments: props.surfaceSegments,
          rotation: props.rotation,
        }),
      });
    } else if (props.variant === 'circle') {
      // Built-in Three.js circle, authored in the XY plane, flipped onto the
      // world XZ plane so its normals point straight up.
      const circle = new CircleGeometry(
        props.size / 2,
        props.perimeterSegments,
      );
      circle.rotateX(-Math.PI / 2);
      apply({ surface: circle });
    } else if (props.variant === 'box') {
      apply(
        createOceanBox({
          size: sizeXZ,
          surfaceSegments: props.surfaceSegments,
          bedSegments: props.bedSegments,
          waterDepth: props.waterDepth,
          depthVariation: props.depthVariation,
          rotation: props.rotation,
        }),
      );
    } else if (props.variant === 'ellipse') {
      apply(
        createOceanEllipseBox({
          size: sizeXZ,
          perimeterSegments: props.perimeterSegments,
          radialSegments: props.bedSegments,
          waterDepth: props.waterDepth,
          depthVariation: props.depthVariation,
          rotation: props.rotation,
        }),
      );
    } else if (props.variant === 'polygon') {
      get(props.polygonId).then(json => {
        if (cancelled || !json) return;
        const feature = parseGeoJsonFeature(json, transformWgs84);
        feature.geometry.centralize();
        apply(
          createOceanBoxFromPolygon(feature.geometry as PlanarPolygonGeometry, {
            waterDepth: props.waterDepth,
            depthVariation: props.depthVariation,
            surfaceSegments: props.surfaceSegments,
            bedSegments: props.bedSegments,
          }),
        );
      });
    } else if (props.variant === 'surface') {
      // NOTE: none of the surfaces bundled with this repo are actual sea-bed
      // surfaces — they are subsurface sediment horizons sampled well below sea
      // level. They are used here purely to demonstrate the feature. In a client
      // application you would pass the values of a real bathymetry / sea-bed
      // surface so the ocean box's bed matches the true sea floor.
      if (data && surfaceMeta) {
        data
          .get<Float32Array>('surface-values', props.surfaceId)
          .then(values => {
            if (cancelled || !values) return;
            apply(
              createOceanBoxFromSurface(
                values,
                {
                  nx: surfaceMeta.header.nx,
                  ny: surfaceMeta.header.ny,
                  xinc: surfaceMeta.header.xinc,
                  yinc: surfaceMeta.header.yinc,
                  rot: surfaceMeta.header.rot,
                },
                {
                  surfaceSegments: props.surfaceSegments,
                  maxError: props.maxError,
                  rimSmoothing: props.rimSmoothing,
                  // These repo surfaces are depth-normalized (stored as
                  // surfaceMeta.max - trueDepth), so pass the reference depth to
                  // place the bed at its true depth below sea level, exactly as
                  // the Surface component does.
                  referenceDepth: surfaceMeta.max,
                },
              ),
            );
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [
    props.variant,
    props.size,
    props.sizeZ,
    props.rotation,
    props.surfaceSegments,
    props.perimeterSegments,
    props.bedSegments,
    props.waterDepth,
    props.depthVariation,
    props.maxError,
    props.rimSmoothing,
    props.surfaceId,
    props.polygonId,
    data,
    surfaceMeta,
  ]);

  // Dispose geometries when they are replaced or when the component unmounts.
  // Driving disposal from a cleanup effect keyed on `geometries` (instead of
  // disposing/clearing synchronously inside the build effect above) is what lets
  // us avoid the "Calling setState synchronously within an effect" cascade.
  useEffect(() => {
    if (!geometries) return;
    return () => disposeGeometries(geometries);
  }, [geometries]);

  const wind = useMemo<Vec2>(() => {
    const rad = (props.windDirection * Math.PI) / 180;
    return [Math.cos(rad), Math.sin(rad)];
  }, [props.windDirection]);

  const duneDirection = useMemo<Vec2>(() => {
    const rad = (props.seaBedDuneDirection * Math.PI) / 180;
    return [Math.cos(rad), Math.sin(rad)];
  }, [props.seaBedDuneDirection]);

  // Center the geometry at the world origin so every variant frames nicely with
  // the default camera, regardless of its native extent or origin offset.
  const position = useMemo<[number, number, number]>(() => {
    if (!geometries) return [0, props.oceanLevel, 0];
    geometries.surface.computeBoundingBox();
    const b = geometries.surface.boundingBox;
    if (!b) return [0, props.oceanLevel, 0];
    return [
      -(b.min.x + b.max.x) / 2,
      props.oceanLevel,
      -(b.min.z + b.max.z) / 2,
    ];
  }, [geometries, props.oceanLevel]);

  if (!geometries) return null;

  return (
    <Ocean
      waveCount={props.waveCount}
      detailOctaves={props.detailOctaves}
      detailScale={props.detailScale}
      detailStrength={props.detailStrength}
      sunColor="#d6d39f"
      skyColor="#465a6a"
      name="Ocean"
      geometry={geometries.surface}
      bodyGeometry={geometries.body}
      bedGeometry={geometries.bed}
      position={position}
      windDirection={wind}
      windSpeed={props.windSpeed}
      amplitude={props.amplitude}
      directionalSpread={props.directionalSpread}
      steepness={props.steepness}
      displacement={props.displacement}
      waterOpacity={props.waterOpacity}
      tonalVariation={props.tonalVariation}
      tonalScale={props.tonalScale}
      tonalSharpness={props.tonalSharpness}
      tonalColor={props.tonalColor}
      reflectionIntensity={props.reflectionIntensity}
      foamAmount={props.foamAmount}
      foamColor={props.foamColor}
      deepColor={props.deepColor}
      shallowColor={props.shallowColor}
      opacity={props.opacity}
      wireframe={props.wireframe}
      seaBedColor={props.seaBedColor}
      seaBedOpacity={props.seaBedOpacity}
      seaBedWaterTint={props.seaBedWaterTint}
      seaBedDuneStrength={props.seaBedDuneStrength}
      seaBedDuneWavelength={props.seaBedDuneWavelength}
      seaBedDuneDirection={duneDirection}
      seaBedDuneSharpness={props.seaBedDuneSharpness}
      bodyMaxOpacity={props.bodyMaxOpacity}
      bodyShimmer={props.bodyShimmer}
      surfaceVisible={props.surfaceVisible}
      bodyVisible={props.bodyVisible}
      bedVisible={props.bedVisible}
      sunDirection={[-1, 2, -3]}
      sunShininess={100}
    >
      {props.floaters && <FloatingBoxes contactFoam={props.contactFoam} />}
    </Ocean>
  );
};

const range = (min: number, max: number, step: number) => ({
  control: { type: 'range' as const, min, max, step },
});

/**
 * Standalone showcase of the {@link Ocean} component using the default React
 * Three Fiber render loop. Each story builds the ocean geometry a different
 * way:
 *
 * - **Plane** — a flat `createOceanPlane` surface (no body / sea bed).
 * - **Circle** — a built-in Three.js `CircleGeometry` flipped onto the X/Z
 *   plane (normals up) used directly as the ocean surface.
 * - **Box** — `createOceanBox`: surface + water-body walls + a procedural sea
 *   bed.
 * - **Ellipse** — `createOceanEllipseBox`: a round box (circle when width and
 *   height match, oval otherwise) — a smooth outline for very large water bodies
 *   that avoids the hard corners of a rectangle.
 * - **Polygon** — `createOceanBoxFromPolygon`: a box whose footprint follows a
 *   field-outline polygon (with holes) parsed from GeoJSON.
 * - **Surface** — `createOceanBoxFromSurface`: a box whose sea bed is the
 *   bathymetry of a selectable depth surface. (The surfaces bundled with this
 *   repo are subsurface sediment horizons rather than real sea beds; they are
 *   used only to demonstrate the feature.)
 *
 * @group Components
 */
const meta = {
  title: 'Components/Misc/Ocean',
  component: OceanDemo,
  argTypes: {
    variant: {
      options: ['plane', 'circle', 'box', 'ellipse', 'polygon', 'surface'],
      control: { type: 'radio' },
      table: { category: 'Geometry' },
    },
    surfaceId: {
      options: Object.keys(surfaceOptions),
      control: { type: 'select', labels: surfaceOptions },
      table: { category: 'Geometry' },
    },
    polygonId: {
      options: Object.keys(polygonOptions),
      control: { type: 'select', labels: polygonOptions },
      table: { category: 'Geometry' },
    },
    size: { ...range(1000, 50000, 1000), table: { category: 'Geometry' } },
    sizeZ: { ...range(0, 50000, 1000), table: { category: 'Geometry' } },
    rotation: { ...range(0, 360, 1), table: { category: 'Geometry' } },
    surfaceSegments: { ...range(0, 600, 10), table: { category: 'Geometry' } },
    perimeterSegments: {
      ...range(16, 512, 8),
      table: { category: 'Geometry' },
    },
    bedSegments: { ...range(0, 256, 8), table: { category: 'Geometry' } },
    waterDepth: { ...range(10, 500, 10), table: { category: 'Geometry' } },
    depthVariation: { ...range(0, 200, 5), table: { category: 'Geometry' } },
    maxError: { ...range(0.5, 20, 0.5), table: { category: 'Geometry' } },
    rimSmoothing: { ...range(0, 1, 1), table: { category: 'Geometry' } },

    oceanLevel: { ...range(-500, 500, 10), table: { category: 'Surface' } },
    waveCount: { ...range(1, 64, 1), table: { category: 'Surface' } },
    detailOctaves: { ...range(1, 8, 1), table: { category: 'Surface' } },
    detailScale: { ...range(0, 0.5, 0.01), table: { category: 'Surface' } },
    detailStrength: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    windDirection: { ...range(0, 360, 1), table: { category: 'Surface' } },
    windSpeed: { ...range(0, 25, 0.5), table: { category: 'Surface' } },
    amplitude: { ...range(0, 3, 0.05), table: { category: 'Surface' } },
    directionalSpread: { ...range(0, 3, 0.05), table: { category: 'Surface' } },
    steepness: { ...range(0, 2, 0.05), table: { category: 'Surface' } },
    displacement: {
      control: { type: 'boolean' },
      table: { category: 'Surface' },
    },
    waterOpacity: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    tonalVariation: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    tonalScale: {
      ...range(0, 20, 1),
      table: { category: 'Surface' },
    },
    tonalSharpness: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    tonalColor: { control: { type: 'color' }, table: { category: 'Surface' } },
    reflectionIntensity: {
      ...range(0, 2, 0.05),
      table: { category: 'Surface' },
    },
    foamAmount: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    foamColor: { control: { type: 'color' }, table: { category: 'Surface' } },
    deepColor: { control: { type: 'color' }, table: { category: 'Surface' } },
    shallowColor: {
      control: { type: 'color' },
      table: { category: 'Surface' },
    },
    opacity: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    wireframe: { control: { type: 'boolean' }, table: { category: 'Surface' } },

    seaBedColor: {
      control: { type: 'color' },
      table: { category: 'Body & sea bed' },
    },
    seaBedOpacity: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },
    seaBedWaterTint: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },
    seaBedDuneStrength: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },
    seaBedDuneWavelength: {
      ...range(20, 600, 10),
      table: { category: 'Body & sea bed' },
    },
    seaBedDuneDirection: {
      ...range(0, 360, 1),
      table: { category: 'Body & sea bed' },
    },
    seaBedDuneSharpness: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },
    bodyMaxOpacity: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },
    bodyShimmer: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },

    surfaceVisible: {
      control: { type: 'boolean' },
      table: { category: 'Visibility' },
    },
    bodyVisible: {
      control: { type: 'boolean' },
      table: { category: 'Visibility' },
    },
    bedVisible: {
      control: { type: 'boolean' },
      table: { category: 'Visibility' },
    },

    floaters: {
      control: { type: 'boolean' },
      table: { category: 'Buoyancy' },
    },
    contactFoam: {
      control: { type: 'boolean' },
      table: { category: 'Buoyancy' },
    },
  },
  decorators: [Canvas3dDecorator, DataProviderDecorator],
  parameters: {
    autoClear: true,
    scale: 1000,
    background: '#bcd4e6',
    cameraPosition: [0, 4000, 11000],
  },
} satisfies Meta<typeof OceanDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

const commonArgs = {
  variant: 'box' as OceanVariant,

  size: 10000,
  sizeZ: 0,
  rotation: 0,
  surfaceSegments: 0,
  perimeterSegments: 96,
  bedSegments: 48,
  waterDepth: 120,
  depthVariation: 20,
  maxError: 5,
  rimSmoothing: 0,
  surfaceId: Object.keys(surfaceOptions)[0],
  polygonId: Object.keys(polygonOptions)[0],

  oceanLevel: 0,
  waveCount: 16,
  detailOctaves: 4,
  detailScale: 0.05,
  detailStrength: 0.2,
  windDirection: 45,
  windSpeed: 10,
  amplitude: 1,
  directionalSpread: 1.2,
  steepness: 0.7,
  displacement: false,
  waterOpacity: 0.7,
  tonalVariation: 0.4,
  tonalScale: 4,
  tonalSharpness: 0.5,
  tonalColor: '#cfe3f2',
  reflectionIntensity: 1,
  foamAmount: 0.5,
  foamColor: '#ffffff',
  deepColor: '#0a2540',
  shallowColor: '#2a7fae',
  opacity: 1,
  wireframe: false,

  seaBedColor: '#b8a06a',
  seaBedOpacity: 1,
  seaBedWaterTint: 0.6,
  seaBedDuneStrength: 0.15,
  seaBedDuneWavelength: 180,
  seaBedDuneDirection: 30,
  seaBedDuneSharpness: 0,
  bodyMaxOpacity: 0.7,
  bodyShimmer: 0,

  surfaceVisible: true,
  bodyVisible: true,
  bedVisible: true,

  floaters: false,
  contactFoam: false,
};

/** Flat ocean surface plane (`createOceanPlane`). */
export const Plane: Story = {
  args: { ...commonArgs, variant: 'plane' },
};

/** Built-in Three.js `CircleGeometry`, flipped onto X/Z, as the ocean surface. */
export const Circle: Story = {
  args: { ...commonArgs, variant: 'circle' },
};

/** Full ocean box with procedural sea bed (`createOceanBox`). */
export const Box: Story = {
  args: { ...commonArgs, variant: 'box' },
};

/** Ocean box following a GeoJSON field-outline polygon (`createOceanBoxFromPolygon`). */
export const Polygon: Story = {
  args: {
    ...commonArgs,
    variant: 'polygon',
    waterDepth: 150,
    depthVariation: 50,
  },
};

/**
 * Ocean box whose sea bed is a selectable depth surface
 * (`createOceanBoxFromSurface`).
 *
 * NOTE: the surfaces available in this repo are subsurface sediment horizons,
 * not real sea-bed surfaces, so the resulting "sea bed" sits far below sea
 * level — this story only showcases the feature. Client applications typically
 * have genuine bathymetry / sea-bed surfaces to feed in instead.
 */
export const Surface: Story = {
  args: { ...commonArgs, variant: 'surface' },
};

/**
 * A few box meshes floating on the waves, demonstrating `useBuoyancy`. Each box
 * is a child of `<Ocean>` and samples the live wave field at its corners to
 * heave/pitch/roll with the surface. Raise the wind speed for a livelier sea.
 */
export const Buoyancy: Story = {
  args: {
    ...commonArgs,
    variant: 'plane',
    floaters: true,
    contactFoam: true,
    windSpeed: 20,
    amplitude: 2,
  },
};
