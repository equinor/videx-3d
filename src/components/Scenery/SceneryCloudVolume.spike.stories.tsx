import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  type CSSProperties,
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
  sceneryProgressArgs,
  sceneryReliefFrame,
} from '../../storybook/components/scenery-controls';
import {
  SCENERY_DEBUG_HIGH_ALTITUDES,
  SceneryDebugPanel,
  useSceneryTimelapse,
} from '../../storybook/components/scenery-debug-panel';
import { SceneryArgsFeatures } from '../../storybook/components/scenery-features';
import { SceneryStoryRendering } from '../../storybook/components/scenery-story-rendering';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import {
  ProgressArgs,
  progressArgTypes,
} from '../../storybook/decorators/progress-decorator';
import {
  CLOUD_TYPE_HEIGHTS,
  cloudLayersByLevel,
  SKY_PRESETS,
  WEATHER_LOCAL_RADIUS,
  type CloudLayer,
  type CloudType,
  type SkyPreset,
  type WeatherState,
} from '../../sdk/weather/weather';
import { Weather } from '../Weather/Weather';
import { World } from '../World/World';
import { Scenery } from './Scenery';
import { SceneryCloudVolume } from './SceneryCloudVolume';
import {
  CLOUD_VOLUME_QUALITY,
  cloudVolumeFormOf,
} from './scenery-cloud-volume';
import {
  sceneryDefaults,
  type SceneryCloudVolumeQuality,
} from './scenery-model';

// The 3D clouds (documents/clouds.md) being rebuilt: one layer of a local weather, drawn as soft
// clouds (`soft`, a spike: rounded masses from a cover map fixed to the Earth) or as its own
// form, cumulus or strato, over the Scenery's sky and sun alone — no sea, no relief, no bakes —
// from sea level to space, without tone mapping. The views to judge them from are the stories
// below; the clouds' panel (top right) sets the layer, the soft clouds, the light and the
// views, and the scenery's moves the camera to set altitudes and runs a timelapse.

// The low types drawn, and the skies (SKY_PRESETS) whose low layer is one of them.
const TYPES: CloudType[] = [
  'cumulus',
  'stratocumulus',
  'stratus',
  'nimbostratus',
];
const lowOf = (preset: SkyPreset) =>
  cloudLayersByLevel(SKY_PRESETS[preset].layers)[0];
const PRESETS = (Object.keys(SKY_PRESETS) as SkyPreset[]).filter(preset => {
  const low = lowOf(preset);
  return low && cloudVolumeFormOf(low.type);
});
type PresetArg = 'custom' | SkyPreset;

type CloudVolumeArgs = {
  panel: boolean;
  volume: boolean;
  /** a sky to fill the layer's controls and the wind from, or 'custom' */
  preset: PresetArg;
  layerType: CloudType;
  /** the share of the ground under cloud */
  cover: number;
  /** the layer's base over the sea, and its depth (metres) */
  base: number;
  thickness: number;
  /** the local weather's middle (degrees; unset: the anchor as it is first drawn) and radius (km) */
  localLatitude?: number;
  localLongitude?: number;
  localRadius: number;
  volumeScale: number;
  density: number;
  quality: SceneryCloudVolumeQuality;
  /** a resolution of its own instead of the quality's */
  ownResolution: boolean;
  resolution?: number;
  volumeSeed: number;
  debugView: 'none' | 'cost' | 'unlit';
  /** the air's haze between the clouds and the camera */
  debugAir: boolean;
  /** the low layer drawn as soft clouds (`soft`), else as its own form */
  soft: boolean;
  softness: number;
  lumps: number;
  towering: number;
  masses: number;
  /** how far on to jump the weather's clock (minutes): the clouds drift with the wind */
  cloudMinutes: number;
  /** the weather clock's rate (weather seconds a second) */
  cloudRate: number;
  /** the sun as one of the light conditions, or as the sun's controls set it ('custom') */
  light: LightArg;
  /** the weather's clock held: the clouds stand still */
  weatherPaused: boolean;
} & SceneryArgs &
  ProgressArgs;

// Light conditions to judge the clouds in: the sun's elevation and bearing (degrees).
type LightArg = 'custom' | 'low' | 'mid' | 'high' | 'sunset' | 'night';
const LIGHTS: Record<Exclude<LightArg, 'custom'>, [number, number]> = {
  low: [10, 150],
  mid: [35, 200],
  high: [70, 180],
  sunset: [2, 250],
  night: [-25, 250],
};

