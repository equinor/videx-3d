import { addAfterEffect, addEffect } from '@react-three/fiber';
import { Object3D, Vector2, WebGLRenderer } from 'three';

export type ProfileOptions = {
  /** frames measured per pass, default 120 */
  frames?: number;
  /** frames skipped before each pass, default 20 */
  warmup?: number;
  /** named sets of objects whose draws are timed one by one, in a second pass; the first match wins */
  groups?: Record<string, (object: Object3D) => boolean>;
  /** ms before a pass gives up with what it has, default 30000 */
  timeout?: number;
};

export type ProfileStat = { median: number; p90: number };

export type ProfileResult = {
  /** frames measured in the whole-frame pass, bakes included */
  frames: number;
  /** drawing-buffer pixels */
  pixels: number;
  /** ms between frames */
  interval: ProfileStat | null;
  /** ms the frame's callbacks and draw submission take on the main thread, bake frames left out */
  cpu: ProfileStat | null;
  /** ms the frame takes on the GPU, bake frames left out; null without EXT_disjoint_timer_query_webgl2 */
  gpu: ProfileStat | null;
  /** frames that rendered into a cube target (an environment bake), and what they took */
  bakes: { frames: number; cpu: ProfileStat | null; gpu: ProfileStat | null };
  /** per group and frame: the GPU and CPU ms of its draws (bakes left out) and how many there were */
  groups: Record<
    string,
    { gpu: ProfileStat | null; cpu: ProfileStat | null; draws: number }
  >;
};

type GroupRecord = { cpu: number; draws: number; gpu: number | null };

type FrameRecord = {
  interval: number;
  cpu: number;
  bake: boolean;
  gpu: number | null;
  groups: Record<string, GroupRecord>;
  /** GPU queries not resolved yet */
  waiting: number;
};

type TimerQuery = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

// One TIME_ELAPSED query can be open at a time; results arrive frames later.
class GpuQueries {
  private open: { query: WebGLQuery; done: (ms: number | null) => void } | null =
    null;
  private pending: { query: WebGLQuery; done: (ms: number | null) => void }[] =
    [];

  constructor(
    private gl: WebGL2RenderingContext,
    private ext: TimerQuery,
  ) {}

  begin(done: (ms: number | null) => void) {
    if (this.open) return false;
    const query = this.gl.createQuery();
    if (!query) return false;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.open = { query, done };
    return true;
  }

