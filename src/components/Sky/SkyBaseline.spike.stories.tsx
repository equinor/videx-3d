import { CameraControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BufferGeometry, MathUtils } from 'three';
import { CameraLookAtEvent } from '../../events/camera-events';
import { useData } from '../../hooks/useData';
import { useGenerator } from '../../hooks/useGenerator';
import { SurfaceMeta } from '../../sdk/data/types/SurfaceMeta';
import { unpackBufferGeometry } from '../../sdk/geometries/packing';
import { PlanarPolygonGeometry } from '../../sdk/geometries/planar-geometry';
import {
  createClippedSurface,
  SeabedMesh,
} from '../../sdk/geometries/surface-clip';
import { CameraManager } from '../../sdk/managers/CameraManager';
import { Vec2, Vec3 } from '../../sdk/types/common';
import { EnvironmentProbes } from '../../storybook/components/EnvironmentProbes';
import {
  skyCutawayArgs,
  SkyCutawayArgs,
  skyCutawayArgTypes,
  skyCutawayFromArgs,
} from '../../storybook/components/sky-cutaway-controls';
import {
  skyMoonFromArgs,
  skyStarsFromArgs,
  skyCloudsFromArgs,
  skySunArgs,
  SkySunArgs,
  skySunArgTypes,
  skySunFromArgs,
} from '../../storybook/components/sky-sun-controls';
import {
  RendererToneMapping,
  toneMappingArgs,
  ToneMappingArgs,
  toneMappingArgTypes,
} from '../../storybook/components/tone-mapping-controls';
import {
  SYNTHETIC_COLUMN_PREFIX,
  SYNTHETIC_PREFIX,
  syntheticSurfaceIds,
} from '../../storybook/data/synthetic-surfaces';
import { Videx3dBridge } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { useFieldOutline } from '../../storybook/hooks/useFieldOutline';
import { useSurfaceMeta } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../storybook/story-args.json';
import { EventEmitter } from '../EventEmitter/EventEmitter';
import { EventEmitterCallbackEvent } from '../EventEmitter/EventEmitterContext';
import { Surface } from '../Surfaces/Surface';
import {
  surfaceGeometry,
  SurfaceGeometryResponse,
} from '../Surfaces/surface-defs';
import { UtmArea, UtmAreaContext, UtmPosition } from '../UtmArea';
import { Casings, MaterialOptions } from '../Wellbores/Casings/Casings';
import { defaultMaterialOptions } from '../Wellbores/Casings/casings-defs';
import { Trajectory } from '../Wellbores/Trajectory/Trajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';
import { Wells } from '../Wellbores/Wells/Wells';
import { Sky } from './Sky';
import { SkyBoxStage } from './SkyBoxStage';
import { useSkyOcean } from './sky-context';
import { skyStageRim } from './sky-stage';

// The videx `<Sky>` over the demo field: the sky and its light, the abyss, the endless
// sea and a stage, with any surface as the seabed. Owns its canvas so lighting is local.

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const defaultWellbore = storyArgs.defaultWellbore;
// The generated scenarios, without the units of the generated columns.
const SYNTHETIC_SEABEDS = syntheticSurfaceIds.filter(
  id => !id.startsWith(SYNTHETIC_COLUMN_PREFIX),
);

const CAMERA_POSITION: Vec3 = [-6000, 2000, 6000];
const CAMERA_TARGET: Vec3 = [0, -1500, 0];
const CAMERA_FAR = 500000;
const CLEAR_BACKGROUND = '#24282e';

const colorScale = scaleOrdinal([
  'tomato',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab',
]);

