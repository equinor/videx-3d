import type { ArgTypes, Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import {
  SKY_PRESETS,
  WEATHER_SYSTEMS_PRESETS,
  weatherPresetOf,
  type SkyPreset,
  type WeatherState,
} from '../../sdk/weather/weather';
import {
  reportSceneryProgress,
  sceneryDecorators,
  sceneryGlobalReliefArgs,
  SceneryGlobalReliefArgs,
  sceneryGlobalReliefArgTypes,
  sceneryHiddenArgTypes,
  sceneryProgressArgs,
} from '../../storybook/components/scenery-controls';
import { SceneryGlobalRelief } from '../../storybook/components/scenery-features';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import type { ProgressArgs } from '../../storybook/decorators/progress-decorator';
import { Weather } from '../Weather/Weather';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { SceneryClouds } from './SceneryClouds';
import { ScenerySea } from './ScenerySea';
import {
  sceneryDefaults,
  type SceneryCloudsQuality,
  type ScenerySun,
} from './scenery-model';

// 3D clouds (`<SceneryClouds>`, documents/clouds.md) over a `Scenery`'s sea at the demo field,
// drawn from the weather of a `<Weather>` around it and lit by the sun: a local weather's layers
// about the field, one at each level (low, middle, high), or a global weather's systems over the
// whole Earth. The weather's clock moves them: they drift with its wind, form and fade.

const DEPTH = 100;
// The clock's rates, in weather seconds a second: real time to an hour a second.
const RATES = [1, 10, 60, 600, 3600];
// A global weather's wind, for the sea's waves.
const GLOBAL_WIND = { speed: 10, from: 240 };

type ClockArgs = {
  quality: SceneryCloudsQuality;
  minutes: number;
  timeScale: number;
} & SceneryGlobalReliefArgs;

// The clouds a `weather` lays, under its clock, over the sea.
const CloudsScene = ({
  weather,
  sun,
  quality,
  minutes,
  timeScale,
  relief,
}: ClockArgs & { weather: WeatherState; sun?: ScenerySun }) => (
  <World frame={demoFrame}>
    <Weather weather={weather} time={minutes * 60} timeScale={timeScale}>
      <Scenery sun={sun} onProgress={reportSceneryProgress}>
        <ScenerySea level={0} depth={DEPTH} />
        <SceneryClouds quality={quality} />
      </Scenery>
    </Weather>
    {relief && <SceneryGlobalRelief depth={DEPTH} />}
  </World>
);

type LocalArgs = ClockArgs & {
  sky: SkyPreset;
  sunAzimuth: number;
  sunElevation: number;
} & ProgressArgs;

const LocalClouds = ({
  sky,
  sunAzimuth,
  sunElevation,
  quality,
  minutes,
  timeScale,
  relief,
}: LocalArgs) => {
  // A new weather only for another sky: the `Weather` takes a new object as a new weather.
  const weather = useMemo(() => weatherPresetOf(sky), [sky]);
  return (
    <CloudsScene
      weather={weather}
      sun={{ azimuth: sunAzimuth, elevation: sunElevation }}
      quality={quality}
      minutes={minutes}
      timeScale={timeScale}
      relief={relief}
    />
  );
};

type GlobalArgs = ClockArgs & {
  cover: number;
  decks: number;
  seed: number;
} & ProgressArgs;

const GlobalClouds = ({
  cover,
  decks,
  seed,
  quality,
  minutes,
  timeScale,
  relief,
}: GlobalArgs) => {
  const weather = useMemo<WeatherState>(
    () => ({ wind: GLOBAL_WIND, systems: { seed, cover, decks } }),
    [seed, cover, decks],
  );
  return (
    <CloudsScene
      weather={weather}
      quality={quality}
      minutes={minutes}
      timeScale={timeScale}
      relief={relief}
    />
  );
};

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

const clockArgTypes: ArgTypes<ClockArgs> = {
  quality: {
    control: { type: 'inline-radio' },
    options: ['low', 'medium', 'high', 'ultra'],
    description:
      'How much they spend for how they look (`quality`, `CLOUDS_QUALITY`): the share of the screen\u2019s resolution they are marched at, how finely, and their shadows\u2019 map. MEDIUM is sized for a mid-range laptop.',
    table: { category: 'Clouds' },
  },
  minutes: range(
    0,
    240,
    1,
    'Weather',
    'Jump the weather\u2019s clock this many minutes on (`Weather` `time`): the clouds drift with the wind, form and fade.',
  ),
  timeScale: {
    control: { type: 'select' },
    options: RATES,
    description:
      'Weather seconds a second (`Weather` `timeScale`): 1 is real time, 3600 an hour a second.',
    table: { category: 'Weather' },
  },
  ...sceneryGlobalReliefArgTypes,
};

const clockArgs: ClockArgs = {
  quality: sceneryDefaults.clouds.quality,
  minutes: 0,
  timeScale: 1,
  ...sceneryGlobalReliefArgs,
};

/**
 * 3D clouds (`<SceneryClouds>`) from a `<Weather>`, lit by the `Scenery`'s sun: a local
 * weather's layers about the field, or a global weather's systems over the whole Earth.
 */
const meta = {
  title: 'Components/Scenery/Clouds',
  decorators: [
    Canvas3dDecorator,
    // The relief's tiles, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    // From sea level to the whole Earth.
    far: 50000000,
    ownLighting: () => true,
  },
} satisfies Meta;

export default meta;

/**
 * A local weather (`weatherPresetOf`): a sky's layers by name (`SKY_PRESETS`), one at each
 * level, about the field and none beyond, with its wind. From 3 km over the field, looking out
 * over the clouds.
 */
export const Local: StoryObj<LocalArgs> = {
  render: args => <LocalClouds {...args} />,
  parameters: {
    cameraPosition: [-9000, 3000, 9000],
    cameraTarget: [6000, 1200, -6000],
  },
  args: {
    ...sceneryProgressArgs,
    ...clockArgs,
    sky: 'scattered',
    sunAzimuth: sceneryDefaults.sun.azimuth,
    sunElevation: 20,
  },
  argTypes: {
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    sky: {
      control: { type: 'select' },
      options: Object.keys(SKY_PRESETS),
      description:
        'The sky (`weatherPresetOf`, `SKY_PRESETS`): its layers, each at a level and the heights it lies at in that weather, and its wind. `scattered`: an afternoon\u2019s cumulus, a few cirrus far above; `unsettled`: cumulus, altocumulus and cirrus, one at each level.',
      table: { category: 'Weather' },
    },
    ...clockArgTypes,
    sunAzimuth: range(
      0,
      360,
      1,
      'Sun',
      'Compass bearing of the sun, in degrees (`sun.azimuth`).',
    ),
    sunElevation: range(
      -10,
      90,
      0.5,
      'Sun',
      'Degrees above the horizon (`sun.elevation`): a low sun lights the clouds from the side.',
    ),
  },
};

/**
 * A global weather (`systems`): fronts and cyclones, clear highs and fields of convection over
 * the whole Earth, from 200 km up over the field.
 */
export const Global: StoryObj<GlobalArgs> = {
  render: args => <GlobalClouds {...args} />,
  parameters: {
    cameraPosition: [0, 200000, 120000],
    cameraTarget: [0, 0, 0],
  },
  args: {
    ...sceneryProgressArgs,
    ...clockArgs,
    ...WEATHER_SYSTEMS_PRESETS.high,
    seed: 0,
  },
  argTypes: {
    ...sceneryHiddenArgTypes(sceneryProgressArgs),
    cover: range(
      0,
      1,
      0.05,
      'Weather',
      'How much of the Earth lies under cloud (`systems.cover`), a share of what all the systems lay: lower, the systems smaller, their edges further in (`WEATHER_SYSTEMS_PRESETS`: low 0.35, medium 0.6, high 1).',
    ),
    decks: range(
      0,
      1,
      0.05,
      'Weather',
      'How much of the cloud lies in decks and sheets, and how thick (`systems.decks`): 0, all heaped and broken, thinner (`WEATHER_SYSTEMS_PRESETS`: low 0, medium 0.35, high 1).',
    ),
    seed: range(
      0,
      20,
      1,
      'Weather',
      'Which weather (`systems.seed`): another seed is other systems, elsewhere.',
    ),
    ...clockArgTypes,
  },
};

/** The whole Earth from some 20 000 km, a global weather: its systems. Fly down to the field. */
export const FromSpace: StoryObj<GlobalArgs> = {
  ...Global,
  parameters: {
    cameraPosition: [0, 14000000, 14000000],
    // The Earth's centre, so the globe sits in the middle and the controls orbit it.
    cameraTarget: [0, -6371000, 0],
  },
};