// The story's args with the sun set by `light`, unless 'custom'.
function lightArgs<T extends CloudVolumeArgs>(args: T): T {
  if (args.light === 'custom') return args;
  const [sunElevation, sunAzimuth] = LIGHTS[args.light];
  return { ...args, sunFromTime: false, sunElevation, sunAzimuth };
}

// The layer's typical heights for `type` at `cover` (CLOUD_TYPE_HEIGHTS), to 10 m.
function heightsOf(type: CloudType, cover: number) {
  const { base, top } = CLOUD_TYPE_HEIGHTS[type];
  const thickness = top[0] + (top[1] - top[0]) * cover - base;
  return { base, thickness: Math.round(thickness / 10) * 10 };
}

// The layer's controls and the wind's for a sky: its low layer, and its wind (the sea's
// controls take the bearing it blows toward).
function presetArgs(preset: SkyPreset): Partial<CloudVolumeArgs> {
  const low = lowOf(preset);
  const { wind } = SKY_PRESETS[preset];
  return {
    windSpeed: wind.speed,
    windDirection: (wind.from + 180) % 360,
    ...(low && {
      layerType: low.type,
      cover: low.cover,
      base: low.base,
      thickness: low.top - low.base,
    }),
  };
}

// The local weather from the story's controls: its wind, its one layer about its middle.
function weatherFromArgs(args: CloudVolumeArgs): WeatherState {
  const layer: CloudLayer = {
    type: args.layerType,
    cover: args.cover,
    base: args.base,
    top: args.base + Math.max(args.thickness, 10),
  };
  return {
    wind: { speed: args.windSpeed, from: (args.windDirection + 180) % 360 },
    clouds: args.cover > 0 ? [layer] : [],
    local: {
      latitude: args.localLatitude,
      longitude: args.localLongitude,
      radius: args.localRadius * 1000,
    },
  };
}

/**
 * Keeps the layer's controls together: a sky chosen fills them and the wind; the type changed
 * sets its heights to the type's typical ones; any of them changed by hand makes the sky
 * 'custom'. `useArgs` is valid only in a decorator.
 */
