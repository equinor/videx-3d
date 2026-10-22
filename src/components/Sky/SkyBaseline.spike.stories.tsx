import { CameraControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BufferGeometry } from 'three';
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
import {
  skyAbyssFromArgs,
  skyArgs,
  SkyArgs,
  skyArgTypes,
  skyDecorators,
  skyOceanFromArgs,
  skyPropsFromArgs,
} from '../../storybook/components/sky-controls';
import { SkyStoryRendering } from '../../storybook/components/sky-story-rendering';
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
  abyss: boolean;
  abyssLevel: number;
  oceanLevel: number;
  oceanDepth: number;
  stage: boolean;
  stageMargin: number;
  seabedSurface: string;
  seabedRelief: number;
  seabedClip: boolean;
  seabedEdgeSmoothing: number;
  seabedFalloff: number;
  ambientIntensity: number;
  surfaceId: string;
  showSurface: boolean;
  showWells: boolean;
  wellSize: number;
  showCasings: boolean;
  casingSlice: boolean;
  casingRoughness: number;
} & SkyArgs;

// A stage around the wells' outline, with no seabed of its own to hand it.
const FieldStage = (args: SkySpikeArgs) => {
  const outline = useFieldOutline();
  if (!outline) return null;
  const { min, max } = outline.getBounds();
  const m = args.stageMargin;
  return (
    <SkyBoxStage bounds={[min[0] - m, min[1] - m, max[0] + m, max[1] + m]} />
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
      occupant={{ seabed: occupant.mesh }}
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
  const sea = args.skyWater || args.skySeabed;
  const seabedMeta = useStoreSurfaceMeta(args.seabedSurface);
  // Test logic: the sea deepens by the seabed surface's relief, so its top stays at
  // `oceanDepth` and its base meets the flat seabed rather than rising into islands.
  const depth =
    args.oceanDepth +
    (seabedMeta ? args.seabedRelief * (seabedMeta.max - seabedMeta.min) : 0);

  return (
    <>
      <SkyStoryRendering args={args} />
      <ambientLight intensity={args.ambientIntensity} />
      <Sky
        {...skyPropsFromArgs(args)}
        abyss={
          args.abyss && { ...skyAbyssFromArgs(args), level: args.abyssLevel }
        }
        ocean={
          sea && { ...skyOceanFromArgs(args), level: args.oceanLevel, depth }
        }
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
  decorators: [
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...skyDecorators,
  ],
  argTypes: {
    ...skyArgTypes(),
    abyss: {
      control: { type: 'boolean' },
      description:
        'The void below `abyssLevel`, where there is no sea (the sea sets its own at its seabed).',
      table: { category: 'Subsurface' },
    },
    abyssLevel: range(-5000, 5000, 10, 'Subsurface'),
    oceanLevel: range(-1000, 1000, 1, 'Sea'),
    oceanDepth: range(0, 3000, 5, 'Sea'),
    stage: { control: { type: 'boolean' }, table: { category: 'Stage' } },
    stageMargin: range(0, 20000, 100, 'Stage'),
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
    ambientIntensity: range(0, 2, 0.05, 'Environment'),
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
  },
} satisfies Meta<typeof SkySpike>;

export default meta;
type Story = StoryObj<typeof meta>;

// The sky over the field, with the abyss below sea level. Display-referred: it is
// designed to look right without tone mapping.
export const Default: Story = {
  args: {
    ...skyArgs,
    sunElevation: 30,
    abyss: true,
    abyssLevel: 0,
    skyWater: false,
    skySeabed: false,
    oceanLevel: 0,
    oceanDepth: 90,
    stage: false,
    stageMargin: 4000,
    seabedSurface: '',
    seabedRelief: 1,
    seabedClip: false,
    seabedEdgeSmoothing: 0,
    seabedFalloff: 3000,
    ambientIntensity: 0,
    surfaceId: Object.keys(storyArgs.surfaceOptions)[0],
    showSurface: true,
    showWells: true,
    wellSize: 50,
    showCasings: true,
    casingSlice: false,
    casingRoughness: 0.8,
  },
};

// The sky's own sea with nothing in it: fly above it, into the water and below the seabed.
export const Shell: Story = {
  args: {
    ...Default.args,
    skyWater: true,
    skySeabed: true,
    showSurface: false,
    showWells: false,
    showCasings: false,
  },
};

// Volve's wells on a stage around the field's outline.
export const Stage: Story = {
  args: {
    ...Default.args,
    skyWater: true,
    skySeabed: true,
    stage: true,
    showSurface: false,
    showCasings: false,
  },
};
