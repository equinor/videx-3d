import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { Vec3 } from '../../../sdk/types/common';
import {
  SKY_PRESETS,
  WEATHER_LOCAL_RADIUS,
  type SkyPreset,
  type WeatherState,
} from '../../../sdk/weather/weather';
import {
  sceneryArgs,
  sceneryPropsFromArgs,
  sceneryReliefArgs,
  sceneryReliefFrame,
  sceneryReliefFromArgs,
} from '../../../storybook/components/scenery-controls';
import {
  CloudBenchBridge,
  type BenchConditions,
  type CloudBench,
  type CountResult,
  type FramesResult,
  type PassResult,
} from '../../../storybook/debug/cloud-bench';
import { setStoryArgs } from '../../../storybook/debug/videx3d';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { GeoRelief } from '../../Layers/GeoRelief';
import { Weather } from '../../Weather/Weather';
import { World } from '../../World/World';
import { Scenery, type SceneryLayer } from '../Scenery';
import { SceneryClouds } from '../SceneryClouds';
import { CLOUDS_QUALITY } from '../scenery-clouds';
import type {
  SceneryCloudsQuality,
  SceneryCloudsTemporal,
} from '../scenery-model';

// The 3D clouds alone, to time them (documents/clouds.md, "Measuring"): a bare Scenery (no sky
// drawn behind them, no sea, stage, hollow, bakes or relief unless asked for) and its
// SceneryClouds, in a canvas of a fixed size at a fixed pixel ratio, from named poses. The
// panel (top right) runs `window.videx3d.cloudBench` (src/storybook/debug/cloud-bench.ts) and
// shows what it measured, with the conditions it measured under.

const VIEWPORTS = {
  '960x540': [960, 540],
  '1280x720': [1280, 720],
  '1920x1080': [1920, 1080],
  fill: null,
} as const;
type Viewport = keyof typeof VIEWPORTS;

// Scene metres (X east, Z south; the local weather's middle at 0, 0), for the 'scattered' sky's
// cumulus (1200–2400 m): the camera's place and what it looks at.
const POSES = {
  // Over the field from 3 km, out over the clouds (the Clouds spike's default).
  over: [
    [-9000, 3000, 9000],
    [6000, 1200, -6000],
  ],
  // 40 m over the sea, up into their bases.
  below: [
    [0, 40, 0],
    [3000, 1800, -2000],
  ],
  // In the layer, along it to the horizon: the hardest view to march.
  level: [
    [-6000, 1800, 4000],
    [14000, 1800, 4000],
  ],
  // From 3 km, 30° down.
  down: [
    [0, 3000, 0],
    [5196, 0, 0],
  ],
  // 200 km up.
  high: [
    [0, 200000, 120000],
    [0, 0, 0],
  ],
  // The whole Earth.
  earth: [
    [0, 14000000, 14000000],
    [0, 0, 0],
  ],
} satisfies Record<string, [Vec3, Vec3]>;
type Pose = keyof typeof POSES;

const PRESETS = Object.keys(SKY_PRESETS) as SkyPreset[];

// The background's own layers, hidden without SKY: the clouds' layer kept, which theirs follows.
const SKY_HIDDEN: SceneryLayer[] = ['sky', 'abyss', 'sea', 'water', 'surface'];

type CloudBenchArgs = {
  viewport: Viewport;
  pixelRatio: number;
  pose: Pose;
  weatherMode: 'local' | 'global';
  preset: SkyPreset;
  systemsSeed: number;
  quality: SceneryCloudsQuality;
  /** how the march reuses the last frames: 'quality' as the quality has it */
  temporal: 'quality' | SceneryCloudsTemporal;
  ownResolution: boolean;
  resolution: number;
  /** none: the sea's level everywhere; loaded: the relief's ground, not drawn; drawn: and drawn */
  ground: 'none' | 'loaded' | 'drawn';
  /** the sky drawn behind them */
  sky: boolean;
  /** the Scenery's bakes (its environment and light probe), which take in the clouds */
  bakes: boolean;
  lightMap: boolean;
  weatherPaused: boolean;
  cloudRate: number;
  debugView: 'none' | 'cost' | 'unlit';
};

function weatherOf(args: CloudBenchArgs): WeatherState {
  const { layers, wind } = SKY_PRESETS[args.preset];
  if (args.weatherMode === 'global')
    return { wind, systems: { seed: args.systemsSeed } };
  return {
    wind,
    clouds: [...layers],
    local: { radius: WEATHER_LOCAL_RADIUS },
  };
}