  end() {
    if (!this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }

  poll() {
    const gl = this.gl;
    const lost = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    this.pending = this.pending.filter(({ query, done }) => {
      if (!lost && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
        return true;
      done(lost ? null : gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
      return false;
    });
  }
}

function stat(values: number[]): ProfileStat | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p90: at(0.9) };
}

const known = (value: number | null): value is number => value !== null;

type Hook = Object3D['onBeforeRender'];

function measure(
  gl: WebGLRenderer,
  scene: Object3D,
  queries: GpuQueries | null,
  options: Required<Omit<ProfileOptions, 'groups'>>,
  groups?: ProfileOptions['groups'],
): Promise<FrameRecord[]> {
  return new Promise(resolve => {
    const records: FrameRecord[] = [];
    const deadline = performance.now() + options.timeout;
    let current: FrameRecord | null = null;
    let seen = 0;
    let last = -1;
    let start = 0;

    const setRenderTarget = gl.setRenderTarget;
    gl.setRenderTarget = function (target, ...rest) {
      if (current && (target as { isWebGLCubeRenderTarget?: boolean } | null)?.isWebGLCubeRenderTarget)
        current.bake = true;
      return setRenderTarget.call(this, target, ...rest);
    };

    const restores: (() => void)[] = [];
    if (groups) {
      scene.traverse(object => {
        const name = Object.keys(groups).find(key => groups[key](object));
        if (!name) return;
        const own = Object.prototype.hasOwnProperty;
        const before = object.onBeforeRender;
        const after = object.onAfterRender;
        const hadBefore = own.call(object, 'onBeforeRender');
        const hadAfter = own.call(object, 'onAfterRender');
        let timing: { entry: GroupRecord; t0: number; begun: boolean } | null =
          null;
        object.onBeforeRender = function (...args: Parameters<Hook>) {
          before.apply(this, args);
          timing = null;
          const target = args[0].getRenderTarget() as {
            isWebGLCubeRenderTarget?: boolean;
          } | null;
          if (!current || target?.isWebGLCubeRenderTarget) return;
          const record = current;
          const entry = (record.groups[name] ??= {
            cpu: 0,
            draws: 0,
            gpu: queries ? 0 : null,
          });
          const begun =
            queries?.begin(ms => {
              entry.gpu = ms === null || entry.gpu === null ? null : entry.gpu + ms;
              record.waiting--;
            }) ?? false;
          if (begun) record.waiting++;
          timing = { entry, t0: performance.now(), begun };
        };
        object.onAfterRender = function (...args: Parameters<Hook>) {
          if (timing) {
            if (timing.begun) queries?.end();
            timing.entry.cpu += performance.now() - timing.t0;
            timing.entry.draws++;
            timing = null;
          }
          after.apply(this, args);
        };
        restores.push(() => {
          if (hadBefore) object.onBeforeRender = before;
          else delete (object as Partial<Object3D>).onBeforeRender;
          if (hadAfter) object.onAfterRender = after;
          else delete (object as Partial<Object3D>).onAfterRender;
        });
      });
    }

    const finish = () => {
      removeBefore();
      removeAfter();
      gl.setRenderTarget = setRenderTarget;
      restores.forEach(restore => restore());
      resolve(records);
    };

    const removeBefore = addEffect(() => {
      queries?.poll();
      const now = performance.now();
      const full = records.length >= options.frames;
      if ((full && records.every(r => r.waiting === 0)) || now > deadline)
        return finish();
      current = null;
      if (full) return;
      if (seen++ >= options.warmup) {
        current = {
          interval: last < 0 ? 0 : now - last,
          cpu: 0,
          bake: false,
          gpu: null,
          groups: {},
          waiting: 0,
        };
        const record = current;
        const begun =
          queries && !groups
            ? queries.begin(ms => {
                record.gpu = ms;
                record.waiting--;
              })
            : false;
        if (begun) record.waiting++;
      }
      last = now;
      start = now;
    });

    const removeAfter = addAfterEffect(() => {
      if (!current) return;
      if (queries && !groups) queries.end();
      current.cpu = performance.now() - start;
      records.push(current);
      current = null;
    });
  });
}

/**
 * Measure the frames as they run: their GPU time (EXT_disjoint_timer_query_webgl2), their
 * main-thread time and, in a second pass, the draws of named groups of objects one by one.
 *
 * ⚠️ Only one GPU timer can be open at a time: turn other profilers (OITRenderPass
 * `profile`) off first.
 */
export async function profileFrames(
  gl: WebGLRenderer,
  scene: Object3D,
  options: ProfileOptions = {},
): Promise<ProfileResult> {
  const settings = {
    frames: options.frames ?? 120,
    warmup: options.warmup ?? 20,
    timeout: options.timeout ?? 30000,
  };
  const context = gl.getContext() as WebGL2RenderingContext;
  const ext = context.getExtension(
    'EXT_disjoint_timer_query_webgl2',
  ) as TimerQuery | null;
  const queries = ext ? new GpuQueries(context, ext) : null;
  const size = gl.getDrawingBufferSize(new Vector2());

  const whole = await measure(gl, scene, queries, settings);
  const steady = whole.filter(r => !r.bake);
  const baked = whole.filter(r => r.bake);

  const groups: ProfileResult['groups'] = {};
  if (options.groups) {
    const parts = await measure(gl, scene, queries, settings, options.groups);
    const names = new Set(parts.flatMap(r => Object.keys(r.groups)));
    for (const name of names) {
      const of = parts.map(
        r => r.groups[name] ?? { cpu: 0, draws: 0, gpu: queries ? 0 : null },
      );
      groups[name] = {
        gpu: stat(of.map(g => g.gpu).filter(known)),
        cpu: stat(of.map(g => g.cpu)),
        draws: stat(of.map(g => g.draws))?.median ?? 0,
      };
    }
  }

  return {
    frames: whole.length,
    pixels: size.x * size.y,
    interval: stat(whole.slice(1).map(r => r.interval)),
    cpu: stat(steady.map(r => r.cpu)),
    gpu: stat(steady.map(r => r.gpu).filter(known)),
    bakes: {
      frames: baked.length,
      cpu: stat(baked.map(r => r.cpu)),
      gpu: stat(baked.map(r => r.gpu).filter(known)),
    },
    groups,
  };
}
