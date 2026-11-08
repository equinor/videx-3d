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
import {
  ATMOSPHERE_PRESETS,
  type Atmosphere,
  type AtmospherePreset,
} from '../../sdk/weather/atmosphere';
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

// The 3D clouds (documents/clouds.md) being rebuilt: one layer of a local weather, cumulus or
// strato, over the Scenery's sky and sun alone — no sea, no relief, no bakes — from sea level
// to space. The views to judge them from are the stories below; the panel moves the camera to
// set altitudes and runs a timelapse.

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
  /** the atmosphere the clouds come out of: a preset, its conditions changed ('custom'), or none */
  atmosphere: 'off' | 'custom' | AtmospherePreset;
  /** how far into the atmosphere's clouds' lives to jump the weather's clock to (minutes) */
  cloudMinutes: number;
  /** the weather clock's rate (weather seconds a second) */
  cloudRate: number;
  referenceSteps: number;
  referenceLightSamples: number;
  referenceSkySamples: number;
  /** the light from the baked light volume beyond a point's near cloud, not marched in full */
  referenceBakedLight: boolean;
  /** the clouds blended between the bakes the clock lies between, not stepped from one to the next */
  referenceBlend: boolean;
  /** the sun as one of the light conditions, or as the sun's controls set it ('custom') */
  light: LightArg;
  /** the weather's clock held: the clouds stand still */
  weatherPaused: boolean;
} & SceneryArgs &
  ProgressArgs &
  Atmosphere;

// The atmosphere's conditions, as the story's args name them.
const ATMOSPHERE_KEYS = Object.keys(ATMOSPHERE_PRESETS.fair) as (keyof Atmosphere)[];
const atmosphereOf = (args: CloudVolumeArgs): Atmosphere =>
  Object.fromEntries(ATMOSPHERE_KEYS.map(key => [key, args[key]])) as Atmosphere;

