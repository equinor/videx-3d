import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { createOceanPlane } from '../../../sdk/geometries/ocean-geometry';
import type { Vec2, Vec3 } from '../../../sdk/types/common';
import { directionFromCompass } from '../../../sdk/utils/vector-operations';
import type { SeaQuality } from '../../../sdk/weather/sea-state';
import {
  SKY_PRESETS,
  WEATHER_LOCAL_RADIUS,
  type SkyPreset,
  type WeatherState,
} from '../../../sdk/weather/weather';
import type { WeatherGusts } from '../../../sdk/weather/wind-field';
import { SceneryArgsFeatures } from '../../../storybook/components/scenery-features';
import {
  sceneryArgs,
  sceneryPropsFromArgs,
  sceneryReliefFrame,
  skySunPosition,
  type SceneryArgs,
} from '../../../storybook/components/scenery-controls';
import { SceneryStoryRendering } from '../../../storybook/components/scenery-story-rendering';
import {
  SEA_POSE_AZIMUTH,
  SEA_POSES,
  SeaBenchBridge,
  type SeaBench,
  type SeaBenchConditions,
  type SeaPoseName,
  type SeaTimes,
  type SeaTourResult,
} from '../../../storybook/debug/sea-bench';
import { setStoryArgs } from '../../../storybook/debug/videx3d';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { RenderStats } from '../../Html/RenderStats/RenderStats';
import { Scenery } from '../../Scenery/Scenery';
import { SceneryClouds } from '../../Scenery/SceneryClouds';
import { SceneryStage } from '../../Scenery/SceneryStage';
import type { SceneryStageBounds } from '../../Scenery/scenery-stage';
import { Weather } from '../../Weather/Weather';
import { World } from '../../World/World';
import { Ocean } from '../Ocean';
import {
  OCEAN_DEBUG_VIEWS,
  type OceanDebugView,
  type OceanFoamTuning,
  type OceanWaveTuning,
} from '../ocean-material';

// The sea alone, to time it (documents/ocean.md, "Measuring"): the stand-alone `Ocean` or a
// `Scenery`'s endless sea, with the same sun, wind and poses, in a canvas of a fixed size at a
// fixed pixel ratio. The panel (top right) runs `window.videx3d.seaBench`
// (src/storybook/debug/sea-bench.ts) and shows what it measured, with the conditions.

const VIEWPORTS = {
  '960x540': [960, 540],
  '1280x720': [1280, 720],
  '1920x1080': [1920, 1080],
  fill: null,
} as const;
type Viewport = keyof typeof VIEWPORTS;

// The stand-alone sea: a plane the size of a large field. Seen from higher than 20 km its edge
// is in view, so the poses from there up are the Scenery's alone.
const OCEAN_SIZE = 50000;
// The stand-alone sea displaced: a smaller plane, fine enough for its long waves.
const DISPLACED_SIZE = 6000;
const DISPLACED_SEGMENTS = 1024;
const OCEAN_POSES: SeaPoseName[] = ['2m', '30m', '300m', '2km', '20km', 'down'];
const SCENERY_POSES = Object.keys(SEA_POSES) as SeaPoseName[];

// As the Scenery's Timelapse: a stage over the field, a seabed 100 m down.
const STAGE: SceneryStageBounds = [-5000, -5000, 5000, 5000];
const DEPTH = 100;

const PRESETS = Object.keys(SKY_PRESETS) as SkyPreset[];

