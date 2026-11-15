import { useFrame } from '@react-three/fiber';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  type CSSProperties,
  type ReactNode,
  useMemo,
  useEffect as useReactEffect,
  useState as useReactState,
} from 'react';
import { useArgs, useEffect, useRef } from 'storybook/preview-api';
import { CameraLookAtEvent } from '../../events/camera-events';
import type { Vec3 } from '../../sdk/types/common';
import {
  sceneryArgs,
  SceneryArgs,
  sceneryArgTypes,
  sceneryDecorators,
  sceneryPropsFromArgs,
  sceneryWeatherFromArgs,
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
  type SceneryDebugButton,
  type SceneryDebugRow,
} from '../../storybook/components/scenery-debug-panel';
import { SceneryArgsFeatures } from '../../storybook/components/scenery-features';
import { SceneryStoryRendering } from '../../storybook/components/scenery-story-rendering';
import { CloudBenchBridge } from '../../storybook/debug/cloud-bench';
import { setStoryArgs } from '../../storybook/debug/videx3d';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import {
  ProgressArgs,
  progressArgTypes,
} from '../../storybook/decorators/progress-decorator';
import {
  CLOUD_LEVELS,
  CLOUD_TYPE_HEIGHTS,
  CLOUD_TYPE_LEVELS,
  cloudLayersByLevel,
  SKY_PRESETS,
  WEATHER_LOCAL_RADIUS,
  type CloudLayer,
  type CloudLevel,
  type CloudType,
  type SkyPreset,
  type WeatherState,
} from '../../sdk/weather/weather';
import { GeoRelief } from '../Layers/GeoRelief';
import { Weather } from '../Weather/Weather';
import { useWeatherClock } from '../Weather/weather-context';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { SceneryClouds } from './SceneryClouds';
import { SceneryStage } from './SceneryStage';
import {
  CLOUDS_LOOKS,
  CLOUDS_QUALITY,
  cloudsChainLayer,
  type CloudsLook,
} from './scenery-clouds';
import {
  sceneryDefaults,
  type SceneryCloudLook,
  type SceneryCloudsQuality,
  type SceneryCloudsTemporal,
} from './scenery-model';
import type { SceneryStageBounds } from './scenery-stage';

// The 3D clouds (documents/clouds.md) being rebuilt: a local weather's layers, one at each level
// (low, middle, high), each drawn as its type looks, or a global weather's systems, over the
// Scenery's sea, relief and sky as the other Scenery stories set them, from sea level to space,
// without tone mapping. The views to judge them from are the stories below. The panel (top right)
// moves the camera to set altitudes, to views by the level edited, to the whole Earth and, on a
// double-click, under the clouds where it points; runs the weather's clock, which the sun runs on
// with SYNC CLOCKS; and sets each type's look.

// Each level's types, and the skies (SKY_PRESETS).
const TYPES: Record<CloudLevel, CloudType[]> = {
  low: [],
  mid: [],
  high: [],
};
for (const type of Object.keys(CLOUD_TYPE_LEVELS) as CloudType[])
  TYPES[CLOUD_TYPE_LEVELS[type]].push(type);
const PRESETS = Object.keys(SKY_PRESETS) as SkyPreset[];
type PresetArg = 'custom' | SkyPreset;

// Each level's controls: its type, its cover, and its base and top over the sea (metres).
type LevelArgs = {
  [L in CloudLevel as `${L}Type`]: CloudType;
} & {
  [L in CloudLevel as `${L}Cover`]: number;
} & {
  [L in CloudLevel as `${L}Base`]: number;
} & {
  [L in CloudLevel as `${L}Top`]: number;
};

