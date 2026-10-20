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

type Renderable = Object3D & { material?: Material | Material[] };

type ProgramState = { currentProgram?: { isReady(): boolean } };

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

/**
 * @internal
 * Compile the programs `root`'s meshes draw with, as `scene` draws them — through an
 * OIT pipeline, as its pass variants — and lit by `scene`'s lights. With
 * `KHR_parallel_shader_compile` the compile runs off the main thread: keep `root`
 * hidden until the promise resolves, and the frame that first draws it does not stall.
 * `null` when every program is ready already, or the browser cannot tell.
 *
 * ⚠️ `root` must hold no lights: three counts the lights of both `root` and `scene`.
 */
export function precompile(
  renderer: WebGLRenderer,
  root: Object3D,
  camera: Camera,
  scene: Scene,
  target: PrecompileTarget = 'scene',
): Promise<void> | null {
  const passes = target === 'scene' ? pipelines.get(scene) : undefined;
  const oit = passes?.find(
    (pass): pass is OITRenderPass => pass instanceof OITRenderPass,
  );
  const variantPasses = oit ? oitVariantPasses(oit) : [];
  const offscreen = target === 'offscreen' || passes !== undefined;

  // As the OIT pass routes them: transparent ones through variants, opaque ones forced.
  const swaps: { object: Renderable; original: Material | Material[] }[] = [];
  const forced: Material[] = [];
  if (variantPasses.length > 0) {
    root.traverse(object => {
      const r = object as Renderable;
      const material = r.material;
      if (!material) return;
      if (
        r.layers.isEnabled(LAYERS.OVERLAY) ||
        r.layers.isEnabled(LAYERS.EMISSIVE) ||
        r.layers.isEnabled(LAYERS.OIT_EXCLUDED)
      )
        return;
      const list = Array.isArray(material) ? material : [material];
      const capable = list.filter(isOitCapable);
      if (capable.length === 0) return;
      const opaque =
        r.layers.isEnabled(LAYERS.FORCE_OPAQUE) ||
        capable.every(m => !m.transparent || effectiveOpacity(m) >= 1);
      if (opaque) {
        for (const m of capable) if (m.transparent) forced.push(m);
      } else {
        swaps.push({ object: r, original: material });
      }
    });
  }

  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const mipmap = renderer.getActiveMipmapLevel();
  const materials = new Set<Material>();
  const compile = () =>
    renderer.compile(root, camera, scene).forEach(m => materials.add(m));
  try {
    if (offscreen) renderer.setRenderTarget(offscreenTarget(renderer));
    else renderer.setRenderTarget(null);
    for (const m of forced) m.transparent = false;
    if (swaps.length === 0) {
      compile();
    } else {
      for (const pass of variantPasses) {
        for (const { object, original } of swaps) {
          object.material = Array.isArray(original)
            ? original.map(m => variantOf(m, pass))
            : variantOf(original, pass);
        }
        compile();
      }
    }
  } finally {
    for (const { object, original } of swaps) object.material = original;
    for (const m of forced) m.transparent = true;
    renderer.setRenderTarget(previous, face, mipmap);
  }

  const pending = [...materials].filter(m => !isReady(renderer, m));
  if (pending.length === 0) return null;
  return new Promise(resolve => {
    const poll = () => {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (isReady(renderer, pending[i])) pending.splice(i, 1);
      }
      if (pending.length === 0) resolve();
      else setTimeout(poll, POLL_INTERVAL);
    };
    setTimeout(poll, POLL_INTERVAL);
  });
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
