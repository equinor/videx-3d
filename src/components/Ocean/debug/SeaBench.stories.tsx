import { useFrame, useThree } from '@react-three/fiber';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DataUtils } from 'three';
import { createOceanPlane } from '../../../sdk/geometries/ocean-geometry';
import type { Vec2, Vec3 } from '../../../sdk/types/common';
import { directionFromCompass } from '../../../sdk/utils/vector-operations';
import { SeaState } from '../../../sdk/weather/sea-state';
import { seaHexTiles } from '../../../sdk/weather/sea-hex';
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
import {
  setStoryArgs,
  registerVidex3d,
} from '../../../storybook/debug/videx3d';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { Scenery } from '../../Scenery/Scenery';
import { SceneryClouds } from '../../Scenery/SceneryClouds';
import { SceneryStage } from '../../Scenery/SceneryStage';
import type { SceneryStageBounds } from '../../Scenery/scenery-stage';
import { Weather } from '../../Weather/Weather';
import { World } from '../../World/World';
import { Ocean } from '../Ocean';
import { OceanMaterial } from '../ocean-material';
import { applyOceanWaterProps } from '../ocean-material-sync';
import { SeaWaveBake } from '../sea-wave-bake';
import { createSeaCoreMaterial } from './sea-core-material';

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
  /** the stand-alone sea's waves: the Ocean's own, the wave core's prototype, or both drawn (to time them in the same frames) */
  waves: 'current' | 'core' | 'both';
  pose: SeaPoseName;
  sunHour: number;
  windSpeed: number;
  /** the compass bearing the wind blows toward */
  windDirection: number;
  foamAmount: number;
  tonalVariation: number;
  waveCount: number;
  detailOctaves: number;
  stage: boolean;
  clouds: 'none' | SkyPreset;
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
  seaTonalVariation: args.tonalVariation,
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
      waveCount={args.waveCount}
      detailOctaves={args.detailOctaves}
      windSpeed={args.windSpeed}
      windDirection={windOf(args.windDirection)}
      foamAmount={args.foamAmount}
      tonalVariation={args.tonalVariation}
      sunDirection={sunDirection}
      // As the Ocean stories.
      sunColor="#d6d39f"
      skyColor="#465a6a"
    />
  );
};

