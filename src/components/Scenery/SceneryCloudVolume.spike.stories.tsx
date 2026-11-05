import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import {
  sceneryArgs,
  SceneryArgs,
  sceneryArgTypes,
  sceneryDecorators,
  sceneryPropsFromArgs,
  sceneryProgressArgs,
  sceneryReliefArgs,
  SceneryReliefArgs,
  sceneryReliefArgTypes,
  sceneryReliefFrame,
  sceneryReliefFromArgs,
} from '../../storybook/components/scenery-controls';
import {
  SCENERY_DEBUG_HIGH_ALTITUDES,
  SceneryDebugPanel,
  useSceneryTimelapse,
} from '../../storybook/components/scenery-debug-panel';
import { SceneryArgsFeatures } from '../../storybook/components/scenery-features';
import { SceneryStoryRendering } from '../../storybook/components/scenery-story-rendering';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import {
  ProgressArgs,
  progressArgTypes,
} from '../../storybook/decorators/progress-decorator';
import {
  CLOUD_LEVELS,
  CLOUD_TYPE_LEVELS,
  cloudLayerPreset,
  cloudLayersOf,
  SKY_PRESETS,
  WEATHER_SYSTEMS_DEFAULTS,
  type CloudCover,
  type CloudLayer,
  type CloudLayersPreset,
  type CloudLevel,
  type CloudType,
  type WeatherState,
} from '../../sdk/weather/weather';
import { GeoRelief } from '../Layers/GeoRelief';
import { Weather } from '../Weather/Weather';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { SceneryCloudVolume } from './SceneryCloudVolume';
import { SceneryStage } from './SceneryStage';
import { CLOUD_VOLUME_QUALITY } from './scenery-cloud-volume';
import {
  sceneryDefaults,
  type SceneryCloudVolumeQuality,
} from './scenery-model';
import type { SceneryStageBounds } from './scenery-stage';

// The 3D clouds (documents/clouds.md) from sea level to space, driven by a Weather: its cloud
// layers, and its wind raising the waves.

const DEPTH = 100;
const BOUNDS: SceneryStageBounds = [-10000, -10000, 10000, 10000];
const COVERS: CloudCover[] = [
  'clear',
  'few',
  'scattered',
  'broken',
  'overcast',
];
// The types at each level.
const LEVEL_TYPES = Object.fromEntries(
  CLOUD_LEVELS.map(level => [
    level,
    (Object.keys(CLOUD_TYPE_LEVELS) as CloudType[]).filter(
      type => CLOUD_TYPE_LEVELS[type] === level,
    ),
  ]),
) as Record<CloudLevel, CloudType[]>;
// The clouds' own layers by name: skies, and a cover alone (cumulus).
const PRESETS: CloudLayersPreset[] = [
  ...(Object.keys(SKY_PRESETS) as CloudLayersPreset[]),
  'few',
  'broken',
];

type CloudVolumeArgs = {
  panel: boolean;
  volume: boolean;
  /** each level's layer of the weather: its cover ('clear' for none) and type */
  lowCover: CloudCover;
  lowType: CloudType;
  midCover: CloudCover;
  midType: CloudType;
  highCover: CloudCover;
  highType: CloudType;
  /** the clouds' own layers by name (`layers`), whatever the weather's; 'weather' for none */
  layersPreset: 'weather' | CloudLayersPreset;
  systems: number;
  systemsSeed: number;
  volumeScale: number;
  density: number;
  /** each level drawn (`levels`) */
  lowOn: boolean;
  midOn: boolean;
  highOn: boolean;
  quality: SceneryCloudVolumeQuality;
  /** resolution and steps of their own (the controls below) instead of the quality's */
  ownQuality: boolean;
  /** hidden, and so undefined, while ownQuality is off */
  resolution?: number;
  steps?: number;
  volumeSeed: number;
  temporal: boolean;
  /** the clouds shaped by the relief's ground (`terrain`) */
  cloudTerrain: boolean;
  /** the waves from the weather's wind (the sea's own wind left out) */
  weatherWind: boolean;
  /** the weather's clock held: the clouds and the waves stand still */
  weatherPaused: boolean;
} & SceneryArgs &
  SceneryReliefArgs &
  ProgressArgs;