const cloudLayerDecorator: Decorator = Story => {
  const [args, updateArgs] = useArgs<CloudVolumeArgs>();
  const seen = useRef<CloudVolumeArgs | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = args;
    if (!before) return;
    let changes: Partial<CloudVolumeArgs> = {};
    if (args.preset !== before.preset && args.preset !== 'custom')
      changes = presetArgs(args.preset);
    else if (args.layerType !== before.layerType)
      changes = { ...heightsOf(args.layerType, args.cover), preset: 'custom' };
    else if (
      args.cover !== before.cover ||
      args.base !== before.base ||
      args.thickness !== before.thickness
    )
      changes = { preset: 'custom' };
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

// Where a double-click on the globe takes the camera: low over the sea, looking into the middle
// of the layer some kilometres on (the panel's `fly`).
const flyFromArgs = (args: CloudVolumeArgs) => ({
  height: 300,
  lookAt: args.base + 0.5 * args.thickness,
  ahead: 6000,
});

// Views to judge the clouds from by the layer's heights (scene metres: X east, Z south; the
// local weather's middle at 0, 0): the camera's place and what it looks at. LEVEL in the layer
// looking along it, the hardest view to march; HORIZON just over its top.
function viewsOf(args: CloudVolumeArgs): Record<string, [Vec3, Vec3]> {
  const base = args.base;
  const top = args.base + Math.max(args.thickness, 10);
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

const LIGHT_NAMES: LightArg[] = [
  'low',
  'mid',
  'high',
  'sunset',
  'night',
  'custom',
];
const QUALITIES: SceneryCloudVolumeQuality[] = [
  'low',
  'medium',
  'high',
  'ultra',
];
const RESOLUTIONS = [0.35, 0.5, 0.75, 1];
// The weather clock's rates (weather seconds a second): real time to ten minutes a second; 0
// held.
const RATES = [0, 1, 10, 60, 600];
const DEBUG_VIEWS: CloudVolumeArgs['debugView'][] = ['none', 'cost', 'unlit'];

// The args holding a number.
type NumberArg = {
  [K in keyof CloudVolumeArgs]-?: CloudVolumeArgs[K] extends number ? K : never;
}[keyof CloudVolumeArgs];
// The panel's sliders: the arg, its range and step, and its label.
const SLIDERS: [NumberArg, number, number, number, string][] = [
  ['cover', 0, 1, 0.01, 'cover'],
  ['base', 0, 6000, 50, 'base m'],
  ['thickness', 100, 6000, 50, 'depth m'],
  ['softness', 0, 1, 0.01, 'softness'],
  ['lumps', 0, 1, 0.01, 'lumps'],
  ['towering', 0, 1, 0.01, 'towering'],
  ['masses', 0, 1.5, 0.01, 'masses'],
  ['volumeScale', 0.25, 4, 0.05, 'scale'],
  ['density', 0.1, 3, 0.05, 'density'],
  ['volumeSeed', 0, 20, 1, 'seed'],
  ['cloudMinutes', 0, 240, 1, 'jump to min'],
  ['windSpeed', 0, 30, 0.5, 'wind m/s'],
  ['windDirection', 0, 355, 5, 'wind toward °'],
];

const PANEL: CSSProperties = {
  position: 'fixed',
  top: 8,
  width: 300,
  maxHeight: 'calc(100% - 16px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: 6,
  font: '11px sans-serif',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.5)',
  borderRadius: 3,
  zIndex: 10,
};
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
      <span style={{ width: 40 }}>{label}</span>
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

// The panel over the canvas: the layer's sky, the clouds' form, the light, the views, the
// clock, the quality and the sliders, so the shared page (without Storybook's controls) can
// drive the clouds.
const CloudPanel = ({
  args,
  update,
}: {
  args: CloudVolumeArgs;
  update: (args: Partial<CloudVolumeArgs>) => void;
}) => {
  const [open, setOpen] = useReactState(true);
  const views = viewsOf(args);
  const view = (name: string) => {
    const [position, target] = views[name];
    dispatchEvent(
      new CameraLookAtEvent({ position, target, transition: false }),
    );
  };
  return (
    // Top right, left of the scenery's own panel where that is shown; the stats are bottom left.
    <div style={{ ...PANEL, right: args.panel ? 330 : 8 }}>
      <div style={ROW}>
        <button style={BUTTON} onClick={() => setOpen(!open)}>
          {open ? 'hide' : 'clouds'}
        </button>
        {open && (
          <span>
            {args.soft ? 'soft clouds' : `own form: ${args.layerType}`}
          </span>
        )}
      </div>
      {open && (
        <>
          <Choices
            label="sky"
            options={PRESETS}
            chosen={preset => args.preset === preset}
            pick={preset => update({ preset })}
          />
          <Choices
            label="form"
            options={[true, false]}
            name={soft => (soft ? 'soft' : 'own')}
            chosen={soft => args.soft === soft}
            pick={soft => update({ soft })}
          />
          <Choices
            label="light"
            options={LIGHT_NAMES}
            chosen={light => args.light === light}
            pick={light => update({ light })}
          />
          <Choices
            label="view"
            options={Object.keys(views)}
            chosen={() => false}
            pick={view}
          />
          <Choices
            label="time"
            options={RATES}
            name={rate => (rate ? `${rate}×` : 'pause')}
            chosen={rate =>
              rate
                ? !args.weatherPaused && args.cloudRate === rate
                : args.weatherPaused
            }
            pick={rate =>
              update(
                rate
                  ? { weatherPaused: false, cloudRate: rate }
                  : { weatherPaused: true },
              )
            }
          />
          <Choices
            label="quality"
            options={QUALITIES}
            chosen={quality => !args.ownResolution && args.quality === quality}
            pick={quality => update({ quality, ownResolution: false })}
          />
          <Choices
            label="res"
            options={RESOLUTIONS}
            chosen={resolution =>
              args.ownResolution && args.resolution === resolution
            }
            pick={resolution => update({ ownResolution: true, resolution })}
          />
          <Choices
            label="debug"
            options={DEBUG_VIEWS}
            chosen={debugView => args.debugView === debugView}
            pick={debugView => update({ debugView })}
          />
          {SLIDERS.map(([key, min, max, step, label]) => (
            <PanelSlider
              key={key}
              label={label}
              value={args[key]}
              min={min}
              max={max}
              step={step}
              set={value => update({ [key]: value })}
            />
          ))}
        </>
      )}
    </div>
  );
};

// The panel, over the story. `useArgs` is valid only in a decorator.
const cloudPanelDecorator: Decorator = Story => {
  const [args, updateArgs] = useArgs<CloudVolumeArgs>();
  return (
    <>
      {Story()}
      <CloudPanel args={args} update={updateArgs} />
    </>
  );
};

const CloudVolumeStory = (storyArgs: CloudVolumeArgs) => {
  const timed = useSceneryTimelapse(storyArgs);
  const timelapse = timed.timelapse;
  const args = lightArgs(timed.args);
  const frame = sceneryReliefFrame(args);
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
        // Jumped to the minutes chosen; run at the rate chosen, or an hour of weather an hour of
        // the timelapse: the clouds stream past and live their lives with the sun.
        time={args.cloudMinutes * 60}
        timeScale={timelapse.playing ? timelapse.speed * 3600 : args.cloudRate}
        paused={args.weatherPaused}
      >
        <Scenery {...sceneryPropsFromArgs(args)}>
          <SceneryArgsFeatures args={args} ocean={false} abyss={false} />
          {args.volume && (
            <SceneryCloudVolume
              scale={args.volumeScale}
              density={args.density}
              quality={args.quality}
              resolution={args.ownResolution ? args.resolution : undefined}
              seed={args.volumeSeed}
              debug={{
                view: args.debugView === 'none' ? undefined : args.debugView,
                air: args.debugAir,
              }}
              soft={
                args.soft && {
                  softness: args.softness,
                  lumps: args.lumps,
                  towering: args.towering,
                  masses: args.masses,
                }
              }
            />
          )}
        </Scenery>
      </Weather>
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

const meta = {
  title: 'Spikes/Scenery/CloudVolume',
  component: CloudVolumeStory,
  decorators: [
    Canvas3dDecorator,
    ...sceneryDecorators,
    cloudLayerDecorator,
    cloudPanelDecorator,
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
    ...progressArgTypes,
    panel: {
      control: { type: 'boolean' },
      description:
        'Buttons over the canvas: the camera’s height, moves to set altitudes up to 4000 km, views, and a timelapse of the sun. Double-click the sea to fly there, 300 m over it, looking into the cloud layer.',
      table: { category: 'Debug' },
    },
    volume: {
      control: { type: 'boolean' },
      description: 'The 3D clouds (`SceneryCloudVolume`).',
      table: { category: 'Cloud volume' },
    },
    preset: {
      control: { type: 'select' },
      options: ['custom', ...PRESETS],
      description:
        'A sky (`SKY_PRESETS`) whose low layer the clouds draw: fills in the layer and the wind, to change from there. CUSTOM once one is changed by hand.',
      table: { category: 'Weather' },
    },
    layerType: {
      control: { type: 'inline-radio' },
      options: TYPES,
      description:
        'What the layer is made of: separate cumulus, building up the taller the deeper the layer; or strato veils (stratocumulus, stratus and nimbostratus all drawn as strato for now). Sets the type’s typical heights.',
      table: { category: 'Weather' },
    },
    cover: range(
      0,
      1,
      0.05,
      'The share of the ground under cloud (cumulus reach some 0.5–0.6 at most).',
      'Weather',
    ),
    base: range(
      0,
      6000,
      50,
      'The layer’s base over the sea (metres).',
      'Weather',
    ),
    thickness: range(
      100,
      6000,
      50,
      'How deep the layer is (metres): cumulus grow as tall as it lets them, the largest the deepest.',
      'Weather',
    ),
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
      5,
      500,
      5,
      'How far the local weather’s layer reaches from its middle (km), thinning out over the outer fifth.',
      'Weather',
    ),
    weatherPaused: {
      control: { type: 'boolean' },
      description:
        'Hold the weather’s clock (`Weather` `paused`): the clouds stop drifting and living. Running, the timelapse (the panel) runs it an hour of weather an hour of the sun’s.',
      table: { category: 'Weather' },
    },
    volumeScale: range(0.25, 4, 0.05, 'Size of the clouds, relative.'),
    density: range(0.1, 3, 0.05, 'How dense they are inside, relative.'),
    quality: {
      control: { type: 'select' },
      options: ['low', 'medium', 'high', 'ultra'],
      description:
        'How much they spend for how they look (`quality`, `CLOUD_VOLUME_QUALITY`): the share of the screen’s resolution, how finely they are marched, and from how small their clouds are drawn as their mean.',
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
        'The share of the screen’s resolution their image is drawn at.',
      ),
      if: { arg: 'ownResolution' },
    },
    volumeSeed: range(0, 20, 1, 'Picks another pattern.'),
    debugView: {
      control: { type: 'inline-radio' },
      options: ['none', 'cost', 'unlit'],
      description:
        'COST: the march’s iterations along each view, blue none to red at the quality’s most. UNLIT: white, as opaque as the clouds are.',
      table: { category: 'Debug' },
    },
    debugAir: {
      control: { type: 'boolean' },
      description: 'The air’s haze between the clouds and the camera.',
      table: { category: 'Debug' },
    },
    light: {
      control: { type: 'inline-radio' },
      options: ['custom', 'low', 'mid', 'high', 'sunset', 'night'],
      description:
        'The sun as a light condition to judge the clouds in: LOW 10° in the south-east, MID 35°, HIGH 70°, SUNSET 2° in the west, NIGHT (the moon). CUSTOM: the sun’s own controls.',
      table: { category: 'Cloud volume' },
    },
    soft: {
      control: { type: 'boolean' },
      description:
        'Soft clouds (`soft`, a spike): rounded masses of many sizes, domed over flat bases, soft-edged, from a map of the cover fixed to the Earth, whatever the layer’s type. Off: the layer’s own form (cumulus or strato).',
      table: { category: 'Soft clouds' },
    },
    softness: range(0, 1, 0.01, 'How soft their edges are.', 'Soft clouds'),
    lumps: range(
      0,
      1,
      0.01,
      'How far lumps of a few hundred metres move their surface, close up.',
      'Soft clouds',
    ),
    towering: range(
      0,
      1,
      0.01,
      'How many of their columns reach the layer’s top: few, flat clouds; many, tall.',
      'Soft clouds',
    ),
    masses: range(
      0,
      1.5,
      0.01,
      'How much rounded masses weigh against broad patches in their pattern.',
      'Soft clouds',
    ),
    cloudMinutes: range(
      0,
      240,
      1,
      'Jump the weather’s clock this far on (minutes): the clouds drift with the wind.',
      'Weather',
    ),
    cloudRate: {
      control: { type: 'select' },
      options: RATES.filter(rate => rate > 0),
      description:
        'The weather clock’s rate (weather seconds a second): 1 real time. Held with WEATHER PAUSED.',
      table: { category: 'Weather' },
    },
  },
  args: {
    ...sceneryArgs,
    ...sceneryProgressArgs,
    // The band along the horizon off: the volume reaches it on its own.
    clouds: false,
    // No bakes of the sky: the clouds take no part in them while they are rebuilt.
    environment: false,
    lightProbe: false,
    // Frame rate and frame times, bottom left.
    stats: true,
    panel: true,
    volume: true,
    preset: 'scattered',
    ...presetArgs('scattered'),
    localRadius: WEATHER_LOCAL_RADIUS / 1000,
    volumeScale: sceneryDefaults.cloudVolume.scale,
    density: sceneryDefaults.cloudVolume.density,
    quality: sceneryDefaults.cloudVolume.quality,
    ownResolution: false,
    resolution: CLOUD_VOLUME_QUALITY.medium.resolution,
    volumeSeed: sceneryDefaults.cloudVolume.seed,
    debugView: 'none',
    debugAir: true,
    soft: true,
    ...sceneryDefaults.cloudVolume.soft,
    cloudMinutes: 0,
    cloudRate: 1,
    light: 'low',
    weatherPaused: false,
  } as CloudVolumeArgs,
} satisfies Meta<typeof CloudVolumeStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Over the field from 3 km in a low sun, looking out over the soft clouds. */
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

/** The layer's own form, cumulus, not soft: to compare. */
export const Cumulus: Story = {
  args: { soft: false, light: 'mid' },
};

/** The local weather from 200 km up. */
export const High: Story = {
  parameters: {
    cameraPosition: [0, 200000, 120000],
    cameraTarget: [0, 0, 0],
  },
};

/** The whole Earth from 20 000 km: the local weather a patch on it. Fly down to the field. */
export const Earth: Story = {
  parameters: {
    cameraPosition: [0, 14000000, 14000000],
    cameraTarget: [0, 0, 0],
  },
};