// The camera to the pose, once the controls are there, and again as it changes.
const BenchPose = ({ pose }: { pose: Pose }) => {
  useEffect(() => {
    let frame = 0;
    const [position, target] = POSES[pose];
    const tryPose = () => {
      const camera = window.videx3d?.camera;
      if (camera?.controls)
        void camera.lookAt({
          position: position as Vec3,
          target: target as Vec3,
          transition: false,
        });
      else frame = requestAnimationFrame(tryPose);
    };
    tryPose();
    return () => cancelAnimationFrame(frame);
  }, [pose]);
  return null;
};

const CloudBenchStory = (args: CloudBenchArgs) => {
  // The background on (the clouds show only with it), its own layers hidden but with SKY.
  const sky = {
    ...sceneryArgs,
    sunFromTime: true,
    hollow: false,
    environment: args.bakes,
    lightProbe: args.bakes,
  };
  const props = sceneryPropsFromArgs(sky);
  const weatherKey = JSON.stringify(weatherOf(args));
  const weather = useMemo(
    () => JSON.parse(weatherKey) as WeatherState,
    [weatherKey],
  );
  const relief =
    args.ground === 'none'
      ? undefined
      : sceneryReliefFromArgs({ ...sceneryReliefArgs, relief: true });
  return (
    <World frame={sceneryReliefFrame(sky)} globe>
      <Weather
        weather={weather}
        timeScale={args.cloudRate}
        paused={args.weatherPaused}
      >
        <Scenery
          {...props}
          debug={{ ...props.debug, hide: args.sky ? undefined : SKY_HIDDEN }}
        >
          <SceneryClouds
            quality={args.quality}
            temporal={args.temporal === 'quality' ? undefined : args.temporal}
            resolution={args.ownResolution ? args.resolution : undefined}
            terrain={args.ground !== 'none'}
            lightMap={args.lightMap}
            debug={{
              view: args.debugView === 'none' ? undefined : args.debugView,
            }}
          />
        </Scenery>
      </Weather>
      {relief && <GeoRelief {...relief} visible={args.ground === 'drawn'} />}
      <BenchPose pose={args.pose} />
      <CloudBenchBridge />
    </World>
  );
};

