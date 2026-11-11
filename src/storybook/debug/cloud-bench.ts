// oxlint-disable eslint/no-await-in-loop -- a measurement waits for each timing before the next: one GPU timer is open at a time, and draws timed together would time each other
import {
  addAfterEffect,
  addEffect,
  useThree,
  type RootState,
} from '@react-three/fiber';
import { useEffect } from 'react';
import {
  Camera,
  FloatType,
  Mesh,
  NearestFilter,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  WebGLRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import { CloudVolumeRenderer } from '../../components/Scenery/scenery-cloud-volume';
import type { CameraManager } from '../../sdk/managers/CameraManager';
import { showAb, type AbImage, type AbStats } from './ab-viewer';
import { registerVidex3d } from './videx3d';

/**
 * Timing the 3D clouds (`SceneryCloudVolume`) on the GPU, from the browser console:
 * `window.videx3d.cloudBench` in a story that renders `<CloudBenchBridge />` (the
 * `debug/Scenery/Cloud Bench` story, and the CloudVolume spike). Storybook only.
 *
 * - {@link CloudBench.pass}: each pass alone (march, shadows, film), the loop held, back to back.
 * - {@link CloudBench.frames}: frames as they run, each step of the clouds' frame timed apart.
 * - {@link CloudBench.ab}: variants of the march's program or uniforms against it, interleaved.
 * - {@link CloudBench.count}: the march's loop turns per pixel.
 *
 * Every result carries the {@link BenchConditions} it was measured under: compare only results
 * whose conditions match. ⚠️ One GPU timer at a time: no other profiler open meanwhile.
 * documents/clouds.md, "Measuring".
 */
export type CloudBench = {
  conditions: () => BenchConditions;
  pass: (options?: PassOptions) => Promise<PassResult>;
  frames: (options?: FramesOptions) => Promise<FramesResult>;
  ab: (
    variants: Record<string, BenchVariant>,
    options?: AbOptions,
  ) => Promise<AbResult>;
  count: () => Promise<CountResult>;
  /**
   * Capture the view as it is drawn with `a` applied, then with `b`, each after `frames` frames
   * (the weather held: nothing else moves), and show the two in the A/B viewer (`ab-viewer.ts`).
   */
  compare: (
    a: CompareSide,
    b: CompareSide,
    options?: { title?: string; frames?: number },
  ) => Promise<{ conditions: BenchConditions; stats: AbStats }>;
  /** hold the render loop `seconds` (a laptop's GPU cools, its clock settles) */
  hold: (seconds: number) => Promise<void>;
};

/** One side of a {@link CloudBench.compare}: what it does to the march's uniforms (or the story), undone after. */
export type CompareSide = {
  label: string;
  apply: (context: {
    uniforms: Record<string, IUniform>;
    volume: CloudVolumeRenderer;
  }) => (() => void) | Promise<() => void>;
};

/** What a timing depends on besides the code: compare results only where these match. */
export type BenchConditions = {
  /** the canvas, CSS pixels */
  viewport: [number, number];
  pixelRatio: number;
  drawingBuffer: [number, number];
  /** the clouds' image (their march's target) */
  cloudImage: [number, number];
  quality: { resolution: number; steps: number; lightSamples: number } | null;
  weather: 'local' | 'global' | null;
  levels: number;
  pose: ReturnType<CameraManager['pose']> | null;
  gpu: string;
  /** WebGL methods something has wrapped (a leftover hook): CPU timings are off while any is */
  hookedWebGL: string[];
};

export type Stat = { median: number; p90: number; max: number; mean: number };

export type PassOptions = {
  /** timed draws per pass in a round (their median kept) */
  reps?: number;
  /** rounds, the passes interleaved in each */
  rounds?: number;
  /** ms of the march drawn untimed first: an idle GPU's clock takes a second or two to rise */
  warmup?: number;
};

export type PassResult = {
  conditions: BenchConditions;
  /**
   * GPU ms of each pass alone, the median of its rounds; null where it does not draw now. The
   * cover map's: drawn anew, as each frame the clock runs.
   */
  ms: {
    march: number;
    shadow: number | null;
    film: number | null;
    coverMap: number | null;
  };
  rounds: {
    march: number[];
    shadow: number[];
    film: number[];
    coverMap: number[];
  };
};

export type FramesOptions = {
  frames?: number;
  /** frames run before timing begins */
  warmup?: number;
  /** 'orbit': the camera turned about its target, `degrees` a frame; 'still': held */
  drive?: 'orbit' | 'still';
  degrees?: number;
};

export type FramesResult = {
  conditions: BenchConditions;
  frames: number;
  /** GPU ms of the whole frame */
  gpu: Stat;
  /** main-thread ms from the frame's first callback to after its render */
  cpu: Stat;
  /** ms between frames */
  interval: Stat;
  /** frames whose GPU time passed 16.7 and 33.3 ms */
  over: { '16.7': number; '33.3': number };
  /** GPU ms of each step over all frames (0 in a frame it did not run), and in how many it ran */
  steps: Record<string, Stat & { ran: number }>;
};

/**
 * A variant of the march: its program's source edited (`edits`, each found and replaced; every
 * one must be found), its defines changed (`null` removes one), and/or its uniforms set for its
 * draws (`apply`, returning what puts them back).
 *
 * ⚠️ An edit that stops a computation reaching the output lets the compiler strip it, and with
 * it whatever only fed it: such a variant times less than it seems to. Its `diff` (the mean
 * difference of its image from the march's) shows a variant that changed what is drawn, whose
 * time then also changed with what it drew.
 */
export type BenchVariant = {
  edits?: [string, string][];
  defines?: Record<string, string | number | null>;
  apply?: (uniforms: Record<string, IUniform>) => () => void;
  /**
   * A program of the march's own (edited as `edits` say) drawn first, each time, into a float
   * RGBA image of the march's size: the variant reads it as `uniform sampler2D uCloudPrepass`. Its
   * time is counted in the variant's.
   */
  prepass?: { edits?: [string, string][]; defines?: BenchVariant['defines'] };
};

export type AbOptions = {
  rounds?: number;
  reps?: number;
  /** as {@link PassOptions.warmup} */
  warmup?: number;
  /**
   * ms each variant is drawn untimed once compiled, before its rounds: a program just compiled
   * runs slow at first (Iris Xe, 2026-11-10: variants read 1.2–2.5× the march on their first
   * run, 0.5–1.1× from their second on)
   */
  settle?: number;
};

export type AbResult = {
  conditions: BenchConditions;
  /** each variant: the march's and its GPU ms (medians of interleaved rounds), the median of
   * each round's ratio of the two, and the mean difference of its image (premultiplied RGBA,
   * per channel) from the march's */
  variants: Record<
    string,
    {
      base: number;
      variant: number;
      ratio: number;
      diff: number;
      rounds: [number, number][];
    }
  >;
};

export type CountResult = {
  conditions: BenchConditions;
  /** per pixel: the loop's turns, steps, steps walked again (shorter) and points lit */
  turns: Stat & { p99: number };
  steps: Stat;
  again: Stat;
  lights: Stat;
  /** mean turns over the most turns in each 8×4 block: how evenly pixels run together (1 even) */
  coherence: number;
  /** mean turns in ten bands of the image, bottom to top */
  bands: number[];
};

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

const round2 = (x: number) => Math.round(x * 100) / 100;

function stat(values: number[]): Stat {
  if (values.length === 0) return { median: 0, p90: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    median: round2(at(0.5)),
    p90: round2(at(0.9)),
    max: round2(sorted[sorted.length - 1]),
    mean: round2(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

const nextFrame = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// The methods a debugging hook was seen wrapping (a getError per draw: two synchronous round
// trips to the GPU process each, 88 % of the main thread, 2026-11-10).
const WATCHED = [
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'useProgram',
  'getError',
  'readPixels',
  'texImage2D',
  'texSubImage2D',
  'texSubImage3D',
  'bufferData',
  'bufferSubData',
];

function hookedWebGL(): string[] {
  const proto = WebGL2RenderingContext.prototype as unknown as Record<
    string,
    unknown
  >;
  return WATCHED.filter(name => {
    const method = proto[name];
    return (
      typeof method === 'function' &&
      !/\[native code\]/.test(Function.prototype.toString.call(method))
    );
  });
}

// A fixed dot in the page's top left while a measurement runs (red: hands off), green after.
function indicate(busy: boolean) {
  let dot = document.getElementById('cloud-bench-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'cloud-bench-dot';
    Object.assign(dot.style, {
      position: 'fixed',
      left: '6px',
      top: '6px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      zIndex: '100000',
      pointerEvents: 'none',
    });
    document.body.appendChild(dot);
  }
  dot.style.background = busy ? 'red' : 'limegreen';
}

/**
 * GPU time of a frame's stretches, back to back: one TIME_ELAPSED query open at a time, each
 * {@link mark} ending the last and opening the next, so they never nest and add up to the frame.
 */
class Segments {
  private open: { name: string; query: WebGLQuery } | null = null;
  private frame: [string, WebGLQuery][] | null = null;
  private readonly pending: [string, WebGLQuery][][] = [];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerExt,
  ) {}

  get name(): string | null {
    return this.open?.name ?? null;
  }

  begin(name: string) {
    this.frame = [];
    this.mark(name);
  }

  mark(name: string | null) {
    const frame = this.frame;
    if (!frame) return;
    if (this.open) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      frame.push([this.open.name, this.open.query]);
      this.open = null;
    }
    if (name !== null) {
      const query = this.gl.createQuery()!;
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
      this.open = { name, query };
    }
  }

  end() {
    this.mark(null);
    if (this.frame) this.pending.push(this.frame);
    this.frame = null;
  }

  // The frames whose queries have all come back, in order: ms by name; null for a disjoint one.
  collect(): (Record<string, number> | null)[] {
    const gl = this.gl;
    const out: (Record<string, number> | null)[] = [];
    while (this.pending.length > 0) {
      const frame = this.pending[0];
      if (
        !frame.every(([, query]) =>
          gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE),
        )
      )
        break;
      this.pending.shift();
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ms: Record<string, number> = {};
      for (const [name, query] of frame) {
        ms[name] =
          (ms[name] ?? 0) + gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query);
      }
      out.push(disjoint ? null : ms);
    }
    return out;
  }
}