type CloudsArgs = {
  volume: boolean;
  /** the 3D clouds shown: off hides them, still compiled (`enabled`), to time the frame without them */
  cloudsEnabled: boolean;
  /** a local weather (its layers about its middle) or a global one (the weather systems) */
  weatherMode: 'local' | 'global';
  /** a global weather's systems (`WeatherSystems.seed`) */
  systemsSeed: number;
  /** a global weather's levels drawn (`levels`) */
  globalLow: boolean;
  globalMid: boolean;
  globalHigh: boolean;
  /** being chosen: a global weather's look by its place along its chain (`debug.types`) */
  globalTypes: boolean;
  /** being chosen: the low cloud's thickness sets a global weather's depth (`debug.thickness`) */
  globalThickness: boolean;
  /** the relief as the ground the clouds lie over (`terrain`) */
  cloudTerrain: boolean;
  /** being chosen: the ground steers a global weather's systems' wind (`debug.steer`) */
  steer: boolean;
  /** a local weather's clouds lit from light maps (`lightMap`) */
  lightMap: boolean;
  /** how the march reuses the last frames' (`temporal`) */
  temporal: SceneryCloudsTemporal;
  /** a sky to fill the levels' controls and the wind from, or 'custom' */
  preset: PresetArg;
  /** the level the panel's level and look controls set */
  edit: CloudLevel;
  /** how far the level covering most dominates (`dominance`) */
  dominance: number;
  /** each type's look over its defaults (`looks`) */
  looks: Partial<Record<CloudType, SceneryCloudLook>>;
  /** the local weather's middle (degrees; unset: the anchor as it is first drawn) and radius (km) */
  localLatitude?: number;
  localLongitude?: number;
  localRadius: number;
  volumeScale: number;
  density: number;
  quality: SceneryCloudsQuality;
  /** a resolution of its own instead of the quality's */
  ownResolution: boolean;
  resolution?: number;
  volumeSeed: number;
  debugView: 'none' | 'cost' | 'unlit' | 'map';
  /** the air's haze between the clouds and the camera */
  debugAir: boolean;
  /** how far on to jump the weather's clock (minutes): the clouds drift with the wind */
  cloudMinutes: number;
  /** the weather clock's rate (weather seconds a second) */
  cloudRate: number;
  /** the sun on the weather's clock: from the sun's hour, date and place, on as the clock runs */
  syncClocks: boolean;
  /** the weather's clock held: the clouds stand still */
  weatherPaused: boolean;
} & LevelArgs &
  SceneryArgs &
  SceneryReliefArgs &
  ProgressArgs;

// A level's controls for `type` at `cover`, at the type's typical heights (CLOUD_TYPE_HEIGHTS,
// to 10 m).
function levelOf(
  level: CloudLevel,
  type: CloudType,
  cover: number,
): Partial<CloudsArgs> {
  const { base, top } = CLOUD_TYPE_HEIGHTS[type];
  return {
    [`${level}Type`]: type,
    [`${level}Cover`]: cover,
    [`${level}Base`]: base,
    [`${level}Top`]: Math.round((top[0] + (top[1] - top[0]) * cover) / 10) * 10,
  };
}

// The levels' controls and the wind's for a sky: its layers, one a level (none: no cover, at
// the level's first type's heights), and its wind (the sea's controls take the bearing it blows
// toward).
function presetArgs(preset: SkyPreset): Partial<CloudsArgs> {
  const { layers, wind } = SKY_PRESETS[preset];
  const byLevel = cloudLayersByLevel(layers);
  const args: Partial<CloudsArgs> = {
    windSpeed: wind.speed,
    windDirection: (wind.from + 180) % 360,
  };
  CLOUD_LEVELS.forEach((level, k) => {
    const layer = byLevel[k];
    Object.assign(
      args,
      layer
        ? {
            [`${level}Type`]: layer.type,
            [`${level}Cover`]: layer.cover,
            [`${level}Base`]: layer.base,
            [`${level}Top`]: layer.top,
          }
        : levelOf(level, TYPES[level][0], 0),
    );
  });
  return args;
}

// A level's layer from the story's controls; null without cover.
function layerOf(args: CloudsArgs, level: CloudLevel): CloudLayer | null {
  const cover = args[`${level}Cover`];
  if (cover <= 0) return null;
  const base = args[`${level}Base`];
  return {
    type: args[`${level}Type`],
    cover,
    base,
    top: Math.max(args[`${level}Top`], base + 10),
  };
}

// The weather from the story's controls: its wind, swell and haze (the sea and the air take
// them from it), and its layers about its middle, or its weather systems.
function weatherFromArgs(args: CloudsArgs): WeatherState {
  if (args.weatherMode === 'global')
    return {
      ...sceneryWeatherFromArgs(args),
      systems: { seed: args.systemsSeed },
    };
  return {
    ...sceneryWeatherFromArgs(args),
    clouds: CLOUD_LEVELS.map(level => layerOf(args, level)).filter(
      (layer): layer is CloudLayer => !!layer,
    ),
    local: {
      latitude: args.localLatitude,
      longitude: args.localLongitude,
      radius: args.localRadius * 1000,
    },
  };
}

// The levels' controls, to tell what changed.
const levelKeys = CLOUD_LEVELS.flatMap(level =>
  (['Type', 'Cover', 'Base', 'Top'] as const).map(
    key => `${level}${key}` as keyof LevelArgs,
  ),
);