// The weather's layers from the story's controls: one at each level, as covered and of the
// type they say.
function layersFromArgs(args: CloudVolumeArgs): CloudLayer[] {
  return [
    cloudLayerPreset(args.lowCover, args.lowType),
    cloudLayerPreset(args.midCover, args.midType),
    cloudLayerPreset(args.highCover, args.highType),
  ].filter((layer): layer is CloudLayer => layer !== null);
}

// The levels drawn, from the story's toggles.
function levelsFromArgs(args: CloudVolumeArgs): CloudLevel[] {
  const on = { low: args.lowOn, mid: args.midOn, high: args.highOn };
  return CLOUD_LEVELS.filter(level => on[level]);
}

// The weather from the story's controls: its layers, the wind the sea's controls set (the
// bearing they blow toward, as a report's `from`), and the weather systems far off.
function weatherFromArgs(args: CloudVolumeArgs): WeatherState {
  return {
    wind: { speed: args.windSpeed, from: (args.windDirection + 180) % 360 },
    clouds: layersFromArgs(args),
    systems: { strength: args.systems, seed: args.systemsSeed },
  };
}

// Where a double-click on the globe takes the camera: low over the ground or the sea, looking
// up into the middle of the lowest cloud layer some kilometres on (the panel's `fly`).
function flyFromArgs(args: CloudVolumeArgs) {
  const preset = args.layersPreset;
  const layers =
    preset === 'weather' ? layersFromArgs(args) : cloudLayersOf(preset);
  const lowest =
    [...layers].sort((a, b) => a.base - b.base)[0] ??
    cloudLayerPreset('scattered', 'cumulus')!;
  return {
    height: 300,
    lookAt: 0.5 * (lowest.base + lowest.top),
    ahead: 6000,
  };
}

const CloudVolumeStory = (storyArgs: CloudVolumeArgs) => {
  const { args, timelapse } = useSceneryTimelapse(storyArgs);
  const frame = sceneryReliefFrame(args);
  const relief = sceneryReliefFromArgs(args);
  const weatherKey = JSON.stringify(weatherFromArgs(args));
  const weather = useMemo(
    () => JSON.parse(weatherKey) as WeatherState,
    [weatherKey],
  );

  return (
    <World frame={frame} globe={args.globe}>
      <SceneryStoryRendering args={args} />
      {args.panel && (
        <SceneryDebugPanel
          args={args}
          timelapse={timelapse}
          altitudes={SCENERY_DEBUG_HIGH_ALTITUDES}
          fly={flyFromArgs(args)}
        />
      )}
      <Weather
        weather={weather}
        // An hour of weather an hour of the timelapse: the clouds stream past, the systems
        // travel and the waves race with the sun.
        timeScale={timelapse.playing ? timelapse.speed * 3600 : 1}
        paused={args.weatherPaused}
      >
        <Scenery {...sceneryPropsFromArgs(args)}>
          <SceneryArgsFeatures
            args={args}
            ocean={{
              level: 0,
              depth: DEPTH,
              // Left out, so the weather's wind raises the waves.
              ...(args.weatherWind
                ? { windSpeed: undefined, windDirection: undefined }
                : {}),
            }}
            abyss={{}}
          />
          <SceneryStage boundary={BOUNDS} />
          {args.volume && (
            <SceneryCloudVolume
              layers={
                args.layersPreset === 'weather' ? undefined : args.layersPreset
              }
              scale={args.volumeScale}
              density={args.density}
              levels={levelsFromArgs(args)}
              quality={args.quality}
              resolution={args.ownQuality ? args.resolution : undefined}
              steps={args.ownQuality ? args.steps : undefined}
              seed={args.volumeSeed}
              temporal={args.temporal}
              terrain={args.cloudTerrain}
            />
          )}
        </Scenery>
        {relief && <GeoRelief {...relief} />}
      </Weather>
    </World>
  );
};

