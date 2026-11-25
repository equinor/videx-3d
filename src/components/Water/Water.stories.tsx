import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BufferGeometry, CircleGeometry, Group } from 'three';
import { Water, useData } from '../../main';
import {
  createWaterBox,
  createWaterBoxFromPolygon,
  createWaterBoxFromSurface,
  createWaterEllipseBox,
  createWaterPlane,
  SurfaceMeta,
  Vec2,
  Vec3,
} from '../../sdk';
import { createDemoMultiPolygon } from '../../storybook/data/demo-polygons';
import { SeaStoryLighting } from '../../storybook/components/SeaStoryLighting';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { useFieldOutline } from '../../storybook/hooks/useFieldOutline';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import storyArgs from '../../storybook/story-args.json';
import { useWaterContact } from './water-contact';
import { DEFAULT_WATER_WIND_SPEED, WaterContact } from './water-material';
import { BuoyancyPoint, useBuoyancy } from './water-sampler';
import type { WaterQuality } from '../../sdk/weather/sea-state';
import {
  waterClarityArgType,
  waterColorArgType,
  waterOpticsArgsOf,
  waterOpticsFromArgs,
} from '../../storybook/components/water-optics-controls';
import { orderArgs } from '../../storybook/components/order-controls';

const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

/** Selectable footprints for the polygon variant, by label. */
const polygonOptions: Record<string, string> = {
  field: 'Field outline (derived from the wells)',
  demo: 'Multi-polygon (with holes)',
};

/**
 * Map to world XY. The northing (Y) is negated because Three.js shapes are
 * authored in the XY plane and the world Z axis points south; after the geometry
 * is rotated onto the XZ plane the orientation comes out correct.
 */
const flipNorthing = (pos: Vec2): Vec2 => [pos[0], -pos[1]];

type WaterVariant =
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
 * A box floating on the ocean, `length` along its heading by `width` across and `height`
 * tall, its draught as the buoyancy settles it. Rendered as a child of `<Water>`, it reads the
 * live wave field via `useBuoyancy` (sampling its four bottom corners) so it heaves/pitches/
 * rolls with the waves. The heading is fixed; only the vertical motion and tilt follow the
 * surface. When `contactFoam` is set it also spreads foam where it meets the water, over its
 * own footprint.
 */