type SkySpikeArgs = {
  skyZenith: string;
  skyHorizon: string;
  skyGround: string;
  skyNadir: string;
  skyIntensity: number;
  skyHorizonBlend: number;
  sunSize: number;
  sunGlow: number;
  abyss: boolean;
  abyssLevel: number;
  abyssCeiling: string;
  abyssHorizon: string;
  abyssDepth: string;
  abyssFadeDistance: number;
  abyssTransition: number;
  abyssDarkening: number;
  abyssDetail: number;
  abyssDetailScale: number;
  abyssDepthDetail: number;
  abyssDepthDetailScale: number;
  abyssFalloff: number;
  ocean: boolean;
  seabed: boolean;
  oceanLevel: number;
  oceanDepth: number;
  oceanDeep: string;
  oceanShallow: string;
  oceanBed: string;
  oceanOpacity: number;
  oceanFogDensity: number;
  windSpeed: number;
  windDirection: number;
  oceanSteepness: number;
  foamAmount: number;
  detailScale: number;
  detailStrength: number;
  tonalVariation: number;
  tonalScale: number;
  fresnelPower: number;
  bodyShimmer: number;
  detailFadeStart: number;
  detailFadeEnd: number;
  stage: boolean;
  stageMargin: number;
  stageWater: boolean;
  stageSeabed: boolean;
  seabedSurface: string;
  seabedRelief: number;
  seabedClip: boolean;
  seabedEdgeSmoothing: number;
  seabedFalloff: number;
  environment: boolean;
  envResolution: number;
  environmentIntensity: number;
  lightIntensity: number;
  ambientIntensity: number;
  lightProbe: boolean;
  lightProbeIntensity: number;
  surfaceId: string;
  showSurface: boolean;
  showWells: boolean;
  wellSize: number;
  showCasings: boolean;
  casingSlice: boolean;
  casingRoughness: number;
  showProbes: boolean;
  probeSize: number;
  probeElevation: number;
} & SkyCutawayArgs &
  SkySunArgs &
  ToneMappingArgs;

const FieldStage = (args: SkySpikeArgs) => {
  const outline = useFieldOutline();
  if (!outline) return null;
  const { min, max } = outline.getBounds();
  const m = args.stageMargin;
  return (
    <SkyBoxStage
      bounds={[min[0] - m, min[1] - m, max[0] + m, max[1] + m]}
      occupant={{
        outline,
        water: args.stageWater,
        seabed: args.stageSeabed,
      }}
    />
  );
};

type SeabedOccupant = {
  mesh: SeabedMesh;
  outline: PlanarPolygonGeometry;
};

// A surface's own mesh as the seabed, placed as `Surface` draws it, its relief scaled
// and lifted by `y`: its rim is the occupant's outline.
function createSeabedOccupant(
  surface: BufferGeometry,
  [x, y, z]: Vec3,
  relief: number,
): SeabedOccupant | null {
  const index = surface.getIndex();
  if (!index) return null;
  const positions = Float32Array.from(surface.getAttribute('position').array);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += x;
    positions[i + 1] = positions[i + 1] * relief + y;
    positions[i + 2] += z;
  }
  const mesh: SeabedMesh = {
    positions,
    indices: index.array as Uint32Array | Uint16Array,
  };
  return { mesh, outline: skyStageRim(mesh).outline };
}

// From the store rather than the catalogue file, which lists no generated surfaces.
const useStoreSurfaceMeta = (id: string) => {
  const store = useData();
  const [meta, setMeta] = useState<SurfaceMeta | null>(null);
  useEffect(() => {
    if (!store || !id) {
      setMeta(null);
      return;
    }
    let current = true;
    store
      .get<SurfaceMeta>('surface-meta', id)
      .then(found => current && setMeta(found ?? null));
    return () => {
      current = false;
    };
  }, [store, id]);
  return meta;
};