/** The march's loop counted: turns, steps, steps walked again, points lit (count()). */
const COUNT_EDITS: [string, string][] = [
  [
    'vec3 cloudLight(CloudLevel L, int l, vec3 o, float w) {',
    'vec4 gBenchCount = vec4(0.0);\nvec3 cloudLight(CloudLevel L, int l, vec3 o, float w) {\n  gBenchCount.w += 1.0;',
  ],
  [
    'for(int turn = 0; turn < uCloudMarchMost; turn++) {',
    'for(int turn = 0; turn < uCloudMarchMost; turn++) {\n    gBenchCount.x += 1.0;',
  ],
  ['gCost += 1.0;', 'gCost += 1.0;\n    gBenchCount.y += 1.0;'],
  [
    'if(sigma > 0.0 && len > CLOUD_AGAIN * want) {',
    'if(sigma > 0.0 && len > CLOUD_AGAIN * want) {\n        gBenchCount.z += 1.0;',
  ],
  [
    '  cloudMarchRuns(count);\n',
    '  cloudMarchRuns(count);\n  gl_FragColor = gBenchCount;\n  gl_FragDepth = 0.5;\n  return;\n',
  ],
];

type VolumeInternals = {
  target: WebGLRenderTarget;
  marchScene: Scene;
  marchMaterial: ShaderMaterial;
  shadowScene: Scene;
  shadowTarget: WebGLRenderTarget;
  filmedVersion: number;
  sky: { syncCamera: (camera: Camera) => void };
  settings: {
    quality: { resolution: number; steps: number; lightSamples: number };
    global: unknown;
    levels: unknown[];
  } | null;
  weather: { update: (...args: unknown[]) => unknown };
  updateCamera: (camera: Camera, height: number) => void;
  updateCoverMap: (renderer: WebGLRenderer) => void;
  coverMap: { held: unknown; update: (...args: unknown[]) => unknown };
};