function FloatingBox({
  position,
  length,
  width,
  height,
  heading,
  color,
  contactFoam,
}: Floater & { contactFoam: boolean }) {
  const ref = useRef<Group>(null);
  const halfLength = length / 2;
  const halfWidth = width / 2;
  // The corners in the body's frame (X along its heading): useBuoyancy turns them by the
  // group's heading, rotation.y.
  const points = useMemo<BuoyancyPoint[]>(
    () => [
      [halfLength, halfWidth],
      [halfLength, -halfWidth],
      [-halfLength, halfWidth],
      [-halfLength, -halfWidth],
    ],
    [halfLength, halfWidth],
  );
  useBuoyancy(ref, { points, mass: 0.1 });
  useWaterContact(
    useCallback((): WaterContact | null => {
      const g = ref.current;
      if (!g) return null;
      return {
        x: g.position.x,
        z: g.position.z,
        heading,
        halfLength,
        halfWidth,
        foamWidth: Math.max(halfWidth, 2),
      };
    }, [halfLength, halfWidth, heading]),
    contactFoam,
  );
  return (
    <group ref={ref} position={position} rotation={[0, heading, 0]}>
      <mesh position={[0, height * 0.3, 0]}>
        <boxGeometry args={[length, height, width]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

type Floater = {
  position: [number, number, number];
  /** along its heading, metres */
  length: number;
  /** across it, metres */
  width: number;
  height: number;
  /** radians, from +X toward −Z (as three turns about +Y) */
  heading: number;
  color: string;
};

// What floats on a North Sea field, at its own size: a supply vessel, a workboat and three
// buoys, a few hundred metres apart. The long vessel spans the short waves and only follows
// the swell's heave; the buoys ride every wave.
const FLOATERS: Floater[] = [
  {
    position: [0, 0, 0],
    length: 90,
    width: 20,
    height: 12,
    heading: 0.4,
    color: '#c0392b',
  },
  {
    position: [-180, 0, 140],
    length: 25,
    width: 8,
    height: 5,
    heading: -0.9,
    color: '#e67e22',
  },
  {
    position: [150, 0, -120],
    length: 4,
    width: 4,
    height: 3,
    heading: 0,
    color: '#f1c40f',
  },
  {
    position: [220, 0, 160],
    length: 4,
    width: 4,
    height: 3,
    heading: 0,
    color: '#f1c40f',
  },
  {
    position: [-60, 0, -220],
    length: 4,
    width: 4,
    height: 3,
    heading: 0,
    color: '#f1c40f',
  },
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
  variant: WaterVariant;

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
  edgeSmoothing: number;
  surfaceId: string;
  polygonId: string;

  // Placement / appearance
  waterLevel: number;
  quality: WaterQuality;
  detailOctaves: number;
  detailScale: number;
  windDirection: number;
  windSpeed: number;
  steepness: number;
  displacement: boolean;
  /** the water's look (`optics`): the colour of water too deep to see through */
  opticsColor: string;
  /** and how far one sees through it, metres */
  opticsClarity: number;
  reflectionIntensity: number;
  foamAmount: number;
  foamColor: string;
  opacity: number;
  wireframe: boolean;

  // Sea bed / body (box, polygon, surface variants)
  bedColor: string;
  bedOpacity: number;
  bedDuneStrength: number;
  bedDuneWavelength: number;
  bedDuneDirection: number;
  bedDuneSharpness: number;
  bodyMaxOpacity: number;
  bodyShimmer: number;

  // Group visibility
  surfaceVisible: boolean;
  bodyVisible: boolean;
  bedVisible: boolean;

  // Buoyancy demo
  floaters: boolean;
  contactFoam: boolean;

  /** the studio HDR as the scene's environment, which the sea then reflects */
  studioEnvironment: boolean;
};

// The story's sun, which the sea's glint takes (its scene's brightest directional light).
const SUN_DIRECTION: Vec3 = [-1, 2, -3];

const WaterDemo = (props: ExampleProps) => {
  const data = useData();
  const surfaceMetaDict = useSurfaceMetaDict();
  const fieldOutlineXY = useFieldOutline({ transform: flipNorthing });

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
        surface: createWaterPlane({
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
        createWaterBox({
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
        createWaterEllipseBox({
          size: sizeXZ,
          perimeterSegments: props.perimeterSegments,
          radialSegments: props.bedSegments,
          waterDepth: props.waterDepth,
          depthVariation: props.depthVariation,
          rotation: props.rotation,
        }),
      );
    } else if (props.variant === 'polygon') {
      const geometry =
        props.polygonId === 'demo' ? createDemoMultiPolygon() : fieldOutlineXY;
      if (geometry) {
        geometry.centralize();
        apply(
          createWaterBoxFromPolygon(geometry, {
            waterDepth: props.waterDepth,
            depthVariation: props.depthVariation,
            surfaceSegments: props.surfaceSegments,
            bedSegments: props.bedSegments,
          }),
        );
      }
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
              createWaterBoxFromSurface(
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
                  edgeSmoothing: props.edgeSmoothing,
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
    props.edgeSmoothing,
    props.surfaceId,
    props.polygonId,
    fieldOutlineXY,
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
    const rad = (props.bedDuneDirection * Math.PI) / 180;
    return [Math.cos(rad), Math.sin(rad)];
  }, [props.bedDuneDirection]);

  const optics = useMemo(
    () => waterOpticsFromArgs(props.opticsColor, props.opticsClarity),
    [props.opticsColor, props.opticsClarity],
  );

  // Center the geometry at the world origin so every variant frames nicely with
  // the default camera, regardless of its native extent or origin offset.
  const position = useMemo<[number, number, number]>(() => {
    if (!geometries) return [0, props.waterLevel, 0];
    geometries.surface.computeBoundingBox();
    const b = geometries.surface.boundingBox;
    if (!b) return [0, props.waterLevel, 0];
    return [
      -(b.min.x + b.max.x) / 2,
      props.waterLevel,
      -(b.min.z + b.max.z) / 2,
    ];
  }, [geometries, props.waterLevel]);

  if (!geometries) return null;

  return (
    <>
      <SeaStoryLighting
        sunDirection={SUN_DIRECTION}
        environment={props.studioEnvironment}
      />
      <Water
        quality={props.quality}
        detailOctaves={props.detailOctaves}
        detailScale={props.detailScale}
        skyColor="#465a6a"
        name="Water"
        geometry={geometries.surface}
        bodyGeometry={geometries.body}
        bedGeometry={geometries.bed}
        position={position}
        windDirection={wind}
        windSpeed={props.windSpeed}
        steepness={props.steepness}
        displacement={props.displacement}
        optics={optics}
        reflectionIntensity={props.reflectionIntensity}
        foamAmount={props.foamAmount}
        foamColor={props.foamColor}
        opacity={props.opacity}
        wireframe={props.wireframe}
        bedColor={props.bedColor}
        bedOpacity={props.bedOpacity}
        bedDuneStrength={props.bedDuneStrength}
        bedDuneWavelength={props.bedDuneWavelength}
        bedDuneDirection={duneDirection}
        bedDuneSharpness={props.bedDuneSharpness}
        bodyMaxOpacity={props.bodyMaxOpacity}
        bodyShimmer={props.bodyShimmer}
        surfaceVisible={props.surfaceVisible}
        bodyVisible={props.bodyVisible}
        bedVisible={props.bedVisible}
        sunShininess={100}
      >
        {props.floaters && <FloatingBoxes contactFoam={props.contactFoam} />}
      </Water>
    </>
  );
};

const range = (min: number, max: number, step: number) => ({
  control: { type: 'range' as const, min, max, step },
});

/**
 * Standalone showcase of the {@link Water} component using the default React
 * Three Fiber render loop. Each story builds the ocean geometry a different
 * way:
 *
 * - **Plane** — a flat `createWaterPlane` surface (no body / sea bed).
 * - **Circle** — a built-in Three.js `CircleGeometry` flipped onto the X/Z
 *   plane (normals up) used directly as the ocean surface.
 * - **Box** — `createWaterBox`: surface + water-body walls + a procedural sea
 *   bed.
 * - **Ellipse** — `createWaterEllipseBox`: a round box (circle when width and
 *   height match, oval otherwise) — a smooth outline for very large water bodies
 *   that avoids the hard corners of a rectangle.
 * - **Polygon** — `createWaterBoxFromPolygon`: a box whose footprint follows a
 *   polygon with holes — either the field outline derived from the wellbore
 *   trajectories, or a made-up multi-component footprint.
 * - **Surface** — `createWaterBoxFromSurface`: a box whose sea bed is the
 *   bathymetry of a selectable depth surface. (The surfaces bundled with this
 *   repo are subsurface sediment horizons rather than real sea beds; they are
 *   used only to demonstrate the feature.)
 *
 * @group Components
 */
const meta = {
  title: 'Components/Water/Water',
  component: WaterDemo,
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
    edgeSmoothing: { ...range(0, 5, 1), table: { category: 'Geometry' } },

    waterLevel: { ...range(-500, 500, 10), table: { category: 'Surface' } },
    quality: {
      control: { type: 'select' },
      options: ['low', 'medium', 'high', 'ultra'],
      description:
        'How much of the sea state’s waves it draws (`WATER_QUALITY`); `medium` for a mid-range laptop.',
      table: { category: 'Surface' },
    },
    detailOctaves: { ...range(1, 8, 1), table: { category: 'Surface' } },
    detailScale: { ...range(0, 0.5, 0.01), table: { category: 'Surface' } },
    windDirection: { ...range(0, 360, 1), table: { category: 'Surface' } },
    windSpeed: { ...range(0, 25, 0.5), table: { category: 'Surface' } },
    steepness: { ...range(0, 2, 0.05), table: { category: 'Surface' } },
    displacement: {
      control: { type: 'boolean' },
      table: { category: 'Surface' },
    },
    opticsColor: waterColorArgType('Surface'),
    opticsClarity: waterClarityArgType('Surface'),
    reflectionIntensity: {
      ...range(0, 2, 0.05),
      table: { category: 'Surface' },
    },
    foamAmount: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    foamColor: { control: { type: 'color' }, table: { category: 'Surface' } },
    opacity: { ...range(0, 1, 0.01), table: { category: 'Surface' } },
    wireframe: { control: { type: 'boolean' }, table: { category: 'Surface' } },

    bedColor: {
      control: { type: 'color' },
      table: { category: 'Body & sea bed' },
    },
    bedOpacity: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },
    bedDuneStrength: {
      ...range(0, 1, 0.01),
      table: { category: 'Body & sea bed' },
    },
    bedDuneWavelength: {
      ...range(20, 600, 10),
      table: { category: 'Body & sea bed' },
    },
    bedDuneDirection: {
      ...range(0, 360, 1),
      table: { category: 'Body & sea bed' },
    },
    bedDuneSharpness: {
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
    studioEnvironment: {
      control: { type: 'boolean' },
      table: { category: 'Sky' },
      description:
        'The studio HDR as `scene.environment`: the sea reflects it in place of its gradient.',
    },
  },
  decorators: [Canvas3dDecorator, DataProviderDecorator],
  parameters: {
    autoClear: true,
    scale: 1000,
    background: '#bcd4e6',
    cameraPosition: [0, 4000, 11000],
    // Its own sun and, when asked, environment (SeaStoryLighting).
    ownLighting: () => true,
  },
} satisfies Meta<typeof WaterDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

// The groups A to Z: many of them.
const commonArgs = orderArgs(
  {
    variant: 'box' as WaterVariant,

    size: 10000,
    sizeZ: 0,
    rotation: 0,
    surfaceSegments: 0,
    perimeterSegments: 96,
    bedSegments: 48,
    waterDepth: 120,
    depthVariation: 20,
    maxError: 5,
    edgeSmoothing: 0,
    surfaceId: Object.keys(surfaceOptions)[0],
    polygonId: Object.keys(polygonOptions)[0],

    waterLevel: 0,
    quality: 'medium' as WaterQuality,
    detailOctaves: 4,
    detailScale: 0.05,
    windDirection: 45,
    windSpeed: DEFAULT_WATER_WIND_SPEED,
    steepness: 1,
    displacement: false,
    opticsColor: waterOpticsArgsOf('realistic').color,
    opticsClarity: waterOpticsArgsOf('realistic').clarity,
    reflectionIntensity: 1,
    foamAmount: 0.5,
    foamColor: '#ffffff',
    opacity: 1,
    wireframe: false,

    bedColor: '#b8a06a',
    bedOpacity: 1,
    bedDuneStrength: 0.15,
    bedDuneWavelength: 180,
    bedDuneDirection: 30,
    bedDuneSharpness: 0,
    bodyMaxOpacity: 0.7,
    bodyShimmer: 0,

    surfaceVisible: true,
    bodyVisible: true,
    bedVisible: true,

    floaters: false,
    contactFoam: false,

    studioEnvironment: false,
  },
  meta.argTypes,
);

/** Flat ocean surface plane (`createWaterPlane`). */
export const Plane: Story = {
  args: { ...commonArgs, variant: 'plane' },
};

/** Built-in Three.js `CircleGeometry`, flipped onto X/Z, as the ocean surface. */
export const Circle: Story = {
  args: { ...commonArgs, variant: 'circle' },
};

/** Full ocean box with procedural sea bed (`createWaterBox`). */
export const Box: Story = {
  args: { ...commonArgs, variant: 'box' },
};

/** Water box following a polygon footprint with holes (`createWaterBoxFromPolygon`). */
export const Polygon: Story = {
  args: {
    ...commonArgs,
    variant: 'polygon',
    waterDepth: 150,
    depthVariation: 50,
  },
};

/**
 * Water box whose sea bed is a selectable depth surface
 * (`createWaterBoxFromSurface`).
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
 * What floats on a North Sea field, at its own size, demonstrating `useBuoyancy`: a 90 m
 * supply vessel, a 25 m workboat and three buoys, each a child of `<Water>` sampling the live
 * wave field at its corners to heave/pitch/roll with the surface, and spreading contact foam.
 * The surface is displaced, so it moves with the waves they ride. A long hull spans the short
 * waves and follows only the long ones; a buoy rides every wave.
 */
export const Buoyancy: Story = {
  args: {
    ...commonArgs,
    variant: 'plane',
    surfaceSegments: 512,
    displacement: true,
    floaters: true,
    contactFoam: true,
    windSpeed: 15,
  },
  parameters: {
    cameraPosition: [330, 110, 330],
    cameraTarget: [0, 0, 0],
  },
};