// Any surface as the seabed, handed to the stage, which draws it as the sea's: its
// deepest point on the sea's seabed at `depth`, its relief scaled.
const SeabedStage = ({
  meta,
  depth,
  ...args
}: SkySpikeArgs & { meta: SurfaceMeta; depth: number }) => {
  const ocean = useSkyOcean();
  const area = useContext(UtmAreaContext);
  const store = useData();
  const field = useFieldOutline();
  const generator = useGenerator<SurfaceGeometryResponse>(surfaceGeometry);
  const [mesh, setMesh] = useState<BufferGeometry | null>(null);

  const place = useMemo(
    () => (meta ? area.utmToArea(meta.header.xori, meta.header.yori) : null),
    [area, meta],
  );

  // As `Surface` builds it, or cut by the field outline; either way in the frame
  // `Surface` places it in.
  useEffect(() => {
    if (!meta || !place) return;
    let current = true;
    const built = args.seabedClip
      ? field &&
        store?.get<Float32Array>('surface-values', meta.id).then(values =>
          values
            ? createClippedSurface(values, meta.header, {
                polygon: field,
                referenceDepth: meta.max,
                worldPosition: [place[0], place[2]],
                cutHoles: true,
                edgeSmoothing: args.seabedEdgeSmoothing,
              })
            : null,
        )
      : generator?.(meta.id, 5, true, args.seabedEdgeSmoothing).then(
          response => (response ? unpackBufferGeometry(response) : null),
        );
    built?.then(geometry => {
      if (current) setMesh(geometry);
      else geometry?.dispose();
    });
    return () => {
      current = false;
    };
  }, [
    generator,
    store,
    meta,
    place,
    field,
    args.seabedClip,
    args.seabedEdgeSmoothing,
  ]);

  useEffect(() => () => mesh?.dispose(), [mesh]);

  const lift = args.oceanLevel - depth + args.seabedRelief * meta.max;
  const occupant = useMemo(
    () =>
      mesh && place
        ? createSeabedOccupant(
            mesh,
            [place[0], place[1] + lift, place[2]],
            args.seabedRelief,
          )
        : null,
    [mesh, place, lift, args.seabedRelief],
  );

  if (!occupant || !ocean || !args.stage) return null;
  const { min, max } = occupant.outline.getBounds();
  const m = args.stageMargin;
  return (
    <SkyBoxStage
      bounds={[min[0] - m, min[1] - m, max[0] + m, max[1] + m]}
      occupant={{
        outline: occupant.outline,
        water: args.stageWater,
        seabed: args.stageSeabed ? occupant.mesh : false,
      }}
      seabedFalloff={args.seabedFalloff}
    />
  );
};

const Field = (args: SkySpikeArgs) => {
  const wellbores = useWellboreHeaders();
  const surfaces = useSurfaceMeta();
  const [selected, setSelected] = useState(defaultWellbore);

  const casingMaterials = useCallback<MaterialOptions>(
    section => {
      const options = defaultMaterialOptions(section);
      if (section.type.toLowerCase().includes('shoe')) return options;
      return {
        ...options,
        primary: { ...options.primary, roughness: args.casingRoughness },
      };
    },
    [args.casingRoughness],
  );

  const included = useMemo(() => wellbores.map(d => d.id), [wellbores]);
  const surface = useMemo(
    () => surfaces.find(d => d.id === args.surfaceId) ?? null,
    [surfaces, args.surfaceId],
  );

  return (
    <UtmArea origin={origin} utmZone={utmZone}>
      {args.showSurface && surface && (
        <UtmPosition
          easting={surface.header.xori}
          northing={surface.header.yori}
        >
          <Surface
            meta={surface}
            useColorRamp
            colorRamp={3}
            rampMin={surface.displayMin}
            rampMax={surface.displayMax}
            showContours
            contoursInterval={25}
          />
        </UtmPosition>
      )}
      {args.showWells && (
        <Wells
          wellbores={wellbores}
          included={included}
          renderWellbore={(wellbore, fromMsl) => (
            <UtmPosition
              easting={wellbore.easting}
              northing={wellbore.northing}
            >
              <Wellbore
                id={wellbore.id}
                fromMsl={fromMsl}
                onPointerClick={(event: EventEmitterCallbackEvent) => {
                  setSelected(event.ref);
                  if (event.position) {
                    dispatchEvent(
                      new CameraLookAtEvent({
                        position: event.camera.position.toArray(),
                        target: event.position,
                      }),
                    );
                  }
                }}
                onPointerEnter={(event: EventEmitterCallbackEvent) => {
                  event.domElement.style.cursor = 'pointer';
                }}
                onPointerLeave={(event: EventEmitterCallbackEvent) => {
                  event.domElement.style.cursor = '';
                }}
              >
                <Trajectory
                  // Inside the innermost casing when they show.
                  radius={
                    (args.showCasings && wellbore.id === selected
                      ? 0.02
                      : 0.1) * args.wellSize
                  }
                  color={colorScale(wellbore.well)}
                />
                {args.showCasings && wellbore.id === selected && (
                  <Casings
                    sizeMultiplier={args.wellSize}
                    sliceAngle={args.casingSlice ? Math.PI : 0}
                    autoSlicePosition={args.casingSlice}
                    materialOptions={casingMaterials}
                  />
                )}
              </Wellbore>
            </UtmPosition>
          )}
        />
      )}
    </UtmArea>
  );
};

