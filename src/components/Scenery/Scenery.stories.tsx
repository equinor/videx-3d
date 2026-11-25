import { useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { SKY_PRESETS, type SkyPreset } from '../../sdk/weather/weather';
import {
  reportReliefProgress,
  reportSceneryProgress,
  SCENERY_GLOBAL_RELIEF,
  sceneryArgs,
  SceneryArgs,
  sceneryArgTypes,
  sceneryBakedReliefLayer,
  sceneryDecorators,
  sceneryHiddenArgTypes,
  sceneryProgressArgs,
  sceneryPropsFromArgs,
  sceneryReliefFrame,
  sceneryDateAfter,
  scenerySunPosition,
} from '../../storybook/components/scenery-controls';
import {
  formatSunHour,
  useSunClock,
} from '../../storybook/components/scenery-debug-panel';
import {
  SceneryArgsFeatures,
  SceneryDemoField,
  SceneryGlobalRelief,
} from '../../storybook/components/scenery-features';
import { Tanker } from '../../storybook/components/Tanker/Tanker';
import {
  waterClarityArgType,
  waterColorArgType,
  waterOpticsArgsOf,
  waterOpticsFromArgs,
} from '../../storybook/components/water-optics-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import {
  SYNTHETIC_SEABED_ID,
  SYNTHETIC_SEABED_KEY,
} from '../../storybook/data/synthetic-surfaces';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import type { ProgressArgs } from '../../storybook/decorators/progress-decorator';
import storyArgs from '../../storybook/story-args.json';
import { GeoRelief } from '../Layers/GeoRelief';
import { World } from '../World/World';
import { DEFAULT_WATER_WIND_SPEED } from '../Water/water-material';
import { Scenery } from './Scenery';
import { SceneryClouds } from './SceneryClouds';
import { ScenerySea } from './ScenerySea';
import { SceneryStage } from './SceneryStage';
import { SceneryVoid } from './SceneryVoid';
import { sceneryDefaults } from './scenery-model';
import type { SceneryStageBounds } from './scenery-stage';
import { VoidBackground } from './VoidBackground';

// The `<Scenery>`, the world around the data, over the demo field in a `World` placed there:
// the sky and the light that comes from it (a sun, an environment and a light probe), and what
// it holds, each a component of its own: clouds (`SceneryClouds`), an endless sea
// (`ScenerySea`), the void below it (`SceneryVoid`) and a stage about the field
// (`SceneryStage`). The clouds, the void, the relief and the cutaway have stories of their own.

// The field's water depth: the sea's seabed.
const DEPTH = storyArgs.waterDepth;
// The stage's area, scene X/Z about the field's origin: wide enough to hold its wellbores.
const FIELD_BOUNDS: SceneryStageBounds = [-10000, -10000, 10000, 10000];
// A generated surface at the field's water depth, baked into a relief layer by the demo store.
const GENERATED_SEABED = [sceneryBakedReliefLayer(SYNTHETIC_SEABED_ID)];

const range = (
  min: number,
  max: number,
  step: number,
  category: string,
  description: string,
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  table: { category },
});

const toggle = (category: string, description: string) => ({
  control: { type: 'boolean' as const },
  description,
  table: { category },
});

type BasicArgs = {
  background: boolean;
  sunAzimuth: number;
  sunElevation: number;
  sky: boolean;
  voidBackground: boolean;
  clouds: SkyPreset;
  moon: boolean;
  stars: boolean;
} & ProgressArgs;

const BasicScenery = ({
  background,
  sunAzimuth,
  sunElevation,
  sky,
  voidBackground,
  clouds,
  moon,
  stars,
}: BasicArgs) => (
  <World frame={demoFrame}>
    <Scenery
      sun={{ azimuth: sunAzimuth, elevation: sunElevation }}
      sky={sky}
      moon={moon}
      stars={stars}
      background={background}
      onProgress={reportSceneryProgress}
    >
      {/* Its control hidden with the sky off, Storybook leaves `clouds` out. */}
      {clouds && clouds !== 'clear' && <SceneryClouds layers={clouds} />}
      <SceneryVoid />
    </Scenery>
    {!sky && voidBackground && <VoidBackground />}
    <SceneryDemoField reservoir />
  </World>
);

type StageArgs = {
  water: boolean;
  relief: boolean;
  fieldOpacity: number;
  opticsColor: string;
  opticsClarity: number;
  windSpeed: number;
  generatedSeabed: boolean;
} & ProgressArgs;

const StageStory = ({
  water,
  relief,
  fieldOpacity,
  opticsColor,
  opticsClarity,
  windSpeed,
  generatedSeabed,
}: StageArgs) => (
  <World frame={demoFrame}>
    <Scenery onProgress={reportSceneryProgress}>
      <ScenerySea
        level={0}
        depth={DEPTH}
        water={water}
        optics={waterOpticsFromArgs(opticsColor, opticsClarity)}
        windSpeed={windSpeed}
      />
      <SceneryStage boundary={FIELD_BOUNDS} />
    </Scenery>
    {relief && (
      <GeoRelief
        layers={
          generatedSeabed
            ? [...SCENERY_GLOBAL_RELIEF, ...GENERATED_SEABED]
            : SCENERY_GLOBAL_RELIEF
        }
        depth={DEPTH}
        fieldOpacity={fieldOpacity}
        onProgress={reportReliefProgress}
      />
    )}
    <SceneryDemoField />
  </World>
);

