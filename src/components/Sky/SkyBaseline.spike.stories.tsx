import { CameraControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CameraLookAtEvent } from '../../events/camera-events';
import { CameraManager } from '../../sdk/managers/CameraManager';
import { geoFrameFromCrs } from '../../sdk/projection/geo-frame';
import { Vec3 } from '../../sdk/types/common';
import {
  skyAbyssFromArgs,
  skyArgs,
  SkyArgs,
  skyArgTypes,
  skyDecorators,
  skyHideArgType,
  skyHideFromArgs,
  skyOceanFromArgs,
  skyOutlineArgType,
  skyPropsFromArgs,
  skyReliefArgs,
  SkyReliefArgs,
  skyReliefArgTypes,
  skyBakedReliefLayer,
  skyReliefFromArgs,
  skyWallDebugArgs,
  SkyWallDebugArgs,
  skyWallDebugArgTypes,
  skyWallDebugFromArgs,
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
import { demoCrs } from '../../storybook/data/demo-crs';
import { EventEmitter } from '../EventEmitter/EventEmitter';
import { EventEmitterCallbackEvent } from '../EventEmitter/EventEmitterContext';
import { Surface } from '../Surfaces/Surface';
import { UtmArea, UtmPosition } from '../UtmArea';
import { Casings, MaterialOptions } from '../Wellbores/Casings/Casings';
import { defaultMaterialOptions } from '../Wellbores/Casings/casings-defs';
import { Trajectory } from '../Wellbores/Trajectory/Trajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';
import { Wells } from '../Wellbores/Wells/Wells';
import { Sky } from './Sky';
import { SkyBoxStage } from './SkyBoxStage';

// The videx `<Sky>` over the demo field: the sky and its light, the abyss, the endless
// sea and a stage, with any surface as the seabed. Owns its canvas so lighting is local.

const defaultWellbore = storyArgs.defaultWellbore;
// Where the field lies, for its UtmArea, the relief's frame and the sky's place alike.
const crs = demoCrs;
// Where the relief lies around the field: the UtmArea's map.
const reliefFrame = geoFrameFromCrs(crs);
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
  ambientIntensity: number;
  surfaceId: string;
  showSurface: boolean;
  showWells: boolean;
  wellSize: number;
  showCasings: boolean;
  casingSlice: boolean;
  casingRoughness: number;
  hide: string[];
  outline: boolean;
} & SkyArgs &
  SkyReliefArgs &
  SkyWallDebugArgs;

// A stage around the wells' outline, a surface baked into its relief as the seabed.
const FieldStage = (args: SkySpikeArgs) => {
  const outline = useFieldOutline();
  if (!outline) return null;
  const { min, max } = outline.getBounds();
  const m = args.stageMargin;
  return (
    <SkyBoxStage
      bounds={[min[0] - m, min[1] - m, max[0] + m, max[1] + m]}
      relief={skyReliefFromArgs(
        args,
        reliefFrame,
        args.seabedSurface ? [skyBakedReliefLayer(args.seabedSurface)] : [],
      )}
      debug={{ hide: skyHideFromArgs(args.hide).stage, outline: args.outline }}
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
    <UtmArea crsInstance={crs} origin={crs.originUtm}>
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
          sea && {
            ...skyOceanFromArgs(args),
            level: args.oceanLevel,
            depth: args.oceanDepth,
          }
        }
        debug={{
          hide: skyHideFromArgs(args.hide).sky,
          walls: skyWallDebugFromArgs(args),
        }}
      >
        {sea && args.stage && (
          <UtmArea crsInstance={crs} origin={crs.originUtm}>
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
    ...skyReliefArgTypes('stage'),
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
          '': 'none',
          ...storyArgs.surfaceOptions,
          ...Object.fromEntries(
            SYNTHETIC_SEABEDS.map(id => [
              id,
              id.slice(SYNTHETIC_PREFIX.length),
            ]),
          ),
        },
      },
      description:
        'A surface as the seabed: baked into the stage\u2019s relief as its finest layer by the demo store (`surface:<id>`), at its real depth and faded in over 0.5 km from its edge. Over the demo reliefs with `relief` on; alone, the flat seabed around it. \u26a0\ufe0f A horizon far below the sea\u2019s seabed lies under the void\u2019s lid.',
      table: { category: 'Seabed' },
      if: { arg: 'stage' },
    },
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
    hide: skyHideArgType,
    outline: skyOutlineArgType,
    ...skyWallDebugArgTypes,
  },
} satisfies Meta<typeof SkySpike>;

export default meta;
type Story = StoryObj<typeof meta>;

// The sky over the field, with the abyss below sea level. Display-referred: it is
// designed to look right without tone mapping.
export const Default: Story = {
  args: {
    ...skyArgs,
    ...skyReliefArgs,
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
    ambientIntensity: 0,
    surfaceId: Object.keys(storyArgs.surfaceOptions)[0],
    showSurface: true,
    showWells: true,
    wellSize: 50,
    showCasings: true,
    casingSlice: false,
    casingRoughness: 0.8,
    hide: [],
    outline: false,
    ...skyWallDebugArgs,
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