// Light conditions to judge the clouds in: the sun's elevation and bearing (degrees).
type LightArg = 'custom' | 'mid' | 'high' | 'sunset' | 'night';
const LIGHTS: Record<Exclude<LightArg, 'custom'>, [number, number]> = {
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
    if (
      args.atmosphere !== before.atmosphere &&
      args.atmosphere !== 'off' &&
      args.atmosphere !== 'custom'
    )
      changes = { ...ATMOSPHERE_PRESETS[args.atmosphere] };
    else if (
      args.atmosphere !== 'off' &&
      args.atmosphere !== 'custom' &&
      ATMOSPHERE_KEYS.some(key => args[key] !== before[key])
    )
      changes = { atmosphere: 'custom' };
    else if (args.preset !== before.preset && args.preset !== 'custom')
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

// Views to judge the atmosphere's clouds from (scene metres: X east, Z south; the square they are
// baked over spans ±8 km about the middle): the camera's place and what it looks at.
const VIEWS: Record<string, [Vec3, Vec3]> = {
  side: [
    [0, 2500, 16000],
    [0, 2500, 0],
  ],
  close: [
    [-2500, 2200, 4500],
    [0, 2500, 0],
  ],
  below: [
    [800, 200, 1800],
    [0, 2200, 0],
  ],
  above: [
    [-9000, 9000, 9000],
    [2000, 1500, -1000],
  ],
  far: [
    [-30000, 2500, 30000],
    [2000, 2000, -1000],
  ],
  grazing: [
    [-14000, 1800, 2500],
    [14000, 1800, 2500],
  ],
  top: [
    [0, 30000, 1],
    [0, 0, 0],
  ],
};

const ATMOSPHERES: CloudVolumeArgs['atmosphere'][] = [
  'off',
  'custom',
  'fair',
  'marine-sc',
  'stratus',
  'stratus-veil',
  'fog',
  'altostratus',
  'unstable',
  'spreading',
];
const LIGHT_NAMES: LightArg[] = ['mid', 'high', 'sunset', 'night', 'custom'];
const RESOLUTIONS = [0.35, 0.5, 0.75, 1];
// The weather clock's rates (weather seconds a second): real time to ten minutes a second.
const RATES = [1, 10, 60, 600];
// The reference's light (toward the light, straight up, and from the light volume): marched in
// full, marched fast, or baked.
const SAMPLES: Record<string, [number, number, boolean]> = {
  ref: [16, 8, false],
  fast: [4, 2, false],
  baked: [16, 8, true],
};
// The conditions' sliders: the arg, its range and step, and its label.
const SLIDERS: [keyof Atmosphere, number, number, number, string][] = [
  ['temperature', -10, 35, 0.5, 'temperature °C'],
  ['dewPoint', -15, 30, 0.5, 'dew point °C'],
  ['mixedLayer', 0, 4000, 50, 'mixed layer m'],
  ['lapseRate', 3, 9.8, 0.1, 'lapse K/km'],
  ['humidity', 0, 1.1, 0.01, 'humidity'],
  ['inversionHeight', 100, 10000, 50, 'inversion m'],
  ['inversionStrength', 0, 10, 0.1, 'inversion K'],
  ['lapseAbove', 3, 9.8, 0.1, 'lapse above'],
  ['humidityAbove', 0, 1.1, 0.01, 'humidity above'],
  ['moistLayerHeight', 0, 10000, 50, 'moist layer m'],
  ['moistLayerDepth', 50, 3000, 50, 'moist depth m'],
  ['moistLayerHumidity', 0, 1.1, 0.01, 'moist humidity'],
  ['shear', 0, 6, 0.1, 'shear m/s/km'],
  ['heating', 0, 1, 0.01, 'heating'],
  ['patchiness', 0, 1, 0.01, 'patchiness'],
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

// A condition's slider: shown as it is dragged, set (and the clouds baked again) as it is let go.
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

// The panel over the canvas: the atmosphere's presets and conditions, the light, the views and
// the resolution, so the shared page (without Storybook's controls) can drive the clouds.
const CloudPanel = ({
  args,
  update,
}: {
  args: CloudVolumeArgs;
  update: (args: Partial<CloudVolumeArgs>) => void;
}) => {
  const [open, setOpen] = useReactState(true);
  const view = (name: string) => {
    const [position, target] = VIEWS[name];
    dispatchEvent(new CameraLookAtEvent({ position, target, transition: false }));
  };
  return (
    // Top right, left of the scenery's own panel where that is shown; the stats are bottom left.
    <div style={{ ...PANEL, right: args.panel ? 330 : 8 }}>
      <div style={ROW}>
        <button style={BUTTON} onClick={() => setOpen(!open)}>
          {open ? 'hide' : 'clouds'}
        </button>
        {open && <span>atmosphere: {args.atmosphere}</span>}
      </div>
      {open && (
        <>
          <div style={ROW}>
            {ATMOSPHERES.map(name => (
              <button
                key={name}
                style={args.atmosphere === name ? ON : BUTTON}
                onClick={() => update({ atmosphere: name })}
              >
                {name}
              </button>
            ))}
          </div>
          <div style={ROW}>
            <span style={{ width: 40 }}>light</span>
            {LIGHT_NAMES.map(name => (
              <button
                key={name}
                style={args.light === name ? ON : BUTTON}
                onClick={() => update({ light: name })}
              >
                {name}
              </button>
            ))}
          </div>
          <div style={ROW}>
            <span style={{ width: 40 }}>view</span>
            {Object.keys(VIEWS).map(name => (
              <button key={name} style={BUTTON} onClick={() => view(name)}>
                {name}
              </button>
            ))}
          </div>
          <div style={ROW}>
            <span style={{ width: 40 }}>time</span>
            <button
              style={args.weatherPaused ? ON : BUTTON}
              onClick={() => update({ weatherPaused: true })}
            >
              pause
            </button>
            {RATES.map(rate => (
              <button
                key={rate}
                style={!args.weatherPaused && args.cloudRate === rate ? ON : BUTTON}
                onClick={() => update({ weatherPaused: false, cloudRate: rate })}
              >
                {rate}×
              </button>
            ))}
          </div>
          <PanelSlider
            label="jump to min"
            value={args.cloudMinutes}
            min={0}
            max={240}
            step={1}
            set={value => update({ cloudMinutes: value })}
          />
          <PanelSlider
            label="wind m/s"
            value={args.windSpeed}
            min={0}
            max={30}
            step={0.5}
            set={value => update({ windSpeed: value })}
          />
          <PanelSlider
            label="wind toward °"
            value={args.windDirection}
            min={0}
            max={355}
            step={5}
            set={value => update({ windDirection: value })}
          />
          <div style={ROW}>
            <span style={{ width: 40 }}>light</span>
            {Object.entries(SAMPLES).map(([name, [light, sky, baked]]) => (
              <button
                key={name}
                style={
                  baked
                    ? args.referenceBakedLight
                      ? ON
                      : BUTTON
                    : !args.referenceBakedLight &&
                        args.referenceLightSamples === light &&
                        args.referenceSkySamples === sky
                      ? ON
                      : BUTTON
                }
                onClick={() =>
                  update({
                    referenceLightSamples: light,
                    referenceSkySamples: sky,
                    referenceBakedLight: baked,
                  })
                }
              >
                {baked ? name : `${name} ${light}+${sky}`}
              </button>
            ))}
          </div>
          <div style={ROW}>
            <span style={{ width: 40 }}>bakes</span>
            {[true, false].map(blend => (
              <button
                key={String(blend)}
                style={args.referenceBlend === blend ? ON : BUTTON}
                onClick={() => update({ referenceBlend: blend })}
              >
                {blend ? 'blend' : 'step'}
              </button>
            ))}
          </div>
          <div style={ROW}>
            <span style={{ width: 40 }}>res</span>
            {RESOLUTIONS.map(resolution => (
              <button
                key={resolution}
                style={
                  args.ownResolution && args.resolution === resolution
                    ? ON
                    : BUTTON
                }
                onClick={() => update({ ownResolution: true, resolution })}
              >
                {resolution}
              </button>
            ))}
          </div>
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
          {/* The atmosphere's clouds alone: 'off', none. */}
          {args.volume && args.atmosphere !== 'off' && (
            <SceneryCloudVolume
              scale={args.volumeScale}
              density={args.density}
              quality={args.quality}
              resolution={args.ownResolution ? args.resolution : undefined}
              seed={args.volumeSeed}
              debug={{
                view: args.debugView === 'none' ? undefined : args.debugView,
                air: args.debugAir,
                reference: {
                  steps: args.referenceSteps,
                  lightSamples: args.referenceLightSamples,
                  skySamples: args.referenceSkySamples,
                  bakedLight: args.referenceBakedLight,
                  blend: args.referenceBlend,
                },
              }}
              atmosphere={atmosphereOf(args)}
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
      options: ['custom', 'mid', 'high', 'sunset', 'night'],
      description:
        'The sun as a light condition to judge the clouds in: MID 35°, HIGH 70°, SUNSET 2° in the west, NIGHT (the moon). CUSTOM: the sun’s own controls.',
      table: { category: 'Reference' },
    },
    atmosphere: {
      control: { type: 'select' },
      options: ATMOSPHERES,
      description:
        'ATMOSPHERE: the clouds come out of these conditions (a simplified sounding and the surface’s heating): FAIR summer cumulus under an inversion, MARINE-SC a deck under a strong low inversion, STRATUS, STRATUS-VEIL, FOG, ALTOSTRATUS a veil aloft, UNSTABLE towering cumulus, SPREADING cumulus in moist air under an inversion that spread into stratocumulus as they lose their lift. Fills the conditions below; changing one makes it CUSTOM. OFF: no clouds. Slow.',
      table: { category: 'Atmosphere' },
    },
    temperature: range(-10, 35, 0.5, 'Air temperature at the surface (°C).', 'Atmosphere'),
    dewPoint: range(-15, 30, 0.5, 'Dew point at the surface (°C): how moist the surface air is. Condenses some 125 m up per degree under the temperature.', 'Atmosphere'),
    mixedLayer: range(0, 4000, 50, 'How high the surface air is mixed (m). Over its condensation height and under the inversion: a sheet (stratus, a deck, fog).', 'Atmosphere'),
    lapseRate: range(3, 9.8, 0.1, 'How fast the air cools from the mixed layer up to the inversion (K/km): over some 6, saturated thermals keep rising.', 'Atmosphere'),
    humidity: range(0, 1.1, 0.01, 'Relative humidity from the mixed layer up to the inversion: drier air eats the thermals’ clouds as they mix it in.', 'Atmosphere'),
    inversionHeight: range(100, 10000, 50, 'Height of the inversion (m): where the thermals stop, their tops flattening and spreading.', 'Atmosphere'),
    inversionStrength: range(0, 10, 0.1, 'How much warmer the air gets across the inversion (K): 0 for none.', 'Atmosphere'),
    lapseAbove: range(3, 9.8, 0.1, 'How fast the air cools over the inversion (K/km).', 'Atmosphere'),
    humidityAbove: range(0, 1.1, 0.01, 'Relative humidity over the inversion.', 'Atmosphere'),
    moistLayerHeight: range(0, 10000, 50, 'Base of a moist layer aloft (m): air lifted toward saturation, as ahead of a warm front.', 'Atmosphere'),
    moistLayerDepth: range(50, 3000, 50, 'How deep the moist layer is (m).', 'Atmosphere'),
    moistLayerHumidity: range(0, 1.1, 0.01, 'Relative humidity in the moist layer (0 for none). Over 1, the share condensed: just over, a thin veil; more, a deck.', 'Atmosphere'),
    heating: range(0, 1, 0.01, 'How strongly the surface heats the air: how many thermals rise, and how strong.', 'Atmosphere'),
    patchiness: range(0, 1, 0.01, 'How patchy the heating and the moisture are: clusters of thermals, holes in sheets.', 'Atmosphere'),
    shear: range(0, 6, 0.1, 'How much stronger the wind gets over the mixed layer (m/s per km): clouds lean and stretch downwind as they rise.', 'Atmosphere'),
    cloudMinutes: range(0, 240, 1, 'Jump the weather’s clock to this far into the clouds’ lives (minutes): each thermal’s cloud forms, grows, spreads and evaporates, and its place starts another.', 'Atmosphere'),
    cloudRate: {
      control: { type: 'select' },
      options: RATES,
      description: 'The weather clock’s rate (weather seconds a second): 1 real time. Paused with WEATHER PAUSED.',
      table: { category: 'Atmosphere' },
    },
    referenceSteps: range(50, 3000, 50, 'Most steps along a view.', 'Reference'),
    referenceLightSamples: range(
      1,
      64,
      1,
      'Samples toward the sun (or the moon) through every cloud.',
      'Reference',
    ),
    referenceSkySamples: range(
      1,
      32,
      1,
      'Samples straight up through every cloud: how much of the sky’s light from above reaches a point.',
      'Reference',
    ),
    referenceBakedLight: {
      control: { type: 'boolean' },
      description:
        'The light from a baked light volume beyond a point’s near cloud (fast), instead of marched in full with the samples above (the reference).',
      table: { category: 'Reference' },
    },
    referenceBlend: {
      control: { type: 'boolean' },
      description:
        'The clouds blended between the two bakes the clock lies between, baked ahead of it (smooth), instead of stepped from one bake to the next.',
      table: { category: 'Reference' },
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
    atmosphere: 'fair',
    ...ATMOSPHERE_PRESETS.fair,
    cloudMinutes: 0,
    cloudRate: 1,
    referenceSteps: 1500,
    referenceLightSamples: 16,
    referenceSkySamples: 8,
    referenceBakedLight: true,
    referenceBlend: true,
    light: 'custom',
    weatherPaused: false,
  } as CloudVolumeArgs,
} satisfies Meta<typeof CloudVolumeStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Over the field from 3 km, looking out over the cumulus's tops. */
export const Default: Story = {};

/** From 40 m over the sea, looking up into the cumulus's bases. */
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

/** A marine stratocumulus deck, drawn as strato, from over it. */
export const Strato: Story = {
  args: { preset: 'marine-sc', ...presetArgs('marine-sc') },
  parameters: {
    cameraPosition: [-9000, 2000, 9000],
    cameraTarget: [6000, 600, -6000],
  },
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

// The atmosphere's clouds (`atmosphere`): a summer afternoon's conditions ('fair') over a square
// some 16 km across about the middle (scene X/Z 0, 0), marched by brute force at half the
// screen's resolution, in the sun at mid height. Change the conditions, or pick another preset.
const REFERENCE_ARGS: Partial<CloudVolumeArgs> = {
  atmosphere: 'fair',
  ...ATMOSPHERE_PRESETS.fair,
  light: 'mid',
  ownResolution: true,
  resolution: 0.5,
  panel: false,
  weatherPaused: true,
};

/** REFERENCE, from the side at the clouds' height, 16 km off, the sun behind the camera. */
export const ReferenceSide: Story = {
  args: REFERENCE_ARGS,
  parameters: {
    cameraPosition: [0, 2500, 16000],
    cameraTarget: [0, 2500, 0],
  },
};

/** REFERENCE, close to the congestus's side, 5 km off. */
export const ReferenceClose: Story = {
  args: REFERENCE_ARGS,
  parameters: {
    cameraPosition: [-2500, 2200, 4500],
    cameraTarget: [0, 2500, 0],
  },
};

/** REFERENCE, from under the congestus's base, looking up. */
export const ReferenceBelow: Story = {
  args: REFERENCE_ARGS,
  parameters: {
    cameraPosition: [800, 200, 1800],
    cameraTarget: [0, 2200, 0],
  },
};

/** REFERENCE, from above, looking down on the tops some 30°. */
export const ReferenceAbove: Story = {
  args: REFERENCE_ARGS,
  parameters: {
    cameraPosition: [-9000, 9000, 9000],
    cameraTarget: [2000, 1500, -1000],
  },
};

/** REFERENCE, from 40 km off at the clouds' height. */
export const ReferenceFar: Story = {
  args: REFERENCE_ARGS,
  parameters: {
    cameraPosition: [-30000, 2500, 30000],
    cameraTarget: [2000, 2000, -1000],
  },
};

/** REFERENCE, inside the layer looking along it, past the clouds. */
export const ReferenceGrazing: Story = {
  args: REFERENCE_ARGS,
  parameters: {
    cameraPosition: [-14000, 1800, 2500],
    cameraTarget: [14000, 1800, 2500],
  },
};