/**
 * Keeps the levels' controls together: a sky chosen fills them and the wind; a level's type
 * changed sets its heights to the type's typical ones; any of them changed by hand makes the sky
 * 'custom'. `useArgs` is valid only in a decorator.
 */
const cloudLayerDecorator: Decorator = Story => {
  const [args, updateArgs] = useArgs<CloudsArgs>();
  const seen = useRef<CloudsArgs | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = args;
    if (!before) return;
    let changes: Partial<CloudsArgs> = {};
    // The sun on the weather's clock: set from the time, its hour, date and place shown.
    if (args.syncClocks && !args.sunFromTime) changes = { sunFromTime: true };
    else if (args.preset !== before.preset && args.preset !== 'custom')
      changes = presetArgs(args.preset);
    else {
      const typed = CLOUD_LEVELS.find(
        level => args[`${level}Type`] !== before[`${level}Type`],
      );
      if (typed)
        changes = {
          ...levelOf(typed, args[`${typed}Type`], args[`${typed}Cover`]),
          preset: 'custom',
        };
      else if (levelKeys.some(key => args[key] !== before[key]))
        changes = { preset: 'custom' };
    }
    const changed = Object.entries(changes).filter(
      ([key, value]) => args[key as keyof CloudsArgs] !== value,
    );
    if (changed.length === 0) return;
    const update = Object.fromEntries(changed) as Partial<CloudsArgs>;
    seen.current = { ...args, ...update };
    updateArgs(update);
  }, [args, updateArgs]);
  return Story();
};

// Where a double-click on the globe takes the camera (the scenery's panel's `fly`): 300 m over
// the ground or the sea, looking into the middle of the level edited some kilometres on: its
// layer's in a local weather, its chain's shell's in a global one.
const flyFromArgs = (args: CloudsArgs) => {
  const chain =
    args.weatherMode === 'global' ? cloudsChainLayer(args.edit) : null;
  const base = chain?.base ?? args[`${args.edit}Base`];
  const top = chain?.top ?? args[`${args.edit}Top`];
  return { height: 300, lookAt: 0.5 * (base + top), ahead: 6000 };
};

// Views to judge the clouds from by the edited level's heights (scene metres: X east, Z south;
// the local weather's middle at 0, 0): the camera's place and what it looks at. LEVEL in the
// level looking along it, the hardest view to march; HORIZON just over its top.
function viewsOf(args: CloudsArgs): Record<string, [Vec3, Vec3]> {
  const base = args[`${args.edit}Base`];
  const top = Math.max(args[`${args.edit}Top`], base + 10);
  const middle = 0.5 * (base + top);
  return {
    level: [
      [0, middle, 16000],
      [0, middle, 0],
    ],
    over: [
      [-9000, top + 1500, 9000],
      [6000, middle, -6000],
    ],
    below: [
      [0, 40, 0],
      [3000, base + 400, -2000],
    ],
    horizon: [
      [0, top + 200, 0],
      [40000, top, 0],
    ],
    far: [
      [-40000, middle, 40000],
      [0, middle, 0],
    ],
    high: [
      [0, 30000, 20000],
      [0, 0, 0],
    ],
    top: [
      [0, 30000, 1],
      [0, 0, 0],
    ],
  };
}

// The weather clock's rates (weather seconds a second): real time to an hour a second; 0 held.
const RATES = [0, 1, 10, 60, 600, 3600];
// The seabed under the sea, and the stage about the field (as the other Scenery stories lay them).
const DEPTH = 100;
const BOUNDS: SceneryStageBounds = [-5000, -5000, 5000, 5000];

// A type's look's sliders.
const LOOK_SLIDERS: [keyof CloudsLook, number, number, number][] = [
  ['scale', 0.1, 5, 0.05],
  ['stretch', 1, 10, 0.1],
  ['softness', 0, 1, 0.01],
  ['lumps', 0, 1, 0.01],
  ['towering', 0, 1, 0.01],
  ['masses', 0, 1.5, 0.01],
  ['extinction', 0.0005, 0.06, 0.0005],
  ['lifetime', 60, 14400, 60],
  ['rise', 0, 5, 0.1],
];

const ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 3,
};
const BUTTON: CSSProperties = { fontSize: 11, padding: '1px 5px' };
const ON: CSSProperties = { ...BUTTON, fontWeight: 'bold' };