/**
 * The bench for the clouds drawn in `get().scene`: `get` the canvas's state (`useThree`'s
 * `get`), `manager` its camera's (for poses and the orbit).
 */
export function createCloudBench(
  get: () => RootState,
  manager: () => CameraManager | undefined,
): CloudBench {
  let busy = false;

  const renderer = (): WebGLRenderer => get().gl;
  const context = () => renderer().getContext() as WebGL2RenderingContext;
  const timer = (): TimerExt => {
    const ext = context().getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) throw new Error('EXT_disjoint_timer_query_webgl2 unavailable');
    return ext as TimerExt;
  };

  const volume = (): CloudVolumeRenderer => {
    let found: CloudVolumeRenderer | null = null;
    get().scene.traverse(object => {
      const candidate = object.userData.cloudVolume;
      if (!found && candidate instanceof CloudVolumeRenderer) found = candidate;
    });
    if (!found) throw new Error('no SceneryCloudVolume in the scene');
    return found;
  };
  const inside = (v: CloudVolumeRenderer) => v as unknown as VolumeInternals;

  const conditions = (): BenchConditions => {
    const gl = renderer();
    const canvas = gl.domElement;
    const ctx = context();
    const info = ctx.getExtension('WEBGL_debug_renderer_info');
    let v: VolumeInternals | null = null;
    try {
      v = inside(volume());
    } catch {
      v = null;
    }
    const settings = v?.settings ?? null;
    return {
      viewport: [canvas.clientWidth, canvas.clientHeight],
      pixelRatio: gl.getPixelRatio(),
      drawingBuffer: [ctx.drawingBufferWidth, ctx.drawingBufferHeight],
      cloudImage: v ? [v.target.width, v.target.height] : [0, 0],
      quality: settings ? { ...settings.quality } : null,
      weather: settings ? (settings.global ? 'global' : 'local') : null,
      levels: settings?.levels.length ?? 0,
      pose: manager()?.pose() ?? null,
      gpu: info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '',
      hookedWebGL: hookedWebGL(),
    };
  };

  // Run `work` alone: no other measurement, the dot red meanwhile; with `held`, the render loop
  // stopped, a frame drawn by nothing else.
  const exclusive = async <T>(held: boolean, work: () => Promise<T>) => {
    if (busy) throw new Error('the cloud bench is already measuring');
    busy = true;
    indicate(true);
    const state = get();
    const loop = state.frameloop;
    try {
      if (held) {
        state.setFrameloop('never');
        await nextFrame();
        await nextFrame();
      }
      const hooked = hookedWebGL();
      if (hooked.length > 0)
        console.warn(
          `cloud bench: WebGL methods wrapped by something (${hooked.join(', ')}): CPU timings are not to be trusted`,
        );
      return await work();
    } finally {
      if (held) state.setFrameloop(loop);
      busy = false;
      indicate(false);
    }
  };

  // Draw `scene` into `target` as the volume draws its passes: nested state left alone.
  const draw = (scene: Scene, target: WebGLRenderTarget, camera: Camera) => {
    const gl = renderer();
    const autoClear = gl.autoClear;
    const autoReset = gl.info.autoReset;
    const shadows = gl.shadowMap.autoUpdate;
    gl.autoClear = false;
    gl.info.autoReset = false;
    gl.shadowMap.autoUpdate = false;
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.autoClear = autoClear;
    gl.info.autoReset = autoReset;
    gl.shadowMap.autoUpdate = shadows;
  };

  // GPU ms of `run`, `reps` times back to back: their median.
  const timeOf = async (run: () => void, reps: number): Promise<number> => {
    const ctx = context();
    const ext = timer();
    const queries: WebGLQuery[] = [];
    for (let i = 0; i < reps; i++) {
      const query = ctx.createQuery()!;
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, query);
      run();
      ctx.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push(query);
    }
    const ms: number[] = [];
    for (const query of queries) {
      while (!ctx.getQueryParameter(query, ctx.QUERY_RESULT_AVAILABLE))
        await sleep(4);
      if (!ctx.getParameter(ext.GPU_DISJOINT_EXT))
        ms.push(ctx.getQueryParameter(query, ctx.QUERY_RESULT) / 1e6);
      ctx.deleteQuery(query);
    }
    return median(ms);
  };

  // The march's uniforms set for the view as the frame's own march has them.
  const aimMarch = (v: VolumeInternals, camera: Camera) => {
    v.sky.syncCamera(camera);
    v.updateCamera(camera, v.target.height);
  };

  const drawMarch = (v: VolumeInternals, camera: Camera) => {
    draw(v.marchScene, v.target, camera);
  };

  // The march drawn untimed for `ms`, the GPU's clock up (46.6 ms in the first round after a
  // hold, 13.5–19.7 in the next, 2026-11-10).
  const warm = async (v: VolumeInternals, camera: Camera, ms: number) => {
    aimMarch(v, camera);
    const until = performance.now() + ms;
    while (performance.now() < until)
      await timeOf(() => drawMarch(v, camera), 4);
  };

  const pass = (options: PassOptions = {}) =>
    exclusive(true, async (): Promise<PassResult> => {
      const reps = options.reps ?? 7;
      const rounds = options.rounds ?? 3;
      const real = volume();
      const v = inside(real);
      const camera = get().camera;
      const gl = renderer();
      const position = camera.getWorldPosition(camera.position.clone());
      const out = {
        march: [] as number[],
        shadow: [] as number[],
        film: [] as number[],
        coverMap: [] as number[],
      };
      const shadowDrawn = real.shadow !== null;
      const coverDrawn = !!real.coverMap.uniforms.uCloudCoverOn.value;
      await warm(v, camera, options.warmup ?? 2000);
      for (let r = 0; r < rounds; r++) {
        aimMarch(v, camera);
        out.march.push(await timeOf(() => drawMarch(v, camera), reps));
        if (coverDrawn)
          out.coverMap.push(
            await timeOf(() => {
              v.coverMap.held = null;
              v.updateCoverMap(gl);
            }, reps),
          );
        if (shadowDrawn) {
          v.sky.syncCamera(camera);
          v.updateCamera(camera, v.shadowTarget.width);
          out.shadow.push(
            await timeOf(
              () => draw(v.shadowScene, v.shadowTarget, camera),
              reps,
            ),
          );
        }
        out.film.push(
          await timeOf(
            () => {
              v.filmedVersion = -1;
              real.film(gl, position);
            },
            Math.max(2, reps >> 1),
          ),
        );
      }
      // Its own march's uniforms as they were.
      aimMarch(v, camera);
      drawMarch(v, camera);
      const film = median(out.film);
      return {
        conditions: conditions(),
        ms: {
          march: round2(median(out.march)),
          shadow: shadowDrawn ? round2(median(out.shadow)) : null,
          film: film > 0 ? round2(film) : null,
          coverMap: coverDrawn ? round2(median(out.coverMap)) : null,
        },
        rounds: {
          march: out.march.map(round2),
          shadow: out.shadow.map(round2),
          film: out.film.map(round2),
          coverMap: out.coverMap.map(round2),
        },
      };
    });

  const frames = (options: FramesOptions = {}) =>
    exclusive(false, async (): Promise<FramesResult> => {
      const count = options.frames ?? 300;
      const warmup = options.warmup ?? 30;
      const drive = options.drive ?? 'orbit';
      const degrees = options.degrees ?? 0.05;
      const real = volume();
      const v = inside(real);
      const segments = new Segments(context(), timer());
      const cameras = manager();
      const pose = cameras?.pose() ?? null;

      // Each step of the clouds' frame timed apart (the rest of the frame is 'scene'); the
      // march's draw inside the composite's, which follows it.
      const restore: (() => void)[] = [];
      const wrap = <O extends object>(owner: O, key: string, name: string) => {
        const target = owner as unknown as Record<string, unknown>;
        const original = target[key] as (...args: unknown[]) => unknown;
        target[key] = function (this: unknown, ...args: unknown[]) {
          const before = segments.name;
          if (before === null) return original.apply(this, args);
          segments.mark(name);
          try {
            return original.apply(this, args);
          } finally {
            segments.mark(before);
          }
        };
        restore.push(() => {
          target[key] = original;
        });
      };
      wrap(real, 'film', 'film');
      wrap(real, 'updateShadow', 'shadow');
      wrap(real, 'updateTerrain', 'terrain');
      wrap(real.lightMaps, 'update', 'lightMaps');
      wrap(real.coverMap, 'update', 'coverMap');
      wrap(real.placeMap, 'update', 'placeMap');
      wrap(v.weather, 'update', 'weatherMap');
      // The march, then the composite's own draw until its onAfterRender.
      const render = real.render;
      real.render = (...args: Parameters<CloudVolumeRenderer['render']>) => {
        if (segments.name === null) return render.apply(real, args);
        segments.mark('march');
        try {
          return render.apply(real, args);
        } finally {
          segments.mark('composite');
        }
      };
      restore.push(() => {
        real.render = render;
      });
      const after = real.composite.onAfterRender;
      real.composite.onAfterRender = (...args) => {
        if (segments.name === 'composite') segments.mark('scene');
        return after.apply(real.composite, args);
      };
      restore.push(() => {
        real.composite.onAfterRender = after;
      });

      const gpu: Record<string, number>[] = [];
      const cpu: number[] = [];
      const stamps: number[] = [];
      let frame = 0;
      let started = 0;
      let done: () => void = () => {};
      const finished = new Promise<void>(resolve => (done = resolve));
      const timing = () => frame >= warmup && frame < warmup + count;
      const before = addEffect(timestamp => {
        if (drive === 'orbit' && cameras && pose)
          void cameras.orbit({
            target: pose.target,
            distance: pose.distance,
            polar: pose.polar,
            azimuth: pose.azimuth + frame * degrees,
            transition: false,
          });
        if (timing()) {
          started = performance.now();
          stamps.push(timestamp);
          segments.begin('scene');
        }
      });
      const afterFrame = addAfterEffect(() => {
        if (timing()) {
          segments.end();
          cpu.push(performance.now() - started);
        }
        for (const ms of segments.collect()) if (ms) gpu.push(ms);
        frame++;
        if (frame >= warmup + count) done();
      });
      try {
        await finished;
        // The last queries in.
        for (let i = 0; i < 60 && gpu.length < count; i++) {
          await nextFrame();
          for (const ms of segments.collect()) if (ms) gpu.push(ms);
        }
      } finally {
        before();
        afterFrame();
        restore.reverse().forEach(undo => undo());
        if (cameras && pose) void cameras.orbit({ ...pose, transition: false });
      }

      const names = new Set(gpu.flatMap(ms => Object.keys(ms)));
      const steps: FramesResult['steps'] = {};
      for (const name of names)
        steps[name] = {
          ...stat(gpu.map(ms => ms[name] ?? 0)),
          ran: gpu.filter(ms => (ms[name] ?? 0) > 0.01).length,
        };
      const totals = gpu.map(ms =>
        Object.values(ms).reduce((a, b) => a + b, 0),
      );
      return {
        conditions: conditions(),
        frames: gpu.length,
        gpu: stat(totals),
        cpu: stat(cpu),
        interval: stat(stamps.slice(1).map((t, i) => t - stamps[i])),
        over: {
          '16.7': totals.filter(t => t > 16.7).length,
          '33.3': totals.filter(t => t > 33.3).length,
        },
        steps,
      };
    });

  // A variant's march: its own program over the march's uniforms (the same objects, not copies),
  // with `extra` ones of its own.
  const variantScene = (
    v: VolumeInternals,
    variant: Pick<BenchVariant, 'edits' | 'defines'>,
    extra?: Record<string, IUniform>,
  ) => {
    const base = v.marchScene.children[0] as Mesh;
    const material = base.material as ShaderMaterial;
    let source = material.fragmentShader;
    for (const [find, replace] of variant.edits ?? []) {
      if (!source.includes(find))
        throw new Error(`edit not found: ${find.slice(0, 80)}`);
      source = source.split(find).join(replace);
    }
    const defines: Record<string, unknown> = { ...material.defines };
    for (const [key, value] of Object.entries(variant.defines ?? {}))
      if (value === null) delete defines[key];
      else defines[key] = value;
    const own = new ShaderMaterial({
      name: `${material.name}-variant`,
      vertexShader: material.vertexShader,
      fragmentShader: source,
      defines,
      depthTest: material.depthTest,
      depthFunc: material.depthFunc,
      depthWrite: material.depthWrite,
      blending: material.blending,
    });
    own.uniforms = extra
      ? { ...material.uniforms, ...extra }
      : material.uniforms;
    const mesh = new Mesh(base.geometry, own);
    mesh.frustumCulled = false;
    mesh.layers.enableAll();
    const scene = new Scene();
    scene.add(mesh);
    return { scene, material: own };
  };

  // The image `scene` marches, read back (float RGBA).
  const imageOf = (
    scene: Scene,
    target: WebGLRenderTarget,
    camera: Camera,
  ): Float32Array => {
    draw(scene, target, camera);
    const pixels = new Float32Array(target.width * target.height * 4);
    renderer().readRenderTargetPixels(
      target,
      0,
      0,
      target.width,
      target.height,
      pixels,
    );
    return pixels;
  };

  const readable = (v: VolumeInternals) =>
    new WebGLRenderTarget(v.target.width, v.target.height, {
      type: FloatType,
      format: RGBAFormat,
      depthBuffer: true,
    });

  const runnable = (material: ShaderMaterial) => {
    const program = (
      renderer().properties.get(material) as {
        currentProgram?: { diagnostics?: { runnable: boolean } };
      }
    ).currentProgram;
    if (program?.diagnostics && !program.diagnostics.runnable)
      throw new Error(`${material.name} does not compile (see the console)`);
  };

  const ab = (
    variants: Record<string, BenchVariant>,
    options: AbOptions = {},
  ) =>
    exclusive(true, async (): Promise<AbResult> => {
      const rounds = options.rounds ?? 6;
      const reps = options.reps ?? 5;
      const v = inside(volume());
      const camera = get().camera;
      const march = (v.marchScene.children[0] as Mesh)
        .material as ShaderMaterial;
      const readback = readable(v);
      const out: AbResult['variants'] = {};
      try {
        await warm(v, camera, options.warmup ?? 2000);
        aimMarch(v, camera);
        const baseImage = imageOf(v.marchScene, readback, camera);
        for (const [name, variant] of Object.entries(variants)) {
          // With a prepass: its image, drawn before the variant each time, read by it.
          const before = variant.prepass
            ? {
                ...variantScene(v, variant.prepass),
                target: new WebGLRenderTarget(v.target.width, v.target.height, {
                  type: FloatType,
                  format: RGBAFormat,
                  depthBuffer: false,
                  minFilter: NearestFilter,
                  magFilter: NearestFilter,
                }),
              }
            : null;
          // Read as `uCloudPrepass`.
          const { scene, material } = variantScene(
            v,
            variant,
            before
              ? { uCloudPrepass: new Uniform(before.target.texture) }
              : undefined,
          );
          const drawVariant = (target: WebGLRenderTarget) => {
            if (before) draw(before.scene, before.target, camera);
            draw(scene, target, camera);
          };
          try {
            const undo = variant.apply?.(march.uniforms) ?? (() => {});
            if (before) draw(before.scene, before.target, camera);
            const image = imageOf(scene, readback, camera);
            undo();
            if (before) runnable(before.material);
            runnable(material);
            // Settled: drawn untimed a while, as a program just compiled runs slow at first.
            const settled = performance.now() + (options.settle ?? 3000);
            while (performance.now() < settled) {
              const back = variant.apply?.(march.uniforms) ?? (() => {});
              await timeOf(() => drawVariant(v.target), 4);
              back();
            }
            let diff = 0;
            for (let i = 0; i < image.length; i++)
              diff += Math.abs(image[i] - baseImage[i]);
            diff /= image.length;
            const pairs: [number, number][] = [];
            for (let r = 0; r < rounds; r++) {
              const a = await timeOf(() => drawMarch(v, camera), reps);
              const back = variant.apply?.(march.uniforms) ?? (() => {});
              const b = await timeOf(() => drawVariant(v.target), reps);
              back();
              pairs.push([round2(a), round2(b)]);
            }
            const base = median(pairs.map(p => p[0]));
            const own = median(pairs.map(p => p[1]));
            out[name] = {
              base: round2(base),
              variant: round2(own),
              // Each round's own: the two timed seconds apart, at one clock; the clock steps
              // between plateaus (11.3, 13.6, 17–18, 22, 29 ms for one march, 2026-11-10).
              ratio:
                Math.round(median(pairs.map(p => p[1] / p[0])) * 1000) / 1000,
              diff: Math.round(diff * 1e5) / 1e5,
              rounds: pairs,
            };
          } finally {
            material.dispose();
            before?.material.dispose();
            before?.target.dispose();
          }
        }
        drawMarch(v, camera);
      } finally {
        readback.dispose();
      }
      return { conditions: conditions(), variants: out };
    });

  const count = () =>
    exclusive(true, async (): Promise<CountResult> => {
      const v = inside(volume());
      const camera = get().camera;
      const readback = readable(v);
      const { scene, material } = variantScene(v, { edits: COUNT_EDITS });
      try {
        aimMarch(v, camera);
        const pixels = imageOf(scene, readback, camera);
        runnable(material);
        const w = readback.width;
        const h = readback.height;
        const channel = (c: number) => {
          const values: number[] = [];
          for (let i = c; i < pixels.length; i += 4) values.push(pixels[i]);
          return values;
        };
        const turns = channel(0);
        const sorted = [...turns].sort((a, b) => a - b);
        let blockMean = 0;
        let blockMost = 0;
        for (let by = 0; by + 4 <= h; by += 4)
          for (let bx = 0; bx + 8 <= w; bx += 8) {
            let most = 0;
            let sum = 0;
            for (let y = by; y < by + 4; y++)
              for (let x = bx; x < bx + 8; x++) {
                const t = pixels[(y * w + x) * 4];
                most = Math.max(most, t);
                sum += t;
              }
            blockMean += sum / 32;
            blockMost += most;
          }
        const bands: number[] = [];
        for (let b = 0; b < 10; b++) {
          let sum = 0;
          let n = 0;
          for (
            let y = Math.floor((b * h) / 10);
            y < Math.floor(((b + 1) * h) / 10);
            y++
          )
            for (let x = 0; x < w; x++) {
              sum += pixels[(y * w + x) * 4];
              n++;
            }
          bands.push(Math.round((sum / Math.max(n, 1)) * 10) / 10);
        }
        return {
          conditions: conditions(),
          turns: {
            ...stat(turns),
            p99: sorted[Math.floor(0.99 * sorted.length)] ?? 0,
          },
          steps: stat(channel(1)),
          again: stat(channel(2)),
          lights: stat(channel(3)),
          coherence:
            blockMost > 0 ? Math.round((blockMean / blockMost) * 100) / 100 : 1,
          bands,
        };
      } finally {
        material.dispose();
        readback.dispose();
      }
    });

  const hold = (seconds: number) =>
    exclusive(true, () => sleep(seconds * 1000));

  // The canvas as drawn, `after` frames on: read from the drawing buffer once the frame's render
  // is done (an after effect), rows top first.
  const capture = (after: number) =>
    new Promise<AbImage>(resolve => {
      let frame = 0;
      const stop = addAfterEffect(() => {
        if (++frame < after) return;
        stop();
        const gl = renderer();
        const ctx = context();
        const width = ctx.drawingBufferWidth;
        const height = ctx.drawingBufferHeight;
        const raw = new Uint8Array(width * height * 4);
        gl.setRenderTarget(null);
        ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, raw);
        const pixels = new Uint8ClampedArray(raw.length);
        const row = width * 4;
        for (let y = 0; y < height; y++)
          pixels.set(
            raw.subarray((height - 1 - y) * row, (height - y) * row),
            y * row,
          );
        resolve({ width, height, pixels });
      });
    });

  const compare = (
    a: CompareSide,
    b: CompareSide,
    options: { title?: string; frames?: number } = {},
  ) =>
    exclusive(false, async () => {
      const after = options.frames ?? 12;
      const real = volume();
      const context_ = {
        uniforms: inside(real).marchMaterial.uniforms,
        volume: real,
      };
      const undoA = await a.apply(context_);
      const imageA = await capture(after);
      undoA();
      const undoB = await b.apply(context_);
      const imageB = await capture(after);
      undoB();
      const stats = showAb(imageA, imageB, {
        a: a.label,
        b: b.label,
        title: options.title ?? '',
      });
      return { conditions: conditions(), stats };
    });

  return { conditions, pass, frames, ab, count, compare, hold };
}

/**
 * Publishes {@link CloudBench} as `window.videx3d.cloudBench` for the clouds in this canvas.
 * Render it inside the canvas of a story with a `SceneryCloudVolume`.
 */
export const CloudBenchBridge = () => {
  const get = useThree(state => state.get);
  useEffect(
    () =>
      registerVidex3d({
        cloudBench: createCloudBench(
          get,
          () => window.videx3d?.camera as CameraManager | undefined,
        ),
      }),
    [get],
  );
  return null;
};