const SCENERY_DEBUG_ARG_TYPES = sceneryArgTypes({ debug: true });

const range = (
  min: number,
  max: number,
  step: number,
  description: string,
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  table: { category: 'Cloud volume' },
});

const levelCover = (level: CloudLevel, description: string) => ({
  control: { type: 'inline-radio' as const },
  options: COVERS,
  description,
  table: { category: `Cloud volume: ${level}` },
});

const levelType = (level: CloudLevel, description: string) => ({
  control: { type: 'inline-radio' as const },
  options: LEVEL_TYPES[level],
  description,
  table: { category: `Cloud volume: ${level}` },
});

const levelOn = (level: CloudLevel) => ({
  control: { type: 'boolean' as const },
  description: `Draw the ${level} level (\`levels\`): off, neither its layer nor the weather systems’ cloud at its level far off is drawn, and it costs nothing.`,
  table: { category: `Cloud volume: ${level}` },
});

const meta = {
  title: 'Spikes/Scenery/CloudVolume',
  component: CloudVolumeStory,
  decorators: [
    Canvas3dDecorator,
    // The relief's, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    // From sea level to the whole Earth.
    far: 50000000,
    // Over the field from 3 km, looking out over the clouds.
    cameraPosition: [-9000, 3000, 9000],
    cameraTarget: [6000, 1200, -6000],
    ownLighting: () => true,
  },
  argTypes: {
    ...sceneryArgTypes(),
    // How the clouds change the light: the environment's bake, shown.
    tint: SCENERY_DEBUG_ARG_TYPES.tint,
    showEnvironment: SCENERY_DEBUG_ARG_TYPES.showEnvironment,
    ...sceneryReliefArgTypes(),
    ...progressArgTypes,
    panel: {
      control: { type: 'boolean' },
      description:
        'Buttons over the canvas: the camera’s height, moves to set altitudes up to 4000 km, views, and a timelapse of the sun. Double-click the ground or the sea to fly there, 300 m over the highest ground within a kilometre, looking into the cloud layer, level.',
      table: { category: 'Debug' },
    },
    volume: {
      control: { type: 'boolean' },
      description: 'The 3D clouds (`SceneryCloudVolume`).',
      table: { category: 'Cloud volume' },
    },
    lowOn: levelOn('low'),
    lowCover: levelCover(
      'low',
      'How much of the sky the weather’s low layer covers, as a report says it (`cloudLayerPreset`): CLEAR for none.',
    ),
    lowType: levelType(
      'low',
      'What the low layer is made of: heaped cumulus, a lumpy deck of stratocumulus, an even sheet of stratus, or deep, dark nimbostratus.',
    ),
    midOn: levelOn('mid'),
    midCover: levelCover(
      'mid',
      'How much of the sky the weather’s middle layer covers (some 4–5 km up): CLEAR for none.',
    ),
    midType: levelType(
      'mid',
      'What the middle layer is made of: small puffs of altocumulus in rows across the wind, or a thin grey sheet of altostratus.',
    ),
    highOn: levelOn('high'),
    highCover: levelCover(
      'high',
      'How much of the sky the weather’s high layer covers (some 8–9 km up): CLEAR for none.',
    ),
    highType: levelType(
      'high',
      'What the high layer is made of: streaks of cirrus along the wind, or a milky veil of cirrostratus.',
    ),
    layersPreset: {
      control: { type: 'select' },
      options: ['weather', ...PRESETS],
      description:
        'The clouds’ own layers by name (`SceneryCloudVolume`’s `layers`, a `CloudLayersPreset`), whatever the weather’s: a sky (`SKY_PRESETS`), or a cover of cumulus. WEATHER for the weather’s layers above.',
      table: { category: 'Cloud volume' },
    },
    systems: range(
      0,
      1,
      0.05,
      'The weather’s systems (`WeatherSystems.strength`): how far the cover away from the scene follows fronts, cyclones, clear highs and cellular convection over the Earth. Within some 100 km of the scene the cover is the weather’s layers’.',
    ),
    systemsSeed: range(
      0,
      20,
      1,
      'Other weather systems (`WeatherSystems.seed`): their map is drawn anew over a second or so.',
    ),
    volumeScale: range(0.25, 4, 0.05, 'Size of the clouds, relative.'),
    density: range(0.1, 3, 0.05, 'How dense they are inside, relative.'),
    quality: {
      control: { type: 'select' },
      options: ['low', 'medium', 'high', 'ultra'],
      description:
        'How much they spend for how they look (`quality`, `CLOUD_VOLUME_QUALITY`): low and medium march one pixel in four a frame and take the rest from the frames before, high every pixel, ultra finer with more steps.',
      table: { category: 'Cloud volume' },
    },
    ownQuality: {
      control: { type: 'boolean' },
      description:
        'A resolution and steps of their own instead of the quality’s (then without its budget of rays).',
      table: { category: 'Cloud volume' },
    },
    resolution: {
      ...range(
        0.25,
        1,
        0.05,
        'The share of the screen’s resolution their image is drawn at.',
      ),
      if: { arg: 'ownQuality' },
    },
    steps: {
      ...range(8, 128, 1, 'Most steps along each view.'),
      if: { arg: 'ownQuality' },
    },
    volumeSeed: range(0, 20, 1, 'Picks another pattern.'),
    weatherPaused: {
      control: { type: 'boolean' },
      description:
        'Hold the weather’s clock (`Weather` `paused`): the clouds stop drifting and changing, the weather systems stop travelling and the waves stand still. Running, the timelapse (the panel) runs it an hour of weather an hour of the sun’s.',
      table: { category: 'Cloud volume' },
    },
    temporal: {
      control: { type: 'boolean' },
      description:
        'Accumulate the frames (jittered steps and sub-pixel places, the last frames blended in where the view now sees them). Off, each frame stands alone, grainier.',
      table: { category: 'Cloud volume' },
    },
    cloudTerrain: {
      control: { type: 'boolean' },
      description:
        'Shaped by the relief’s ground (`terrain`): the layers rise over high ground, gather on the slopes the wind blows up and part in the lee of ridges, and the ground stands in them. Needs the relief.',
      table: { category: 'Cloud volume' },
    },
    weatherWind: {
      control: { type: 'boolean' },
      description:
        'The waves from the weather’s wind (the sea’s wind controls), the sea’s own wind left out. Off: the sea’s own wind, which wins over the weather’s.',
      table: { category: 'Cloud volume' },
    },
  },
  args: {
    ...sceneryArgs,
    ...sceneryReliefArgs,
    ...sceneryProgressArgs,
    // The band along the horizon off: the volume reaches it on its own.
    clouds: false,
    // Frame rate and frame times, bottom left.
    stats: true,
    relief: true,
    panel: true,
    volume: true,
    lowOn: true,
    midOn: true,
    highOn: true,
    lowCover: 'scattered',
    lowType: 'cumulus',
    midCover: 'clear',
    midType: 'altocumulus',
    highCover: 'clear',
    highType: 'cirrus',
    layersPreset: 'weather',
    systems: WEATHER_SYSTEMS_DEFAULTS.strength,
    systemsSeed: WEATHER_SYSTEMS_DEFAULTS.seed,
    volumeScale: sceneryDefaults.cloudVolume.scale,
    density: sceneryDefaults.cloudVolume.density,
    quality: sceneryDefaults.cloudVolume.quality,
    ownQuality: false,
    resolution: CLOUD_VOLUME_QUALITY.high.resolution,
    steps: CLOUD_VOLUME_QUALITY.high.steps,
    volumeSeed: sceneryDefaults.cloudVolume.seed,
    temporal: sceneryDefaults.cloudVolume.temporal,
    cloudTerrain: sceneryDefaults.cloudVolume.terrain,
    weatherWind: true,
    weatherPaused: false,
  },
} satisfies Meta<typeof CloudVolumeStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The whole Earth from 20 000 km: the same clouds, draped over it. Fly down to the field. */
export const Earth: Story = {
  parameters: {
    cameraPosition: [0, 14000000, 14000000],
    cameraTarget: [0, 0, 0],
  },
};
