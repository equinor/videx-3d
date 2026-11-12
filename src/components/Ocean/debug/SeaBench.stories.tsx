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
  stage: boolean;
  clouds: 'none' | SkyPreset;
  /** the frame stats overlay (`RenderStats`), bottom left */
  stats: boolean;
};

// The Scenery's args the bench sets; the rest as the scenery stories have them.
const skyArgs = (args: SeaBenchArgs): SceneryArgs => ({
  ...sceneryArgs,
  sunFromTime: true,
  sunHour: args.sunHour,
  hollow: false,
  windSpeed: args.windSpeed,
  windDirection: args.windDirection,
  foamAmount: args.foamAmount,
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
  const geometry = useMemo(() => createOceanPlane({ size: OCEAN_SIZE }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { azimuth, elevation } = skySunPosition(sky);
  const sunDirection = directionFromCompass(azimuth, elevation) as Vec3;
  return (
    <Ocean
      geometry={geometry}
      quality={args.quality}
      windSpeed={args.windSpeed}
      windDirection={windOf(args.windDirection)}
      foamAmount={args.foamAmount}
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

const SceneryScene = ({
  args,
  sky,
}: {
  args: SeaBenchArgs;
  sky: SceneryArgs;
}) => {
  const weather = useMemo(
    () => (args.clouds === 'none' ? null : weatherOf(args.clouds)),
    [args.clouds],
  );
  const scenery = (
    <Scenery {...sceneryPropsFromArgs(sky)}>
      <SceneryArgsFeatures
        args={sky}
        ocean={{ level: 0, depth: DEPTH }}
        abyss={{}}
      />
      {args.stage && <SceneryStage boundary={STAGE} />}
      {weather && <SceneryClouds quality="medium" />}
    </Scenery>
  );
  return (
    <World frame={sceneryReliefFrame(sky)} globe={sky.globe}>
      <SceneryStoryRendering args={sky} />
      {weather ? <Weather weather={weather}>{scenery}</Weather> : scenery}
    </World>
  );
};

const SeaBenchStory = (args: SeaBenchArgs) => {
  const sky = skyArgs(args);
  const ocean = args.scene === 'ocean';
  return (
    <>
      {ocean ? (
        <StandAlone args={args} sky={sky} />
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
      control: { type: 'inline-radio' },
      options: Object.keys(VIEWPORTS),
      description:
        'The canvas’s size in CSS pixels, fixed whatever the frame’s; FILL fills the frame.',
    },
    pixelRatio: {
      control: { type: 'inline-radio' },
      options: [1, 1.5, 2],
      description: 'The canvas’s pixel ratio, fixed whatever the screen’s.',
    },
    scene: {
      control: { type: 'inline-radio' },
      options: ['ocean', 'scenery'],
      description:
        'OCEAN: the stand-alone `Ocean`, a 50 km plane. SCENERY: a `Scenery`’s endless sea, with a stage over the field as in its Timelapse.',
    },
    quality: {
      control: { type: 'inline-radio' },
      options: ['low', 'medium', 'high', 'ultra'],
      description:
        'The stand-alone sea’s `quality`: how much of the sea state’s waves it draws (`SEA_QUALITY`).',
      if: { arg: 'scene', eq: 'ocean' },
    },
    pose: {
      control: { type: 'inline-radio' },
      options: SCENERY_POSES,
      description:
        'The camera’s height over the sea, looking south about the origin; DOWN straight down from 2 km. The stand-alone sea’s edge shows from 20 km, and from 100 km it is out of sight.',
    },
    sunHour: {
      control: { type: 'range', min: 0, max: 24, step: 0.1 },
      description:
        'Local solar time, on the scenery stories’ date and place (2024-09-10, 58.4° N).',
    },
    windSpeed: { control: { type: 'range', min: 0, max: 25, step: 0.5 } },
    windDirection: {
      control: { type: 'range', min: 0, max: 360, step: 1 },
      description: 'The compass bearing the wind blows toward.',
    },
    foamAmount: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    stage: {
      control: { type: 'boolean' },
      description:
        'A `SceneryStage` over the field (10 km square), which draws the sea there and out to its reach.',
      if: { arg: 'scene', eq: 'scenery' },
    },
    clouds: {
      control: { type: 'select' },
      options: ['none', ...PRESETS],
      description:
        'A local weather’s sky (`SKY_PRESETS`), drawn by `SceneryClouds` at medium quality; the sea keeps its own wind.',
      if: { arg: 'scene', eq: 'scenery' },
    },
    stats: {
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
    stage: true,
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