const SkyScene = (args: SkySpikeArgs) => {
  const sea = args.ocean || args.seabed;
  const seabedMeta = useStoreSurfaceMeta(args.seabedSurface);
  // Test logic: the sea deepens by the seabed surface's relief, so its top stays at
  // `oceanDepth` and its base meets the flat seabed rather than rising into islands.
  const depth =
    args.oceanDepth +
    (seabedMeta ? args.seabedRelief * (seabedMeta.max - seabedMeta.min) : 0);

  return (
    <>
      <RendererToneMapping
        toneMapping={args.toneMapping}
        exposure={args.exposure}
      />
      <ambientLight intensity={args.ambientIntensity} />
      <Sky
        sun={{
          ...skySunFromArgs(args),
          intensity: args.lightIntensity,
          size: args.sunSize,
          glow: args.sunGlow,
        }}
        colors={{
          zenith: args.skyZenith,
          horizon: args.skyHorizon,
          ground: args.skyGround,
          nadir: args.skyNadir,
        }}
        intensity={args.skyIntensity}
        horizonBlend={args.skyHorizonBlend}
        abyss={
          args.abyss && {
            level: args.abyssLevel,
            colors: {
              ceiling: args.abyssCeiling,
              horizon: args.abyssHorizon,
              depth: args.abyssDepth,
            },
            fadeDistance: args.abyssFadeDistance,
            transition: args.abyssTransition,
            darkening: args.abyssDarkening,
            detail: args.abyssDetail,
            detailScale: args.abyssDetailScale,
            depthDetail: args.abyssDepthDetail,
            depthDetailScale: args.abyssDepthDetailScale,
            falloff: args.abyssFalloff,
          }
        }
        ocean={
          sea && {
            water: args.ocean,
            seabed: args.seabed && { color: args.oceanBed },
            level: args.oceanLevel,
            depth,
            deepColor: args.oceanDeep,
            shallowColor: args.oceanShallow,
            waterOpacity: args.oceanOpacity,
            bodyFogDensity: args.oceanFogDensity,
            windSpeed: args.windSpeed,
            // A compass bearing in the controls; Ocean takes world X/Z.
            windDirection: [
              Math.sin(MathUtils.degToRad(args.windDirection)),
              -Math.cos(MathUtils.degToRad(args.windDirection)),
            ],
            steepness: args.oceanSteepness,
            foamAmount: args.foamAmount,
            detailScale: args.detailScale,
            detailStrength: args.detailStrength,
            tonalVariation: args.tonalVariation,
            tonalScale: args.tonalScale,
            fresnelPower: args.fresnelPower,
            bodyShimmer: args.bodyShimmer,
            detailFadeDistance: [args.detailFadeStart, args.detailFadeEnd],
          }
        }
        environment={
          args.environment && {
            intensity: args.environmentIntensity,
            resolution: args.envResolution,
          }
        }
        lightProbe={args.lightProbe && { intensity: args.lightProbeIntensity }}
        cutaway={skyCutawayFromArgs(args)}
        moon={skyMoonFromArgs(args)}
        stars={skyStarsFromArgs(args)}
        clouds={skyCloudsFromArgs(args)}
      >
        {args.seabedSurface
          ? // The seabed stands without the sky's sea; only its stage needs it.
            seabedMeta && (
              <UtmArea origin={origin} utmZone={utmZone}>
                <SeabedStage {...args} meta={seabedMeta} depth={depth} />
              </UtmArea>
            )
          : sea &&
            args.stage && (
              <UtmArea origin={origin} utmZone={utmZone}>
                <FieldStage {...args} />
              </UtmArea>
            )}
      </Sky>
      <Field {...args} />
      {args.showProbes && (
        <EnvironmentProbes
          size={args.probeSize}
          elevation={args.probeElevation}
        />
      )}
    </>
  );
};

