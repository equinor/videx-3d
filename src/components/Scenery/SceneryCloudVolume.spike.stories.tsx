import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { useArgs, useEffect, useRef } from 'storybook/preview-api';
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
  CLOUD_COVER_OKTAS,
  CLOUD_LEVELS,
  CLOUD_TYPE_HEIGHTS,
  CLOUD_TYPE_LEVELS,
  cloudCoverOf,
  cloudLayerPreset,
  cloudLayersByLevel,
  isSkyPreset,
  oktasToCover,
  SKY_PRESETS,
  WEATHER_LOCAL_RADIUS,
  WEATHER_SYSTEMS_DEFAULTS,
  type CloudCover,
  type CloudLayer,
  type CloudLevel,
  type CloudType,
  type SkyPreset,
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
// The skies a local weather starts from (SKY_PRESETS), or the levels' controls alone.
type WeatherPresetArg = 'custom' | SkyPreset;
const PRESETS = [
  'custom',
  ...(Object.keys(SKY_PRESETS) as SkyPreset[]),
] as WeatherPresetArg[];

// Each level's controls: its cover ('clear' for none), type, base and thickness (metres).
type LevelArgs = {
  [K in CloudLevel as `${K}Cover`]: CloudCover;
} & { [K in CloudLevel as `${K}Type`]: CloudType } & {
  [K in CloudLevel as `${K}Base`]: number;
} & { [K in CloudLevel as `${K}Thickness`]: number } & {
  [K in CloudLevel as `${K}On`]: boolean;
};

type CloudVolumeArgs = {
  panel: boolean;
  volume: boolean;
  /** local: the levels' layers about a middle, none beyond; global: the weather systems */
  weatherMode: 'local' | 'global';
  /** a sky to fill the levels' controls and the wind from (local), or 'custom' */
  preset: WeatherPresetArg;
  /** a local weather's middle (degrees; unset: the anchor as it is first drawn) and radius (km) */
  localLatitude?: number;
  localLongitude?: number;
  localRadius: number;
  systemsSeed: number;
  volumeScale: number;
  density: number;
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
  /** each layer's clouds passing along its level's chain of types (`mixTypes`) */
  mixTypes: boolean;
  /** the waves from the weather's wind (the sea's own wind left out) */
  weatherWind: boolean;
  /** the weather's clock held: the clouds and the waves stand still */
  weatherPaused: boolean;
} & LevelArgs &
  SceneryArgs &
  SceneryReliefArgs &
  ProgressArgs;

// A type's typical heights at a cover (CLOUD_TYPE_HEIGHTS; none for clear), to 10 m.
function heightsOf(cover: CloudCover, type: CloudType) {
  const [least, most] = CLOUD_COVER_OKTAS[cover];
  const share = oktasToCover((least + most) / 2);
  const { base, top } = CLOUD_TYPE_HEIGHTS[type];
  const thickness = top[0] + (top[1] - top[0]) * share - base;
  return { base, thickness: Math.round(thickness / 10) * 10 };
}

// The levels' controls and the wind's for a sky (SKY_PRESETS): its layers' covers, types and
// heights; a level it leaves clear keeps its type, at its typical heights.
function presetArgs(
  preset: SkyPreset,
  args: CloudVolumeArgs,
): Partial<CloudVolumeArgs> {
  const { layers, wind } = SKY_PRESETS[preset];
  const byLevel = cloudLayersByLevel(layers);
  const out: Record<string, unknown> = {
    windSpeed: wind.speed,
    // The sea's controls take the bearing it blows toward.
    windDirection: (wind.from + 180) % 360,
  };
  CLOUD_LEVELS.forEach((level, i) => {
    const layer = byLevel[i];
    if (layer) {
      out[`${level}Cover`] = cloudCoverOf(layer.cover);
      out[`${level}Type`] = layer.type;
      out[`${level}Base`] = layer.base;
      out[`${level}Thickness`] = layer.top - layer.base;
    } else {
      const type = args[`${level}Type`];
      out[`${level}Cover`] = 'clear';
      Object.assign(out, levelHeights(level, heightsOf('clear', type)));
    }
  });
  return out as Partial<CloudVolumeArgs>;
}

// A level's height controls.
const levelHeights = (
  level: CloudLevel,
  { base, thickness }: { base: number; thickness: number },
) => ({ [`${level}Base`]: base, [`${level}Thickness`]: thickness });
// The same, typed for the story's args.
const levelHeightArgs = (
  level: CloudLevel,
  heights: { base: number; thickness: number },
) => levelHeights(level, heights) as Partial<LevelArgs>;

// The local weather's layers from the levels' controls: each level's, as covered, of the type
// and at the heights they say.
function layersFromArgs(args: CloudVolumeArgs): CloudLayer[] {
  return CLOUD_LEVELS.flatMap(level => {
    const cover = args[`${level}Cover`];
    // Clear, or hidden (a global weather's: undefined).
    if (!cover || cover === 'clear') return [];
    const [least, most] = CLOUD_COVER_OKTAS[cover];
    const base = args[`${level}Base`];
    return [
      {
        type: args[`${level}Type`],
        cover: oktasToCover((least + most) / 2),
        base,
        top: base + Math.max(args[`${level}Thickness`], 10),
      },
    ];
  });
}

