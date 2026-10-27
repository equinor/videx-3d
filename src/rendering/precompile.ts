import {
  Camera,
  Material,
  Object3D,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { LAYERS } from '../layers/layers';
import { isOitCapable, OitCapableMaterial, OitPass } from './oit-material';
import type { Pass } from './Pass';
import { OITRenderPass } from './passes/OITRenderPass';

// The passes a RenderingPipeline draws each scene with: programs are compiled for them.
const pipelines = new WeakMap<Object3D, readonly Pass[]>();
// three keys a program on whether a render target is bound, not on which one.
const offscreenTargets = new WeakMap<WebGLRenderer, WebGLRenderTarget>();

const POLL_INTERVAL = 10;

/**
 * @internal
 * How many programs `precompile` keeps compiling at once, per renderer. Chrome compiles on
 * a pool of threads shared by everything in the browser, and a program drawn before it
 * is ready waits for a free one with the GPU process's main thread blocked, which freezes
 * every tab: the sky alone queues ~39 s of Direct3D compiling, enough to fill all 19 on
 * a 20-thread laptop. A few at a time leaves the rest free for what the host compiles.
 */
export const PRECOMPILE_SLOTS = Math.max(
  1,
  Math.min(4, Math.floor((globalThis.navigator?.hardwareConcurrency ?? 4) / 4)),
);

/**
 * @internal
 * Which compiles go first in the queue: higher first, then in the order asked for. The
 * sky's large programs are `background`, so the scene's own content does not wait behind
 * them; what is drawn while they compile is `first`.
 */
export const PRECOMPILE_PRIORITY = { first: 1, normal: 0, background: -1 };

type Renderable = Object3D & { material?: Material | Material[] };

type ProgramState = { currentProgram?: { isReady(): boolean } };

// One object's compile, waiting or under way.
type Job = {
  object: Renderable;
  camera: Camera;
  scene: Scene;
  passes: OitPass[];
  offscreen: boolean;
  priority: number;
  order: number;
  // Its materials as queued: disposed of before it starts, it is dropped.
  watched: Material[];
  // Not yet ready, once started.
  pending: Material[];
  finished: boolean;
  onFinish: () => void;
};

type Queue = {
  waiting: Job[];
  compiling: Job[];
  order: number;
  polling: boolean;
};

const queues = new WeakMap<WebGLRenderer, Queue>();

/** @internal The passes a pipeline draws `scene` with, `null` once it is gone. */
export function setPipelinePasses(
  scene: Object3D,
  passes: readonly Pass[] | null,
) {
  if (passes) pipelines.set(scene, passes);
  else pipelines.delete(scene);
}

/** The variant passes an `OITRenderPass` draws its transparent materials with. */
export function oitVariantPasses(pass: OITRenderPass): OitPass[] {
  const passes: OitPass[] = [];
  if (!pass.skipFront) passes.push('depthMin');
  passes.push('accum');
  // Merged only without MSAA, which the pipeline's own target is assumed not to have.
  const merged = pass.mergeFront && pass.opaqueSamples === 0;
  if (!pass.skipFront && !merged) passes.push('front');
  if (pass.occlusionDepthStamp) passes.push('occlusion');
  return passes;
}

function effectiveOpacity(material: Material) {
  const opacity = (material as Partial<ShaderMaterial>).uniforms?.opacity
    ?.value;
  return typeof opacity === 'number' ? opacity : material.opacity;
}

/**
 * Where to compile for: as `scene` is drawn (`'scene'`, through its `RenderingPipeline`
 * when it has one), or into a render target of one's own, as a bake draws (`'offscreen'`).
 */
export type PrecompileTarget = 'scene' | 'offscreen';

/** @internal */
export type PrecompileOptions = {
  /** its place in the queue (see {@link PRECOMPILE_PRIORITY}). Default `normal` */
  priority?: number;
  /**
   * Told how many of its objects are compiled, of how many: once they are queued (`0, 0`
   * for none), then as each is.
   */
  onProgress?: (done: number, total: number) => void;
};

/**
 * @internal
 * Several `precompile` calls counted as one: pass `track()` as each one's `onProgress`.
 * A count runs until every call in it has finished; a call made after that starts a
 * new one. `onChange` hears every change.
 */
export function createPrecompileCount(onChange: () => void) {
  const calls = new Set<{ done: number; total: number; told: boolean }>();
  const count = () => {
    let done = 0;
    let total = 0;
    for (const call of calls) {
      done += call.done;
      total += call.total;
    }
    return { done, total };
  };
  return {
    count,
    track: (): NonNullable<PrecompileOptions['onProgress']> => {
      // Every call told and done: this one starts a new count.
      if ([...calls].every(call => call.told && call.done === call.total))
        calls.clear();
      const call = { done: 0, total: 0, told: false };
      calls.add(call);
      return (done, total) => {
        call.done = done;
        call.total = total;
        call.told = true;
        onChange();
      };
    },
  };
}

/**
 * @internal
 * Compile the programs `root`'s meshes draw with, shown or hidden, as `scene` draws them —
 * through an OIT pipeline, as its pass variants — and lit by `scene`'s lights. With
 * `KHR_parallel_shader_compile` the compile runs off the main thread: keep `root` hidden
 * until the promise resolves, and the frame that first draws it does not stall. `null`
 * when every program is ready already, or the browser cannot tell.
 *
 * The objects join one queue per renderer, which keeps {@link PRECOMPILE_SLOTS} programs
 * compiling at once; each compiles as it is drawn when its turn comes. An object whose
 * material is disposed of before then is dropped.
 *
 * ⚠️ `root` must hold no lights: three counts the lights of both `root` and `scene`.
 */
export function precompile(
  renderer: WebGLRenderer,
  root: Object3D,
  camera: Camera,
  scene: Scene,
  target: PrecompileTarget = 'scene',
  { priority = PRECOMPILE_PRIORITY.normal, onProgress }: PrecompileOptions = {},
): Promise<void> | null {
  const passes = target === 'scene' ? pipelines.get(scene) : undefined;
  const oit = passes?.find(
    (pass): pass is OITRenderPass => pass instanceof OITRenderPass,
  );
  const variantPasses = oit ? oitVariantPasses(oit) : [];
  const offscreen = target === 'offscreen' || passes !== undefined;

  const queue = queueOf(renderer);
  const jobs: Job[] = [];
  let left = 0;
  let queued = false;
  let resolve: (() => void) | null = null;
  const onFinish = () => {
    left--;
    if (queued) onProgress?.(jobs.length - left, jobs.length);
    if (left === 0) resolve?.();
  };
  root.traverse(object => {
    const r = object as Renderable;
    if (!r.material) return;
    const job: Job = {
      object: r,
      camera,
      scene,
      passes: variantPasses,
      offscreen,
      priority,
      order: queue.order++,
      watched: [r.material].flat(),
      pending: [],
      finished: false,
      onFinish,
    };
    const drop = () => {
      if (job.finished || queue.compiling.includes(job)) return;
      queue.waiting.splice(queue.waiting.indexOf(job), 1);
      finish(job);
    };
    job.onFinish = () => {
      for (const m of job.watched) m.removeEventListener('dispose', drop);
      onFinish();
    };
    for (const m of job.watched) m.addEventListener('dispose', drop);
    jobs.push(job);
  });
  if (jobs.length === 0) {
    onProgress?.(0, 0);
    return null;
  }
  left = jobs.length;
  queue.waiting.push(...jobs);
  pump(renderer, queue);
  queued = true;
  onProgress?.(jobs.length - left, jobs.length);
  if (left === 0) return null;
  return new Promise(r => {
    resolve = r;
  });
}

function queueOf(renderer: WebGLRenderer) {
  let queue = queues.get(renderer);
  if (!queue) {
    queue = { waiting: [], compiling: [], order: 0, polling: false };
    queues.set(renderer, queue);
  }
  return queue;
}

function finish(job: Job) {
  if (job.finished) return;
  job.finished = true;
  job.onFinish();
}

function compilingCount(queue: Queue) {
  let count = 0;
  for (const job of queue.compiling) count += job.pending.length;
  return count;
}

// Start what fits, highest priority first, then in the order asked for.
function pump(renderer: WebGLRenderer, queue: Queue) {
  while (queue.waiting.length > 0 && compilingCount(queue) < PRECOMPILE_SLOTS) {
    let next = 0;
    for (let i = 1; i < queue.waiting.length; i++) {
      const a = queue.waiting[i];
      const b = queue.waiting[next];
      if (
        a.priority > b.priority ||
        (a.priority === b.priority && a.order < b.order)
      )
        next = i;
    }
    const [job] = queue.waiting.splice(next, 1);
    job.pending = [...start(renderer, job)].filter(m => !isReady(renderer, m));
    if (job.pending.length === 0) finish(job);
    else queue.compiling.push(job);
  }
  if (queue.compiling.length > 0 && !queue.polling) {
    queue.polling = true;
    setTimeout(() => poll(renderer, queue), POLL_INTERVAL);
  }
}

function poll(renderer: WebGLRenderer, queue: Queue) {
  queue.polling = false;
  for (let i = queue.compiling.length - 1; i >= 0; i--) {
    const job = queue.compiling[i];
    job.pending = job.pending.filter(m => !isReady(renderer, m));
    if (job.pending.length > 0) continue;
    queue.compiling.splice(i, 1);
    finish(job);
  }
  pump(renderer, queue);
}

// Compile one object's programs as the scene draws it now: through the OIT pipeline's
// variants when it is transparent, forced opaque when it is drawn so.
function start(renderer: WebGLRenderer, job: Job): Set<Material> {
  const { object, camera, scene, passes } = job;
  const original = object.material!;
  const list = [original].flat();
  const materials = new Set<Material>();
  // three compiles every object its root traverses: this one alone.
  const single = {
    traverse: (callback: (o: Object3D) => void) => callback(object),
    traverseVisible: () => {},
  } as unknown as Object3D;
  const compile = () =>
    renderer.compile(single, camera, scene).forEach(m => materials.add(m));

  let route: 'plain' | 'forced' | 'variants' = 'plain';
  const capable = passes.length > 0 ? list.filter(isOitCapable) : [];
  if (
    capable.length > 0 &&
    !object.layers.isEnabled(LAYERS.OVERLAY) &&
    !object.layers.isEnabled(LAYERS.EMISSIVE) &&
    !object.layers.isEnabled(LAYERS.OIT_EXCLUDED)
  ) {
    route =
      object.layers.isEnabled(LAYERS.FORCE_OPAQUE) ||
      capable.every(m => !m.transparent || effectiveOpacity(m) >= 1)
        ? 'forced'
        : 'variants';
  }
  const forced = route === 'forced' ? capable.filter(m => m.transparent) : [];

  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const mipmap = renderer.getActiveMipmapLevel();
  try {
    renderer.setRenderTarget(job.offscreen ? offscreenTarget(renderer) : null);
    for (const m of forced) m.transparent = false;
    if (route === 'variants') {
      for (const pass of passes) {
        object.material = Array.isArray(original)
          ? original.map(m => variantOf(m, pass))
          : variantOf(original, pass);
        compile();
      }
    } else {
      compile();
    }
  } finally {
    object.material = original;
    for (const m of forced) m.transparent = true;
    renderer.setRenderTarget(previous, face, mipmap);
  }
  return materials;
}

function variantOf(material: Material, pass: OitPass) {
  return isOitCapable(material) && material.transparent
    ? (material as Material & OitCapableMaterial).getOitVariants()[pass]
    : material;
}

function isReady(renderer: WebGLRenderer, material: Material) {
  const program = (renderer.properties.get(material) as ProgramState)
    .currentProgram;
  return !program || program.isReady();
}

function offscreenTarget(renderer: WebGLRenderer) {
  let target = offscreenTargets.get(renderer);
  if (!target) {
    target = new WebGLRenderTarget(1, 1, { depthBuffer: false });
    offscreenTargets.set(renderer, target);
  }
  return target;
}