const SkySpike = (args: SkySpikeArgs) => {
  const [cameraManager] = useState(() => new CameraManager());

  useEffect(() => () => cameraManager.dispose(), [cameraManager]);

  const initControls = useCallback(
    (controls: CameraControls | null) => {
      cameraManager.setControls(controls);
      if (controls) cameraManager.setTarget(CAMERA_TARGET);
    },
    [cameraManager],
  );

  return (
    <Canvas
      camera={{
        near: 0.1,
        far: CAMERA_FAR,
        position: CAMERA_POSITION,
        fov: 60,
      }}
      dpr={Math.min(2, devicePixelRatio)}
      gl={{ logarithmicDepthBuffer: true }}
      style={{ position: 'absolute', inset: 0, background: CLEAR_BACKGROUND }}
    >
      <EventEmitter>
        <SkyScene {...args} />
      </EventEmitter>
      <Videx3dBridge manager={cameraManager} />
      <CameraControls ref={initControls} makeDefault />
    </Canvas>
  );
};

const range = (min: number, max: number, step: number, category: string) => ({
  control: { type: 'range' as const, min, max, step },
  table: { category },
});

const meta = {
  title: 'Spikes/Sky/Baseline',
  component: SkySpike,
  decorators: [GeneratorsProviderDecorator, DataProviderDecorator],
  argTypes: {
    ...skySunArgTypes('Sky'),
    sunSize: range(0.1, 5, 0.05, 'Sky'),
    sunGlow: range(0, 2, 0.05, 'Sky'),
    skyZenith: { control: { type: 'color' }, table: { category: 'Sky' } },
    skyHorizon: { control: { type: 'color' }, table: { category: 'Sky' } },
    skyGround: { control: { type: 'color' }, table: { category: 'Sky' } },
    skyNadir: { control: { type: 'color' }, table: { category: 'Sky' } },
    skyIntensity: range(0, 3, 0.05, 'Sky'),
    skyHorizonBlend: range(0.001, 0.3, 0.001, 'Sky'),
    abyss: { control: { type: 'boolean' }, table: { category: 'Abyss' } },
    abyssLevel: range(-5000, 5000, 10, 'Abyss'),
    abyssCeiling: { control: { type: 'color' }, table: { category: 'Abyss' } },
    abyssHorizon: { control: { type: 'color' }, table: { category: 'Abyss' } },
    abyssDepth: { control: { type: 'color' }, table: { category: 'Abyss' } },
    abyssFadeDistance: range(500, 100000, 500, 'Abyss'),
    abyssTransition: range(1, 2000, 1, 'Abyss'),
    abyssDarkening: range(0, 20000, 100, 'Abyss'),
    abyssDetail: range(0, 1, 0.01, 'Abyss'),
    abyssDetailScale: range(50, 10000, 50, 'Abyss'),
    abyssDepthDetail: {
      ...range(0, 0.5, 0.01, 'Abyss'),
      description:
        'Faint distant rock in the depths, wavy strata broken by crags; 0 for none.',
    },
    abyssDepthDetailScale: {
      ...range(0.25, 4, 0.05, 'Abyss'),
      description: 'Size of the rock\u2019s features in the depths.',
    },
    abyssFalloff: {
      ...range(0.1, 3, 0.05, 'Abyss'),
      description:
        'How the depths darken below the horizon: the gradient\u2019s exponent. Smaller reaches the depth colour sooner.',
    },
    ocean: {
      description: 'The water. Off with `seabed` on leaves the seabed dry.',
      control: { type: 'boolean' },
      table: { category: 'Ocean' },
    },
    seabed: {
      description:
        'The endless seabed. Off, the void lies below the water, with no lid seen from it; with `ocean` off too, there is no sea.',
      control: { type: 'boolean' },
      table: { category: 'Ocean' },
    },
    oceanLevel: range(-1000, 1000, 1, 'Ocean'),
    oceanDepth: range(0, 3000, 5, 'Ocean'),
    oceanDeep: { control: { type: 'color' }, table: { category: 'Ocean' } },
    oceanShallow: { control: { type: 'color' }, table: { category: 'Ocean' } },
    oceanBed: { control: { type: 'color' }, table: { category: 'Ocean' } },
    oceanOpacity: range(0, 1, 0.01, 'Ocean'),
    oceanFogDensity: range(0, 0.05, 0.0005, 'Ocean'),
    windSpeed: range(0.5, 30, 0.5, 'Ocean'),
    windDirection: range(0, 360, 1, 'Ocean'),
    oceanSteepness: range(0, 2, 0.05, 'Ocean'),
    foamAmount: range(0, 2, 0.05, 'Ocean'),
    detailScale: range(0.005, 0.5, 0.005, 'Ocean'),
    detailStrength: range(0, 1, 0.01, 'Ocean'),
    tonalVariation: range(0, 1, 0.01, 'Ocean'),
    tonalScale: range(0.5, 20, 0.5, 'Ocean'),
    fresnelPower: range(1, 8, 0.1, 'Ocean'),
    bodyShimmer: range(0, 1, 0.01, 'Ocean'),
    detailFadeStart: range(0, 200000, 1000, 'Ocean'),
    detailFadeEnd: range(1000, 400000, 1000, 'Ocean'),
    stage: { control: { type: 'boolean' }, table: { category: 'Stage' } },
    stageMargin: range(0, 20000, 100, 'Stage'),
    stageWater: { control: { type: 'boolean' }, table: { category: 'Stage' } },
    stageSeabed: { control: { type: 'boolean' }, table: { category: 'Stage' } },
    seabedSurface: {
      options: [
        '',
        ...Object.keys(storyArgs.surfaceOptions),
        ...SYNTHETIC_SEABEDS,
      ],
      control: {
        type: 'select',
        labels: {
          '': 'none (the wells\u2019 outline)',
          ...storyArgs.surfaceOptions,
          ...Object.fromEntries(
            SYNTHETIC_SEABEDS.map(id => [
              id,
              id.slice(SYNTHETIC_PREFIX.length),
            ]),
          ),
        },
      },
      table: { category: 'Seabed' },
    },
    seabedRelief: range(0, 3, 0.05, 'Seabed'),
    seabedClip: {
      description:
        'Cut the seabed surface by the field outline (the wells\u2019).',
      control: { type: 'boolean' },
      table: { category: 'Seabed' },
    },
    seabedEdgeSmoothing: range(0, 10, 0.5, 'Seabed'),
    seabedFalloff: range(0, 20000, 100, 'Seabed'),
    ...skyCutawayArgTypes(),
    lightIntensity: range(0, 5, 0.05, 'Lighting'),
    ambientIntensity: range(0, 2, 0.05, 'Lighting'),
    lightProbe: {
      control: { type: 'boolean' },
      table: { category: 'Lighting' },
    },
    lightProbeIntensity: range(0, 3, 0.05, 'Lighting'),
    environment: {
      control: { type: 'boolean' },
      table: { category: 'Lighting' },
    },
    environmentIntensity: range(0, 3, 0.05, 'Lighting'),
    envResolution: {
      options: [64, 128, 256, 512, 1024],
      control: { type: 'select' },
      table: { category: 'Lighting' },
    },
    ...toneMappingArgTypes(),
    surfaceId: {
      options: Object.keys(storyArgs.surfaceOptions),
      control: { type: 'select', labels: storyArgs.surfaceOptions },
      table: { category: 'Scene' },
    },
    showSurface: { control: { type: 'boolean' }, table: { category: 'Scene' } },
    showWells: { control: { type: 'boolean' }, table: { category: 'Scene' } },
    // Trajectory radius 0.1 × this; casings scale their real diameters by it.
    wellSize: range(1, 200, 1, 'Scene'),
    showCasings: { control: { type: 'boolean' }, table: { category: 'Scene' } },
    casingSlice: {
      control: { type: 'boolean' },
      description: 'Cut the casings open toward the camera.',
      table: { category: 'Scene' },
    },
    casingRoughness: range(0, 1, 0.05, 'Scene'),
    showProbes: { control: { type: 'boolean' }, table: { category: 'Scene' } },
    probeSize: range(10, 1000, 10, 'Scene'),
    probeElevation: {
      ...range(-4000, 2000, 10, 'Scene'),
      description:
        'Height of the probes\u2019 centres, metres above sea level.',
    },
  },
} satisfies Meta<typeof SkySpike>;