// The levels drawn: a global weather's toggles; a local one's all (a level left clear has
// none).
function levelsFromArgs(args: CloudVolumeArgs): CloudLevel[] {
  if (args.weatherMode === 'local') return [...CLOUD_LEVELS];
  return CLOUD_LEVELS.filter(level => args[`${level}On`]);
}

// The weather from the story's controls: its wind (the sea's controls give the bearing it
// blows toward, a report its `from`), and local, its layers about its middle; global, the
// weather systems.
function weatherFromArgs(args: CloudVolumeArgs): WeatherState {
  const wind = {
    speed: args.windSpeed,
    from: (args.windDirection + 180) % 360,
  };
  if (args.weatherMode === 'global')
    return { wind, systems: { seed: args.systemsSeed } };
  return {
    wind,
    clouds: layersFromArgs(args),
    local: {
      latitude: args.localLatitude,
      longitude: args.localLongitude,
      radius: args.localRadius * 1000,
    },
  };
}

// Where a double-click on the globe takes the camera: low over the ground or the sea, looking
// up into the middle of the lowest cloud layer some kilometres on (the panel's `fly`).
function flyFromArgs(args: CloudVolumeArgs) {
  const lowest =
    [...layersFromArgs(args)].sort((a, b) => a.base - b.base)[0] ??
    cloudLayerPreset('scattered', 'cumulus')!;
  return {
    height: 300,
    lookAt: 0.5 * (lowest.base + lowest.top),
    ahead: 6000,
  };
}

/**
 * Keeps the weather's controls together: a sky chosen fills the levels' controls and the
 * wind; a level's cover or type changed sets its heights to the type's typical ones; any of a
 * level's controls changed by hand makes the sky 'custom'. `useArgs` is valid only in a
 * decorator.
 */
const cloudWeatherDecorator: Decorator = Story => {
  const [args, updateArgs] = useArgs<CloudVolumeArgs>();
  const seen = useRef<CloudVolumeArgs | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = args;
    // Only within a local weather: switching it hides the levels' controls, whose args then
    // come and go as undefined.
    if (
      !before ||
      args.weatherMode !== 'local' ||
      before.weatherMode !== 'local'
    )
      return;
    let changes: Partial<CloudVolumeArgs> = {};
    if (args.preset !== before.preset && isSkyPreset(args.preset))
      changes = presetArgs(args.preset, args);
    else
      for (const level of CLOUD_LEVELS) {
        const cover = args[`${level}Cover`];
        const type = args[`${level}Type`];
        if (
          cover !== before[`${level}Cover`] ||
          type !== before[`${level}Type`]
        )
          Object.assign(changes, levelHeights(level, heightsOf(cover, type)), {
            preset: 'custom',
          });
        else if (
          args[`${level}Base`] !== before[`${level}Base`] ||
          args[`${level}Thickness`] !== before[`${level}Thickness`]
        )
          Object.assign(changes, { preset: 'custom' });
      }
    const changed = Object.entries(changes).filter(
      ([key, value]) => args[key as keyof CloudVolumeArgs] !== value,
    );
    if (changed.length === 0) return;
    const update = Object.fromEntries(changed) as Partial<CloudVolumeArgs>;
    seen.current = { ...args, ...update };
    updateArgs(update);
  }, [args, updateArgs]);
  return Story();
};

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
              scale={args.volumeScale}
              density={args.density}
              levels={levelsFromArgs(args)}
              quality={args.quality}
              resolution={args.ownQuality ? args.resolution : undefined}
              steps={args.ownQuality ? args.steps : undefined}
              seed={args.volumeSeed}
              temporal={args.temporal}
              terrain={args.cloudTerrain}
              mixTypes={args.mixTypes}
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

const LOCAL = { arg: 'weatherMode', eq: 'local' } as const;
const GLOBAL = { arg: 'weatherMode', eq: 'global' } as const;

const levelCover = (level: CloudLevel, description: string) => ({
  control: { type: 'inline-radio' as const },
  options: COVERS,
  description,
  table: { category: `Weather: ${level}` },
  if: LOCAL,
});

const levelType = (level: CloudLevel, description: string) => ({
  control: { type: 'inline-radio' as const },
  options: LEVEL_TYPES[level],
  description,
  table: { category: `Weather: ${level}` },
  if: LOCAL,
});

const levelHeight = (
  level: CloudLevel,
  min: number,
  max: number,
  description: string,
) => ({
  control: { type: 'range' as const, min, max, step: 50 },
  description,
  table: { category: `Weather: ${level}` },
  if: LOCAL,
});

const levelBase = (level: CloudLevel) =>
  levelHeight(
    level,
    0,
    12000,
    `Height of the ${level} layer’s base over the sea (metres): set to its type’s as its cover or type changes.`,
  );

const levelThickness = (level: CloudLevel) =>
  levelHeight(
    level,
    100,
    6000,
    `How thick the ${level} layer is (metres), from its base to its tops: set to its type’s as its cover or type changes.`,
  );