type SeaBenchArgs = {
  viewport: Viewport;
  pixelRatio: number;
  scene: 'ocean' | 'scenery';
  /** the stand-alone sea's quality (`Ocean`'s `quality`) */
  quality: SeaQuality;
  pose: SeaPoseName;
  sunHour: number;
  windSpeed: number;
  /** the compass bearing the wind blows toward */
  windDirection: number;
  foamAmount: number;
  /** the waves' slopes for show (`steepness`); 1 as the spectrum gives them */
  steepness: number;
  /** ⚠️ Tuning (`OceanWaveTuning`): the short waves' least spreading exponent; 1 as now */
  spreadFloor: number;
  /** ⚠️ Tuning: waves above this many times the peak frequency fade out; 0 none */
  tail: number;
  /** ⚠️ Tuning: the ripples' strength; 1 as now */
  ripples: number;
  /** ⚠️ Tuning: the layers hex-tiled; off reads one plain copy (repeats) */
  hex: boolean;
  /** ⚠️ Tuning: the hex blend sharpened by this power; 1 as now */
  hexSharpness: number;
  /** ⚠️ Foam tuning (`OceanFoamTuning`), defaults as drawn */
  foamBreakup: number;
  foamEdge: number;
  foamFroth: number;
  foamFalloff: number;
  foamFarFade: number;
  foamOpacity: number;
  foamLit: number;
  foamLift: number;
  foamGrain: number;
  foamGrainScale: number;
  foamNarrow: number;
  /** ⚠️ Debug: a view of the sea in place of its surface (`OceanFoamTuning.debug`) */
  debugView: OceanDebugView;
  /** the gusts' strength as the wind gives it (`gustStrengthFor`) */
  gustAuto: boolean;
  /** the gusts' strength, where not as the wind gives it (`WeatherGusts.strength`) */
  gustStrength: number;
  /** the largest gusts across, metres (`WeatherGusts.scale`) */
  gustScale: number;
  /** the share of the slicks the wind allows (`WeatherGusts.slicks`) */
  slicks: number;
  /** the slicks across, metres (`WeatherGusts.slickScale`) */
  slickScale: number;
  /** ⚠️ Tuning (`OceanWaveTuning.roughReflect`) */
  roughReflect: number;
  /** the stand-alone sea's vertices moved by its long waves (`Ocean`'s `displacement`) */
  displacement: boolean;
  stage: boolean;
  /** the waves (and clouds) held still: the enclosing `Weather`'s clock paused */
  paused: boolean;
  /** the waves' (and clouds') pace: the `Weather`'s `timeScale` */
  timeScale: number;
  clouds: 'none' | SkyPreset;
  /** the frame stats overlay (`RenderStats`), bottom left */
  stats: boolean;
};

// The wave model's open choices, as the args have them.
const tuningOf = (args: SeaBenchArgs): OceanWaveTuning => ({
  spreadFloor: args.spreadFloor,
  tail: args.tail > 0 ? args.tail : undefined,
  ripples: args.ripples,
  hex: args.hex,
  hexSharpness: args.hexSharpness,
  roughReflect: args.roughReflect,
});

// The weather's gusts and slicks, as the args have them.
const gustsOf = (args: SeaBenchArgs): WeatherGusts => ({
  strength: args.gustAuto ? undefined : args.gustStrength,
  scale: args.gustScale,
  slicks: args.slicks,
  slickScale: args.slickScale,
});

// The foam's shaping, as the args have it.
const foamTuningOf = (args: SeaBenchArgs): OceanFoamTuning => ({
  breakup: args.foamBreakup,
  edge: args.foamEdge,
  froth: args.foamFroth,
  falloff: args.foamFalloff,
  farFade: args.foamFarFade,
  opacity: args.foamOpacity,
  lit: args.foamLit,
  lift: args.foamLift,
  grain: args.foamGrain,
  grainScale: args.foamGrainScale,
  narrow: args.foamNarrow,
  debug: args.debugView,
});

// The Scenery's args the bench sets; the rest as the scenery stories have them.
const skyArgs = (args: SeaBenchArgs): SceneryArgs => ({
  ...sceneryArgs,
  sunFromTime: true,
  sunHour: args.sunHour,
  hollow: false,
  windSpeed: args.windSpeed,
  windDirection: args.windDirection,
  foamAmount: args.foamAmount,
  seaSteepness: args.steepness,
  seaWaveTuning: tuningOf(args),
  seaFoamTuning: foamTuningOf(args),
  seaQuality: args.quality,
});

// A compass bearing as the sea's X/Z, north −Z (as sceneryOceanFromArgs).
const windOf = (bearing: number): Vec2 => [
  Math.sin((bearing * Math.PI) / 180),
  -Math.cos((bearing * Math.PI) / 180),
];