type TimelapseArgs = {
  playing: boolean;
  speed: number;
  tanker: boolean;
} & SceneryArgs &
  ProgressArgs;

// A line of text over the canvas, outside the scene.
const ClockOverlay = ({ text }: { text: string }) => {
  const gl = useThree(state => state.gl);
  const [element] = useState(() => document.createElement('div'));
  useEffect(() => {
    Object.assign(element.style, {
      position: 'absolute',
      left: '10px',
      top: '10px',
      padding: '4px 8px',
      font: '13px monospace',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.45)',
      borderRadius: '3px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    (gl.domElement.parentElement ?? document.body).appendChild(element);
    return () => element.remove();
  }, [gl, element]);
  useEffect(() => {
    element.textContent = text;
  }, [element, text]);
  return null;
};

const TimelapseStory = (args: TimelapseArgs) => {
  const { hour, days } = useSunClock(args.sunHour, args.playing, args.speed);
  // On to the next day at midnight: the same date again set the sky back a day.
  const sunDate = sceneryDateAfter(args.sunDate, days);

  const sunArgs = { ...args, sunFromTime: true, sunDate, sunHour: hour };
  const { elevation } = scenerySunPosition(sunArgs);
  // Kept out of the clock's re-render every frame.
  const tanker = useMemo(
    () => args.tanker && <Tanker position={[0, 0, -900]} />,
    [args.tanker],
  );

  // Where the sky is seen from: the sun's place.
  return (
    <World frame={sceneryReliefFrame(args)} globe={args.globe}>
      <Scenery {...sceneryPropsFromArgs(sunArgs)}>
        <SceneryArgsFeatures
          args={args}
          sea={{ level: 0, depth: DEPTH }}
          void={{}}
        />
        <SceneryStage boundary={FIELD_BOUNDS} />
        {tanker}
      </Scenery>
      <SceneryGlobalRelief depth={DEPTH} />
      <ClockOverlay
        text={`${sunDate}  ${formatSunHour(hour)} solar time  sun ${elevation.toFixed(1)}\u00b0`}
      />
    </World>
  );
};

const sharedArgTypes = sceneryArgTypes();

/**
 * The `<Scenery>`: a procedural sky and the light that comes from it, and the features it
 * holds — clouds, an endless sea, the void below it and a stage about the field — over the
 * demo field.
 */
const meta = {
  title: 'Components/Scenery/Scenery',
  decorators: [
    Canvas3dDecorator,
    // The surfaces' and the relief's, read from the store by generators.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    // Past the horizon from 100 km up (1130 km).
    far: 3000000,
    // Over the field from 2 km, looking down along its wellbores.
    cameraPosition: [-6000, 2000, 6000],
    cameraTarget: [0, -1500, 0],
    ownLighting: () => true,
  },
} satisfies Meta;

export default meta;

/**
 * The sky alone over the field: its sun, moon, stars and clouds, and below the sea's level
 * the void (`SceneryVoid`), where the field's wellbores and reservoir lie, lit from below
 * (`subsurface`). The sky lights the scene: a directional sun light, an environment map and a
 * light probe. With `sky` off, whatever is behind the scene shows in its place: here a
 * `VoidBackground`, the void's gradient, which the scene is then lit by.
 */
export const Default: StoryObj<BasicArgs> = {
  render: args => <BasicScenery {...args} />,
  args: {
    ...sceneryProgressArgs,
    background: true,
    sunAzimuth: sceneryDefaults.sun.azimuth,
    sunElevation: 30,
    sky: true,
    voidBackground: true,
    clouds: 'clear',
    moon: true,
    stars: true,
  },
  argTypes: {
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    background: toggle(
      'Scenery',
      'Draw the background behind the scene (`background`): the sky and the void. Off, nothing; switched at once, the scene still lit by the sky.',
    ),
    sunAzimuth: range(
      0,
      360,
      1,
      'Sun',
      'Compass bearing of the sun, in degrees (`sun.azimuth`): 180 is due south.',
    ),
    sunElevation: range(
      -30,
      90,
      0.5,
      'Sun',
      'Degrees above the horizon (`sun.elevation`). Below it, night: the moon and the stars come out and light the scene.',
    ),
    sky: toggle(
      'Sky',
      'Draw the sky (`sky`): the air, the sun\u2019s disc, the moon, the stars and the clouds. Off, whatever is behind the scene shows instead; the sun\u2019s and the moon\u2019s light stay, and the void\u2019s gradient lights the scene.',
    ),
    voidBackground: {
      ...toggle(
        'Sky',
        'With the sky off, the void\u2019s gradient behind the scene (`<VoidBackground />`). Off, the canvas\u2019 own background.',
      ),
      if: { arg: 'sky', truthy: false },
    },
    clouds: {
      control: { type: 'select' },
      options: Object.keys(SKY_PRESETS),
      description:
        'A sky of 3D clouds (`<SceneryClouds layers>`, a `SKY_PRESETS` name), lit by the sun; `clear` for none. Without a `Weather` around the `Scenery` they hold still: see the Clouds stories.',
      if: { arg: 'sky' },
      table: { category: 'Sky' },
    },
    moon: toggle(
      'Sky',
      'The moon (`moon`): a full one opposite the sun, lighting the scene once the sun is down.',
    ),
    stars: {
      ...toggle('Sky', 'Stars, out once it is dark (`stars`).'),
      if: { arg: 'sky' },
    },
  },
};

/**
 * An endless sea (`ScenerySea`) and a stage about the field (`SceneryStage`): real geometry
 * drawing the same sea, so the water lies in front of the wellbores and the seabed over what
 * lies below it. The seabed is the `GeoRelief` in the `World`: the global relief, and here a
 * generated seabed of the field's own at its water depth over it.
 */
export const Stage: StoryObj<StageArgs> = {
  render: args => <StageStory {...args} />,
  parameters: { store: { syntheticScenarios: [SYNTHETIC_SEABED_KEY] } },
  args: {
    ...sceneryProgressArgs,
    water: true,
    relief: true,
    fieldOpacity: 0.6,
    // Clear, to see the seabed and the wellbores under the sea.
    opticsColor: waterOpticsArgsOf('clear').color,
    opticsClarity: waterOpticsArgsOf('clear').clarity,
    windSpeed: DEFAULT_WATER_WIND_SPEED,
    generatedSeabed: true,
  },
  argTypes: {
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    water: toggle(
      'Sea',
      'The sea\u2019s water (`water`). Off, the seabed lies dry.',
    ),
    opticsColor: waterColorArgType('Sea'),
    opticsClarity: waterClarityArgType('Sea'),
    windSpeed: range(
      0,
      25,
      0.5,
      'Sea',
      'The wind raising the waves, in m/s (`windSpeed`).',
    ),
    relief: toggle(
      'Relief',
      'The relief (`<GeoRelief>`), the sea\u2019s seabed: the global demo relief, flat at the sea\u2019s `depth` where it has no data. Off, there is no seabed: the void opens under the water (see the SceneryVoid stories).',
    ),
    fieldOpacity: {
      ...range(
        0,
        1,
        0.01,
        'Relief',
        'How much of what lies under the seabed it hides over the stage (`fieldOpacity`): below 1 the wellbores show through it. Crossing 1 recompiles the seabed\u2019s materials.',
      ),
      if: { arg: 'relief' },
    },
    generatedSeabed: {
      ...toggle(
        'Relief',
        'A seabed of the field\u2019s own over the global relief: a generated surface at its water depth, baked by the demo store into a relief layer (`<GeoRelief layers>`), the finest.',
      ),
      if: { arg: 'relief' },
    },
  },
};

/**
 * A day over the sea in a few seconds: the sun follows the clock from a date and a place
 * (the Scenery's `observer`), on into the next day past midnight, and the moon, the stars, the
 * light and a sky of clouds follow it.
 */
export const Timelapse: StoryObj<TimelapseArgs> = {
  render: args => <TimelapseStory {...args} />,
  parameters: {
    // Low over the water, looking south and a little up: the sun crosses the view about noon.
    cameraPosition: [0, 40, -1500],
    cameraTarget: [0, 360, 0],
  },
  args: {
    ...sceneryArgs,
    ...sceneryProgressArgs,
    playing: true,
    speed: 0.5,
    sunFromTime: true,
    sunHour: 5,
    // Sooner than the Scenery's own 1000, so the light keeps up with the sun.
    captureMaxWait: 250,
    tanker: true,
    clouds: 'fair',
  },
  argTypes: {
    // Every other scenery arg at its default.
    ...sceneryHiddenArgTypes(sceneryArgs),
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    playing: toggle('Timelapse', 'Run the clock.'),
    speed: range(
      0,
      6,
      0.05,
      'Timelapse',
      'Hours of the day per second. Past midnight the clock goes on into the next day.',
    ),
    sunHour: range(
      0,
      24,
      0.05,
      'Timelapse',
      'The hour the clock starts at, local solar time: 12 is noon. Changing it sets the clock.',
    ),
    sunDate: {
      control: { type: 'text' },
      description:
        'The date the clock starts on, as `YYYY-MM-DD`; it moves on at midnight.',
      table: { category: 'Timelapse' },
    },
    sunLatitude: range(
      -90,
      90,
      0.1,
      'Timelapse',
      'Degrees north. Far north in June the sun never sets; in December it never rises.',
    ),
    clouds: sharedArgTypes.clouds,
    globe: sharedArgTypes.globe,
    tanker: toggle(
      'Sea',
      'A tanker riding the waves, with a foam collar where it meets the water: inside a `Scenery`, floating components work as inside a `Water`.',
    ),
  },
};