const levelOn = (level: CloudLevel) => ({
  control: { type: 'boolean' as const },
  description: `Draw the ${level} level (\`levels\`): off, none of the weather systems’ cloud at its level is drawn, and it costs nothing.`,
  table: { category: 'Weather' },
  if: GLOBAL,
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
    cloudWeatherDecorator,
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
    weatherMode: {
      control: { type: 'inline-radio' },
      options: ['local', 'global'],
      description:
        'LOCAL: the weather’s layers (the levels below, or a sky’s) about a middle, within a radius, and no cloud beyond (`WeatherState.local`). GLOBAL: the weather systems over the whole Earth, the scene included — fronts, cyclones, clear highs, cellular convection — each level on or off.',
      table: { category: 'Weather' },
    },
    preset: {
      control: { type: 'select' },
      options: PRESETS,
      description:
        'A sky (`SKY_PRESETS`, `weatherPresetOf`): fills in the levels’ controls and the wind, to change from there. CUSTOM once one is changed by hand.',
      table: { category: 'Weather' },
      if: LOCAL,
    },
    localLatitude: {
      control: { type: 'number', min: -90, max: 90, step: 0.01 },
      description:
        'Latitude of the local weather’s middle (degrees). Unset: where the World’s anchor lies as it is first drawn, kept there as the anchor moves.',
      table: { category: 'Weather' },
      if: LOCAL,
    },
    localLongitude: {
      control: { type: 'number', min: -180, max: 180, step: 0.01 },
      description:
        'Longitude of the local weather’s middle (degrees). Unset, with the latitude: the anchor’s.',
      table: { category: 'Weather' },
      if: LOCAL,
    },
    localRadius: {
      ...range(
        5,
        500,
        5,
        'How far the local weather’s layers reach from its middle (km), thinning out over the outer fifth.',
      ),
      table: { category: 'Weather' },
      if: LOCAL,
    },
    lowOn: levelOn('low'),
    midOn: levelOn('mid'),
    highOn: levelOn('high'),
    systemsSeed: {
      ...range(
        0,
        20,
        1,
        'Other weather systems (`WeatherSystems.seed`): their map is drawn anew over a second or so.',
      ),
      table: { category: 'Weather' },
      if: GLOBAL,
    },
    lowCover: levelCover(
      'low',
      'How much of the sky the low layer covers, as a report says it: CLEAR for none.',
    ),
    lowType: levelType(
      'low',
      'What the low layer is made of: heaped cumulus, a lumpy deck of stratocumulus, an even sheet of stratus, or deep, dark nimbostratus.',
    ),
    lowBase: levelBase('low'),
    lowThickness: levelThickness('low'),
    midCover: levelCover(
      'mid',
      'How much of the sky the middle layer covers (some 4–5 km up): CLEAR for none.',
    ),
    midType: levelType(
      'mid',
      'What the middle layer is made of: small puffs of altocumulus in rows across the wind, or a thin grey sheet of altostratus.',
    ),
    midBase: levelBase('mid'),
    midThickness: levelThickness('mid'),
    highCover: levelCover(
      'high',
      'How much of the sky the high layer covers (some 8–9 km up): CLEAR for none.',
    ),
    highType: levelType(
      'high',
      'What the high layer is made of: streaks of cirrus along the wind, or a milky veil of cirrostratus.',
    ),
    highBase: levelBase('high'),
    highThickness: levelThickness('high'),
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
    mixTypes: {
      control: { type: 'boolean' },
      description:
        'Each layer’s clouds pass along its level’s chain of types (`mixTypes`, `CLOUD_TYPE_CHAINS`), a patch some tens of kilometres across at a time: about the scene by its cover (cumulus closing up spread into stratocumulus, stratus thinning breaks into it), far off by the weather systems. Off: each layer its own type all over.',
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
    // A local weather: the 'scattered' sky (SKY_PRESETS) about the anchor, its wind.
    weatherMode: 'local',
    preset: 'scattered',
    localRadius: WEATHER_LOCAL_RADIUS / 1000,
    windSpeed: SKY_PRESETS.scattered.wind.speed,
    windDirection: (SKY_PRESETS.scattered.wind.from + 180) % 360,
    lowCover: 'scattered',
    lowType: 'cumulus',
    lowBase: 1200,
    lowThickness: 1200,
    midCover: 'clear',
    midType: 'altocumulus',
    ...levelHeightArgs('mid', heightsOf('clear', 'altocumulus')),
    highCover: 'few',
    highType: 'cirrus',
    highBase: 8500,
    highThickness: 800,
    lowOn: true,
    midOn: true,
    highOn: true,
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
    mixTypes: sceneryDefaults.cloudVolume.mixTypes,
    weatherWind: true,
    weatherPaused: false,
  },
} satisfies Meta<typeof CloudVolumeStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The whole Earth from 20 000 km: the weather systems over it (global). Fly down to the field. */
export const Earth: Story = {
  args: { weatherMode: 'global' },
  parameters: {
    cameraPosition: [0, 14000000, 14000000],
    cameraTarget: [0, 0, 0],
  },
};