// The camera to the pose, once the controls are there, and again as it changes.
const BenchPose = ({ pose }: { pose: SeaPoseName }) => {
  useEffect(() => {
    let frame = 0;
    const tryPose = () => {
      const camera = window.videx3d?.camera;
      if (camera?.controls)
        void camera.orbit({
          ...SEA_POSES[pose],
          azimuth: SEA_POSE_AZIMUTH,
          target: [0, 0, 0],
          transition: false,
        });
      else frame = requestAnimationFrame(tryPose);
    };
    tryPose();
    return () => cancelAnimationFrame(frame);
  }, [pose]);
  return null;
};

const StandAlone = ({
  args,
  sky,
}: {
  args: SeaBenchArgs;
  sky: SceneryArgs;
}) => {
  // Displaced, a plane fine enough for its long waves: 6 km at about 6 m a vertex.
  const geometry = useMemo(
    () =>
      args.displacement
        ? createOceanPlane({
            size: DISPLACED_SIZE,
            surfaceSegments: DISPLACED_SEGMENTS,
          })
        : createOceanPlane({ size: OCEAN_SIZE }),
    [args.displacement],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { azimuth, elevation } = skySunPosition(sky);
  const sunDirection = directionFromCompass(azimuth, elevation) as Vec3;
  return (
    <Ocean
      geometry={geometry}
      quality={args.quality}
      displacement={args.displacement}
      windSpeed={args.windSpeed}
      windDirection={windOf(args.windDirection)}
      foamAmount={args.foamAmount}
      steepness={args.steepness}
      waveTuning={tuningOf(args)}
      foamTuning={foamTuningOf(args)}
      sunDirection={sunDirection}
      // As the Ocean stories.
      sunColor="#d6d39f"
      skyColor="#465a6a"
    />
  );
};

const weatherOf = (preset: SkyPreset): WeatherState => {
  const { layers, wind } = SKY_PRESETS[preset];
  return {
    wind,
    clouds: [...layers],
    local: { radius: WEATHER_LOCAL_RADIUS },
  };
};

// No clouds: the args' wind, its gusts, and the clock, which `paused` and `timeScale` set.
const calmOf = (args: SeaBenchArgs, gusts: WeatherGusts): WeatherState => ({
  clouds: [],
  wind: {
    speed: args.windSpeed,
    from: (args.windDirection + 180) % 360,
    gusts,
  },
  local: { radius: WEATHER_LOCAL_RADIUS },
});

// The bench's weather: a preset's sky and wind, or calm; the gusts the args'. The seas take
// their own wind, so from the weather only its gusts.
const useBenchWeather = (args: SeaBenchArgs): WeatherState => {
  const { clouds, windSpeed, windDirection } = args;
  const { gustAuto, gustStrength, gustScale, slicks, slickScale } = args;
  return useMemo(() => {
    const gusts = gustsOf({
      gustAuto,
      gustStrength,
      gustScale,
      slicks,
      slickScale,
    } as SeaBenchArgs);
    // Hidden for the stand-alone sea, the `clouds` arg is not passed at all.
    if (!clouds || clouds === 'none')
      return calmOf({ windSpeed, windDirection } as SeaBenchArgs, gusts);
    const weather = weatherOf(clouds);
    const wind = weather.wind ?? {
      speed: windSpeed,
      from: (windDirection + 180) % 360,
    };
    return { ...weather, wind: { ...wind, gusts } };
  }, [
    clouds,
    windSpeed,
    windDirection,
    gustAuto,
    gustStrength,
    gustScale,
    slicks,
    slickScale,
  ]);
};

const SceneryScene = ({
  args,
  sky,
}: {
  args: SeaBenchArgs;
  sky: SceneryArgs;
}) => {
  const weather = useBenchWeather(args);
  const scenery = (
    <Scenery {...sceneryPropsFromArgs(sky)}>
      <SceneryArgsFeatures
        args={sky}
        ocean={{ level: 0, depth: DEPTH }}
        abyss={{}}
      />
      {args.stage && <SceneryStage boundary={STAGE} />}
      {args.clouds && args.clouds !== 'none' && (
        <SceneryClouds quality="medium" />
      )}
    </Scenery>
  );
  return (
    <World frame={sceneryReliefFrame(sky)} globe={sky.globe}>
      <SceneryStoryRendering args={sky} />
      <Weather
        weather={weather}
        paused={args.paused}
        timeScale={args.timeScale}
      >
        {scenery}
      </Weather>
    </World>
  );
};

const SeaBenchStory = (args: SeaBenchArgs) => {
  const sky = skyArgs(args);
  const ocean = args.scene === 'ocean';
  const weather = useBenchWeather(args);
  return (
    <>
      {ocean ? (
        <Weather
          weather={weather}
          paused={args.paused}
          timeScale={args.timeScale}
        >
          <StandAlone args={args} sky={sky} />
        </Weather>
      ) : (
        <SceneryScene args={args} sky={sky} />
      )}
      <BenchPose pose={args.pose} />
      <SeaBenchBridge poses={ocean ? OCEAN_POSES : SCENERY_POSES} />
      {args.stats && <RenderStats origin="bottom-left" />}
    </>
  );
};

const PANEL: CSSProperties = {
  position: 'fixed',
  top: 10,
  right: 10,
  zIndex: 10,
  width: 360,
  maxHeight: 'calc(100vh - 20px)',
  overflow: 'auto',
  padding: 8,
  background: 'rgba(20, 22, 26, 0.85)',
  color: '#ddd',
  font: '11px monospace',
  borderRadius: 4,
};
const ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 3,
  alignItems: 'center',
  marginBottom: 4,
};
const BUTTON: CSSProperties = { fontSize: 11, padding: '1px 5px' };