const PANEL: CSSProperties = {
  position: 'fixed',
  top: 10,
  right: 10,
  zIndex: 10,
  width: 340,
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

const conditionsText = (c: BenchConditions) =>
  [
    `${c.viewport.join('×')} css @${c.pixelRatio} → ${c.drawingBuffer.join('×')}, clouds ${c.cloudImage.join('×')}`,
    `${c.weather ?? '—'}, ${c.levels} levels` +
      (c.quality
        ? `, res ${c.quality.resolution} steps ${c.quality.steps} light ${c.quality.lightSamples} shape ×${c.quality.shapeReads}`
        : ''),
    ...(c.hookedWebGL.length > 0
      ? [`⚠ WebGL hooked: ${c.hookedWebGL.join(', ')} (CPU times off)`]
      : []),
  ].join('\n');

const passText = (r: PassResult) =>
  `march ${r.ms.march} ms, shadow ${r.ms.shadow ?? '—'}, bake ${r.ms.bake ?? '—'}, cover map ${r.ms.coverMap ?? '—'}\n` +
  `  march rounds ${r.rounds.march.join(' ')}`;

const framesText = (r: FramesResult) =>
  [
    `gpu ${r.gpu.median} / p90 ${r.gpu.p90} / max ${r.gpu.max} ms`,
    `interval ${r.interval.median} / p90 ${r.interval.p90} ms, cpu ${r.cpu.median}`,
    `over 16.7: ${r.over['16.7']}, over 33.3: ${r.over['33.3']} of ${r.frames}`,
    ...Object.entries(r.steps)
      .sort((a, b) => b[1].mean - a[1].mean)
      .map(
        ([name, s]) =>
          `  ${name.padEnd(10)} mean ${s.mean} p90 ${s.p90} max ${s.max} (${s.ran})`,
      ),
  ].join('\n');

const countText = (r: CountResult) =>
  `turns mean ${r.turns.mean} p90 ${r.turns.p90} p99 ${r.turns.p99} max ${r.turns.max}\n` +
  `steps ${r.steps.mean}, again ${r.again.mean}, lit ${r.lights.mean}, coherence ${r.coherence}\n` +
  `bands ${r.bands.join(' ')}`;

const bench = (): CloudBench => {
  const found = window.videx3d?.cloudBench;
  if (!found) throw new Error('no cloud bench yet');
  return found;
};

// The bench's buttons and what it measured last: outside the canvas, so it is in none of it.
const BenchPanel = ({ pose }: { pose: Pose }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async <T extends { conditions: BenchConditions }>(
    label: string,
    work: () => Promise<T>,
    format: (result: T) => string,
  ) => {
    if (busy) return;
    setBusy(true);
    setText(`${label}…`);
    try {
      const result = await work();
      console.log(`cloud bench ${label}`, result);
      setText(
        `${label}\n${format(result)}\n${conditionsText(result.conditions)}`,
      );
    } catch (error) {
      setText(`${label}: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const buttons: [string, () => void][] = [
    ['pass', () => void run('pass', () => bench().pass(), passText)],
    [
      'frames orbit',
      () =>
        void run(
          'frames orbit',
          () => bench().frames({ drive: 'orbit' }),
          framesText,
        ),
    ],
    [
      'frames still',
      () =>
        void run(
          'frames still',
          () => bench().frames({ drive: 'still' }),
          framesText,
        ),
    ],
    ['count', () => void run('count', () => bench().count(), countText)],
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
        {(Object.keys(POSES) as Pose[]).map(name => (
          <button
            key={name}
            style={{
              ...BUTTON,
              fontWeight: pose === name ? 'bold' : undefined,
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
  const { viewport, pose } = args as CloudBenchArgs;
  const size = VIEWPORTS[viewport];
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
      <BenchPanel pose={pose} />
    </>
  );
};

const meta = {
  title: 'debug/Scenery/Cloud Bench',
  component: CloudBenchStory,
  decorators: [
    Canvas3dDecorator,
    // The relief's ground, read from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    viewportDecorator,
  ],
  parameters: {
    layout: 'fullscreen',
    scale: 1000,
    far: 50000000,
    cameraPosition: POSES.over[0],
    cameraTarget: POSES.over[1],
    ownLighting: () => true,
    pixelRatio: (args: CloudBenchArgs) => args.pixelRatio,
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
    pose: {
      control: { type: 'inline-radio' },
      options: Object.keys(POSES),
      description:
        'OVER from 3 km out over the clouds; BELOW from 40 m up into them; LEVEL in the layer along it; DOWN 30° down from 3 km; HIGH from 200 km; EARTH the whole Earth.',
    },
    weatherMode: {
      control: { type: 'inline-radio' },
      options: ['local', 'global'],
    },
    preset: {
      control: { type: 'select' },
      options: PRESETS,
      description: 'A local weather’s sky (`SKY_PRESETS`).',
    },
    systemsSeed: { control: { type: 'number', min: 0, max: 20, step: 1 } },
    quality: {
      control: { type: 'inline-radio' },
      options: ['low', 'medium', 'high', 'ultra'],
    },
    temporal: {
      control: { type: 'inline-radio' },
      options: ['quality', 'off', 'still', 'moving'],
      description:
        'How the march reuses the last frames (`temporal`). QUALITY: as the quality has it. `pass` times the full march whatever this is; `frames` times what is drawn.',
    },
    ownResolution: { control: { type: 'boolean' } },
    resolution: {
      control: { type: 'range', min: 0.25, max: 1, step: 0.05 },
      if: { arg: 'ownResolution' },
    },
    ground: {
      control: { type: 'inline-radio' },
      options: ['none', 'loaded', 'drawn'],
      description:
        'NONE: the sea’s level everywhere. LOADED: the relief as the clouds’ ground, not drawn. DRAWN: and drawn.',
    },
    sky: {
      control: { type: 'boolean' },
      description: 'The sky drawn behind them.',
    },
    bakes: {
      control: { type: 'boolean' },
      description:
        'The Scenery’s environment and light probe, which bake the clouds as they change.',
    },
    lightMap: { control: { type: 'boolean' } },
    weatherPaused: { control: { type: 'boolean' } },
    cloudRate: {
      control: { type: 'select' },
      options: [1, 10, 60, 600, 3600],
    },
    debugView: {
      control: { type: 'inline-radio' },
      options: ['none', 'cost', 'unlit'],
    },
  },
  args: {
    viewport: '1280x720',
    pixelRatio: 1,
    pose: 'over',
    weatherMode: 'local',
    preset: 'scattered',
    systemsSeed: 0,
    quality: 'medium',
    temporal: 'quality',
    ownResolution: false,
    resolution: CLOUDS_QUALITY.medium.resolution,
    ground: 'none',
    sky: false,
    bakes: false,
    lightMap: false,
    weatherPaused: true,
    cloudRate: 1,
    debugView: 'none',
  },
} satisfies Meta<typeof CloudBenchStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The clouds alone, 1280 × 720 at a pixel ratio of 1, from 3 km over the field. */
export const Default: Story = {};