// The wave core's prototype on the same plane: a SeaState eased toward the args' wind, its
// layers baked each frame (SeaWaveBake), drawn with the Ocean's own shading.
const CoreOcean = ({ args, sky }: { args: SeaBenchArgs; sky: SceneryArgs }) => {
  const geometry = useMemo(() => createOceanPlane({ size: OCEAN_SIZE }), []);
  const water = useMemo(() => new OceanMaterial(), []);
  // Made once; the wind is eased toward from then on (below).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sea = useMemo(() => new SeaState(seaInput(args)), []);
  const bake = useMemo(() => new SeaWaveBake(sea.layers), [sea]);
  const material = useMemo(
    () => createSeaCoreMaterial(water, bake),
    [water, bake],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      water.dispose();
      bake.dispose();
      material.dispose();
    },
    [geometry, water, bake, material],
  );

  const { windSpeed, windDirection } = args;
  useEffect(
    () => sea.setInput(seaInput({ windSpeed, windDirection })),
    [sea, windSpeed, windDirection],
  );

  const { azimuth, elevation } = skySunPosition(sky);
  useEffect(() => {
    applyOceanWaterProps(water, {
      windSpeed,
      windDirection: windOf(windDirection),
      sunDirection: directionFromCompass(azimuth, elevation) as Vec3,
      // As the Ocean stories.
      sunColor: '#d6d39f',
      skyColor: '#465a6a',
    });
    material.opacity = water.opacity;
  }, [water, material, windSpeed, windDirection, azimuth, elevation]);

  // Baking held, for timing what the bake costs a frame; and the bake timed in the frames as
  // they run (a timer query held over an idle, held loop times the GPU waiting too).
  const baking = useRef(true);
  // The sea and its bake held still, for comparing the baked tiles with the sea state.
  const running = useRef(true);
  const timing = useRef<{
    left: number;
    queries: WebGLQuery[];
    done: (ms: number) => void;
  } | null>(null);
  useFrame(({ gl }, delta) => {
    if (!running.current) return;
    sea.update(delta);
    const stats = sea.stats();
    material.uniforms.uSeaResidual.value = stats.residualSlopeVariance;
    const variances = material.uniforms.uSeaLayerVariance.value as number[];
    stats.layers.forEach((layer, i) => (variances[i] = layer.slopeVariance));
    if (!baking.current) return;
    const tables = sea.layerTables();
    const run = timing.current;
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const ext = run
      ? (ctx.getExtension('EXT_disjoint_timer_query_webgl2') as {
          TIME_ELAPSED_EXT: number;
          GPU_DISJOINT_EXT: number;
        } | null)
      : null;
    if (!run || !ext || run.left <= 0) {
      bake.update(gl, tables);
    } else {
      const query = ctx.createQuery();
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, query);
      bake.update(gl, tables);
      ctx.endQuery(ext.TIME_ELAPSED_EXT);
      run.queries.push(query);
      run.left--;
    }
    if (run && ext && run.left <= 0) {
      const ready = run.queries.every(q =>
        ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE),
      );
      if (!ready) return;
      const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      const ms = run.queries
        .map(q => ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6)
        .sort((a, b) => a - b);
      for (const q of run.queries) ctx.deleteQuery(q);
      timing.current = null;
      run.done(disjoint ? NaN : ms[ms.length >> 1]);
    }
  });

  const gl = useThree(state => state.gl);
  useEffect(
    () =>
      registerVidex3d({
        seaCore: {
          sea,
          setBaking: (on: boolean) => {
            baking.current = on;
          },
          setRunning: (on: boolean) => {
            running.current = on;
          },
          hexTiles: seaHexTiles,
          timeBake: (frames = 60) =>
            new Promise<number>(done => {
              timing.current = { left: frames, queries: [], done };
            }),
          readLayer: (index: number) => {
            const { layer } = bake.layers[index];
            const n = layer.texels;
            const raw = new Uint16Array(n * n * 4);
            gl.readRenderTargetPixels(
              bake.targets[index],
              0,
              0,
              n,
              n,
              raw,
              undefined,
              0,
            );
            const heights = new Float32Array(n * n);
            for (let i = 0; i < n * n; i++)
              heights[i] = DataUtils.fromHalfFloat(raw[i * 4 + 2]);
            return { size: layer.size, angle: layer.angle, texels: n, heights };
          },
        },
      }),
    [sea, bake, gl],
  );

  return <mesh geometry={geometry} material={material} />;
};

// The sea state's input from the args: the wind alone for now.
const seaInput = ({
  windSpeed,
  windDirection,
}: Pick<SeaBenchArgs, 'windSpeed' | 'windDirection'>) => ({
  windSpeed,
  windDirection: windOf(windDirection),
});

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
        <>
          {args.waves !== 'core' && <StandAlone args={args} sky={sky} />}
          {args.waves !== 'current' && <CoreOcean args={args} sky={sky} />}
        </>
      ) : (
        <SceneryScene args={args} sky={sky} />
      )}
      <BenchPose pose={args.pose} />
      <SeaBenchBridge poses={ocean ? OCEAN_POSES : SCENERY_POSES} />
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
    waves: {
      control: { type: 'inline-radio' },
      options: ['current', 'core', 'both'],
      description:
        'The stand-alone sea’s waves. CURRENT: the `Ocean`’s own. CORE: the wave core’s prototype (a `SeaState`’s layers baked by `SeaWaveBake`), with the same Fresnel, reflection and glint, and no tonal patches or foam. BOTH: both drawn over each other, to time them in the same frames.',
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
    tonalVariation: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    waveCount: {
      control: { type: 'range', min: 1, max: 64, step: 1 },
      description: 'The stand-alone sea’s only.',
      if: { arg: 'scene', eq: 'ocean' },
    },
    detailOctaves: {
      control: { type: 'range', min: 1, max: 8, step: 1 },
      description: 'The stand-alone sea’s only.',
      if: { arg: 'scene', eq: 'ocean' },
    },
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
  },
  args: {
    viewport: '1920x1080',
    pixelRatio: 1,
    scene: 'scenery',
    waves: 'current',
    pose: '300m',
    sunHour: 10,
    windSpeed: 10,
    windDirection: 90,
    foamAmount: 0.5,
    tonalVariation: 0.4,
    waveCount: 16,
    detailOctaves: 4,
    stage: true,
    clouds: 'none',
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

/** The wave core's prototype on the stand-alone plane: a `SeaState`'s baked layers. */
export const WaveCore: Story = {
  args: { scene: 'ocean', waves: 'core' },
};