const conditionsText = (c: SeaBenchConditions) =>
  [
    `${c.viewport.join('×')} css @${c.pixelRatio} → ${c.drawingBuffer.join('×')}`,
    c.gpu,
    ...(c.hookedWebGL.length > 0
      ? [`⚠ WebGL hooked: ${c.hookedWebGL.join(', ')} (CPU times off)`]
      : []),
  ].join('\n');

const timesText = (t: SeaTimes) =>
  `sea ${t.sea} ms, frame ${t.frame}, cpu ${t.cpu}\n` +
  Object.entries(t.draws)
    .map(([name, ms]) => `  ${name.padEnd(13)} ${ms}`)
    .join('\n');

const tourText = (r: SeaTourResult) =>
  Object.entries(r.poses)
    .map(
      ([name, t]) =>
        `${name.padEnd(7)} sea ${String(t.sea).padEnd(6)} frame ${String(t.frame).padEnd(6)} ×${t.spread}  ` +
        Object.entries(t.draws)
          .map(([group, ms]) => `${group} ${ms}`)
          .join(', '),
    )
    .join('\n');

const bench = (): SeaBench => {
  const found = window.videx3d?.seaBench;
  if (!found) throw new Error('no sea bench yet');
  return found;
};

// The bench's buttons and what it measured last: outside the canvas, so it is in none of it.
const BenchPanel = ({ args }: { args: SeaBenchArgs }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async <T extends { conditions: SeaBenchConditions }>(
    label: string,
    work: () => Promise<T>,
    format: (result: T) => string,
  ) => {
    if (busy) return;
    setBusy(true);
    setText(`${label}…`);
    try {
      const result = await work();
      console.log(`sea bench ${label}`, result);
      setText(
        `${label}\n${format(result)}\n${conditionsText(result.conditions)}`,
      );
    } catch (error) {
      setText(`${label}: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const poses = args.scene === 'ocean' ? OCEAN_POSES : SCENERY_POSES;
  const buttons: [string, () => void][] = [
    ['frames', () => void run('frames', () => bench().frames(), timesText)],
    ['tour', () => void run('tour', () => bench().tour(), tourText)],
    [
      'cool 30 s',
      () =>
        void run(
          'cool 30 s',
          async () => {
            await bench().hold(30);
            return { conditions: bench().conditions() };
          },
          () => 'held',
        ),
    ],
  ];
  return (
    <div style={PANEL}>
      <div style={ROW}>
        pose
        {poses.map(name => (
          <button
            key={name}
            style={{
              ...BUTTON,
              fontWeight: args.pose === name ? 'bold' : undefined,
            }}
            onClick={() => void setStoryArgs({ pose: name })}
          >
            {name}
          </button>
        ))}
      </div>
      <div style={ROW}>
        time
        {buttons.map(([label, click]) => (
          <button key={label} style={BUTTON} disabled={busy} onClick={click}>
            {label}
          </button>
        ))}
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</pre>
    </div>
  );
};

// The canvas in a box of a fixed size (VIEWPORTS), the panel over the frame's top right; 'fill'
// fills the frame.
const viewportDecorator: Decorator = (Story, { args }) => {
  const size = VIEWPORTS[(args as SeaBenchArgs).viewport];
  return (
    <>
      {size ? (
        <div
          style={{
            position: 'relative',
            width: size[0],
            height: size[1],
            overflow: 'hidden',
          }}
        >
          {Story()}
        </div>
      ) : (
        Story()
      )}
      <BenchPanel args={args as SeaBenchArgs} />
    </>
  );
};

const meta = {
  title: 'debug/Ocean/Sea Bench',
  component: SeaBenchStory,
  decorators: [Canvas3dDecorator, viewportDecorator],
  parameters: {
    layout: 'fullscreen',
    scale: 1000,
    // Past the horizon from 1000 km up.
    far: 5000000,
    // The stand-alone sea's sky; a Scenery draws its own over it.
    background: '#bcd4e6',
    autoClear: true,
    cameraPosition: [0, 300, -1000],
    cameraTarget: [0, 0, 0],
    ownLighting: (args: SeaBenchArgs) => args.scene === 'scenery',
    pixelRatio: (args: SeaBenchArgs) => args.pixelRatio,
  },
  argTypes: {
    viewport: {
      table: { category: 'Bench' },
      control: { type: 'inline-radio' },
      options: Object.keys(VIEWPORTS),
      description:
        'The canvas’s size in CSS pixels, fixed whatever the frame’s; FILL fills the frame.',
    },
    pixelRatio: {
      table: { category: 'Bench' },
      control: { type: 'inline-radio' },
      options: [1, 1.5, 2],
      description: 'The canvas’s pixel ratio, fixed whatever the screen’s.',
    },
    scene: {
      table: { category: 'Bench' },
      control: { type: 'inline-radio' },
      options: ['ocean', 'scenery'],
      description:
        'OCEAN: the stand-alone `Ocean`, a 50 km plane. SCENERY: a `Scenery`’s endless sea, with a stage over the field as in its Timelapse.',
    },
    quality: {
      table: { category: 'Bench' },
      control: { type: 'inline-radio' },
      options: ['low', 'medium', 'high', 'ultra'],
      description:
        'The sea’s `quality` (`SEA_QUALITY`): LOW three coarse layers; MEDIUM four, down to 0.23 m waves; HIGH ripples below that, to about 4 cm; ULTRA finer tiles.',
    },
    displacement: {
      table: { category: 'Bench' },
      control: { type: 'boolean' },
      description:
        'The stand-alone sea’s vertices moved by its long waves (`displacement`), on a 6 km plane of about 6 m a vertex (its edge shows from a few hundred metres up).',
      if: { arg: 'scene', eq: 'ocean' },
    },
    debugView: {
      table: { category: 'Bench' },
      control: { type: 'inline-radio' },
      options: OCEAN_DEBUG_VIEWS,
      description:
        'WHITECAPS: grey by the crests’ height, red where foam forms, blue on the crests’ backs (the side the foam trails on as they run on downwind), amber on their fronts. CRESTS: the crests’ height as a ramp (blue low, red high), the foam’s threshold for the wind as a white line. WIND: the local wind over the mean (blue a lull, white the mean, red a gust, full at ±50 %), green where a slick lies.',
    },
    pose: {
      table: { category: 'Bench' },
      control: { type: 'inline-radio' },
      options: SCENERY_POSES,
      description:
        'The camera’s height over the sea, looking south about the origin; DOWN straight down from 2 km. The stand-alone sea’s edge shows from 20 km, and from 100 km it is out of sight.',
    },
    sunHour: {
      table: { category: 'Conditions' },
      control: { type: 'range', min: 0, max: 24, step: 0.1 },
      description:
        'Local solar time, on the scenery stories’ date and place (2024-09-10, 58.4° N).',
    },
    windSpeed: {
      table: { category: 'Conditions' },
      control: { type: 'range', min: 0, max: 25, step: 0.5 },
    },
    windDirection: {
      table: { category: 'Conditions' },
      control: { type: 'range', min: 0, max: 360, step: 1 },
      description: 'The compass bearing the wind blows toward.',
    },
    foamAmount: {
      table: { category: 'Conditions' },
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
    },
    steepness: {
      control: { type: 'range', min: 0, max: 2, step: 0.05 },
      description:
        'The waves’ slopes for show: 1 as the spectrum gives them (the stories used 0.7 before 2026-11).',
      table: { category: 'Wave model (tuning)' },
    },
    spreadFloor: {
      control: { type: 'range', min: 1, max: 20, step: 0.5 },
      description:
        'The short waves’ least spreading exponent s (cos²ˢ). 1: nearly isotropic, some running upwind (as now); 4: about ±40°, none upwind; 10+: long-crested.',
      table: { category: 'Wave model (tuning)' },
    },
    tail: {
      control: { type: 'range', min: 0, max: 10, step: 0.5 },
      description:
        'Waves above this many times the peak frequency fade out (3 ≈ what the Ocean drew before, ≈ 10 m waves at 10 m/s); 0 the whole tail (as now). Cutting it also weakens the ripples.',
      table: { category: 'Wave model (tuning)' },
    },
    ripples: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'The ripples (the finest layer read again, smaller); 0 off, their slopes only roughening the glint.',
      table: { category: 'Wave model (tuning)' },
    },
    hex: {
      control: { type: 'boolean' },
      description:
        'The layers read hex-tiled (as now); off reads one plain copy of each tile, which repeats — to see what the blend does to the crests.',
      table: { category: 'Wave model (tuning)' },
    },
    hexSharpness: {
      control: { type: 'range', min: 1, max: 8, step: 0.5 },
      description:
        'The hex cells’ blend sharpened by this power: less mixing of copies, so crests stay whole, at harder seams.',
      table: { category: 'Wave model (tuning)' },
    },
    foamBreakup: {
      control: { type: 'range', min: 0, max: 2, step: 0.05 },
      description:
        'The finer waves’ share in the crests the foam is cut from: higher, smaller and more broken patches. 1 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamEdge: {
      control: { type: 'range', min: 0, max: 0.2, step: 0.005 },
      description:
        'The rim’s width up close: 0 hard cut-outs, higher a soft feather. 0.03 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamFroth: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'How much the ripples dim the foam’s inside, so it is not one flat white. 0.45 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamFalloff: {
      control: { type: 'range', min: 0.06, max: 1, step: 0.02 },
      description:
        'Where thin foam turns opaque up close: low, thin foam is opaque too; high, it stays a translucent veil. 0.6 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamFarFade: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'The share of the foam lost once below a pixel (far off): 0 keeps it, the sea whitening evenly. 0.85 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'The most the foam covers. 1 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamLit: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'The foam lit as a rough surface on the wave, by the same sky and sun as the water (albedo 0.8): 0 flat white as now, 1 fully lit.',
      table: { category: 'Foam (tuning)' },
    },
    foamLift: {
      control: { type: 'range', min: 0, max: 0.5, step: 0.01 },
      description: 'A brighter rim. 0 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamGrain: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Smooth noise in two octaves of world cells, roughening the rim and speckling thin foam; it fades out once a cell is under a pixel. 0 as now.',
      table: { category: 'Foam (tuning)' },
    },
    foamGrainScale: {
      control: { type: 'range', min: 0.01, max: 1, step: 0.01 },
      description: 'The grain’s cell, metres.',
      table: { category: 'Foam (tuning)' },
    },
    foamNarrow: {
      control: { type: 'range', min: 0, max: 3, step: 0.05 },
      description:
        'The foam narrowed toward the crest lines: long along a crest, thin across it. About as much of the sea stays foam. 0 as now.',
      table: { category: 'Foam (tuning)' },
    },
    gustAuto: {
      control: { type: 'boolean' },
      description:
        'The gusts’ strength as the wind gives it (`gustStrengthFor`: about 0.38 in light air, 0.24 in a gale).',
      table: { category: 'Gusts (weather)' },
    },
    gustStrength: {
      control: { type: 'range', min: 0, max: 0.6, step: 0.01 },
      description:
        'The local wind’s spread about the mean, a share of it (one standard deviation). 0: no gusts.',
      table: { category: 'Gusts (weather)' },
      if: { arg: 'gustAuto', truthy: false },
    },
    gustScale: {
      control: { type: 'range', min: 200, max: 10000, step: 100 },
      description:
        'The largest gusts across, metres, running downwind; cat’s paws are a 25th of it.',
      table: { category: 'Gusts (weather)' },
    },
    slicks: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'The share of the slicks the wind allows (all in light air, none from about 10 m/s): calm streaks along the wind.',
      table: { category: 'Gusts (weather)' },
    },
    slickScale: {
      control: { type: 'range', min: 50, max: 2000, step: 10 },
      description:
        'The slicks across, metres; five times as long along the wind.',
      table: { category: 'Gusts (weather)' },
    },
    roughReflect: {
      control: { type: 'range', min: 0, max: 3, step: 0.05 },
      description:
        '⚠️ Tuning: how much rougher water (a gust) turns the reflection up the sky and hides more of it toward grazing, smoother (a lull, a slick) mirroring the horizon. 0: the gusts only change the glint. 1 as drawn.',
      table: { category: 'Gusts (weather)' },
    },
    stage: {
      table: { category: 'Bench' },
      control: { type: 'boolean' },
      description:
        'A `SceneryStage` over the field (10 km square), which draws the sea there and out to its reach.',
      if: { arg: 'scene', eq: 'scenery' },
    },
    paused: {
      table: { category: 'Bench' },
      control: { type: 'boolean' },
      description:
        'The waves (and clouds) held still: the `Weather`’s clock paused. The camera and every control still work.',
    },
    timeScale: {
      table: { category: 'Bench' },
      control: { type: 'range', min: 0, max: 4, step: 0.05 },
      description:
        'The waves’ (and clouds’) pace: the `Weather`’s `timeScale`.',
    },
    clouds: {
      table: { category: 'Bench' },
      control: { type: 'select' },
      options: ['none', ...PRESETS],
      description:
        'A local weather’s sky (`SKY_PRESETS`), drawn by `SceneryClouds` at medium quality; the sea keeps its own wind.',
      if: { arg: 'scene', eq: 'scenery' },
    },
    stats: {
      table: { category: 'Bench' },
      control: { type: 'boolean' },
      description: 'The frame stats overlay (`RenderStats`), bottom left.',
    },
  },
  args: {
    viewport: '1920x1080',
    pixelRatio: 1,
    scene: 'scenery',
    quality: 'medium',
    pose: '300m',
    sunHour: 10,
    windSpeed: 10,
    windDirection: 90,
    foamAmount: 0.5,
    steepness: 1,
    spreadFloor: 1,
    tail: 0,
    ripples: 1,
    hex: true,
    hexSharpness: 1,
    foamBreakup: 1,
    foamEdge: 0.03,
    foamFroth: 0.45,
    foamFalloff: 0.6,
    foamFarFade: 0.85,
    foamOpacity: 1,
    foamLit: 0,
    foamLift: 0,
    foamGrain: 0,
    foamGrainScale: 0.1,
    foamNarrow: 0,
    debugView: 'none',
    gustAuto: true,
    gustStrength: 0.3,
    gustScale: 3000,
    slicks: 1,
    slickScale: 400,
    roughReflect: 1,
    displacement: false,
    stage: true,
    paused: false,
    timeScale: 1,
    clouds: 'none',
    stats: false,
  },
} satisfies Meta<typeof SeaBenchStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A `Scenery`'s sea, with a stage over the field, 1920 × 1080 at a pixel ratio of 1, from 300 m. */
export const Default: Story = {};

/** The stand-alone `Ocean`, a 50 km plane, at the same size, sun, wind and pose. */
export const StandAloneOcean: Story = {
  args: { scene: 'ocean' },
};