export default meta;
type Story = StoryObj<typeof meta>;

// The sky over the field, with the abyss below sea level. Display-referred: it is
// designed to look right without tone mapping.
export const Default: Story = {
  args: {
    sunSize: 0.75,
    sunGlow: 0.5,
    skyZenith: '#6f8fb3',
    skyHorizon: '#c9d3dc',
    skyGround: '#7a7f86',
    skyNadir: '#3a3e44',
    skyIntensity: 1,
    skyHorizonBlend: 0.04,
    abyss: true,
    abyssLevel: 0,
    abyssCeiling: '#2a2d32',
    abyssHorizon: '#4a5058',
    abyssDepth: '#0e1013',
    abyssFadeDistance: 20000,
    abyssTransition: 200,
    abyssDarkening: 0,
    abyssDetail: 0.2,
    abyssDetailScale: 1000,
    abyssDepthDetail: 0.08,
    abyssDepthDetailScale: 1,
    abyssFalloff: 0.5,
    ocean: false,
    seabed: false,
    oceanLevel: 0,
    oceanDepth: 90,
    oceanDeep: '#0a2540',
    oceanShallow: '#1b6f8a',
    oceanBed: '#b8a06a',
    oceanOpacity: 0.7,
    oceanFogDensity: 0.004,
    windSpeed: 10,
    windDirection: 90,
    oceanSteepness: 0.7,
    foamAmount: 0.5,
    detailScale: 0.05,
    detailStrength: 0.2,
    tonalVariation: 0.4,
    tonalScale: 4,
    fresnelPower: 4,
    bodyShimmer: 0.5,
    detailFadeStart: 15000,
    detailFadeEnd: 60000,
    stage: false,
    stageMargin: 4000,
    stageWater: true,
    stageSeabed: true,
    seabedSurface: '',
    seabedRelief: 1,
    seabedClip: false,
    seabedEdgeSmoothing: 0,
    seabedFalloff: 3000,
    ...skyCutawayArgs,
    ...skySunArgs,
    sunElevation: 30,
    lightIntensity: 1.5,
    ambientIntensity: 0,
    lightProbe: true,
    lightProbeIntensity: 1,
    environment: true,
    environmentIntensity: 1,
    envResolution: 128,
    ...toneMappingArgs,
    surfaceId: Object.keys(storyArgs.surfaceOptions)[0],
    showSurface: true,
    showWells: true,
    wellSize: 50,
    showCasings: true,
    casingSlice: false,
    casingRoughness: 0.8,
    showProbes: true,
    probeSize: 150,
    probeElevation: 600,
  },
};

// The sky's own sea with nothing in it: fly above it, into the water and below the seabed.
export const Shell: Story = {
  args: {
    ...Default.args,
    ocean: true,
    seabed: true,
    showSurface: false,
    showWells: false,
    showCasings: false,
    showProbes: false,
  },
};

// Volve's wells on a stage: the field outline is the occupant, whose water and seabed can go.
export const Stage: Story = {
  args: {
    ...Default.args,
    ocean: true,
    seabed: true,
    stage: true,
    showSurface: false,
    showCasings: false,
    showProbes: false,
  },
};