// A slider: shown as it is dragged, set as it is let go.
const PanelSlider = ({
  label,
  value,
  min,
  max,
  step,
  set,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  set: (value: number) => void;
}) => {
  const [shown, setShown] = useReactState(value);
  useReactEffect(() => setShown(value), [value]);
  const commit = () => {
    if (shown !== value) set(shown);
  };
  return (
    <label style={ROW}>
      <span style={{ width: 92 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        style={{ flex: 1, minWidth: 0 }}
        onChange={event => setShown(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <span style={{ width: 40, textAlign: 'right' }}>{shown}</span>
    </label>
  );
};

// A row of buttons, one an option, the chosen ones bold.
function Choices<T>({
  label,
  options,
  chosen,
  name = String,
  pick,
}: {
  label: string;
  options: readonly T[];
  chosen: (option: T) => boolean;
  name?: (option: T) => string;
  pick: (option: T) => void;
}) {
  return (
    <div style={ROW}>
      <span style={{ width: 62 }}>{label}</span>
      {options.map(option => (
        <button
          key={name(option)}
          style={chosen(option) ? ON : BUTTON}
          onClick={() => pick(option)}
        >
          {name(option)}
        </button>
      ))}
    </div>
  );
}

// All the clouds' types, for their looks.
const ALL_TYPES = Object.keys(CLOUDS_LOOKS) as CloudType[];

// The story's args changed from the panel (in the scenery panel's own React root, outside the
// decorators that `useArgs` is valid in).
const update = (args: Partial<CloudsArgs>) => void setStoryArgs(args);

// Each type's look, which has no Storybook control of its own: shown with LOOKS, a type picked,
// its sliders, and its look set back to the default.
const LookControls = ({ args }: { args: CloudsArgs }) => {
  const [shown, setShown] = useReactState(false);
  // The type whose look the sliders set: the edited level's to begin with.
  const [type, setType] = useReactState<CloudType>(args[`${args.edit}Type`]);
  const look = { ...CLOUDS_LOOKS[type], ...args.looks[type] };
  return (
    <>
      <div style={ROW}>
        <span style={{ width: 62 }}>looks</span>
        <button style={shown ? ON : BUTTON} onClick={() => setShown(!shown)}>
          {shown ? 'hide' : 'show'}
        </button>
      </div>
      {shown && (
        <>
          <Choices
            label="type"
            options={ALL_TYPES}
            chosen={option => type === option}
            pick={setType}
          />
          {LOOK_SLIDERS.map(([key, min, max, step]) => (
            <PanelSlider
              key={`${type}-${key}`}
              label={key}
              value={look[key]}
              min={min}
              max={max}
              step={step}
              set={value =>
                update({
                  looks: {
                    ...args.looks,
                    [type]: { ...args.looks[type], [key]: value },
                  },
                })
              }
            />
          ))}
          <div style={ROW}>
            <button
              style={BUTTON}
              onClick={() => {
                const looks = { ...args.looks };
                delete looks[type];
                update({ looks });
              }}
            >
              {`${type}'s look as default`}
            </button>
          </div>
        </>
      )}
    </>
  );
};

// The views by the level edited, for the panel's view row; their names apart from its own.
function cloudViews(args: CloudsArgs): SceneryDebugButton[] {
  const names: Record<string, string> = {
    level: 'in level',
    horizon: 'over top',
  };
  return Object.entries(viewsOf(args)).map(([key, [position, target]]) => ({
    label: names[key] ?? key,
    title: `A view by the ${args.edit} level (EDIT)`,
    click: () =>
      dispatchEvent(
        new CameraLookAtEvent({ position, target, transition: false }),
      ),
  }));
}

// The panel's rows of the story's own: the weather (local, global, or the clouds off), its clock
// (pause, its rates) and whether the sun runs on it, how the march reuses the last frames, how the
// sun lights the clouds, the ground under them, and the frame's statistics.
function cloudRows(args: CloudsArgs): SceneryDebugRow[] {
  return [
    {
      label: 'weather',
      buttons: [
        ...(
          [
            ['local', 'The levels’ layers about the local weather’s middle'],
            ['global', 'The weather systems over the whole Earth'],
          ] as const
        ).map(([weatherMode, title]) => ({
          label: weatherMode,
          title,
          on: args.cloudsEnabled && args.weatherMode === weatherMode,
          click: () => update({ weatherMode, cloudsEnabled: true }),
        })),
        {
          label: 'off',
          title:
            'The clouds hidden, still compiled: the frame without them, back at once',
          on: !args.cloudsEnabled,
          click: () => update({ cloudsEnabled: false }),
        },
      ],
    },
    {
      label: 'time',
      buttons: [
        ...RATES.map(rate => ({
          label: rate ? `${rate}×` : 'pause',
          title: rate
            ? `The weather's clock at ${rate} weather seconds a second`
            : 'Hold the weather’s clock',
          on: rate
            ? !args.weatherPaused && args.cloudRate === rate
            : args.weatherPaused,
          click: () =>
            update(
              rate
                ? { weatherPaused: false, cloudRate: rate }
                : { weatherPaused: true },
            ),
        })),
        {
          label: 'sync',
          title:
            'The sun on the weather’s clock: from the sun’s hour, date and place, on as the clock runs (SYNC CLOCKS)',
          on: args.syncClocks,
          click: () => update({ syncClocks: !args.syncClocks }),
        },
      ],
    },
    {
      // Being chosen: how the march reuses the last frames (TEMPORAL).
      label: 'temporal',
      buttons: (
        [
          ['off', 'Every pixel marched every frame'],
          [
            'still',
            'A quarter of the pixels a frame while the camera holds still; all as it moves',
          ],
          [
            'moving',
            'A quarter a frame however the camera moves, the rest moved to where their clouds lie now',
          ],
        ] as const
      ).map(([temporal, title]) => ({
        label: temporal,
        title,
        on: args.temporal === temporal,
        click: () => update({ temporal }),
      })),
    },
    {
      // Being chosen: the clouds over the relief, and a global weather's systems steered by it.
      label: 'ground',
      buttons: (
        [
          ['off', 'The sea’s level everywhere', false, false],
          ['on', 'Over the relief, the systems’ wind as it is', true, false],
          [
            'steered',
            'Over the relief, the systems’ wind steered by it',
            true,
            true,
          ],
        ] as const
      ).map(([label, title, cloudTerrain, steer]) => ({
        label,
        title,
        on:
          args.cloudTerrain === cloudTerrain &&
          (!cloudTerrain || args.steer === steer),
        click: () => update({ cloudTerrain, steer }),
      })),
    },
    {
      label: 'stats',
      buttons: [
        {
          label: args.stats ? 'on' : 'off',
          title: 'The frame rate and frame times, bottom left (STATS)',
          on: args.stats,
          click: () => update({ stats: !args.stats }),
        },
      ],
    },
  ];
}

// The weather's hours after which the sun's hour is set again: ten weather seconds.
const SUN_STEP = 10 / 3600;

// The Scenery under the weather, its sun on the weather's clock with SYNC CLOCKS: the sun's hour
// when the clock reads 0, on by the weather's hours since, so the sun moves with the clouds (a
// jump of the clock moves both); and the panel, its readout by the same sun, with the story's own
// rows and the types' looks.
const ClockedScenery = ({
  args,
  children,
}: {
  args: CloudsArgs;
  children: ReactNode;
}) => {
  const clock = useWeatherClock();
  const clocked = args.syncClocks;
  const start = args.sunHour ?? sceneryArgs.sunHour;
  const hourNow = () => (((start + (clock?.time ?? 0) / 3600) % 24) + 24) % 24;
  const [hour, setHour] = useReactState(hourNow);
  useFrame(() => {
    if (!clocked) return;
    const now = hourNow();
    if (Math.abs(now - hour) >= SUN_STEP) setHour(now);
  });
  const sky = clocked
    ? {
        ...args,
        sunFromTime: true,
        sunHour: hour,
        sunDate: args.sunDate ?? sceneryArgs.sunDate,
        sunLatitude: args.sunLatitude ?? sceneryArgs.sunLatitude,
        sunLongitude: args.sunLongitude ?? sceneryArgs.sunLongitude,
      }
    : args;
  return (
    <>
      <SceneryDebugPanel
        args={sky}
        altitudes={SCENERY_DEBUG_HIGH_ALTITUDES}
        fly={flyFromArgs(args)}
        views={cloudViews(args)}
        rows={cloudRows(args)}
      >
        <LookControls args={args} />
      </SceneryDebugPanel>
      <Scenery {...sceneryPropsFromArgs(sky, true)}>{children}</Scenery>
    </>
  );
};

const CloudsStory = (args: CloudsArgs) => {
  const frame = sceneryReliefFrame(args);
  const relief = sceneryReliefFromArgs(args);
  const sea = args.skyWater || args.skySeabed;
  const weatherKey = JSON.stringify(weatherFromArgs(args));
  const weather = useMemo(
    () => JSON.parse(weatherKey) as WeatherState,
    [weatherKey],
  );
  const looksKey = JSON.stringify(args.looks ?? {});
  const looks = useMemo(
    () => JSON.parse(looksKey) as Partial<Record<CloudType, SceneryCloudLook>>,
    [looksKey],
  );

  return (
    <World frame={frame} globe={args.globe}>
      <SceneryStoryRendering args={args} />
      <Weather
        weather={weather}
        // Jumped to the minutes chosen, run at the rate chosen: the sun too, with SYNC CLOCKS.
        time={args.cloudMinutes * 60}
        timeScale={args.cloudRate}
        paused={args.weatherPaused}
      >
        <ClockedScenery args={args}>
          {/* The sea, the void and the stage as in the other Scenery stories. */}
          <SceneryArgsFeatures
            args={args}
            weather
            ocean={sea && { level: 0, depth: DEPTH }}
            abyss={{}}
          />
          {sea && <SceneryStage boundary={BOUNDS} />}
          {args.volume && (
            <SceneryClouds
              enabled={args.cloudsEnabled}
              dominance={args.dominance}
              looks={looks}
              levels={{
                low: args.globalLow,
                mid: args.globalMid,
                high: args.globalHigh,
              }}
              scale={args.volumeScale}
              density={args.density}
              quality={args.quality}
              resolution={args.ownResolution ? args.resolution : undefined}
              seed={args.volumeSeed}
              terrain={args.cloudTerrain}
              lightMap={args.lightMap}
              temporal={args.temporal}
              debug={{
                view: args.debugView === 'none' ? undefined : args.debugView,
                air: args.debugAir,
                types: args.globalTypes,
                thickness: args.globalThickness,
                steer: args.steer,
              }}
            />
          )}
        </ClockedScenery>
      </Weather>
      {relief && <GeoRelief {...relief} />}
      <CloudBenchBridge />
    </World>
  );
};

const range = (
  min: number,
  max: number,
  step: number,
  description: string,
  category = 'Cloud volume',
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  table: { category },
});

const levelArgTypes = Object.fromEntries(
  CLOUD_LEVELS.flatMap(level => [
    [
      `${level}Type`,
      {
        control: { type: 'inline-radio' },
        options: TYPES[level],
        description: `What the ${level} level is made of. Sets the type’s typical heights.`,
        table: { category: 'Weather' },
      },
    ],
    [
      `${level}Cover`,
      range(
        0,
        1,
        0.05,
        `The share of the ground under the ${level} level’s cloud; 0 none.`,
        'Weather',
      ),
    ],
    [
      `${level}Base`,
      range(
        0,
        12000,
        50,
        `The ${level} level’s base over the sea (metres).`,
        'Weather',
      ),
    ],
    [
      `${level}Top`,
      range(
        0,
        13000,
        50,
        `The ${level} level’s top over the sea (metres).`,
        'Weather',
      ),
    ],
  ]),
);

const meta = {
  title: 'Components/Misc/Clouds',
  component: CloudsStory,
  decorators: [
    Canvas3dDecorator,
    // The relief's, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
    cloudLayerDecorator,
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
    ...sceneryReliefArgTypes(),
    ...progressArgTypes,
    volume: {
      control: { type: 'boolean' },
      description: 'The 3D clouds (`SceneryClouds`).',
      table: { category: 'Cloud volume' },
    },
    weatherMode: {
      control: { type: 'inline-radio' },
      options: ['local', 'global'],
      description:
        'LOCAL: the levels’ layers about the local weather’s middle, none beyond. GLOBAL: the weather systems over the whole Earth (`WeatherSystems`), each level’s cover and types from their map; the layers unused.',
      table: { category: 'Weather' },
    },
    cloudsEnabled: {
      control: { type: 'boolean' },
      description:
        'The 3D clouds shown. Off hides them, still compiled (`enabled`): the frame without them, to tell their share of it, and back at once.',
      table: { category: 'Weather' },
    },
    systemsSeed: range(
      0,
      20,
      1,
      'A global weather’s weather systems (`WeatherSystems.seed`).',
      'Weather',
    ),
    globalLow: {
      control: { type: 'boolean' },
      description: 'A global weather’s low level (`levels`).',
      table: { category: 'Weather' },
    },
    globalMid: {
      control: { type: 'boolean' },
      description: 'A global weather’s middle level (`levels`).',
      table: { category: 'Weather' },
    },
    globalHigh: {
      control: { type: 'boolean' },
      description: 'A global weather’s high level (`levels`).',
      table: { category: 'Weather' },
    },
    globalTypes: {
      control: { type: 'boolean' },
      description:
        'Being chosen: a global weather’s level looks as its place along its chain of types; off, as the chain’s first type (`debug.types`).',
      table: { category: 'Weather' },
    },
    cloudTerrain: {
      control: { type: 'boolean' },
      description:
        'The relief as the ground the clouds lie over (`terrain`): their levels rise over high ground, a view ends where it meets it, a local weather gains cover where its wind blows up the ground, and a global weather’s systems are lifted and dried in the lee. Off, the sea’s level everywhere.',
      table: { category: 'Cloud volume' },
    },
    steer: {
      control: { type: 'boolean' },
      description:
        'Being chosen: the relief steers a global weather’s systems’ wind: slower over land, turned along the ridges it would blow up (`debug.steer`).',
      table: { category: 'Weather' },
    },
    lightMap: {
      control: { type: 'boolean' },
      description:
        'A local weather’s clouds lit from light maps (`lightMap`), drawn anew as the clouds form and fade and the sun moves, so lagging under a fast clock; their saving was measured before the march’s cover map and its stop at 5 %, and not since. Without the lumps’ own shade (LIGHT MODEL shaded). Off: marched toward the light at every point lit.',
      table: { category: 'Cloud volume' },
    },
    temporal: {
      control: { type: 'inline-radio' },
      options: ['off', 'still', 'moving'],
      description:
        'Being chosen: how the march reuses the last frames’ (`temporal`). OFF: every pixel every frame. STILL: a quarter of the pixels a frame while the camera holds still, the rest as marched up to three frames before; all as it moves. MOVING: a quarter a frame however it moves, the rest moved to where their clouds lie now.',
      table: { category: 'Cloud volume' },
    },
    globalThickness: {
      control: { type: 'boolean' },
      description:
        'Being chosen: the low cloud’s thickness sets how deep and dense a global weather’s cloud is; off, its type alone (`debug.thickness`).',
      table: { category: 'Weather' },
    },
    preset: {
      control: { type: 'select' },
      options: ['custom', ...PRESETS],
      description:
        'A sky (`SKY_PRESETS`): fills in each level and the wind, to change from there. CUSTOM once one is changed by hand.',
      table: { category: 'Weather' },
    },
    edit: {
      control: { type: 'inline-radio' },
      options: CLOUD_LEVELS,
      description:
        'The level the panel’s views are taken by, and a double-click looks into.',
      table: { category: 'Weather' },
    },
    dominance: range(
      0,
      1,
      0.05,
      'How far the level covering most dominates (`dominance`): every other level’s cover cut by this times its cover.',
      'Weather',
    ),
    looks: {
      control: { type: 'object' },
      description:
        'Each type’s look over `CLOUDS_LOOKS` (`looks`), by type: scale, stretch, softness, lumps, towering, masses, extinction, lifetime, rise.',
      table: { category: 'Cloud volume' },
    },
    ...levelArgTypes,
    localLatitude: {
      control: { type: 'number', min: -90, max: 90, step: 0.01 },
      description:
        'Latitude of the local weather’s middle (degrees). Unset: where the World’s anchor lies as it is first drawn, kept there as the anchor moves.',
      table: { category: 'Weather' },
    },
    localLongitude: {
      control: { type: 'number', min: -180, max: 180, step: 0.01 },
      description:
        'Longitude of the local weather’s middle (degrees). Unset, with the latitude: the anchor’s.',
      table: { category: 'Weather' },
    },
    localRadius: range(
      20,
      1000,
      10,
      'How far the local weather reaches from its middle (km): its clouds break up over the outer half, its edge pushed in and out.',
      'Weather',
    ),
    weatherPaused: {
      control: { type: 'boolean' },
      description:
        'Hold the weather’s clock (`Weather` `paused`): the clouds stop drifting, and with SYNC CLOCKS the sun stands.',
      table: { category: 'Weather' },
    },
    volumeScale: range(0.25, 4, 0.05, 'Size of the clouds, relative.'),
    density: range(0.1, 3, 0.05, 'How dense they are inside, relative.'),
    quality: {
      control: { type: 'select' },
      options: ['low', 'medium', 'high', 'ultra'],
      description:
        'How much they spend for how they look (`quality`, `CLOUDS_QUALITY`): the share of the screen’s resolution, and how finely they are marched.',
      table: { category: 'Cloud volume' },
    },
    ownResolution: {
      control: { type: 'boolean' },
      description: 'A resolution of their own instead of the quality’s.',
      table: { category: 'Cloud volume' },
    },
    resolution: {
      ...range(
        0.25,
        1,
        0.05,
        'The share of the screen’s resolution in CSS pixels their image is drawn at, whatever its pixel ratio.',
      ),
      if: { arg: 'ownResolution' },
    },
    volumeSeed: range(0, 20, 1, 'Picks another pattern.'),
    debugView: {
      control: { type: 'inline-radio' },
      options: ['none', 'cost', 'unlit', 'map'],
      description:
        'COST: the march’s steps along each view, blue none to red at the quality’s most. UNLIT: white, as opaque as the clouds are. MAP: a global weather’s cover where the view meets the sea, low red, middle green, high blue.',
      table: { category: 'Debug' },
    },
    debugAir: {
      control: { type: 'boolean' },
      description: 'The air’s haze between the clouds and the camera.',
      table: { category: 'Debug' },
    },
    syncClocks: {
      control: { type: 'boolean' },
      description:
        'The sun on the weather’s clock: from the Sun’s hour, date and place when the clock reads 0, on as it runs and jumps, so it moves with the clouds. Off, the Sun’s controls alone set it, and the clock moves the clouds alone.',
      table: { category: 'Weather' },
    },
    cloudMinutes: range(
      0,
      240,
      1,
      'Jump the weather’s clock this far on (minutes): the clouds drift with the wind, and with SYNC CLOCKS the sun moves on too.',
      'Weather',
    ),
    cloudRate: {
      control: { type: 'select' },
      options: RATES.filter(rate => rate > 0),
      description:
        'The weather clock’s rate (weather seconds a second): 1 real time, 3600 an hour a second. Held with WEATHER PAUSED.',
      table: { category: 'Weather' },
    },
  },
  args: {
    ...sceneryArgs,
    ...sceneryReliefArgs,
    ...sceneryProgressArgs,
    // The demo's relief: land for the clouds to cross.
    relief: true,
    // Frame rate and frame times, bottom left.
    stats: true,
    volume: true,
    cloudsEnabled: true,
    weatherMode: 'local',
    systemsSeed: 0,
    globalLow: true,
    globalMid: true,
    globalHigh: true,
    globalTypes: true,
    globalThickness: true,
    cloudTerrain: true,
    steer: true,
    lightMap: false,
    temporal: 'off',
    preset: 'scattered',
    ...presetArgs('scattered'),
    edit: 'low',
    dominance: sceneryDefaults.clouds.dominance,
    looks: {},
    localRadius: WEATHER_LOCAL_RADIUS / 1000,
    volumeScale: sceneryDefaults.clouds.scale,
    density: sceneryDefaults.clouds.density,
    quality: sceneryDefaults.clouds.quality,
    ownResolution: false,
    resolution: CLOUDS_QUALITY.medium.resolution,
    volumeSeed: sceneryDefaults.clouds.seed,
    debugView: 'none',
    debugAir: true,
    cloudMinutes: 0,
    cloudRate: 1,
    // The sun on the weather's clock, from the Sun's hour, date and place.
    syncClocks: true,
    sunFromTime: true,
    weatherPaused: false,
  } as CloudsArgs,
} satisfies Meta<typeof CloudsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Over the field from 3 km in a low sun, looking out over the clouds. */
export const Default: Story = {};

/** From 40 m over the sea, looking up into their bases. */
export const Below: Story = {
  parameters: {
    cameraPosition: [0, 40, 0],
    cameraTarget: [3000, 1800, -2000],
  },
};

/** In the layer, looking along it to the horizon: the hardest view to march. */
export const Grazing: Story = {
  parameters: {
    cameraPosition: [-6000, 1800, 4000],
    cameraTarget: [14000, 1800, 4000],
  },
};

/** Just over the layer's top, looking out to the horizon. */
export const Horizon: Story = {
  parameters: {
    cameraPosition: [0, 2600, 0],
    cameraTarget: [40000, 2400, 0],
  },
};

/** A marine stratocumulus deck, broken, low and thin, from over it. */
export const Strato: Story = {
  args: { preset: 'marine-sc', ...presetArgs('marine-sc') },
  parameters: {
    cameraPosition: [-9000, 2000, 9000],
    cameraTarget: [6000, 600, -6000],
  },
};

/** An unsettled sky: cumulus under altocumulus, cirrus over them. */
export const Levels: Story = {
  args: { preset: 'unsettled', ...presetArgs('unsettled') },
};

/** A global weather from 200 km up. */
export const High: Story = {
  args: { weatherMode: 'global' },
  parameters: {
    cameraPosition: [0, 200000, 120000],
    cameraTarget: [0, 0, 0],
  },
};

/** The whole Earth from 20 000 km, a global weather: the weather systems. Fly down to the field. */
export const Earth: Story = {
  args: { weatherMode: 'global' },
  parameters: {
    cameraPosition: [0, 14000000, 14000000],
    cameraTarget: [0, 0, 0],
  },
};
